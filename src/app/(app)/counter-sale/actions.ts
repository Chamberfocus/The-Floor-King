"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";
import { finalizeInvoiceSafe } from "@/lib/invoice-issue";
import { applyEligibleDepositsToInvoice } from "@/lib/data/apply-customer-deposits";
import { resolveOrCreateCustomer, followActiveCustomerId } from "@/lib/data/customer-resolve";
import type { ScoredCustomerMatch } from "@/lib/customer-resolve";
import {
  BLANK_INVOICE_TOKEN_USED_MESSAGE,
  COUNTER_SALE_IDEMPOTENCY_REQUIRED_MESSAGE,
  resolveCounterSaleIdempotencyKey,
} from "@/lib/financial-idempotency";

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
  useExistingId?: string | null;
  forceCreate?: boolean;
  overrideReason?: string | null;
  marketingOptIn: boolean;
  lines: CounterSaleLine[];
  taxRatePct: number;
  payment: { method: string; amount: number; reference?: string };
  /** Stable for one form mount. A new mount is a new sale. */
  idempotencyKey?: string | null;
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
): Promise<{ error: string | null; invoiceId?: string; matches?: ScoredCustomerMatch[] }> {
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
    const resolved = await resolveOrCreateCustomer({
      input: {
        fullName: nc.fullName.trim(),
        phone: nc.phone?.trim() || null,
        email: nc.email?.trim() || null,
        address: nc.street?.trim() || null,
        city: nc.city?.trim() || null,
        state: nc.state?.trim() || null,
        zip: nc.zip?.trim() || null,
      },
      insert: {
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
      },
      useExistingId: input.useExistingId,
      forceCreate: input.forceCreate,
      overrideReason: input.overrideReason,
    });
    if (resolved.action === "needs_choice") {
      return { error: null, matches: resolved.matches };
    }
    if (resolved.action === "error") {
      return { error: resolved.error };
    }
    customerId = resolved.customerId;
  }

  const liveId = await followActiveCustomerId(supabase, customerId ?? "");
  if (!liveId) return { error: "That customer is not available." };
  customerId = liveId;

  if (input.marketingOptIn) {
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

  const idempotencyKey = resolveCounterSaleIdempotencyKey(
    input.idempotencyKey,
    user?.id,
  );
  if (!idempotencyKey) return { error: COUNTER_SALE_IDEMPOTENCY_REQUIRED_MESSAGE };

  const { data: prior } = await supabase
    .from("invoices")
    .select("id, customer_id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (prior?.id && prior.customer_id !== customerId) {
    return { error: BLANK_INVOICE_TOKEN_USED_MESSAGE };
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
  let invoiceId = (prior?.id as string | undefined) ?? null;
  let createdNow = false;
  if (!invoiceId) {
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
        idempotency_key: idempotencyKey,
      })
      .select("id")
      .single();
    if (invErr || !inv) {
      const duplicate =
        invErr?.code === "23505" || /duplicate key/i.test(invErr?.message ?? "");
      if (duplicate) {
        const { data: existing } = await supabase
          .from("invoices")
          .select("id, customer_id")
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();
        if (existing?.id && existing.customer_id === customerId) {
          invoiceId = existing.id as string;
        } else {
          return { error: BLANK_INVOICE_TOKEN_USED_MESSAGE };
        }
      } else {
        return { error: "Couldn't create the receipt." };
      }
    } else {
      invoiceId = inv.id as string;
      createdNow = true;
    }
  }
  if (!invoiceId) return { error: "Couldn't create the receipt." };

  if (createdNow) {
    const { error: itemErr } = await supabase.from("invoice_items").insert(
      lines.map((l, i) => ({
        invoice_id: invoiceId,
        position: i,
        description: l.description.trim(),
        quantity: l.quantity,
        unit: l.unit || "",
        rate: l.rate,
      })),
    );
    if (itemErr) return { error: "Couldn't save the sale lines." };
  }

  const fin = await finalizeInvoiceSafe(supabase, invoiceId, user?.id ?? null);
  if (!fin.ok && createdNow) {
    return { error: "Couldn't finalize the counter-sale invoice." };
  }

  await applyEligibleDepositsToInvoice(supabase, {
    invoiceId,
    createdBy: user?.id ?? null,
    appliedOn: today,
  });

  const amount = Number(input.payment?.amount) || 0;
  if (amount > 0) {
    const paidAt = new Date().toISOString().slice(0, 10);
    const { data: payRes, error: payErr } = await supabase.rpc(
      "record_invoice_payment_safe",
      {
        p_invoice_id: invoiceId,
        p_amount: amount,
        p_method: input.payment.method || "cash",
        p_reference: input.payment.reference?.trim() || null,
        p_paid_at: paidAt,
        p_notes: null,
        p_created_by: user?.id ?? null,
        p_idempotency_key: `counter-pay:${idempotencyKey}`,
        p_allow_deposit_on_zero_total: false,
      },
    );
    const payOk = (payRes as { ok?: boolean })?.ok;
    if (payErr || !payOk) {
      return {
        error: "Sale saved but the payment didn't record. Open the receipt and record it once.",
      };
    }
    await supabase.from("invoices").update({ status: "paid" }).eq("id", invoiceId);
  }

  revalidatePath("/invoices");
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/financials");
  return { error: null, invoiceId };
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
