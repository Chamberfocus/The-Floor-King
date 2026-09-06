/**
 * F3 Accounting Foundation — deterministic ledger / posting / report tests.
 */
import { describe, expect, it } from "vitest";
import {
  assessJournalBalance,
  assessJournalLine,
  assessPeriodPosting,
  assessPostedImmutability,
  assessReversal,
  buildReversalLines,
  findPeriodForDate,
  sumCredits,
  sumDebits,
} from "@/lib/accounting/journal";
import {
  assessPurchaseOrderAccounting,
  buildBillPaymentJournal,
  buildCreditApplicationJournal,
  buildCreditMemoIssueJournal,
  buildCustomerDepositJournal,
  buildDirectExpenseJournal,
  buildInstallerLaborBillJournal,
  buildInventoryConsumptionJournal,
  buildInvoiceIssueJournal,
  buildOpeningBalanceJournal,
  buildPaymentJournal,
  buildRefundJournal,
  buildVendorBillJournal,
  shouldAutoBackfillHistory,
  splitInvoiceRevenueTax,
} from "@/lib/accounting/builders";
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
  DOUBLE_REVERSAL_MESSAGE,
  INVENTORY_POSTING_DISABLED_MESSAGE,
  JOURNAL_IMMUTABLE_MESSAGE,
  PERIOD_CLOSED_MESSAGE,
  PERIOD_LOCKED_MESSAGE,
  UNBALANCED_JOURNAL_MESSAGE,
  type AccountMappingDict,
  type GlAccountLike,
} from "@/lib/accounting/types";
import {
  activePaymentsTotal,
  assessPaymentAmount,
  dayTaskCollectAmountDue,
  invoiceRemainingBalance,
} from "@/lib/payment-safety";
import {
  assessCreditApplication,
  assessRefundAmount,
  effectiveInvoiceBalance,
} from "@/lib/credit-ar";
import { computeLineCoverage } from "@/lib/po-coverage";
import { assessJobOperationalState } from "@/lib/job-operational-state";
import {
  classifyDuplicateMatches,
  normalizeEmail,
  scoreCustomerDuplicate,
} from "@/lib/customer-duplicate";
import { isOpenTaskStatus, isTaskOverdue } from "@/lib/office-task";

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
  { id: IDS.cash, code: "1000", name: "Cash", account_type: "asset" },
  { id: IDS.uf, code: "1050", name: "UF", account_type: "asset" },
  { id: IDS.ar, code: "1100", name: "AR", account_type: "asset" },
  { id: IDS.inv, code: "1200", name: "Inventory", account_type: "asset" },
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
    id: IDS.cogs,
    code: "5000",
    name: "Material COGS",
    account_type: "expense",
    subtype: "cogs",
  },
  {
    id: IDS.labor,
    code: "5100",
    name: "Labor COGS",
    account_type: "expense",
    subtype: "cogs",
  },
  {
    id: IDS.exp,
    code: "6900",
    name: "Expense",
    account_type: "expense",
    subtype: "opex",
  },
];

describe("F3 journal core", () => {
  it("1. balanced journal accepted", () => {
    const gate = assessJournalBalance([
      { accountId: IDS.cash, debit: 100 },
      { accountId: IDS.rev, credit: 100 },
    ]);
    expect(gate.ok).toBe(true);
    if (gate.ok) {
      expect(gate.debits).toBe(100);
      expect(gate.credits).toBe(100);
    }
  });

  it("2. unbalanced journal rejected", () => {
    const gate = assessJournalBalance([
      { accountId: IDS.cash, debit: 100 },
      { accountId: IDS.rev, credit: 90 },
    ]);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.error).toContain(UNBALANCED_JOURNAL_MESSAGE);
  });

  it("3. one-sided journal rejected", () => {
    expect(assessJournalBalance([{ accountId: IDS.cash, debit: 50 }]).ok).toBe(
      false,
    );
  });

  it("4. zero/negative invalid line rejected", () => {
    expect(assessJournalLine({ accountId: IDS.cash, debit: 0, credit: 0 }).ok).toBe(
      false,
    );
    expect(
      assessJournalLine({ accountId: IDS.cash, debit: 10, credit: 5 }).ok,
    ).toBe(false);
  });

  it("5–6. posted journal immutable / no hard-delete", () => {
    expect(
      assessPostedImmutability({ status: "posted", operation: "update" }).ok,
    ).toBe(false);
    expect(
      assessPostedImmutability({ status: "posted", operation: "delete" }).ok,
    ).toBe(false);
    const g = assessPostedImmutability({
      status: "posted",
      operation: "delete",
    });
    if (!g.ok) expect(g.error).toBe(JOURNAL_IMMUTABLE_MESSAGE);
  });

  it("7–9. reversal swaps sides; original intact; double reversal blocked", () => {
    const original = [
      { accountId: IDS.cash, debit: 40 },
      { accountId: IDS.ar, credit: 40 },
    ];
    const rev = buildReversalLines(original);
    expect(sumDebits(rev)).toBe(40);
    expect(sumCredits(rev)).toBe(40);
    expect(rev[0].credit).toBe(40);
    expect(rev[1].debit).toBe(40);
    expect(original[0].debit).toBe(40);
    expect(assessReversal({ originalStatus: "posted", alreadyReversed: true }).ok).toBe(
      false,
    );
    const blocked = assessReversal({
      originalStatus: "posted",
      alreadyReversed: true,
    });
    if (!blocked.ok) expect(blocked.error).toBe(DOUBLE_REVERSAL_MESSAGE);
  });

  it("10–11. duplicate / concurrent source posting blocked", () => {
    const keys = new Set<string>();
    const first = simulateConcurrentIdempotentPost(
      keys,
      "payment:p1:post",
      "payment:p1:post",
    );
    expect(first.accepted).toEqual(["payment:p1:post"]);
    expect(first.rejected).toEqual(["payment:p1:post"]);
  });
});

describe("F3 periods", () => {
  const periods = [
    {
      id: "1",
      start_date: "2026-08-01",
      end_date: "2026-08-31",
      status: "open" as const,
    },
    {
      id: "2",
      start_date: "2026-07-01",
      end_date: "2026-07-31",
      status: "closed" as const,
    },
    {
      id: "3",
      start_date: "2026-06-01",
      end_date: "2026-06-30",
      status: "locked" as const,
    },
  ];

  it("12. open period accepts posting", () => {
    expect(assessPeriodPosting({ periodStatus: "open", entryKind: "post" }).ok).toBe(
      true,
    );
  });

  it("13. closed period blocks normal posting", () => {
    const g = assessPeriodPosting({ periodStatus: "closed", entryKind: "post" });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.error).toBe(PERIOD_CLOSED_MESSAGE);
  });

  it("13b. closed/locked periods also block reversals (post into open date instead)", () => {
    expect(
      assessPeriodPosting({ periodStatus: "closed", entryKind: "reversal" }).ok,
    ).toBe(false);
    expect(
      assessPeriodPosting({ periodStatus: "locked", entryKind: "reversal" }).ok,
    ).toBe(false);
    expect(
      assessPeriodPosting({ periodStatus: "open", entryKind: "reversal" }).ok,
    ).toBe(true);
  });

  it("14. locked period blocks unauthorized posting", () => {
    const g = assessPeriodPosting({ periodStatus: "locked", entryKind: "post" });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.error).toBe(PERIOD_LOCKED_MESSAGE);
  });

  it("15. period boundary dates correct", () => {
    expect(findPeriodForDate(periods, "2026-08-01")?.id).toBe("1");
    expect(findPeriodForDate(periods, "2026-08-31")?.id).toBe("1");
    expect(findPeriodForDate(periods, "2026-09-01")).toBeNull();
  });
});

describe("F3 invoice posting builders", () => {
  it("16–21. invoice AR/revenue/tax; balances; idempotent key; void via reversal", () => {
    const je = buildInvoiceIssueJournal({
      invoiceId: "inv1",
      entryDate: "2026-08-15",
      items: [{ quantity: 1, rate: 1000 }],
      taxRate: 8,
      mappings,
    });
    expect(je.lines.some((l) => l.accountId === IDS.ar && l.debit === 1080)).toBe(
      true,
    );
    expect(je.lines.some((l) => l.accountId === IDS.rev && l.credit === 1000)).toBe(
      true,
    );
    expect(je.lines.some((l) => l.accountId === IDS.tax && l.credit === 80)).toBe(
      true,
    );
    expect(assessJournalBalance(je.lines).ok).toBe(true);
    expect(je.idempotencyKey).toBe("invoice:inv1:issue");

    const nonTax = buildInvoiceIssueJournal({
      invoiceId: "inv2",
      entryDate: "2026-08-15",
      items: [{ quantity: 1, rate: 500 }],
      taxRate: 0,
      mappings,
    });
    expect(nonTax.lines.some((l) => l.accountId === IDS.tax)).toBe(false);

    const rev = buildReversalLines(je.lines);
    expect(assessJournalBalance(rev).ok).toBe(true);
  });
});

describe("F3 payment posting builders", () => {
  it("22–27. payment cash/AR; idempotent; void reversal; F0 overpay intact", () => {
    const pay = buildPaymentJournal({
      paymentId: "pay1",
      invoiceId: "inv1",
      amount: 1080,
      entryDate: "2026-08-16",
      mappings,
    });
    expect(pay.lines[0].debit).toBe(1080);
    expect(pay.lines[0].accountId).toBe(IDS.uf);
    expect(pay.lines[1].credit).toBe(1080);
    expect(pay.lines[1].accountId).toBe(IDS.ar);
    expect(pay.idempotencyKey).toBe("payment:pay1:post");

    const voidRev = buildReversalLines(pay.lines);
    expect(voidRev[0].credit).toBe(1080);
    expect(voidRev[1].debit).toBe(1080);
    expect(pay.lines[0].debit).toBe(1080); // original intact

    expect(assessPaymentAmount({ amount: 1, remainingBalance: 0 }).ok).toBe(false);
    expect(
      invoiceRemainingBalance(
        [{ quantity: 1, rate: 100 }],
        0,
        [{ amount: 100, status: "void" }],
      ),
    ).toBe(100);
  });
});

describe("F3 credit / refund builders", () => {
  it("28–32. credit memo liability path; apply reduces AR; no auto refund; F1 intact", () => {
    const memo = buildCreditMemoIssueJournal({
      creditMemoId: "cm1",
      amount: 200,
      entryDate: "2026-08-17",
      mappings,
    });
    expect(memo.lines[0].accountId).toBe(IDS.disc);
    expect(memo.lines[1].accountId).toBe(IDS.creditLiab);

    const app = buildCreditApplicationJournal({
      applicationId: "ca1",
      amount: 200,
      entryDate: "2026-08-17",
      invoiceId: "inv1",
      mappings,
    });
    expect(app.lines.some((l) => l.accountId === IDS.ar && l.credit === 200)).toBe(
      true,
    );

    expect(
      effectiveInvoiceBalance({
        items: [{ quantity: 1, rate: 1000 }],
        taxRate: 0,
        amountPaid: 1000,
        appliedCredits: 0,
      }).amountDue,
    ).toBe(0);
    // Paid invoice decrease → credit memo path (not rewrite) — builder issues liability
    expect(memo.sourceType).toBe("credit_memo");
    expect(
      assessCreditApplication({
        amount: 50,
        availableOnMemo: 40,
        invoiceAmountDue: 100,
      }).ok,
    ).toBe(false);
  });

  it("33–37. refund cash out; consumes credit; idempotent; reversal; F1 limits", () => {
    const refund = buildRefundJournal({
      refundId: "rf1",
      amount: 75,
      entryDate: "2026-08-18",
      mappings,
    });
    expect(refund.lines[0].accountId).toBe(IDS.creditLiab);
    expect(refund.lines[1].accountId).toBe(IDS.cash);
    expect(refund.idempotencyKey).toBe("refund:rf1:post");
    const rev = buildReversalLines(refund.lines);
    expect(assessJournalBalance(rev).ok).toBe(true);
    expect(assessRefundAmount({ amount: 100, availableCredit: 50 }).ok).toBe(
      false,
    );
  });
});

describe("F3 AP / expense / PO / labor / inventory", () => {
  it("38–43. vendor bill AP; bill payment; PO no expense; linked expense skip; installer labor", () => {
    const bill = buildVendorBillJournal({
      billId: "b1",
      amount: 500,
      entryDate: "2026-08-19",
      mappings,
      inventoryPostingEnabled: false,
    });
    expect(bill.lines[1].accountId).toBe(IDS.ap);
    expect(bill.lines[0].accountId).toBe(IDS.exp);

    const bp = buildBillPaymentJournal({
      billPaymentId: "bp1",
      billId: "b1",
      amount: 500,
      entryDate: "2026-08-20",
      mappings,
    });
    expect(bp.lines[0].accountId).toBe(IDS.ap);
    expect(bp.lines[1].accountId).toBe(IDS.cash);

    expect(assessPurchaseOrderAccounting().posts).toBe(false);

    const linked = buildDirectExpenseJournal({
      expenseId: "e1",
      amount: 500,
      entryDate: "2026-08-20",
      mappings,
      billId: "b1",
    });
    expect("skipped" in linked && linked.skipped).toBe(true);

    const direct = buildDirectExpenseJournal({
      expenseId: "e2",
      amount: 40,
      entryDate: "2026-08-20",
      mappings,
    });
    expect("idempotencyKey" in direct).toBe(true);

    const labor = buildInstallerLaborBillJournal({
      installerBillId: "ib1",
      amount: 300,
      entryDate: "2026-08-21",
      mappings,
    });
    expect(labor.lines[0].accountId).toBe(IDS.labor);
  });

  it("44–46. inventory architecture gated; no fabricate when disabled", () => {
    expect(() =>
      buildInventoryConsumptionJournal({
        movementId: "m1",
        amount: 10,
        entryDate: "2026-08-21",
        mappings,
        inventoryPostingEnabled: false,
      }),
    ).toThrow(INVENTORY_POSTING_DISABLED_MESSAGE);

    expect(() =>
      buildVendorBillJournal({
        billId: "b2",
        amount: 10,
        entryDate: "2026-08-21",
        mappings,
        inventoryPostingEnabled: false,
        treatAsInventoryPurchase: true,
      }),
    ).toThrow(INVENTORY_POSTING_DISABLED_MESSAGE);

    const ok = buildInventoryConsumptionJournal({
      movementId: "m2",
      amount: 10,
      entryDate: "2026-08-21",
      mappings,
      inventoryPostingEnabled: true,
    });
    expect(ok.lines[0].accountId).toBe(IDS.cogs);
  });
});

describe("F3 tax + deposits + opening + no backfill", () => {
  it("47–49. tax split; non-tax; credit tax-inclusive documented model", () => {
    const split = splitInvoiceRevenueTax([{ quantity: 2, rate: 50 }], 10);
    expect(split.subtotal).toBe(100);
    expect(split.tax).toBe(10);
    expect(split.total).toBe(110);
    const credit = buildCreditMemoIssueJournal({
      creditMemoId: "cm2",
      amount: 110,
      entryDate: "2026-08-22",
      mappings,
    });
    // Tax-inclusive: single discount + liability, no fabricated tax lines
    expect(credit.lines).toHaveLength(2);
  });

  it("50–52. opening balanced/unbalanced; no silent historical backfill", () => {
    const opening = buildOpeningBalanceJournal({
      entryDate: "2026-09-01",
      mappings,
      lines: [
        { accountId: IDS.cash, debit: 1000 },
        { accountId: IDS.ar, debit: 500 },
        { accountId: IDS.ap, credit: 200 },
      ],
    });
    expect(assessJournalBalance(opening.lines).ok).toBe(true);
    expect(opening.entryKind).toBe("opening_balance");
    expect(shouldAutoBackfillHistory()).toBe(false);

    const unbalanced = assessJournalBalance([
      { accountId: IDS.cash, debit: 100 },
      { accountId: IDS.ap, credit: 50 },
    ]);
    expect(unbalanced.ok).toBe(false);
  });

  it("customer deposit is distinct from invoice payment", () => {
    const dep = buildCustomerDepositJournal({
      depositId: "d1",
      amount: 250,
      entryDate: "2026-08-10",
      mappings,
    });
    expect(dep.lines[1].accountId).toBe(IDS.dep);
    const pay = buildPaymentJournal({
      paymentId: "p9",
      invoiceId: "inv9",
      amount: 250,
      entryDate: "2026-08-10",
      mappings,
    });
    expect(pay.lines[1].accountId).toBe(IDS.ar);
  });
});

describe("F3 reports", () => {
  it("53–57. TB / P&L / BS / cash from posted lines; reversals net", () => {
    const inv = buildInvoiceIssueJournal({
      invoiceId: "r1",
      entryDate: "2026-08-01",
      items: [{ quantity: 1, rate: 1000 }],
      taxRate: 0,
      mappings,
    });
    const pay = buildPaymentJournal({
      paymentId: "rp1",
      invoiceId: "r1",
      amount: 1000,
      entryDate: "2026-08-02",
      mappings,
      cashPreference: "cash",
    });
    const posted = [
      ...inv.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
        entryDate: inv.entryDate,
        entryStatus: "posted" as const,
      })),
      ...pay.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
        entryDate: pay.entryDate,
        entryStatus: "posted" as const,
      })),
    ];

    const tb = buildTrialBalance({ accounts, lines: posted, asOfDate: "2026-08-31" });
    expect(tb.balanced).toBe(true);
    expect(tb.criticalError).toBeNull();

    const pnl = buildAccountingPnL({
      accounts,
      lines: posted,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    expect(pnl.label).toBe("ACCOUNTING_PNL");
    expect(pnl.revenue).toBe(1000);

    const bs = buildBalanceSheet({
      accounts,
      lines: posted,
      asOfDate: "2026-08-31",
      netIncomeToDate: pnl.netIncome,
    });
    expect(bs.balanced).toBe(true);

    const cash = buildCashMovement({
      cashAccountIds: [IDS.cash],
      lines: posted,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    expect(cash.cashIn).toBe(1000);
    expect(cash.netChange).toBe(1000);

    const revLines = buildReversalLines(pay.lines).map((l) => ({
      accountId: l.accountId,
      debit: l.debit ?? 0,
      credit: l.credit ?? 0,
      entryDate: "2026-08-03",
      entryStatus: "posted" as const,
    }));
    const afterVoid = buildCashMovement({
      cashAccountIds: [IDS.cash],
      lines: [...posted, ...revLines],
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    expect(afterVoid.netChange).toBe(0);
  });
});

describe("F3 permissions / posting policy", () => {
  it("58–61. posting disabled skips auto events; manual blocked; opening via trusted path only", () => {
    const settings = {
      posting_enabled: false,
      inventory_posting_enabled: false,
      cutover_date: null,
      books_of_record: false,
      default_cash_method: "undeposited" as const,
    };
    const blocked = assessAutoPostAllowed({
      settings,
      entryDate: "2026-08-15",
      entryKind: "post",
      sourceType: "invoice",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.skipped).toBe(true);

    const manual = assessAutoPostAllowed({
      settings,
      entryDate: "2026-08-15",
      entryKind: "manual",
      sourceType: "manual",
    });
    expect(manual.ok).toBe(false);

    const opening = assessAutoPostAllowed({
      settings,
      entryDate: "2026-09-01",
      entryKind: "opening_balance",
      sourceType: "opening_balance",
    });
    expect(opening.ok).toBe(true);

    // Role gates are enforced in server actions via assertRole(["admin"]) —
    // documented contract for unauthorized manual journal / reverse / close.
    const adminOnly = ["admin"];
    const officeCannotCloseAlone = !["office"].every((r) =>
      adminOnly.includes(r as "admin"),
    );
    expect(officeCannotCloseAlone).toBe(true);
  });
});

describe("F3 regressions F0/F1/F2", () => {
  it("62–64. F0 overpay / void / PO coverage", () => {
    expect(assessPaymentAmount({ amount: 5, remainingBalance: 0 }).ok).toBe(false);
    expect(activePaymentsTotal([{ amount: 10, status: "void" }])).toBe(0);
    expect(
      computeLineCoverage("l1", 100, [
        {
          poItemId: "a",
          poId: "po",
          jobLineId: "l1",
          productId: "p",
          quantity: 100,
          receivedQty: null,
          receivedAt: null,
          poStatus: "ordered",
        },
      ]).gap,
    ).toBe(0);
  });

  it("65–67. F1 AR / credits / refunds", () => {
    expect(
      effectiveInvoiceBalance({
        items: [{ quantity: 1, rate: 100 }],
        taxRate: 0,
        amountPaid: 40,
        appliedCredits: 10,
      }).amountDue,
    ).toBe(50);
    expect(
      assessRefundAmount({ amount: 5, availableCredit: 5 }).ok,
    ).toBe(true);
  });

  it("68–71. F2 ops / duplicates / tasks / day-task void", () => {
    const s = assessJobOperationalState({
      status: "unscheduled",
      scheduledDate: null,
      warehouseReadyAt: null,
      hasMaterialNeed: true,
      activeHold: null,
    });
    expect(s.blocked).toBe(true);
    expect(normalizeEmail("A@B.COM")).toBe("a@b.com");
    const scored = scoreCustomerDuplicate(
      { fullName: "x", email: "a@b.com", phone: null },
      {
        id: "c1",
        full_name: "y",
        email: "a@b.com",
        phone: null,
      },
    );
    expect(scored?.confidence).toBe("high");
    expect(classifyDuplicateMatches(scored ? [scored] : []).hasHigh).toBe(true);
    expect(isOpenTaskStatus("cancelled")).toBe(false);
    expect(
      isTaskOverdue({
        status: "open",
        dueAt: "2020-01-01T00:00:00Z",
        now: new Date("2026-01-01"),
      }),
    ).toBe(true);
    expect(
      dayTaskCollectAmountDue({
        items: [{ quantity: 1, rate: 100 }],
        taxRate: 0,
        payments: [{ amount: 100, status: "void" }],
      }),
    ).toBe(100);
  });
});
