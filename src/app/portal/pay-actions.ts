"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { getInvoice, invoiceDisplayTotals } from "@/lib/data/invoices";
import { getPortalEstimate, getPortalOrgSettings } from "@/lib/data/portal-commercial";
import { optionTotalsWithDiscount } from "@/lib/estimate-calc";
import { invoicePayAllowed, quoteDepositAllowed } from "@/lib/portal-pay";
import { employeePaymentError } from "@/lib/payment-safety";
import { recomputeInvoiceStatus } from "@/lib/invoice-recompute";
import { advanceFromAutoAction } from "@/lib/workflow-engine";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const VOIDED_RECORD =
  "That payment was voided. Refresh the page and record it again.";

async function voidedRecord(
  admin: ReturnType<typeof createAdminClient>,
  table: "payments" | "customer_deposits",
  id: string,
): Promise<boolean> {
  const { data } = await admin.from(table).select("status").eq("id", id).maybeSingle();
  return (data?.status as string | null) === "void";
}

async function customerOrError(): Promise<
  { id: string; customerId: string } | { error: string }
> {
  const profile = await requireProfile();
  if (profile.role !== "customer" || !profile.customer_id) {
    return { error: "Open this from your account." };
  }
  return { id: profile.id, customerId: profile.customer_id };
}

/** Customer pays the exact balance on their invoice. Card data stays at the processor. */
export async function portalPayInvoice(
  formData: FormData,
): Promise<{ error: string | null }> {
  const who = await customerOrError();
  if ("error" in who) return { error: who.error };
  const invoiceId = str(formData.get("invoice_id"));
  const clientKey = str(formData.get("idempotency_key")).slice(0, 80);
  if (!invoiceId || !clientKey) return { error: "Refresh and try again." };

  const org = await getPortalOrgSettings();
  if (!org.card_processing_url) {
    return { error: "Card payments are not turned on yet. Call the store." };
  }

  const invoice = await getInvoice(invoiceId);
  if (!invoice || invoice.customer_id !== who.customerId || invoice.status === "void") {
    return { error: "That invoice is not on your account." };
  }
  const due = invoicePayAllowed(invoiceDisplayTotals(invoice).balance);
  if (!due.ok) return { error: due.error };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("record_invoice_payment_safe", {
    p_invoice_id: invoiceId,
    p_amount: due.amount,
    p_method: "card",
    p_reference: invoice.number,
    p_paid_at: today(),
    p_notes: "Paid from the customer link",
    p_created_by: who.id,
    p_idempotency_key: `portal-invoice:${invoiceId}:${clientKey}`,
    p_allow_deposit_on_zero_total: false,
  });
  if (error) return { error: employeePaymentError(error.message) };
  const res = data as { ok?: boolean; error?: string; duplicate?: boolean; payment_id?: string } | null;
  if (!res?.ok) return { error: employeePaymentError(res?.error) };
  if (res.duplicate && res.payment_id && (await voidedRecord(admin, "payments", res.payment_id))) {
    return { error: VOIDED_RECORD };
  }

  await recomputeInvoiceStatus(admin, invoiceId, who.id);
  await advanceFromAutoAction(who.customerId, "collect_deposit").catch(() => {});
  revalidatePath(`/portal/invoices/${invoiceId}`);
  revalidatePath("/portal");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath(`/customers/${who.customerId}`);
  return { error: null };
}

/** Customer pays a deposit on an approved quote, up to what is still uncovered. */
export async function portalPayQuote(
  formData: FormData,
): Promise<{ error: string | null }> {
  const who = await customerOrError();
  if ("error" in who) return { error: who.error };
  const estimateId = str(formData.get("estimate_id"));
  const key = str(formData.get("idempotency_key")).slice(0, 80);
  if (!estimateId || !key) return { error: "Refresh and try again." };

  const org = await getPortalOrgSettings();
  if (!org.card_processing_url) {
    return { error: "Card payments are not turned on yet. Call the store." };
  }

  const estimate = await getPortalEstimate(estimateId);
  if (!estimate || estimate.customer_id !== who.customerId || estimate.status !== "approved") {
    return { error: "That quote is not ready to pay." };
  }
  const chosen =
    estimate.options?.find((option) => option.id === estimate.accepted_option_id) ??
    estimate.options?.[0] ??
    null;
  if (!chosen) return { error: "That quote has no price yet." };
  const total = optionTotalsWithDiscount(
    chosen.line_items ?? [],
    estimate.tax_rate,
    estimate.discount_kind,
    estimate.discount_value,
  ).total;

  const admin = createAdminClient();
  const { data: deposits } = await admin
    .from("customer_deposits")
    .select("amount, status")
    .eq("customer_id", who.customerId)
    .eq("estimate_id", estimateId);
  const already = (deposits ?? [])
    .filter((row) => (row.status as string) !== "void")
    .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const allowed = quoteDepositAllowed(
    parseFloat(str(formData.get("amount"))),
    total,
    already,
  );
  if (!allowed.ok) return { error: allowed.error };

  const { data: job } = await admin
    .from("jobs")
    .select("id")
    .eq("estimate_id", estimateId)
    .eq("customer_id", who.customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await admin.rpc("record_customer_deposit_safe", {
    p_customer_id: who.customerId,
    p_amount: allowed.amount,
    p_received_on: today(),
    p_method: "card",
    p_classification: "pre_invoice_deposit",
    p_job_id: (job?.id as string | null) ?? null,
    p_estimate_id: estimateId,
    p_notes: "Paid from the customer link",
    p_created_by: who.id,
    p_idempotency_key: `portal-deposit:${estimateId}:${key}`,
  });
  if (error) return { error: employeePaymentError(error.message) };
  const res = data as { ok?: boolean; error?: string; duplicate?: boolean; deposit_id?: string } | null;
  if (!res?.ok) return { error: employeePaymentError(res?.error) };
  if (res.duplicate && res.deposit_id && (await voidedRecord(admin, "customer_deposits", res.deposit_id))) {
    return { error: VOIDED_RECORD };
  }

  await advanceFromAutoAction(who.customerId, "collect_deposit").catch(() => {});
  revalidatePath(`/portal/estimates/${estimateId}`);
  revalidatePath("/portal");
  revalidatePath(`/customers/${who.customerId}`);
  return { error: null };
}
