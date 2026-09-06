"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  invoiceTotals,
  type SaveInvoiceInput,
} from "@/lib/invoice-calc";
import { sendEmail, emailLayout, siteUrl } from "@/lib/notify";
import { advanceFromAutoAction } from "@/lib/workflow-engine";
import { getCurrentApprovalSnapshot } from "@/lib/data/estimate-approvals";
import { assessInvoiceCommercialGate } from "@/lib/estimate-approval";
import { buildInvoiceItemsFromApprovalSnapshot } from "@/lib/invoice-from-approval";
import {
  invoiceCommercialEditBlocked,
  invoiceCoverageTotal,
  planEstimateInvoiceCreation,
  supplementalDeltaInvoiceItems,
  type CoverageInvoiceRow,
  type InvoiceCommercialKind,
} from "@/lib/change-order-invoice";
import { commercialCreditsTotalForEstimate } from "@/lib/data/credits";
import { assertRole } from "@/lib/auth";
import {
  ensureInvoiceIssued,
  finalizeInvoiceSafe,
  voidInvoiceSafe,
} from "@/lib/invoice-issue";
import type {
  InvoiceStatus,
  PaymentMethod,
  UserRole,
} from "@/lib/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** Roles that may record customer invoice payments (not exported — "use server" constraint). */
const INVOICE_PAYMENT_ROLES: UserRole[] = [
  "admin",
  "office",
  "sales_manager",
  "salesman",
];

/** Roles that may void payments (audit-sensitive). */
const INVOICE_PAYMENT_VOID_ROLES: UserRole[] = ["admin", "office"];

/** Money changed → refresh every view that reports on money. */
/** Refresh the customer file and the linked job page (which show the invoice's
 *  balance / "collect balance") after an invoice/payment change. */
async function revalidateInvoiceLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  invoiceId: string,
) {
  const { data: inv } = await supabase
    .from("invoices")
    .select("customer_id, job_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (inv?.customer_id) revalidatePath(`/customers/${inv.customer_id}`);
  if (inv?.job_id) revalidatePath(`/jobs/${inv.job_id}`);
}

function refreshMoneyViews() {
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  revalidatePath("/pulse");
  revalidatePath("/financials");
  revalidatePath("/reports");
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function toNumOrNull(v: string | number | null): number | null {
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The job an estimate's invoice belongs to.
 *
 * invoices.job_id was written by exactly one path (the cash-and-carry order
 * flow), so every invoice raised from an estimate had it NULL — and everything
 * keyed off it was silently dead: getJobOpenBalance returned zero, so the
 * installer's on-site "collect the balance" button could never fire; the job's
 * Documents tab showed no invoice; the customer file couldn't match an invoice
 * to its job.
 *
 * Best-effort by design: a missing link must never block raising the invoice.
 */
async function jobIdForEstimate(
  supabase: SupabaseServerClient,
  estimateId: string,
  optionId?: string | null,
): Promise<string | null> {
  const { data } = await supabase
    .from("jobs")
    .select("id, option_id, status, created_at")
    .eq("estimate_id", estimateId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true });
  const jobs = data ?? [];
  if (!jobs.length) return null;
  // With multiple options sold, bill against the job for THIS option.
  const exact = optionId ? jobs.find((j) => j.option_id === optionId) : null;
  return ((exact ?? jobs[0]).id as string) ?? null;
}

async function nextInvoiceNumber(supabase: SupabaseServerClient): Promise<string> {
  // Base the next number on the HIGHEST existing "INV-####", not the row count —
  // counting breaks when an invoice is deleted (the count drops and the next
  // number reuses a live one). Scan the current numbers and take max + 1.
  const { data } = await supabase.from("invoices").select("number").limit(10000);
  let max = 1000;
  for (const r of data ?? []) {
    const m = /(\d+)\s*$/.exec((r.number as string | null) ?? "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `INV-${max + 1}`;
}

/** Recompute paid/partial status from items + *active* payments + *active* credits. */
async function recomputeStatus(
  supabase: SupabaseServerClient,
  invoiceId: string,
) {
  const { data: inv } = await supabase
    .from("invoices")
    .select("tax_rate, status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv || inv.status === "void") return;

  const { data: items } = await supabase
    .from("invoice_items")
    .select("quantity, rate")
    .eq("invoice_id", invoiceId);
  const { data: pays } = await supabase
    .from("payments")
    .select("amount, status")
    .eq("invoice_id", invoiceId);
  let credited = 0;
  try {
    const { data: apps } = await supabase
      .from("credit_applications")
      .select("amount, status")
      .eq("invoice_id", invoiceId);
    credited = (apps ?? [])
      .filter((a) => ((a.status as string) ?? "active") !== "void")
      .reduce((s, a) => s + (Number(a.amount) || 0), 0);
  } catch {
    credited = 0;
  }

  const paid = (pays ?? [])
    .filter((p) => ((p.status as string) ?? "active") !== "void")
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const { total } = invoiceTotals(
    (items ?? []) as { quantity: number | null; rate: number | null }[],
    inv.tax_rate as number,
    0,
  );

  const covered = paid + credited;
  let status = inv.status as InvoiceStatus;
  if (total > 0 && covered >= total - 0.005) status = "paid";
  else if (paid > 0 || credited > 0) status = "partial";
  else if (status === "paid" || status === "partial") status = "sent";

  if (status === inv.status) return;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ensured = await ensureInvoiceIssued(supabase, {
    invoiceId,
    currentStatus: inv.status as string,
    targetStatus: status,
    actorId: user?.id ?? null,
  });
  if (!ensured.ok) return;

  // After finalize, draft→sent already applied; still move to partial/paid if needed.
  const { data: after } = await supabase
    .from("invoices")
    .select("status")
    .eq("id", invoiceId)
    .maybeSingle();
  if ((after?.status as string) === status) return;
  await supabase.from("invoices").update({ status }).eq("id", invoiceId);
}

type RpcPaymentResult = {
  ok?: boolean;
  error?: string;
  payment_id?: string;
  duplicate?: boolean;
};

type RpcDepositResult = {
  ok?: boolean;
  error?: string;
  deposit_id?: string;
  duplicate?: boolean;
};

async function rpcRecordCustomerDeposit(
  supabase: SupabaseServerClient,
  args: {
    customerId: string;
    amount: number;
    method: PaymentMethod;
    receivedOn: string;
    notes: string | null;
    createdBy: string | null;
    idempotencyKey: string | null;
  },
): Promise<{
  error: string | null;
  duplicate?: boolean;
  depositId?: string;
}> {
  const { data, error } = await supabase.rpc("record_customer_deposit_safe", {
    p_customer_id: args.customerId,
    p_amount: args.amount,
    p_received_on: args.receivedOn,
    p_method: args.method,
    p_classification: "pre_invoice_deposit",
    p_notes: args.notes,
    p_created_by: args.createdBy,
    p_idempotency_key: args.idempotencyKey,
  });
  if (error) {
    return {
      error:
        error.message.includes("record_customer_deposit_safe")
          ? "Customer deposit migration (0167) is not applied yet. Apply it in Supabase before recording deposits."
          : error.message,
    };
  }
  const res = data as RpcDepositResult;
  if (!res?.ok) return { error: res?.error ?? "Could not record deposit." };
  return {
    error: null,
    duplicate: Boolean(res.duplicate),
    depositId: res.deposit_id,
  };
}

async function rpcRecordPayment(
  supabase: SupabaseServerClient,
  args: {
    invoiceId: string;
    amount: number;
    method: PaymentMethod;
    reference: string | null;
    paidAt: string;
    notes: string | null;
    createdBy: string | null;
    idempotencyKey: string | null;
  },
): Promise<{
  error: string | null;
  duplicate?: boolean;
  paymentId?: string;
}> {
  const { data, error } = await supabase.rpc("record_invoice_payment_safe", {
    p_invoice_id: args.invoiceId,
    p_amount: args.amount,
    p_method: args.method,
    p_reference: args.reference,
    p_paid_at: args.paidAt,
    p_notes: args.notes,
    p_created_by: args.createdBy,
    p_idempotency_key: args.idempotencyKey,
    p_allow_deposit_on_zero_total: false,
  });
  if (error) {
    // Migration not applied yet — fail loudly rather than overpay.
    return {
      error:
        error.message.includes("record_invoice_payment_safe")
          ? "Payment safety migration (0158) is not applied yet. Apply it in Supabase before recording payments."
          : error.message,
    };
  }
  const res = data as RpcPaymentResult;
  if (!res?.ok) return { error: res?.error ?? "Could not record payment." };
  return {
    error: null,
    duplicate: Boolean(res.duplicate),
    paymentId: res.payment_id,
  };
}

/**
 * Gate + load current approval snapshot for a new estimate invoice.
 * Redirects back to the estimate with ?invoice_error= when blocked.
 */
async function requireApprovalSnapshotForInvoice(estimateId: string) {
  const supabase = await createClient();
  const { data: est } = await supabase
    .from("estimates")
    .select("id, status, approval_stale, customer_id")
    .eq("id", estimateId)
    .maybeSingle();
  if (!est) {
    redirect(`/estimates/${estimateId}?invoice_error=${encodeURIComponent("Estimate not found.")}`);
  }
  const snap = await getCurrentApprovalSnapshot(estimateId);
  const gate = assessInvoiceCommercialGate({
    status: (est.status as string) ?? null,
    approvalStale: Boolean(est.approval_stale),
    hasSnapshot: !!snap,
  });
  if (!gate.ok || !snap) {
    const msg = gate.ok
      ? "This estimate does not have an approval snapshot on file. Review and reapprove it before creating an invoice."
      : gate.message;
    redirect(`/estimates/${estimateId}?invoice_error=${encodeURIComponent(msg)}`);
  }
  return { supabase, est, snap };
}

/** Load active + void coverage rows for change-order planning. */
async function loadEstimateInvoiceCoverage(
  supabase: SupabaseServerClient,
  estimateId: string,
): Promise<CoverageInvoiceRow[]> {
  const { data: invs } = await supabase
    .from("invoices")
    .select("id, status, tax_rate, approval_snapshot_id")
    .eq("estimate_id", estimateId);
  const rows: CoverageInvoiceRow[] = [];
  for (const inv of invs ?? []) {
    const [{ data: items }, { data: pays }] = await Promise.all([
      supabase
        .from("invoice_items")
        .select("quantity, rate")
        .eq("invoice_id", inv.id),
      supabase.from("payments").select("id, status").eq("invoice_id", inv.id).limit(5),
    ]);
    rows.push({
      id: inv.id as string,
      status: (inv.status as string) ?? "draft",
      approvalSnapshotId:
        (inv.approval_snapshot_id as string | null | undefined) ?? null,
      total: invoiceCoverageTotal(
        (items ?? []) as { quantity: number | null; rate: number | null }[],
        inv.tax_rate as number,
      ),
      hasPayments: (pays ?? []).some(
        (p) => ((p.status as string) ?? "active") !== "void",
      ),
    });
  }
  return rows;
}

function redirectInvoiceError(estimateId: string, message: string): never {
  redirect(
    `/estimates/${estimateId}?invoice_error=${encodeURIComponent(message)}`,
  );
}

/**
 * Create estimate-derived invoice under change-order safety rules.
 * When selectedLineIds is set and plan is "full", only those lines are billed
 * (progress/deposit). Other plan outcomes ignore selection.
 */
async function createEstimateDerivedInvoice(args: {
  estimateId: string;
  selectedLineIds?: string[] | null;
}): Promise<void> {
  const { estimateId, selectedLineIds } = args;
  const { supabase, snap } = await requireApprovalSnapshotForInvoice(estimateId);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const coverage = await loadEstimateInvoiceCoverage(supabase, estimateId);
  let commercialCredits = 0;
  try {
    commercialCredits = await commercialCreditsTotalForEstimate(
      estimateId,
      supabase,
    );
  } catch {
    commercialCredits = 0;
  }
  const plan = planEstimateInvoiceCreation({
    approvedTotal: Number(snap.payload.total) || 0,
    existing: coverage,
    commercialCreditsTotal: commercialCredits,
  });

  if (plan.action === "legacy_review") {
    redirectInvoiceError(estimateId, plan.message);
  }
  if (plan.action === "credit_required") {
    // Legacy plan shape — treat as issue_credit path if present.
    redirectInvoiceError(
      estimateId,
      `${plan.message} Credit needed: $${plan.creditNeeded.toFixed(2)}.`,
    );
  }
  if (plan.action === "none") {
    redirectInvoiceError(estimateId, plan.message);
  }

  // Paid/partial commercial decrease → issue credit memo + auto-apply to open AR.
  if (plan.action === "issue_credit") {
    await assertRole(["admin", "office", "sales_manager"]);
    const { data: estMeta } = await supabase
      .from("estimates")
      .select("customer_id")
      .eq("id", estimateId)
      .maybeSingle();
    const customerId = estMeta?.customer_id as string | undefined;
    if (!customerId) {
      redirectInvoiceError(estimateId, "Estimate has no customer.");
    }
    let jobId: string | null = null;
    {
      const { data: jobRow } = await supabase
        .from("jobs")
        .select("id")
        .eq("estimate_id", estimateId)
        .maybeSingle();
      jobId = (jobRow?.id as string | null) ?? null;
    }

    const idem = `commercial-credit:${estimateId}:${snap.id}:${plan.amount}`;
    const taxBasisInvoiceId =
      coverage
        .filter((r) => r.status !== "void")
        .sort((a, b) => a.id.localeCompare(b.id))[0]?.id ?? null;
    const { data: existing } = await supabase
      .from("credit_memos")
      .select("id")
      .eq("idempotency_key", idem)
      .maybeSingle();

    let memoId = existing?.id as string | undefined;
    if (!memoId) {
      const reason = `Approved commercial decrease (snapshot). Approved $${plan.approvedTotal.toFixed(2)} vs invoiced $${plan.invoicedTotal.toFixed(2)}.`;
      const { data: issueRes, error: issueErr } = await supabase.rpc(
        "issue_credit_memo_safe",
        {
          p_customer_id: customerId,
          p_amount: plan.amount,
          p_reason: reason,
          p_kind: "commercial",
          p_estimate_id: estimateId,
          p_job_id: jobId,
          p_approval_snapshot_id: snap.id,
          p_created_by: user?.id ?? null,
          p_idempotency_key: idem,
          p_issued_at: null,
          p_invoice_id_for_tax: taxBasisInvoiceId,
        },
      );
      if (issueErr?.message.includes("issue_credit_memo_safe")) {
        const { data: inserted, error: insErr } = await supabase
          .from("credit_memos")
          .insert({
            customer_id: customerId,
            estimate_id: estimateId,
            job_id: jobId,
            approval_snapshot_id: snap.id,
            amount: plan.amount,
            reason,
            kind: "commercial",
            status: "issued",
            created_by: user?.id ?? null,
            idempotency_key: idem,
          })
          .select("id")
          .single();
        if (insErr || !inserted) {
          redirectInvoiceError(
            estimateId,
            insErr?.message?.includes("credit_memos")
              ? "Credit migration (0159) is not applied yet. Apply it in Supabase, then retry."
              : insErr?.message || "Could not create credit.",
          );
        }
        memoId = inserted.id as string;
      } else if (issueErr) {
        redirectInvoiceError(estimateId, issueErr.message);
      } else {
        const res = issueRes as {
          ok?: boolean;
          error?: string;
          credit_memo_id?: string;
        };
        if (!res?.ok || !res.credit_memo_id) {
          redirectInvoiceError(
            estimateId,
            res?.error || "Could not create credit.",
          );
        }
        memoId = res.credit_memo_id;
      }
    }

    // Auto-apply to open invoices on this estimate (oldest first) — same job/customer.
    const openRows = coverage
      .filter((r) => r.status !== "void")
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const row of openRows) {
      const availableRpc = await supabase.rpc("credit_memo_available", {
        p_memo_id: memoId,
      });
      const available = Number(availableRpc.data) || 0;
      if (available <= 0.005) break;

      const { data: items } = await supabase
        .from("invoice_items")
        .select("quantity, rate")
        .eq("invoice_id", row.id);
      const { data: pays } = await supabase
        .from("payments")
        .select("amount, status")
        .eq("invoice_id", row.id);
      const { data: apps } = await supabase
        .from("credit_applications")
        .select("amount, status")
        .eq("invoice_id", row.id);
      const { data: inv } = await supabase
        .from("invoices")
        .select("tax_rate, status")
        .eq("id", row.id)
        .maybeSingle();
      if (!inv || inv.status === "void") continue;
      const paid = (pays ?? [])
        .filter((p) => ((p.status as string) ?? "active") !== "void")
        .reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const credited = (apps ?? [])
        .filter((a) => ((a.status as string) ?? "active") !== "void")
        .reduce((s, a) => s + (Number(a.amount) || 0), 0);
      const due = Math.max(
        0,
        invoiceCoverageTotal(
          (items ?? []) as { quantity: number | null; rate: number | null }[],
          inv.tax_rate as number,
        ) -
          paid -
          credited,
      );
      if (due <= 0.005) continue;
      const applyAmt = Math.min(available, due);
      await supabase.rpc("apply_credit_to_invoice_safe", {
        p_credit_memo_id: memoId,
        p_invoice_id: row.id,
        p_amount: applyAmt,
        p_created_by: user?.id ?? null,
        p_idempotency_key: `auto-apply:${memoId}:${row.id}:${applyAmt}`,
      });
      await recomputeStatus(supabase, row.id);
    }

    revalidatePath(`/estimates/${estimateId}`);
    revalidatePath(`/customers/${customerId}`);
    revalidatePath("/invoices");
    if (jobId) revalidatePath(`/jobs/${jobId}`);
    redirect(
      `/customers/${customerId}?credit_ok=${encodeURIComponent(
        `Credit of $${plan.amount.toFixed(2)} recorded for the approved decrease. Refunds are separate — issue a refund only if money is returned.`,
      )}`,
    );
  }

  if (plan.action === "void_reissue") {
    for (const vid of plan.voidIds) {
      const voided = await voidInvoiceSafe(
        supabase,
        vid,
        user?.id ?? null,
        "Voided for replacement invoice (change order).",
      );
      if (!voided.ok) {
        redirectInvoiceError(
          estimateId,
          voided.error || "Could not void prior invoice for replacement.",
        );
      }
    }
  }

  if (
    plan.action !== "full" &&
    plan.action !== "void_reissue" &&
    plan.action !== "supplemental"
  ) {
    redirectInvoiceError(estimateId, "Unexpected invoice plan.");
  }

  const kind: InvoiceCommercialKind = plan.kind;
  const preview = buildInvoiceItemsFromApprovalSnapshot({
    invoiceId: "pending",
    payload: snap.payload,
    selectedLineIds:
      plan.action === "full" && selectedLineIds?.length
        ? selectedLineIds
        : null,
  });
  const jobId = await jobIdForEstimate(supabase, estimateId, preview.optionId);

  // Supplemental: tax-inclusive delta as one flat line (tax_rate 0) so total = delta.
  const isSupplemental = plan.action === "supplemental";
  const taxRate = isSupplemental ? 0 : preview.taxRate;

  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      customer_id: preview.customerId,
      estimate_id: estimateId,
      job_id: jobId,
      number: await nextInvoiceNumber(supabase),
      tax_rate: taxRate,
      issue_date: today(),
      created_by: user?.id ?? null,
      approval_snapshot_id: snap.id,
      commercial_kind: kind,
    })
    .select("id")
    .single();
  if (error || !invoice) {
    redirectInvoiceError(
      estimateId,
      error?.message ?? "Could not create the invoice.",
    );
  }

  let items;
  if (isSupplemental) {
    items = supplementalDeltaInvoiceItems(
      invoice.id,
      plan.amount,
      `Approved change order (v${snap.version})`,
    );
  } else {
    items = buildInvoiceItemsFromApprovalSnapshot({
      invoiceId: invoice.id,
      payload: snap.payload,
      selectedLineIds:
        plan.action === "full" && selectedLineIds?.length
          ? selectedLineIds
          : null,
    }).items;
  }

  if (items.length) await supabase.from("invoice_items").insert(items);

  revalidatePath("/invoices");
  if (jobId) revalidatePath(`/jobs/${jobId}`);
  redirect(`/invoices/${invoice.id}`);
}

export async function createInvoiceFromEstimate(
  formData: FormData,
): Promise<void> {
  const estimateId = str(formData.get("estimate_id"));
  if (!estimateId) return;
  await createEstimateDerivedInvoice({ estimateId });
}

/** Create an invoice from a chosen subset of an APPROVED snapshot's line items. */
export async function createInvoiceFromSelection(
  formData: FormData,
): Promise<void> {
  const estimateId = str(formData.get("estimate_id"));
  const lineIds = formData.getAll("line").map(String).filter(Boolean);
  if (!estimateId) return;
  await createEstimateDerivedInvoice({
    estimateId,
    selectedLineIds: lineIds,
  });
}

export async function createInvoice(formData: FormData): Promise<void> {
  const customerId = str(formData.get("customer_id"));
  if (!customerId) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      customer_id: customerId,
      number: await nextInvoiceNumber(supabase),
      issue_date: today(),
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error || !invoice) return;
  revalidatePath("/invoices");
  revalidatePath(`/customers/${customerId}`);
  redirect(`/invoices/${invoice.id}`);
}

export async function saveInvoice(
  invoiceId: string,
  input: SaveInvoiceInput,
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const [{ data: pays }, { data: existing }] = await Promise.all([
    supabase
      .from("payments")
      .select("id, status")
      .eq("invoice_id", invoiceId),
    supabase
      .from("invoices")
      .select("status, tax_rate, number, notes, terms, presentation, issue_date, due_date")
      .eq("id", invoiceId)
      .maybeSingle(),
  ]);
  const hasPayments = (pays ?? []).some(
    (p) => ((p.status as string) ?? "active") !== "void",
  );
  const lock = invoiceCommercialEditBlocked(hasPayments);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Status transitions that issue or void must use canonical RPCs.
  if (input.status === "void" && existing?.status !== "void") {
    const voided = await voidInvoiceSafe(
      supabase,
      invoiceId,
      user?.id ?? null,
    );
    if (!voided.ok) return { error: voided.error ?? "Could not void invoice." };
  } else if (
    existing?.status === "draft" &&
    (input.status === "sent" ||
      input.status === "partial" ||
      input.status === "paid")
  ) {
    const fin = await finalizeInvoiceSafe(
      supabase,
      invoiceId,
      user?.id ?? null,
    );
    if (!fin.ok) return { error: fin.error ?? "Could not finalize invoice." };
  }

  const statusForUpdate =
    input.status === "void"
      ? undefined
      : existing?.status === "draft" && input.status === "sent"
        ? undefined // finalize already set sent
        : input.status;

  if (lock.blocked) {
    // Allow non-commercial header edits only (notes/terms/dates/number/presentation/status
    // except void, and never lines/tax). Reject if commercial fields or items change.
    const { data: oldItems } = await supabase
      .from("invoice_items")
      .select("description, quantity, unit, rate, position")
      .eq("invoice_id", invoiceId)
      .order("position");
    const nextTax =
      typeof input.tax_rate === "number"
        ? input.tax_rate
        : parseFloat(String(input.tax_rate)) || 0;
    const prevTax = Number(existing?.tax_rate) || 0;
    const itemsChanged =
      (oldItems ?? []).length !== input.items.length ||
      (oldItems ?? []).some((o, i) => {
        const n = input.items[i];
        if (!n) return true;
        return (
          (o.description || "") !== (n.description || "") ||
          Number(o.quantity) !== Number(toNumOrNull(n.quantity) ?? 0) ||
          (o.unit || "") !== (n.unit || "") ||
          Number(o.rate) !== Number(toNumOrNull(n.rate) ?? 0)
        );
      });
    if (
      itemsChanged ||
      Math.abs(nextTax - prevTax) > 0.0001 ||
      input.status === "void"
    ) {
      return { error: lock.message };
    }
    const headerPatch: Record<string, unknown> = {
      number: input.number || null,
      presentation: input.presentation || "detailed",
      issue_date: input.issue_date || null,
      due_date: input.due_date || null,
      notes: input.notes || null,
      terms: input.terms || null,
    };
    if (statusForUpdate !== undefined) headerPatch.status = statusForUpdate;
    const { error: headerErr } = await supabase
      .from("invoices")
      .update(headerPatch)
      .eq("id", invoiceId);
    if (headerErr) return { error: headerErr.message };
    revalidatePath(`/invoices/${invoiceId}`);
    await revalidateInvoiceLinks(supabase, invoiceId);
    refreshMoneyViews();
    return { error: null };
  }

  const updatePatch: Record<string, unknown> = {
    number: input.number || null,
    presentation: input.presentation || "detailed",
    issue_date: input.issue_date || null,
    due_date: input.due_date || null,
    tax_rate:
      typeof input.tax_rate === "number"
        ? input.tax_rate
        : parseFloat(input.tax_rate) || 0,
    notes: input.notes || null,
    terms: input.terms || null,
  };
  if (statusForUpdate !== undefined) updatePatch.status = statusForUpdate;

  const { error: updateError } = await supabase
    .from("invoices")
    .update(updatePatch)
    .eq("id", invoiceId);
  if (updateError) return { error: updateError.message };

  // Crash-safe: insert the new items FIRST, then delete only the old ones. If
  // the insert fails the old line items survive, so an invoice can never be
  // left with no lines (a $0 invoice). The position index is non-unique, so
  // old + new rows can briefly coexist.
  const { data: oldItems } = await supabase
    .from("invoice_items")
    .select("id")
    .eq("invoice_id", invoiceId);
  const oldIds = (oldItems ?? []).map((r) => r.id as string);
  if (input.items.length) {
    const rows = input.items.map((it, i) => ({
      invoice_id: invoiceId,
      position: i,
      description: it.description || "",
      quantity: toNumOrNull(it.quantity),
      unit: it.unit || "sqft",
      rate: toNumOrNull(it.rate),
    }));
    const { error: insertError } = await supabase
      .from("invoice_items")
      .insert(rows);
    if (insertError) return { error: insertError.message };
  }
  if (oldIds.length) {
    await supabase.from("invoice_items").delete().in("id", oldIds);
  }

  await recomputeStatus(supabase, invoiceId);
  revalidatePath(`/invoices/${invoiceId}`);
  // Editing line items changes totals → refresh revenue/AR views and the
  // customer file + linked job balance too.
  await revalidateInvoiceLinks(supabase, invoiceId);
  refreshMoneyViews();
  return { error: null };
}

export async function recordPayment(formData: FormData): Promise<void> {
  const invoiceId = str(formData.get("invoice_id"));
  const amount = toNumOrNull(str(formData.get("amount")));
  const fail = (msg: string): never => {
    redirect(
      `/invoices/${invoiceId || ""}?payment_error=${encodeURIComponent(msg)}`,
    );
  };
  if (!invoiceId) {
    fail("Missing invoice.");
    return;
  }
  if (amount === null) {
    fail("Enter a payment amount.");
    return;
  }
  const payAmount: number = amount;

  await assertRole(INVOICE_PAYMENT_ROLES);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const idempotencyKey =
    str(formData.get("idempotency_key")) ||
    `manual:${invoiceId}:${payAmount}:${str(formData.get("paid_at")) || today()}:${str(formData.get("method")) || "other"}:${str(formData.get("reference"))}:${user?.id ?? ""}`;

  const res = await rpcRecordPayment(supabase, {
    invoiceId,
    amount: payAmount,
    method: (str(formData.get("method")) || "other") as PaymentMethod,
    reference: str(formData.get("reference")) || null,
    paidAt: str(formData.get("paid_at")) || today(),
    notes: str(formData.get("notes")) || null,
    createdBy: user?.id ?? null,
    idempotencyKey,
  });
  if (res.error) fail(res.error);

  await recomputeStatus(supabase, invoiceId);

  // F4: ledger integration (explicit skip when posting disabled; never silent gap).
  if (res.paymentId) {
    try {
      const { afterFinancialEventAccounting } = await import(
        "@/lib/data/accounting-integration"
      );
      const { classifyPaymentForAccounting } = await import(
        "@/lib/accounting/deposit-classify"
      );
      const { data: invMeta } = await supabase
        .from("invoices")
        .select("tax_rate, items:invoice_items(quantity, rate)")
        .eq("id", invoiceId)
        .maybeSingle();
      const items =
        (invMeta?.items as { quantity: number; rate: number }[] | null) ?? [];
      const subtotal = items.reduce(
        (s, i) => s + Number(i.quantity || 0) * Number(i.rate || 0),
        0,
      );
      const cls = classifyPaymentForAccounting({
        hasIssuedInvoiceWithPositiveTotal: subtotal > 0.005,
        blankZeroInvoice: items.length === 0 || subtotal <= 0.005,
        explicitPreInvoiceDeposit: false,
      });
      await afterFinancialEventAccounting({
        kind: "payment",
        sourceType: "payment",
        sourceId: res.paymentId,
        entryDate: str(formData.get("paid_at")) || today(),
        reviewRequired: !cls.ok,
        userId: user?.id ?? null,
      });
    } catch {
      /* F4 tables may not be applied yet — ops payment already succeeded. */
    }
  }

  const { data: inv } = await supabase
    .from("invoices")
    .select("customer_id, job_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (inv?.customer_id) {
    await advanceFromAutoAction(
      inv.customer_id as string,
      "collect_deposit",
    );
    revalidatePath(`/customers/${inv.customer_id}`);
  }
  if (inv?.job_id) revalidatePath(`/jobs/${inv.job_id}`);

  revalidatePath(`/invoices/${invoiceId}`);
  refreshMoneyViews();
}

/**
 * Log a card payment straight onto a CUSTOMER (from the "Process card" flow).
 * Records it against the customer's active invoice, creating a minimal one if
 * they don't have any yet — so a card run always lands on the client as a
 * payment/deposit and updates their balance. Card data stays in the processor;
 * we only store the amount + method.
 */
export async function recordCardPayment(
  customerId: string,
  amount: number,
  note?: string | null,
): Promise<{ error: string | null }> {
  if (!customerId) return { error: "Missing customer." };
  if (!Number.isFinite(amount) || amount <= 0)
    return { error: "Enter the amount you charged." };

  try {
    await assertRole(INVOICE_PAYMENT_ROLES);
  } catch {
    return { error: "You don’t have permission to record payments." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: candidates } = await supabase
    .from("invoices")
    .select("id, tax_rate, status")
    .eq("customer_id", customerId)
    .neq("status", "void")
    .order("created_at", { ascending: false });
  let invoiceId: string | undefined;
  for (const inv of candidates ?? []) {
    const [{ data: items }, { data: pays }] = await Promise.all([
      supabase.from("invoice_items").select("quantity, rate").eq("invoice_id", inv.id),
      supabase.from("payments").select("amount, status").eq("invoice_id", inv.id),
    ]);
    const total = invoiceTotals(
      (items ?? []) as { quantity: number | null; rate: number | null }[],
      inv.tax_rate as number,
      0,
    ).total;
    const paid = (pays ?? [])
      .filter((p) => ((p.status as string) ?? "active") !== "void")
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);
    if (total - paid > 0.005) {
      invoiceId = inv.id as string;
      break;
    }
  }
  if (!invoiceId) {
    const dep = await rpcRecordCustomerDeposit(supabase, {
      customerId,
      amount,
      method: "card",
      receivedOn: today(),
      notes: note?.trim() || "Card (SwipeSimple)",
      createdBy: user?.id ?? null,
      idempotencyKey: `card-deposit:${customerId}:${amount}:${today()}:${note?.trim() || ""}:${user?.id ?? ""}`,
    });
    if (dep.error) return { error: dep.error };
    await advanceFromAutoAction(customerId, "collect_deposit");
    revalidatePath(`/customers/${customerId}`);
    refreshMoneyViews();
    return { error: null };
  }

  const res = await rpcRecordPayment(supabase, {
    invoiceId,
    amount,
    method: "card",
    reference: note?.trim() || "Card (SwipeSimple)",
    paidAt: today(),
    notes: null,
    createdBy: user?.id ?? null,
    idempotencyKey: `card:${customerId}:${invoiceId}:${amount}:${today()}:${note?.trim() || ""}:${user?.id ?? ""}`,
  });
  if (res.error) return { error: res.error };

  await recomputeStatus(supabase, invoiceId);
  await advanceFromAutoAction(customerId, "collect_deposit");
  revalidatePath(`/customers/${customerId}`);
  revalidatePath(`/invoices/${invoiceId}`);
  refreshMoneyViews();
  return { error: null };
}

/**
 * Void a payment (audit-preserving). Does not hard-delete.
 * Restores invoice collectible balance via recomputeStatus.
 */
export async function voidPayment(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const invoiceId = str(formData.get("invoice_id"));
  const reason = str(formData.get("void_reason")) || "Voided by staff";
  const fail = (msg: string): never => {
    redirect(
      `/invoices/${invoiceId || ""}?payment_error=${encodeURIComponent(msg)}`,
    );
  };
  if (!id || !invoiceId) fail("Missing payment.");

  await assertRole(INVOICE_PAYMENT_VOID_ROLES);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: pay } = await supabase
    .from("payments")
    .select("id, status")
    .eq("id", id)
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  if (!pay) fail("Payment not found.");
  if (((pay as { status?: string }).status as string) === "void") {
    revalidatePath(`/invoices/${invoiceId}`);
    return;
  }

  // Prefer F4 atomic void+outbox RPC; fall back to direct update pre-0163.
  const { data: voidRes, error: voidRpcErr } = await supabase.rpc(
    "void_invoice_payment_safe",
    {
      p_payment_id: id,
      p_voided_by: user?.id ?? null,
      p_void_reason: reason,
    },
  );
  if (voidRpcErr) {
    if (voidRpcErr.message.includes("void_invoice_payment_safe")) {
      const { error } = await supabase
        .from("payments")
        .update({
          status: "void",
          voided_at: new Date().toISOString(),
          voided_by: user?.id ?? null,
          void_reason: reason,
        })
        .eq("id", id);
      if (error) {
        fail(
          error.message.includes("status")
            ? "Payment void migration (0158) is not applied yet. Apply it in Supabase before voiding payments."
            : error.message,
        );
      }
    } else {
      fail(voidRpcErr.message);
    }
  } else {
    const res = voidRes as { ok?: boolean; error?: string };
    if (!res?.ok) fail(res?.error ?? "Could not void payment.");
  }

  await recomputeStatus(supabase, invoiceId);

  try {
    const { afterFinancialEventAccounting } = await import(
      "@/lib/data/accounting-integration"
    );
    await afterFinancialEventAccounting({
      kind: "payment_void",
      sourceType: "payment",
      sourceId: id,
      entryDate: new Date().toISOString().slice(0, 10),
      userId: user?.id ?? null,
    });
  } catch {
    /* F4 optional until migrations applied */
  }

  revalidatePath(`/invoices/${invoiceId}`);
  await revalidateInvoiceLinks(supabase, invoiceId);
  refreshMoneyViews();
}

/** @deprecated Use voidPayment — hard delete is not part of production workflow. */
export async function deletePayment(formData: FormData): Promise<void> {
  // F0: never hard-delete historical payments from normal UI.
  await voidPayment(formData);
}

export async function setInvoiceStatus(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const status = str(formData.get("status")) as InvoiceStatus;
  if (!id || !status) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (status === "void") {
    const voided = await voidInvoiceSafe(
      supabase,
      id,
      user?.id ?? null,
      "Voided by staff",
    );
    if (!voided.ok) return;
  } else if (status === "sent") {
    const fin = await finalizeInvoiceSafe(supabase, id, user?.id ?? null);
    if (!fin.ok) return;
  } else {
    const { data: cur } = await supabase
      .from("invoices")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    const ensured = await ensureInvoiceIssued(supabase, {
      invoiceId: id,
      currentStatus: (cur?.status as string) ?? "draft",
      targetStatus: status,
      actorId: user?.id ?? null,
    });
    if (!ensured.ok) return;
    await supabase.from("invoices").update({ status }).eq("id", id);
  }
  revalidatePath(`/invoices/${id}`);
  await revalidateInvoiceLinks(supabase, id);
  refreshMoneyViews();
}

/** Mark an invoice as sent and email it to the customer. */
export async function emailInvoice(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  // The "send to client" popup can mark the invoice sent WITHOUT emailing.
  const skipClientEmail = str(formData.get("send_email")) === "no";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: before } = await supabase
    .from("invoices")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if ((before?.status as string) === "draft") {
    const fin = await finalizeInvoiceSafe(supabase, id, user?.id ?? null);
    if (!fin.ok) return;
  } else if (
    before?.status &&
    !["sent", "partial", "paid"].includes(before.status as string)
  ) {
    // Unexpected non-draft non-issued — try finalize for safety.
    const fin = await finalizeInvoiceSafe(supabase, id, user?.id ?? null);
    if (!fin.ok) return;
  }

  const { data: inv } = await supabase
    .from("invoices")
    .select("number, customer:customers(full_name, email)")
    .eq("id", id)
    .maybeSingle();
  const cust = inv?.customer as unknown as {
    full_name: string | null;
    email: string | null;
  } | null;
  if (!skipClientEmail && cust?.email) {
    await sendEmail({
      to: cust.email,
      subject: `Invoice ${inv?.number ?? ""} from Cleveland Floor King`.trim(),
      html: emailLayout(
        "Your invoice is ready",
        `<p>Hi ${cust.full_name?.split(" ")[0] ?? "there"},</p>
         <p>Thank you for your business — it's truly appreciated! Your invoice${inv?.number ? ` ${inv.number}` : ""} is ready to view whenever you are.</p>
         <p>If you have any questions, just reply to this email and we'll be glad to help.</p>`,
        { label: "View your invoice", url: `${siteUrl()}/portal/invoices/${id}` },
        { preheader: `Your invoice${inv?.number ? ` ${inv.number}` : ""} is ready to view.` },
      ),
    });
  }

  revalidatePath(`/invoices/${id}`);
  redirect(`/invoices/${id}`);
}

/**
 * Permanently delete an invoice and everything attached to it: its line items
 * and ALL recorded payments (both cascade via their foreign keys). Any order
 * that pointed at it is unlinked automatically, and the linked job's balance,
 * the customer file, and the money views are all refreshed so the whole app
 * reflects the removal. Staff only; runs with the service role so it can never
 * silently fail on RLS.
 */
export async function deleteInvoice(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  let customerId = str(formData.get("customer_id"));
  if (!id) return;

  // Must be signed-in staff.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!me || (me.role as string) === "customer") return;

  const admin = createAdminClient();
  // Find what the invoice touches before removing it.
  const { data: inv } = await admin
    .from("invoices")
    .select("customer_id, job_id")
    .eq("id", id)
    .maybeSingle();
  if (inv) {
    if (!customerId) customerId = (inv.customer_id as string | null) ?? "";
    const jobId = (inv.job_id as string | null) ?? null;
    const { data: pays } = await admin
      .from("payments")
      .select("id, status")
      .eq("invoice_id", id);
    if (
      (pays ?? []).some((p) => ((p.status as string) ?? "active") !== "void")
    ) {
      // Never hard-delete payment history.
      redirect(
        customerId
          ? `/customers/${customerId}?invoice_error=${encodeURIComponent("This invoice has payments and can’t be deleted. Void only if unpaid, or keep it for history.")}`
          : `/invoices/${id}`,
      );
    }
    // invoice_items + payments cascade; orders.invoice_id is set null by the FK.
    await admin.from("invoices").delete().eq("id", id);
    if (jobId) revalidatePath(`/jobs/${jobId}`);
  }

  refreshMoneyViews();
  revalidatePath("/orders");
  revalidatePath("/invoices");
  if (customerId) revalidatePath(`/customers/${customerId}`);
  // Deleting from the list stays on the list; from a customer/invoice page it
  // returns to the customer file.
  const redirectTo = str(formData.get("redirect_to"));
  redirect(redirectTo || (customerId ? `/customers/${customerId}` : "/invoices"));
}
