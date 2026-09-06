/**
 * F4 final reliability hardening — durable rebuild, processor, atomicity honesty.
 */
import { describe, expect, it } from "vitest";
import {
  assertNoSilentAccountingGap,
  planAccountingIntegration,
} from "@/lib/accounting/integration";
import {
  ACCOUNTING_FAILURE,
  classifyAtomicity,
  rebuildModeForKind,
  type EventFlagSettings,
} from "@/lib/accounting/event-status";
import {
  buildPaymentOutboxSnapshot,
  journalIdempotencyKey,
  parseOutboxSnapshot,
  rebuildAccountingEventFromSnapshot,
  type AccountingOutboxSnapshot,
} from "@/lib/accounting/outbox-rebuild";
import {
  convergeAfterCrashPost,
  decideOutboxProcess,
  simulateOutboxClaim,
} from "@/lib/accounting/outbox-processor";
import { assessOutboxRetry } from "@/lib/accounting/outbox-policy";
import { assessJournalBalance, buildReversalLines, assessPeriodPosting } from "@/lib/accounting/journal";
import { assessAccountingCutoverReadiness } from "@/lib/accounting/cutover-readiness";
import {
  assessPaymentAmount,
  invoiceRemainingBalance,
} from "@/lib/payment-safety";
import { assessRefundAmount, effectiveInvoiceBalance } from "@/lib/credit-ar";

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
  payment_posting_enabled: true,
  credit_posting_enabled: true,
  ap_posting_enabled: true,
  cutover_date: "2026-10-01",
};

function paymentSnap(overrides?: Partial<AccountingOutboxSnapshot>): AccountingOutboxSnapshot {
  return {
    ...buildPaymentOutboxSnapshot({
      paymentId: "pay-1",
      invoiceId: "inv-1",
      amount: 10000,
      economicEventDate: "2026-10-02",
      paymentMethod: "card",
      cashAccountId: "acct-uf-A",
      arAccountId: "acct-ar",
      customerId: "cust-1",
    }),
    ...overrides,
  };
}

describe("F4 durable rebuild (1–6)", () => {
  it("1. payment rebuild after request memory gone", () => {
    const snap = paymentSnap();
    const rebuilt = rebuildAccountingEventFromSnapshot({ snapshot: snap });
    expect(rebuilt.ok).toBe(true);
    if (rebuilt.ok) {
      expect(rebuilt.entry.idempotencyKey).toBe("payment:pay-1:post");
      expect(rebuilt.entry.entryDate).toBe("2026-10-02");
      expect(rebuilt.entry.lines[0].accountId).toBe("acct-uf-A");
      expect(assessJournalBalance(rebuilt.entry.lines).ok).toBe(true);
    }
    expect(rebuildModeForKind("payment")).toBe("IMMUTABLE_OUTBOX_SNAPSHOT");
  });

  it("2. payment void rebuild from original lines", () => {
    const pay = rebuildAccountingEventFromSnapshot({ snapshot: paymentSnap() });
    expect(pay.ok).toBe(true);
    if (!pay.ok) return;
    const voidSnap: AccountingOutboxSnapshot = {
      schemaVersion: 1,
      eventKind: "payment_void",
      economicEventDate: "2026-10-03",
      rebuildStrategy: "immutable_outbox_snapshot",
      sourceType: "payment",
      sourceId: "pay-1",
      amount: 10000,
      originalJournalEntryId: "je-orig",
    };
    const rev = rebuildAccountingEventFromSnapshot({
      snapshot: voidSnap,
      originalJournalLines: pay.entry.lines,
    });
    expect(rev.ok).toBe(true);
    if (rev.ok) {
      expect(rev.entry.idempotencyKey).toBe("payment:pay-1:void");
      expect(assessJournalBalance(rev.entry.lines).ok).toBe(true);
    }
  });

  it("3–5. credit application / refund / refund void rebuild", () => {
    const app: AccountingOutboxSnapshot = {
      schemaVersion: 1,
      eventKind: "credit_application",
      economicEventDate: "2026-10-02",
      rebuildStrategy: "immutable_outbox_snapshot",
      sourceType: "credit_application",
      sourceId: "app-1",
      amount: 250,
      invoiceId: "inv-1",
      liabilityAccountId: "liab",
      arAccountId: "ar",
    };
    const a = rebuildAccountingEventFromSnapshot({ snapshot: app });
    expect(a.ok).toBe(true);

    const refund: AccountingOutboxSnapshot = {
      schemaVersion: 1,
      eventKind: "refund",
      economicEventDate: "2026-10-02",
      rebuildStrategy: "immutable_outbox_snapshot",
      sourceType: "refund",
      sourceId: "ref-1",
      amount: 100,
      liabilityAccountId: "liab",
      cashAccountId: "cash",
    };
    const r = rebuildAccountingEventFromSnapshot({ snapshot: refund });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const voidR = rebuildAccountingEventFromSnapshot({
        snapshot: {
          ...refund,
          eventKind: "refund_void",
          originalJournalEntryId: "je-r",
        },
        originalJournalLines: r.entry.lines,
      });
      expect(voidR.ok).toBe(true);
    }
  });

  it("6. bill payment rebuild", () => {
    const bp: AccountingOutboxSnapshot = {
      schemaVersion: 1,
      eventKind: "bill_payment",
      economicEventDate: "2026-10-02",
      rebuildStrategy: "immutable_outbox_snapshot",
      sourceType: "bill_payment",
      sourceId: "bp-1",
      amount: 500,
      billId: "bill-1",
      apAccountId: "ap",
      cashAccountId: "cash",
    };
    const rebuilt = rebuildAccountingEventFromSnapshot({ snapshot: bp });
    expect(rebuilt.ok).toBe(true);
    expect(classifyAtomicity("bill_payment")).toBe("outbox_guaranteed");
  });
});

describe("F4 concurrency / crash / retry (7–11)", () => {
  it("7. simultaneous workers → one claim winner", () => {
    const claimed = new Map<string, string>();
    const first = simulateOutboxClaim({
      itemId: "ox-1",
      status: "pending",
      workers: ["w1", "w2"],
      claimedBy: claimed,
    });
    expect(first.winner).toBe("w1");
    const second = simulateOutboxClaim({
      itemId: "ox-1",
      status: "pending",
      workers: ["w2", "w3"],
      claimedBy: claimed,
    });
    expect(second.winner).toBe(null);
    expect(second.losers).toContain("w2");
  });

  it("8. crash after journal / before outbox update → converge", () => {
    const snap = paymentSnap();
    const decision = decideOutboxProcess({
      status: "processing",
      attemptCount: 2,
      maxAttempts: 8,
      payload: snap,
      existingJournalId: "je-already",
      periodStatus: "open",
      flags: flagsOn,
    });
    expect(decision.action).toBe("already_posted");
    if (decision.action === "already_posted") {
      expect(decision.convergeOutbox).toBe(true);
      expect(decision.journalEntryId).toBe("je-already");
    }
    const conv = convergeAfterCrashPost({
      outboxStatus: "processing",
      existingJournalId: "je-already",
    });
    expect(conv.ok).toBe(true);
    if (conv.ok) {
      expect(conv.outboxStatus).toBe("posted");
      expect(conv.duplicateJournal).toBe(false);
    }
  });

  it("9. duplicate retry → one journal idempotency key", () => {
    const snap = paymentSnap();
    const a = rebuildAccountingEventFromSnapshot({ snapshot: snap });
    const b = rebuildAccountingEventFromSnapshot({ snapshot: snap });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.entry.idempotencyKey).toBe(b.entry.idempotencyKey);
      expect(a.entry.idempotencyKey).toBe(journalIdempotencyKey(snap));
    }
  });

  it("10. max attempts → visible failed", () => {
    const gate = assessOutboxRetry({
      attemptCount: 8,
      maxAttempts: 8,
      status: "failed",
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.exhausted).toBe(true);
      expect(gate.code).toBe(ACCOUNTING_FAILURE.OUTBOX_RETRY_EXHAUSTED);
    }
  });

  it("11. admin retry uses same decideOutboxProcess (canonical)", () => {
    const snap = paymentSnap();
    const adminPath = decideOutboxProcess({
      status: "failed",
      attemptCount: 1,
      maxAttempts: 8,
      payload: snap,
      existingJournalId: null,
      periodStatus: "open",
      flags: flagsOn,
    });
    const cronPath = decideOutboxProcess({
      status: "pending",
      attemptCount: 1,
      maxAttempts: 8,
      payload: snap,
      existingJournalId: null,
      periodStatus: "open",
      flags: flagsOn,
    });
    expect(adminPath.action).toBe("post");
    expect(cronPath.action).toBe("post");
    if (adminPath.action === "post" && cronPath.action === "post") {
      expect(adminPath.entry.idempotencyKey).toBe(cronPath.entry.idempotencyKey);
    }
  });
});

describe("F4 cutover / mapping / period / disabled (12–16)", () => {
  it("12–13. pre-cutover retried post-cutover does not post; cutover date eligible", () => {
    const pre = paymentSnap({ economicEventDate: "2026-09-30" });
    const dPre = decideOutboxProcess({
      status: "pending",
      attemptCount: 1,
      maxAttempts: 8,
      payload: pre,
      existingJournalId: null,
      periodStatus: "open",
      flags: flagsOn,
      now: new Date("2026-10-15T12:00:00Z"),
    });
    expect(dPre.action).toBe("skip_legacy");

    const onCutover = paymentSnap({ economicEventDate: "2026-10-01" });
    const dOn = decideOutboxProcess({
      status: "pending",
      attemptCount: 1,
      maxAttempts: 8,
      payload: onCutover,
      existingJournalId: null,
      periodStatus: "open",
      flags: flagsOn,
    });
    expect(dOn.action).toBe("post");

    const after = paymentSnap({ economicEventDate: "2026-10-02" });
    expect(
      decideOutboxProcess({
        status: "pending",
        attemptCount: 1,
        maxAttempts: 8,
        payload: after,
        existingJournalId: null,
        periodStatus: "open",
        flags: flagsOn,
      }).action,
    ).toBe("post");
  });

  it("14. mapping change after event does not alter frozen account", () => {
    const snap = paymentSnap({ cashAccountId: "acct-uf-A" });
    const d = decideOutboxProcess({
      status: "pending",
      attemptCount: 1,
      maxAttempts: 8,
      payload: snap,
      existingJournalId: null,
      periodStatus: "open",
      flags: flagsOn,
      liveCashAccountIdForMethod: "acct-uf-B", // admin changed mapping
    });
    expect(d.action).toBe("post");
    if (d.action === "post") {
      expect(d.entry.lines[0].accountId).toBe("acct-uf-A");
      expect(d.entry.lines[0].accountId).not.toBe("acct-uf-B");
    }
  });

  it("15. period closed while pending → review_required, no date shift", () => {
    const snap = paymentSnap({ economicEventDate: "2026-10-02" });
    const d = decideOutboxProcess({
      status: "pending",
      attemptCount: 1,
      maxAttempts: 8,
      payload: snap,
      existingJournalId: null,
      periodStatus: "closed",
      flags: flagsOn,
    });
    expect(d.action).toBe("review_required");
    if (d.action === "review_required") {
      expect(d.code).toBe(ACCOUNTING_FAILURE.CLOSED_PERIOD);
      expect(d.message).toContain("2026-10-02");
    }
  });

  it("16. posting disabled does not create backlog intended for later", () => {
    const plan = planAccountingIntegration({
      kind: "payment",
      sourceType: "payment",
      sourceId: "p1",
      entryDate: "2026-10-02",
      flags: flagsOff,
    });
    expect(plan.action).toBe("skip_disabled");
    expect(
      assertNoSilentAccountingGap({
        postingEnabled: false,
        plan,
        journalPosted: false,
        outboxEnqueued: true, // would be wrong
        statusRecorded: true,
      }).ok,
    ).toBe(false);
    expect(
      assertNoSilentAccountingGap({
        postingEnabled: false,
        plan,
        journalPosted: false,
        outboxEnqueued: false,
        statusRecorded: true,
      }).ok,
    ).toBe(true);
  });
});

describe("F4 tax / atomicity honesty / regressions (17–25)", () => {
  it("17. tax-review-required blocks cutover", () => {
    expect(
      assessAccountingCutoverReadiness({
        systemMappingsComplete: true,
        paymentMethodMappingsComplete: true,
        cutoverDateSet: true,
        openingBalancesEntered: true,
        trialBalanceBalanced: true,
        balanceSheetBalanced: true,
        failedOutboxCount: 0,
        pendingCriticalOutboxCount: 0,
        taxReviewRequiredCount: 3,
        unclassifiedDepositsCount: 0,
        billsNeedingCategoryCount: 0,
        installerAmbiguityResolved: true,
        inventoryPostingEnabled: false,
        inventoryReady: false,
        booksOfRecord: false,
        postingEnabled: false,
        backupPitrConfirmedByOwner: true,
        accountantSignOff: true,
      }).result,
    ).toBe("NOT_READY");
  });

  it("18. source/outbox atomicity classification matches implementation", () => {
    expect(classifyAtomicity("payment")).toBe("outbox_guaranteed");
    expect(classifyAtomicity("payment_void")).toBe("outbox_guaranteed");
    expect(classifyAtomicity("credit_application")).toBe("outbox_guaranteed");
    expect(classifyAtomicity("refund")).toBe("outbox_guaranteed");
    expect(classifyAtomicity("refund_void")).toBe("outbox_guaranteed");
    expect(classifyAtomicity("bill_payment")).toBe("outbox_guaranteed");
    expect(classifyAtomicity("invoice_issue")).toBe("outbox_guaranteed");
    expect(classifyAtomicity("vendor_bill")).toBe("outbox_guaranteed");
    expect(classifyAtomicity("manual")).toBe("fully_atomic");
    expect(classifyAtomicity("opening_balance")).toBe("fully_atomic");
    expect(classifyAtomicity("installer_bill")).toBe("outbox_guaranteed");

    const inv = planAccountingIntegration({
      kind: "invoice_issue",
      sourceType: "invoice",
      sourceId: "i1",
      entryDate: "2026-10-02",
      flags: { ...flagsOn, invoice_posting_enabled: true },
    });
    expect(inv.action).toBe("enqueue_outbox");
    expect(inv.fullyAtomicVerified).toBe(false);

    const pay = planAccountingIntegration({
      kind: "payment",
      sourceType: "payment",
      sourceId: "p1",
      entryDate: "2026-10-02",
      flags: flagsOn,
    });
    expect(pay.action).toBe("enqueue_outbox");
  });

  it("19–24. F0/F1/F3 regressions still hold", () => {
    expect(assessPaymentAmount({ amount: 1, remainingBalance: 0 }).ok).toBe(false);
    expect(
      invoiceRemainingBalance([{ quantity: 1, rate: 10 }], 0, [
        { amount: 10, status: "void" },
      ]),
    ).toBe(10);
    expect(assessRefundAmount({ amount: 5, availableCredit: 5 }).ok).toBe(true);
    expect(
      effectiveInvoiceBalance({
        items: [{ quantity: 1, rate: 100 }],
        taxRate: 0,
        amountPaid: 40,
        appliedCredits: 10,
      }).amountDue,
    ).toBe(50);
    expect(
      assessPeriodPosting({ periodStatus: "closed", entryKind: "post" }).ok,
    ).toBe(false);
    expect(
      assessPeriodPosting({ periodStatus: "locked", entryKind: "reversal" }).ok,
    ).toBe(false);
    const lines = [
      { accountId: "a", debit: 10, credit: 0 },
      { accountId: "b", debit: 0, credit: 10 },
    ];
    expect(assessJournalBalance(lines).ok).toBe(true);
    expect(assessJournalBalance(buildReversalLines(lines)).ok).toBe(true);
  });

  it("25. parse rejects incomplete payload (no silent rebuild)", () => {
    expect(parseOutboxSnapshot({}).ok).toBe(false);
    expect(parseOutboxSnapshot({ schemaVersion: 1 }).ok).toBe(false);
  });
});
