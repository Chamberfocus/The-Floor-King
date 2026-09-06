/**
 * F5 Accounting Completion — deterministic tests.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyAtomicity,
  type EventFlagSettings,
} from "@/lib/accounting/event-status";
import { planAccountingIntegration } from "@/lib/accounting/integration";
import {
  journalIdempotencyKey,
  rebuildAccountingEventFromSnapshot,
  type AccountingOutboxSnapshot,
} from "@/lib/accounting/outbox-rebuild";
import { decideOutboxProcess } from "@/lib/accounting/outbox-processor";
import {
  assessReconciliationCompleteGuard,
  assessEnqueueEconomicDate,
  billPaymentEconomicDate,
  depositApplyEconomicDate,
  depositReceiptEconomicDate,
  economicDatePolicySummary,
  invoiceIssueEconomicDate,
  invoiceVoidEconomicDate,
  vendorBillEconomicDate,
  resolveSourceBusinessDate,
} from "@/lib/accounting/economic-date";
import {
  mayInvokeF5Rpc,
  rolesAllowedForF5Rpc,
  type F5FinancialRpc,
  isEligibleCashAccountSubtype,
  isStaffEquivalentToAdminOffice,
  classifyRequestIdentity,
  nullUidIsTrusted,
  mayDirectExecuteInternalRpc,
  resolveAccountingActorId,
  expectedExecuteGrantAfter0168,
  isExplicitServiceRole,
} from "@/lib/accounting/f5-rpc-auth";
import {
  assessAccountingPilotReadiness,
  assessFamilyPilotReadiness,
  recommendedPilotSequence,
} from "@/lib/accounting/pilot-readiness";
import {
  buildDepositApplyJournal,
  buildDirectExpenseJournal,
  buildInvoiceIssueJournal,
  buildVendorBillJournal,
  assessPurchaseOrderAccounting,
} from "@/lib/accounting/builders";
import { assessJournalBalance, buildReversalLines } from "@/lib/accounting/journal";
import { assessPaymentAmount } from "@/lib/payment-safety";
import { assessRefundAmount } from "@/lib/credit-ar";
import type { AccountMappingDict } from "@/lib/accounting/types";
import {
  invoiceAccountingPilotActive,
  invoiceIssueBypassBlocked,
  resolveAccountingActor,
} from "@/lib/accounting/invoice-issue-guard";
import {
  ensureInvoiceIssued,
  finalizeInvoiceSafe,
  voidInvoiceSafe,
} from "@/lib/invoice-issue";

const mappings: AccountMappingDict = {
  cash_operating: "cash",
  undeposited_funds: "uf",
  accounts_receivable: "ar",
  accounts_payable: "ap",
  sales_tax_payable: "tax",
  customer_deposits: "dep",
  customer_credit_liability: "liab",
  default_sales_revenue: "rev",
  sales_discounts: "disc",
  default_expense: "exp",
  material_cogs: "cogs",
  installer_labor_cogs: "labor",
  inventory_asset: "inv",
  opening_balance_equity: "obe",
};

const flagsOn: EventFlagSettings = {
  posting_enabled: true,
  invoice_posting_enabled: true,
  payment_posting_enabled: true,
  credit_posting_enabled: true,
  ap_posting_enabled: true,
  expense_posting_enabled: true,
  deposit_posting_enabled: true,
  installer_posting_enabled: false,
  inventory_posting_enabled: false,
  cutover_date: "2026-10-01",
};

const readyFamily = {
  sourceOutboxGuaranteed: true,
  lifecycleComplete: true,
  requiredMappingsComplete: true,
  reviewRequiredCount: 0,
  failedOutboxCount: 0,
  ambiguousCount: 0,
};

describe("F5 guarantees + rebuild", () => {
  it("1–10. invoice issue/void snapshot + idempotency", () => {
    expect(classifyAtomicity("invoice_issue")).toBe("outbox_guaranteed");
    expect(classifyAtomicity("invoice_void")).toBe("outbox_guaranteed");
    expect(invoiceIssueEconomicDate("2026-10-05")).toBe("2026-10-05");
    expect(economicDatePolicySummary("invoice_void")).toContain("void_authorization");

    const inv = buildInvoiceIssueJournal({
      invoiceId: "inv1",
      entryDate: "2026-10-05",
      items: [{ quantity: 1, rate: 1000 }],
      taxRate: 8,
      mappings,
    });
    expect(assessJournalBalance(inv.lines).ok).toBe(true);

    const snap: AccountingOutboxSnapshot = {
      schemaVersion: 1,
      eventKind: "invoice_issue",
      economicEventDate: "2026-10-05",
      rebuildStrategy: "immutable_outbox_snapshot",
      sourceType: "invoice",
      sourceId: "inv1",
      amount: 1080,
      frozenLines: inv.lines,
    };
    const rebuilt = rebuildAccountingEventFromSnapshot({ snapshot: snap });
    expect(rebuilt.ok).toBe(true);
    expect(journalIdempotencyKey(snap)).toBe("invoice:inv1:issue");

    const voidSnap: AccountingOutboxSnapshot = {
      schemaVersion: 1,
      eventKind: "invoice_void",
      economicEventDate: "2026-10-06",
      rebuildStrategy: "immutable_outbox_snapshot",
      sourceType: "invoice",
      sourceId: "inv1",
      amount: 1080,
      originalJournalEntryId: "je1",
    };
    expect(
      rebuildAccountingEventFromSnapshot({
        snapshot: voidSnap,
        originalJournalLines: inv.lines,
      }).ok,
    ).toBe(true);
    expect(
      rebuildAccountingEventFromSnapshot({ snapshot: voidSnap }).ok,
    ).toBe(false);

    expect(invoiceVoidEconomicDate("2026-10-06")).toBe("2026-10-06");

    const closed = decideOutboxProcess({
      status: "pending",
      attemptCount: 1,
      maxAttempts: 8,
      payload: snap,
      existingJournalId: null,
      periodStatus: "closed",
      flags: flagsOn,
    });
    expect(closed.action).toBe("review_required");
  });

  it("11–16. credit + tax review + void", () => {
    expect(classifyAtomicity("credit_memo_issue")).toBe("outbox_guaranteed");
    expect(classifyAtomicity("credit_void")).toBe("outbox_guaranteed");
    const plan = planAccountingIntegration({
      kind: "credit_memo_issue",
      sourceType: "credit_memo",
      sourceId: "cm1",
      entryDate: "2026-10-02",
      flags: flagsOn,
      reviewRequired: true,
    });
    expect(plan.action).toBe("review_required");
  });

  it("17–27. AP / PO / bill payment / expense", () => {
    expect(assessPurchaseOrderAccounting().posts).toBe(false);
    expect(classifyAtomicity("vendor_bill")).toBe("outbox_guaranteed");
    expect(vendorBillEconomicDate("2026-10-03")).toBe("2026-10-03");
    const bill = buildVendorBillJournal({
      billId: "b1",
      amount: 500,
      entryDate: "2026-10-03",
      mappings,
      inventoryPostingEnabled: false,
    });
    const snap: AccountingOutboxSnapshot = {
      schemaVersion: 1,
      eventKind: "vendor_bill",
      economicEventDate: "2026-10-03",
      rebuildStrategy: "immutable_outbox_snapshot",
      sourceType: "vendor_bill",
      sourceId: "b1",
      amount: 500,
      frozenLines: bill.lines,
    };
    expect(rebuildAccountingEventFromSnapshot({ snapshot: snap }).ok).toBe(true);
    expect(billPaymentEconomicDate("2026-10-04")).toBe("2026-10-04");
    expect(classifyAtomicity("bill_payment")).toBe("outbox_guaranteed");
    expect(classifyAtomicity("bill_payment_void")).toBe("outbox_guaranteed");

    const linked = buildDirectExpenseJournal({
      expenseId: "e1",
      amount: 40,
      entryDate: "2026-10-04",
      mappings,
      billId: "b1",
    });
    expect("skipped" in linked).toBe(true);
    expect(classifyAtomicity("direct_expense")).toBe("outbox_guaranteed");
  });

  it("28–40. deposits non-cash apply + ambiguous blocked", () => {
    expect(classifyAtomicity("customer_deposit")).toBe("outbox_guaranteed");
    expect(classifyAtomicity("deposit_apply")).toBe("outbox_guaranteed");
    expect(depositReceiptEconomicDate("2026-10-01")).toBe("2026-10-01");
    expect(depositApplyEconomicDate("2026-10-08")).toBe("2026-10-08");
    const apply = buildDepositApplyJournal({
      applicationId: "da1",
      amount: 200,
      entryDate: "2026-10-08",
      invoiceId: "inv1",
      mappings,
    });
    expect(assessJournalBalance(apply.lines).ok).toBe(true);
    // No cash account in deposit apply
    expect(apply.lines.every((l) => l.accountId !== "cash")).toBe(true);
    expect(
      assessFamilyPilotReadiness({
        ...readyFamily,
        ambiguousCount: 2,
      }).result,
    ).toBe("BLOCKED_REVIEW");
  });

  it("41–44. refund void guarantee", () => {
    expect(classifyAtomicity("refund_void")).toBe("outbox_guaranteed");
    const lines = [
      { accountId: "liab", debit: 50, credit: 0 },
      { accountId: "cash", debit: 0, credit: 50 },
    ];
    const snap: AccountingOutboxSnapshot = {
      schemaVersion: 1,
      eventKind: "refund_void",
      economicEventDate: "2026-10-09",
      rebuildStrategy: "immutable_outbox_snapshot",
      sourceType: "refund",
      sourceId: "r1",
      amount: 50,
      originalJournalEntryId: "je-r",
    };
    expect(
      rebuildAccountingEventFromSnapshot({
        snapshot: snap,
        originalJournalLines: lines,
      }).ok,
    ).toBe(true);
    expect(rebuildAccountingEventFromSnapshot({ snapshot: snap }).ok).toBe(
      false,
    );
  });

  it("45–51. reconciliation completion hard guard", () => {
    expect(
      assessReconciliationCompleteGuard({
        status: "open",
        difference: 0,
        accountEligible: true,
        clearedLinesMatchAccount: true,
        allClearedPosted: true,
        actorIsStaff: true,
      }).ok,
    ).toBe(true);
    expect(
      assessReconciliationCompleteGuard({
        status: "open",
        difference: 1.25,
        accountEligible: true,
        clearedLinesMatchAccount: true,
        allClearedPosted: true,
        actorIsStaff: true,
      }).ok,
    ).toBe(false);
    expect(
      assessReconciliationCompleteGuard({
        status: "open",
        difference: 0,
        accountEligible: true,
        clearedLinesMatchAccount: false,
        allClearedPosted: true,
        actorIsStaff: true,
      }).ok,
    ).toBe(false);
    expect(
      assessReconciliationCompleteGuard({
        status: "completed",
        difference: 0,
        accountEligible: true,
        clearedLinesMatchAccount: true,
        allClearedPosted: true,
        actorIsStaff: true,
      }).ok,
    ).toBe(false);
    expect(
      assessReconciliationCompleteGuard({
        status: "open",
        difference: 0,
        accountEligible: true,
        clearedLinesMatchAccount: true,
        allClearedPosted: true,
        actorIsStaff: false,
      }).ok,
    ).toBe(false);
  });

  it("52–60. outbox + disabled posting + cutover", () => {
    expect(
      assessEnqueueEconomicDate({
        postingEnabled: false,
        eventPilotEnabled: true,
        economicEventDate: null,
        processingDate: "2026-10-15",
      }).action,
    ).toBe("skip_no_outbox");

    const legacy = decideOutboxProcess({
      status: "pending",
      attemptCount: 1,
      maxAttempts: 8,
      payload: {
        schemaVersion: 1,
        eventKind: "invoice_issue",
        economicEventDate: "2026-09-30",
        rebuildStrategy: "immutable_outbox_snapshot",
        sourceType: "invoice",
        sourceId: "x",
        amount: 1,
        frozenLines: [
          { accountId: "ar", debit: 1 },
          { accountId: "rev", credit: 1 },
        ],
      },
      existingJournalId: null,
      periodStatus: "open",
      flags: flagsOn,
      now: new Date("2026-10-20T00:00:00Z"),
    });
    expect(legacy.action).toBe("skip_legacy");

    const crash = decideOutboxProcess({
      status: "processing",
      attemptCount: 2,
      maxAttempts: 8,
      payload: {
        schemaVersion: 1,
        eventKind: "vendor_bill",
        economicEventDate: "2026-10-02",
        rebuildStrategy: "immutable_outbox_snapshot",
        sourceType: "vendor_bill",
        sourceId: "b",
        amount: 10,
        frozenLines: [
          { accountId: "exp", debit: 10 },
          { accountId: "ap", credit: 10 },
        ],
      },
      existingJournalId: "je-exists",
      periodStatus: "open",
      flags: flagsOn,
    });
    expect(crash.action).toBe("already_posted");
  });

  it("61–65. migration security markers present", () => {
    for (const f of [
      "0165_f5_invoice_credit_refund_void.sql",
      "0166_f5_ap_expense_bill_payment.sql",
      "0167_f5_deposits_recon.sql",
    ]) {
      const sql = readFileSync(
        join(process.cwd(), "supabase/migrations", f),
        "utf8",
      );
      expect(sql).toContain("set search_path = public");
      expect(sql).toContain(
        "revoke all on function public.enqueue_accounting_outbox_safe from authenticated",
      );
    }
  });

  it("pilot readiness board + sequence", () => {
    const board = assessAccountingPilotReadiness({
      payments: readyFamily,
      invoices: readyFamily,
      credits: { ...readyFamily, reviewRequiredCount: 1 },
      ap: readyFamily,
      expenses: readyFamily,
      deposits: { ...readyFamily, ambiguousCount: 1 },
      inventory: {
        ...readyFamily,
        sourceOutboxGuaranteed: false,
        lifecycleComplete: false,
      },
      installer: {
        ...readyFamily,
        sourceOutboxGuaranteed: false,
        extraBlockers: ["installer_posting_enabled stays false"],
      },
      openingBalancesEntered: false,
      cutoverDateSet: false,
      backupPitrConfirmedByOwner: false,
      accountantValidated: false,
      booksOfRecord: false,
    });
    expect(board.booksOfRecordReady).toBe(false);
    expect(board.families.PAYMENTS.result).toBe("READY_FOR_PILOT");
    expect(board.families.CREDITS.result).toBe("BLOCKED_REVIEW");
    expect(board.families.DEPOSITS.result).toBe("BLOCKED_REVIEW");
    expect(board.families.INVENTORY.result).toBe("NOT_READY");
    expect(board.globalBlockers.length).toBeGreaterThan(0);

    expect(
      recommendedPilotSequence({
        PAYMENTS: "READY_FOR_PILOT",
        CREDITS: "BLOCKED_REVIEW",
        INVOICES: "READY_FOR_PILOT",
        EXPENSES: "READY_FOR_PILOT",
        AP: "READY_FOR_PILOT",
        DEPOSITS: "NOT_READY",
        INSTALLER: "NOT_READY",
        INVENTORY: "NOT_READY",
      }),
    ).toEqual(["PAYMENTS", "INVOICES", "EXPENSES", "AP"]);
  });

  it("66–80. regressions", () => {
    expect(assessPaymentAmount({ amount: 1, remainingBalance: 0 }).ok).toBe(
      false,
    );
    expect(assessRefundAmount({ amount: 5, availableCredit: 5 }).ok).toBe(true);
    expect(assessJournalBalance(buildReversalLines([
      { accountId: "a", debit: 10, credit: 0 },
      { accountId: "b", debit: 0, credit: 10 },
    ])).ok).toBe(true);
  });

  it("81–90. invoice issue bypass eliminated (policy + SQL + app paths)", () => {
    expect(invoiceAccountingPilotActive({
      posting_enabled: false,
      invoice_posting_enabled: true,
    })).toBe(false);
    expect(
      invoiceIssueBypassBlocked({
        pilotActive: false,
        allowSessionFlag: false,
        op: "INSERT",
        newStatus: "paid",
      }).blocked,
    ).toBe(false);

    expect(
      invoiceIssueBypassBlocked({
        pilotActive: true,
        allowSessionFlag: false,
        op: "INSERT",
        newStatus: "sent",
      }).blocked,
    ).toBe(true);
    expect(
      invoiceIssueBypassBlocked({
        pilotActive: true,
        allowSessionFlag: false,
        op: "UPDATE",
        oldStatus: "draft",
        newStatus: "paid",
      }).blocked,
    ).toBe(true);
    expect(
      invoiceIssueBypassBlocked({
        pilotActive: true,
        allowSessionFlag: true,
        op: "UPDATE",
        oldStatus: "draft",
        newStatus: "sent",
      }).blocked,
    ).toBe(false);
    expect(
      invoiceIssueBypassBlocked({
        pilotActive: true,
        allowSessionFlag: false,
        op: "UPDATE",
        oldStatus: "sent",
        newStatus: "paid",
      }).blocked,
    ).toBe(false);

    const sql165 = readFileSync(
      join(process.cwd(), "supabase/migrations/0165_f5_invoice_credit_refund_void.sql"),
      "utf8",
    );
    expect(sql165).toContain("invoices_enforce_issue_via_finalize");
    expect(sql165).toContain("allow_invoice_issue_guard");
    expect(sql165).toContain("INVOICE_ISSUE_BYPASS");
    expect(sql165).toContain("perform public.allow_invoice_issue_guard()");
    expect(sql165).toContain("accounting_actor_id");

    for (const f of [
      "src/app/(app)/invoices/actions.ts",
      "src/app/(app)/counter-sale/actions.ts",
      "src/app/(app)/carry-over/actions.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src).toContain("finalizeInvoiceSafe");
    }
    const invActions = readFileSync(
      join(process.cwd(), "src/app/(app)/invoices/actions.ts"),
      "utf8",
    );
    expect(invActions).toContain("voidInvoiceSafe");
    expect(invActions).not.toMatch(
      /emailInvoice[\s\S]{0,400}update\(\{\s*status:\s*"sent"/,
    );
  });

  it("91–100. actor spoofing + concurrency SQL markers", () => {
    expect(
      resolveAccountingActor({
        authUid: "real-user",
        claimed: "spoofed-user",
        jwtRole: "authenticated",
      }),
    ).toBe("real-user");
    expect(
      resolveAccountingActor({
        authUid: null,
        claimed: "service-actor",
        jwtRole: "service_role",
      }),
    ).toBe("service-actor");
    expect(
      resolveAccountingActor({
        authUid: null,
        claimed: "spoofed",
        jwtRole: "anon",
      }),
    ).toBeNull();
    expect(nullUidIsTrusted()).toBe(false);

    const sql166 = readFileSync(
      join(process.cwd(), "supabase/migrations/0166_f5_ap_expense_bill_payment.sql"),
      "utf8",
    );
    const sql167 = readFileSync(
      join(process.cwd(), "supabase/migrations/0167_f5_deposits_recon.sql"),
      "utf8",
    );
    expect(sql166).toContain("accounting_actor_id");
    expect(sql166).toContain("'actorId', v_actor");
    expect(sql166).not.toContain("'actorId', p_actor");
    expect(sql167).toContain("Invoice has no open balance");
    expect(sql167).toContain("'voidedBy', v_actor");
    expect(sql167).toContain("complete_bank_reconciliation_safe");
    expect(sql167).toContain("accounting_require_roles");
    expect(sql167).toContain("ARRAY['admin','office']");
    expect(sql167).toContain("for update");
    expect(sql166).toContain("expenses_idempotency_key_uidx");
    expect(sql166).toContain("Do NOT invent default_expense");
    expect(sql166).toContain("p_cash_account_id must be an active cash");

    // Same-TX markers for promoted events
    for (const marker of [
      "enqueue_accounting_outbox_safe",
      "invoice_issue",
      "invoice_void",
      "credit_memo_issue",
      "credit_void",
      "refund_void",
    ]) {
      expect(
        readFileSync(
          join(
            process.cwd(),
            "supabase/migrations/0165_f5_invoice_credit_refund_void.sql",
          ),
          "utf8",
        ),
      ).toContain(marker);
    }
    for (const marker of [
      "vendor_bill",
      "bill_payment",
      "bill_payment_void",
      "direct_expense",
    ]) {
      expect(sql166).toContain(marker);
    }
    for (const marker of [
      "customer_deposit",
      "deposit_apply",
      "customer_deposit_void",
    ]) {
      expect(sql167).toContain(marker);
    }
  });

  it("helpers: ensureInvoiceIssued only finalizes draft→issued", async () => {
    const calls: string[] = [];
    const fake = {
      rpc: async (fn: string) => {
        calls.push(fn);
        return { data: { ok: true }, error: null };
      },
      from: () => ({
        update: () => ({
          eq: async () => ({ error: null }),
        }),
        select: () => ({
          eq: async () => ({ data: [] }),
        }),
      }),
    };
    await ensureInvoiceIssued(fake, {
      invoiceId: "i1",
      currentStatus: "draft",
      targetStatus: "sent",
      actorId: "u1",
    });
    expect(calls).toContain("finalize_invoice_safe");
    calls.length = 0;
    await ensureInvoiceIssued(fake, {
      invoiceId: "i1",
      currentStatus: "sent",
      targetStatus: "paid",
      actorId: "u1",
    });
    expect(calls).toHaveLength(0);
    await finalizeInvoiceSafe(fake, "i1", "u1");
    await voidInvoiceSafe(fake, "i1", "u1");
    expect(calls).toContain("finalize_invoice_safe");
    expect(calls).toContain("void_invoice_safe");
  });

  it("101–120. SECURITY DEFINER role matrix + unauthorized roles denied", () => {
    const rpcs: F5FinancialRpc[] = [
      "finalize_invoice_safe",
      "void_invoice_safe",
      "issue_credit_memo_safe",
      "void_credit_memo_safe",
      "void_refund_safe",
      "post_vendor_bill_safe",
      "record_bill_payment_safe",
      "void_bill_payment_safe",
      "record_direct_expense_safe",
      "record_customer_deposit_safe",
      "apply_customer_deposit_safe",
      "void_customer_deposit_safe",
      "complete_bank_reconciliation_safe",
    ];
    const anon = classifyRequestIdentity({ jwtRole: "anon", authUid: null });
    const unknownNull = classifyRequestIdentity({ jwtRole: "", authUid: null });
    const service = classifyRequestIdentity({
      jwtRole: "service_role",
      authUid: null,
    });
    expect(anon.kind).toBe("anon");
    expect(unknownNull.kind).toBe("unknown");
    expect(service.kind).toBe("service_role");
    expect(isExplicitServiceRole("service_role")).toBe(true);
    expect(isExplicitServiceRole("anon")).toBe(false);

    for (const rpc of rpcs) {
      expect(mayInvokeF5Rpc({ rpc, identity: service }).allowed).toBe(true);
      expect(
        mayInvokeF5Rpc({
          rpc,
          identity: { kind: "authenticated", appRole: "admin" },
        }).allowed,
      ).toBe(true);
      expect(
        mayInvokeF5Rpc({
          rpc,
          identity: { kind: "authenticated", appRole: "office" },
        }).allowed,
      ).toBe(true);
      expect(
        mayInvokeF5Rpc({
          rpc,
          identity: { kind: "authenticated", appRole: "crew" },
        }).allowed,
      ).toBe(false);
      expect(
        mayInvokeF5Rpc({
          rpc,
          identity: { kind: "authenticated", appRole: "customer" },
        }).allowed,
      ).toBe(false);
      expect(mayInvokeF5Rpc({ rpc, identity: anon }).allowed).toBe(false);
      expect(mayInvokeF5Rpc({ rpc, identity: unknownNull }).allowed).toBe(false);
    }
    expect(
      mayInvokeF5Rpc({
        rpc: "finalize_invoice_safe",
        identity: { kind: "authenticated", appRole: "salesman" },
      }).allowed,
    ).toBe(true);
    expect(
      mayInvokeF5Rpc({
        rpc: "issue_credit_memo_safe",
        identity: { kind: "authenticated", appRole: "salesman" },
      }).allowed,
    ).toBe(false);
    expect(
      mayInvokeF5Rpc({
        rpc: "complete_bank_reconciliation_safe",
        identity: { kind: "authenticated", appRole: "sales_manager" },
      }).allowed,
    ).toBe(false);
    expect(rolesAllowedForF5Rpc("complete_bank_reconciliation_safe")).toEqual([
      "admin",
      "office",
    ]);
    expect(isStaffEquivalentToAdminOffice()).toBe(true);

    expect(
      mayDirectExecuteInternalRpc({
        rpc: "allow_invoice_issue_guard",
        identity: anon,
      }).allowed,
    ).toBe(false);
    expect(
      mayDirectExecuteInternalRpc({
        rpc: "enqueue_accounting_outbox_safe",
        identity: { kind: "authenticated", appRole: "admin" },
      }).allowed,
    ).toBe(false);
    expect(
      mayDirectExecuteInternalRpc({
        rpc: "enqueue_accounting_outbox_safe",
        identity: service,
      }).allowed,
    ).toBe(true);
    expect(expectedExecuteGrantAfter0168("allow_invoice_issue_guard")).toBe(
      "service_role_only",
    );
    expect(expectedExecuteGrantAfter0168("finalize_invoice_safe")).toBe(
      "authenticated+service_role",
    );

    const actorAnon = resolveAccountingActorId({
      identity: anon,
      claimed: "spoof",
    });
    expect(actorAnon.ok).toBe(false);
    const actorAuth = resolveAccountingActorId({
      identity: { kind: "authenticated", appRole: "office" },
      claimed: "spoof",
    });
    expect(actorAuth.ok).toBe(true);

    const sql168 = readFileSync(
      join(process.cwd(), "supabase/migrations/0168_f5_anon_rpc_security.sql"),
      "utf8",
    );
    expect(sql168).toContain("accounting_is_service_role");
    expect(sql168).toContain("from anon");
    expect(sql168).toContain("Untrusted request identity");
    expect(sql168).not.toMatch(
      /if auth\.uid\(\) is null then\s+return;/,
    );

    const sqlAll = ["0165", "0166", "0167"].map((n) =>
      readFileSync(
        join(
          process.cwd(),
          `supabase/migrations/${n}_f5_${
            n === "0165"
              ? "invoice_credit_refund_void"
              : n === "0166"
                ? "ap_expense_bill_payment"
                : "deposits_recon"
          }.sql`,
        ),
        "utf8",
      ),
    );
    for (const sql of sqlAll) {
      expect(sql).toContain("accounting_require_roles");
    }
    expect(sqlAll[0]).toContain("finalize invoices");
    expect(sqlAll[1]).toContain("post vendor bills");
    expect(sqlAll[2]).toContain("complete bank reconciliation");
    expect(sql168).toContain("allow_invoice_issue_guard");
    expect(sql168).toContain("enqueue_accounting_outbox_safe");
  });

  it("121–130. economic date fail-closed when pilot ON; ops default when OFF", () => {
    const off = resolveSourceBusinessDate({
      provided: null,
      familyPilotActive: false,
      todayIso: "2026-08-31",
    });
    expect(off.ok && off.inventedToday).toBe(true);
    expect(off.ok && off.date).toBe("2026-08-31");

    const onMissing = resolveSourceBusinessDate({
      provided: null,
      familyPilotActive: true,
      todayIso: "2026-08-31",
    });
    expect(onMissing.ok).toBe(false);

    const onExplicit = resolveSourceBusinessDate({
      provided: "2026-10-05",
      familyPilotActive: true,
      todayIso: "2026-08-31",
    });
    expect(onExplicit.ok && onExplicit.date).toBe("2026-10-05");
    expect(onExplicit.ok && onExplicit.inventedToday).toBe(false);

    // Void uses authorization day intentionally
    expect(invoiceVoidEconomicDate("2026-11-01")).toBe("2026-11-01");
    expect(economicDatePolicySummary("invoice_void")).toContain("void_authorization");

    const sql165 = readFileSync(
      join(process.cwd(), "supabase/migrations/0165_f5_invoice_credit_refund_void.sql"),
      "utf8",
    );
    expect(sql165).toContain("accounting_resolve_business_date");
    expect(sql165).toContain(
      "invoice.issue_date is required when invoice posting is enabled",
    );
  });

  it("131–140. expense idempotency + review_required cannot auto-post + cash override", () => {
    const sql166 = readFileSync(
      join(process.cwd(), "supabase/migrations/0166_f5_ap_expense_bill_payment.sql"),
      "utf8",
    );
    expect(sql166).toContain("add column if not exists idempotency_key");
    expect(sql166).toContain("expenses_idempotency_key_uidx");
    expect(sql166).toContain("when unique_violation then");
    expect(sql166).toContain("'duplicate', true");
    expect(sql166).toContain("accounting_is_eligible_cash_account");
    expect(isEligibleCashAccountSubtype("cash")).toBe(true);
    expect(isEligibleCashAccountSubtype("expense")).toBe(false);

    // Processor never posts review_required outbox rows
    const blocked = decideOutboxProcess({
      status: "review_required",
      attemptCount: 1,
      maxAttempts: 8,
      payload: {
        schemaVersion: 1,
        eventKind: "direct_expense",
        economicEventDate: "2026-10-05",
        rebuildStrategy: "immutable_outbox_snapshot",
        sourceType: "expense",
        sourceId: "e1",
        amount: 10,
        frozenLines: [
          { accountId: "exp", debit: 10, credit: 0 },
          { accountId: "cash", debit: 0, credit: 10 },
        ],
      },
      existingJournalId: null,
      periodStatus: "open",
      flags: flagsOn,
    });
    expect(blocked.action).toBe("review_required");

    const sql165 = readFileSync(
      join(process.cwd(), "supabase/migrations/0165_f5_invoice_credit_refund_void.sql"),
      "utf8",
    );
    expect(sql165).toContain(
      "Tax-basis invoice must belong to the same customer as the credit memo",
    );
  });
});
