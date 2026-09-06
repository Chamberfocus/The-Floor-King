/**
 * F4/F5 economic event date policy (pure).
 * Never invent today's date when an accounting date is missing.
 */
export type EconomicDateKind =
  | "payment"
  | "payment_void"
  | "credit_application"
  | "refund"
  | "refund_void"
  | "invoice_issue"
  | "invoice_void"
  | "credit_memo_issue"
  | "credit_void"
  | "vendor_bill"
  | "direct_expense"
  | "customer_deposit"
  | "deposit_apply"
  | "bill_payment"
  | "bill_payment_void";

export function validateEconomicEventDate(raw: unknown):
  | { ok: true; date: string }
  | { ok: false; code: "ACCOUNTING_INVALID_ECONOMIC_DATE"; message: string } {
  if (raw === null || raw === undefined) {
    return {
      ok: false,
      code: "ACCOUNTING_INVALID_ECONOMIC_DATE",
      message: "economicEventDate is required when accounting posting is enabled.",
    };
  }
  const s = String(raw).trim();
  if (!s) {
    return {
      ok: false,
      code: "ACCOUNTING_INVALID_ECONOMIC_DATE",
      message: "economicEventDate is required when accounting posting is enabled.",
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return {
      ok: false,
      code: "ACCOUNTING_INVALID_ECONOMIC_DATE",
      message: `economicEventDate ${s} is not a valid date`,
    };
  }
  const t = Date.parse(`${s}T00:00:00Z`);
  if (!Number.isFinite(t)) {
    return {
      ok: false,
      code: "ACCOUNTING_INVALID_ECONOMIC_DATE",
      message: `economicEventDate ${s} is not a valid date`,
    };
  }
  const iso = new Date(t).toISOString().slice(0, 10);
  if (iso !== s) {
    return {
      ok: false,
      code: "ACCOUNTING_INVALID_ECONOMIC_DATE",
      message: `economicEventDate ${s} is not a valid date`,
    };
  }
  return { ok: true, date: s };
}

export function assessEnqueueEconomicDate(args: {
  postingEnabled: boolean;
  eventPilotEnabled: boolean;
  economicEventDate: unknown;
  processingDate: string;
}):
  | { action: "skip_no_outbox" }
  | { action: "enqueue"; economicEventDate: string }
  | { action: "reject"; code: string; message: string } {
  if (!args.postingEnabled || !args.eventPilotEnabled) {
    return { action: "skip_no_outbox" };
  }
  const v = validateEconomicEventDate(args.economicEventDate);
  if (!v.ok) {
    return { action: "reject", code: v.code, message: v.message };
  }
  return { action: "enqueue", economicEventDate: v.date };
}

/**
 * Source-RPC business date resolution (mirrors accounting_resolve_business_date).
 * When family pilot OFF: missing date may default to today (ops intentional default).
 * When family pilot ON: missing date fails closed — never invent today.
 */
export function resolveSourceBusinessDate(args: {
  provided: string | null | undefined;
  familyPilotActive: boolean;
  /** Used only when pilot is OFF and provided is missing. */
  todayIso: string;
}):
  | { ok: true; date: string; inventedToday: boolean }
  | { ok: false; code: "ACCOUNTING_INVALID_ECONOMIC_DATE"; message: string } {
  const raw = args.provided?.trim() || null;
  if (args.familyPilotActive) {
    if (!raw) {
      return {
        ok: false,
        code: "ACCOUNTING_INVALID_ECONOMIC_DATE",
        message:
          "Explicit business date required when accounting posting for this family is enabled.",
      };
    }
    const v = validateEconomicEventDate(raw);
    if (!v.ok) return v;
    return { ok: true, date: v.date, inventedToday: false };
  }
  if (!raw) {
    return { ok: true, date: args.todayIso, inventedToday: true };
  }
  const v = validateEconomicEventDate(raw);
  if (!v.ok) return v;
  return { ok: true, date: v.date, inventedToday: false };
}

export function paymentEconomicDate(paidAt: string | null | undefined): string {
  if (!paidAt || !String(paidAt).trim()) {
    throw new Error("payment paid_at is required for accounting economic date");
  }
  const v = validateEconomicEventDate(paidAt);
  if (!v.ok) throw new Error(v.message);
  return v.date;
}

export function refundEconomicDate(
  refundedAt: string | null | undefined,
): string {
  if (!refundedAt || !String(refundedAt).trim()) {
    throw new Error("refund refunded_at is required for accounting economic date");
  }
  const v = validateEconomicEventDate(refundedAt);
  if (!v.ok) throw new Error(v.message);
  return v.date;
}

export function creditApplicationEconomicDate(appliedOn: string): string {
  const v = validateEconomicEventDate(appliedOn);
  if (!v.ok) throw new Error(v.message);
  return v.date;
}

export function paymentVoidEconomicDate(voidAuthorizedOn: string): string {
  const v = validateEconomicEventDate(voidAuthorizedOn);
  if (!v.ok) throw new Error(v.message);
  return v.date;
}

export function invoiceIssueEconomicDate(issueDate: string): string {
  const v = validateEconomicEventDate(issueDate);
  if (!v.ok) throw new Error(v.message);
  return v.date;
}

export function invoiceVoidEconomicDate(voidAuthorizedOn: string): string {
  return paymentVoidEconomicDate(voidAuthorizedOn);
}

export function creditMemoIssueEconomicDate(issuedAt: string): string {
  const v = validateEconomicEventDate(issuedAt);
  if (!v.ok) throw new Error(v.message);
  return v.date;
}

export function vendorBillEconomicDate(billDate: string): string {
  const v = validateEconomicEventDate(billDate);
  if (!v.ok) throw new Error(v.message);
  return v.date;
}

export function directExpenseEconomicDate(expenseDate: string): string {
  const v = validateEconomicEventDate(expenseDate);
  if (!v.ok) throw new Error(v.message);
  return v.date;
}

export function depositReceiptEconomicDate(receivedOn: string): string {
  const v = validateEconomicEventDate(receivedOn);
  if (!v.ok) throw new Error(v.message);
  return v.date;
}

export function depositApplyEconomicDate(appliedOn: string): string {
  const v = validateEconomicEventDate(appliedOn);
  if (!v.ok) throw new Error(v.message);
  return v.date;
}

export function billPaymentEconomicDate(paidOn: string): string {
  const v = validateEconomicEventDate(paidOn);
  if (!v.ok) throw new Error(v.message);
  return v.date;
}

export function economicDatePolicySummary(kind: EconomicDateKind): string {
  switch (kind) {
    case "payment":
      return "paid_at";
    case "refund":
      return "refunded_at";
    case "credit_application":
      return "application_authorization_date_utc";
    case "payment_void":
    case "refund_void":
    case "invoice_void":
    case "credit_void":
    case "bill_payment_void":
      return "void_authorization_date_utc_not_original_paid_at";
    case "invoice_issue":
      return "invoice_issue_date";
    case "credit_memo_issue":
      return "credit_issued_at";
    case "vendor_bill":
      return "bill_date";
    case "direct_expense":
      return "expense_date";
    case "customer_deposit":
      return "received_on";
    case "deposit_apply":
      return "application_date";
    case "bill_payment":
      return "bill_payment_date";
  }
}

/** Reconciliation cannot complete unless difference is exactly 0.00 */
export function assessReconciliationCompleteGuard(args: {
  status: string;
  difference: number;
  accountEligible: boolean;
  clearedLinesMatchAccount: boolean;
  allClearedPosted: boolean;
  actorIsStaff: boolean;
}): { ok: true } | { ok: false; error: string } {
  if (!args.actorIsStaff) {
    return { ok: false, error: "Only admin/office may complete reconciliation." };
  }
  if (args.status !== "open") {
    return { ok: false, error: "Reconciliation session is not open." };
  }
  if (!args.accountEligible) {
    return { ok: false, error: "Account is not an eligible cash/bank GL account." };
  }
  if (!args.clearedLinesMatchAccount) {
    return { ok: false, error: "Cleared lines must belong to the session account." };
  }
  if (!args.allClearedPosted) {
    return { ok: false, error: "Only posted journal lines may be cleared." };
  }
  if (Math.abs(args.difference) > 0.005) {
    return {
      ok: false,
      error: `Difference must be 0.00 (got ${args.difference.toFixed(2)}).`,
    };
  }
  return { ok: true };
}
