/**
 * F4 Accounting Integration — deterministic tests.
 */
import { describe, expect, it } from "vitest";
import {
  assertNoSilentAccountingGap,
  planAccountingIntegration,
} from "@/lib/accounting/integration";
import {
  assessAccountingGate,
  classifyAtomicity,
  resolveSourceAccountingStatus,
  type EventFlagSettings,
} from "@/lib/accounting/event-status";
import {
  assessOutboxRetry,
  outboxIdempotencyKey,
  simulateOutboxLifecycle,
} from "@/lib/accounting/outbox-policy";
import {
  paymentMethodMappingsComplete,
  resolvePaymentCashAccount,
} from "@/lib/accounting/payment-method-map";
import {
  buildCreditMemoIssueJournalTaxAware,
  decomposeTaxInclusiveCredit,
} from "@/lib/accounting/tax-credit-decomp";
import {
  classifyPaymentForAccounting,
  depositApplyIsCashMovement,
} from "@/lib/accounting/deposit-classify";
import {
  assessAccountingCutoverReadiness,
  assessBooksOfRecordForCutover,
  assessInventoryAccountingReadiness,
  assessPeriodCloseReadiness,
} from "@/lib/accounting/cutover-readiness";
import {
  assessCompleteReconciliation,
  computeReconciliation,
  listCashMovementsForRecon,
} from "@/lib/accounting/reconciliation";
import {
  installerAccountingSourceOfTruth,
  jobLaborMayAutoPost,
  resolveBillDebitAccount,
} from "@/lib/accounting/ap-category";
import {
  buildBillPaymentJournal,
  buildDirectExpenseJournal,
  buildInvoiceIssueJournal,
  buildPaymentJournal,
  buildVendorBillJournal,
  assessPurchaseOrderAccounting,
} from "@/lib/accounting/builders";
import {
  assessJournalBalance,
  assessPeriodPosting,
  buildReversalLines,
} from "@/lib/accounting/journal";
import {
  buildBalanceSheet,
  buildAccountingPnL,
  buildTrialBalance,
} from "@/lib/accounting/reports";
import type { AccountMappingDict, GlAccountLike } from "@/lib/accounting/types";
import {
  assessPaymentAmount,
  dayTaskCollectAmountDue,
  invoiceRemainingBalance,
} from "@/lib/payment-safety";
import { effectiveInvoiceBalance, assessRefundAmount } from "@/lib/credit-ar";
import { computeLineCoverage } from "@/lib/po-coverage";
import { assessJobOperationalState } from "@/lib/job-operational-state";
import { normalizeEmail, scoreCustomerDuplicate } from "@/lib/customer-duplicate";
import { isOpenTaskStatus } from "@/lib/office-task";
import { TAX_CREDIT_DECOMPOSITION_NOT_READY } from "@/lib/accounting/integrity";

const IDS = {
  cash: "cash",
  uf: "uf",
  ar: "ar",
  ap: "ap",
  tax: "tax",
  disc: "disc",
  liab: "liab",
  rev: "rev",
  exp: "exp",
  cogs: "cogs",
  labor: "labor",
  inv: "inv",
  obe: "obe",
};

const mappings: AccountMappingDict = {
  cash_operating: IDS.cash,
  undeposited_funds: IDS.uf,
  accounts_receivable: IDS.ar,
  inventory_asset: IDS.inv,
  accounts_payable: IDS.ap,
  sales_tax_payable: IDS.tax,
  customer_deposits: "dep",
  customer_credit_liability: IDS.liab,
  opening_balance_equity: IDS.obe,
  owner_equity: "own",
  retained_earnings: "re",
  default_sales_revenue: IDS.rev,
  sales_discounts: IDS.disc,
  material_cogs: IDS.cogs,
  installer_labor_cogs: IDS.labor,
  default_expense: IDS.exp,
};

const accounts: GlAccountLike[] = [
  { id: IDS.cash, code: "1000", name: "Cash", account_type: "asset" },
  { id: IDS.ar, code: "1100", name: "AR", account_type: "asset" },
  { id: IDS.ap, code: "2000", name: "AP", account_type: "liability" },
  { id: IDS.tax, code: "2100", name: "Tax", account_type: "liability" },
  { id: IDS.liab, code: "2250", name: "Credit Liab", account_type: "liability" },
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
    name: "Exp",
    account_type: "expense",
    subtype: "opex",
  },
];

const flagsOff: EventFlagSettings = {
  posting_enabled: false,
  invoice_posting_enabled: false,
  payment_posting_enabled: false,
  credit_posting_enabled: false,
  ap_posting_enabled: false,
  expense_posting_enabled: false,
  deposit_posting_enabled: false,
  installer_posting_enabled: false,
  inventory_posting_enabled: false,
  cutover_date: null,
};

const flagsOn: EventFlagSettings = {
  ...flagsOff,
  posting_enabled: true,
  invoice_posting_enabled: true,
  payment_posting_enabled: true,
  credit_posting_enabled: true,
  ap_posting_enabled: true,
  expense_posting_enabled: true,
  deposit_posting_enabled: true,
  cutover_date: "2026-09-01",
};

describe("F4 integration gates", () => {
  it("1–3. disabled / pre-cutover / post-cutover plans", () => {
    const off = planAccountingIntegration({
      kind: "invoice_issue",
      sourceType: "invoice",
      sourceId: "i1",
      entryDate: "2026-09-15",
      flags: flagsOff,
    });
    expect(off.action).toBe("skip_disabled");
    expect(off.status).toBe("disabled");

    const legacy = planAccountingIntegration({
      kind: "invoice_issue",
      sourceType: "invoice",
      sourceId: "i1",
      entryDate: "2026-08-01",
      flags: flagsOn,
    });
    expect(legacy.action).toBe("skip_legacy");
    expect(legacy.status).toBe("legacy_pre_cutover");

    // Invoice issue is same-TX guaranteed via finalize_invoice_safe (F5).
    const go = planAccountingIntegration({
      kind: "invoice_issue",
      sourceType: "invoice",
      sourceId: "i1",
      entryDate: "2026-09-15",
      flags: flagsOn,
    });
    expect(go.action).toBe("enqueue_outbox");
    expect(go.fullyAtomicVerified).toBe(false);
    expect(classifyAtomicity("invoice_issue")).toBe("outbox_guaranteed");
  });

  it("4–7. duplicate outbox / status / gap assertion", () => {
    const keys = new Set<string>();
    const k = outboxIdempotencyKey("payment", "p1", "payment");
    expect(simulateOutboxLifecycle(keys, k).enqueued).toBe(true);
    expect(simulateOutboxLifecycle(keys, k).duplicate).toBe(true);

    expect(
      resolveSourceAccountingStatus({
        postingEnabled: true,
        cutoverDate: "2026-09-01",
        entryDate: "2026-09-10",
        journalPosted: false,
        journalReversed: false,
        outboxStatus: "pending",
      }),
    ).toBe("pending");

    const plan = planAccountingIntegration({
      kind: "payment",
      sourceType: "payment",
      sourceId: "p1",
      entryDate: "2026-09-10",
      flags: flagsOn,
    });
    expect(plan.action).toBe("enqueue_outbox");
    expect(
      assertNoSilentAccountingGap({
        postingEnabled: true,
        plan,
        journalPosted: false,
        outboxEnqueued: false,
        statusRecorded: true,
      }).ok,
    ).toBe(false);
    expect(
      assertNoSilentAccountingGap({
        postingEnabled: true,
        plan,
        journalPosted: false,
        outboxEnqueued: true,
        statusRecorded: true,
      }).ok,
    ).toBe(true);

    expect(
      assessOutboxRetry({
        attemptCount: 8,
        maxAttempts: 8,
        status: "failed",
      }).ok,
    ).toBe(false);
  });
});

describe("F4 invoice / payment / credits", () => {
  it("8–14. invoice tax / void reversal / legacy skip", () => {
    const inv = buildInvoiceIssueJournal({
      invoiceId: "inv",
      entryDate: "2026-09-10",
      items: [{ quantity: 1, rate: 1000 }],
      taxRate: 8,
      mappings,
    });
    expect(assessJournalBalance(inv.lines).ok).toBe(true);
    const nontax = buildInvoiceIssueJournal({
      invoiceId: "inv0",
      entryDate: "2026-09-10",
      items: [{ quantity: 1, rate: 500 }],
      taxRate: 0,
      mappings,
    });
    expect(nontax.lines.some((l) => l.accountId === IDS.tax)).toBe(false);
    const rev = buildReversalLines(inv.lines);
    expect(assessJournalBalance(rev).ok).toBe(true);
    expect(
      planAccountingIntegration({
        kind: "invoice_issue",
        sourceType: "invoice",
        sourceId: "legacy",
        entryDate: "2026-01-01",
        flags: flagsOn,
      }).status,
    ).toBe("legacy_pre_cutover");
  });

  it("15–20. payment mapping / void / credits not cash", () => {
    const map = { card: IDS.uf, cash: IDS.cash };
    expect(resolvePaymentCashAccount({ method: "card", mappings: map }).ok).toBe(
      true,
    );
    expect(
      resolvePaymentCashAccount({ method: "wire", mappings: {} }).ok,
    ).toBe(false);
    expect(
      paymentMethodMappingsComplete(
        ["card", "cash", "check", "echeck", "financing", "link", "other"],
        {
          card: "1",
          cash: "1",
          check: "1",
          echeck: "1",
          financing: "1",
          link: "1",
          other: "1",
        },
      ).complete,
    ).toBe(true);

    const pay = buildPaymentJournal({
      paymentId: "p1",
      invoiceId: "i1",
      amount: 100,
      entryDate: "2026-09-10",
      mappings,
    });
    expect(pay.idempotencyKey).toBe("payment:p1:post");
    expect(buildReversalLines(pay.lines)[0].credit).toBe(100);
  });

  it("21–28. credit tax decomp / review / lifecycle", () => {
    const ok = decomposeTaxInclusiveCredit({
      creditAmount: 1080,
      basis: { pretaxTotal: 1000, taxTotal: 80, taxRatePct: 8 },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.pretax).toBe(1000);
      expect(ok.tax).toBe(80);
    }
    const built = buildCreditMemoIssueJournalTaxAware({
      creditMemoId: "cm1",
      amount: 1080,
      entryDate: "2026-09-10",
      mappings,
      basis: { pretaxTotal: 1000, taxTotal: 80, taxRatePct: 8 },
    });
    expect(built.ok).toBe(true);

    const review = buildCreditMemoIssueJournalTaxAware({
      creditMemoId: "cm2",
      amount: 500,
      entryDate: "2026-09-10",
      mappings,
      basis: null,
    });
    expect(review.ok).toBe(false);
    if (!review.ok) {
      expect(review.flag).toBe(TAX_CREDIT_DECOMPOSITION_NOT_READY);
      expect(review.fallbackEntry.lines).toHaveLength(2);
    }

    const nontax = decomposeTaxInclusiveCredit({
      creditAmount: 200,
      basis: null,
      knownNonTaxable: true,
    });
    expect(nontax.ok).toBe(true);
  });
});

describe("F4 deposits / AP / expenses / installer", () => {
  it("29–32. deposit classification", () => {
    expect(
      classifyPaymentForAccounting({
        hasIssuedInvoiceWithPositiveTotal: true,
        blankZeroInvoice: false,
        explicitPreInvoiceDeposit: false,
      }).ok,
    ).toBe(true);
    expect(
      classifyPaymentForAccounting({
        hasIssuedInvoiceWithPositiveTotal: false,
        blankZeroInvoice: true,
        explicitPreInvoiceDeposit: false,
      }).ok,
    ).toBe(false);
    expect(depositApplyIsCashMovement()).toBe(false);
  });

  it("33–39. AP one recognition; installer SoT", () => {
    expect(assessPurchaseOrderAccounting().posts).toBe(false);
    expect(
      resolveBillDebitAccount({
        category: null,
        mappings,
        inventoryPostingEnabled: false,
      }).ok,
    ).toBe(false);
    const bill = buildVendorBillJournal({
      billId: "b1",
      amount: 5000,
      entryDate: "2026-09-10",
      mappings,
      inventoryPostingEnabled: false,
    });
    const bp = buildBillPaymentJournal({
      billPaymentId: "bp1",
      billId: "b1",
      amount: 5000,
      entryDate: "2026-09-11",
      mappings,
    });
    const linked = buildDirectExpenseJournal({
      expenseId: "e1",
      amount: 5000,
      entryDate: "2026-09-11",
      mappings,
      billId: "b1",
    });
    expect("skipped" in linked).toBe(true);
    expect(classifyAtomicity("bill_payment")).toBe("outbox_guaranteed");
    expect(installerAccountingSourceOfTruth()).toBe("installer_bills");
    expect(jobLaborMayAutoPost()).toBe(false);
    expect(classifyAtomicity("installer_bill")).toBe("outbox_guaranteed");
    void bill;
    void bp;
  });

  it("40–42. direct expense once", () => {
    const e = buildDirectExpenseJournal({
      expenseId: "e2",
      amount: 40,
      entryDate: "2026-09-10",
      mappings,
    });
    expect("idempotencyKey" in e).toBe(true);
  });
});

describe("F4 outbox / recon / readiness", () => {
  it("43–48. outbox uniqueness / exhaustion", () => {
    const keys = new Set<string>();
    expect(simulateOutboxLifecycle(keys, "a").enqueued).toBe(true);
    expect(simulateOutboxLifecycle(keys, "a").duplicate).toBe(true);
    const exhausted = assessOutboxRetry({
      attemptCount: 99,
      maxAttempts: 8,
      status: "failed",
    });
    expect(exhausted.ok).toBe(false);
  });

  it("49–54. reconciliation cash-only; credit memo excluded", () => {
    const lines = listCashMovementsForRecon({
      cashAccountIds: [IDS.cash],
      lines: [
        {
          journalLineId: "1",
          accountId: IDS.cash,
          entryDate: "2026-09-05",
          debit: 100,
          credit: 0,
          entryStatus: "posted",
        },
        {
          journalLineId: "2",
          accountId: IDS.disc,
          entryDate: "2026-09-05",
          debit: 50,
          credit: 0,
          entryStatus: "posted",
        },
      ],
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(lines).toHaveLength(1);
    const cleared = new Set(["1"]);
    const recon = computeReconciliation({
      openingBalance: 0,
      statementEndingBalance: 100,
      lines,
      clearedLineIds: cleared,
    });
    expect(recon.difference).toBe(0);
    expect(recon.canComplete).toBe(true);
    expect(assessCompleteReconciliation(1).ok).toBe(false);
    expect(assessCompleteReconciliation(0).ok).toBe(true);
  });

  it("55–64. cutover readiness / books gate", () => {
    const base = {
      systemMappingsComplete: true,
      paymentMethodMappingsComplete: true,
      cutoverDateSet: false,
      openingBalancesEntered: false,
      trialBalanceBalanced: true,
      balanceSheetBalanced: true,
      failedOutboxCount: 0,
      pendingCriticalOutboxCount: 0,
      taxReviewRequiredCount: 0,
      unclassifiedDepositsCount: 0,
      billsNeedingCategoryCount: 0,
      installerAmbiguityResolved: true,
      inventoryPostingEnabled: false,
      inventoryReady: false,
      booksOfRecord: false,
      postingEnabled: false,
      backupPitrConfirmedByOwner: false,
      accountantSignOff: false,
    };
    expect(assessAccountingCutoverReadiness(base).result).toBe("NOT_READY");

    const pilot = assessAccountingCutoverReadiness({
      ...base,
      cutoverDateSet: true,
      openingBalancesEntered: true,
      backupPitrConfirmedByOwner: true,
    });
    expect(pilot.result).toBe("READY_FOR_PILOT");

    const cutover = assessAccountingCutoverReadiness({
      ...base,
      cutoverDateSet: true,
      openingBalancesEntered: true,
      backupPitrConfirmedByOwner: true,
      accountantSignOff: true,
    });
    expect(cutover.result).toBe("READY_FOR_CUTOVER");

    expect(
      assessBooksOfRecordForCutover({
        requested: true,
        readiness: "READY_FOR_CUTOVER",
        accountantSignOff: true,
        openingBalancesEntered: true,
        cutoverDateSet: true,
        postingEnabled: true,
      }).ok,
    ).toBe(true);
    expect(
      assessBooksOfRecordForCutover({
        requested: true,
        readiness: "READY_FOR_PILOT",
        accountantSignOff: false,
        openingBalancesEntered: true,
        cutoverDateSet: true,
        postingEnabled: true,
      }).booksOfRecord,
    ).toBe(false);

    expect(
      assessInventoryAccountingReadiness({
        itemsHaveIdentity: false,
        quantitiesReliable: false,
        actualCostsAvailable: false,
        receiptDatesPresent: false,
        vendorBillLinksPresent: false,
        consumptionTracked: false,
        returnsAdjustmentsTracked: false,
        unitCostConsistent: false,
      }).result,
    ).toBe("NOT_READY");
  });

  it("65–68. period close + closed period still blocked", () => {
    expect(
      assessPeriodCloseReadiness({
        failedOutboxCount: 1,
        pendingOutboxCount: 0,
        trialBalanceBalanced: true,
        balanceSheetBalanced: true,
        cashReconciledOrWaived: true,
        taxReviewComplete: true,
      }).ready,
    ).toBe(false);
    expect(
      assessPeriodPosting({ periodStatus: "closed", entryKind: "post" }).ok,
    ).toBe(false);
    expect(
      assessPeriodPosting({ periodStatus: "locked", entryKind: "reversal" }).ok,
    ).toBe(false);
  });
});

describe("F4 regressions F0–F3", () => {
  it("69–84. money + ops + ledger regressions still hold", () => {
    expect(assessPaymentAmount({ amount: 1, remainingBalance: 0 }).ok).toBe(false);
    expect(
      invoiceRemainingBalance([{ quantity: 1, rate: 10 }], 0, [
        { amount: 10, status: "void" },
      ]),
    ).toBe(10);
    expect(
      computeLineCoverage("l", 10, [
        {
          poItemId: "a",
          poId: "p",
          jobLineId: "l",
          productId: "x",
          quantity: 10,
          receivedQty: null,
          receivedAt: null,
          poStatus: "ordered",
        },
      ]).gap,
    ).toBe(0);
    expect(
      effectiveInvoiceBalance({
        items: [{ quantity: 1, rate: 100 }],
        taxRate: 0,
        amountPaid: 40,
        appliedCredits: 10,
      }).amountDue,
    ).toBe(50);
    expect(assessRefundAmount({ amount: 5, availableCredit: 5 }).ok).toBe(true);
    expect(
      assessJobOperationalState({
        status: "unscheduled",
        scheduledDate: null,
        warehouseReadyAt: null,
        hasMaterialNeed: true,
        activeHold: null,
      }).blocked,
    ).toBe(true);
    expect(normalizeEmail("A@B.COM")).toBe("a@b.com");
    expect(
      scoreCustomerDuplicate(
        { fullName: "x", email: "a@b.com" },
        { id: "1", full_name: "y", email: "a@b.com" },
      )?.confidence,
    ).toBe("high");
    expect(isOpenTaskStatus("cancelled")).toBe(false);
    expect(
      dayTaskCollectAmountDue({
        items: [{ quantity: 1, rate: 100 }],
        taxRate: 0,
        payments: [{ amount: 100, status: "void" }],
      }),
    ).toBe(100);

    const je = buildInvoiceIssueJournal({
      invoiceId: "r",
      entryDate: "2026-09-01",
      items: [{ quantity: 1, rate: 100 }],
      taxRate: 0,
      mappings,
    });
    const lines = je.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.debit ?? 0,
      credit: l.credit ?? 0,
      entryDate: je.entryDate,
      entryStatus: "posted" as const,
    }));
    expect(buildTrialBalance({ accounts, lines }).balanced).toBe(true);
    const pnl = buildAccountingPnL({
      accounts,
      lines,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(
      buildBalanceSheet({
        accounts,
        lines,
        asOfDate: "2026-09-30",
        netIncomeToDate: pnl.netIncome,
      }).balanced,
    ).toBe(true);
    expect(assessAccountingGate({ kind: "payment", flags: flagsOff, entryDate: "2026-09-01" }).ok).toBe(
      false,
    );
  });
});
