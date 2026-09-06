/**
 * F6-P1 — Accounting books-readiness completion golden tests.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decomposeInvoiceTax,
  validateInvoiceTaxJournalParity,
} from "@/lib/accounting/tax-decomposition";
import { buildSalesTaxLiabilityReport } from "@/lib/accounting/sales-tax-report";
import {
  parseBankStatementCsv,
  stageBankImportRows,
  sourceRowFingerprint,
  importContentFingerprint,
} from "@/lib/accounting/bank-import";
import {
  assessPitrAttestation,
  pitrAttestationAuditPayload,
} from "@/lib/accounting/pitr-attestation";
import { previewOpeningBalances } from "@/lib/accounting/opening-balance-readiness";
import { assessMappingReadiness } from "@/lib/accounting/mapping-readiness";
import {
  installerLaborIncurredForJob,
  INSTALLER_LABOR_SOURCE,
} from "@/lib/accounting/installer-labor-source";
import {
  assessWriteOffAmount,
  assessWriteOffMappingPrecheck,
  invoiceArRemainingAfterWriteOffs,
} from "@/lib/accounting/write-off";
import { buildInvoiceWriteOffJournal } from "@/lib/accounting/builders";
import {
  buildTrialBalance,
  buildAccountingPnL,
  buildBalanceSheet,
  buildGeneralLedger,
  buildArAging,
  buildApAging,
} from "@/lib/accounting/reports";
import { buildCutoverReadinessReport } from "@/lib/accounting/cutover-report";
import { computeReconciliation, assessCompleteReconciliation } from "@/lib/accounting/reconciliation";
import { resolveBillDebitAccount } from "@/lib/accounting/ap-category";
import { AUDIT_ARCHITECTURE_NOTE } from "@/lib/accounting/audit-log";
import {
  classifyRequestIdentity,
  mayInvokeF6P1Rpc,
  mayInvokeF6P1InternalRpc,
} from "@/lib/accounting/f5-rpc-auth";
import { POSTING_DISABLED_MESSAGE } from "@/lib/accounting/types";

const ROOT = join(process.cwd());
const sql170 = readFileSync(
  join(ROOT, "supabase/migrations/0170_f6_p1_books_readiness.sql"),
  "utf8",
);

const SAMPLE_MAPPINGS = {
  accounts_receivable: "ar-1",
  default_sales_revenue: "rev-1",
  sales_tax_payable: "tax-1",
  bad_debt_expense: "bd-1",
  opening_balance_equity: "obe-1",
  cash_operating: "cash-1",
  undeposited_funds: "uf-1",
  accounts_payable: "ap-1",
  customer_deposits: "dep-1",
  customer_credit_liability: "ccl-1",
  material_cogs: "mcogs-1",
  installer_labor_cogs: "ilcogs-1",
  default_expense: "exp-1",
};

describe("F6-P1 migration 0170 markers", () => {
  it("includes write-off, audit log, bank import staging", () => {
    expect(sql170).toContain("write_off_invoice_safe");
    expect(sql170).toContain("financial_audit_log");
    expect(sql170).toContain("stage_bank_statement_import_safe");
    expect(sql170).toContain("bad_debt_expense");
    expect(sql170).toContain("invoice_applied_write_offs");
    expect(sql170).toContain("confirm_backup_pitr_safe");
  });

  it("write-off uses post-lock idempotency pattern", () => {
    expect(sql170).toContain("IDEMPOTENCY_CROSS_INVOICE");
    expect(sql170).toMatch(/for update[\s\S]*Post-lock idempotency recheck/i);
  });

  it("hardens bank staging table mutation", () => {
    expect(sql170).toContain(
      "revoke insert, update, delete on public.bank_statement_import_batches from authenticated",
    );
    expect(sql170).toContain(
      "revoke insert, update, delete on public.bank_statement_import_lines from authenticated",
    );
    expect(sql170).toContain("bank_import_batches_staff_select");
    expect(sql170).not.toMatch(
      /create policy bank_import_batches_staff on[\s\S]*for all/i,
    );
  });

  it("audit log is technically append-only", () => {
    expect(sql170).toContain("financial_audit_log_immutable");
    expect(sql170).toContain(
      "revoke insert, update, delete on public.financial_audit_log from authenticated",
    );
    expect(sql170).toContain("log_financial_audit_safe is internal-only");
  });

  it("write-off blocks missing mappings before insert", () => {
    expect(sql170).toContain("MISSING_ACCOUNT_MAPPING");
    expect(sql170).toMatch(
      /select account_id into v_bad_debt[\s\S]*insert into public\.invoice_write_offs/,
    );
  });

  it("canonical source fingerprint uniqueness excludes exact_reimport rows", () => {
    expect(sql170).toContain("exact_reimport_of_line_id");
    expect(sql170).toContain("canonical_source_row_fingerprint");
    expect(sql170).toMatch(
      /duplicate_status in \('unmatched', 'possible_duplicate'\)/,
    );
    expect(sql170).toMatch(
      /exact_reimport[\s\S]*canonical_source_row_fingerprint[\s\S]*exact_reimport_of_line_id/,
    );
  });

  it("import_fingerprint is content-derived", () => {
    expect(sql170).toContain("jsonb_array_elements(p_rows) with ordinality");
    expect(sql170).toMatch(/v_import_fp := md5\(p_account_id::text \|\| '\|' \|\| v_norm_content\)/);
  });
});

describe("P1-1 tax decomposition", () => {
  const items = [
    { quantity: 1, rate: 800 },
    { quantity: 1, rate: 400 },
    { quantity: 1, rate: -100 },
  ];

  it("decomposes materials + labor + discount before tax", () => {
    const d = decomposeInvoiceTax({ items, taxRatePct: 8 });
    expect(d.grossLineTotal).toBe(1200);
    expect(d.discountAmount).toBe(100);
    expect(d.netTaxableSubtotal).toBe(1100);
    expect(d.tax).toBe(88);
    expect(d.total).toBe(1188);
  });

  it("journal debits = credits and total parity", () => {
    const r = validateInvoiceTaxJournalParity({
      invoiceId: "inv-1",
      entryDate: "2026-01-15",
      items,
      taxRatePct: 8,
      mappings: SAMPLE_MAPPINGS,
    });
    expect(r.totalParity).toBe(true);
    expect(r.journalBalanced).toBe(true);
    expect(r.decomposition.total).toBe(1188);
  });
});

describe("P1-2 sales tax report", () => {
  it("aggregates taxable sales and credit tax reductions", () => {
    const report = buildSalesTaxLiabilityReport({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      invoices: [
        {
          id: "i1",
          issue_date: "2026-01-10",
          tax_rate: 8,
          status: "sent",
          items: [
            { quantity: 1, rate: 1000 },
            { quantity: 1, rate: -100 },
          ],
        },
      ],
      credits: [
        {
          id: "c1",
          issued_at: "2026-01-20",
          amount: 54,
          pretax: 50,
          tax: 4,
        },
      ],
    });
    expect(report.netTaxableSales).toBe(900);
    expect(report.taxCollected).toBe(72);
    expect(report.creditTaxReduction).toBe(4);
    expect(report.netTaxLiability).toBe(68);
  });
});

describe("P1-3 bank reconciliation", () => {
  it("requires zero difference to complete", () => {
    const gate = assessCompleteReconciliation(0.004);
    expect(gate.ok).toBe(true);
    expect(assessCompleteReconciliation(1).ok).toBe(false);
  });

  it("CSV staging keeps legitimate repeated transactions as unmatched", () => {
    const rows = [
      { date: "2026-01-01", description: "Deposit", amount: 100, sourceRef: "1" },
      { date: "2026-01-01", description: "Deposit", amount: 100, sourceRef: "2" },
    ];
    const staged = stageBankImportRows({
      accountId: "acct-1",
      fileName: "jan.csv",
      rows,
    });
    expect(staged.sourceRowCount).toBe(2);
    expect(staged.stagedRowCount).toBe(2);
    expect(staged.lines[0]?.duplicateStatus).toBe("unmatched");
    expect(staged.lines[1]?.duplicateStatus).toBe("possible_duplicate");
    expect(staged.possibleDuplicateCount).toBe(1);
    expect(staged.exactReimportCount).toBe(0);
  });

  it("opposite direction same date/amount/description is not duplicate (0173)", () => {
    const staged = stageBankImportRows({
      accountId: "acct-1",
      fileName: "jan.csv",
      rows: [
        { date: "2026-01-01", description: "Transfer", amount: 100, sourceRef: "1" },
        { date: "2026-01-01", description: "Transfer", amount: -100, sourceRef: "2" },
      ],
    });
    expect(staged.possibleDuplicateCount).toBe(0);
    expect(staged.stagedRowCount).toBe(2);
  });

  it("exact re-import retains row and references canonical", () => {
    const row = { date: "2026-01-01", description: "Deposit", amount: 50, sourceRef: "1" };
    const fp = sourceRowFingerprint({
      accountId: "acct-1",
      occurrenceIndex: 1,
      row,
    });
    const first = stageBankImportRows({
      accountId: "acct-1",
      fileName: "jan.csv",
      rows: [row],
    });
    const second = stageBankImportRows({
      accountId: "acct-1",
      fileName: "jan-v2.csv",
      rows: [row],
      existingCanonicalFingerprints: new Map([[fp, 1]]),
    });
    expect(first.exactReimportCount).toBe(0);
    expect(first.lines[0]?.sourceRowFingerprint).toBe(fp);
    expect(second.exactReimportCount).toBe(1);
    expect(second.lines[0]?.duplicateStatus).toBe("exact_reimport");
    expect(second.lines[0]?.sourceRowFingerprint).toBeNull();
    expect(second.lines[0]?.canonicalSourceRowFingerprint).toBe(fp);
    expect(second.lines[0]?.exactReimportOfSourceRowNo).toBe(1);
    expect(second.stagedRowCount).toBe(1);
  });

  it("first import succeeds as unmatched", () => {
    const row = { date: "2026-01-01", description: "Deposit", amount: 50, sourceRef: "1" };
    const staged = stageBankImportRows({
      accountId: "acct-1",
      fileName: "jan.csv",
      rows: [row],
    });
    expect(staged.stagedRowCount).toBe(1);
    expect(staged.lines[0]?.duplicateStatus).toBe("unmatched");
    expect(staged.lines[0]?.sourceRowFingerprint).toBeTruthy();
  });

  it("import content fingerprint is stable and account-scoped", () => {
    const rows = [
      { date: "2026-01-01", description: "Deposit", amount: 100, sourceRef: "1" },
      { date: "2026-01-02", description: "Withdrawal", amount: -25, sourceRef: "2" },
    ];
    const fp1 = importContentFingerprint({ accountId: "acct-1", rows });
    const fp2 = importContentFingerprint({ accountId: "acct-1", rows });
    const fpOtherAccount = importContentFingerprint({ accountId: "acct-2", rows });
    const fpChanged = importContentFingerprint({
      accountId: "acct-1",
      rows: [{ ...rows[0]!, amount: 101 }],
    });
    expect(fp1).toBe(fp2);
    expect(fpOtherAccount).not.toBe(fp1);
    expect(fpChanged).not.toBe(fp1);
    expect(
      stageBankImportRows({ accountId: "acct-1", fileName: "a.csv", rows }).importFingerprint,
    ).toBe(fp1);
    expect(
      stageBankImportRows({ accountId: "acct-1", fileName: "b.csv", rows }).importFingerprint,
    ).toBe(fp1);
  });

  it("tracks source/staged/rejected counts accurately", () => {
    const staged = stageBankImportRows({
      accountId: "acct-1",
      fileName: "bad.csv",
      rows: [
        { date: "2026-01-01", description: "Good", amount: 10, sourceRef: "1" },
        { date: "", description: "Bad date", amount: 10, sourceRef: "2" },
      ],
    });
    expect(staged.sourceRowCount).toBe(2);
    expect(staged.stagedRowCount).toBe(1);
    expect(staged.rejectedRowCount).toBe(1);
    expect(staged.rejected[0]?.reason).toContain("date");
  });

  it("parseBankStatementCsv assigns sourceRef line numbers", () => {
    const rows = parseBankStatementCsv(
      "date,description,amount\n2026-01-01,Deposit,100.00",
    );
    expect(rows[0]?.sourceRef).toBe("1");
  });

  it("computeReconciliation balances cleared lines", () => {
    const r = computeReconciliation({
      openingBalance: 1000,
      statementEndingBalance: 1100,
      lines: [
        {
          journalLineId: "jl1",
          accountId: "cash",
          entryDate: "2026-01-15",
          debit: 100,
          credit: 0,
          isCashAccount: true,
        },
      ],
      clearedLineIds: new Set(["jl1"]),
    });
    expect(r.calculatedEndingBalance).toBe(1100);
    expect(r.canComplete).toBe(true);
  });
});

describe("P1-4 opening balance infrastructure", () => {
  it("preview requires balanced debits/credits", () => {
    const preview = previewOpeningBalances({
      entryDate: "2026-01-01",
      mappings: SAMPLE_MAPPINGS,
      lines: [
        { accountId: "ar-1", debit: 5000 },
        { accountId: "ap-1", credit: 2000 },
      ],
    });
    expect(preview.balanced).toBe(true);
    expect(preview.ready).toBe(true);
    expect(preview.totalDebits).toBe(preview.totalCredits);
  });
});

describe("P1-5 audit log architecture", () => {
  it("documents dual-trail design", () => {
    expect(AUDIT_ARCHITECTURE_NOTE).toContain("financial_audit_log");
    expect(AUDIT_ARCHITECTURE_NOTE).toContain("outbox");
  });

  it("blocks direct authenticated audit RPC access", () => {
    expect(
      mayInvokeF6P1InternalRpc({
        rpc: "log_financial_audit_safe",
        identity: classifyRequestIdentity({
          jwtRole: "authenticated",
          authUid: "u1",
          appRole: "admin",
        }),
      }).allowed,
    ).toBe(false);
    expect(
      mayInvokeF6P1InternalRpc({
        rpc: "log_financial_audit_safe",
        identity: classifyRequestIdentity({
          jwtRole: "service_role",
          authUid: null,
        }),
      }).allowed,
    ).toBe(true);
  });
});

describe("P1-6 AP mapping validation", () => {
  it("blocks review_required category", () => {
    const r = resolveBillDebitAccount({
      category: "review_required",
      mappings: SAMPLE_MAPPINGS,
      inventoryPostingEnabled: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reviewRequired).toBe(true);
  });
});

describe("P1-7 installer labor source", () => {
  it("uses installer_bills as sole SoT", () => {
    expect(INSTALLER_LABOR_SOURCE).toBe("installer_bills");
    const total = installerLaborIncurredForJob(
      [
        {
          id: "b1",
          job_id: "j1",
          status: "approved",
          lines: [{ quantity: 8, rate: 45 }],
        },
      ],
      "j1",
    );
    expect(total).toBe(360);
  });
});

describe("P1-8 write-offs", () => {
  it("cannot exceed remaining AR", () => {
    const remaining = invoiceArRemainingAfterWriteOffs({
      items: [{ quantity: 1, rate: 1000 }],
      taxRate: 0,
      amountPaid: 200,
      appliedCredits: 0,
      appliedWriteOffs: 0,
    });
    expect(remaining).toBe(800);
    expect(assessWriteOffAmount({ amount: 900, remainingAr: remaining, reason: "x" }).ok).toBe(
      false,
    );
    expect(assessWriteOffAmount({ amount: 100, remainingAr: remaining, reason: "uncollectible" }).ok).toBe(
      true,
    );
  });

  it("builds balanced bad debt journal", () => {
    const entry = buildInvoiceWriteOffJournal({
      writeOffId: "wo-1",
      invoiceId: "inv-1",
      amount: 250,
      entryDate: "2026-01-15",
      mappings: SAMPLE_MAPPINGS,
      reason: "Uncollectible",
    });
    const debits = entry.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const credits = entry.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    expect(debits).toBe(credits);
  });

  it("blocks write-off when required mappings missing", () => {
    const gate = assessWriteOffMappingPrecheck({ accounts_receivable: "ar-1" });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.missing).toContain("bad_debt_expense");
    }
    expect(
      assessWriteOffMappingPrecheck({
        accounts_receivable: "ar-1",
        bad_debt_expense: "bd-1",
      }).ok,
    ).toBe(true);
  });
});

describe("P1-9 financial statements", () => {
  const accounts = [
    { id: "cash-1", code: "1000", name: "Cash", account_type: "asset" as const },
    { id: "rev-1", code: "4000", name: "Revenue", account_type: "revenue" as const },
    { id: "eq-1", code: "3000", name: "Equity", account_type: "equity" as const },
  ];
  const lines = [
    {
      accountId: "cash-1",
      debit: 1000,
      credit: 0,
      entryDate: "2026-01-10",
      entryStatus: "posted",
      journalEntryId: "je1",
    },
    {
      accountId: "rev-1",
      debit: 0,
      credit: 1000,
      entryDate: "2026-01-10",
      entryStatus: "posted",
      journalEntryId: "je1",
    },
  ];

  it("trial balance proves debits = credits", () => {
    const tb = buildTrialBalance({ accounts, lines });
    expect(tb.balanced).toBe(true);
  });

  it("balance sheet proves A = L + E", () => {
    const bs = buildBalanceSheet({
      accounts,
      lines,
      asOfDate: "2026-01-31",
      netIncomeToDate: 1000,
    });
    expect(bs.balanced).toBe(true);
  });

  it("P&L uses accounting periods", () => {
    const pnl = buildAccountingPnL({
      accounts,
      lines,
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
    expect(pnl.label).toBe("ACCOUNTING_PNL");
    expect(pnl.revenue).toBe(1000);
  });

  it("general ledger lists posted lines", () => {
    const gl = buildGeneralLedger({ accounts, lines });
    expect(gl.length).toBe(2);
  });
});

describe("P1-10 AR/AP aging", () => {
  it("buckets AR by due date", () => {
    const aging = buildArAging({
      asOfDate: "2026-02-15",
      invoices: [
        {
          id: "i1",
          number: "INV-1",
          due_date: "2026-01-01",
          issue_date: "2025-12-01",
          status: "sent",
          balance: 500,
        },
      ],
    });
    expect(aging.totals["31-60"]).toBe(500);
    expect(aging.total).toBe(500);
  });

  it("excludes void AP bills", () => {
    const aging = buildApAging({
      asOfDate: "2026-02-15",
      bills: [
        {
          id: "b1",
          bill_number: "B-1",
          due_date: "2026-02-01",
          bill_date: "2026-01-01",
          status: "void",
          balance: 200,
        },
        {
          id: "b2",
          bill_number: "B-2",
          due_date: "2026-02-01",
          bill_date: "2026-01-01",
          status: "open",
          balance: 300,
        },
      ],
    });
    expect(aging.total).toBe(300);
  });
});

describe("P1-11 mapping validation", () => {
  it("identifies missing pilot mappings", () => {
    const r = assessMappingReadiness({
      mappings: { accounts_receivable: "ar-1" },
      paymentMethodMappings: { card: "cash-1" },
    });
    expect(r.readyForPilot).toBe(false);
    expect(r.missingSystemKeys.length).toBeGreaterThan(0);
  });
});

describe("P1-12 cutover readiness", () => {
  it("reports NOT_READY when gates fail", () => {
    const report = buildCutoverReadinessReport({
      mappings: SAMPLE_MAPPINGS,
      paymentMethodMappings: {
        card: "c",
        cash: "c",
        check: "c",
        echeck: "c",
        financing: "c",
        link: "c",
        other: "c",
      },
      settings: {
        posting_enabled: false,
        books_of_record: false,
        cutover_date: null,
        opening_balances_entered: false,
        accountant_validated: false,
        backup_pitr_confirmed_at: null,
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
        trialBalanceBalanced: true,
        balanceSheetBalanced: true,
        bankReconComplete: false,
      },
    });
    expect(report.verdict).toBe("NOT_READY");
    expect(report.checklist.postingEnabled).toBe(false);
    expect(report.checklist.booksOfRecord).toBe(false);
  });
});

describe("F6-P1 security", () => {
  it("write-off requires admin/office", () => {
    expect(
      mayInvokeF6P1Rpc({
        rpc: "write_off_invoice_safe",
        identity: classifyRequestIdentity({
          jwtRole: "authenticated",
          authUid: "u1",
          appRole: "salesman",
        }),
      }).allowed,
    ).toBe(false);
    expect(
      mayInvokeF6P1Rpc({
        rpc: "write_off_invoice_safe",
        identity: classifyRequestIdentity({
          jwtRole: "authenticated",
          authUid: "u1",
          appRole: "office",
        }),
      }).allowed,
    ).toBe(true);
  });

  it("backup PITR confirm is admin only", () => {
    expect(
      mayInvokeF6P1Rpc({
        rpc: "confirm_backup_pitr_safe",
        identity: classifyRequestIdentity({
          jwtRole: "authenticated",
          authUid: "u1",
          appRole: "office",
        }),
      }).allowed,
    ).toBe(false);
  });

  it("bank staging RPC allowed for office", () => {
    expect(
      mayInvokeF6P1Rpc({
        rpc: "stage_bank_statement_import_safe",
        identity: classifyRequestIdentity({
          jwtRole: "authenticated",
          authUid: "u1",
          appRole: "office",
        }),
      }).allowed,
    ).toBe(true);
    expect(
      mayInvokeF6P1Rpc({
        rpc: "stage_bank_statement_import_safe",
        identity: classifyRequestIdentity({
          jwtRole: "authenticated",
          authUid: "u1",
          appRole: "salesman",
        }),
      }).allowed,
    ).toBe(false);
  });
});

describe("0170 owner review fixes", () => {
  it("PITR empty attestation rejected", () => {
    expect(assessPitrAttestation("").ok).toBe(false);
    expect(assessPitrAttestation("short").ok).toBe(false);
  });

  it("PITR attestation records external verification semantics", () => {
    const evidence =
      "Verified Supabase PITR on 2026-09-01 via dashboard; retention 7 days confirmed.";
    const gate = assessPitrAttestation(evidence);
    expect(gate.ok).toBe(true);
    const payload = pitrAttestationAuditPayload({
      evidence,
      confirmedAt: "2026-09-01T00:00:00Z",
      actorId: "admin-1",
    });
    expect(payload.automatedVerification).toBe(false);
    expect(payload.attestationType).toBe("OWNER_ADMIN_EXTERNAL_VERIFICATION");
  });

  it("SQL requires p_attestation_evidence minimum length", () => {
    expect(sql170).toContain("p_attestation_evidence");
    expect(sql170).toMatch(/length\(v_evidence\) < 30/);
  });
});

describe("posting disabled behavior", () => {
  it("documents posting remains off", () => {
    expect(POSTING_DISABLED_MESSAGE).toContain("disabled");
  });
});
