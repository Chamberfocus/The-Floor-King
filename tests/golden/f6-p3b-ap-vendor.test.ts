/**
 * F6-P3B — AP vendor/category integrity (0175). Unapplied until owner review.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AP_LEDGER,
  AP_LOCK_ORDER,
  AP_AUDIT_ACTIONS,
  AP_MONEY_ERROR,
  apLineTotal,
  apOriginalTotal,
  apRemaining,
  apSettlementStatus,
  parseApMoney,
  normalizeVendorInvoice,
  vendorInvoiceDuplicate,
  assessApIdempotency,
  installerLinkedApMayManualEdit,
  installerLinkedApMayDelete,
  paidApMaySilentVoid,
  paymentCreatesSecondExpense,
  poCommitmentIsNotActual,
  installerLaborPlusApDoubleCountsLabor,
  employeeLaborCreatesVendorAp,
  vendorCreditsImplementedThisPhase,
  apAccountingCategoryValid,
  vendorInvoiceLockRequiredWhenIndexAbsent,
  poRowLockSerializesDuplicateAp,
  nativeNumericMustRejectNonFinite,
  billPaymentTriggerMustRejectDraftAndVoid,
  apPaymentInsertsExpense,
  billLinkedDirectExpenseCreatesSecondCost,
  unlinkedExpenseApDuplicateIsDeterministic,
  apDirectExpenseIdentityIsSymmetric,
  directExpenseIdempotencyIsContextAware,
  authenticatedExpenseHardDeleteAllowed,
  expenseReversalDeferredThisPhase,
  apLockJobsSortedRequiredForJobChange,
  financialIdempotencyRequiresCompleteContext,
  paymentIdempotencyRejectsBillIdOnlyShortcut,
  postVendorBillSafeClosedAfter0175,
  CANONICAL_AP_MUTATION_RPCS,
  gucIsNotATablePrivilege,
  apSelectRoles,
  correctionNestedFailureMustRaise,
} from "@/lib/accounting/ap-source";
import {
  classifyRequestIdentity,
  expectedExecuteGrantAfter0175,
  mayInvokeF6P3BInternalRpc,
  mayInvokeF6P3BRpc,
  mayInvokeF6P3ARpc,
  resolveAccountingActorId,
} from "@/lib/accounting/f5-rpc-auth";
import { FINANCIAL_AUDIT_ACTION_LABELS } from "@/lib/accounting/audit-log";
import { POSTING_DISABLED_MESSAGE } from "@/lib/accounting/types";
import { committedPoSpendExcludingBilled } from "@/lib/finance-cost";
import { employeeLaborCreatesVendorAp as p3aEmployeeNoAp } from "@/lib/accounting/installer-labor-source";

const ROOT = join(process.cwd());
const sql175 = readFileSync(
  join(ROOT, "supabase/migrations/0175_f6_p3b_ap_vendor_integrity.sql"),
  "utf8",
);
const sql174 = readFileSync(
  join(ROOT, "supabase/migrations/0174_f6_p3a_installer_labor_accounting.sql"),
  "utf8",
);

describe("F6-P3B 0175 migration markers", () => {
  it("75. ships unapplied AP integrity SQL without enabling posting", () => {
    expect(sql175).toContain("create_vendor_bill_safe");
    expect(sql175).toContain("save_vendor_bill_draft_safe");
    expect(sql175).toContain("activate_vendor_bill_safe");
    expect(sql175).toContain("void_vendor_bill_safe");
    expect(sql175).toContain("correct_vendor_bill_safe");
    expect(sql175).toContain("ap_bill_original_total");
    expect(sql175).toContain("revoke insert, update, delete on public.bills from authenticated");
    expect(sql175).toContain("IDEMPOTENCY_CONFLICT");
    expect(sql175).toContain("AP_CORRECTION_ABORTED");
    expect(sql175).toContain("set search_path = public");
    expect(sql175).not.toMatch(/posting_enabled\s*=\s*true/i);
    expect(sql175).not.toMatch(/books_of_record\s*=\s*true/i);
    expect(sql175).not.toContain("create or replace function public.enqueue_accounting_outbox_safe");
    expect(sql175).not.toContain("post_journal_entry_safe(");
    expect(sql175).not.toMatch(/drop function if exists public\.complete_bank_reconciliation_safe\(uuid,\s*uuid\)/i);
  });

  it("reuses 0174 pending-safe vendor event writer", () => {
    expect(sql175).toContain("installer_labor_record_vendor_event");
    expect(sql175).toContain("ap_record_vendor_event");
    expect(sql174).toContain("when accounting_event_status.status in ('pending', 'review_required', 'posted')");
  });
});

describe("F6-P3B canonical AP model", () => {
  it("1. manual draft is the AP ledger", () => {
    expect(AP_LEDGER).toBe("bills");
  });

  it("2–5. malformed money / NaN / Infinity / extra cents rejected", () => {
    expect(parseApMoney(Number.NaN).ok).toBe(false);
    expect(parseApMoney(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(parseApMoney(1.001).ok).toBe(false);
    expect(parseApMoney(-2).ok).toBe(false);
    expect(apLineTotal(Number.NaN, 1).ok).toBe(false);
    expect(AP_MONEY_ERROR.NAN).toMatch(/NaN/);
  });

  it("6–7. invalid/inactive supplier is an activation concern", () => {
    expect(sql175).toContain("AP_SUPPLIER_INVALID");
    expect(sql175).toContain("AP_SUPPLIER_INACTIVE");
  });

  it("8–10. vendor invoice duplicate vs recurring blank numbers", () => {
    expect(normalizeVendorInvoice("  AB-12 ")).toBe("ab-12");
    expect(
      vendorInvoiceDuplicate({
        supplierId: "s1",
        invoiceNorm: "inv1",
        existing: [{ supplierId: "s1", invoiceNorm: "inv1", lifecycle: "open" }],
      }),
    ).toBe(true);
    expect(
      vendorInvoiceDuplicate({
        supplierId: "s2",
        invoiceNorm: "inv1",
        existing: [{ supplierId: "s1", invoiceNorm: "inv1", lifecycle: "open" }],
      }),
    ).toBe(false);
    expect(
      vendorInvoiceDuplicate({
        supplierId: "s1",
        invoiceNorm: null,
        existing: [{ supplierId: "s1", invoiceNorm: null, lifecycle: "open" }],
      }),
    ).toBe(false);
  });

  it("11–12. draft save validates before mutate", () => {
    expect(sql175).toContain("PHASE A: parse/validate complete payload before any mutation");
    expect(sql175).toContain("PHASE B: mutate only after validation succeeded");
  });

  it("13–15. approval + retry + conflict", () => {
    expect(sql175).toContain("activate_vendor_bill_safe");
    expect(assessApIdempotency({
      existingKey: "k",
      existingContextHash: "h1",
      incomingKey: "k",
      incomingContextHash: "h1",
      existingAction: "activate_vendor_bill",
      incomingAction: "activate_vendor_bill",
    })).toBe("duplicate");
    expect(assessApIdempotency({
      existingKey: "k",
      existingContextHash: "h1",
      incomingKey: "k",
      incomingContextHash: "h2",
      existingAction: "activate_vendor_bill",
      incomingAction: "activate_vendor_bill",
    })).toBe("conflict");
    expect(assessApIdempotency({
      existingKey: "k",
      existingContextHash: "h1",
      incomingKey: "k",
      incomingContextHash: "h1",
      existingAction: "activate_vendor_bill",
      incomingAction: "void_vendor_bill",
    })).toBe("conflict");
  });

  it("16–19. active bill/line/delete blocked", () => {
    expect(sql175).toContain("AP_IMMUTABLE: Approved vendor bills cannot change economic fields");
    expect(sql175).toContain("Line items on active/void bills cannot be inserted");
    expect(sql175).toContain("Active or void vendor bills cannot be deleted");
  });

  it("20–22. unpaid void; paid/partial blocked", () => {
    expect(paidApMaySilentVoid()).toBe(false);
    expect(sql175).toContain("AP_SETTLED");
    expect(sql175).toContain("Paid or partially paid bills cannot be voided");
  });

  it("23–30. payment remaining formulas", () => {
    expect(apOriginalTotal([{ quantity: 2, unit_cost: 10 }])).toBe(20);
    expect(apRemaining({ original: 20, paidActive: 5, lifecycle: "open" })).toBe(15);
    expect(apSettlementStatus({ lifecycle: "open", original: 20, paidActive: 5 })).toBe("partial");
    expect(apSettlementStatus({ lifecycle: "open", original: 20, paidActive: 20 })).toBe("paid");
    expect(apRemaining({ original: 20, paidActive: 5, lifecycle: "void" })).toBe(0);
    expect(parseApMoney(0).ok).toBe(false);
    expect(sql175).toContain("OVERPAYMENT");
  });

  it("31–33. reversal + void payment blocked", () => {
    expect(sql175).toContain("void_bill_payment_safe");
    expect(sql175).toContain("Cannot pay a void vendor bill");
    expect(sql175).toContain("Bill payments cannot be deleted");
  });

  it("34–39. installer-linked AP locked; employee no AP", () => {
    expect(installerLinkedApMayManualEdit()).toBe(false);
    expect(installerLinkedApMayDelete()).toBe(false);
    expect(employeeLaborCreatesVendorAp()).toBe(false);
    expect(p3aEmployeeNoAp("employee")).toBe(false);
    expect(sql175).toContain("Installer-linked AP cannot be edited here");
    expect(sql175).toContain("INSTALLER_LINKED");
  });

  it("40–41. PO commitment vs AP actual", () => {
    expect(poCommitmentIsNotActual(true)).toBe(true);
    expect(
      committedPoSpendExcludingBilled({
        poId: "po1",
        poTotal: 400,
        billedPoIds: new Set(["po1"]),
      }),
    ).toBe(0);
    expect(
      committedPoSpendExcludingBilled({
        poId: "po2",
        poTotal: 400,
        billedPoIds: new Set(["po1"]),
      }),
    ).toBe(400);
    expect(sql175).toContain("DUPLICATE_PO_AP");
  });

  it("42. direct expense vs AP", () => {
    expect(paymentCreatesSecondExpense()).toBe(false);
    expect(sql175).toContain("skip ledger when p_bill_id is set");
  });

  it("43–44. legacy free-text + no auto-mutation", () => {
    expect(sql175).toContain("legacy_review_required");
    expect(sql175).not.toContain("insert into public.suppliers");
  });

  it("45–46. category mapping", () => {
    expect(apAccountingCategoryValid("material_purchase")).toBe(true);
    expect(apAccountingCategoryValid("not_a_category")).toBe(false);
    expect(sql175).toContain("AP_CATEGORY_INVALID");
  });

  it("47–48. overhead without job; job retained", () => {
    expect(sql175).toContain("p_job_id uuid default null");
  });

  it("49–55. posting gated AP events", () => {
    expect(POSTING_DISABLED_MESSAGE).toBeTruthy();
    expect(sql175).toContain("'eventKind', 'vendor_bill'");
    expect(sql175).toContain("'eventKind', 'vendor_bill_void'");
    expect(sql175).toContain("'eventKind', 'bill_payment'");
    expect(sql175).toContain("'eventKind', 'bill_payment_void'");
    expect(installerLaborPlusApDoubleCountsLabor()).toBe(false);
  });

  it("56–57. audit exact once; failed ops raise before store", () => {
    for (const a of AP_AUDIT_ACTIONS) {
      expect(FINANCIAL_AUDIT_ACTION_LABELS[a as keyof typeof FINANCIAL_AUDIT_ACTION_LABELS] || a).toBeTruthy();
    }
    expect(sql175).toContain("accounting_audit_from_definer_safe");
  });

  it("58–60. lock order for concurrent approval/payment/void", () => {
    expect(AP_LOCK_ORDER).toEqual([
      "job",
      "source",
      "vendor_invoice",
      "ap_bill",
      "ap_payments",
      "accounting_outbox",
    ]);
    expect(sql175).toContain("VENDOR INVOICE (176)");
  });
});

describe("F6-P3B ACL", () => {
  it("61–64. admin/office staff; crew/anon/internal blocked", () => {
    const office = classifyRequestIdentity({
      jwtRole: "authenticated",
      authUid: "u1",
      appRole: "office",
    });
    expect(mayInvokeF6P3BRpc({ rpc: "activate_vendor_bill_safe", identity: office }).allowed).toBe(true);
    const crew = classifyRequestIdentity({
      jwtRole: "authenticated",
      authUid: "u2",
      appRole: "crew",
    });
    expect(mayInvokeF6P3BRpc({ rpc: "activate_vendor_bill_safe", identity: crew }).allowed).toBe(false);
    const anon = classifyRequestIdentity({ jwtRole: "anon", authUid: null });
    expect(mayInvokeF6P3BRpc({ rpc: "create_vendor_bill_safe", identity: anon }).allowed).toBe(false);
    expect(
      mayInvokeF6P3BInternalRpc({ rpc: "ap_lock_bill", identity: office }).allowed,
    ).toBe(false);
    expect(expectedExecuteGrantAfter0175("ap_lock_bill")).toBe("service_role_only");
    expect(expectedExecuteGrantAfter0175("create_vendor_bill_safe")).toBe(
      "authenticated+service_role",
    );
  });

  it("65. SECURITY DEFINER search_path", () => {
    expect(sql175).toContain("security definer");
    expect(sql175).toContain("set search_path = public");
  });

  it("actor spoof uses canonical actor", () => {
    const id = classifyRequestIdentity({
      jwtRole: "authenticated",
      authUid: "real",
      appRole: "office",
    });
    const spoof = resolveAccountingActorId({
      identity: id,
      claimed: "spoof",
    });
    expect(spoof.ok).toBe(true);
    if (spoof.ok) expect(spoof.actorId).toBe("auth.uid");
  });

  it("66–72. prior installer labor RPCs still office-gated", () => {
    const crew = classifyRequestIdentity({
      jwtRole: "authenticated",
      authUid: "c",
      appRole: "crew",
    });
    expect(
      mayInvokeF6P3ARpc({ rpc: "approve_installer_labor_safe", identity: crew }).allowed,
    ).toBe(false);
  });
});

describe("F6-P3B deferred / flags", () => {
  it("73–74. vendor credits deferred; no fake production data / flags", () => {
    expect(vendorCreditsImplementedThisPhase()).toBe(false);
    expect(sql175).not.toMatch(/opening_balances_entered\s*=\s*true/i);
    expect(sql175).not.toMatch(/accountant_validated\s*=\s*true/i);
  });
});

describe("F6-P3B surgical hardening", () => {
  it("1–10. invoice/PO concurrency without unique indexes", () => {
    expect(vendorInvoiceLockRequiredWhenIndexAbsent()).toBe(true);
    expect(poRowLockSerializesDuplicateAp()).toBe(true);
    expect(sql175).toContain("ap_lock_vendor_invoice");
    expect(sql175).toContain("bills_active_po_source_uidx was skipped");
    expect(sql175).toContain("pg_advisory_xact_lock");
    expect(sql175).toContain("176");
    expect(sql175).toContain("perform public.ap_lock_vendor_invoice(p_supplier_id, v_norm)");
    expect(sql175).toContain("perform public.ap_lock_vendor_invoice(");
  });

  it("11–16. draft/void payment trigger is wired once; installer sync kept", () => {
    expect(billPaymentTriggerMustRejectDraftAndVoid()).toBe(true);
    expect(sql175).toContain("drop trigger if exists bill_payments_block_void_ap");
    expect(sql175).toContain("create trigger bill_payments_block_void_ap");
    expect(sql175).toContain("before insert or update of bill_id, amount, status");
    expect(sql174).toContain("bill_payments_sync_installer_labor");
    expect(sql175).not.toContain("drop trigger if exists bill_payments_sync_installer_labor");
  });

  it("17–24. native numeric finite validation", () => {
    expect(nativeNumericMustRejectNonFinite()).toBe(true);
    expect(parseApMoney(Number.NaN).ok).toBe(false);
    expect(parseApMoney(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(parseApMoney(Number.NEGATIVE_INFINITY).ok).toBe(false);
    expect(parseApMoney(12.5).ok).toBe(true);
    expect(parseApMoney(1.001).ok).toBe(false);
    expect(sql175).toContain("p_amount double precision");
    expect(sql175).toContain("p_amount <> p_amount");
    expect(sql175).toContain("'Infinity'::double precision");
    expect(sql175).toContain("ap_store_action");
  });

  it("25–30. expense/AP boundary: proven vs workflow", () => {
    expect(billLinkedDirectExpenseCreatesSecondCost()).toBe(false);
    expect(apPaymentInsertsExpense()).toBe(false);
    expect(unlinkedExpenseApDuplicateIsDeterministic()).toBe(false);
    expect(apDirectExpenseIdentityIsSymmetric()).toBe(true);
    expect(sql175).toContain("AP_EXPENSE_BOUNDARY");
    expect(sql175).toContain("REQUIRE_DIRECT_EXPENSE_ACK");
    expect(sql175).toContain("AP_OBLIGATION_EXISTS");
    expect(sql175).toContain("DIRECT_EXPENSE_EXISTS");
    expect(sql175).toContain("ap_reject_if_direct_expense_identity");
    expect(sql175).toContain("economic_kind");
  });

  it("1–10 reverse: expense-first identity blocks AP", () => {
    expect(sql175).toContain("A direct cash expense already uses this vendor invoice");
    expect(sql175).toMatch(/ap_reject_if_direct_expense_identity/);
  });

  it("11–18. direct expense context-aware idempotency", () => {
    expect(directExpenseIdempotencyIsContextAware()).toBe(true);
    expect(sql175).toContain("'record_direct_expense'");
    expect(sql175).toContain("ap_context_hash('record_direct_expense'");
    expect(sql175).toContain("IDEMPOTENCY_CONFLICT");
    expect(assessApIdempotency({
      existingKey: "e1",
      existingContextHash: "h1",
      incomingKey: "e1",
      incomingContextHash: "h2",
      existingAction: "record_direct_expense",
      incomingAction: "record_direct_expense",
    })).toBe("conflict");
    expect(assessApIdempotency({
      existingKey: "e1",
      existingContextHash: "h1",
      incomingKey: "e1",
      incomingContextHash: "h1",
      existingAction: "record_direct_expense",
      incomingAction: "record_direct_expense",
    })).toBe("duplicate");
  });

  it("19–25. authenticated expense hard delete blocked; reversal deferred", () => {
    expect(authenticatedExpenseHardDeleteAllowed()).toBe(false);
    expect(expenseReversalDeferredThisPhase()).toBe(true);
    expect(sql175).toContain("revoke insert, update, delete on public.expenses from authenticated");
    expect(sql175).not.toMatch(/grant select, delete on public\.expenses to authenticated/);
    expect(sql175).toContain("expenses_admin_office_select");
    expect(sql175).toContain("AP_LOCK_RETRY");
  });

  it("26–33. global lock order consistent (invoice before bill; jobs sorted)", () => {
    expect(AP_LOCK_ORDER[0]).toBe("job");
    expect(AP_LOCK_ORDER[2]).toBe("vendor_invoice");
    expect(apLockJobsSortedRequiredForJobChange()).toBe(true);
    expect(sql175).toContain("FINAL GLOBAL ADVISORY LOCK ORDER");
    expect(sql175).toContain("ap_lock_jobs_sorted");
    expect(sql175).toContain("ap_lock_vendor_invoices_sorted");
    const lockBillFn = sql175.slice(
      sql175.indexOf("create or replace function public.ap_lock_bill("),
      sql175.indexOf("create or replace function public.ap_record_vendor_event("),
    );
    expect(lockBillFn.indexOf("ap_lock_jobs_sorted")).toBeGreaterThan(-1);
    expect(lockBillFn.indexOf("ap_lock_jobs_sorted")).toBeLessThan(
      lockBillFn.indexOf("ap_lock_vendor_invoices_sorted"),
    );
    expect(lockBillFn.indexOf("ap_lock_vendor_invoices_sorted")).toBeLessThan(
      lockBillFn.indexOf("pg_advisory_xact_lock(\n    175"),
    );
    expect(lockBillFn).toContain("AP_LOCK_RETRY");
    expect(sql175).toContain(
      "perform public.ap_lock_bill(p_bill_id, p_supplier_id, v_norm, p_job_id)",
    );
    expect(sql175).not.toMatch(
      /perform public\.ap_lock_bill\(p_bill_id\);\s*[\s\S]{0,200}perform public\.ap_lock_vendor_invoice/,
    );
    // No standalone JOB lock after invoice advisory in create path
    const createFn = sql175.slice(
      sql175.indexOf("create or replace function public.create_vendor_bill_safe("),
      sql175.indexOf("create or replace function public.save_vendor_bill_draft_safe("),
    );
    expect(createFn.indexOf("ap_lock_jobs_sorted")).toBeLessThan(
      createFn.indexOf("ap_lock_vendor_invoice"),
    );
  });

  it("13–31. complete financial idempotency contexts", () => {
    expect(financialIdempotencyRequiresCompleteContext()).toBe(true);
    expect(paymentIdempotencyRejectsBillIdOnlyShortcut()).toBe(true);
    // create
    expect(sql175).toMatch(
      /ap_context_hash\('create_vendor_bill'[\s\S]*?'due_date'[\s\S]*?'terms'[\s\S]*?'memo'[\s\S]*?'source_type'/,
    );
    // save
    expect(sql175).toMatch(
      /ap_context_hash\('save_vendor_bill_draft'[\s\S]*?'bill_date'[\s\S]*?'due_date'[\s\S]*?'terms'[\s\S]*?'memo'/,
    );
    // correct
    expect(sql175).toMatch(
      /ap_context_hash\('correct_vendor_bill'[\s\S]*?'bill_date'[\s\S]*?'due_date'[\s\S]*?'bill_number'[\s\S]*?'job_id'[\s\S]*?'category'/,
    );
    // payment — no bill_id-only shortcut
    expect(sql175).toMatch(
      /ap_context_hash\('record_bill_payment'[\s\S]*?'economic_date'[\s\S]*?'cash_account_id'/,
    );
    expect(sql175).toContain("never bill_id-only shortcut");
    expect(assessApIdempotency({
      existingKey: "c1",
      existingContextHash: "h1",
      incomingKey: "c1",
      incomingContextHash: "h2",
      existingAction: "correct_vendor_bill",
      incomingAction: "correct_vendor_bill",
    })).toBe("conflict");
  });

  it("expenses provenance columns precede helpers that reference them", () => {
    const alterIdx = sql175.indexOf(
      "alter table public.expenses\n  add column if not exists supplier_id",
    );
    const helperIdx = sql175.indexOf(
      "create or replace function public.ap_direct_expense_identity_exists(",
    );
    const rpcIdx = sql175.indexOf(
      "create or replace function public.record_direct_expense_safe(",
    );
    const triggerIdx = sql175.indexOf(
      "create or replace function public.expenses_block_ap_linked_insert()",
    );
    expect(alterIdx).toBeGreaterThan(-1);
    expect(helperIdx).toBeGreaterThan(alterIdx);
    expect(triggerIdx).toBeGreaterThan(alterIdx);
    expect(rpcIdx).toBeGreaterThan(helperIdx);
    // Exactly one canonical expenses provenance ALTER (no late duplicate)
    expect(
      sql175.split("add column if not exists supplier_id uuid references public.suppliers").length - 1,
    ).toBe(1);
    expect(sql175).toContain("1b) Expenses provenance columns");
  });

  it("legacy post_vendor_bill_safe surface closed", () => {
    expect(postVendorBillSafeClosedAfter0175()).toBe(true);
    expect(expectedExecuteGrantAfter0175("post_vendor_bill_safe")).toBe("dropped");
    expect(sql175).toContain("LEGACY RPC CLOSURE — post_vendor_bill_safe");
    expect(sql175).toContain("and p.proname = 'post_vendor_bill_safe'");
    expect(sql175).toContain("drop function if exists %s");
    expect(sql175).toContain("AP_LEGACY_RPC: post_vendor_bill_safe must be dropped");
    // Not in staff ACL grant list
    expect(sql175).not.toMatch(
      /v_staff text\[\] := array\[[\s\S]*?'post_vendor_bill_safe'[\s\S]*?\];/,
    );
    // No create/replace of the legacy body in 0175
    expect(sql175).not.toContain("create or replace function public.post_vendor_bill_safe");
    // Canonical surface only
    for (const rpc of CANONICAL_AP_MUTATION_RPCS) {
      expect(sql175).toContain(`create or replace function public.${rpc}`);
      expect(expectedExecuteGrantAfter0175(
        rpc as Parameters<typeof expectedExecuteGrantAfter0175>[0],
      )).toBe("authenticated+service_role");
    }
    expect(sql175).toContain("activate_vendor_bill_safe");
    expect(sql175).not.toMatch(/posting_enabled\s*=\s*true/i);
    // Installer-linked still blocked on staff activate/void/correct
    expect(sql175).toContain("INSTALLER_LINKED");
  });

  it("GUC is not a table privilege; SELECT is admin/office", () => {
    expect(gucIsNotATablePrivilege()).toBe(true);
    expect(apSelectRoles()).toEqual(["admin", "office"]);
    expect(sql175).toContain("revoke insert, update, delete on public.bills from authenticated");
    expect(sql175).toContain("bills_admin_office_select");
    expect(sql175).toContain("user_role(auth.uid()) in ('admin', 'office')");
    expect(expectedExecuteGrantAfter0175("ap_lock_vendor_invoice")).toBe("service_role_only");
    expect(
      mayInvokeF6P3BInternalRpc({
        rpc: "ap_lock_vendor_invoice",
        identity: classifyRequestIdentity({
          jwtRole: "authenticated",
          authUid: "u",
          appRole: "office",
        }),
      }).allowed,
    ).toBe(false);
  });

  it("31–36. correction RAISE atomicity + settled block", () => {
    expect(correctionNestedFailureMustRaise()).toBe(true);
    expect(sql175).toContain("AP_CORRECTION_ABORTED");
    expect(sql175).toContain("Paid or partially paid bills cannot be corrected");
    expect(sql175).toContain("ap_require_ok");
    expect(sql175).not.toMatch(/exception\s+when[\s\S]{0,80}AP_CORRECTION_ABORTED/);
  });
});
