import type { createClient } from "@/lib/supabase/server";
import type { PoStatus } from "@/lib/types";

/**
 * Inventory reconciliation for purchase orders — the SINGLE place that turns a
 * PO into stock movement, so on-hand and reserved can never drift no matter
 * which path changed the PO (status buttons, the builder, a delete, or a
 * customer being wiped). All callers funnel through here.
 */

// Both the RLS server client and the admin client are accepted.
type DB = Awaited<ReturnType<typeof createClient>>;

const round = (n: number) => Math.round(n * 100) / 100;

async function uid(db: DB): Promise<string | null> {
  const {
    data: { user },
  } = await db.auth.getUser();
  return user?.id ?? null;
}

/**
 * Receiving a PO adds its items to on-hand stock — but only for products we
 * actually TRACK. Special-order items (untracked) flow straight to the job and
 * never enter inventory. `sign` is +1 to receive, -1 to reverse (PO moved back
 * out of "received", cancelled, or deleted).
 */
export async function applyReceiptToStock(
  db: DB,
  poId: string,
  sign: 1 | -1,
): Promise<void> {
  const { data: items } = await db
    .from("po_items")
    .select("product_id, quantity, unit_cost")
    .eq("po_id", poId);
  const rows = (items ?? []).filter(
    (it) => it.product_id && (Number(it.quantity) || 0) > 0,
  );
  if (!rows.length) return;

  const productIds = [...new Set(rows.map((it) => it.product_id as string))];
  const { data: prods } = await db
    .from("products")
    .select("id, on_hand, track_stock")
    .in("id", productIds);
  const prodMap = new Map(
    (prods ?? []).map((p) => [
      p.id as string,
      { on_hand: Number(p.on_hand) || 0, track_stock: !!p.track_stock },
    ]),
  );

  // Aggregate quantity + cost per tracked product (a PO can list a product on
  // more than one line).
  const byProduct = new Map<string, { qty: number; unitCost: number | null }>();
  for (const it of rows) {
    const pid = it.product_id as string;
    const p = prodMap.get(pid);
    if (!p || !p.track_stock) continue; // untracked special order — skip
    const agg = byProduct.get(pid) ?? { qty: 0, unitCost: null };
    agg.qty += Number(it.quantity) || 0;
    if (agg.unitCost == null && it.unit_cost != null)
      agg.unitCost = Number(it.unit_cost);
    byProduct.set(pid, agg);
  }
  if (!byProduct.size) return;

  const userId = await uid(db);
  for (const [pid, { qty, unitCost }] of byProduct) {
    const delta = round(sign * qty);
    const p = prodMap.get(pid)!;
    await db.from("stock_movements").insert({
      product_id: pid,
      qty: delta,
      kind: sign > 0 ? "receive" : "adjust",
      unit_cost: unitCost,
      note: sign > 0 ? "Received from PO" : "PO no longer received",
      created_by: userId,
    });
    await db
      .from("products")
      .update({
        on_hand: round(p.on_hand + delta),
        last_movement_at: new Date().toISOString(),
      })
      .eq("id", pid);
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
    .select("product_id, line_id, kind, qty")
    .in("job_id", jobIds);
  if (!moves?.length) return;

  // Per (product, line): reserved = (reserve + release) − pulled, floored at 0.
  type Acc = { reserve: number; pulled: number };
  const byLine = new Map<string, { productId: string; acc: Acc }>();
  for (const m of moves) {
    const pid = m.product_id as string | null;
    if (!pid) continue;
    const key = `${pid}::${(m.line_id as string) ?? "_"}`;
    const entry = byLine.get(key) ?? { productId: pid, acc: { reserve: 0, pulled: 0 } };
    const q = Number(m.qty) || 0;
    if (m.kind === "reserve" || m.kind === "release") entry.acc.reserve += q;
    else if (m.kind === "pull") entry.acc.pulled += Math.abs(q);
    byLine.set(key, entry);
  }

  const releaseByProduct = new Map<string, number>();
  for (const { productId, acc } of byLine.values()) {
    const reserved = Math.max(0, round(acc.reserve - acc.pulled));
    if (reserved > 0)
      releaseByProduct.set(productId, round((releaseByProduct.get(productId) ?? 0) + reserved));
  }
  if (!releaseByProduct.size) return;

  const ids = [...releaseByProduct.keys()];
  const { data: prods } = await db
    .from("products")
    .select("id, reserved")
    .in("id", ids);
  for (const p of prods ?? []) {
    const cur = Number(p.reserved) || 0;
    const next = Math.max(0, round(cur - (releaseByProduct.get(p.id as string) ?? 0)));
    await db.from("products").update({ reserved: next }).eq("id", p.id);
  }
}
