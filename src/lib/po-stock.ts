import type { createClient } from "@/lib/supabase/server";
import type { PoStatus } from "@/lib/types";
import { syncRolledOnHand } from "@/lib/data/stock-rolls";

/**
 * Inventory reconciliation for purchase orders — the SINGLE place that turns a
 * PO into stock movement, so on-hand and reserved can never drift no matter
 * which path changed the PO (status buttons, the builder, a delete, or a
 * customer being wiped). All callers funnel through here.
 *
 * F6-P4: one RPC call per PO line so cumulative over-receive checks stay exact.
 * F7/0178: inventory qty follows stamped received_qty (or ordered when stamp
 * null). Partial receipts call applyPoLineReceiptDelta; full-status path only
 * posts the remaining ledger delta (never re-posts ordered qty).
 */

// Both the RLS server client and the admin client are accepted.
type DB = Awaited<ReturnType<typeof createClient>>;

const round = (n: number) => Math.round(n * 100) / 100;
const EPS = 0.00005;

/** Pure ledger delta planner — used by applyPoLineReceiptDelta + goldens. */
export function planPoReceiveDelta(args: {
  orderedQty: number;
  targetReceivedQty: number;
  alreadyOnLedger: number;
}):
  | { ok: true; delta: number }
  | { ok: false; code: string; error: string } {
  const ordered = Math.max(0, Number(args.orderedQty) || 0);
  const target = Number(args.targetReceivedQty);
  const already = Math.max(0, Number(args.alreadyOnLedger) || 0);
  if (!Number.isFinite(target) || target < 0) {
    return {
      ok: false,
      code: "INV_RECEIVE_QTY",
      error: "Received quantity must be a non-negative number.",
    };
  }
  if (target > ordered + EPS) {
    return {
      ok: false,
      code: "INV_OVER_RECEIVE",
      error: `Cannot receive ${target} against ordered ${ordered}.`,
    };
  }
  const delta = round(target - already);
  if (Math.abs(delta) <= EPS) return { ok: true, delta: 0 };
  if (delta < 0) {
    return {
      ok: false,
      code: "INV_RECEIVE_DECREASE",
      error:
        "Ledger already has more quantity than this stamp. Reverse the receipt movement instead.",
    };
  }
  return { ok: true, delta };
}

async function uid(db: DB): Promise<string | null> {
  const {
    data: { user },
  } = await db.auth.getUser();
  return user?.id ?? null;
}

async function ledgerReceivedQty(db: DB, poItemId: string): Promise<number> {
  const { data, error } = await db.rpc("inv_po_item_received_qty", {
    p_po_item_id: poItemId,
  });
  if (error) {
    throw new Error(
      error.message.includes("does not exist")
        ? "Inventory receive ledger RPC missing — apply migration 0176."
        : error.message,
    );
  }
  return Number(data) || 0;
}

function rpcOk(data: unknown): { ok: boolean; error?: string; code?: string } {
  if (!data || typeof data !== "object") return { ok: false, error: "Empty RPC result" };
  const r = data as { ok?: boolean; error?: string; code?: string };
  return { ok: !!r.ok, error: r.error, code: r.code };
}

/**
 * Bring ledger receive qty up to target for one PO line (tracked products only).
 * target = stamped received_qty when set, else ordered quantity.
 * Concurrent callers are serialized by receive_inventory_safe (po_item FOR UPDATE)
 * and INV_OVER_RECEIVE.
 */
export async function applyPoLineReceiptDelta(
  db: DB,
  args: {
    poId: string;
    poItemId: string;
    productId: string;
    orderedQty: number;
    targetReceivedQty: number;
    note?: string | null;
  },
): Promise<{ delta: number }> {
  const ordered = Math.max(0, Number(args.orderedQty) || 0);
  const early = planPoReceiveDelta({
    orderedQty: ordered,
    targetReceivedQty: args.targetReceivedQty,
    alreadyOnLedger: 0,
  });
  if (!early.ok && early.code !== "INV_RECEIVE_DECREASE") {
    throw new Error(`${early.code}: ${early.error}`);
  }

  const { data: prod } = await db
    .from("products")
    .select("id, track_stock, stock_kind")
    .eq("id", args.productId)
    .maybeSingle();
  if (!prod || !prod.track_stock) return { delta: 0 };

  const already = await ledgerReceivedQty(db, args.poItemId);
  const plan = planPoReceiveDelta({
    orderedQty: ordered,
    targetReceivedQty: args.targetReceivedQty,
    alreadyOnLedger: already,
  });
  if (!plan.ok) throw new Error(`${plan.code}: ${plan.error}`);
  if (plan.delta <= EPS) return { delta: 0 };
  const delta = plan.delta;

  const userId = await uid(db);
  const rolled = (prod.stock_kind as string) === "rolled";
  const { data, error } = await db.rpc("receive_inventory_safe", {
    p_product_id: args.productId,
    p_qty: delta,
    p_note: args.note || (rolled ? "Partial receive from PO (rolled)" : "Partial receive from PO"),
    p_po_id: args.poId,
    p_po_item_id: args.poItemId,
    p_created_by: userId,
    p_idempotency_key: `po_recv:${args.poItemId}:${already}:${delta}`,
    ...(rolled
      ? { p_create_roll: true, p_roll_kind: "roll" }
      : {}),
  });
  if (error) throw new Error(error.message);
  const res = rpcOk(data);
  if (!res.ok) {
    throw new Error(res.error || res.code || "Receive inventory failed.");
  }
  if (rolled) await syncRolledOnHand(args.productId, db);
  return { delta };
}

/**
 * Receiving a PO adds its items to on-hand stock — but only for products we
 * actually TRACK. Special-order items (untracked) flow straight to the job and
 * never enter inventory. `sign` is +1 to receive, -1 to reverse (PO moved back
 * out of "received", cancelled, or deleted).
 *
 * F7: +1 posts only remaining (target − ledger), never the full ordered qty if
 * partials already hit the ledger.
 */
export async function applyReceiptToStock(
  db: DB,
  poId: string,
  sign: 1 | -1,
): Promise<void> {
  const { data: items } = await db
    .from("po_items")
    .select("id, product_id, quantity, received_qty")
    .eq("po_id", poId);
  const rows = (items ?? []).filter(
    (it) => it.product_id && (Number(it.quantity) || 0) > 0,
  );
  if (!rows.length) return;

  const productIds = [...new Set(rows.map((it) => it.product_id as string))];
  const { data: prods } = await db
    .from("products")
    .select("id, on_hand, track_stock, stock_kind")
    .in("id", productIds);
  const prodMap = new Map(
    (prods ?? []).map((p) => [
      p.id as string,
      {
        on_hand: Number(p.on_hand) || 0,
        track_stock: !!p.track_stock,
        stock_kind: (p.stock_kind as string) ?? null,
      },
    ]),
  );

  const userId = await uid(db);
  const touchedRolled = new Set<string>();

  for (const it of rows) {
    const pid = it.product_id as string;
    const p = prodMap.get(pid);
    if (!p || !p.track_stock) continue;
    const ordered = Number(it.quantity) || 0;
    const poItemId = it.id as string;
    const stamped =
      it.received_qty != null ? Number(it.received_qty) : null;
    const target =
      stamped != null && Number.isFinite(stamped) ? stamped : ordered;

    if (sign > 0) {
      await applyPoLineReceiptDelta(db, {
        poId,
        poItemId,
        productId: pid,
        orderedQty: ordered,
        targetReceivedQty: target,
        note: p.stock_kind === "rolled" ? "Received from PO (rolled)" : "Received from PO",
      });
      if (p.stock_kind === "rolled") touchedRolled.add(pid);
      continue;
    }

    // Reverse path (leaving received): unwind by ledger qty for this PO line.
    const already = await ledgerReceivedQty(db, poItemId);
    if (already <= EPS) continue;
    if (p.stock_kind === "rolled") {
      throw new Error(
        "INV_ROLL_RECEIPT_REVERSE: rolled PO un-receive requires formal movement reversal.",
      );
    }
    const { data: live } = await db
      .from("products")
      .select("on_hand")
      .eq("id", pid)
      .maybeSingle();
    const onHand = Number(live?.on_hand) || 0;
    await db.rpc("adjust_inventory_safe", {
      p_product_id: pid,
      p_counted_on_hand: round(Math.max(0, onHand - already)),
      p_reason: "PO no longer received",
      p_note: "PO no longer received",
      p_created_by: userId,
    });
  }

  for (const pid of touchedRolled) {
    await syncRolledOnHand(pid, db);
  }
}

/**
 * Apply the stock effect of a PO status change. Receiving adds to stock;
 * leaving "received" reverses it. Re-saving the same status is a no-op, so a PO
 * can never double-count. Call this for EVERY status transition.
 */
export async function reconcilePoStock(
  db: DB,
  poId: string,
  prev: PoStatus | null | undefined,
  next: PoStatus,
): Promise<void> {
  const becameReceived = prev !== "received" && next === "received";
  const leftReceived = prev === "received" && next !== "received";
  if (becameReceived) await applyReceiptToStock(db, poId, 1);
  else if (leftReceived) await applyReceiptToStock(db, poId, -1);
}

/**
 * About to delete these POs — undo any stock a received PO added, so deleting
 * a received PO doesn't leave phantom on-hand behind.
 */
export async function reverseReceivedPOs(
  db: DB,
  poIds: string[],
): Promise<void> {
  if (!poIds.length) return;
  const { data } = await db
    .from("purchase_orders")
    .select("id, status")
    .in("id", poIds);
  for (const po of data ?? []) {
    if ((po.status as PoStatus) === "received") {
      await applyReceiptToStock(db, po.id as string, -1);
    }
  }
}

/**
 * Release every stock reservation held by the given jobs and decrement each
 * product's reserved counter to match — so deleting/cancelling a job's
 * customer frees the inventory it was holding instead of leaking it forever.
 * Mirrors the per-line ledger math used elsewhere: outstanding reserved per
 * line = max(0, (reserve + release) − pulled).
 */
export async function releaseJobReservations(
  db: DB,
  jobIds: string[],
): Promise<void> {
  if (!jobIds.length) return;
  const { data: moves } = await db
    .from("stock_movements")
    .select("job_id, product_id, line_id, kind, qty")
    .in("job_id", jobIds);
  if (!moves?.length) return;

  // Per (job, product, line): outstanding reserved = max(0, (reserve+release) − pulled).
  type Acc = { reserve: number; pulled: number };
  const byKey = new Map<
    string,
    { jobId: string; productId: string; lineId: string | null; acc: Acc }
  >();
  for (const m of moves) {
    const jobId = m.job_id as string | null;
    const pid = m.product_id as string | null;
    if (!jobId || !pid) continue;
    const lineId = (m.line_id as string | null) ?? null;
    const key = `${jobId}::${pid}::${lineId ?? "_"}`;
    const entry = byKey.get(key) ?? {
      jobId,
      productId: pid,
      lineId,
      acc: { reserve: 0, pulled: 0 },
    };
    const q = Number(m.qty) || 0;
    if (m.kind === "reserve" || m.kind === "release") entry.acc.reserve += q;
    else if (m.kind === "pull") entry.acc.pulled += Math.abs(q);
    byKey.set(key, entry);
  }

  const userId = await uid(db);
  for (const { jobId, productId, lineId, acc } of byKey.values()) {
    const reserved = Math.max(0, round(acc.reserve - acc.pulled));
    if (reserved <= 0) continue;
    // F7: canonical 0176 release — never direct-update products.reserved.
    await db.rpc("release_inventory_safe", {
      p_product_id: productId,
      p_qty: reserved,
      p_job_id: jobId,
      p_line_id: lineId,
      p_note: "Job cancelled/released reservations",
      p_idempotency_key: `release:job:${jobId}:product:${productId}:line:${lineId ?? "_"}:${reserved}`,
      p_created_by: userId,
    });
  }
}
