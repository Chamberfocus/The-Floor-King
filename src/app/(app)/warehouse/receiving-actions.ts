"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertRole } from "@/lib/auth";
import { applyPoStatus, notifyBackordered } from "@/app/(app)/purchase-orders/actions";
import { applyPoLineReceiptDelta } from "@/lib/po-stock";

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
  for (const l of input.lines) {
    const row = byId.get(l.itemId)!;
    const qty = n(l.receivedQty);
    await db
      .from("po_items")
      .update({
        received_qty: qty,
        received_at: now,
        received_by: profile.id,
        receiving_note: l.note.trim() || null,
      })
      .eq("id", l.itemId)
      .eq("po_id", input.poId);

    // Post inventory for tracked products immediately (delta only).
    if (row.product_id) {
      try {
        await applyPoLineReceiptDelta(db as never, {
          poId: input.poId,
          poItemId: l.itemId,
          productId: row.product_id as string,
          orderedQty: n(row.quantity),
          targetReceivedQty: qty,
          note: l.note.trim() || input.note.trim() || null,
        });
      } catch (e) {
        return {
          error:
            e instanceof Error
              ? e.message
              : "Could not post inventory for this receipt.",
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
        error:
          e instanceof Error
            ? e.message.replace(/^PO_SUPPLIER_REQUIRED:\s*/, "")
            : "Could not mark this PO received.",
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

export async function listIncomingPos(): Promise<IncomingPoRow[]> {
  await assertRole([...RECEIVERS]);
  const db = createAdminClient();

  const { data } = await db
    .from("purchase_orders")
    .select(
      "id, po_number, supplier, status, eta_date, backordered, received_at, " +
        "customer:customers(full_name), job:jobs(title), " +
        "items:po_items(id, position, description, quantity, unit, manufacturer, style, color, item_no, received_qty, received_at, receiving_note)",
    )
    .in("status", ["ordered", "received"])
    .order("eta_date", { ascending: true, nullsFirst: false })
    .limit(200);

  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    v == null ? null : Array.isArray(v) ? (v[0] ?? null) : v;

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((p) => {
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
}
