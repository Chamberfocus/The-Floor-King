"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";
import { finalizeInvoiceSafe } from "@/lib/invoice-issue";
import { applyEligibleDepositsToInvoice } from "@/lib/data/apply-customer-deposits";

export interface CounterSaleLine {
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  productId?: string | null;
}

export interface CounterSaleInput {
  /** An existing customer, or the details to create one. */
  customerId?: string | null;
  newCustomer?: {
    fullName: string;
    phone?: string;
    email?: string;
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  } | null;
  marketingOptIn: boolean;
  lines: CounterSaleLine[];
  taxRatePct: number;
  payment: { method: string; amount: number; reference?: string };
}

/**
 * Ring up a walk-in.
 *
 * One action, because a counter sale is one event: the customer, what they took,
 * and the money — recorded together or not at all. Half of it landing (a
 * customer with no sale, or a sale with no payment) is worse than none of it.
 *
 * It becomes a normal invoice marked `counter_sale`, paid in full at the moment
 * it's raised, so it flows into the books, the customer's history and the
 * financials with nothing special to maintain.
 */
export async function ringUpCounterSale(
  input: CounterSaleInput,
): Promise<{ error: string | null; invoiceId?: string }> {
  await assertRole(["admin", "office", "sales_manager", "salesman"]);

  const lines = (input.lines ?? []).filter(
    (l) => l.description?.trim() && l.quantity > 0,
  );
  if (!lines.length) return { error: "Add at least one product." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 1 · Who bought it.
  let customerId = input.customerId || null;
  if (!customerId) {
    const nc = input.newCustomer;
    if (!nc?.fullName?.trim()) return { error: "Enter the customer's name." };
    const { data: created, error } = await supabase
      .from("customers")
      .insert({
        full_name: nc.fullName.trim(),
        phone: nc.phone?.trim() || null,
        email: nc.email?.trim() || null,
        street: nc.street?.trim() || null,
        city: nc.city?.trim() || null,
        state: nc.state?.trim() || null,
        zip: nc.zip?.trim() || null,
        marketing_opt_in: input.marketingOptIn,
        marketing_opt_in_at: input.marketingOptIn ? new Date().toISOString() : null,
        created_by: user?.id ?? null,
        assigned_to: user?.id ?? null,
      })
      .select("id")
      .single();
    if (error || !created) {
      return { error: error?.message || "Couldn't save the customer." };
    }
    customerId = created.id as string;
  } else if (input.marketingOptIn) {
    // Only ever turned ON here. Unticking it at the counter shouldn't silently
    // revoke a consent they gave somewhere else.
    await supabase
      .from("customers")
      .update({
        marketing_opt_in: true,
        marketing_opt_in_at: new Date().toISOString(),
      })
      .eq("id", customerId)
      .eq("marketing_opt_in", false);
  }

  // 2 · The next invoice number, from the highest one that exists — not the row
  //     count, which reuses a number the moment anything is deleted.
  const { data: nums } = await supabase.from("invoices").select("number").limit(10000);
  let next = 1000;
  for (const r of nums ?? []) {
    const m = /(\d+)\s*$/.exec((r.number as string | null) ?? "");
    if (m) next = Math.max(next, parseInt(m[1], 10) + 1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .insert({
      customer_id: customerId,
      number: `INV-${next}`,
      status: "draft",
      issue_date: today,
      due_date: today,
      tax_rate: input.taxRatePct || 0,
      counter_sale: true,
      terms: "Paid in full at the counter.",
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (invErr || !inv) return { error: invErr?.message || "Couldn't create the receipt." };

  const { error: itemErr } = await supabase.from("invoice_items").insert(
    lines.map((l, i) => ({
      invoice_id: inv.id,
      position: i,
      description: l.description.trim(),
      quantity: l.quantity,
      unit: l.unit || "each",
      rate: l.rate,
    })),
  );
  if (itemErr) return { error: itemErr.message };

  // Canonical issue path (draft → finalize) so invoice accounting cannot be bypassed.
  const fin = await finalizeInvoiceSafe(supabase, inv.id as string, user?.id ?? null);
  if (!fin.ok) {
    return { error: fin.error || "Couldn't finalize the counter-sale invoice." };
  }

  await applyEligibleDepositsToInvoice(supabase, {
    invoiceId: inv.id as string,
    createdBy: user?.id ?? null,
    appliedOn: today,
  });

  // 3 · The money — atomic overpay-safe insert (migration 0158).
  const amount = Number(input.payment?.amount) || 0;
  if (amount > 0) {
    const paidAt = new Date().toISOString().slice(0, 10);
    const { data: payRes, error: payErr } = await supabase.rpc(
      "record_invoice_payment_safe",
      {
        p_invoice_id: inv.id,
        p_amount: amount,
        p_method: input.payment.method || "cash",
        p_reference: input.payment.reference?.trim() || null,
        p_paid_at: paidAt,
        p_notes: null,
        p_created_by: user?.id ?? null,
        p_idempotency_key: `counter:${inv.id}:${amount}:${paidAt}`,
        p_allow_deposit_on_zero_total: false,
      },
    );
    if (payErr || !(payRes as { ok?: boolean })?.ok) {
      return {
        error: `Sale saved but the payment didn't record: ${
          payErr?.message ||
          (payRes as { error?: string })?.error ||
          "unknown error"
        }`,
      };
    }
    // sent → paid is allowed after finalize (already issued).
    await supabase.from("invoices").update({ status: "paid" }).eq("id", inv.id);
  }

  revalidatePath("/invoices");
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/financials");
  return { error: null, invoiceId: inv.id as string };
}

/** Find a walk-in who's been in before, so their details aren't retyped. */
export async function findWalkIn(
  query: string,
): Promise<{ id: string; name: string; phone: string | null; city: string | null }[]> {
  await assertRole(["admin", "office", "sales_manager", "salesman"]);
  const q = (query ?? "").trim();
  if (!q) return [];
  const supabase = await createClient();
  const like = `%${q.replace(/[%,]/g, "")}%`;
  const { data } = await supabase
    .from("customers")
    .select("id, full_name, phone, city")
    .or(`full_name.ilike.${like},phone.ilike.${like},email.ilike.${like}`)
    .is("cancelled_at", null)
    .limit(8);
  return (data ?? []).map((c) => ({
    id: c.id as string,
    name: c.full_name as string,
    phone: (c.phone as string) ?? null,
    city: (c.city as string) ?? null,
  }));
}
