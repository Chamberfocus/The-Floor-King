/**
 * F6-P5 Accounting report data loaders.
 *
 * Prefer SECURITY DEFINER report RPCs from migration 0177
 * (`acct_report_*`, `acct_exceptions_scan`, etc.).
 *
 * Fallback (documented): when an RPC is missing (migration unapplied), fall back
 * to pure TS builders in `src/lib/accounting/reports.ts` + `listPostedJournalLines`
 * / operational lists so local UI still works pre-apply. Fallback results are
 * labeled `source: "ts_fallback"` and are never treated as official books.
 */
import { createClient } from "@/lib/supabase/server";
import {
  getAccountMappings,
  getAccountingSettings,
  listGlAccounts,
  listPostedJournalLines,
} from "@/lib/data/accounting";
import {
  buildAccountingPnL,
  buildApAging,
  buildArAging,
  buildBalanceSheet,
  buildGeneralLedger,
  buildTrialBalance,
  type AgingBucketRow,
  type AccountingPnL,
  type BalanceSheetReport,
  type GeneralLedgerRow,
  type TrialBalanceRow,
} from "@/lib/accounting/reports";
import { buildCutoverReadinessReport } from "@/lib/accounting/cutover-report";
import {
  parseAcctReportBoolean,
  parseAcctReportJson,
  parseAcctReportNumber,
} from "@/lib/accounting/control-center";
import { ACCOUNTING_NOT_BOOKS_MESSAGE } from "@/lib/accounting/types";
import { listInvoices, invoiceAmountDue } from "@/lib/data/invoices";
import { listBills } from "@/lib/data/bills";

export type ReportSource = "rpc" | "ts_fallback";

export interface BooksStatusPayload {
  posting_enabled: boolean;
  books_of_record: boolean;
  official_books: boolean;
  message: string;
  label: string;
}

export interface ReportMeta {
  source: ReportSource;
  fallbackReason?: string;
  books: BooksStatusPayload;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIso(d = todayIso()): string {
  return `${d.slice(0, 7)}-01`;
}

function isMissingRpc(error: {
  message?: string;
  code?: string;
} | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  const code = error.code ?? "";
  return (
    code === "PGRST202" ||
    code === "42883" ||
    msg.includes("could not find the function") ||
    msg.includes("function public.acct_") ||
    (msg.includes("does not exist") && msg.includes("function"))
  );
}

async function booksFromSettings(): Promise<BooksStatusPayload> {
  const settings = await getAccountingSettings();
  const official =
    Boolean(settings.posting_enabled) && Boolean(settings.books_of_record);
  return {
    posting_enabled: settings.posting_enabled,
    books_of_record: settings.books_of_record,
    official_books: official,
    message: official
      ? "CRM ledger flags indicate books-of-record mode (owner-validated)."
      : ACCOUNTING_NOT_BOOKS_MESSAGE,
    label: "ACCT_BOOKS_STATUS",
  };
}

function booksFromRpcPayload(
  books: unknown,
  fallback: BooksStatusPayload,
): BooksStatusPayload {
  const b = parseAcctReportJson<Record<string, unknown>>(books);
  if (!b) return fallback;
  return {
    posting_enabled: parseAcctReportBoolean(
      b.posting_enabled,
      fallback.posting_enabled,
    ),
    books_of_record: parseAcctReportBoolean(
      b.books_of_record,
      fallback.books_of_record,
    ),
    official_books: parseAcctReportBoolean(
      b.official_books,
      fallback.official_books,
    ),
    message: String(b.message ?? fallback.message),
    label: String(b.label ?? "ACCT_BOOKS_STATUS"),
  };
}

async function rpcJson(
  name: string,
  params: Record<string, unknown>,
): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; missing: boolean; error: string }
> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(name, params);
  if (error) {
    return {
      ok: false,
      missing: isMissingRpc(error),
      error: error.message,
    };
  }
  const parsed = parseAcctReportJson<Record<string, unknown>>(data);
  if (!parsed) {
    return { ok: false, missing: false, error: `${name} returned empty payload.` };
  }
  return { ok: true, data: parsed };
}

// ---------------------------------------------------------------------------
// Trial Balance
// ---------------------------------------------------------------------------

export interface TrialBalanceReportResult extends ReportMeta {
  asOf: string;
  rows: TrialBalanceRow[];
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
  criticalError: string | null;
}

export async function fetchTrialBalance(
  asOf: string,
): Promise<TrialBalanceReportResult> {
  const booksFallback = await booksFromSettings();
  let rpc = await rpcJson("acct_report_trial_balance_as_of", { p_as_of: asOf });
  if (!rpc.ok && rpc.missing) {
    rpc = await rpcJson("acct_report_trial_balance", {
      p_start: "1970-01-01",
      p_end: asOf,
      p_include_zero: false,
    });
  }
  if (rpc.ok) {
    const rowsRaw = Array.isArray(rpc.data.rows) ? rpc.data.rows : [];
    const rows: TrialBalanceRow[] = rowsRaw.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        accountId: String(row.account_id ?? ""),
        code: String(row.code ?? ""),
        name: String(row.name ?? ""),
        accountType: String(row.account_type ?? "asset") as TrialBalanceRow["accountType"],
        totalDebit: parseAcctReportNumber(
          row.period_debits ?? row.total_debit,
        ),
        totalCredit: parseAcctReportNumber(
          row.period_credits ?? row.total_credit,
        ),
        balance: parseAcctReportNumber(row.ending_balance ?? row.balance),
      };
    });
    return {
      source: "rpc",
      books: booksFromRpcPayload(
        rpc.data.books_status ?? rpc.data.books,
        booksFallback,
      ),
      asOf,
      rows,
      totalDebits: parseAcctReportNumber(
        rpc.data.total_period_debits ?? rpc.data.total_debits,
      ),
      totalCredits: parseAcctReportNumber(
        rpc.data.total_period_credits ?? rpc.data.total_credits,
      ),
      balanced: parseAcctReportBoolean(rpc.data.balanced, true),
      criticalError: rpc.data.critical_error
        ? String(rpc.data.critical_error)
        : null,
    };
  }
  if (!rpc.missing) throw new Error(rpc.error);

  const accounts = await listGlAccounts();
  const lines = await listPostedJournalLines();
  const tb = buildTrialBalance({
    accounts: accounts as never[],
    lines,
    asOfDate: asOf,
  });
  return {
    source: "ts_fallback",
    fallbackReason:
      "acct_report_trial_balance unavailable — using TS buildTrialBalance + posted journal lines.",
    books: booksFallback,
    asOf,
    rows: tb.rows,
    totalDebits: tb.totalDebits,
    totalCredits: tb.totalCredits,
    balanced: tb.balanced,
    criticalError: tb.criticalError,
  };
}

// ---------------------------------------------------------------------------
// P&L
// ---------------------------------------------------------------------------

export interface PnLReportResult extends ReportMeta, AccountingPnL {
  startDate: string;
  endDate: string;
}

export async function fetchPnL(
  start: string,
  end: string,
): Promise<PnLReportResult> {
  const booksFallback = await booksFromSettings();
  const rpc = await rpcJson("acct_report_pnl", {
    p_start: start,
    p_end: end,
  });
  if (rpc.ok) {
    return {
      source: "rpc",
      books: booksFromRpcPayload(rpc.data.books_status ?? rpc.data.books, booksFallback),
      startDate: start,
      endDate: end,
      revenue: parseAcctReportNumber(rpc.data.revenue),
      cogs: parseAcctReportNumber(rpc.data.cogs),
      grossProfit: parseAcctReportNumber(rpc.data.gross_profit),
      operatingExpenses: parseAcctReportNumber(rpc.data.operating_expenses),
      netIncome: parseAcctReportNumber(rpc.data.net_income),
      label: "ACCOUNTING_PNL",
    };
  }
  if (!rpc.missing) throw new Error(rpc.error);

  const accounts = await listGlAccounts();
  const lines = await listPostedJournalLines({
    startDate: start,
    endDate: end,
  });
  const pnl = buildAccountingPnL({
    accounts: accounts as never[],
    lines,
    startDate: start,
    endDate: end,
  });
  return {
    source: "ts_fallback",
    fallbackReason:
      "acct_report_pnl unavailable — using TS buildAccountingPnL + posted journal lines.",
    books: booksFallback,
    startDate: start,
    endDate: end,
    ...pnl,
  };
}

// ---------------------------------------------------------------------------
// Balance Sheet
// ---------------------------------------------------------------------------

export interface BalanceSheetReportResult extends ReportMeta, BalanceSheetReport {
  asOf: string;
}

export async function fetchBalanceSheet(
  asOf: string,
): Promise<BalanceSheetReportResult> {
  const booksFallback = await booksFromSettings();
  const rpc = await rpcJson("acct_report_balance_sheet", { p_as_of: asOf });
  if (rpc.ok) {
    return {
      source: "rpc",
      books: booksFromRpcPayload(rpc.data.books_status ?? rpc.data.books, booksFallback),
      asOf,
      assets: parseAcctReportNumber(rpc.data.assets),
      liabilities: parseAcctReportNumber(rpc.data.liabilities),
      equity: parseAcctReportNumber(rpc.data.equity),
      equityWithIncome: parseAcctReportNumber(rpc.data.equity_with_income),
      balanced: parseAcctReportBoolean(rpc.data.balanced, true),
      criticalError: rpc.data.critical_error
        ? String(rpc.data.critical_error)
        : null,
      label: "ACCOUNTING_BALANCE_SHEET",
    };
  }
  if (!rpc.missing) throw new Error(rpc.error);

  const accounts = await listGlAccounts();
  const lines = await listPostedJournalLines();
  const ni = buildAccountingPnL({
    accounts: accounts as never[],
    lines,
    startDate: "1970-01-01",
    endDate: asOf,
  }).netIncome;
  const bs = buildBalanceSheet({
    accounts: accounts as never[],
    lines,
    asOfDate: asOf,
    netIncomeToDate: ni,
  });
  return {
    source: "ts_fallback",
    fallbackReason:
      "acct_report_balance_sheet unavailable — using TS buildBalanceSheet + posted journal lines.",
    books: booksFallback,
    asOf,
    ...bs,
  };
}

// ---------------------------------------------------------------------------
// General Ledger
// ---------------------------------------------------------------------------

export interface GeneralLedgerReportResult extends ReportMeta {
  startDate: string;
  endDate: string;
  accountId: string | null;
  rows: GeneralLedgerRow[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
}

export async function fetchGeneralLedger(args: {
  startDate: string;
  endDate: string;
  accountId?: string | null;
  limit?: number;
  offset?: number;
}): Promise<GeneralLedgerReportResult> {
  const limit = Math.max(1, Math.min(args.limit ?? 100, 1000));
  const offset = Math.max(0, args.offset ?? 0);
  const booksFallback = await booksFromSettings();
  const rpc = await rpcJson("acct_report_general_ledger", {
    p_start: args.startDate,
    p_end: args.endDate,
    p_account_id: args.accountId ?? null,
    p_limit: limit,
    p_offset: offset,
  });
  if (rpc.ok) {
    const rowsRaw = Array.isArray(rpc.data.rows) ? rpc.data.rows : [];
    const pag = parseAcctReportJson<Record<string, unknown>>(rpc.data.pagination);
    const rows: GeneralLedgerRow[] = rowsRaw.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        entryDate: String(row.entry_date ?? ""),
        journalEntryId: String(row.journal_entry_id ?? ""),
        accountId: String(row.account_id ?? ""),
        accountCode: String(row.account_code ?? ""),
        accountName: String(row.account_name ?? ""),
        debit: parseAcctReportNumber(row.debit),
        credit: parseAcctReportNumber(row.credit),
        memo: (row.memo as string | null) ?? null,
        customerId: (row.customer_id as string | null) ?? null,
        invoiceId: (row.invoice_id as string | null) ?? null,
        billId: (row.bill_id as string | null) ?? null,
      };
    });
    return {
      source: "rpc",
      books: booksFromRpcPayload(rpc.data.books_status ?? rpc.data.books, booksFallback),
      startDate: args.startDate,
      endDate: args.endDate,
      accountId: args.accountId ?? null,
      rows,
      pagination: {
        limit: parseAcctReportNumber(pag?.limit, limit),
        offset: parseAcctReportNumber(pag?.offset, offset),
        total: parseAcctReportNumber(pag?.total, rows.length),
        hasMore: parseAcctReportBoolean(pag?.has_more, false),
      },
    };
  }
  if (!rpc.missing) throw new Error(rpc.error);

  const accounts = await listGlAccounts();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("journal_lines")
    .select(
      "id, account_id, debit, credit, memo, customer_id, invoice_id, bill_id, journal_entry:journal_entries!inner(id, entry_date, status)",
    );
  if (error) throw new Error(error.message);
  const lines = [];
  for (const row of data ?? []) {
    const je = row.journal_entry as unknown as {
      id: string;
      entry_date: string;
      status: string;
    };
    if (je.status !== "posted") continue;
    lines.push({
      accountId: row.account_id as string,
      debit: Number(row.debit) || 0,
      credit: Number(row.credit) || 0,
      entryDate: je.entry_date,
      entryStatus: je.status,
      journalEntryId: je.id,
      memo: (row.memo as string | null) ?? null,
      customerId: (row.customer_id as string | null) ?? null,
      invoiceId: (row.invoice_id as string | null) ?? null,
      billId: (row.bill_id as string | null) ?? null,
    });
  }
  const all = buildGeneralLedger({
    accounts: accounts as never[],
    lines,
    startDate: args.startDate,
    endDate: args.endDate,
    accountId: args.accountId ?? undefined,
  });
  const slice = all.slice(offset, offset + limit);
  return {
    source: "ts_fallback",
    fallbackReason:
      "acct_report_general_ledger unavailable — using TS buildGeneralLedger + posted journal lines.",
    books: booksFallback,
    startDate: args.startDate,
    endDate: args.endDate,
    accountId: args.accountId ?? null,
    rows: slice,
    pagination: {
      limit,
      offset,
      total: all.length,
      hasMore: offset + limit < all.length,
    },
  };
}

// ---------------------------------------------------------------------------
// AR / AP aging
// ---------------------------------------------------------------------------

export interface AgingReportResult extends ReportMeta {
  asOf: string;
  rows: AgingBucketRow[];
  totals: Record<AgingBucketRow["bucket"], number>;
  total: number;
  label: "AR_AGING" | "AP_AGING";
}

function mapAgingFromRpc(
  data: Record<string, unknown>,
  asOf: string,
  label: "AR_AGING" | "AP_AGING",
  books: BooksStatusPayload,
): AgingReportResult {
  const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
  const totalsRaw =
    parseAcctReportJson<Record<string, unknown>>(data.totals) ?? {};
  const rows: AgingBucketRow[] = rowsRaw.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      sourceId: String(row.source_id ?? row.invoice_id ?? row.bill_id ?? ""),
      reference: String(row.reference ?? ""),
      dueDate: (row.due_date as string | null) ?? null,
      balance: parseAcctReportNumber(row.balance),
      bucket: String(row.bucket ?? "current") as AgingBucketRow["bucket"],
      daysPastDue: parseAcctReportNumber(row.days_past_due),
    };
  });
  const totals: Record<AgingBucketRow["bucket"], number> = {
    current: parseAcctReportNumber(totalsRaw.current),
    "1-30": parseAcctReportNumber(totalsRaw["1-30"]),
    "31-60": parseAcctReportNumber(totalsRaw["31-60"]),
    "61-90": parseAcctReportNumber(totalsRaw["61-90"]),
    "90+": parseAcctReportNumber(totalsRaw["90+"]),
  };
  return {
    source: "rpc",
    books,
    asOf,
    rows,
    totals,
    total: parseAcctReportNumber(data.total),
    label,
  };
}

export async function fetchArAging(asOf: string): Promise<AgingReportResult> {
  const booksFallback = await booksFromSettings();
  const rpc = await rpcJson("acct_report_ar_aging", { p_as_of: asOf });
  if (rpc.ok) {
    return mapAgingFromRpc(
      rpc.data,
      asOf,
      "AR_AGING",
      booksFromRpcPayload(rpc.data.books_status ?? rpc.data.books, booksFallback),
    );
  }
  if (!rpc.missing) throw new Error(rpc.error);

  const invoices = await listInvoices();
  const aging = buildArAging({
    asOfDate: asOf,
    invoices: invoices.map((inv) => ({
      id: inv.id,
      number: inv.number,
      due_date: inv.due_date,
      issue_date: inv.issue_date,
      status: inv.status,
      balance: invoiceAmountDue(inv),
    })),
  });
  return {
    source: "ts_fallback",
    fallbackReason:
      "acct_report_ar_aging unavailable — using TS buildArAging + current open AR.",
    books: booksFallback,
    asOf,
    ...aging,
  };
}

export async function fetchApAging(asOf: string): Promise<AgingReportResult> {
  const booksFallback = await booksFromSettings();
  const rpc = await rpcJson("acct_report_ap_aging", { p_as_of: asOf });
  if (rpc.ok) {
    return mapAgingFromRpc(
      rpc.data,
      asOf,
      "AP_AGING",
      booksFromRpcPayload(rpc.data.books_status ?? rpc.data.books, booksFallback),
    );
  }
  if (!rpc.missing) throw new Error(rpc.error);

  const bills = await listBills();
  const aging = buildApAging({
    asOfDate: asOf,
    bills: bills.map((b) => ({
      id: b.id,
      bill_number: b.bill_number,
      due_date: b.due_date,
      bill_date: b.bill_date,
      status: b.ap_lifecycle === "void" ? "void" : b.status,
      balance: b.balance,
    })),
  });
  return {
    source: "ts_fallback",
    fallbackReason:
      "acct_report_ap_aging unavailable — using TS buildApAging + bill remaining.",
    books: booksFallback,
    asOf,
    ...aging,
  };
}

// ---------------------------------------------------------------------------
// Exceptions / cutover / recons
// ---------------------------------------------------------------------------

export interface ExceptionItem {
  code: string;
  severity: string;
  message: string;
  detail?: unknown;
}

export interface ExceptionsReportResult extends ReportMeta {
  asOf: string;
  exceptions: ExceptionItem[];
  counts: {
    critical: number;
    high: number;
    warning: number;
    expected_not_active: number;
  };
}

export async function fetchExceptions(): Promise<ExceptionsReportResult> {
  const booksFallback = await booksFromSettings();
  const asOf = todayIso();
  const rpc = await rpcJson("acct_exceptions_scan", {});
  if (rpc.ok) {
    const itemsRaw = Array.isArray(rpc.data.exceptions)
      ? rpc.data.exceptions
      : [];
    const counts =
      parseAcctReportJson<Record<string, unknown>>(rpc.data.counts) ?? {};
    return {
      source: "rpc",
      books: booksFallback,
      asOf: String(rpc.data.as_of ?? asOf),
      exceptions: itemsRaw.map((e) => {
        const row = e as Record<string, unknown>;
        return {
          code: String(row.code ?? ""),
          severity: String(row.severity ?? "WARNING"),
          message: String(row.message ?? ""),
          detail: row.detail,
        };
      }),
      counts: {
        critical: parseAcctReportNumber(counts.critical),
        high: parseAcctReportNumber(counts.high),
        warning: parseAcctReportNumber(counts.warning),
        expected_not_active: parseAcctReportNumber(counts.expected_not_active),
      },
    };
  }
  if (!rpc.missing) throw new Error(rpc.error);

  const [tb, bs] = await Promise.all([
    fetchTrialBalance(asOf),
    fetchBalanceSheet(asOf),
  ]);
  const exceptions: ExceptionItem[] = [];
  if (!tb.balanced) {
    exceptions.push({
      code: "TRIAL_BALANCE_OUT",
      severity: "CRITICAL",
      message: tb.criticalError ?? "Trial Balance out of balance.",
    });
  }
  if (!bs.balanced) {
    exceptions.push({
      code: "BALANCE_SHEET_OUT",
      severity: "CRITICAL",
      message: bs.criticalError ?? "Balance Sheet out of balance.",
    });
  }
  if (!booksFallback.posting_enabled) {
    exceptions.push({
      code: "POSTING_NOT_ACTIVE",
      severity: "EXPECTED_NOT_ACTIVE",
      message:
        "Automatic posting is off — control recons are expected not active until cutover.",
    });
  }
  const counts = {
    critical: exceptions.filter((e) => e.severity === "CRITICAL").length,
    high: exceptions.filter((e) => e.severity === "HIGH").length,
    warning: exceptions.filter((e) => e.severity === "WARNING").length,
    expected_not_active: exceptions.filter(
      (e) => e.severity === "EXPECTED_NOT_ACTIVE",
    ).length,
  };
  return {
    source: "ts_fallback",
    fallbackReason:
      "acct_exceptions_scan unavailable — using TB/BS + posting-off stub exceptions.",
    books: booksFallback,
    asOf,
    exceptions,
    counts,
  };
}

export interface CutoverSnapshotResult extends ReportMeta {
  verdict: string;
  blockers: string[];
  warnings: string[];
  checklist: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export async function fetchCutoverSnapshot(): Promise<CutoverSnapshotResult> {
  const booksFallback = await booksFromSettings();
  const rpc = await rpcJson("acct_cutover_readiness_snapshot", {});
  if (rpc.ok) {
    const blockers = Array.isArray(rpc.data.blockers)
      ? rpc.data.blockers.map(String)
      : [];
    const warnings = Array.isArray(rpc.data.warnings)
      ? rpc.data.warnings.map(String)
      : [];
    return {
      source: "rpc",
      books: booksFallback,
      verdict: String(rpc.data.verdict ?? "NOT_READY"),
      blockers,
      warnings,
      checklist:
        parseAcctReportJson<Record<string, unknown>>(rpc.data.checklist) ?? {},
      raw: rpc.data,
    };
  }
  if (!rpc.missing) throw new Error(rpc.error);

  const settings = await getAccountingSettings();
  const mappings = await getAccountMappings();
  const supabase = await createClient();
  const { data: pmRows } = await supabase
    .from("accounting_payment_method_mappings")
    .select("payment_method, account_id");
  const paymentMethodMappings = Object.fromEntries(
    (pmRows ?? []).map((r) => [r.payment_method as string, r.account_id as string]),
  );
  const asOf = todayIso();
  const [tb, bs] = await Promise.all([
    fetchTrialBalance(asOf),
    fetchBalanceSheet(asOf),
  ]);
  const report = buildCutoverReadinessReport({
    mappings,
    paymentMethodMappings,
    settings: {
      posting_enabled: settings.posting_enabled,
      books_of_record: settings.books_of_record,
      cutover_date: settings.cutover_date,
      opening_balances_entered: settings.opening_balances_entered,
      accountant_validated: settings.accountant_validated,
      backup_pitr_confirmed_at: settings.backup_pitr_confirmed_at,
    },
    counts: {
      failedOutbox: 0,
      pendingCriticalOutbox: 0,
      taxReviewRequired: 0,
      unclassifiedDeposits: 0,
      billsNeedingCategory: 0,
      legacyDepositAmbiguous: 0,
    },
    financials: {
      trialBalanceBalanced: tb.balanced,
      balanceSheetBalanced: bs.balanced,
      bankReconComplete: false,
    },
  });
  return {
    source: "ts_fallback",
    fallbackReason:
      "acct_cutover_readiness_snapshot unavailable — using TS buildCutoverReadinessReport.",
    books: booksFallback,
    verdict: report.verdict,
    blockers: report.blockers,
    warnings: report.warnings,
    checklist: report.checklist as unknown as Record<string, unknown>,
    raw: report as unknown as Record<string, unknown>,
  };
}

export interface ReconsResult extends ReportMeta {
  asOf: string;
  ar: Record<string, unknown> | null;
  ap: Record<string, unknown> | null;
  inventory: Record<string, unknown> | null;
  cash: Record<string, unknown> | null;
}

export async function fetchRecons(asOf: string): Promise<ReconsResult> {
  const booksFallback = await booksFromSettings();
  const [ar, ap, inv, cash] = await Promise.all([
    rpcJson("acct_recon_ar_control", { p_as_of: asOf }),
    rpcJson("acct_recon_ap_control", { p_as_of: asOf }),
    rpcJson("acct_recon_inventory_control", {}),
    rpcJson("acct_recon_cash_book", { p_as_of: asOf }),
  ]);

  const anyMissing =
    (!ar.ok && ar.missing) ||
    (!ap.ok && ap.missing) ||
    (!inv.ok && inv.missing) ||
    (!cash.ok && cash.missing);

  if (
    ar.ok &&
    ap.ok &&
    inv.ok &&
    cash.ok
  ) {
    return {
      source: "rpc",
      books: booksFallback,
      asOf,
      ar: ar.data,
      ap: ap.data,
      inventory: inv.data,
      cash: cash.data,
    };
  }

  if (!anyMissing) {
    const firstErr = [ar, ap, inv, cash].find((r) => !r.ok && !r.missing);
    if (firstErr && !firstErr.ok) throw new Error(firstErr.error);
  }

  const stub = (code: string): Record<string, unknown> => ({
    status: "NOT_ACTIVE",
    code,
    message: "Control recon unavailable until migration 0177 is applied.",
  });

  return {
    source: "ts_fallback",
    fallbackReason:
      "acct_recon_* unavailable — returning NOT_ACTIVE stubs (posting still off).",
    books: booksFallback,
    asOf,
    ar: ar.ok ? ar.data : stub("AR_CONTROL_NOT_ACTIVE"),
    ap: ap.ok ? ap.data : stub("AP_CONTROL_NOT_ACTIVE"),
    inventory: inv.ok ? inv.data : stub("INVENTORY_CONTROL_NOT_ACTIVE"),
    cash: cash.ok ? cash.data : stub("CASH_BOOK_NOT_ACTIVE"),
  };
}

export { todayIso, monthStartIso };
