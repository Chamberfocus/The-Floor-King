import type { createClient } from "@/lib/supabase/server";
import type { OrderItem } from "@/lib/types";
import { applyEligibleDepositsToInvoice } from "@/lib/data/apply-customer-deposits";

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

  const { data: inv } = await db
    .from("invoices")
    .insert({
      customer_id: order.customer_id,
      job_id: order.job_id,
      issue_date: new Date().toISOString().slice(0, 10),
      status: "draft",
      tax_rate: 0,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (!inv) return null;

  const rows = items.map((it, i) => ({
    invoice_id: inv.id,
    position: i,
    description:
      [it.description, it.color, it.style].filter(Boolean).join(" · ") +
      (it.cut_notes ? ` (cuts: ${it.cut_notes})` : ""),
    quantity: it.quantity ?? 1,
    unit: it.unit || "each",
    rate: it.requested_price ?? it.retail_price ?? 0,
  }));
  if (rows.length) await db.from("invoice_items").insert(rows);

  await db.from("orders").update({ invoice_id: inv.id }).eq("id", orderId);
  await applyEligibleDepositsToInvoice(db, {
    invoiceId: inv.id as string,
    createdBy,
    appliedOn: new Date().toISOString().slice(0, 10),
  });
  return inv.id as string;
}
