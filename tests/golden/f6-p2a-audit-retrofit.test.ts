/**
 * F6-P2A — financial audit retrofit golden/security tests.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUDIT_IDEMPOTENCY_PATTERNS,
  FINANCIAL_AUDIT_ACTIONS,
  FINANCIAL_AUDIT_ACTION_LABELS,
} from "@/lib/accounting/audit-log";
import {
  classifyRequestIdentity,
  expectedExecuteGrantAfter0171,
  mayInvokeF6P1InternalRpc,
  mayInvokeF6P2ARpc,
  resolveAccountingActorId,
} from "@/lib/accounting/f5-rpc-auth";
import {
  assessPaymentAmount,
  invoiceRemainingBalance,
  resolveIdempotencyReplay,
} from "@/lib/payment-safety";
import {
  assessOpenArConsumption,
  invoiceOpenArBalance,
  resolveCrossEntityIdempotency,
  simulateConcurrentArReductions,
} from "@/lib/accounting/open-ar";
import { invoiceTotals } from "@/lib/invoice-calc";
import { assessWriteOffAmount } from "@/lib/accounting/write-off";

const ROOT = join(process.cwd());
const sql171 = readFileSync(
  join(ROOT, "supabase/migrations/0171_f6_p2a_audit_retrofit.sql"),
  "utf8",
);
const sql170 = readFileSync(
  join(ROOT, "supabase/migrations/0170_f6_p1_books_readiness.sql"),
  "utf8",
);

const RETROFIT_RPCS = [
  "record_invoice_payment_safe",
  "void_invoice_payment_safe",
  "apply_credit_to_invoice_safe",
  "record_refund_safe",
  "void_refund_safe",
  "issue_credit_memo_safe",
  "void_credit_memo_safe",
  "finalize_invoice_safe",
  "void_invoice_safe",
  "post_vendor_bill_safe",
  "record_bill_payment_safe",
  "void_bill_payment_safe",
  "record_direct_expense_safe",
  "record_customer_deposit_safe",
  "apply_customer_deposit_safe",
  "void_customer_deposit_safe",
  "complete_bank_reconciliation_safe",
  "post_journal_entry_safe",
] as const;

const ALREADY_AUDITED_0170 = [
  "write_off_invoice_safe",
  "confirm_backup_pitr_safe",
  "stage_bank_statement_import_safe",
] as const;

describe("F6-P2A migration 0171 markers", () => {
  it("defines accounting_audit_from_definer_safe wrapper", () => {
    expect(sql171).toContain("accounting_audit_from_definer_safe");
    expect(sql171).toContain("app.trusted_definer_audit");
    expect(sql171).toContain("log_financial_audit_safe");
  });

  it("internal audit helpers are service_role only", () => {
    expect(sql171).toContain(
      "revoke all on function public.accounting_audit_from_definer_safe",
    );
    expect(sql171).toMatch(
      /revoke all on function public\.accounting_audit_from_definer_safe[\s\S]*from authenticated/,
    );
    expect(sql171).toContain("'accounting_audit_from_definer_safe'");
    expect(sql171).toContain("'log_financial_audit_safe'");
  });

  it("retrofits all 18 money RPCs with audit calls", () => {
    for (const rpc of RETROFIT_RPCS) {
      expect(sql171).toContain(`-- ${rpc} (F6-P2A audit retrofit)`);
      const section = sql171.slice(
        sql171.indexOf(`-- ${rpc} (F6-P2A audit retrofit)`),
      );
      expect(section).toContain("accounting_audit_from_definer_safe");
    }
  });

  it("does not modify 0170-applied migrations", () => {
    expect(sql170).toContain("financial_audit_log");
    expect(sql171).not.toContain("drop table if exists public.financial_audit_log");
    expect(sql171).not.toMatch(
      /update\s+public\.accounting_settings/i,
    );
    expect(sql171).not.toMatch(/books_of_record\s*=\s*true/i);
    expect(sql171).not.toMatch(/posting_enabled\s*=\s*true/i);
    expect(sql171).not.toMatch(/opening_balances_entered\s*=\s*true/i);
  });

  it("payment audit runs after both enqueue branches", () => {
    const paySection = sql171.slice(
      sql171.indexOf("-- record_invoice_payment_safe"),
      sql171.indexOf("-- void_invoice_payment_safe"),
    );
    expect(paySection).toMatch(
      /if v_cash is null or v_ar is null then[\s\S]*else[\s\S]*end if;[\s\S]*accounting_audit_from_definer_safe[\s\S]*'invoice_payment_recorded'/,
    );
  });

  it("uses stable audit action names", () => {
    expect(sql171).toContain("'invoice_payment_recorded'");
    expect(sql171).toContain("'credit_applied'");
    expect(sql171).toContain("'refund_recorded'");
    expect(sql171).toContain("'customer_deposit_recorded'");
    expect(sql170).toContain("'invoice_write_off'");
  });

  it("audit idempotency keys are entity-scoped", () => {
    expect(sql171).toContain("'audit:payment:' || v_pay_id::text");
    expect(sql171).toContain("'audit:credit_apply:' || v_app_id::text");
    expect(sql171).toContain("'audit:refund:' || v_refund_id::text");
    expect(sql171).toContain("'audit:deposit:' || v_dep_id::text");
    expect(sql171).toContain("'audit:journal:' || v_entry_id::text");
  });

  it("audit wrapper clears trusted flag on exception", () => {
    expect(sql171).toMatch(
      /exception[\s\S]*perform set_config\('app\.trusted_definer_audit', 'false', true\);[\s\S]*raise;/,
    );
  });

  it("re-asserts SECURITY DEFINER search_path on money RPCs", () => {
    for (const rpc of RETROFIT_RPCS.slice(0, 4)) {
      const section = sql171.slice(
        sql171.indexOf(`create or replace function public.${rpc}`),
        sql171.indexOf(`create or replace function public.${rpc}`) + 800,
      );
      expect(section).toContain("security definer");
      expect(section).toContain("set search_path = public");
    }
  });
});

describe("F6-P2A audit action registry", () => {
  it("labels cover all registered actions", () => {
    for (const action of FINANCIAL_AUDIT_ACTIONS) {
      expect(FINANCIAL_AUDIT_ACTION_LABELS[action]).toBeTruthy();
    }
  });

  it("idempotency patterns are deterministic per entity", () => {
    expect(AUDIT_IDEMPOTENCY_PATTERNS.payment("pay-1")).toBe(
      "audit:payment:pay-1",
    );
    expect(AUDIT_IDEMPOTENCY_PATTERNS.creditApply("app-1")).toBe(
      "audit:credit_apply:app-1",
    );
    expect(AUDIT_IDEMPOTENCY_PATTERNS.payment("pay-1")).not.toBe(
      AUDIT_IDEMPOTENCY_PATTERNS.creditApply("pay-1"),
    );
  });
});

describe("F6-P2A audit security (TS mirrors SQL)", () => {
  it("authenticated cannot execute log_financial_audit_safe", () => {
    const r = mayInvokeF6P1InternalRpc({
      rpc: "log_financial_audit_safe",
      identity: classifyRequestIdentity({
        jwtRole: "authenticated",
        authUid: "u1",
        appRole: "admin",
      }),
    });
    expect(r.allowed).toBe(false);
  });

  it("authenticated cannot execute accounting_audit_from_definer_safe", () => {
    const r = mayInvokeF6P1InternalRpc({
      rpc: "accounting_audit_from_definer_safe",
      identity: classifyRequestIdentity({
        jwtRole: "authenticated",
        authUid: "u1",
        appRole: "admin",
      }),
    });
    expect(r.allowed).toBe(false);
  });

  it("anon cannot execute internal audit helpers", () => {
    for (const rpc of [
      "log_financial_audit_safe",
      "accounting_audit_from_definer_safe",
    ] as const) {
      const r = mayInvokeF6P1InternalRpc({
        rpc,
        identity: classifyRequestIdentity({ jwtRole: "anon", authUid: null }),
      });
      expect(r.allowed).toBe(false);
    }
  });

  it("service_role may invoke internal audit helpers", () => {
    for (const rpc of [
      "log_financial_audit_safe",
      "accounting_audit_from_definer_safe",
    ] as const) {
      const r = mayInvokeF6P1InternalRpc({
        rpc,
        identity: classifyRequestIdentity({
          jwtRole: "service_role",
          authUid: null,
        }),
      });
      expect(r.allowed).toBe(true);
    }
  });

  it("actor spoofing blocked for untrusted identity", () => {
    const r = resolveAccountingActorId({
      identity: classifyRequestIdentity({ jwtRole: "anon", authUid: null }),
      claimed: "spoofed-uuid",
    });
    expect(r.ok).toBe(false);
  });

  it("internal audit helpers are service_role only in ACL matrix", () => {
    expect(
      expectedExecuteGrantAfter0171("log_financial_audit_safe"),
    ).toBe("service_role_only");
    expect(
      expectedExecuteGrantAfter0171("accounting_audit_from_definer_safe"),
    ).toBe("service_role_only");
    expect(
      expectedExecuteGrantAfter0171("record_invoice_payment_safe"),
    ).toBe("authenticated+service_role");
  });
});

describe("F6-P2A 0170 audit protections preserved", () => {
  it("financial_audit_log blocks direct client mutation", () => {
    expect(sql170).toContain(
      "revoke insert, update, delete on public.financial_audit_log from authenticated",
    );
    expect(sql170).toContain("financial_audit_log_immutable");
  });

  it("0170 RPCs already audited remain in 0170 only", () => {
    for (const rpc of ALREADY_AUDITED_0170) {
      expect(sql170).toContain(rpc);
      expect(sql171).not.toContain(`-- ${rpc} (F6-P2A audit retrofit)`);
    }
  });
});

describe("F6-P2A idempotency + payment safety preserved", () => {
  const items = [{ quantity: 1, rate: 1000 }];

  it("payment retry idempotency does not merge cross-invoice", () => {
    const replay = resolveIdempotencyReplay({
      key: "idem-1",
      targetInvoiceId: "inv-2",
      existing: { paymentId: "pay-a", invoiceId: "inv-1", key: "idem-1" },
    });
    expect(replay).toEqual({
      action: "reject",
      code: "IDEMPOTENCY_CROSS_INVOICE",
    });
  });

  it("same-invoice idempotency replay is duplicate", () => {
    const replay = resolveIdempotencyReplay({
      key: "idem-1",
      targetInvoiceId: "inv-1",
      existing: { paymentId: "pay-a", invoiceId: "inv-1", key: "idem-1" },
    });
    expect(replay).toEqual({ action: "duplicate", paymentId: "pay-a" });
  });

  it("payment concurrency protections unchanged", () => {
    const remaining = invoiceRemainingBalance(items, 0, [{ amount: 400 }], 100);
    expect(remaining).toBe(500);
    expect(assessPaymentAmount({ amount: 501, remainingBalance: remaining }).ok).toBe(
      false,
    );
  });

  it("audit idempotency keys do not reuse payment idempotency keys", () => {
    const paymentKey = "client-key-abc";
    const auditKey = AUDIT_IDEMPOTENCY_PATTERNS.payment("uuid-from-row");
    expect(auditKey).not.toBe(paymentKey);
    expect(auditKey.startsWith("audit:")).toBe(true);
  });
});

describe("F6-P2A accounting activation guard", () => {
  it("0171 does not enable posting or cutover flags", () => {
    expect(sql171).not.toMatch(/update\s+public\.accounting_settings/i);
    const forbiddenAssignments = [
      "books_of_record = true",
      "posting_enabled = true",
      "opening_balances_entered = true",
      "accountant_validated = true",
      "payment_posting_enabled = true",
      "credit_posting_enabled = true",
      "deposit_posting_enabled = true",
    ];
    for (const phrase of forbiddenAssignments) {
      expect(sql171).not.toContain(phrase);
    }
  });
});

describe("F6-P2A canonical open AR integrity", () => {
  const items = [{ quantity: 1, rate: 1000 }];

  it("defines invoice_open_ar_balance + invoice_applied_deposits", () => {
    expect(sql171).toContain("create or replace function public.invoice_open_ar_balance");
    expect(sql171).toContain("create or replace function public.invoice_applied_deposits");
    expect(sql171).toContain("invoice_applied_write_offs");
    expect(sql171).toContain("invoice_applied_credits");
    expect(sql171).toContain("invoice_commercial_total");
  });

  it("payment/credit/deposit/write-off RPCs use canonical open AR", () => {
    expect(sql171).toMatch(
      /record_invoice_payment_safe[\s\S]*v_remaining := public\.invoice_open_ar_balance\(p_invoice_id\)/,
    );
    expect(sql171).toMatch(
      /apply_credit_to_invoice_safe[\s\S]*v_remaining := public\.invoice_open_ar_balance\(p_invoice_id\)/,
    );
    expect(sql171).toMatch(
      /apply_customer_deposit_safe[\s\S]*v_open := public\.invoice_open_ar_balance\(p_invoice_id\)/,
    );
    expect(sql171).toMatch(
      /write_off_invoice_safe[\s\S]*v_remaining := public\.invoice_open_ar_balance\(p_invoice_id\)/,
    );
    expect(sql171).not.toMatch(
      /v_remaining := round\(\(v_total - v_paid - v_credited\)::numeric, 2\)/,
    );
  });

  it("1) combined reductions: pay100 + credit100 + dep200 + wo100 → open AR 500", () => {
    const open = invoiceOpenArBalance({
      items,
      taxRate: 0,
      activePayments: 100,
      activeCredits: 100,
      activeDeposits: 200,
      activeWriteOffs: 100,
    });
    expect(open).toBe(500);
  });

  it("2-5) payment/credit/deposit/write-off cannot exceed $500 open AR", () => {
    const open = 500;
    expect(assessOpenArConsumption({ amount: 501, openAr: open }).ok).toBe(false);
    expect(assessOpenArConsumption({ amount: 500, openAr: open }).ok).toBe(true);
    expect(assessPaymentAmount({ amount: 501, remainingBalance: open }).ok).toBe(false);
    expect(assessWriteOffAmount({ amount: 501, remainingAr: open, reason: "bad debt" }).ok).toBe(
      false,
    );
    expect(assessWriteOffAmount({ amount: 500, remainingAr: open, reason: "bad debt" }).ok).toBe(
      true,
    );
  });

  it("6) after another $500 AR reduction, open AR = 0", () => {
    const after = invoiceOpenArBalance({
      items,
      taxRate: 0,
      activePayments: 600,
      activeCredits: 100,
      activeDeposits: 200,
      activeWriteOffs: 100,
    });
    expect(after).toBe(0);
  });

  it("7-10) zero open AR blocks payment/credit/deposit/write-off", () => {
    const gate = assessOpenArConsumption({ amount: 1, openAr: 0 });
    expect(gate.ok).toBe(false);
    expect(assessPaymentAmount({ amount: 1, remainingBalance: 0 }).ok).toBe(false);
    expect(
      assessWriteOffAmount({ amount: 1, remainingAr: 0, reason: "bad debt" }).ok,
    ).toBe(false);
  });

  it("11) void payment increases open AR", () => {
    const before = invoiceOpenArBalance({
      items,
      taxRate: 0,
      activePayments: 300,
      activeCredits: 0,
      activeDeposits: 0,
      activeWriteOffs: 0,
    });
    const afterVoid = invoiceOpenArBalance({
      items,
      taxRate: 0,
      activePayments: 100,
      activeCredits: 0,
      activeDeposits: 0,
      activeWriteOffs: 0,
    });
    expect(before).toBe(700);
    expect(afterVoid).toBe(900);
  });

  it("12-14) void credit/deposit/write-off increases open AR", () => {
    expect(
      invoiceOpenArBalance({
        items,
        taxRate: 0,
        activePayments: 0,
        activeCredits: 0,
        activeDeposits: 0,
        activeWriteOffs: 0,
      }),
    ).toBe(1000);
    expect(
      invoiceOpenArBalance({
        items,
        taxRate: 0,
        activePayments: 0,
        activeCredits: 150,
        activeDeposits: 0,
        activeWriteOffs: 0,
      }),
    ).toBe(850);
    expect(
      invoiceOpenArBalance({
        items,
        taxRate: 0,
        activePayments: 0,
        activeCredits: 0,
        activeDeposits: 250,
        activeWriteOffs: 0,
      }),
    ).toBe(750);
    expect(
      invoiceOpenArBalance({
        items,
        taxRate: 0,
        activePayments: 0,
        activeCredits: 0,
        activeDeposits: 0,
        activeWriteOffs: 400,
      }),
    ).toBe(600);
  });

  it("15) discount-bearing invoice total still from commercial total", () => {
    const discItems = [
      { quantity: 1, rate: 1000 },
      { quantity: 1, rate: -100 },
    ];
    const total = invoiceTotals(discItems, 0).total;
    expect(total).toBe(900);
    expect(
      invoiceOpenArBalance({
        items: discItems,
        taxRate: 0,
        activePayments: 100,
        activeCredits: 50,
        activeDeposits: 50,
        activeWriteOffs: 100,
      }),
    ).toBe(600);
  });

  it("16) concurrent money ops cannot collectively exceed open AR", () => {
    const sim = simulateConcurrentArReductions(500, [300, 300]);
    expect(sim.accepted).toEqual([300]);
    expect(sim.rejected).toEqual([300]);
    expect(sim.remaining).toBe(200);
  });

  it("17) idempotent retry creates no second economic mutation (model)", () => {
    const first = resolveCrossEntityIdempotency({
      key: "k1",
      existing: null,
      requestedParentKey: "inv-1|memo-1",
    });
    expect(first.action).toBe("proceed");
    const retry = resolveCrossEntityIdempotency({
      key: "k1",
      existing: { id: "app-1", parentKey: "inv-1|memo-1" },
      requestedParentKey: "inv-1|memo-1",
    });
    expect(retry).toEqual({ action: "duplicate", entityId: "app-1" });
  });

  it("18) cross-entity idempotency collision is rejected", () => {
    expect(sql171).toContain("IDEMPOTENCY_CROSS_ENTITY");
    const collision = resolveCrossEntityIdempotency({
      key: "k1",
      existing: { id: "app-1", parentKey: "inv-1|memo-1" },
      requestedParentKey: "inv-2|memo-1",
    });
    expect(collision).toEqual({
      action: "reject",
      code: "IDEMPOTENCY_CROSS_ENTITY",
    });
  });

  it("19) audit remains exactly-once for successful mutation (entity-scoped keys)", () => {
    expect(sql171).toContain("'audit:payment:' || v_pay_id::text");
    expect(sql171).toContain("'audit:credit_apply:' || v_app_id::text");
    expect(sql171).toContain("'audit:deposit_apply:' || v_app_id::text");
    expect(sql171).toContain("'audit:write_off:'");
  });

  it("20) failed over-application creates no success audit path in SQL", () => {
    const pay = sql171.slice(
      sql171.indexOf("-- record_invoice_payment_safe"),
      sql171.indexOf("-- void_invoice_payment_safe"),
    );
    const failIdx = pay.indexOf("Payment exceeds the remaining balance");
    const auditIdx = pay.indexOf("invoice_payment_recorded");
    expect(failIdx).toBeGreaterThan(-1);
    expect(auditIdx).toBeGreaterThan(failIdx);
  });
});

describe("F6-P2A Option A reversal workflows + invoice void guard", () => {
  const items = [{ quantity: 1, rate: 1000 }];

  function section(startMarker: string, endMarker?: string) {
    const start = sql171.indexOf(startMarker);
    const end = endMarker ? sql171.indexOf(endMarker, start + 1) : sql171.length;
    return sql171.slice(start, end === -1 ? undefined : end);
  }

  it("defines all three reversal RPCs", () => {
    expect(sql171).toContain("create or replace function public.void_credit_application_safe");
    expect(sql171).toContain(
      "create or replace function public.void_customer_deposit_application_safe",
    );
    expect(sql171).toContain("create or replace function public.void_invoice_write_off_safe");
  });

  it("credit application: active reduces AR; void restores AR + memo availability model", () => {
    const withCredit = invoiceOpenArBalance({
      items,
      taxRate: 0,
      activeCredits: 200,
    });
    const afterVoid = invoiceOpenArBalance({
      items,
      taxRate: 0,
      activeCredits: 0,
    });
    expect(withCredit).toBe(800);
    expect(afterVoid).toBe(1000);
    const voidSql = section("-- void_credit_application_safe");
    expect(voidSql).toContain("status = 'void'");
    expect(voidSql).toContain("'credit_application_void'");
    expect(voidSql).toContain("'credit_application_voided'");
    expect(voidSql).toContain("audit:credit_application_void:");
    expect(voidSql).toContain("duplicate', true");
    expect(voidSql).toMatch(/credit_applications[\s\S]*for update/);
    expect(voidSql).toMatch(/credit_memos[\s\S]*for update/);
    expect(voidSql).toMatch(/invoices[\s\S]*for update/);
  });

  it("deposit application: void restores AR and recomputes parent deposit status", () => {
    expect(
      invoiceOpenArBalance({ items, taxRate: 0, activeDeposits: 300 }),
    ).toBe(700);
    expect(
      invoiceOpenArBalance({ items, taxRate: 0, activeDeposits: 0 }),
    ).toBe(1000);
    const voidSql = section("-- void_customer_deposit_application_safe");
    expect(voidSql).toContain("status = 'unapplied'");
    expect(voidSql).toContain("applied_invoice_id = null");
    expect(voidSql).toContain("'deposit_apply_void'");
    expect(voidSql).toContain("'deposit_application_voided'");
    expect(voidSql).toContain("audit:deposit_application_void:");
    expect(voidSql).toMatch(/customer_deposit_applications[\s\S]*for update/);
    expect(voidSql).toMatch(/customer_deposits[\s\S]*for update/);
    expect(voidSql).toMatch(/invoices[\s\S]*for update/);
  });

  it("write-off: void restores AR and enqueues bad-debt reversal", () => {
    expect(
      invoiceOpenArBalance({ items, taxRate: 0, activeWriteOffs: 150 }),
    ).toBe(850);
    expect(
      invoiceOpenArBalance({ items, taxRate: 0, activeWriteOffs: 0 }),
    ).toBe(1000);
    const voidSql = section("-- void_invoice_write_off_safe");
    expect(voidSql).toContain("'invoice_write_off_void'");
    expect(voidSql).toContain("'invoice_write_off_voided'");
    expect(voidSql).toContain("audit:write_off_void:");
    expect(voidSql).toContain("Dr AR / Cr bad debt expense");
    expect(voidSql).toMatch(/invoice_write_offs[\s\S]*for update/);
    expect(voidSql).toMatch(/invoices[\s\S]*for update/);
  });

  it("void RPCs are admin/office and ACL-listed", () => {
    expect(mayInvokeF6P2ARpc({
      rpc: "void_credit_application_safe",
      identity: classifyRequestIdentity({
        jwtRole: "authenticated",
        authUid: "u1",
        appRole: "admin",
      }),
    }).allowed).toBe(true);
    expect(mayInvokeF6P2ARpc({
      rpc: "void_invoice_write_off_safe",
      identity: classifyRequestIdentity({
        jwtRole: "authenticated",
        authUid: "u1",
        appRole: "salesman",
      }),
    }).allowed).toBe(false);
    expect(sql171).toContain("'void_credit_application_safe'");
    expect(sql171).toContain("'void_customer_deposit_application_safe'");
    expect(sql171).toContain("'void_invoice_write_off_safe'");
  });

  it("void_invoice_safe blocks all active AR relationships with counts", () => {
    const voidInv = section(
      "create or replace function public.void_invoice_safe(",
      "-- post_vendor_bill_safe",
    );
    expect(voidInv).toContain("active_payments");
    expect(voidInv).toContain("active_credit_applications");
    expect(voidInv).toContain("active_deposit_applications");
    expect(voidInv).toContain("active_write_offs");
    expect(voidInv).toContain(
      "Cannot void invoice with active financial activity. Reverse payments, credits, deposit applications, and write-offs first.",
    );
    expect(voidInv).toContain("from public.payments");
    expect(voidInv).toContain("from public.credit_applications");
    expect(voidInv).toContain("from public.customer_deposit_applications");
    expect(voidInv).toContain("from public.invoice_write_offs");
    expect(voidInv).not.toMatch(/invoice_open_ar_balance/);
  });

  it("invoice with no financial activity may void; audit exactly once / duplicate silent", () => {
    const voidInv = section(
      "create or replace function public.void_invoice_safe(",
      "-- post_vendor_bill_safe",
    );
    expect(voidInv).toContain("duplicate', true");
    expect(voidInv).toContain("'invoice_voided'");
    expect(voidInv).toContain("audit:invoice_void:");
    const auditIdx = voidInv.indexOf("invoice_voided");
    const blockIdx = voidInv.indexOf("active financial activity");
    expect(blockIdx).toBeGreaterThan(-1);
    expect(auditIdx).toBeGreaterThan(blockIdx);
  });

  it("after all AR reductions voided, open AR returns to full and void may proceed", () => {
    expect(
      invoiceOpenArBalance({
        items,
        taxRate: 0,
        activePayments: 0,
        activeCredits: 0,
        activeDeposits: 0,
        activeWriteOffs: 0,
      }),
    ).toBe(1000);
  });

  it("AR consumers and void paths lock invoice for concurrency", () => {
    expect(sql171).toMatch(
      /void_invoice_payment_safe[\s\S]*perform 1 from public\.invoices where id = v_pay\.invoice_id for update/,
    );
    for (const rpc of [
      "record_invoice_payment_safe",
      "apply_credit_to_invoice_safe",
      "apply_customer_deposit_safe",
      "write_off_invoice_safe",
      "void_invoice_safe",
      "void_credit_application_safe",
      "void_customer_deposit_application_safe",
      "void_invoice_write_off_safe",
    ]) {
      const slice = sql171.slice(sql171.indexOf(`create or replace function public.${rpc}`));
      expect(slice.slice(0, 2500)).toMatch(/invoices[\s\S]*for update|invoice_id for update/i);
    }
  });

  it("duplicate void creates no second audit (entity-scoped audit key)", () => {
    expect(sql171).toContain("audit:credit_application_void:");
    expect(sql171).toContain("audit:deposit_application_void:");
    expect(sql171).toContain("audit:write_off_void:");
    // duplicate returns before audit perform
    const creditVoid = section("-- void_credit_application_safe", "-- void_customer_deposit_application_safe");
    const dupIdx = creditVoid.indexOf("duplicate', true");
    const auditIdx = creditVoid.indexOf("credit_application_voided");
    expect(dupIdx).toBeGreaterThan(-1);
    expect(auditIdx).toBeGreaterThan(dupIdx);
  });

  it("enqueue recognizes reversal + write-off event kinds", () => {
    expect(sql171).toContain("'credit_application_void'");
    expect(sql171).toContain("'deposit_apply_void'");
    expect(sql171).toContain("'invoice_write_off_void'");
    expect(sql171).toContain("'invoice_write_off'");
  });
});
