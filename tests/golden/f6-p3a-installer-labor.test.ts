/**
 * F6-P3A — Installer labor source + accounting-ready labor cost foundation (0174).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INSTALLER_LABOR_SOURCE,
  JOB_LABOR_IS_LEGACY,
  actualInstallerLaborForJob,
  assignmentIsNotActualCost,
  committedInstallerLaborForJob,
  employeeLaborCreatesVendorAp,
  assessLaborIdempotency,
  jobLaborMustNotFeedActual,
  laborCostForProfitability,
  laborLineTotalFromQtyRate,
  laborSettlementForJob,
  mayApproveInstallerLabor,
  paidLaborMaySilentVoid,
  parseLaborMoney,
  payrollBoundaryForEmployee,
  postingOffCreatesNoJournal,
  reversalExceedsActive,
  subcontractorCannotMarkPaidIndependently,
  unknownWorkerCannotApprove,
  draftSaveMustValidateBeforeDelete,
  subcontractorAccountingOwner,
  employeeAccountingOwner,
  correctionMustRaiseOnNestedFailure,
  INSTALLER_LABOR_LOCK_ORDER,
  INSTALLER_LABOR_AUDIT_ACTIONS,
} from "@/lib/accounting/installer-labor-source";
import {
  classifyRequestIdentity,
  expectedExecuteGrantAfter0174,
  mayInvokeF6P3AInternalRpc,
  mayInvokeF6P3ARpc,
  resolveAccountingActorId,
} from "@/lib/accounting/f5-rpc-auth";
import { FINANCIAL_AUDIT_ACTION_LABELS } from "@/lib/accounting/audit-log";
import { classifyAtomicity } from "@/lib/accounting/event-status";
import { POSTING_DISABLED_MESSAGE } from "@/lib/accounting/types";

const ROOT = join(process.cwd());
const sql174 = readFileSync(
  join(ROOT, "supabase/migrations/0174_f6_p3a_installer_labor_accounting.sql"),
  "utf8",
);

describe("F6-P3A 0174 migration markers", () => {
  it("hardens installer_bills SoT without enabling posting", () => {
    expect(sql174).toContain("approve_installer_labor_safe");
    expect(sql174).toContain("reverse_installer_labor_safe");
    expect(sql174).toContain("correct_installer_labor_safe");
    expect(sql174).toContain("create_installer_labor_bill_safe");
    expect(sql174).toContain("installer_labor_active_actual_total");
    expect(sql174).toContain("worker_kind");
    expect(sql174).toContain("ap_bill_id");
    expect(sql174).toContain("installer_labor_bill_id");
    expect(sql174).toContain("accounting_audit_from_definer_safe");
    expect(sql174).toContain("pg_advisory_xact_lock");
    expect(sql174).toContain("legacy_non_canonical");
    expect(sql174).toContain(
      "revoke insert, update, delete on public.installer_bills from authenticated",
    );
    expect(sql174).not.toMatch(/posting_enabled\s*=\s*true/i);
    expect(sql174).not.toMatch(/books_of_record\s*=\s*true/i);
    expect(sql174).not.toContain("post_journal_entry_safe(");
  });

  it("ACL statements only target live signatures", () => {
    expect(sql174).not.toMatch(
      /revoke all on function public\.complete_bank_reconciliation_safe\(uuid,\s*uuid\)/i,
    );
    expect(sql174).toContain("set search_path = public");
  });
});

describe("F6-P3A estimated / committed / actual", () => {
  const bills = [
    {
      id: "d1",
      job_id: "j1",
      status: "draft",
      total: 100,
    },
    {
      id: "a1",
      job_id: "j1",
      status: "approved",
      total: 250,
    },
    {
      id: "p1",
      job_id: "j1",
      status: "paid",
      total: 50,
    },
    {
      id: "v1",
      job_id: "j1",
      status: "void",
      total: 999,
    },
  ];

  it("1. assignment/draft is not automatic actual cost", () => {
    expect(assignmentIsNotActualCost()).toBe(true);
    expect(committedInstallerLaborForJob(bills, "j1")).toBe(100);
    expect(actualInstallerLaborForJob([{ ...bills[0] }], "j1")).toBe(0);
  });

  it("2. approved completed labor becomes actual cost", () => {
    expect(actualInstallerLaborForJob(bills, "j1")).toBe(300);
  });

  it("3. estimated vs actual separated in profitability picker", () => {
    const projected = laborCostForProfitability({
      estimated: 400,
      committed: 100,
      actual: 0,
      hasApprovedLabor: false,
    });
    expect(projected.basis).toBe("committed");
    expect(projected.amount).toBe(100);
    const actual = laborCostForProfitability({
      estimated: 400,
      committed: 100,
      actual: 300,
      hasApprovedLabor: true,
    });
    expect(actual.basis).toBe("actual");
    expect(actual.amount).toBe(300);
  });

  it("30–31. actual profitability uses approved; projected does not double-count", () => {
    const s = laborSettlementForJob(bills, "j1");
    expect(s.actual).toBe(300);
    expect(s.committed).toBe(100);
    expect(s.basis).toBe("actual");
    // Do not add estimated on top of actual
    const cost = laborCostForProfitability({
      estimated: 400,
      committed: s.committed,
      actual: s.actual,
      hasApprovedLabor: true,
    });
    expect(cost.amount).toBe(300);
  });
});

describe("F6-P3A money math", () => {
  it("4–5. quantity × rate and fixed-path totals are server-side", () => {
    expect(laborLineTotalFromQtyRate(10, 12.5)).toEqual({ ok: true, amount: 125 });
    expect(laborLineTotalFromQtyRate(1, 99.99)).toEqual({ ok: true, amount: 99.99 });
  });

  it("6–10. malformed / NaN / Infinity / fractional / negative rejected", () => {
    expect(parseLaborMoney(Number.NaN).ok).toBe(false);
    expect(parseLaborMoney(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(parseLaborMoney(-1).ok).toBe(false);
    expect(parseLaborMoney(1.001).ok).toBe(false);
    expect(laborLineTotalFromQtyRate(Number.NaN, 1).ok).toBe(false);
    expect(laborLineTotalFromQtyRate(1, Number.POSITIVE_INFINITY).ok).toBe(false);
  });
});

describe("F6-P3A auth / ACL", () => {
  it("11–13. actor spoof + installer self-approve blocked", () => {
    const anon = classifyRequestIdentity({ jwtRole: "anon", authUid: null });
    expect(
      mayInvokeF6P3ARpc({
        rpc: "approve_installer_labor_safe",
        identity: anon,
      }).allowed,
    ).toBe(false);
    const crew = classifyRequestIdentity({
      jwtRole: "authenticated",
      authUid: "u1",
      appRole: "crew",
    });
    expect(
      mayInvokeF6P3ARpc({
        rpc: "approve_installer_labor_safe",
        identity: crew,
      }).allowed,
    ).toBe(false);
    expect(
      mayApproveInstallerLabor({
        actorRole: "crew",
        actorId: "u1",
        installerId: "u1",
      }).ok,
    ).toBe(false);
    const spoof = resolveAccountingActorId({
      identity: classifyRequestIdentity({
        jwtRole: "authenticated",
        authUid: "real",
        appRole: "office",
      }),
      claimed: "spoofed",
    });
    expect(spoof.ok).toBe(true);
    if (spoof.ok) expect(spoof.actorId).toBe("auth.uid");
  });

  it("40–45. internal helpers blocked; staff grants correct", () => {
    expect(
      mayInvokeF6P3AInternalRpc({
        rpc: "installer_labor_recompute_job_actual",
        identity: classifyRequestIdentity({
          jwtRole: "authenticated",
          authUid: "u",
          appRole: "office",
        }),
      }).allowed,
    ).toBe(false);
    expect(
      expectedExecuteGrantAfter0174("installer_labor_lock_job"),
    ).toBe("service_role_only");
    expect(
      expectedExecuteGrantAfter0174("approve_installer_labor_safe"),
    ).toBe("authenticated+service_role");
    expect(sql174).toMatch(/security definer[\s\S]*set search_path = public/);
  });
});

describe("F6-P3A idempotency / concurrency / reversals", () => {
  it("14–15. same key/context duplicate; different context conflict", () => {
    expect(
      assessLaborIdempotency({
        existingKey: "k1",
        existingContextHash: "h1",
        incomingKey: "k1",
        incomingContextHash: "h1",
      }),
    ).toBe("duplicate");
    expect(
      assessLaborIdempotency({
        existingKey: "k1",
        existingContextHash: "h1",
        incomingKey: "k1",
        incomingContextHash: "h2",
      }),
    ).toBe("conflict");
  });

  it("16. lock order documented", () => {
    expect(INSTALLER_LABOR_LOCK_ORDER).toEqual([
      "discover_job_id",
      "job",
      "installer_bill",
      "ap_bill",
      "ap_payments",
      "accounting_outbox",
    ]);
    expect(sql174).toContain("installer_labor_lock_for_bill");
    expect(sql174).toContain("installer_labor_lock_job");
  });

  it("17–23. immutability + reversal rules", () => {
    expect(sql174).toContain("INSTALLER_LABOR_IMMUTABLE");
    expect(sql174).toContain("REASON_REQUIRED");
    expect(sql174).toContain("PAID_LOCKED");
    expect(paidLaborMaySilentVoid()).toBe(false);
    expect(
      reversalExceedsActive({ originalActiveTotal: 100, reversalAmount: 100.01 }),
    ).toBe(true);
  });
});

describe("F6-P3A AP / employee / posting-off", () => {
  it("24–26. subcontractor AP vs employee payroll boundary", () => {
    expect(employeeLaborCreatesVendorAp("subcontractor")).toBe(true);
    expect(employeeLaborCreatesVendorAp("employee")).toBe(false);
    expect(payrollBoundaryForEmployee().createsVendorAp).toBe(false);
    expect(payrollBoundaryForEmployee().processesPayroll).toBe(false);
    expect(sql174).toContain("payroll_boundary");
    expect(sql174).toContain("linked_vendor_ap");
    expect(sql174).toContain("accounting_category");
    expect(sql174).toContain("'installer_labor'");
  });

  it("27–29. posting OFF creates no journal; outbox gated", () => {
    expect(postingOffCreatesNoJournal(false)).toBe(true);
    expect(INSTALLER_LABOR_SOURCE).toBe("installer_bills");
    expect(jobLaborMustNotFeedActual()).toBe(true);
    expect(JOB_LABOR_IS_LEGACY).toBe(true);
    expect(classifyAtomicity("installer_bill")).toBe("outbox_guaranteed");
    // posting-policy shape varies — assert SQL never enables journals
    expect(sql174).toContain("Automatic accounting posting is disabled");
    expect(POSTING_DISABLED_MESSAGE.length).toBeGreaterThan(0);
  });
});

describe("F6-P3A settlement + audit", () => {
  it("53–56. owed/paid/remaining + payment does not remove actual", () => {
    const s = laborSettlementForJob(
      [
        { id: "a", job_id: "j", status: "approved", total: 80 },
        { id: "p", job_id: "j", status: "paid", total: 20 },
      ],
      "j",
    );
    expect(s.owed).toBe(80);
    expect(s.paid).toBe(20);
    expect(s.remaining).toBe(80);
    expect(s.actual).toBe(100);
  });

  it("46–47. audit actions registered", () => {
    for (const a of INSTALLER_LABOR_AUDIT_ACTIONS) {
      expect(FINANCIAL_AUDIT_ACTION_LABELS[a]).toBeTruthy();
    }
  });

  it("50. legacy job_labor not converted to fake payables", () => {
    expect(sql174).toContain("job_labor is NOT the financial actual labor SoT");
    expect(sql174).not.toMatch(/insert into public\.installer_bills[\s\S]*from public\.job_labor/i);
  });
});

describe("F6-P3A pre-deploy hardening (owner review blockers)", () => {
  it("reversing labor voids unpaid AP and blocks settled AP", () => {
    expect(sql174).toContain("installer_labor_void_linked_ap");
    expect(sql174).toContain("AP_SETTLED");
    expect(sql174).toContain("ap_lifecycle");
    expect(sql174).toContain("installer_labor_ap_voided");
    expect(sql174).not.toMatch(/delete from public\.bills/i);
  });

  it("draft save validates every line before DELETE (first/middle/last)", () => {
    expect(draftSaveMustValidateBeforeDelete()).toBe(true);
    const saveIdx = sql174.indexOf("create or replace function public.save_installer_labor_draft_safe");
    const saveFn = sql174.slice(saveIdx, sql174.indexOf("create or replace function public.approve_installer_labor_safe"));
    expect(saveFn).toContain("PHASE A");
    expect(saveFn).toContain("installer_labor_validate_lines");
    expect(saveFn.indexOf("installer_labor_validate_lines")).toBeLessThan(
      saveFn.indexOf("delete from public.installer_bill_line_items"),
    );
  });

  it("unknown or missing worker cannot approve", () => {
    expect(unknownWorkerCannotApprove("unknown")).toBe(true);
    expect(unknownWorkerCannotApprove("employee")).toBe(false);
    expect(
      mayApproveInstallerLabor({
        actorRole: "office",
        actorId: "o1",
        installerId: null,
        crewId: null,
        workerKind: "unknown",
      }).ok,
    ).toBe(false);
    expect(sql174).toContain("CLASSIFICATION_REQUIRED");
    expect(sql174).toContain("installer_labor_classify_worker");
  });

  it("job_line_id is persisted, fingerprinted, and cross-job blocked", () => {
    expect(sql174).toContain("CROSS_JOB_LINE");
    expect(sql174).toContain("INVALID_JOB_LINE");
    expect(sql174).toContain("job_line_id");
    expect(sql174).toContain("coalesce(v_jlid::text, '')");
  });

  it("NaN/Infinity and malformed JSON numeric/boolean fail closed", () => {
    expect(sql174).toContain("installer_labor_text_is_nonfinite");
    expect(sql174).toContain("non-finite numeric rejected");
    expect(sql174).toContain("INSTALLER_LABOR_INVALID_BOOLEAN");
    expect(sql174).toContain("installer_labor_json_numeric");
    expect(sql174).toContain("installer_labor_json_bool");
    expect(sql174).toContain("installer_labor_parse_numeric_text");
  });

  it("subcontractor payment is AP-canonical; employee has payroll boundary", () => {
    expect(subcontractorCannotMarkPaidIndependently()).toBe(true);
    expect(sql174).toContain("SUBCONTRACTOR_USE_AP_PAYMENT");
    expect(sql174).toContain("record_bill_payment_safe");
    expect(sql174).toContain("payroll_ops_status");
    expect(sql174).toContain("bill_payments_sync_installer_labor");
    expect(sql174).toContain("installer_labor_ap_paid_total");
    expect(employeeLaborCreatesVendorAp("employee")).toBe(false);
  });

  it("correction leaves one active AP; action idempotency is contextual", () => {
    expect(sql174).toContain("installer_labor_action_idempotency");
    expect(sql174).toContain("IDEMPOTENCY_CONFLICT");
    expect(sql174).toContain(":void-original");
    expect(sql174).toContain(":create-replacement");
    expect(
      assessLaborIdempotency({
        existingKey: "k1",
        existingContextHash: "h1",
        incomingKey: "k1",
        incomingContextHash: "h1",
        existingAction: "create",
        incomingAction: "reverse",
      }),
    ).toBe("conflict");
  });

  it("approved/void/cancelled child lines immutable; both parent IDs checked", () => {
    expect(sql174).toContain("protect BOTH parents");
    expect(sql174).toContain("old.bill_id");
    expect(sql174).toContain("new.bill_id");
    expect(sql174).toContain("Cancelled installer labor cannot be edited");
    expect(sql174).toContain("AP source link cannot be replaced");
  });

  it("RLS is admin/office only, not generic is_staff compensation leak", () => {
    expect(sql174).toContain("user_role(auth.uid()) in ('admin', 'office')");
    expect(sql174).toContain("installer_bills_admin_office_select");
  });

  it("enqueue preserves prior event families and adds installer + vendor_bill_void", () => {
    expect(sql174).toContain("'payment', 'payment_void'");
    expect(sql174).toContain("credit_application_void");
    expect(sql174).toContain("invoice_write_off_void");
    expect(sql174).toContain("customer_deposit_void");
    expect(sql174).toContain("vendor_bill_void");
    expect(sql174).toContain("'installer_bill', 'installer_bill_void'");
    expect(classifyAtomicity("vendor_bill_void")).toBe("outbox_guaranteed");
    expect(sql174).not.toMatch(/posting_enabled\s*=\s*true/i);
  });

  it("subcontractor approval requires canonical supplier", () => {
    expect(sql174).toContain("SUBCONTRACTOR_VENDOR_REQUIRED");
    expect(sql174).toContain("install_crews");
    expect(sql174).toContain("supplier_id");
  });
});

describe("F6-P3A final deployment blockers", () => {
  it("1–5. correction is all-or-nothing via RAISE after preflight", () => {
    expect(correctionMustRaiseOnNestedFailure()).toBe(true);
    expect(sql174).toContain("INSTALLER_LABOR_CORRECTION_ABORTED");
    expect(sql174).toContain("installer_labor_require_ok");
    expect(sql174).toContain("COMPLETE PREFLIGHT");
    const correctIdx = sql174.indexOf(
      "create or replace function public.correct_installer_labor_safe",
    );
    const correctFn = sql174.slice(
      correctIdx,
      sql174.indexOf("create or replace function public.enqueue_accounting_outbox_safe"),
    );
    // AP_SETTLED checked before create replacement mutation path
    expect(correctFn.indexOf("AP_SETTLED")).toBeLessThan(
      correctFn.indexOf("MUTATION PATH"),
    );
    expect(correctFn.indexOf("MUTATION PATH")).toBeLessThan(
      correctFn.indexOf("installer_labor_require_ok"),
    );
    expect(correctFn).toContain("create replacement");
    expect(correctFn).toContain("reverse original");
    expect(correctFn).toContain("approve replacement");
  });

  it("6–10. subcontractor single accounting owner; vendor void never overwrites pending", () => {
    expect(subcontractorAccountingOwner()).toBe("vendor_bill");
    expect(employeeAccountingOwner()).toBe("installer_bill");
    expect(sql174).toContain("installer_labor_record_vendor_event");
    expect(sql174).toContain("Subcontractor accounting owner = vendor AP");
    expect(sql174).toContain(
      "when accounting_event_status.status in ('pending', 'review_required', 'posted')",
    );
    // Approve path: subcontractor uses vendor event, not installer_bill posting intent
    const approveIdx = sql174.indexOf(
      "create or replace function public.approve_installer_labor_safe",
    );
    const approveFn = sql174.slice(
      approveIdx,
      sql174.indexOf("create or replace function public.reverse_installer_labor_safe"),
    );
    expect(approveFn).toContain("installer_labor_record_vendor_event");
    expect(approveFn).toContain("Employee-only installer_bill posting intent");
    // Subcontractor branch must not call installer_labor_record_event_status
    const subBlock = approveFn.slice(
      approveFn.indexOf("if v_kind = 'subcontractor' and v_bill.ap_bill_id is null"),
      approveFn.indexOf("elsif v_kind = 'employee'"),
    );
    expect(subBlock).not.toContain("installer_labor_record_event_status");
    expect(subBlock).toContain("installer_labor_record_vendor_event");
  });

  it("11–13. posting OFF / employee boundary / employee event gated", () => {
    expect(sql174).not.toMatch(/posting_enabled\s*=\s*true/i);
    expect(sql174).toContain("installer_posting_enabled");
    expect(sql174).toContain("payroll_boundary");
    expect(employeeLaborCreatesVendorAp("employee")).toBe(false);
  });

  it("14–16. shared outbox parity + resolved worker context hash", () => {
    expect(sql174).toContain("'payment', 'payment_void'");
    expect(sql174).toContain("credit_application_void");
    expect(sql174).toContain("vendor_bill_void");
    expect(sql174).toContain("invoice_write_off_void");
    expect(sql174).toContain("customer_deposit_void");
    expect(sql174).toContain(
      "Resolve ACTUAL persisted worker identity BEFORE kind/hash/idempotency",
    );
    expect(sql174).toContain("v_installer := coalesce(p_installer_id, v_job.assigned_to)");
    expect(sql174).toContain("v_crew := coalesce(p_crew_id, v_job.assigned_crew_id)");
    expect(
      assessLaborIdempotency({
        existingKey: "k1",
        existingContextHash: "job|installerA|crewA|…",
        incomingKey: "k1",
        incomingContextHash: "job|installerB|crewB|…",
        existingAction: "create",
        incomingAction: "create",
      }),
    ).toBe("conflict");
  });
});
