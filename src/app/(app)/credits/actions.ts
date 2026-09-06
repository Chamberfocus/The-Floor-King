"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";
import type { PaymentMethod, UserRole } from "@/lib/types";
import {
  listCreditMemosForCustomer,
  memoAvailable,
} from "@/lib/data/credits";
import { ensureInvoiceIssued } from "@/lib/invoice-issue";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function toNumOrNull(s: string): number | null {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const CREDIT_MUTATE_ROLES: UserRole[] = ["admin", "office"];
const REFUND_MUTATE_ROLES: UserRole[] = ["admin", "office"];

function refreshCreditViews(customerId: string, invoiceId?: string | null) {
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/invoices");
  revalidatePath("/financials");
  revalidatePath("/pulse");
  if (invoiceId) revalidatePath(`/invoices/${invoiceId}`);
}

/**
 * Apply available credit on a memo to a specific invoice (same customer/job).
 */
export async function applyCreditToInvoice(formData: FormData): Promise<void> {
  const memoId = str(formData.get("credit_memo_id"));
  const invoiceId = str(formData.get("invoice_id"));
  const amount = toNumOrNull(str(formData.get("amount")));
  const customerId = str(formData.get("customer_id"));
  const fail = (msg: string): never => {
    redirect(
      customerId
        ? `/customers/${customerId}?credit_error=${encodeURIComponent(msg)}`
        : `/invoices/${invoiceId}?payment_error=${encodeURIComponent(msg)}`,
    );
  };
  if (!memoId || !invoiceId) fail("Missing credit or invoice.");
  if (amount === null) {
    fail("Enter a credit amount to apply.");
    return;
  }

  await assertRole(CREDIT_MUTATE_ROLES);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const idem =
    str(formData.get("idempotency_key")) ||
    `apply:${memoId}:${invoiceId}:${amount}:${user?.id ?? ""}`;

  const { data, error } = await supabase.rpc("apply_credit_to_invoice_safe", {
    p_credit_memo_id: memoId,
    p_invoice_id: invoiceId,
    p_amount: amount,
    p_created_by: user?.id ?? null,
    p_idempotency_key: idem,
  });
  if (error) {
    fail(
      error.message.includes("apply_credit_to_invoice_safe")
        ? "Credit migration (0159) is not applied yet. Apply it in Supabase before using credits."
        : error.message,
    );
  }
  const res = data as { ok?: boolean; error?: string };
  if (!res?.ok) fail(res?.error ?? "Could not apply credit.");

  // Recompute invoice status from payments + credits (same rule as invoices/actions).
  const { data: invRow } = await supabase
    .from("invoices")
    .select("tax_rate, status, customer_id, job_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invRow && invRow.status !== "void") {
    const [{ data: items }, { data: pays }, { data: apps }] = await Promise.all([
      supabase
        .from("invoice_items")
        .select("quantity, rate")
        .eq("invoice_id", invoiceId),
      supabase
        .from("payments")
        .select("amount, status")
        .eq("invoice_id", invoiceId),
      supabase
        .from("credit_applications")
        .select("amount, status")
        .eq("invoice_id", invoiceId),
    ]);
    const paid = (pays ?? [])
      .filter((p) => ((p.status as string) ?? "active") !== "void")
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const credited = (apps ?? [])
      .filter((a) => ((a.status as string) ?? "active") !== "void")
      .reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const { invoiceTotals } = await import("@/lib/invoice-calc");
    const { total } = invoiceTotals(
      (items ?? []) as { quantity: number | null; rate: number | null }[],
      invRow.tax_rate as number,
      0,
    );
    const covered = paid + credited;
    let status = invRow.status as string;
    if (total > 0 && covered >= total - 0.005) status = "paid";
    else if (paid > 0 || credited > 0) status = "partial";
    else if (status === "paid" || status === "partial") status = "sent";
    if (status !== invRow.status) {
      const {
        data: { user: actor },
      } = await supabase.auth.getUser();
      const ensured = await ensureInvoiceIssued(supabase, {
        invoiceId,
        currentStatus: invRow.status as string,
        targetStatus: status,
        actorId: actor?.id ?? null,
      });
      if (ensured.ok) {
        const { data: after } = await supabase
          .from("invoices")
          .select("status")
          .eq("id", invoiceId)
          .maybeSingle();
        if ((after?.status as string) !== status) {
          await supabase.from("invoices").update({ status }).eq("id", invoiceId);
        }
      }
    }
  }

  refreshCreditViews(
    (invRow?.customer_id as string) || customerId,
    invoiceId,
  );
  if (invRow?.job_id) revalidatePath(`/jobs/${invRow.job_id}`);
}

/** Record a cash refund against available (unapplied) credit. */
export async function recordRefund(formData: FormData): Promise<void> {
  const memoId = str(formData.get("credit_memo_id"));
  const customerId = str(formData.get("customer_id"));
  const amount = toNumOrNull(str(formData.get("amount")));
  const method = (str(formData.get("method")) || "other") as PaymentMethod;
  const fail = (msg: string): never => {
    redirect(
      `/customers/${customerId || ""}?credit_error=${encodeURIComponent(msg)}`,
    );
  };
  if (!memoId || !customerId) fail("Missing credit or customer.");
  if (amount === null) {
    fail("Enter a refund amount.");
    return;
  }

  await assertRole(REFUND_MUTATE_ROLES);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const idem =
    str(formData.get("idempotency_key")) ||
    `refund:${memoId}:${amount}:${today()}:${user?.id ?? ""}`;

  const { data, error } = await supabase.rpc("record_refund_safe", {
    p_credit_memo_id: memoId,
    p_amount: amount,
    p_method: method,
    p_reference: str(formData.get("reference")) || null,
    p_refunded_at: str(formData.get("refunded_at")) || today(),
    p_notes: str(formData.get("notes")) || null,
    p_created_by: user?.id ?? null,
    p_idempotency_key: idem,
  });
  if (error) {
    fail(
      error.message.includes("record_refund_safe")
        ? "Credit migration (0159) is not applied yet."
        : error.message,
    );
  }
  const res = data as { ok?: boolean; error?: string };
  if (!res?.ok) fail(res?.error ?? "Could not record refund.");

  refreshCreditViews(customerId);
  redirect(
    `/customers/${customerId}?credit_ok=${encodeURIComponent("Refund recorded.")}`,
  );
}

/** Void a credit memo (no hard-delete). Only when nothing applied/refunded. */
export async function voidCreditMemo(formData: FormData): Promise<void> {
  const memoId = str(formData.get("credit_memo_id"));
  const customerId = str(formData.get("customer_id"));
  const reason = str(formData.get("void_reason")) || "Voided by staff";
  const fail = (msg: string): never => {
    redirect(
      `/customers/${customerId || ""}?credit_error=${encodeURIComponent(msg)}`,
    );
  };
  if (!memoId) fail("Missing credit.");

  await assertRole(CREDIT_MUTATE_ROLES);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: row } = await supabase
    .from("credit_memos")
    .select("*")
    .eq("id", memoId)
    .maybeSingle();
  if (!row) fail("Credit not found.");
  if ((row.status as string) === "void") {
    refreshCreditViews((row.customer_id as string) || customerId);
    return;
  }

  const full = (
    await listCreditMemosForCustomer(row.customer_id as string)
  ).find((m) => m.id === memoId);
  const available = full ? memoAvailable(full) : Number(row.amount) || 0;
  const issued = Number(row.amount) || 0;
  if (Math.abs(available - issued) > 0.005) {
    fail(
      "This credit has applications or refunds on file. Void those first, or leave the credit as history.",
    );
  }

  const { data: voidRes, error: voidRpcErr } = await supabase.rpc(
    "void_credit_memo_safe",
    {
      p_memo_id: memoId,
      p_voided_by: user?.id ?? null,
      p_void_reason: reason,
    },
  );
  if (voidRpcErr) {
    if (voidRpcErr.message.includes("void_credit_memo_safe")) {
      const { error } = await supabase
        .from("credit_memos")
        .update({
          status: "void",
          voided_at: new Date().toISOString(),
          voided_by: user?.id ?? null,
          void_reason: reason,
        })
        .eq("id", memoId);
      if (error) fail(error.message);
    } else {
      fail(voidRpcErr.message);
    }
  } else {
    const res = voidRes as { ok?: boolean; error?: string };
    if (!res?.ok) fail(res?.error ?? "Could not void credit.");
  }

  refreshCreditViews((row.customer_id as string) || customerId);
}

/** Void a refund — restores available credit. */
export async function voidRefund(formData: FormData): Promise<void> {
  const refundId = str(formData.get("refund_id"));
  const customerId = str(formData.get("customer_id"));
  const reason = str(formData.get("void_reason")) || "Voided by staff";
  const fail = (msg: string): never => {
    redirect(
      `/customers/${customerId || ""}?credit_error=${encodeURIComponent(msg)}`,
    );
  };
  if (!refundId) fail("Missing refund.");

  await assertRole(REFUND_MUTATE_ROLES);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: row } = await supabase
    .from("refunds")
    .select("*")
    .eq("id", refundId)
    .maybeSingle();
  if (!row) fail("Refund not found.");
  if ((row.status as string) === "void") {
    refreshCreditViews((row.customer_id as string) || customerId);
    return;
  }

  const { data: voidRes, error: voidRpcErr } = await supabase.rpc(
    "void_refund_safe",
    {
      p_refund_id: refundId,
      p_voided_by: user?.id ?? null,
      p_void_reason: reason,
    },
  );
  if (voidRpcErr) {
    if (voidRpcErr.message.includes("void_refund_safe")) {
      const { error } = await supabase
        .from("refunds")
        .update({
          status: "void",
          voided_at: new Date().toISOString(),
          voided_by: user?.id ?? null,
          void_reason: reason,
        })
        .eq("id", refundId);
      if (error) fail(error.message);
    } else {
      fail(voidRpcErr.message);
    }
  } else {
    const res = voidRes as { ok?: boolean; error?: string };
    if (!res?.ok) fail(res?.error ?? "Could not void refund.");
  }

  refreshCreditViews((row.customer_id as string) || customerId);
}

/** @deprecated Hard-delete is not part of production workflow. */
export async function deleteCreditMemo(formData: FormData): Promise<void> {
  await voidCreditMemo(formData);
}
