/**
 * F3 ledger reports — Trial Balance, Accounting P&L, Balance Sheet, cash foundation.
 * Derived ONLY from posted journal lines (not Pulse/ops finance).
 */
import type { GlAccountLike, GlAccountType } from "@/lib/accounting/types";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface PostedLineForReport {
  accountId: string;
  debit: number;
  credit: number;
  entryDate: string;
  entryStatus: string;
  isReversal?: boolean;
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  accountType: GlAccountType;
  /** Current presentation metadata — does not gate historical inclusion. */
  isActive?: boolean;
  totalDebit: number;
  totalCredit: number;
  /** Natural ending balance (debit-nature positive for assets/expenses). */
  balance: number;
}

export function isDebitNormal(type: GlAccountType): boolean {
  return type === "asset" || type === "expense";
}

export function accountNaturalBalance(
  type: GlAccountType,
  totalDebit: number,
  totalCredit: number,
): number {
  const d = round2(totalDebit);
  const c = round2(totalCredit);
  return isDebitNormal(type) ? round2(d - c) : round2(c - d);
}

export function buildTrialBalance(args: {
  accounts: GlAccountLike[];
  lines: PostedLineForReport[];
  asOfDate?: string; // inclusive
}): {
  rows: TrialBalanceRow[];
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
  criticalError: string | null;
} {
  const byId = new Map<string, { debit: number; credit: number }>();
  for (const line of args.lines) {
    if (line.entryStatus !== "posted") continue;
    if (args.asOfDate && line.entryDate > args.asOfDate) continue;
    const cur = byId.get(line.accountId) ?? { debit: 0, credit: 0 };
    cur.debit = round2(cur.debit + (Number(line.debit) || 0));
    cur.credit = round2(cur.credit + (Number(line.credit) || 0));
    byId.set(line.accountId, cur);
  }

  const rows: TrialBalanceRow[] = [];
  // Include inactive accounts that have posted history — is_active is presentation only.
  for (const acct of args.accounts) {
    const totals = byId.get(acct.id) ?? { debit: 0, credit: 0 };
    if (totals.debit === 0 && totals.credit === 0) continue;
    rows.push({
      accountId: acct.id,
      code: acct.code,
      name: acct.name,
      accountType: acct.account_type,
      isActive: acct.is_active !== false,
      totalDebit: totals.debit,
      totalCredit: totals.credit,
      balance: accountNaturalBalance(
        acct.account_type,
        totals.debit,
        totals.credit,
      ),
    });
  }
  rows.sort((a, b) => a.code.localeCompare(b.code));

  const totalDebits = round2(rows.reduce((s, r) => s + r.totalDebit, 0));
  const totalCredits = round2(rows.reduce((s, r) => s + r.totalCredit, 0));
  const balanced = Math.abs(totalDebits - totalCredits) <= 0.005;
  return {
    rows,
    totalDebits,
    totalCredits,
    balanced,
    criticalError: balanced
      ? null
      : `CRITICAL: Trial Balance out of balance — debits ${totalDebits.toFixed(2)} vs credits ${totalCredits.toFixed(2)}.`,
  };
}

export interface AccountingPnL {
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  netIncome: number;
  label: "ACCOUNTING_PNL";
}

export function buildAccountingPnL(args: {
  accounts: GlAccountLike[];
  lines: PostedLineForReport[];
  startDate: string;
  endDate: string;
}): AccountingPnL {
  const acct = new Map(args.accounts.map((a) => [a.id, a]));
  let revenue = 0;
  let cogs = 0;
  let opex = 0;
  for (const line of args.lines) {
    if (line.entryStatus !== "posted") continue;
    if (line.entryDate < args.startDate || line.entryDate > args.endDate) {
      continue;
    }
    const a = acct.get(line.accountId);
    if (!a) continue;
    const netCredit = round2((Number(line.credit) || 0) - (Number(line.debit) || 0));
    const netDebit = round2((Number(line.debit) || 0) - (Number(line.credit) || 0));
    if (a.account_type === "revenue") {
      // Contra-revenue (discounts) reduces revenue via debit-heavy activity
      revenue = round2(revenue + netCredit);
    } else if (a.account_type === "expense") {
      if ((a.subtype ?? "") === "cogs") {
        cogs = round2(cogs + netDebit);
      } else {
        opex = round2(opex + netDebit);
      }
    }
  }
  const grossProfit = round2(revenue - cogs);
  return {
    revenue,
    cogs,
    grossProfit,
    operatingExpenses: opex,
    netIncome: round2(grossProfit - opex),
    label: "ACCOUNTING_PNL",
  };
}

export interface BalanceSheetReport {
  assets: number;
  liabilities: number;
  equity: number;
  /** Equity including current-period net income rolled into equity presentation. */
  equityWithIncome: number;
  balanced: boolean;
  criticalError: string | null;
  label: "ACCOUNTING_BALANCE_SHEET";
}

export function buildBalanceSheet(args: {
  accounts: GlAccountLike[];
  lines: PostedLineForReport[];
  asOfDate: string;
  /** Net income through asOfDate to present Assets = L + E. */
  netIncomeToDate: number;
}): BalanceSheetReport {
  const tb = buildTrialBalance({
    accounts: args.accounts,
    lines: args.lines,
    asOfDate: args.asOfDate,
  });
  let assets = 0;
  let liabilities = 0;
  let equity = 0;
  for (const row of tb.rows) {
    if (row.accountType === "asset") assets = round2(assets + row.balance);
    else if (row.accountType === "liability")
      liabilities = round2(liabilities + row.balance);
    else if (row.accountType === "equity")
      equity = round2(equity + row.balance);
  }
  // Revenue/expense already net into netIncomeToDate for BS presentation
  const equityWithIncome = round2(equity + args.netIncomeToDate);
  const right = round2(liabilities + equityWithIncome);
  const balanced = Math.abs(assets - right) <= 0.005;
  return {
    assets,
    liabilities,
    equity,
    equityWithIncome,
    balanced,
    criticalError: balanced
      ? null
      : `CRITICAL: Balance Sheet out of balance — Assets ${assets.toFixed(2)} vs Liabilities+Equity ${right.toFixed(2)}.`,
    label: "ACCOUNTING_BALANCE_SHEET",
  };
}

export interface CashMovementReport {
  cashIn: number;
  cashOut: number;
  netChange: number;
  label: "ACCOUNTING_CASH_MOVEMENT";
  note: string;
}

/** Simple cash movement from posted lines on cash / undeposited accounts. */
export function buildCashMovement(args: {
  cashAccountIds: string[];
  lines: PostedLineForReport[];
  startDate: string;
  endDate: string;
}): CashMovementReport {
  const set = new Set(args.cashAccountIds);
  let cashIn = 0;
  let cashOut = 0;
  for (const line of args.lines) {
    if (line.entryStatus !== "posted") continue;
    if (!set.has(line.accountId)) continue;
    if (line.entryDate < args.startDate || line.entryDate > args.endDate) {
      continue;
    }
    cashIn = round2(cashIn + (Number(line.debit) || 0));
    cashOut = round2(cashOut + (Number(line.credit) || 0));
  }
  return {
    cashIn,
    cashOut,
    netChange: round2(cashIn - cashOut),
    label: "ACCOUNTING_CASH_MOVEMENT",
    note: "Foundation cash movement only — not full GAAP operating/investing/financing classification.",
  };
}

export interface GeneralLedgerRow {
  entryDate: string;
  journalEntryId: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  memo: string | null;
  customerId: string | null;
  invoiceId: string | null;
  billId: string | null;
}

/** General ledger detail from posted journal lines. */
export function buildGeneralLedger(args: {
  accounts: GlAccountLike[];
  lines: (PostedLineForReport & {
    journalEntryId: string;
    memo?: string | null;
    customerId?: string | null;
    invoiceId?: string | null;
    billId?: string | null;
  })[];
  startDate?: string;
  endDate?: string;
  accountId?: string;
}): GeneralLedgerRow[] {
  const acct = new Map(args.accounts.map((a) => [a.id, a]));
  const rows: GeneralLedgerRow[] = [];
  for (const line of args.lines) {
    if (line.entryStatus !== "posted") continue;
    if (args.startDate && line.entryDate < args.startDate) continue;
    if (args.endDate && line.entryDate > args.endDate) continue;
    if (args.accountId && line.accountId !== args.accountId) continue;
    const a = acct.get(line.accountId);
    if (!a) continue;
    rows.push({
      entryDate: line.entryDate,
      journalEntryId: line.journalEntryId,
      accountId: line.accountId,
      accountCode: a.code,
      accountName: a.name,
      debit: round2(Number(line.debit) || 0),
      credit: round2(Number(line.credit) || 0),
      memo: line.memo ?? null,
      customerId: line.customerId ?? null,
      invoiceId: line.invoiceId ?? null,
      billId: line.billId ?? null,
    });
  }
  rows.sort((a, b) =>
    a.entryDate.localeCompare(b.entryDate) ||
    a.accountCode.localeCompare(b.accountCode),
  );
  return rows;
}

export interface AgingBucketRow {
  sourceId: string;
  reference: string;
  dueDate: string | null;
  balance: number;
  bucket: "current" | "1-30" | "31-60" | "61-90" | "90+";
  daysPastDue: number;
}

function agingBucket(daysPastDue: number): AgingBucketRow["bucket"] {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 30) return "1-30";
  if (daysPastDue <= 60) return "31-60";
  if (daysPastDue <= 90) return "61-90";
  return "90+";
}

/** AR aging from remaining invoice balances (payments, credits, write-offs). */
export function buildArAging(args: {
  asOfDate: string;
  invoices: {
    id: string;
    number?: string | null;
    due_date: string | null;
    issue_date: string | null;
    status: string;
    balance: number;
  }[];
}): {
  rows: AgingBucketRow[];
  totals: Record<AgingBucketRow["bucket"], number>;
  total: number;
  label: "AR_AGING";
} {
  const totals: Record<AgingBucketRow["bucket"], number> = {
    current: 0,
    "1-30": 0,
    "31-60": 0,
    "61-90": 0,
    "90+": 0,
  };
  const rows: AgingBucketRow[] = [];
  const asOf = new Date(args.asOfDate).getTime();

  for (const inv of args.invoices) {
    if (inv.status === "void") continue;
    const bal = round2(inv.balance);
    if (bal <= 0.005) continue;
    const due = inv.due_date ?? inv.issue_date;
    const dueMs = due ? new Date(due).getTime() : asOf;
    const daysPastDue = Math.floor((asOf - dueMs) / 86400000);
    const bucket = agingBucket(daysPastDue);
    totals[bucket] = round2(totals[bucket] + bal);
    rows.push({
      sourceId: inv.id,
      reference: inv.number ?? inv.id.slice(0, 8),
      dueDate: due,
      balance: bal,
      bucket,
      daysPastDue: Math.max(0, daysPastDue),
    });
  }

  const total = round2(Object.values(totals).reduce((s, v) => s + v, 0));
  return { rows, totals, total, label: "AR_AGING" };
}

/** AP aging from open vendor bill balances. */
export function buildApAging(args: {
  asOfDate: string;
  bills: {
    id: string;
    bill_number: string | null;
    due_date: string | null;
    bill_date: string;
    status: string;
    balance: number;
  }[];
}): {
  rows: AgingBucketRow[];
  totals: Record<AgingBucketRow["bucket"], number>;
  total: number;
  label: "AP_AGING";
} {
  const totals: Record<AgingBucketRow["bucket"], number> = {
    current: 0,
    "1-30": 0,
    "31-60": 0,
    "61-90": 0,
    "90+": 0,
  };
  const rows: AgingBucketRow[] = [];
  const asOf = new Date(args.asOfDate).getTime();

  for (const bill of args.bills) {
    if (bill.status === "void") continue;
    const bal = round2(bill.balance);
    if (bal <= 0.005) continue;
    const due = bill.due_date ?? bill.bill_date;
    const dueMs = due ? new Date(due).getTime() : asOf;
    const daysPastDue = Math.floor((asOf - dueMs) / 86400000);
    const bucket = agingBucket(daysPastDue);
    totals[bucket] = round2(totals[bucket] + bal);
    rows.push({
      sourceId: bill.id,
      reference: bill.bill_number ?? bill.id.slice(0, 8),
      dueDate: due,
      balance: bal,
      bucket,
      daysPastDue: Math.max(0, daysPastDue),
    });
  }

  const total = round2(Object.values(totals).reduce((s, v) => s + v, 0));
  return { rows, totals, total, label: "AP_AGING" };
}
