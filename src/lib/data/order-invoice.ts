import type { createClient } from "@/lib/supabase/server";
import type { OrderItem } from "@/lib/types";
import { applyEligibleDepositsToInvoice } from "@/lib/data/apply-customer-deposits";
import { matchOrderContactCustomer } from "@/lib/data/customer-resolve";
import { cutsTotalSqYd } from "@/lib/order-cuts";
import { catalogRateToBillingUnit, isAreaUnit } from "@/lib/units";
import { orderInvoiceIdempotencyKey } from "@/lib/financial-idempotency";

// Accepts either the RLS server client or the admin client.
type DB = Awaited<ReturnType<typeof createClient>>;

/**
 * Build a draft invoice from an order's items — the single source of truth used
 * by both the manual "Create invoice" button and the automatic generation when
 * the warehouse marks the order cut & ready. Idempotent: if the order already
 * has an invoice, returns that id instead of making a second one. Prices from
 * the requested price, else the retail the customer saw. Returns the invoice id
 * (existing or new) or null.
 */
export async function buildInvoiceFromOrder(
  db: DB,
  orderId: string,
  createdBy: string | null,
): Promise<string | null> {
  const { data: order } = await db
    .from("orders")
    .select("id, customer_id, job_id, invoice_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || !order.customer_id) return null;
  if (order.invoice_id) return order.invoice_id as string; // already invoiced

  const { data: itemData } = await db
    .from("order_items")
    .select("*")
    .eq("order_id", orderId)
    .order("position", { ascending: true });
  const items = (itemData ?? []) as OrderItem[];

  const idempotencyKey = orderInvoiceIdempotencyKey(orderId);
  const inserted = await db
    .from("invoices")
    .insert({
      customer_id: order.customer_id,
      job_id: order.job_id,
      issue_date: new Date().toISOString().slice(0, 10),
      status: "draft",
      tax_rate: 0,
      created_by: createdBy,
      idempotency_key: idempotencyKey,
    })
    .select("id")
    .single();
  let inv = inserted.data;
  if (!inv) {
    const duplicate =
      inserted.error?.code === "23505" ||
      /duplicate key/i.test(inserted.error?.message ?? "");
    if (!duplicate) return null;
    const { data: existing } = await db
      .from("invoices")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (!existing?.id) return null;
    await db
      .from("orders")
      .update({ invoice_id: existing.id })
      .eq("id", orderId)
      .is("invoice_id", null);
    return existing.id as string;
  }

  const rows = items.map((it, i) => {
    // Exclusive carpet-tile office customer-order invoice qty from cuts is the order, not leftover planted quantity — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
    // Hard-surface office customer-order invoice leftover planted quantity stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage.
    const qty = cutsTotalSqYd(it) ?? it.quantity ?? 1;
    // Exclusive carpet-tile office customer-order invoice unit from cuts is the order, not leftover planted unit — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
    // Hard-surface office customer-order invoice leftover planted unit stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage.
    const unit = cutsTotalSqYd(it) != null ? "sq yd" : (it.unit || "");
    // Exclusive carpet-tile office customer-order invoice rate from cuts is the order, not leftover planted rate — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
    // Hard-surface office customer-order invoice leftover planted rate stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage.
    const leftoverRate = it.requested_price ?? it.retail_price ?? 0;
    const rate =
      cutsTotalSqYd(it) != null && (it.unit || "").trim() && isAreaUnit(it.unit)
        ? catalogRateToBillingUnit(leftoverRate, it.unit, true)
        : leftoverRate;
    return {
      invoice_id: inv.id,
      position: i,
      description:
        [it.description, it.color, it.style].filter(Boolean).join(" · ") +
        (it.cut_notes ? ` (cuts: ${it.cut_notes})` : ""),
      quantity: qty,
      unit,
      rate,
    };
  });
  if (rows.length) await db.from("invoice_items").insert(rows);

  await db.from("orders").update({ invoice_id: inv.id }).eq("id", orderId);
  await applyEligibleDepositsToInvoice(db, {
    invoiceId: inv.id as string,
    createdBy,
    appliedOn: new Date().toISOString().slice(0, 10),
  });
  return inv.id as string;
}

type OrderContactRow = {
  id: string;
  customer_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  invoice_id: string | null;
  stock_status: string | null;
};

async function attachOrderToMatchedCustomer(
  db: DB,
  raw: OrderContactRow,
): Promise<string | null> {
  if (raw.customer_id) return raw.customer_id;
  const customerId = await matchOrderContactCustomer(
    db as unknown as Parameters<typeof matchOrderContactCustomer>[0],
    {
      fullName: raw.contact_name ?? "",
      phone: raw.contact_phone,
      email: raw.contact_email,
    },
  );
  if (!customerId) return null;
  const { data: linked } = await db
    .from("orders")
    .update({ customer_id: customerId })
    .eq("id", raw.id)
    .is("customer_id", null)
    .select("customer_id")
    .maybeSingle();
  if (linked?.customer_id) return linked.customer_id as string;
  const { data: latest } = await db
    .from("orders")
    .select("customer_id")
    .eq("id", raw.id)
    .maybeSingle();
  return (latest?.customer_id as string | null) ?? null;
}

/**
 * Put customer orders on the matching customer, then turn warehouse-verified
 * in-stock orders into a draft invoice on that customer.
 * Shortage and unchecked stock stay on the customer and are not invoiced.
 * Idempotent. Office/admin callers only — warehouse must not call this.
 */
export async function placeInStockOrdersOnCustomerInvoices(
  db: DB,
  createdBy: string | null,
  onlyCustomerId?: string | null,
): Promise<void> {
  const { data: unlinked } = await db
    .from("orders")
    .select(
      "id, customer_id, contact_name, contact_phone, contact_email, invoice_id, stock_status",
    )
    .in("status", ["submitted", "approved"])
    .is("customer_id", null)
    .order("created_at", { ascending: false })
    .limit(20);
  for (const raw of (unlinked ?? []) as OrderContactRow[]) {
    try {
      await attachOrderToMatchedCustomer(db, raw);
    } catch {
      // One contact match must not stop the rest.
    }
  }

  let ready = db
    .from("orders")
    .select("id")
    .in("status", ["submitted", "approved"])
    .eq("stock_status", "in_stock")
    .not("customer_id", "is", null)
    .is("invoice_id", null)
    .order("created_at", { ascending: false })
    .limit(20);
  if (onlyCustomerId) ready = ready.eq("customer_id", onlyCustomerId);
  const { data } = await ready;
  for (const raw of (data ?? []) as { id: string }[]) {
    try {
      await buildInvoiceFromOrder(db, raw.id, createdBy);
    } catch {
      // One order must not stop the rest of the queue.
    }
  }
}
