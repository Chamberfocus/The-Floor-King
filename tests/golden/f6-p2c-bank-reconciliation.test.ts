/**
 * F6-P2C — Bank reconciliation adversarial hardening (0173).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  heuristicDuplicateKey,
  importContentFingerprint,
  isEconomicBankImportLine,
  sourceRowFingerprint,
  stageBankImportRows,
  transactionContentKey,
} from "@/lib/accounting/bank-import";
import {
  assessCreateReconciliationIdempotency,
  assessFinalizedVoidTransition,
  assessIdempotencyContext,
  assessMatchAllocation,
  assessMatchDirection,
  assessPostVoidImmutability,
  computeReconciliationPackage,
  effectiveAllocatedByJournal,
  isBankReconSuccessfullyFinalized,
  isBankReconTerminal,
  isEffectiveActiveMatch,
  isEligibleBankReconAccount,
  journalBankImpact,
  mapCsvRowsToImportPayload,
  suggestBankMatches,
} from "@/lib/accounting/bank-reconciliation";
import { assessCompleteReconciliation } from "@/lib/accounting/reconciliation";
import { FINANCIAL_AUDIT_ACTION_LABELS } from "@/lib/accounting/audit-log";
import {
  classifyRequestIdentity,
  expectedExecuteGrantAfter0173,
  mayInvokeF6P2CRpc,
  mayInvokeF6P2CInternalRpc,
  mayInvokeF6P2BInternalRpc,
  mayInvokeLegacyMoneyRpc,
  resolveAccountingActorId,
} from "@/lib/accounting/f5-rpc-auth";
import { POSTING_DISABLED_MESSAGE } from "@/lib/accounting/types";
import { assessAutoPostAllowed } from "@/lib/accounting/posting-policy";

const ROOT = join(process.cwd());
const sql173 = readFileSync(
  join(ROOT, "supabase/migrations/0173_f6_p2c_bank_reconciliation.sql"),
  "utf8",
);
const sql172 = readFileSync(
  join(ROOT, "supabase/migrations/0172_f6_p2b_opening_balance_wizard.sql"),
  "utf8",
);
const sql171 = readFileSync(
  join(ROOT, "supabase/migrations/0171_f6_p2a_audit_retrofit.sql"),
  "utf8",
);

describe("F6-P2C 0173 migration adversarial markers", () => {
  it("hardens math, confirm, fingerprints, concurrency, ACL", () => {
    expect(sql173).toContain("bank_recon_session_is_successfully_finalized");
    expect(sql173).toContain("statement_equation_difference");
    expect(sql173).toContain("book_vs_adjusted_difference");
    expect(sql173).toContain("unresolved_rejected");
    expect(sql173).toContain("occurrence_index");
    expect(sql173).toContain("p_confirm");
    expect(sql173).toContain("pg_advisory_xact_lock");
    expect(sql173).toContain("accounting_audit_from_definer_safe");
    expect(sql173).toContain("bank_import_line_excluded");
    expect(sql173).toContain("Idempotency key already used");
    expect(sql173).toContain("allocated_amount");
    expect(sql173).not.toMatch(/posting_enabled\s*=\s*true/i);
    expect(sql173).not.toMatch(/books_of_record\s*=\s*true/i);
    expect(sql173).not.toContain("post_journal_entry_safe");
  });

  it("void/cancelled do not block replacement; reconciled/completed do", () => {
    expect(sql173).toMatch(
      /bank_recon_session_is_successfully_finalized[\s\S]*reconciled[\s\S]*completed/,
    );
    expect(sql173).toContain("bank_recon_session_is_terminal");
  });
});

describe("F6-P2C fingerprints + import", () => {
  it("1. exact reimport is not economic bank activity", () => {
    expect(
      isEconomicBankImportLine({
        duplicateStatus: "exact_reimport",
        reviewStatus: "pending",
      }),
    ).toBe(false);
    expect(sql173).toContain("Exact reimport rows are not matchable");
  });

  it("2–3. rejected excluded from totals but unresolved blocks finalize", () => {
    expect(sql173).toContain("unresolved_rejected");
    expect(sql173).toContain("Exclude or correct rejected import rows");
    const staged = stageBankImportRows({
      accountId: "acct-1",
      fileName: "x.csv",
      rows: [
        { date: "2026-01-01", description: "Ok", amount: 10, sourceRef: "1" },
        { date: "", description: "Bad", amount: 10, sourceRef: "2" },
      ],
    });
    expect(staged.rejectedRowCount).toBe(1);
    expect(staged.stagedRowCount).toBe(1);
  });

  it("6–8 / 13–15. fingerprints ignore filename/order; identical txs keep occurrence", () => {
    const rows = [
      { date: "2026-01-02", description: "B", amount: 20, sourceRef: "b" },
      { date: "2026-01-01", description: "A", amount: 10, sourceRef: "a" },
    ];
    const reordered = [...rows].reverse();
    expect(importContentFingerprint({ accountId: "acct-1", rows })).toBe(
      importContentFingerprint({ accountId: "acct-1", rows: reordered }),
    );

    const twin = [
      { date: "2026-01-01", description: "Same", amount: 50, sourceRef: "" },
      { date: "2026-01-01", description: "Same", amount: 50, sourceRef: "" },
    ];
    const staged = stageBankImportRows({
      accountId: "acct-1",
      fileName: "a.csv",
      rows: twin,
    });
    expect(staged.lines[0]?.occurrenceIndex).toBe(1);
    expect(staged.lines[1]?.occurrenceIndex).toBe(2);
    expect(staged.lines[0]?.sourceRowFingerprint).not.toBe(
      staged.lines[1]?.sourceRowFingerprint,
    );
    expect(staged.possibleDuplicateCount).toBe(1);

    const fp = sourceRowFingerprint({
      accountId: "acct-1",
      occurrenceIndex: 1,
      row: twin[0]!,
    });
    const second = stageBankImportRows({
      accountId: "acct-1",
      fileName: "renamed.csv",
      rows: [twin[0]!],
      existingCanonicalFingerprints: new Map([[fp, 1]]),
    });
    expect(second.exactReimportCount).toBe(1);
    expect(second.lines[0]?.duplicateStatus).toBe("exact_reimport");
  });

  it("16. opposite direction is not a duplicate", () => {
    expect(
      heuristicDuplicateKey({
        date: "2026-01-01",
        description: "X",
        amount: 100,
      }),
    ).not.toBe(
      heuristicDuplicateKey({
        date: "2026-01-01",
        description: "X",
        amount: -100,
      }),
    );
  });

  it("content key excludes source_row_no", () => {
    const a = transactionContentKey({
      accountId: "a",
      date: "2026-01-01",
      amount: 10,
      description: "d",
      sourceRef: "r",
    });
    expect(a).not.toMatch(/\|1\|/);
    expect(a.startsWith("a|")).toBe(true);
  });
});

describe("F6-P2C partial match accounting", () => {
  const bank = {
    id: "b1",
    sourceRowNo: 1,
    transactionDate: "2026-01-15",
    description: "Deposit",
    amount: 1000,
    direction: "deposit" as const,
    duplicateStatus: "unmatched",
    reviewStatus: "pending",
    matchedAmount: 400,
  };
  const jl = {
    journalLineId: "j1",
    entryDate: "2026-01-15",
    debit: 1000,
    credit: 0,
    matchedAmount: 400,
  };

  it("4–7. remaining amounts use allocations not full journal", () => {
    const pkg = computeReconciliationPackage({
      openingBalance: 0,
      endingBalance: 1000,
      bankLines: [bank],
      journalLines: [jl],
      matches: [
        {
          id: "m1",
          importLineId: "b1",
          journalLineId: "j1",
          allocatedAmount: 400,
          status: "active",
        },
      ],
      glBalanceThroughEnd: 1000,
    });
    expect(pkg.matchedDebit).toBe(400);
    expect(pkg.remainingBankDeposits).toBe(600);
    expect(pkg.outstandingBookDebit).toBe(600);
    expect(pkg.canFinalize).toBe(false);
  });

  it("14–17. direction + overallocation + one-sided journal", () => {
    expect(
      assessMatchDirection({
        bankDirection: "deposit",
        journalDebit: 0,
        journalCredit: 500,
      }).ok,
    ).toBe(false);
    expect(
      journalBankImpact({ debit: 10, credit: 10 }).ok,
    ).toBe(false);
    expect(
      assessMatchAllocation({
        bankLineAmount: 100,
        bankAlreadyAllocated: 80,
        journalAvailable: 100,
        journalAlreadyAllocated: 0,
        proposed: 30,
      }).ok,
    ).toBe(false);
  });

  it("11–12. idempotency context safe", () => {
    expect(
      assessIdempotencyContext({
        existing: { session: "s1", import: "b1", journal: "j1", amount: 10 },
        expected: { session: "s1", import: "b1", journal: "j1", amount: 10 },
      }).ok,
    ).toBe(true);
    expect(
      assessIdempotencyContext({
        existing: { session: "s1", import: "b1", journal: "j1", amount: 10 },
        expected: { session: "s1", import: "b1", journal: "j2", amount: 10 },
      }).ok,
    ).toBe(false);
    expect(sql173).toContain("different match context");
  });
});

describe("F6-P2C reconciliation finalize gates", () => {
  it("23–25 / 28–31. balanced package + statement equation + remaining bank", () => {
    const pkg = computeReconciliationPackage({
      openingBalance: 1000,
      endingBalance: 1500,
      bankLines: [
        {
          id: "b1",
          sourceRowNo: 1,
          transactionDate: "2026-01-31",
          description: "Deposit",
          amount: 500,
          direction: "deposit",
          duplicateStatus: "unmatched",
          reviewStatus: "pending",
          matchedAmount: 500,
        },
      ],
      journalLines: [
        {
          journalLineId: "j1",
          entryDate: "2026-01-31",
          debit: 500,
          credit: 0,
          matchedAmount: 500,
        },
      ],
      matches: [
        {
          id: "m1",
          importLineId: "b1",
          journalLineId: "j1",
          allocatedAmount: 500,
          status: "active",
        },
      ],
      glBalanceThroughEnd: 1500,
    });
    expect(pkg.statementEquationDifference).toBe(0);
    expect(pkg.remainingBankDeposits).toBe(0);
    expect(pkg.bookVsAdjustedDifference).toBe(0);
    expect(pkg.canFinalize).toBe(true);
    expect(assessCompleteReconciliation(0).ok).toBe(true);
  });

  it("exact reimport does not inflate statement deposits", () => {
    const pkg = computeReconciliationPackage({
      openingBalance: 0,
      endingBalance: 100,
      bankLines: [
        {
          id: "econ",
          sourceRowNo: 1,
          transactionDate: "2026-01-01",
          description: "Dep",
          amount: 100,
          direction: "deposit",
          duplicateStatus: "unmatched",
          reviewStatus: "pending",
          matchedAmount: 0,
        },
        {
          id: "reimp",
          sourceRowNo: 2,
          transactionDate: "2026-01-01",
          description: "Dep",
          amount: 100,
          direction: "deposit",
          duplicateStatus: "exact_reimport",
          reviewStatus: "pending",
          matchedAmount: 0,
        },
      ],
      journalLines: [],
      matches: [],
      glBalanceThroughEnd: 0,
    });
    expect(pkg.bankDeposits).toBe(100);
  });

  it("SQL finalize requires confirm + statement equation + remaining bank", () => {
    expect(sql173).toContain("p_confirm = true");
    expect(sql173).toContain("statement_equation_difference");
    expect(sql173).toContain("remaining_bank_deposits");
    expect(sql173).toContain("remaining_bank_withdrawals");
  });
});

describe("F6-P2C status / void / overlap", () => {
  it("25–26. terminal vs successfully finalized", () => {
    expect(isBankReconSuccessfullyFinalized("reconciled")).toBe(true);
    expect(isBankReconSuccessfullyFinalized("void")).toBe(false);
    expect(isBankReconTerminal("void")).toBe(true);
    expect(isBankReconTerminal("cancelled")).toBe(true);
  });

  it("account eligibility rejects AR/revenue", () => {
    expect(
      isEligibleBankReconAccount({
        accountType: "asset",
        subtype: "receivable",
        isActive: true,
      }),
    ).toBe(false);
    expect(
      isEligibleBankReconAccount({
        accountType: "asset",
        subtype: "cash",
        isActive: true,
      }),
    ).toBe(true);
  });
});

describe("F6-P2C security regressions", () => {
  it("36–42. ACL + posting-off bypass blocked", () => {
    expect(
      mayInvokeF6P2CInternalRpc({
        rpc: "bank_reconciliation_compute_package",
        identity: classifyRequestIdentity({
          jwtRole: "authenticated",
          authUid: "a",
          appRole: "admin",
        }),
      }).allowed,
    ).toBe(false);
    expect(expectedExecuteGrantAfter0173("bank_reconciliation_compute_package")).toBe(
      "service_role_only",
    );
    expect(
      mayInvokeF6P2CRpc({
        rpc: "finalize_bank_reconciliation_safe",
        identity: classifyRequestIdentity({ jwtRole: "anon", authUid: null }),
      }).allowed,
    ).toBe(false);
    expect(
      resolveAccountingActorId({
        identity: classifyRequestIdentity({ jwtRole: "anon", authUid: null }),
        claimed: "spoof",
      }).ok,
    ).toBe(false);

    const settings = {
      posting_enabled: false,
      inventory_posting_enabled: false,
      cutover_date: null,
      books_of_record: false,
      default_cash_method: "undeposited" as const,
    };
    expect(
      assessAutoPostAllowed({
        settings,
        entryKind: "manual",
        sourceType: "manual",
        entryDate: "2026-01-01",
      }).ok,
    ).toBe(false);
    expect(POSTING_DISABLED_MESSAGE).toBeTruthy();
  });

  it("43–47. opening / 0171 / 0172 regressions", () => {
    expect(sql172).toContain("OPENING_BALANCE_TRUST_REQUIRED");
    expect(sql172).toContain("Accounting posting is disabled");
    expect(
      mayInvokeF6P2BInternalRpc({
        rpc: "post_opening_balance_journal_from_definer_safe",
        identity: classifyRequestIdentity({
          jwtRole: "authenticated",
          authUid: "a",
          appRole: "admin",
        }),
      }).allowed,
    ).toBe(false);
    expect(sql171).toContain("void_credit_application_safe");
    expect(
      mayInvokeLegacyMoneyRpc({
        rpc: "post_journal_entry_safe",
        identity: classifyRequestIdentity({
          jwtRole: "authenticated",
          authUid: "o",
          appRole: "office",
        }),
      }).allowed,
    ).toBe(false);
  });

  it("audit labels present", () => {
    expect(FINANCIAL_AUDIT_ACTION_LABELS.bank_import_line_excluded).toBeTruthy();
    expect(FINANCIAL_AUDIT_ACTION_LABELS.bank_reconciliation_cancelled).toBeTruthy();
    expect(FINANCIAL_AUDIT_ACTION_LABELS.bank_import_attached).toBeTruthy();
  });
});

describe("F6-P2C suggestions + CSV", () => {
  it("suggestions skip fully allocated and exact reimport", () => {
    const suggestions = suggestBankMatches({
      bankLines: [
        {
          id: "b1",
          sourceRowNo: 1,
          transactionDate: "2026-01-01",
          description: "Dep",
          amount: 50,
          direction: "deposit",
          duplicateStatus: "exact_reimport",
          reviewStatus: "pending",
          matchedAmount: 0,
        },
      ],
      journalLines: [
        {
          journalLineId: "j1",
          entryDate: "2026-01-01",
          debit: 50,
          credit: 0,
          matchedAmount: 0,
        },
      ],
      matches: [],
    });
    expect(suggestions).toHaveLength(0);
  });

  it("maps debit/credit columns", () => {
    const mapped = mapCsvRowsToImportPayload({
      headers: ["Date", "Description", "Debit", "Credit"],
      rows: [["2026-01-01", "Check", "0", "125.50"]],
      mapping: {
        date: "Date",
        description: "Description",
        debit: "Debit",
        credit: "Credit",
      },
    });
    expect(mapped.ok).toBe(true);
    if (mapped.ok) expect(mapped.rows[0]?.amount).toBe("-125.50");
  });
});

describe("F6-P2C deployment-blocker pass", () => {
  it("SQL markers: effective clearing, immutability, confirm wrapper", () => {
    expect(sql173).toContain("bank_recon_effective_journal_allocated");
    expect(sql173).toContain("bank_recon_match_parent_effective");
    expect(sql173).toContain("bank_recon_session_was_finalized");
    expect(sql173).toContain("prevent_protected_bank_recon_match_mutation");
    expect(sql173).toContain("bank_import_attached");
    expect(sql173).toContain("match_allocation_digest");
    expect(sql173).toContain("exact_reimport_of_line_id");
    expect(sql173).toContain("bank_import_fingerprint_line");
    expect(sql173).toContain("drop function if exists public.complete_bank_reconciliation_safe(uuid, uuid)");
    expect(sql173).toContain("complete_bank_reconciliation_safe(uuid, uuid, boolean)");
    expect(sql173).not.toMatch(
      /revoke all on function public\.complete_bank_reconciliation_safe\(uuid, uuid\)/i,
    );
    expect(sql173).not.toMatch(
      /revoke all on function public\.finalize_bank_reconciliation_safe\(uuid, uuid\)/i,
    );
    expect(sql173).toContain("new.prior_status is not distinct from old.status");
    expect(sql173).not.toContain(
      "new.prior_status is not distinct from old.prior_status",
    );
    expect(sql173).not.toContain("finalize_bank_reconciliation_safe(p_session_id, p_completed_by, true)");
    expect(sql173).toContain("Journal entry date cannot be after the statement end date");
    expect(sql173).toContain("Idempotency key already used with a different reconciliation context");
    expect(sql173).toContain("Cannot attach a cancelled import batch");
    expect(sql173).toContain("A reason is required to remove a match");
  });

  it("22.A prior fully cleared journal does not appear outstanding next month", () => {
    const pkg = computeReconciliationPackage({
      openingBalance: 0,
      endingBalance: 0,
      bankLines: [],
      journalLines: [
        {
          journalLineId: "j1",
          entryDate: "2026-01-15",
          debit: 0,
          credit: 500,
          matchedAmount: 500,
        },
      ],
      matches: [
        {
          id: "m-prior",
          importLineId: "b-prior",
          journalLineId: "j1",
          allocatedAmount: 500,
          status: "active",
          sessionId: "jan",
          sessionStatus: "reconciled",
        },
      ],
      glBalanceThroughEnd: -500,
      currentSessionId: "feb",
    });
    expect(pkg.outstandingBookCredit).toBe(0);
  });

  it("22.B prior partial clearing shows remaining only", () => {
    const remaining = effectiveAllocatedByJournal(
      [
        {
          id: "m1",
          importLineId: "b1",
          journalLineId: "j1",
          allocatedAmount: 400,
          status: "active",
          sessionId: "jan",
          sessionStatus: "reconciled",
        },
        {
          id: "m2",
          importLineId: "b2",
          journalLineId: "j1",
          allocatedAmount: 300,
          status: "active",
          sessionId: "feb",
          sessionStatus: "in_progress",
        },
      ],
      "j1",
      "feb",
    );
    expect(remaining).toBe(700);
    const pkg = computeReconciliationPackage({
      openingBalance: 0,
      endingBalance: 0,
      bankLines: [],
      journalLines: [
        {
          journalLineId: "j1",
          entryDate: "2026-01-15",
          debit: 1000,
          credit: 0,
          matchedAmount: 700,
        },
      ],
      matches: [
        {
          id: "m1",
          importLineId: "b1",
          journalLineId: "j1",
          allocatedAmount: 400,
          status: "active",
          sessionId: "jan",
          sessionStatus: "reconciled",
        },
        {
          id: "m2",
          importLineId: "b2",
          journalLineId: "j1",
          allocatedAmount: 300,
          status: "active",
          sessionId: "feb",
          sessionStatus: "in_progress",
        },
      ],
      glBalanceThroughEnd: 1000,
      currentSessionId: "feb",
    });
    expect(pkg.outstandingBookDebit).toBe(300);
  });

  it("22.D–E void/cancelled allocations do not reserve capacity", () => {
    expect(
      isEffectiveActiveMatch(
        {
          id: "m",
          importLineId: "b",
          journalLineId: "j",
          allocatedAmount: 100,
          status: "active",
          sessionId: "old",
          sessionStatus: "void",
        },
        "new",
      ),
    ).toBe(false);
    expect(
      isEffectiveActiveMatch(
        {
          id: "m",
          importLineId: "b",
          journalLineId: "j",
          allocatedAmount: 100,
          status: "active",
          sessionId: "old",
          sessionStatus: "cancelled",
        },
        "new",
      ),
    ).toBe(false);
  });

  it("22.H replacement after void can allocate again", () => {
    const pkg = computeReconciliationPackage({
      openingBalance: 0,
      endingBalance: 100,
      bankLines: [
        {
          id: "b1",
          sourceRowNo: 1,
          transactionDate: "2026-02-01",
          description: "Dep",
          amount: 100,
          direction: "deposit",
          duplicateStatus: "unmatched",
          reviewStatus: "pending",
          matchedAmount: 100,
        },
      ],
      journalLines: [
        {
          journalLineId: "j1",
          entryDate: "2026-02-01",
          debit: 100,
          credit: 0,
          matchedAmount: 100,
        },
      ],
      matches: [
        {
          id: "voided",
          importLineId: "b-old",
          journalLineId: "j1",
          allocatedAmount: 100,
          status: "active",
          sessionId: "voided-session",
          sessionStatus: "void",
        },
        {
          id: "replacement",
          importLineId: "b1",
          journalLineId: "j1",
          allocatedAmount: 100,
          status: "active",
          sessionId: "feb",
          sessionStatus: "in_progress",
        },
      ],
      glBalanceThroughEnd: 100,
      currentSessionId: "feb",
    });
    expect(pkg.outstandingBookDebit).toBe(0);
    expect(pkg.canFinalize).toBe(true);
  });

  it("24 create idempotency context", () => {
    const same = assessCreateReconciliationIdempotency({
      existing: {
        accountId: "a1",
        statementStart: "2026-01-01",
        statementEnd: "2026-01-31",
        openingBalance: 0,
        endingBalance: 100,
      },
      expected: {
        accountId: "a1",
        statementStart: "2026-01-01",
        statementEnd: "2026-01-31",
        openingBalance: 0,
        endingBalance: 100,
      },
    });
    expect(same.ok).toBe(true);
    const conflict = assessCreateReconciliationIdempotency({
      existing: {
        accountId: "a1",
        statementStart: "2026-01-01",
        statementEnd: "2026-01-31",
        openingBalance: 0,
        endingBalance: 100,
      },
      expected: {
        accountId: "a2",
        statementStart: "2026-01-01",
        statementEnd: "2026-01-31",
        openingBalance: 0,
        endingBalance: 100,
      },
    });
    expect(conflict.ok).toBe(false);
  });

  it("10 future journal blocked in suggestions", () => {
    const suggestions = suggestBankMatches({
      bankLines: [
        {
          id: "b1",
          sourceRowNo: 1,
          transactionDate: "2026-01-31",
          description: "Dep",
          amount: 50,
          direction: "deposit",
          duplicateStatus: "unmatched",
          reviewStatus: "pending",
          matchedAmount: 0,
        },
      ],
      journalLines: [
        {
          journalLineId: "future",
          entryDate: "2026-02-15",
          debit: 50,
          credit: 0,
          matchedAmount: 0,
        },
      ],
      matches: [],
      statementEnd: "2026-01-31",
    });
    expect(suggestions).toHaveLength(0);
  });

  it("14 non-object JSON fingerprint + rejected rows (TS mirror)", () => {
    const rows = [
      { date: "2026-01-01", description: "Ok", amount: 10, sourceRef: "1" },
      { date: "2026-01-02", description: "Frac", amount: 10.004, sourceRef: "2" },
    ];
    const staged = stageBankImportRows({
      accountId: "acct-1",
      fileName: "mix.csv",
      rows,
    });
    expect(staged.rejectedRowCount).toBe(1);
    expect(staged.stagedRowCount).toBe(1);
  });
});

describe("F6-P2C final two blockers", () => {
  const snapshot = { matches: [{ id: "m1" }], digest: "abc" };
  const baseOld = {
    status: "reconciled",
    accountId: "cash-1",
    statementStart: "2026-01-01",
    statementEnd: "2026-01-31",
    openingBalance: 100,
    endingBalance: 200,
    importBatchId: "batch-1",
    finalSnapshot: snapshot,
    calculatedEndingBalance: 200,
    difference: 0,
    idempotencyKey: "k1",
    createdBy: "u1",
    completedBy: "u2",
    completedAt: "2026-02-01T00:00:00Z",
    notes: "jan",
  };

  function voidNext(fromStatus: string) {
    return {
      status: "void",
      priorStatus: fromStatus,
      accountId: baseOld.accountId,
      statementStart: baseOld.statementStart,
      statementEnd: baseOld.statementEnd,
      openingBalance: baseOld.openingBalance,
      endingBalance: baseOld.endingBalance,
      importBatchId: baseOld.importBatchId,
      finalSnapshot: snapshot,
      calculatedEndingBalance: baseOld.calculatedEndingBalance,
      difference: baseOld.difference,
      idempotencyKey: baseOld.idempotencyKey,
      createdBy: baseOld.createdBy,
      completedBy: baseOld.completedBy,
      completedAt: baseOld.completedAt,
      notes: baseOld.notes,
      voidReason: "Correction before books of record",
      voidedBy: "admin-1",
      voidedAt: "2026-02-02T00:00:00Z",
    };
  }

  it("1–6. reconciled → void succeeds; prior_status and evidence preserved", () => {
    const next = voidNext("reconciled");
    const result = assessFinalizedVoidTransition({
      old: baseOld,
      next,
      booksOfRecord: false,
    });
    expect(result.ok).toBe(true);
    expect(next.priorStatus).toBe("reconciled");
    expect(next.finalSnapshot).toBe(snapshot);
    expect(next.completedAt).toBe(baseOld.completedAt);
    expect(next.completedBy).toBe(baseOld.completedBy);
    expect(next.accountId).toBe(baseOld.accountId);
    expect(next.importBatchId).toBe(baseOld.importBatchId);
    expect(sql173).toContain("prior_status = status");
    expect(sql173).toContain("new.prior_status is not distinct from old.status");
  });

  it("2. completed legacy status → void succeeds", () => {
    const result = assessFinalizedVoidTransition({
      old: { ...baseOld, status: "completed" },
      next: voidNext("completed"),
      booksOfRecord: false,
    });
    expect(result.ok).toBe(true);
  });

  it("7–9. post-void mutation of void_reason / prior_status / snapshot blocked", () => {
    expect(
      assessPostVoidImmutability({ field: "void_reason", attemptedChange: true }).ok,
    ).toBe(false);
    expect(
      assessPostVoidImmutability({ field: "prior_status", attemptedChange: true }).ok,
    ).toBe(false);
    expect(
      assessPostVoidImmutability({ field: "final_snapshot", attemptedChange: true }).ok,
    ).toBe(false);
  });

  it("10. books_of_record=true blocks finalized void", () => {
    const result = assessFinalizedVoidTransition({
      old: baseOld,
      next: voidNext("reconciled"),
      booksOfRecord: true,
    });
    expect(result.ok).toBe(false);
    expect(sql173).toContain("Cannot void reconciliations after books_of_record");
  });

  it("wrong prior_status is rejected (old trigger contradiction)", () => {
    const next = voidNext("reconciled");
    next.priorStatus = "draft";
    const result = assessFinalizedVoidTransition({
      old: baseOld,
      next,
      booksOfRecord: false,
    });
    expect(result.ok).toBe(false);
  });

  it("11–18. ACL/overload executability markers", () => {
    expect(sql173).toContain(
      "drop function if exists public.finalize_bank_reconciliation_safe(uuid, uuid)",
    );
    expect(sql173).toContain(
      "drop function if exists public.complete_bank_reconciliation_safe(uuid, uuid)",
    );
    expect(sql173).toContain(
      "create or replace function public.finalize_bank_reconciliation_safe(\n  p_session_id uuid,\n  p_actor uuid default null,\n  p_confirm boolean default false",
    );
    expect(sql173).toContain(
      "create or replace function public.complete_bank_reconciliation_safe(\n  p_session_id uuid,\n  p_completed_by uuid default null,\n  p_confirm boolean default false",
    );
    expect(sql173).not.toMatch(
      /revoke all on function public\.complete_bank_reconciliation_safe\(uuid, uuid\)/i,
    );
    expect(sql173).not.toMatch(
      /grant execute on function public\.complete_bank_reconciliation_safe\(uuid, uuid\)/i,
    );
    expect(sql173).not.toMatch(
      /revoke all on function public\.finalize_bank_reconciliation_safe\(uuid, uuid\)/i,
    );
    expect(sql173).toContain("p_confirm = true");
    expect(sql173).toContain(
      "return public.finalize_bank_reconciliation_safe(p_session_id, p_completed_by, p_confirm)",
    );
    expect(sql173).not.toContain(
      "return public.finalize_bank_reconciliation_safe(p_session_id, p_completed_by, true)",
    );
  });
});
