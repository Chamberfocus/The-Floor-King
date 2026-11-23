"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  amountCredited,
  amountDeposited,
  amountPaid,
  amountWrittenOff,
  getInvoice,
} from "@/lib/data/invoices";
import { getOrgSettings } from "@/lib/data/org";
import { getCustomer } from "@/lib/data/customers";
import { effectiveInvoiceBalance } from "@/lib/credit-ar";
import { employeePaymentError } from "@/lib/payment-safety";
import { recomputeInvoiceStatus } from "@/lib/invoice-recompute";
import {
  achCompanyFromSettings,
  achPullRow,
  buildNachaDebitFile,
} from "@/lib/pnc-ach";
import type { UserRole } from "@/lib/types";

const PREPARE_ROLES: UserRole[] = ["admin", "office", "sales_manager", "salesman"];
const SETTLE_ROLES: UserRole[] = ["admin", "office"];

function str(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function prepareAchFile(
  formData: FormData,
): Promise<{ error: string } | { filename: string; file: string }> {
  const profile = await assertRole(PREPARE_ROLES);
  const invoiceId = str(formData.get("invoice_id"));
  const routing = str(formData.get("routing")).replace(/\D/g, "");
  const account = str(formData.get("account")).replace(/\D/g, "");
  const accountType = str(formData.get("account_type")) === "savings" ? "savings" : "checking";
  const holder = str(formData.get("holder"));
  const authorized = str(formData.get("authorized")) === "yes";
  const amount = Number(str(formData.get("amount")));
  if (!invoiceId || !authorized || !holder) {
    return { error: "Enter the name on the account and confirm the customer authorized the debit." };
  }

  const invoice = await getInvoice(invoiceId);
  if (!invoice || invoice.status === "void") return { error: "That invoice cannot be debited." };
  const customer = await getCustomer(invoice.customer_id);
  const due = effectiveInvoiceBalance({
    items: invoice.items ?? [],
    taxRate: invoice.tax_rate,
    amountPaid: amountPaid(invoice),
    appliedCredits: amountCredited(invoice),
    appliedDeposits: amountDeposited(invoice),
    appliedWriteOffs: amountWrittenOff(invoice),
  });
  if (!(amount > 0) || amount > due.amountDue + 0.005) {
    return { error: "The ACH amount has to be within the balance still owed." };
  }

  const org = await getOrgSettings();
  const company = achCompanyFromSettings(org);
  if (!company.ok) return { error: company.error };
  const row = achPullRow({
    invoiceId,
    customerId: invoice.customer_id,
    amount,
    routing,
    account,
    accountType,
    holder,
    createdBy: profile.id,
  });
  if (!row) return { error: "Check the routing number, account number, and amount." };
  const built = buildNachaDebitFile({
    company: company.company,
    createdAt: new Date(),
    entries: [
      {
        routing,
        account,
        accountType,
        amount,
        name: holder || customer?.full_name || "Customer",
        idNumber: invoice.number ?? invoiceId,
      },
    ],
  });
  if (!built.ok) return { error: built.error };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "The bank file could not be saved. Nothing was sent to PNC." };
  }
  await admin
    .from("ach_pulls")
    .update({ status: "cancelled" })
    .eq("invoice_id", invoiceId)
    .eq("status", "ready");
  const { error } = await admin.from("ach_pulls").insert(row);
  if (error) {
    return {
      error: /ach_pulls|schema cache/i.test(error.message)
        ? "ACH needs the new SQL (0515) applied in Supabase before a file can be saved."
        : "The ACH file could not be saved. Nothing was sent to the bank.",
    };
  }
  revalidatePath(`/invoices/${invoiceId}`);
  const safeNumber = (invoice.number ?? "invoice").replace(/[^\w.-]+/g, "-");
  return { filename: `pnc-ach-${safeNumber}.txt`, file: built.file };
}

export async function settleAchPull(formData: FormData): Promise<void> {
  const invoiceId = str(formData.get("invoice_id"));
  const pullId = str(formData.get("pull_id"));
  const fail = (message: string): never => {
    redirect(`/invoices/${invoiceId}?ach_error=${encodeURIComponent(message)}`);
  };
  await assertRole(SETTLE_ROLES);
  if (!invoiceId || !pullId) fail("Missing the ACH.");
  const supabase = await createClient();
  const { data: pull } = await supabase
    .from("ach_pulls")
    .select("id, amount, status, account_last4, invoice_id")
    .eq("id", pullId)
    .maybeSingle();
  if (!pull || pull.invoice_id !== invoiceId) {
    redirect(`/invoices/${invoiceId}?ach_error=${encodeURIComponent("That ACH is not on this invoice.")}`);
    return;
  }
  if (pull.status === "settled") {
    redirect(`/invoices/${invoiceId}?ach_notice=${encodeURIComponent("This ACH was already settled.")}`);
    return;
  }
  if (pull.status !== "ready") {
    redirect(`/invoices/${invoiceId}?ach_error=${encodeURIComponent("Only a file that is still waiting can be marked settled.")}`);
    return;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase.rpc("record_invoice_payment_safe", {
    p_invoice_id: invoiceId,
    p_amount: Number(pull.amount),
    p_method: "echeck",
    p_reference: `PNC ${pull.account_last4}`,
    p_paid_at: today(),
    p_notes: "PNC showed this ACH deposit.",
    p_created_by: user?.id ?? null,
    p_idempotency_key: `ach-pull:${pullId}`,
    p_allow_deposit_on_zero_total: false,
  });
  if (error) fail(employeePaymentError(error.message));
  const res = data as { ok?: boolean; error?: string; payment_id?: string } | null;
  if (!res?.ok) fail(employeePaymentError(res?.error));

  await supabase
    .from("ach_pulls")
    .update({
      status: "settled",
      payment_id: res?.payment_id ?? null,
      settled_at: new Date().toISOString(),
    })
    .eq("id", pullId)
    .eq("status", "ready");
  await recomputeInvoiceStatus(supabase, invoiceId, user?.id ?? null);
  try {
    const { afterFinancialEventAccounting } = await import("@/lib/data/accounting-integration");
    if (res?.payment_id) {
      await afterFinancialEventAccounting({
        kind: "payment",
        sourceType: "payment",
        sourceId: res.payment_id,
        entryDate: today(),
        reviewRequired: false,
        userId: user?.id ?? null,
      });
    }
  } catch {
    /* The payment is recorded even when the ledger tables are not applied yet. */
  }
  revalidatePath(`/invoices/${invoiceId}`);
  redirect(`/invoices/${invoiceId}?ach_notice=${encodeURIComponent("The PNC deposit is on this invoice.")}`);
}

export async function cancelAchPull(formData: FormData): Promise<void> {
  const invoiceId = str(formData.get("invoice_id"));
  const pullId = str(formData.get("pull_id"));
  await assertRole(SETTLE_ROLES);
  const supabase = await createClient();
  await supabase
    .from("ach_pulls")
    .update({ status: "cancelled" })
    .eq("id", pullId)
    .eq("invoice_id", invoiceId)
    .eq("status", "ready");
  revalidatePath(`/invoices/${invoiceId}`);
  redirect(`/invoices/${invoiceId}?ach_notice=${encodeURIComponent("That ACH file was cancelled. Do not upload it.")}`);
}
