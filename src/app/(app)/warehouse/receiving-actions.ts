"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertRole } from "@/lib/auth";
import { applyPoStatus, notifyBackordered } from "@/app/(app)/purchase-orders/actions";
import { postPoReceiptLines } from "@/lib/po-stock";
import { syncRolledOnHand } from "@/lib/data/stock-rolls";
import { employeeReceiptError } from "@/lib/po-facts";
import { QUEUE_LIST_UNAVAILABLE, logQueueFailure } from "@/lib/ops-scale";
import { listPageWindow, WORK_QUEUE_PAGE_SIZE } from "@/lib/work-queues";

const RECEIVERS = ["admin", "office", "warehouse"] as const;

export interface ReceiveLine {
  itemId: string;
  /** What was actually counted in (cumulative stamp for the line). */
  receivedQty: string | number;
  note: string;
}

const n = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined || v === "") return 0;
  const x = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(x) ? x : 0;
};

/**
 * Check a delivery in against the order it was raised from.
 *
 * F7: each partial stamp posts inventory delta via receive_inventory_safe
 * (0176) immediately — inventory follows counted qty, not ordered qty.
 * Full PO "received" status still runs reconcilePoStock, which only posts
 * remaining ledger delta (idempotent with partials).
 */
export async function receivePoLines(input: {
  poId: string;
  lines: ReceiveLine[];
  note: string;
}): Promise<{ error: string | null; fullyReceived?: boolean; short?: number }> {
  const profile = await assertRole([...RECEIVERS]);
  const db = createAdminClient();

  const { data: po } = await db
    .from("purchase_orders")
    .select("id, status, backordered")
    .eq("id", input.poId)
    .maybeSingle();
  if (!po) return { error: "That purchase order no longer exists." };
  if (po.status === "void" || po.status === "cancelled") {
    return { error: "That purchase order was voided." };
  }
  if (po.status === "received") {
    return {
      error:
        "This PO is already marked received. Reverse or adjust inventory formally instead of re-stamping lines.",
    };
  }

  // Load ordered qty + product for validation before writing stamps.
  const { data: existingItems } = await db
    .from("po_items")
    .select("id, quantity, product_id")
    .eq("po_id", input.poId);
  const byId = new Map(
    (existingItems ?? []).map((i) => [i.id as string, i]),
  );

  for (const l of input.lines) {
    const row = byId.get(l.itemId);
    if (!row) {
      return { error: "A receive line does not belong to this purchase order." };
    }
    const ordered = n(row.quantity);
    const qty = n(l.receivedQty);
    if (qty < 0) {
      return { error: "Received quantity cannot be negative." };
    }
    if (qty > ordered + 0.00005) {
      return {
        error: `Cannot receive ${qty} — only ${ordered} was ordered on that line.`,
      };
    }
  }

  const now = new Date().toISOString();
  // One transaction for every line in this check-in. A later line failure
  // rolls back the earlier lines and does not stamp them.
  const posted = await postPoReceiptLines(
    db as never,
    input.poId,
    input.lines.map((l) => ({
      po_item_id: l.itemId,
      target_received_qty: n(l.receivedQty),
      note: l.note.trim() || input.note.trim() || null,
      stamp_received_qty: true,
      received_by: profile.id,
      receiving_note: l.note.trim() || null,
    })),
  );
  if (!posted.ok) {
    return { error: employeeReceiptError(posted.error) };
  }

  const productIds = [
    ...new Set(
      input.lines
        .map((l) => byId.get(l.itemId)?.product_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  if (productIds.length) {
    const { data: prods } = await db
      .from("products")
      .select("id, stock_kind")
      .in("id", productIds);
    for (const p of prods ?? []) {
      if (p.stock_kind !== "rolled") continue;
      try {
        await syncRolledOnHand(p.id as string, db as never);
      } catch (e) {
        return {
          error: employeeReceiptError(
            e instanceof Error ? e.message : "Rolled stock could not be synced.",
          ),
        };
      }
    }
  }

  const { data: items } = await db
    .from("po_items")
    .select("quantity, received_qty, received_at")
    .eq("po_id", input.poId);

  const all = items ?? [];
  const everyLineChecked = all.length > 0 && all.every((i) => i.received_at != null);
  const short = all.reduce(
    (sum, i) => sum + Math.max(n(i.quantity) - n(i.received_qty), 0),
    0,
  );
  const fullyReceived = everyLineChecked && short <= 0.005;

  const { data: poNow } = await db
    .from("purchase_orders")
    .select("status")
    .eq("id", input.poId)
    .maybeSingle();
  if (
    poNow?.status === "received" ||
    poNow?.status === "void" ||
    poNow?.status === "cancelled"
  ) {
    return {
      error:
        "This purchase order was already received or voided in another session. Refresh and continue from the current status.",
    };
  }

  await db
    .from("purchase_orders")
    .update({
      received_at: fullyReceived ? now : null,
      received_by: fullyReceived ? profile.id : null,
      receiving_note: input.note.trim() || null,
      backordered: everyLineChecked && short > 0.005,
    })
    .eq("id", input.poId);

  if (fullyReceived && po.status !== "received") {
    try {
      // reconcilePoStock → applyReceiptToStock posts only remaining deltas.
      await applyPoStatus(db, input.poId, "received");
    } catch (e) {
      return {
        error: employeeReceiptError(
          e instanceof Error ? e.message : "This receipt could not be recorded. Try again.",
        ),
      };
    }
  }

  if (everyLineChecked && short > 0.005 && !po.backordered) {
    const { data: full } = await db
      .from("purchase_orders")
      .select("supplier, eta_date, customer_id")
      .eq("id", input.poId)
      .maybeSingle();
    await notifyBackordered(db as never, input.poId, {
      supplier: (full?.supplier as string | null) ?? null,
      etaDate: (full?.eta_date as string | null) ?? null,
      customerId: (full?.customer_id as string | null) ?? null,
      foundOnDelivery: { shortUnits: short, note: input.note.trim() },
    });
  }

  revalidatePath("/warehouse");
  revalidatePath("/purchase-orders");
  revalidatePath(`/purchase-orders/${input.poId}`);
  revalidatePath("/inventory");
  revalidatePath("/jobs");
  return { error: null, fullyReceived, short };
}

/** Undo a check-in on one line — only when no inventory was posted for it. */
export async function unreceivePoLine(input: {
  poId: string;
  itemId: string;
}): Promise<{ error: string | null }> {
  await assertRole([...RECEIVERS]);
  const db = createAdminClient();

  const { data: po } = await db
    .from("purchase_orders")
    .select("id, status")
    .eq("id", input.poId)
    .maybeSingle();
  if (!po) return { error: "That purchase order no longer exists." };
  if (po.status === "received") {
    return {
      error:
        "This PO is already marked received in inventory. Ask office to move it out of Received (or reverse the receipt movement) instead of clearing the line stamp.",
    };
  }

  const { data: ledgerQty, error: ledgerErr } = await db.rpc(
    "inv_po_item_received_qty",
    { p_po_item_id: input.itemId },
  );
  if (!ledgerErr && Number(ledgerQty) > 0.00005) {
    return {
      error:
        "Inventory was already posted for this line. Reverse the receipt movement instead of clearing the stamp.",
    };
  }

  await db
    .from("po_items")
    .update({
      received_qty: null,
      received_at: null,
      received_by: null,
      receiving_note: null,
    })
    .eq("id", input.itemId)
    .eq("po_id", input.poId);

  await db
    .from("purchase_orders")
    .update({ received_at: null, received_by: null })
    .eq("id", input.poId);

  revalidatePath("/warehouse");
  revalidatePath(`/purchase-orders/${input.poId}`);
  revalidatePath("/inventory");
  return { error: null };
}

/** Open purchase orders the warehouse should be expecting, already flattened. */
export interface IncomingPoItem {
  id: string;
  position: number;
  description: string;
  quantity: number | null;
  unit: string;
  manufacturer: string | null;
  style: string | null;
  color: string | null;
  item_no: string | null;
  received_qty: number | null;
  received_at: string | null;
  receiving_note: string | null;
  // Exclusive carpet-tile warehouse incoming-delivery carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
  // Hard-surface warehouse incoming-delivery carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage.
  category: string | null;
  sqft_per_box: number | null;
  roll_width_ft: number | null;
}

export interface IncomingPoRow {
  id: string;
  po_number: number | null;
  supplier: string | null;
  status: string;
  eta_date: string | null;
  backordered: boolean;
  received_at: string | null;
  customerName: string | null;
  jobTitle: string | null;
  items: IncomingPoItem[];
}

const INCOMING_PO_COLUMNS =
  "id, po_number, supplier, status, eta_date, backordered, received_at, " +
  "customer:customers(full_name), job:jobs(title), " +
  "items:po_items(id, position, description, quantity, unit, manufacturer, style, color, item_no, received_qty, received_at, receiving_note, category, sqft_per_box, roll_width_ft)";

export async function listIncomingPos(
  page?: number,
  status?: "ordered" | "received",
): Promise<{ rows: IncomingPoRow[]; total: number; page: number; pageSize: number }> {
  await assertRole([...RECEIVERS]);
  const db = createAdminClient();
  const pageSize = WORK_QUEUE_PAGE_SIZE;
  const statuses = status ? [status] : ["ordered", "received"];

  const counted = await db
    .from("purchase_orders")
    .select("id", { count: "exact", head: true })
    .in("status", statuses);
  if (counted.error) {
    logQueueFailure("incoming_pos", counted.error);
    throw new Error(QUEUE_LIST_UNAVAILABLE);
  }
  const total = counted.count ?? 0;
  const window = listPageWindow(page ?? 1, pageSize, total);
  if (total === 0) {
    return { rows: [], total: 0, page: 1, pageSize };
  }

  const { data, error } = await db
    .from("purchase_orders")
    .select(INCOMING_PO_COLUMNS)
    .in("status", statuses)
    .order("eta_date", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true })
    .range(window.from, Math.max(window.from, window.to - 1));
  if (error) {
    logQueueFailure("incoming_pos", error);
    throw new Error(QUEUE_LIST_UNAVAILABLE);
  }

  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    v == null ? null : Array.isArray(v) ? (v[0] ?? null) : v;

  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((p) => {
    const cust = one(p.customer as { full_name?: string } | { full_name?: string }[] | null);
    const job = one(p.job as { title?: string } | { title?: string }[] | null);
    const items = ((p.items ?? []) as IncomingPoItem[])
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    return {
      id: p.id as string,
      po_number: (p.po_number as number | null) ?? null,
      supplier: (p.supplier as string | null) ?? null,
      status: p.status as string,
      eta_date: (p.eta_date as string | null) ?? null,
      backordered: Boolean(p.backordered),
      received_at: (p.received_at as string | null) ?? null,
      customerName: cust?.full_name ?? null,
      jobTitle: job?.title ?? null,
      items,
    };
  });
  return { rows, total, page: window.page, pageSize };
}
