/**
 * F3 event → balanced journal builders (pure).
 * Inventory perpetual postings are gated OFF unless explicitly enabled.
 */
import { invoiceTotals, type CalcInvoiceItem } from "@/lib/invoice-calc";
import {
  INVENTORY_POSTING_DISABLED_MESSAGE,
  type AccountMappingDict,
  type BuiltJournalEntry,
  type JournalLineInput,
  type SystemAccountKey,
} from "@/lib/accounting/types";
import { assessJournalBalance } from "@/lib/accounting/journal";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function requireMappedAccount(
  mappings: AccountMappingDict,
  key: SystemAccountKey,
): string {
  const id = mappings[key];
  if (!id) {
    throw new Error(`Required accounting mapping missing: ${key}`);
  }
  return id;
}

export function resolveCashAccountId(
  mappings: AccountMappingDict,
  prefer: "cash" | "undeposited" = "undeposited",
): string {
  if (prefer === "cash") {
    return requireMappedAccount(mappings, "cash_operating");
  }
  return requireMappedAccount(mappings, "undeposited_funds");
}

/** Split invoice total into pre-tax revenue + tax using stored tax_rate. */
export function splitInvoiceRevenueTax(
  items: CalcInvoiceItem[],
  taxRate: number | string,
): { subtotal: number; tax: number; total: number } {
  const t = invoiceTotals(items, taxRate, 0);
  return {
    subtotal: round2(t.subtotal),
    tax: round2(t.tax),
    total: round2(t.total),
  };
}

/**
 * Issued/finalized customer invoice:
 * Dr AR  |  Cr Revenue  |  Cr Sales Tax Payable (if tax > 0)
 */
export function buildInvoiceIssueJournal(args: {
  invoiceId: string;
  entryDate: string;
  items: CalcInvoiceItem[];
  taxRate: number | string;
  mappings: AccountMappingDict;
  customerId?: string | null;
  jobId?: string | null;
  description?: string;
}): BuiltJournalEntry {
  const { subtotal, tax, total } = splitInvoiceRevenueTax(
    args.items,
    args.taxRate,
  );
  if (total <= 0.005) {
    throw new Error("Cannot post invoice journal for zero total.");
  }
  const ar = requireMappedAccount(args.mappings, "accounts_receivable");
  const revenue = requireMappedAccount(args.mappings, "default_sales_revenue");
  const taxPayable = requireMappedAccount(args.mappings, "sales_tax_payable");

  const lines: JournalLineInput[] = [
    {
      accountId: ar,
      debit: total,
      memo: "Accounts receivable",
      customerId: args.customerId,
      jobId: args.jobId,
      invoiceId: args.invoiceId,
    },
    {
      accountId: revenue,
      credit: subtotal,
      memo: "Sales revenue",
      customerId: args.customerId,
      jobId: args.jobId,
      invoiceId: args.invoiceId,
    },
  ];
  if (tax > 0.005) {
    lines.push({
      accountId: taxPayable,
      credit: tax,
      memo: "Sales tax payable",
      customerId: args.customerId,
      jobId: args.jobId,
      invoiceId: args.invoiceId,
    });
  }
  const built: BuiltJournalEntry = {
    entryDate: args.entryDate,
    description: args.description ?? `Invoice ${args.invoiceId}`,
    sourceType: "invoice",
    sourceId: args.invoiceId,
    entryKind: "post",
    idempotencyKey: `invoice:${args.invoiceId}:issue`,
    lines,
  };
  const gate = assessJournalBalance(built.lines);
  if (!gate.ok) throw new Error(gate.error);
  return built;
}

/** Customer payment: Dr Cash/UF  Cr AR */
export function buildPaymentJournal(args: {
  paymentId: string;
  invoiceId: string;
  amount: number;
  entryDate: string;
  mappings: AccountMappingDict;
  cashPreference?: "cash" | "undeposited";
  /** Immutable overrides (outbox snapshot) — win over live mappings. */
  cashAccountId?: string;
  arAccountId?: string;
  customerId?: string | null;
  jobId?: string | null;
}): BuiltJournalEntry {
  const amount = round2(args.amount);
  if (!(amount > 0)) throw new Error("Payment amount must be positive.");
  const cash =
    args.cashAccountId ??
    resolveCashAccountId(args.mappings, args.cashPreference ?? "undeposited");
  const ar =
    args.arAccountId ??
    requireMappedAccount(args.mappings, "accounts_receivable");
  const built: BuiltJournalEntry = {
    entryDate: args.entryDate,
    description: `Payment ${args.paymentId}`,
    sourceType: "payment",
    sourceId: args.paymentId,
    entryKind: "post",
    idempotencyKey: `payment:${args.paymentId}:post`,
    lines: [
      {
        accountId: cash,
        debit: amount,
        memo: "Customer payment",
        customerId: args.customerId,
        invoiceId: args.invoiceId,
        jobId: args.jobId,
      },
      {
        accountId: ar,
        credit: amount,
        memo: "Apply to AR",
        customerId: args.customerId,
        invoiceId: args.invoiceId,
        jobId: args.jobId,
      },
    ],
  };
  const gate = assessJournalBalance(built.lines);
  if (!gate.ok) throw new Error(gate.error);
  return built;
}

/**
 * Issued commercial/manual credit (unapplied available credit):
 * Dr Sales Discounts (contra revenue)  Cr Customer Credit Liability
 * Tax-inclusive F1 amount — no fabricated tax split when detail unavailable.
 */
export function buildCreditMemoIssueJournal(args: {
  creditMemoId: string;
  amount: number;
  entryDate: string;
  mappings: AccountMappingDict;
  customerId?: string | null;
  jobId?: string | null;
}): BuiltJournalEntry {
  const amount = round2(args.amount);
  if (!(amount > 0)) throw new Error("Credit amount must be positive.");
  const discounts = requireMappedAccount(args.mappings, "sales_discounts");
  const liability = requireMappedAccount(
    args.mappings,
    "customer_credit_liability",
  );
  const built: BuiltJournalEntry = {
    entryDate: args.entryDate,
    description: `Credit memo ${args.creditMemoId}`,
    sourceType: "credit_memo",
    sourceId: args.creditMemoId,
    entryKind: "post",
    idempotencyKey: `credit_memo:${args.creditMemoId}:issue`,
    lines: [
      {
        accountId: discounts,
        debit: amount,
        memo: "Credit issued (tax-inclusive commercial)",
        customerId: args.customerId,
        jobId: args.jobId,
      },
      {
        accountId: liability,
        credit: amount,
        memo: "Customer credit liability",
        customerId: args.customerId,
        jobId: args.jobId,
      },
    ],
  };
  const gate = assessJournalBalance(built.lines);
  if (!gate.ok) throw new Error(gate.error);
  return built;
}

/** Apply credit to invoice: Dr Customer Credit Liability  Cr AR */
export function buildCreditApplicationJournal(args: {
  applicationId: string;
  amount: number;
  entryDate: string;
  invoiceId: string;
  mappings: AccountMappingDict;
  liabilityAccountId?: string;
  arAccountId?: string;
  customerId?: string | null;
}): BuiltJournalEntry {
  const amount = round2(args.amount);
  if (!(amount > 0)) throw new Error("Application amount must be positive.");
  const liability =
    args.liabilityAccountId ??
    requireMappedAccount(args.mappings, "customer_credit_liability");
  const ar =
    args.arAccountId ??
    requireMappedAccount(args.mappings, "accounts_receivable");
  const built: BuiltJournalEntry = {
    entryDate: args.entryDate,
    description: `Credit application ${args.applicationId}`,
    sourceType: "credit_application",
    sourceId: args.applicationId,
    entryKind: "post",
    idempotencyKey: `credit_application:${args.applicationId}:post`,
    lines: [
      {
        accountId: liability,
        debit: amount,
        memo: "Apply customer credit",
        customerId: args.customerId,
        invoiceId: args.invoiceId,
      },
      {
        accountId: ar,
        credit: amount,
        memo: "Reduce AR",
        customerId: args.customerId,
        invoiceId: args.invoiceId,
      },
    ],
  };
  const gate = assessJournalBalance(built.lines);
  if (!gate.ok) throw new Error(gate.error);
  return built;
}

/** Refund: Dr Customer Credit Liability  Cr Cash */
export function buildRefundJournal(args: {
  refundId: string;
  amount: number;
  entryDate: string;
  mappings: AccountMappingDict;
  cashPreference?: "cash" | "undeposited";
  cashAccountId?: string;
  liabilityAccountId?: string;
  customerId?: string | null;
}): BuiltJournalEntry {
  const amount = round2(args.amount);
  if (!(amount > 0)) throw new Error("Refund amount must be positive.");
  const liability =
    args.liabilityAccountId ??
    requireMappedAccount(args.mappings, "customer_credit_liability");
  const cash =
    args.cashAccountId ??
    resolveCashAccountId(args.mappings, args.cashPreference ?? "cash");
  const built: BuiltJournalEntry = {
    entryDate: args.entryDate,
    description: `Refund ${args.refundId}`,
    sourceType: "refund",
    sourceId: args.refundId,
    entryKind: "post",
    idempotencyKey: `refund:${args.refundId}:post`,
    lines: [
      {
        accountId: liability,
        debit: amount,
        memo: "Consume customer credit",
        customerId: args.customerId,
      },
      {
        accountId: cash,
        credit: amount,
        memo: "Refund cash out",
        customerId: args.customerId,
      },
    ],
  };
  const gate = assessJournalBalance(built.lines);
  if (!gate.ok) throw new Error(gate.error);
  return built;
}

/**
 * Pre-invoice customer deposit (only when explicitly identified):
 * Dr Cash  Cr Customer Deposits
 * Do NOT use for normal invoice payments.
 */
export function buildCustomerDepositJournal(args: {
  depositId: string;
  amount: number;
  entryDate: string;
  mappings: AccountMappingDict;
  cashPreference?: "cash" | "undeposited";
  customerId?: string | null;
}): BuiltJournalEntry {
  const amount = round2(args.amount);
  if (!(amount > 0)) throw new Error("Deposit amount must be positive.");
  const cash = resolveCashAccountId(
    args.mappings,
    args.cashPreference ?? "undeposited",
  );
  const deposits = requireMappedAccount(args.mappings, "customer_deposits");
  const built: BuiltJournalEntry = {
    entryDate: args.entryDate,
    description: `Customer deposit ${args.depositId}`,
    sourceType: "customer_deposit",
    sourceId: args.depositId,
    entryKind: "post",
    idempotencyKey: `customer_deposit:${args.depositId}:post`,
    lines: [
      { accountId: cash, debit: amount, memo: "Deposit received", customerId: args.customerId },
      {
        accountId: deposits,
        credit: amount,
        memo: "Unearned revenue / deposits",
        customerId: args.customerId,
      },
    ],
  };
  const gate = assessJournalBalance(built.lines);
  if (!gate.ok) throw new Error(gate.error);
  return built;
}

/** Vendor bill (accrual): Dr Expense/Inventory  Cr AP — default expense when inventory posting off */
export function buildVendorBillJournal(args: {
  billId: string;
  amount: number;
  entryDate: string;
  mappings: AccountMappingDict;
  inventoryPostingEnabled: boolean;
  treatAsInventoryPurchase?: boolean;
  vendorId?: string | null;
  jobId?: string | null;
}): BuiltJournalEntry {
  const amount = round2(args.amount);
  if (!(amount > 0)) throw new Error("Bill amount must be positive.");
  const ap = requireMappedAccount(args.mappings, "accounts_payable");
  let debitAccount: string;
  let memo: string;
  if (args.treatAsInventoryPurchase) {
    if (!args.inventoryPostingEnabled) {
      throw new Error(INVENTORY_POSTING_DISABLED_MESSAGE);
    }
    debitAccount = requireMappedAccount(args.mappings, "inventory_asset");
    memo = "Inventory purchase";
  } else {
    debitAccount = requireMappedAccount(args.mappings, "default_expense");
    memo = "Vendor bill expense";
  }
  const built: BuiltJournalEntry = {
    entryDate: args.entryDate,
    description: `Vendor bill ${args.billId}`,
    sourceType: "vendor_bill",
    sourceId: args.billId,
    entryKind: "post",
    idempotencyKey: `vendor_bill:${args.billId}:post`,
    lines: [
      {
        accountId: debitAccount,
        debit: amount,
        memo,
        vendorId: args.vendorId,
        jobId: args.jobId,
        billId: args.billId,
      },
      {
        accountId: ap,
        credit: amount,
        memo: "Accounts payable",
        vendorId: args.vendorId,
        billId: args.billId,
      },
    ],
  };
  const gate = assessJournalBalance(built.lines);
  if (!gate.ok) throw new Error(gate.error);
  return built;
}

/** Bill payment: Dr AP  Cr Cash — does NOT re-expense (avoids double-count with bill) */
export function buildBillPaymentJournal(args: {
  billPaymentId: string;
  billId: string;
  amount: number;
  entryDate: string;
  mappings: AccountMappingDict;
  cashAccountId?: string;
  apAccountId?: string;
  vendorId?: string | null;
}): BuiltJournalEntry {
  const amount = round2(args.amount);
  if (!(amount > 0)) throw new Error("Bill payment must be positive.");
  const ap =
    args.apAccountId ?? requireMappedAccount(args.mappings, "accounts_payable");
  const cash =
    args.cashAccountId ?? resolveCashAccountId(args.mappings, "cash");
  const built: BuiltJournalEntry = {
    entryDate: args.entryDate,
    description: `Bill payment ${args.billPaymentId}`,
    sourceType: "bill_payment",
    sourceId: args.billPaymentId,
    entryKind: "post",
    idempotencyKey: `bill_payment:${args.billPaymentId}:post`,
    lines: [
      {
        accountId: ap,
        debit: amount,
        memo: "Pay AP",
        vendorId: args.vendorId,
        billId: args.billId,
      },
      {
        accountId: cash,
        credit: amount,
        memo: "Cash out",
        vendorId: args.vendorId,
        billId: args.billId,
      },
    ],
  };
  const gate = assessJournalBalance(built.lines);
  if (!gate.ok) throw new Error(gate.error);
  return built;
}

/** Direct cash expense (no vendor bill): Dr Expense  Cr Cash */
export function buildDirectExpenseJournal(args: {
  expenseId: string;
  amount: number;
  entryDate: string;
  mappings: AccountMappingDict;
  /** When expense is linked to a bill, do not post — bill/AP path owns the event. */
  billId?: string | null;
}): BuiltJournalEntry | { skipped: true; reason: string } {
  if (args.billId) {
    return {
      skipped: true,
      reason:
        "Expense is linked to a vendor bill — ledger uses bill + bill payment, not a second expense journal.",
    };
  }
  const amount = round2(args.amount);
  if (!(amount > 0)) throw new Error("Expense amount must be positive.");
  const expense = requireMappedAccount(args.mappings, "default_expense");
  const cash = resolveCashAccountId(args.mappings, "cash");
  const built: BuiltJournalEntry = {
    entryDate: args.entryDate,
    description: `Expense ${args.expenseId}`,
    sourceType: "expense",
    sourceId: args.expenseId,
    entryKind: "post",
    idempotencyKey: `expense:${args.expenseId}:post`,
    lines: [
      { accountId: expense, debit: amount, memo: "Direct expense" },
      { accountId: cash, credit: amount, memo: "Cash out" },
    ],
  };
  const gate = assessJournalBalance(built.lines);
  if (!gate.ok) throw new Error(gate.error);
  return built;
}

/** PO alone never creates an expense journal. */
export function assessPurchaseOrderAccounting(): {
  posts: false;
  reason: string;
} {
  return {
    posts: false,
    reason:
      "Purchase orders are operational commitments, not accounting expenses. Posting occurs on vendor bill / payment / inventory events only.",
  };
}

/**
 * Inventory consumption → COGS. Only when inventory_posting_enabled.
 */
export function buildInventoryConsumptionJournal(args: {
  movementId: string;
  amount: number;
  entryDate: string;
  mappings: AccountMappingDict;
  inventoryPostingEnabled: boolean;
  jobId?: string | null;
}): BuiltJournalEntry {
  if (!args.inventoryPostingEnabled) {
    throw new Error(INVENTORY_POSTING_DISABLED_MESSAGE);
  }
  const amount = round2(args.amount);
  if (!(amount > 0)) throw new Error("Consumption amount must be positive.");
  const cogs = requireMappedAccount(args.mappings, "material_cogs");
  const inventory = requireMappedAccount(args.mappings, "inventory_asset");
  const built: BuiltJournalEntry = {
    entryDate: args.entryDate,
    description: `Inventory consumption ${args.movementId}`,
    sourceType: "stock_movement",
    sourceId: args.movementId,
    entryKind: "post",
    idempotencyKey: `stock_movement:${args.movementId}:cogs`,
    lines: [
      {
        accountId: cogs,
        debit: amount,
        memo: "Material COGS",
        jobId: args.jobId,
      },
      {
        accountId: inventory,
        credit: amount,
        memo: "Inventory asset",
        jobId: args.jobId,
      },
    ],
  };
  const gate = assessJournalBalance(built.lines);
  if (!gate.ok) throw new Error(gate.error);
  return built;
}

/** Installer / labor bill: Dr Labor COGS  Cr AP */
export function buildInstallerLaborBillJournal(args: {
  installerBillId: string;
  amount: number;
  entryDate: string;
  mappings: AccountMappingDict;
  vendorId?: string | null;
  jobId?: string | null;
}): BuiltJournalEntry {
  const amount = round2(args.amount);
  if (!(amount > 0)) throw new Error("Installer bill amount must be positive.");
  const labor = requireMappedAccount(args.mappings, "installer_labor_cogs");
  const ap = requireMappedAccount(args.mappings, "accounts_payable");
  const built: BuiltJournalEntry = {
    entryDate: args.entryDate,
    description: `Installer bill ${args.installerBillId}`,
    sourceType: "installer_bill",
    sourceId: args.installerBillId,
    entryKind: "post",
    idempotencyKey: `installer_bill:${args.installerBillId}:post`,
    lines: [
      {
        accountId: labor,
        debit: amount,
        memo: "Installation labor COGS",
        vendorId: args.vendorId,
        jobId: args.jobId,
      },
      {
        accountId: ap,
        credit: amount,
        memo: "Accounts payable",
        vendorId: args.vendorId,
        jobId: args.jobId,
      },
    ],
  };
  const gate = assessJournalBalance(built.lines);
  if (!gate.ok) throw new Error(gate.error);
  return built;
}

/** Deposit apply (non-cash): Dr Customer Deposits  Cr AR */
export function buildDepositApplyJournal(args: {
  applicationId: string;
  amount: number;
  entryDate: string;
  invoiceId: string;
  mappings: AccountMappingDict;
  depositLiabilityAccountId?: string;
  arAccountId?: string;
  customerId?: string | null;
}): BuiltJournalEntry {
  const amount = round2(args.amount);
  if (!(amount > 0)) throw new Error("Deposit application must be positive.");
  const deposits =
    args.depositLiabilityAccountId ??
    requireMappedAccount(args.mappings, "customer_deposits");
  const ar =
    args.arAccountId ??
    requireMappedAccount(args.mappings, "accounts_receivable");
  const built: BuiltJournalEntry = {
    entryDate: args.entryDate,
    description: `Deposit application ${args.applicationId}`,
    sourceType: "deposit_application",
    sourceId: args.applicationId,
    entryKind: "post",
    idempotencyKey: `deposit_application:${args.applicationId}:post`,
    lines: [
      {
        accountId: deposits,
        debit: amount,
        memo: "Apply customer deposit",
        customerId: args.customerId,
        invoiceId: args.invoiceId,
      },
      {
        accountId: ar,
        credit: amount,
        memo: "Reduce AR (non-cash)",
        customerId: args.customerId,
        invoiceId: args.invoiceId,
      },
    ],
  };
  const gate = assessJournalBalance(built.lines);
  if (!gate.ok) throw new Error(gate.error);
  return built;
}

/**
 * AR write-off: Dr Bad Debt Expense / Cr AR.
 * Idempotency: invoice_write_off:{writeOffId}:post
 */
export function buildInvoiceWriteOffJournal(args: {
  writeOffId: string;
  invoiceId: string;
  amount: number;
  entryDate: string;
  mappings: AccountMappingDict;
  customerId?: string | null;
  jobId?: string | null;
  reason?: string | null;
}): BuiltJournalEntry {
  const amount = round2(args.amount);
  if (!(amount > 0)) throw new Error("Write-off amount must be positive.");
  const badDebt = requireMappedAccount(args.mappings, "bad_debt_expense");
  const ar = requireMappedAccount(args.mappings, "accounts_receivable");
  const built: BuiltJournalEntry = {
    entryDate: args.entryDate,
    description: `Invoice write-off ${args.invoiceId}`,
    sourceType: "invoice_write_off",
    sourceId: args.writeOffId,
    entryKind: "post",
    idempotencyKey: `invoice_write_off:${args.writeOffId}:post`,
    lines: [
      {
        accountId: badDebt,
        debit: amount,
        memo: args.reason ?? "Bad debt write-off",
        customerId: args.customerId,
        jobId: args.jobId,
        invoiceId: args.invoiceId,
      },
      {
        accountId: ar,
        credit: amount,
        memo: "Reduce AR — write-off",
        customerId: args.customerId,
        jobId: args.jobId,
        invoiceId: args.invoiceId,
      },
    ],
  };
  const gate = assessJournalBalance(built.lines);
  if (!gate.ok) throw new Error(gate.error);
  return built;
}

/** Opening balances must balance; typically Cr/Dr Opening Balance Equity. */
export function buildOpeningBalanceJournal(args: {
  entryDate: string;
  lines: {
    accountId: string;
    debit?: number;
    credit?: number;
    memo?: string;
  }[];
  mappings: AccountMappingDict;
  openingId?: string;
}): BuiltJournalEntry {
  const equity = requireMappedAccount(args.mappings, "opening_balance_equity");
  const lines: JournalLineInput[] = args.lines.map((l) => ({
    accountId: l.accountId,
    debit: l.debit,
    credit: l.credit,
    memo: l.memo ?? "Opening balance",
  }));
  const debits = round2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
  const credits = round2(
    lines.reduce((s, l) => s + (Number(l.credit) || 0), 0),
  );
  const diff = round2(debits - credits);
  if (Math.abs(diff) > 0.005) {
    if (diff > 0) {
      lines.push({
        accountId: equity,
        credit: diff,
        memo: "Opening balance equity",
      });
    } else {
      lines.push({
        accountId: equity,
        debit: Math.abs(diff),
        memo: "Opening balance equity",
      });
    }
  }
  const id = args.openingId ?? `opening:${args.entryDate}`;
  const built: BuiltJournalEntry = {
    entryDate: args.entryDate,
    description: "Opening balances",
    sourceType: "opening_balance",
    sourceId: null,
    entryKind: "opening_balance",
    idempotencyKey: `opening_balance:${id}`,
    lines,
  };
  const gate = assessJournalBalance(built.lines);
  if (!gate.ok) throw new Error(gate.error);
  return built;
}

export function shouldAutoBackfillHistory(): false {
  return false;
}
