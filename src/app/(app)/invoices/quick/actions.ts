"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";
import { invoiceTotals } from "@/lib/invoice-calc";
import type { PaymentMethod } from "@/lib/types";

const OFFICE = ["admin", "office", "sales_manager", "salesman"] as const;

export interface QuickLine {
  description: string;
  quantity: string | number;
  unit: string;
  rate: string | number;
  /** Catalog product, when picked — lets the sale pull from stock. */
  productId?: string | null;
}

export interface QuickInvoiceInput {
  customerId: string | null;
  /** Walk-in with no record yet — created on the fly. */
  newCustomer: { full_name: string; phone: string; email: string } | null;
  lines: QuickLine[];
  taxRate: string | number;
  notes: string;
  /** Money taken over the counter right now. Blank = leave it unpaid. */
  payment: { amount: string | number; method: PaymentMethod; reference: string } | null;
  /** Decrement catalog stock for the products sold. */
  pullFromStock: boolean;
}

const n = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined || v === "") return 0;
  const x = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(x) ? x : 0;
};

async function nextInvoiceNumber(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string> {
  // Highest existing number + 1, never a row count — deleting an invoice would
  // otherwise make the next one reuse a live number.
  const { data } = await supabase.from("invoices").select("number").limit(10000);
  let max = 1000;
  for (const r of data ?? []) {
    const m = /(\d+)\s*$/.exec((r.number as string | null) ?? "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `INV-${max + 1}`;
}

/**
 * Counter sale: one screen, one save. Customer, what they took, what they paid.
 *
 * No estimate, no job, no work order — a cash-and-carry customer walks out with
 * material and the paperwork has to already be done. Everything else in the app
 * routes through an estimate, which is right for installed work and pure
 * friction for someone buying two boxes of vinyl.
 */
export async function createQuickInvoice(input: QuickInvoiceInput): Promise<{
  error: string | null;
  invoiceId?: string;
}> {
  await assertRole([...OFFICE]);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const lines = input.lines.filter(
    (l) => l.description.trim() !== "" && n(l.quantity) > 0,
  );
  if (!lines.length) return { error: "Add at least one line." };

  // --- who it's for ---
  let customerId = input.customerId;
  if (!customerId) {
    const name = input.newCustomer?.full_name.trim();
    if (!name) return { error: "Pick a customer, or type a name for the walk-in." };
    const { data: created, error: custErr } = await supabase
      .from("customers")
      .insert({
        full_name: name,
        phone: input.newCustomer?.phone.trim() || null,
        email: input.newCustomer?.email.trim() || null,
        // A counter sale is already won — it never belongs in the lead pipeline.
        stage: "won",
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (custErr || !created) return { error: "Couldn't save the customer." };
    customerId = created.id as string;
  }

  // --- the invoice ---
  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      customer_id: customerId,
      number: await nextInvoiceNumber(supabase),
      issue_date: new Date().toISOString().slice(0, 10),
      status: "draft",
      tax_rate: n(input.taxRate),
      notes: input.notes.trim() || null,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error || !invoice) return { error: "Couldn't create the invoice." };

  const { error: itemErr } = await supabase.from("invoice_items").insert(
    lines.map((l, i) => ({
      invoice_id: invoice.id,
      position: i,
      description: l.description.trim(),
      quantity: n(l.quantity),
      unit: l.unit || "each",
      rate: n(l.rate),
    })),
  );
  if (itemErr) return { error: "Couldn't save the lines." };

  // --- money taken at the counter ---
  const paid = n(input.payment?.amount);
  if (input.payment && paid > 0) {
    await supabase.from("payments").insert({
      invoice_id: invoice.id,
      amount: paid,
      method: input.payment.method,
      reference: input.payment.reference.trim() || null,
      paid_at: new Date().toISOString(),
      created_by: user?.id ?? null,
    });
  }

  // Status follows the money, computed the same way the invoice screen does it
  // rather than guessed from whether a payment happened to be entered.
  const totals = invoiceTotals(
    lines.map((l) => ({ quantity: n(l.quantity), rate: n(l.rate) })),
    n(input.taxRate),
    paid,
  );
  await supabase
    .from("invoices")
    .update({
      status: totals.balance <= 0.005 ? "paid" : paid > 0 ? "partial" : "sent",
    })
    .eq("id", invoice.id);

  // --- stock ---
  if (input.pullFromStock) {
    for (const l of lines) {
      if (!l.productId) continue;
      const qty = n(l.quantity);
      if (qty <= 0) continue;
      const { data: prod } = await supabase
        .from("products")
        .select("on_hand, track_stock")
        .eq("id", l.productId)
        .maybeSingle();
      if (!prod?.track_stock) continue;
      await supabase
        .from("products")
        .update({
          on_hand: Number(prod.on_hand ?? 0) - qty,
          last_movement_at: new Date().toISOString(),
        })
        .eq("id", l.productId);
      await supabase.from("stock_movements").insert({
        product_id: l.productId,
        qty: -qty,
        kind: "pull",
        customer_id: customerId,
        note: `Counter sale — invoice ${invoice.id.slice(0, 8)}`,
        created_by: user?.id ?? null,
      });
    }
  }

  revalidatePath("/invoices");
  revalidatePath("/inventory");
  revalidatePath(`/customers/${customerId}`);
  return { error: null, invoiceId: invoice.id as string };
}
