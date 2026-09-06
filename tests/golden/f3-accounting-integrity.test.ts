/**
 * F3 final accounting integrity review — credit lifecycle, tax, AP, periods, BS.
 */
import { describe, expect, it } from "vitest";
import {
  buildBillPaymentJournal,
  buildCreditApplicationJournal,
  buildCreditMemoIssueJournal,
  buildCustomerDepositJournal,
  buildDirectExpenseJournal,
  buildInvoiceIssueJournal,
  buildPaymentJournal,
  buildRefundJournal,
  buildVendorBillJournal,
  assessPurchaseOrderAccounting,
  splitInvoiceRevenueTax,
} from "@/lib/accounting/builders";
import {
  assessPeriodPosting,
  assessReversal,
  buildReversalLines,
  sumCredits,
  sumDebits,
} from "@/lib/accounting/journal";
import {
  buildAccountingPnL,
  buildBalanceSheet,
  buildCashMovement,
  buildTrialBalance,
} from "@/lib/accounting/reports";
import {
  assessAutoPostAllowed,
  simulateConcurrentIdempotentPost,
} from "@/lib/accounting/posting-policy";
import {
  assessBooksOfRecordEnable,
  assessCreditMemoVoidAccounting,
  assessInstallerLaborAutoPost,
  buildCreditMemoVoidJournal,
  buildFullyPaidCreditLifecycle,
  buildPartialPayCreditLifecycle,
  buildRefundVoidJournal,
  CREDIT_VOID_CONSUMED_MESSAGE,
  creditTaxDecompositionStatus,
  ledgerAccountBalance,
  TAX_CREDIT_DECOMPOSITION_NOT_READY,
  toPostedLines,
} from "@/lib/accounting/integrity";
import type { AccountMappingDict, GlAccountLike } from "@/lib/accounting/types";
import { PERIOD_CLOSED_MESSAGE, PERIOD_LOCKED_MESSAGE } from "@/lib/accounting/types";
import { effectiveInvoiceBalance } from "@/lib/credit-ar";

const IDS = {
  cash: "a-cash",
  uf: "a-uf",
  ar: "a-ar",
  inv: "a-inv",
  ap: "a-ap",
  tax: "a-tax",
  dep: "a-dep",
  creditLiab: "a-cred",
  obe: "a-obe",
  rev: "a-rev",
  disc: "a-disc",
  cogs: "a-cogs",
  labor: "a-labor",
  exp: "a-exp",
};

const mappings: AccountMappingDict = {
  cash_operating: IDS.cash,
  undeposited_funds: IDS.uf,
  accounts_receivable: IDS.ar,
  inventory_asset: IDS.inv,
  accounts_payable: IDS.ap,
  sales_tax_payable: IDS.tax,
  customer_deposits: IDS.dep,
  customer_credit_liability: IDS.creditLiab,
  opening_balance_equity: IDS.obe,
  owner_equity: "a-own",
  retained_earnings: "a-re",
  default_sales_revenue: IDS.rev,
  sales_discounts: IDS.disc,
  material_cogs: IDS.cogs,
  installer_labor_cogs: IDS.labor,
  default_expense: IDS.exp,
};

const accounts: GlAccountLike[] = [
  { id: IDS.cash, code: "1000", name: "Cash", account_type: "asset", subtype: "cash" },
  { id: IDS.ar, code: "1100", name: "AR", account_type: "asset" },
  { id: IDS.ap, code: "2000", name: "AP", account_type: "liability" },
  { id: IDS.tax, code: "2100", name: "Tax", account_type: "liability" },
  { id: IDS.dep, code: "2200", name: "Deposits", account_type: "liability" },
  {
    id: IDS.creditLiab,
    code: "2250",
    name: "Customer Credit",
    account_type: "liability",
  },
  { id: IDS.obe, code: "3000", name: "OBE", account_type: "equity" },
  { id: IDS.rev, code: "4000", name: "Sales", account_type: "revenue" },
  {
    id: IDS.disc,
    code: "4900",
    name: "Discounts",
    account_type: "revenue",
    subtype: "contra_revenue",
  },
  {
    id: IDS.exp,
    code: "6900",
    name: "Expense",
    account_type: "expense",
    subtype: "opex",
  },
];

describe("F3 integrity — credit lifecycle", () => {
  it("1. partially paid invoice + commercial credit → AR 2500, liability 0", () => {
    const { issue, pay, credit, apply } = buildPartialPayCreditLifecycle({
      mappings,
    });
    const lines = toPostedLines([issue, pay, credit, apply]);
    expect(ledgerAccountBalance({ accountId: IDS.ar, accountType: "asset", lines })).toBe(
      2500,
    );
    expect(
      ledgerAccountBalance({
        accountId: IDS.creditLiab,
        accountType: "liability",
        lines,
      }),
    ).toBe(0);
    expect(ledgerAccountBalance({ accountId: IDS.cash, accountType: "asset", lines })).toBe(
      6000,
    );
    // Net revenue = 10000 − 1500 discounts
    const pnl = buildAccountingPnL({
      accounts,
      lines,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    expect(pnl.revenue).toBe(8500);
    expect(
      effectiveInvoiceBalance({
        items: [{ quantity: 1, rate: 10000 }],
        taxRate: 0,
        amountPaid: 6000,
        appliedCredits: 1500,
      }).amountDue,
    ).toBe(2500);
  });

  it("2. fully paid invoice + available credit → AR 0, liability 1500, cash unchanged until refund", () => {
    const { issue, pay, credit } = buildFullyPaidCreditLifecycle({ mappings });
    const lines = toPostedLines([issue, pay, credit]);
    expect(ledgerAccountBalance({ accountId: IDS.ar, accountType: "asset", lines })).toBe(0);
    expect(
      ledgerAccountBalance({
        accountId: IDS.creditLiab,
        accountType: "liability",
        lines,
      }),
    ).toBe(1500);
    expect(ledgerAccountBalance({ accountId: IDS.cash, accountType: "asset", lines })).toBe(
      10000,
    );
  });

  it("3. refund consumes credit liability; payment intact; no negative payment", () => {
    const { issue, pay, credit } = buildFullyPaidCreditLifecycle({ mappings });
    const refund = buildRefundJournal({
      refundId: "rf-full",
      amount: 1500,
      entryDate: "2026-08-04",
      mappings,
      cashPreference: "cash",
    });
    const lines = toPostedLines([issue, pay, credit, refund]);
    expect(
      ledgerAccountBalance({
        accountId: IDS.creditLiab,
        accountType: "liability",
        lines,
      }),
    ).toBe(0);
    expect(ledgerAccountBalance({ accountId: IDS.cash, accountType: "asset", lines })).toBe(
      8500,
    );
    expect(ledgerAccountBalance({ accountId: IDS.ar, accountType: "asset", lines })).toBe(0);
    // Original payment lines untouched
    expect(pay.lines[0].debit).toBe(10000);
    expect(refund.lines.every((l) => (l.debit ?? 0) >= 0 && (l.credit ?? 0) >= 0)).toBe(
      true,
    );
  });

  it("4. refund void restores credit liability", () => {
    const { issue, pay, credit } = buildFullyPaidCreditLifecycle({
      mappings,
      invoiceId: "inv-rv",
    });
    const refund = buildRefundJournal({
      refundId: "rf-rv",
      amount: 1500,
      entryDate: "2026-08-04",
      mappings,
    });
    const voidRf = buildRefundVoidJournal({
      refundEntry: refund,
      voidDate: "2026-08-05",
      refundId: "rf-rv",
    });
    const lines = toPostedLines([issue, pay, credit, refund, voidRf]);
    expect(
      ledgerAccountBalance({
        accountId: IDS.creditLiab,
        accountType: "liability",
        lines,
      }),
    ).toBe(1500);
    expect(ledgerAccountBalance({ accountId: IDS.cash, accountType: "asset", lines })).toBe(
      10000,
    );
  });

  it("5. partial credit application leaves remaining liability", () => {
    const credit = buildCreditMemoIssueJournal({
      creditMemoId: "cm-part",
      amount: 2000,
      entryDate: "2026-08-01",
      mappings,
    });
    const apply = buildCreditApplicationJournal({
      applicationId: "ca-part",
      amount: 500,
      entryDate: "2026-08-02",
      invoiceId: "inv-x",
      mappings,
    });
    const lines = toPostedLines([credit, apply]);
    expect(
      ledgerAccountBalance({
        accountId: IDS.creditLiab,
        accountType: "liability",
        lines,
      }),
    ).toBe(1500);
    const arCredits = lines
      .filter((l) => l.accountId === IDS.ar)
      .reduce((s, l) => s + l.credit, 0);
    expect(arCredits).toBe(500);
    // Revenue reduced once at issue (2000), not again on apply
    const pnl = buildAccountingPnL({
      accounts,
      lines,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    expect(pnl.revenue).toBe(-2000);
  });

  it("6. unused credit void restores discounts/liability; consumed void blocked", () => {
    const credit = buildCreditMemoIssueJournal({
      creditMemoId: "cm-void",
      amount: 800,
      entryDate: "2026-08-01",
      mappings,
    });
    expect(assessCreditMemoVoidAccounting({ activeApplicationTotal: 0 }).ok).toBe(
      true,
    );
    const voided = buildCreditMemoVoidJournal({
      issueEntry: credit,
      voidDate: "2026-08-10",
      creditMemoId: "cm-void",
    });
    const lines = toPostedLines([credit, voided]);
    expect(
      ledgerAccountBalance({
        accountId: IDS.creditLiab,
        accountType: "liability",
        lines,
      }),
    ).toBe(0);
    const blocked = assessCreditMemoVoidAccounting({ activeApplicationTotal: 800 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toBe(CREDIT_VOID_CONSUMED_MESSAGE);
  });

  it("7. no duplicate credit issue/application/refund posting keys", () => {
    const keys = new Set<string>();
    const a = simulateConcurrentIdempotentPost(
      keys,
      "credit_memo:cm1:issue",
      "credit_memo:cm1:issue",
    );
    expect(a.accepted).toHaveLength(1);
    expect(a.rejected).toHaveLength(1);
    const b = simulateConcurrentIdempotentPost(
      keys,
      "credit_application:ca1:post",
      "credit_application:ca1:post",
    );
    expect(b.accepted).toHaveLength(1);
    const c = simulateConcurrentIdempotentPost(
      keys,
      "refund:rf1:post",
      "refund:rf1:post",
    );
    expect(c.accepted).toHaveLength(1);
  });
});

describe("F3 integrity — tax / invoice equation", () => {
  it("8. taxable invoice: AR = revenue + tax; credits/tax limitation flagged", () => {
    const split = splitInvoiceRevenueTax([{ quantity: 1, rate: 1000 }], 8);
    expect(split.subtotal).toBe(1000);
    expect(split.tax).toBe(80);
    expect(split.total).toBe(1080);
    const je = buildInvoiceIssueJournal({
      invoiceId: "tax1",
      entryDate: "2026-08-01",
      items: [{ quantity: 1, rate: 1000 }],
      taxRate: 8,
      mappings,
    });
    expect(sumDebits(je.lines)).toBe(1080);
    expect(sumCredits(je.lines)).toBe(1080);
    expect(je.lines.find((l) => l.accountId === IDS.ar)?.debit).toBe(1080);
    expect(je.lines.find((l) => l.accountId === IDS.rev)?.credit).toBe(1000);
    expect(je.lines.find((l) => l.accountId === IDS.tax)?.credit).toBe(80);

    const taxStatus = creditTaxDecompositionStatus();
    expect(taxStatus.ready).toBe(false);
    expect(taxStatus.flag).toBe(TAX_CREDIT_DECOMPOSITION_NOT_READY);
    expect(taxStatus.salesTaxPayableMayBeOverstated).toBe(true);
    expect(taxStatus.salesDiscountsIncludesTaxInclusiveAmount).toBe(true);
  });
});

describe("F3 integrity — AP / installer / deposits", () => {
  it("9. PO + bill + linked expense = one economic recognition ($5000)", () => {
    expect(assessPurchaseOrderAccounting().posts).toBe(false);
    const bill = buildVendorBillJournal({
      billId: "b5k",
      amount: 5000,
      entryDate: "2026-08-01",
      mappings,
      inventoryPostingEnabled: false,
    });
    const pay = buildBillPaymentJournal({
      billPaymentId: "bp5k",
      billId: "b5k",
      amount: 5000,
      entryDate: "2026-08-02",
      mappings,
    });
    const linked = buildDirectExpenseJournal({
      expenseId: "e5k",
      amount: 5000,
      entryDate: "2026-08-02",
      mappings,
      billId: "b5k",
    });
    expect("skipped" in linked && linked.skipped).toBe(true);
    const lines = toPostedLines([bill, pay]);
    expect(ledgerAccountBalance({ accountId: IDS.exp, accountType: "expense", lines })).toBe(
      5000,
    );
    expect(ledgerAccountBalance({ accountId: IDS.ap, accountType: "liability", lines })).toBe(
      0,
    );
    expect(ledgerAccountBalance({ accountId: IDS.cash, accountType: "asset", lines })).toBe(
      -5000,
    );
  });

  it("10. installer duplicate-source protection — auto post disabled", () => {
    const off = assessInstallerLaborAutoPost({
      enabled: false,
      source: "none",
      eventSource: "installer_bills",
    });
    expect(off.ok).toBe(false);
    const dual = assessInstallerLaborAutoPost({
      enabled: true,
      source: "installer_bills",
      eventSource: "job_labor",
    });
    expect(dual.ok).toBe(false);
    const ok = assessInstallerLaborAutoPost({
      enabled: true,
      source: "installer_bills",
      eventSource: "installer_bills",
    });
    expect(ok.ok).toBe(true);
  });

  it("invoice payments credit AR — not Customer Deposits", () => {
    const pay = buildPaymentJournal({
      paymentId: "p-ar",
      invoiceId: "inv",
      amount: 100,
      entryDate: "2026-08-01",
      mappings,
    });
    expect(pay.lines.some((l) => l.accountId === IDS.ar && (l.credit ?? 0) > 0)).toBe(
      true,
    );
    expect(pay.lines.some((l) => l.accountId === IDS.dep)).toBe(false);
    const dep = buildCustomerDepositJournal({
      depositId: "d1",
      amount: 100,
      entryDate: "2026-08-01",
      mappings,
    });
    expect(dep.lines.some((l) => l.accountId === IDS.dep)).toBe(true);
  });
});

describe("F3 integrity — periods / BS / cash / cutover", () => {
  it("11. closed/locked reversal policy — must use open period date", () => {
    expect(
      assessPeriodPosting({ periodStatus: "closed", entryKind: "reversal" }).ok,
    ).toBe(false);
    expect(
      assessPeriodPosting({ periodStatus: "locked", entryKind: "reversal" }).ok,
    ).toBe(false);
    const closed = assessPeriodPosting({
      periodStatus: "closed",
      entryKind: "reversal",
    });
    if (!closed.ok) expect(closed.error).toBe(PERIOD_CLOSED_MESSAGE);
    const locked = assessPeriodPosting({
      periodStatus: "locked",
      entryKind: "post",
    });
    if (!locked.ok) expect(locked.error).toBe(PERIOD_LOCKED_MESSAGE);

    const original = [
      { accountId: IDS.cash, debit: 10 },
      { accountId: IDS.ar, credit: 10 },
    ];
    const rev = buildReversalLines(original);
    expect(assessReversal({ originalStatus: "posted", alreadyReversed: false }).ok).toBe(
      true,
    );
    expect(original[0].debit).toBe(10);
    expect(sumDebits(rev)).toBe(10);
  });

  it("12. two-period Balance Sheet / net income without double-count", () => {
    const p1 = buildInvoiceIssueJournal({
      invoiceId: "p1",
      entryDate: "2026-07-15",
      items: [{ quantity: 1, rate: 1000 }],
      taxRate: 0,
      mappings,
    });
    const p2exp = buildDirectExpenseJournal({
      expenseId: "p2e",
      amount: 200,
      entryDate: "2026-08-10",
      mappings,
    });
    expect("lines" in p2exp).toBe(true);
    if (!("lines" in p2exp)) return;
    const lines = toPostedLines([p1, p2exp]);

    const niJul = buildAccountingPnL({
      accounts,
      lines,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    }).netIncome;
    expect(niJul).toBe(1000);

    const niThroughAug = buildAccountingPnL({
      accounts,
      lines,
      startDate: "1970-01-01",
      endDate: "2026-08-31",
    }).netIncome;
    expect(niThroughAug).toBe(800);

    const bsJul = buildBalanceSheet({
      accounts,
      lines,
      asOfDate: "2026-07-31",
      netIncomeToDate: niJul,
    });
    expect(bsJul.balanced).toBe(true);

    const bsAug = buildBalanceSheet({
      accounts,
      lines,
      asOfDate: "2026-08-31",
      netIncomeToDate: niThroughAug,
    });
    expect(bsAug.balanced).toBe(true);
    // Equity accounts empty + NI rollup — not double-counting RE
    expect(bsAug.equity).toBe(0);
    expect(bsAug.equityWithIncome).toBe(800);
  });

  it("13. cash movement only cash accounts — invoices/credits excluded", () => {
    const inv = buildInvoiceIssueJournal({
      invoiceId: "c1",
      entryDate: "2026-08-01",
      items: [{ quantity: 1, rate: 500 }],
      taxRate: 0,
      mappings,
    });
    const credit = buildCreditMemoIssueJournal({
      creditMemoId: "c-cm",
      amount: 50,
      entryDate: "2026-08-01",
      mappings,
    });
    const pay = buildPaymentJournal({
      paymentId: "c-pay",
      invoiceId: "c1",
      amount: 500,
      entryDate: "2026-08-02",
      mappings,
      cashPreference: "cash",
    });
    const lines = toPostedLines([inv, credit, pay]);
    const cash = buildCashMovement({
      cashAccountIds: [IDS.cash],
      lines,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    expect(cash.cashIn).toBe(500);
    expect(cash.netChange).toBe(500);
  });

  it("14–15. cutover/posting gate + books_of_record safety", () => {
    const beforeCutover = assessAutoPostAllowed({
      settings: {
        posting_enabled: true,
        inventory_posting_enabled: false,
        cutover_date: "2026-09-01",
        books_of_record: false,
        default_cash_method: "undeposited",
      },
      entryDate: "2026-08-15",
      entryKind: "post",
      sourceType: "invoice",
    });
    expect(beforeCutover.ok).toBe(false);
    if (!beforeCutover.ok) expect(beforeCutover.skipped).toBe(true);

    const accidental = assessBooksOfRecordEnable({
      requested: true,
      postingEnabled: true,
      cutoverDate: "2026-09-01",
      openingBalancesEntered: false,
      accountantValidated: false,
    });
    expect(accidental.ok).toBe(false);
    expect(accidental.booksOfRecord).toBe(false);

    const ready = assessBooksOfRecordEnable({
      requested: true,
      postingEnabled: true,
      cutoverDate: "2026-09-01",
      openingBalancesEntered: true,
      accountantValidated: true,
    });
    expect(ready.ok).toBe(true);
    if (ready.ok) expect(ready.booksOfRecord).toBe(true);

    const tb = buildTrialBalance({
      accounts,
      lines: toPostedLines([
        buildInvoiceIssueJournal({
          invoiceId: "tb1",
          entryDate: "2026-08-01",
          items: [{ quantity: 1, rate: 10 }],
          taxRate: 0,
          mappings,
        }),
      ]),
    });
    expect(tb.balanced).toBe(true);
  });
});
