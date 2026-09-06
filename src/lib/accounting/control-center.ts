/**
 * F6-P5 Accounting Control Center — pure helpers for reports, period control,
 * historical as-of AR/AP, UI labels, and cutover verdict mirroring 0177 SQL.
 * Does not enable posting or books-of-record.
 */
import { createHash } from "node:crypto";
import { ACCOUNTING_NOT_BOOKS_MESSAGE } from "@/lib/accounting/types";
import { invoiceOpenArBalance } from "@/lib/accounting/open-ar";
import type { CalcInvoiceItem } from "@/lib/invoice-calc";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Staff-facing report / control RPCs (authenticated execute after 0177). */
export const ACCT_REPORT_RPCS = [
  "acct_report_trial_balance",
  "acct_report_trial_balance_as_of",
  "acct_report_pnl",
  "acct_report_balance_sheet",
  "acct_report_general_ledger",
  "acct_report_ar_aging",
  "acct_report_ap_aging",
  "acct_books_status",
  "acct_recon_ar_control",
  "acct_recon_ap_control",
  "acct_recon_inventory_control",
  "acct_recon_cash_book",
  "acct_journal_integrity_scan",
  "acct_exceptions_scan",
  "acct_cutover_readiness_snapshot",
] as const;

export const ACCT_PERIOD_RPCS = [
  "acct_period_close_safe",
  "acct_period_reopen_safe",
  "acct_period_lock_safe",
] as const;

export const ACCT_COA_RPCS = [
  "gl_account_deactivate_safe",
  "gl_account_upsert_safe",
] as const;

/** Internal helpers — revoke authenticated, service_role only. */
export const ACCT_INTERNAL_HELPERS = [
  "acct_report_require_finance",
  "acct_invoice_open_ar_as_of",
  "acct_bill_remaining_as_of",
  "acct_control_context_hash",
  "acct_control_lock_idempotency",
  "acct_control_begin_action",
  "acct_control_complete_action",
  "acct_round2",
  "acct_is_debit_normal",
  "acct_natural_balance",
  "acct_table_has_column",
  "acct_function_exists",
  "acct_mapped_account_id",
  "acct_gl_account_balance_as_of",
  "acct_require_admin",
  "acct_period_close_readiness",
  "acct_parse_outbox_economic_date",
  "acct_periods_prevent_overlap",
  "acct_lock_period_for_posting",
] as const;

export const ACCT_CONTROL_IDEMPOTENCY_TABLE = "accounting_control_idempotency";

export const ACCT_FINANCE_GATE = "acct_report_require_finance";

/** Historical AR commercial without immutable freeze must not invent amounts. */
export const HISTORICAL_COMMERCIAL_UNSUPPORTED =
  "HISTORICAL_COMMERCIAL_UNSUPPORTED" as const;

export function historicalArCommercialSupported(args: {
  hasPostedInvoiceJournalFreeze: boolean;
  hasOutboxInvoiceIssueFreeze: boolean;
  hasApprovalSnapshotTotal: boolean;
  hasFrozenTotalColumn: boolean;
}): boolean {
  return (
    args.hasPostedInvoiceJournalFreeze ||
    args.hasOutboxInvoiceIssueFreeze ||
    args.hasApprovalSnapshotTotal ||
    args.hasFrozenTotalColumn
  );
}

export function classifyHistoricalArInvoice(args: {
  issueDate: string | null;
  asOf: string;
  voidedAtDate: string | null;
  commercialSupported: boolean;
}): {
  includeInAging: boolean;
  limitationCode: string | null;
  balanceEligible: boolean;
} {
  if (!args.issueDate || args.issueDate > args.asOf) {
    return {
      includeInAging: false,
      limitationCode: "NOT_ISSUED_YET",
      balanceEligible: false,
    };
  }
  if (args.voidedAtDate && args.voidedAtDate <= args.asOf) {
    return {
      includeInAging: false,
      limitationCode: "VOIDED_AS_OF",
      balanceEligible: false,
    };
  }
  if (!args.commercialSupported) {
    return {
      includeInAging: false,
      limitationCode: HISTORICAL_COMMERCIAL_UNSUPPORTED,
      balanceEligible: false,
    };
  }
  return {
    includeInAging: true,
    limitationCode: null,
    balanceEligible: true,
  };
}

/** Period TB identity: ending = beginning + natural(period movement). */
export function trialBalanceEndingFromPeriod(args: {
  accountType: "asset" | "liability" | "equity" | "revenue" | "expense";
  beginning: number;
  periodDebits: number;
  periodCredits: number;
}): number {
  const debitNormal =
    args.accountType === "asset" || args.accountType === "expense";
  const periodNatural = debitNormal
    ? round2(args.periodDebits - args.periodCredits)
    : round2(args.periodCredits - args.periodDebits);
  return round2(args.beginning + periodNatural);
}

/**
 * Sign-correct residual unclosed P&L earnings from natural balances.
 * Revenue and expense naturals are BOTH normally positive — subtract expense.
 * unclosed = sum(revenue_nat) - sum(expense_nat)
 */
export function unclosedEarningsFromNaturalBalances(args: {
  revenueNaturalBalances: number[];
  expenseNaturalBalances: number[];
}): number {
  const rev = round2(
    args.revenueNaturalBalances.reduce((s, n) => s + (Number(n) || 0), 0),
  );
  const exp = round2(
    args.expenseNaturalBalances.reduce((s, n) => s + (Number(n) || 0), 0),
  );
  return round2(rev - exp);
}

/**
 * BS reported equity (pre- and post-year-close):
 * equity_reported = equity_accounts + unclosed_earnings
 * unclosed_earnings must already be sign-correct (revenue − expense).
 * Do NOT also add current_year_net_income (disclosure-only).
 */
export function balanceSheetEquityReported(args: {
  equityAccounts: number;
  unclosedEarnings: number;
}): number {
  return round2(args.equityAccounts + args.unclosedEarnings);
}

/**
 * Pure BS presentation from journal-like natural balances (as-of).
 * Mirrors acct_report_balance_sheet sign policy for goldens.
 */
export function balanceSheetFromNaturalBalances(args: {
  assets: number;
  liabilities: number;
  equityAccounts: number;
  revenueNatural: number;
  expenseNatural: number;
  /** Disclosure only — must not change equity_reported. */
  currentYearNetIncomeDisclosure?: number;
}): {
  unclosedEarnings: number;
  equityReported: number;
  balanced: boolean;
  currentYearNetIncomeDisclosure: number;
} {
  const unclosedEarnings = unclosedEarningsFromNaturalBalances({
    revenueNaturalBalances: [args.revenueNatural],
    expenseNaturalBalances: [args.expenseNatural],
  });
  const equityReported = balanceSheetEquityReported({
    equityAccounts: args.equityAccounts,
    unclosedEarnings,
  });
  const balanced = balanceSheetEquationHolds({
    assets: args.assets,
    liabilities: args.liabilities,
    equityWithIncome: equityReported,
  });
  return {
    unclosedEarnings,
    equityReported,
    balanced,
    currentYearNetIncomeDisclosure: round2(
      args.currentYearNetIncomeDisclosure ?? 0,
    ),
  };
}

/** FY-scoped NI disclosure window (calendar FY in 0177). */
export function currentYearNetIncomeWindow(asOf: string): {
  fyStart: string;
  fyEnd: string;
} {
  const y = asOf.slice(0, 4);
  return { fyStart: `${y}-01-01`, fyEnd: asOf };
}

/** Inclusive daterange overlap (matches SQL daterange(..., '[]') &&). */
export function accountingPeriodsOverlap(args: {
  aStart: string;
  aEnd: string;
  bStart: string;
  bEnd: string;
}): boolean {
  return args.aStart <= args.bEnd && args.bStart <= args.aEnd;
}

export function accountingPeriodDatesValid(start: string, end: string): boolean {
  return Boolean(start && end && start <= end);
}

/**
 * Canonical period lock order documentation (mirrored in 0177 SQL comments):
 * POSTING: domain locks (job/AP/inventory) → period FOR UPDATE → post
 * OUTBOX: domain locks → economicEventDate → period FOR UPDATE → insert outbox
 * CLOSE/LOCK/REOPEN: period FOR UPDATE → readiness/transition
 * Period calendar insert/update: advisory(178,1) + GiST EXCLUDE
 */
export const ACCT_PERIOD_LOCK_PROTOCOL = [
  "resolve_period_for_entry_date",
  "for_update_accounting_periods_row",
  "assert_status_open_for_posting",
  "post_journal_or_enqueue_outbox",
] as const;

export const OUTBOX_EVENT_DATE_UNRESOLVED = "OUTBOX_EVENT_DATE_UNRESOLVED" as const;

/** Safe parse for outbox payload.economicEventDate (close readiness fail-closed). */
export function parseOutboxEconomicEventDate(
  payload: Record<string, unknown> | null | undefined,
):
  | { ok: true; date: string }
  | { ok: false; code: typeof OUTBOX_EVENT_DATE_UNRESOLVED } {
  const raw = payload?.economicEventDate;
  if (raw == null) {
    return { ok: false, code: OUTBOX_EVENT_DATE_UNRESOLVED };
  }
  const text = String(raw).trim();
  if (!text) {
    return { ok: false, code: OUTBOX_EVENT_DATE_UNRESOLVED };
  }
  // Accept only YYYY-MM-DD (and Date-parseable calendar days). Reject junk.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { ok: false, code: OUTBOX_EVENT_DATE_UNRESOLVED };
  }
  const [y, m, d] = text.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return { ok: false, code: OUTBOX_EVENT_DATE_UNRESOLVED };
  }
  return { ok: true, date: text };
}

const OUTBOX_BLOCKING_STATUSES = new Set([
  "pending",
  "processing",
  "error",
  "failed",
  "review_required",
]);

/**
 * Period-scoped close readiness for one outbox row.
 * Unresolved dates always block (fail closed). Future-period events do not.
 */
export function outboxRowCloseReadinessImpact(args: {
  status: string;
  payload: Record<string, unknown> | null | undefined;
  periodStart: string;
  periodEnd: string;
}):
  | { impact: "none" }
  | { impact: "unresolved"; code: typeof OUTBOX_EVENT_DATE_UNRESOLVED }
  | { impact: "pending" | "error"; economicDate: string } {
  if (!OUTBOX_BLOCKING_STATUSES.has(args.status)) {
    return { impact: "none" };
  }
  const parsed = parseOutboxEconomicEventDate(args.payload);
  if (!parsed.ok) {
    return { impact: "unresolved", code: OUTBOX_EVENT_DATE_UNRESOLVED };
  }
  if (parsed.date < args.periodStart || parsed.date > args.periodEnd) {
    return { impact: "none" };
  }
  if (args.status === "error" || args.status === "failed") {
    return { impact: "error", economicDate: parsed.date };
  }
  return { impact: "pending", economicDate: parsed.date };
}

export function assessPeriodCloseOutboxReadiness(args: {
  periodStart: string;
  periodEnd: string;
  rows: Array<{
    status: string;
    payload: Record<string, unknown> | null | undefined;
  }>;
}): {
  ready: boolean;
  blockers: string[];
  periodPending: number;
  periodFailed: number;
  unresolved: number;
} {
  let periodPending = 0;
  let periodFailed = 0;
  let unresolved = 0;
  for (const row of args.rows) {
    const hit = outboxRowCloseReadinessImpact({
      status: row.status,
      payload: row.payload,
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
    });
    if (hit.impact === "unresolved") unresolved += 1;
    else if (hit.impact === "pending") periodPending += 1;
    else if (hit.impact === "error") periodFailed += 1;
  }
  const blockers: string[] = [];
  if (unresolved > 0) blockers.push(OUTBOX_EVENT_DATE_UNRESOLVED);
  if (periodFailed > 0) {
    blockers.push("Failed accounting events exist for this period.");
  }
  if (periodPending > 0) {
    blockers.push("Pending accounting events exist for this period.");
  }
  return {
    ready: blockers.length === 0,
    blockers,
    periodPending,
    periodFailed,
    unresolved,
  };
}


export const REPORT_LABELS = {
  controlCenter: "Accounting Control Center",
  trialBalance: "Trial Balance",
  profitLoss: "Profit & Loss",
  balanceSheet: "Balance Sheet",
  generalLedger: "General Ledger",
  arAging: "AR Aging",
  apAging: "AP Aging",
  exceptions: "Exceptions",
  cutover: "Cutover Readiness",
  chartOfAccounts: "Chart of Accounts",
  bankReconciliation: "Bank Reconciliation",
  openingBalances: "Opening Balances",
} as const;

export type AgingBucketKey = "current" | "1-30" | "31-60" | "61-90" | "90+";

export const agingBucketLabels: Record<AgingBucketKey, string> = {
  current: "Current",
  "1-30": "1–30 days",
  "31-60": "31–60 days",
  "61-90": "61–90 days",
  "90+": "90+ days",
};

export type ExceptionSeverity =
  | "CRITICAL"
  | "HIGH"
  | "WARNING"
  | "EXPECTED_NOT_ACTIVE";

/** Sort order for exception lists (CRITICAL first). */
export const exceptionSeverityOrder: readonly ExceptionSeverity[] = [
  "CRITICAL",
  "HIGH",
  "WARNING",
  "EXPECTED_NOT_ACTIVE",
] as const;

export function exceptionSeverityRank(severity: string): number {
  const i = exceptionSeverityOrder.indexOf(severity as ExceptionSeverity);
  return i === -1 ? 99 : i;
}

/** Warehouse must never access GL / P&L / BS / TB / aging / control center. */
export function warehouseMayAccessFinancialReports(): false {
  return false;
}

export function financeReportRoles(): ("admin" | "office")[] {
  return ["admin", "office"];
}

export function postingRemainsOffInP5(): boolean {
  return true;
}

export function booksOfRecordNotEnabledInP5(): boolean {
  return true;
}

export function controlCenterNavItems(): { href: string; label: string }[] {
  return [
    { href: "/accounting", label: REPORT_LABELS.controlCenter },
    { href: "/accounting/general-ledger", label: REPORT_LABELS.generalLedger },
    { href: "/accounting/trial-balance", label: REPORT_LABELS.trialBalance },
    { href: "/accounting/profit-loss", label: REPORT_LABELS.profitLoss },
    { href: "/accounting/balance-sheet", label: REPORT_LABELS.balanceSheet },
    { href: "/accounting/ar-aging", label: REPORT_LABELS.arAging },
    { href: "/accounting/ap-aging", label: REPORT_LABELS.apAging },
    { href: "/accounting/exceptions", label: REPORT_LABELS.exceptions },
    { href: "/accounting/cutover", label: REPORT_LABELS.cutover },
    { href: "/accounting/chart-of-accounts", label: REPORT_LABELS.chartOfAccounts },
    {
      href: "/accounting/bank-reconciliation",
      label: REPORT_LABELS.bankReconciliation,
    },
    {
      href: "/accounting/opening-balances",
      label: REPORT_LABELS.openingBalances,
    },
  ];
}

export interface AcctBooksStatusLike {
  posting_enabled?: boolean;
  books_of_record?: boolean;
  official_books?: boolean;
  message?: string | null;
}

export function officialBooksBanner(status: AcctBooksStatusLike | null | undefined): {
  official: boolean;
  tone: "warning" | "ok";
  title: string;
  message: string;
} {
  const official = Boolean(
    status?.official_books ??
      (status?.posting_enabled && status?.books_of_record),
  );
  if (official) {
    return {
      official: true,
      tone: "ok",
      title: "Books of record mode",
      message:
        status?.message ??
        "CRM ledger flags indicate books-of-record mode (owner-validated).",
    };
  }
  return {
    official: false,
    tone: "warning",
    title: "NOT OFFICIAL BOOKS",
    message: status?.message ?? ACCOUNTING_NOT_BOOKS_MESSAGE,
  };
}

/** Parse RPC jsonb / already-parsed object; returns null when empty. */
export function parseAcctReportJson<T extends Record<string, unknown>>(
  raw: unknown,
): T | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as T;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as T;
  }
  return null;
}

export function parseAcctReportNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return round2(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return round2(n);
  }
  return round2(fallback);
}

export function parseAcctReportBoolean(
  value: unknown,
  fallback = false,
): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "t" || value === 1) return true;
  if (value === "false" || value === "f" || value === 0) return false;
  return fallback;
}

/** Mirrors acct_control_begin_action conflict / replay semantics. */
export function assessControlIdempotency(args: {
  existing: { action: string; contextHash: string; status?: string } | null;
  action: string;
  contextHash: string;
}): "miss" | "hit" | "conflict" | "pending" {
  if (!args.existing) return "miss";
  if (
    args.existing.action !== args.action ||
    args.existing.contextHash !== args.contextHash
  ) {
    return "conflict";
  }
  if (args.existing.status === "pending") return "pending";
  return "hit";
}

/** Payload shape for period close / reopen context hash (0177). */
export function periodCloseContextPayload(args: {
  periodId: string;
  reason: string;
}): { period_id: string; reason: string } {
  return { period_id: args.periodId, reason: args.reason };
}

export function periodReopenContextPayload(args: {
  periodId: string;
  reason: string;
}): { period_id: string; reason: string } {
  return { period_id: args.periodId, reason: args.reason };
}

/**
 * Mirror Postgres jsonb_build_object(...)::text spacing for control hashes.
 * Keys sorted (jsonb stores keys in sorted order).
 */
export function pgJsonbObjectText(payload: Record<string, string>): string {
  const keys = Object.keys(payload).sort();
  return `{${keys
    .map((k) => `"${k}": ${JSON.stringify(payload[k])}`)
    .join(", ")}}`;
}

/**
 * Deterministic context string used for pure tests (SQL uses md5 of the same
 * action + chr(31) + payload::text).
 */
export function controlContextHashPayload(
  action: string,
  payload: unknown,
): string {
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    Object.values(payload as Record<string, unknown>).every(
      (v) => typeof v === "string",
    )
  ) {
    return `${action}\u001f${pgJsonbObjectText(payload as Record<string, string>)}`;
  }
  return `${action}\u001f${JSON.stringify(payload)}`;
}

function md5Hex(input: string): string {
  return createHash("md5").update(input, "utf8").digest("hex");
}

/** Mirrors acct_control_context_hash('period_close', …). */
export function periodCloseContextHash(
  periodId: string,
  reason: string,
): string {
  return md5Hex(
    controlContextHashPayload(
      "period_close",
      periodCloseContextPayload({ periodId, reason }),
    ),
  );
}

/** Mirrors acct_control_context_hash('period_reopen', …). */
export function reopenContextHash(periodId: string, reason: string): string {
  return md5Hex(
    controlContextHashPayload(
      "period_reopen",
      periodReopenContextPayload({ periodId, reason }),
    ),
  );
}

export interface DatedReduction {
  amount: number;
  /** Economic / applied date YYYY-MM-DD (inclusive as-of filter). */
  date: string;
  active?: boolean;
  voided?: boolean;
}

/**
 * Historical open AR as-of: commercial − reductions dated ≤ asOf.
 * Payments / credits / deposits / write-offs after as-of are ignored.
 */
export function historicalOpenArAsOf(args: {
  commercialTotal: number;
  asOfDate: string;
  voidedOnOrBeforeAsOf?: boolean;
  payments?: { amount: number; date: string; voided?: boolean }[];
  credits?: { amount: number; date: string; voided?: boolean }[];
  deposits?: { amount: number; date: string; voided?: boolean }[];
  writeOffs?: { amount: number; date: string; voided?: boolean }[];
}): number {
  if (args.voidedOnOrBeforeAsOf) return 0;
  const asOf = args.asOfDate;
  const sumDated = (
    rows: { amount: number; date: string; voided?: boolean }[] | undefined,
  ) =>
    round2(
      (rows ?? [])
        .filter((r) => !r.voided && r.date <= asOf)
        .reduce((s, r) => s + (Number(r.amount) || 0), 0),
    );
  const reductions =
    sumDated(args.payments) +
    sumDated(args.credits) +
    sumDated(args.deposits) +
    sumDated(args.writeOffs);
  return round2(Math.max(0, round2(args.commercialTotal) - reductions));
}

/** Alias used by goldens / UI docs. */
export const historicalArAsOfFromCommercial = historicalOpenArAsOf;

/**
 * Reconstruct open AR as-of with dated reductions ≤ asOfDate.
 * Prefer commercialTotal, or items+taxRate (via invoiceOpenArBalance).
 */
export function invoiceOpenArAsOf(args: {
  asOfDate: string;
  commercialTotal?: number;
  items?: CalcInvoiceItem[];
  taxRate?: number | string | null;
  voidedOnOrBeforeAsOf?: boolean;
  payments?: DatedReduction[];
  credits?: DatedReduction[];
  deposits?: DatedReduction[];
  writeOffs?: DatedReduction[];
}): number {
  const commercial =
    args.commercialTotal != null
      ? round2(args.commercialTotal)
      : invoiceOpenArBalance({
          items: args.items ?? [],
          taxRate: args.taxRate ?? 0,
        });
  const toVoided = (rows: DatedReduction[] | undefined) =>
    (rows ?? []).map((r) => ({
      amount: r.amount,
      date: r.date,
      voided: r.voided ?? r.active === false,
    }));
  return historicalOpenArAsOf({
    commercialTotal: commercial,
    asOfDate: args.asOfDate,
    voidedOnOrBeforeAsOf: args.voidedOnOrBeforeAsOf,
    payments: toVoided(args.payments),
    credits: toVoided(args.credits),
    deposits: toVoided(args.deposits),
    writeOffs: toVoided(args.writeOffs),
  });
}

/** Historical AP remaining as-of: bill total − payments dated ≤ asOf. */
export function historicalApRemainingAsOf(args: {
  billTotal: number;
  asOfDate: string;
  billDate: string;
  voidedAt?: string | null;
  payments?: { amount: number; date: string; voided?: boolean }[];
}): number {
  if (args.billDate > args.asOfDate) return 0;
  if (args.voidedAt && args.voidedAt <= args.asOfDate) return 0;
  const paid = round2(
    (args.payments ?? [])
      .filter((p) => !p.voided && p.date <= args.asOfDate)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0),
  );
  return round2(Math.max(0, round2(args.billTotal) - paid));
}

/**
 * Cutover verdict mirroring acct_cutover_readiness_snapshot:
 * blockers OR PITR unconfirmed → NOT_READY.
 */
export function assessP5CutoverVerdict(args: {
  blockers: string[];
  pitrConfirmed: boolean;
  accountantValidated: boolean;
}): "NOT_READY" | "READY_FOR_PILOT" | "READY_FOR_CUTOVER" {
  if (args.blockers.length > 0 || !args.pitrConfirmed) return "NOT_READY";
  if (!args.accountantValidated) return "READY_FOR_PILOT";
  return "READY_FOR_CUTOVER";
}

export function agingBucketForDays(
  daysPastDue: number,
): AgingBucketKey {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 30) return "1-30";
  if (daysPastDue <= 60) return "31-60";
  if (daysPastDue <= 90) return "61-90";
  return "90+";
}

/** Assets = Liabilities + Equity (with income) within penny tolerance. */
export function balanceSheetEquationHolds(args: {
  assets: number;
  liabilities: number;
  equityWithIncome: number;
}): boolean {
  const right = round2(args.liabilities + args.equityWithIncome);
  return Math.abs(round2(args.assets) - right) <= 0.005;
}

export function trialBalanceEquationHolds(
  totalDebits: number,
  totalCredits: number,
): boolean {
  return Math.abs(round2(totalDebits) - round2(totalCredits)) <= 0.005;
}
