"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertRole } from "@/lib/auth";
import { applyPoStatus, notifyBackordered } from "@/app/(app)/purchase-orders/actions";

const RECEIVERS = ["admin", "office", "warehouse"] as const;

export interface ReceiveLine {
  itemId: string;
  /** What was actually counted in. */
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
 * Receiving used to be one status flip on the whole PO, done from the office,
 * with nothing recorded about what actually turned up. A short shipment or the
 * wrong colour then surfaced when an installer opened the box on site. The
 * warehouse now counts each line and says what arrived.
 *
 * The PO is only marked received when every line has been checked AND nothing
 * is short — a partial delivery stays open and flags as backordered, because
 * calling it received would tell the rest of the app the material is in.
 */
export async function receivePoLines(input: {
  poId: string;
  lines: ReceiveLine[];
  note: string;
}): Promise<{ error: string | null; fullyReceived?: boolean; short?: number }> {
  const profile = await assertRole([...RECEIVERS]);
  // The warehouse role's own RLS can't reach purchase orders; the role check
  // above is what authorises this, exactly as the warehouse queue does.
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

  const now = new Date().toISOString();
  for (const l of input.lines) {
    await db
      .from("po_items")
      .update({
        received_qty: n(l.receivedQty),
        received_at: now,
        received_by: profile.id,
        receiving_note: l.note.trim() || null,
      })
      .eq("id", l.itemId)
      .eq("po_id", input.poId);
  }

  // Re-read the whole order rather than trusting what was just submitted — a
  // second person may have checked other lines in the meantime.
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
      // Something outstanding = still on order, and the office needs to chase it.
      backordered: everyLineChecked && short > 0.005,
    })
    .eq("id", input.poId);

  if (fullyReceived && po.status !== "received") {
    // Same downstream path as the office's own status button — restock, the
    // customer advancing to Materials Received, the job's material lines
    // flipping to "arrived", the revalidations. Passed the ELEVATED client:
    // this action authorised the caller by role above, and the warehouse role
    // has no RLS reach into purchase_orders, so an RLS-scoped client here read
    // nothing and bailed out silently.
    await applyPoStatus(db, input.poId, "received");
  }

  // A short delivery found on the dock is exactly the case that needs chasing,
  // and it was the one path that told nobody — the PO builder had this alert,
  // receiving didn't. Only on the transition INTO short, so re-checking the
  // same delivery doesn't re-send.
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
  return { error: null, fullyReceived, short };
}

/** Undo a check-in on one line — a miscount shouldn't need a manager. */
export async function unreceivePoLine(input: {
  poId: string;
  itemId: string;
}): Promise<{ error: string | null }> {
  await assertRole([...RECEIVERS]);
  const db = createAdminClient();

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

  // The order can no longer be complete, so take the receipt stamp back off.
  await db
    .from("purchase_orders")
    .update({ received_at: null, received_by: null })
    .eq("id", input.poId);

  revalidatePath("/warehouse");
  revalidatePath(`/purchase-orders/${input.poId}`);
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

  // PostgREST hands embedded relations back as arrays even when to-one.
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
