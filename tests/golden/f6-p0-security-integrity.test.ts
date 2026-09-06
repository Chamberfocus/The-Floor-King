/**
 * F6-P0 — legacy money RPC security, payment/credit balance, deposit semantics.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyRequestIdentity,
  mayInvokeLegacyMoneyRpc,
  mayInvokeF5Rpc,
  resolveAccountingActorId,
  rolesAllowedForLegacyMoneyRpc,
  expectedExecuteGrantAfter0169,
  type FloorKingRole,
} from "@/lib/accounting/f5-rpc-auth";
import { mayDirectExecuteClaim } from "@/lib/accounting/outbox-security";
import {
  assessPaymentAmount,
  invoiceRemainingBalance,
  resolveIdempotencyReplay,
} from "@/lib/payment-safety";
import { classifyPaymentForAccounting } from "@/lib/accounting/deposit-classify";
import { invoiceTotals } from "@/lib/invoice-calc";

const ROOT = join(process.cwd());
const sql169 = readFileSync(
  join(ROOT, "supabase/migrations/0169_f6_p0_money_security_integrity.sql"),
  "utf8",
);

function auth(role: FloorKingRole) {
  return classifyRequestIdentity({
    jwtRole: "authenticated",
    authUid: "user-1",
    appRole: role,
  });
}

describe("F6-P0 migration 0169 markers", () => {
  it("includes credit-aware payment balance", () => {
    expect(sql169).toContain("invoice_applied_credits");
    expect(sql169).toContain("v_credited");
    expect(sql169).toMatch(/v_total - v_paid - v_credited/);
  });

  it("rejects zero-total invoice payments", () => {
    expect(sql169).toContain("record_customer_deposit_safe for pre-invoice");
  });

  it("hardens legacy RPCs with accounting_require_roles", () => {
    expect(sql169).toContain("record invoice payments");
    expect(sql169).toContain("void invoice payments");
    expect(sql169).toContain("apply credits to invoices");
    expect(sql169).toContain("record refunds");
    expect(sql169).toContain("post journal entries");
  });

  it("claim is service_role only", () => {
    expect(sql169).toContain("claim_accounting_outbox_item is service_role only");
    expect(sql169).toContain("accounting_is_service_role()");
  });

  it("extends deposit recording to sales roles", () => {
    expect(sql169).toContain("'record customer deposits'");
    expect(sql169).toContain("'sales_manager', 'salesman'");
  });

  it("ACL revokes anon on legacy money RPCs", () => {
    expect(sql169).toContain("record_invoice_payment_safe");
    expect(sql169).toContain("revoke all on function %s from anon");
  });
});

describe("F6-P0 payment balance (canonical formula)", () => {
  const items = [{ quantity: 1, rate: 1000 }];

  it("1000 total, 300 paid, 200 credit → 500 remaining", () => {
    const remaining = invoiceRemainingBalance(items, 0, [{ amount: 300 }], 200);
    expect(remaining).toBe(500);
    expect(assessPaymentAmount({ amount: 501, remainingBalance: remaining }).ok).toBe(
      false,
    );
    expect(assessPaymentAmount({ amount: 500, remainingBalance: remaining }).ok).toBe(
      true,
    );
  });

  it("voided payments do not reduce balance", () => {
    const remaining = invoiceRemainingBalance(
      items,
      0,
      [
        { amount: 300, status: "active" },
        { amount: 100, status: "void" },
      ],
      0,
    );
    expect(remaining).toBe(700);
  });

  it("applied credits reduce collectible balance", () => {
    expect(invoiceRemainingBalance(items, 0, [], 200)).toBe(800);
    expect(invoiceRemainingBalance(items, 0, [], 1000)).toBe(0);
  });
});

describe("F6-P0 deposit classification", () => {
  it("pre-invoice card collection is deposit not AR", () => {
    const r = classifyPaymentForAccounting({
      hasIssuedInvoiceWithPositiveTotal: false,
      blankZeroInvoice: false,
      explicitPreInvoiceDeposit: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.classification).toBe("pre_invoice_deposit");
  });

  it("blank zero invoice remains ambiguous (legacy)", () => {
    const r = classifyPaymentForAccounting({
      hasIssuedInvoiceWithPositiveTotal: false,
      blankZeroInvoice: true,
      explicitPreInvoiceDeposit: false,
    });
    expect(r.ok).toBe(false);
  });
});

describe("F6-P0 SECURITY DEFINER role matrix", () => {
  const moneyRoles: FloorKingRole[] = [
    "admin",
    "office",
    "sales_manager",
    "salesman",
    "scheduler",
    "crew",
    "warehouse",
    "customer",
  ];

  it("anon blocked from all legacy money RPCs", () => {
    const anon = classifyRequestIdentity({ jwtRole: "anon", authUid: null });
    for (const rpc of [
      "record_invoice_payment_safe",
      "void_invoice_payment_safe",
      "apply_credit_to_invoice_safe",
      "record_refund_safe",
      "post_journal_entry_safe",
      "claim_accounting_outbox_item",
    ] as const) {
      expect(mayInvokeLegacyMoneyRpc({ rpc, identity: anon }).allowed).toBe(false);
    }
  });

  it("customer/crew blocked from money mutations", () => {
    for (const role of ["customer", "crew", "warehouse", "scheduler"] as FloorKingRole[]) {
      const id = auth(role);
      expect(
        mayInvokeLegacyMoneyRpc({
          rpc: "record_invoice_payment_safe",
          identity: id,
        }).allowed,
      ).toBe(false);
      expect(
        mayInvokeLegacyMoneyRpc({
          rpc: "post_journal_entry_safe",
          identity: id,
        }).allowed,
      ).toBe(false);
    }
  });

  it("salesman may record payments but not post journals or claim outbox", () => {
    const id = auth("salesman");
    expect(
      mayInvokeLegacyMoneyRpc({
        rpc: "record_invoice_payment_safe",
        identity: id,
      }).allowed,
    ).toBe(true);
    expect(
      mayInvokeLegacyMoneyRpc({
        rpc: "void_invoice_payment_safe",
        identity: id,
      }).allowed,
    ).toBe(false);
    expect(
      mayInvokeLegacyMoneyRpc({
        rpc: "post_journal_entry_safe",
        identity: id,
      }).allowed,
    ).toBe(false);
    expect(
      mayInvokeLegacyMoneyRpc({
        rpc: "claim_accounting_outbox_item",
        identity: id,
      }).allowed,
    ).toBe(false);
  });

  it("office may void payments; admin may post journals", () => {
    expect(
      mayInvokeLegacyMoneyRpc({
        rpc: "void_invoice_payment_safe",
        identity: auth("office"),
      }).allowed,
    ).toBe(true);
    expect(
      mayInvokeLegacyMoneyRpc({
        rpc: "post_journal_entry_safe",
        identity: auth("admin"),
      }).allowed,
    ).toBe(true);
    expect(
      mayInvokeLegacyMoneyRpc({
        rpc: "post_journal_entry_safe",
        identity: auth("office"),
      }).allowed,
    ).toBe(false);
  });

  it("service_role may claim outbox and post journals", () => {
    const svc = classifyRequestIdentity({
      jwtRole: "service_role",
      authUid: null,
    });
    expect(
      mayInvokeLegacyMoneyRpc({
        rpc: "claim_accounting_outbox_item",
        identity: svc,
      }).allowed,
    ).toBe(true);
    expect(
      mayInvokeLegacyMoneyRpc({
        rpc: "post_journal_entry_safe",
        identity: svc,
      }).allowed,
    ).toBe(true);
  });

  it("salesman may record customer deposits (F6-P0 UX)", () => {
    expect(
      mayInvokeF5Rpc({
        rpc: "record_customer_deposit_safe",
        identity: auth("salesman"),
      }).allowed,
    ).toBe(true);
  });

  it("claim ACL is service_role only", () => {
    expect(
      mayDirectExecuteClaim({
        dbRole: "authenticated",
        appRole: "admin",
        hasAuthUid: true,
      }),
    ).toBe(false);
    expect(
      mayDirectExecuteClaim({
        dbRole: "service_role",
        appRole: null,
        hasAuthUid: false,
      }),
    ).toBe(true);
  });
});

describe("F6-P0 actor spoofing", () => {
  it("authenticated wins over claimed UUID", () => {
    const r = resolveAccountingActorId({
      identity: auth("office"),
      claimed: "spoof-uuid",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.actorId).toBe("auth.uid");
  });

  it("anon cannot resolve actor", () => {
    expect(
      resolveAccountingActorId({
        identity: classifyRequestIdentity({ jwtRole: "anon", authUid: null }),
        claimed: "spoof",
      }).ok,
    ).toBe(false);
  });

  it("service_role may use claimed actor", () => {
    const r = resolveAccountingActorId({
      identity: classifyRequestIdentity({
        jwtRole: "service_role",
        authUid: null,
      }),
      claimed: "automation-actor",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.actorId).toBe("automation-actor");
  });

  it("SQL uses accounting_actor_id for payments", () => {
    expect(sql169).toMatch(/record_invoice_payment_safe[\s\S]*accounting_actor_id/);
    expect(sql169).toMatch(/void_invoice_payment_safe[\s\S]*accounting_actor_id/);
  });
});

describe("F6-P0 app path guards", () => {
  it("carry-over uses safe payment RPC not direct insert", () => {
    const carry = readFileSync(
      join(ROOT, "src/app/(app)/carry-over/actions.ts"),
      "utf8",
    );
    expect(carry).toContain("record_invoice_payment_safe");
    expect(carry).not.toMatch(/from\(['"]payments['"]\)\.insert/);
  });

  it("recordCardPayment uses deposit RPC when no open invoice", () => {
    const inv = readFileSync(
      join(ROOT, "src/app/(app)/invoices/actions.ts"),
      "utf8",
    );
    expect(inv).toContain("record_customer_deposit_safe");
    expect(inv).not.toMatch(/allowDepositOnZeroTotal:\s*true/);
  });
});

describe("F6-P0 execute grants", () => {
  it("claim is service_role_only after 0169", () => {
    expect(expectedExecuteGrantAfter0169("claim_accounting_outbox_item")).toBe(
      "service_role_only",
    );
    expect(rolesAllowedForLegacyMoneyRpc("claim_accounting_outbox_item")).toBe(
      "service_role_only",
    );
  });
});

describe("FINAL 0169 owner review fixes", () => {
  const discountItems = [
    { quantity: 40, rate: 30 },
    { quantity: 1, rate: -100 },
  ];

  it("canonical invoice total parity — discount line before tax (matches invoice-calc.ts)", () => {
    const ts = invoiceTotals(discountItems, 8, 0);
    expect(ts.subtotal).toBe(1100);
    expect(ts.tax).toBe(88);
    expect(ts.total).toBe(1188);

    expect(sql169).toContain("invoice_commercial_total");
    expect(sql169).toMatch(
      /coalesce\(sum\(coalesce\(quantity, 0\) \* coalesce\(rate, 0\)\), 0\) as subtotal/,
    );
    expect(sql169).toMatch(
      /l\.subtotal \* \(i\.tax_rate \/ 100\.0\)/,
    );
    expect(sql169).toMatch(
      /from public\.invoice_commercial_total\(p_invoice_id\)/,
    );
  });

  it("payment/credit balance parity uses commercial total minus paid minus credits", () => {
    const remaining = invoiceRemainingBalance(discountItems, 8, [], 200);
    expect(remaining).toBe(988);
    expect(sql169).toMatch(/v_total - v_paid - v_credited/);
    expect(sql169).toContain("invoice_applied_credits");
  });

  it("post-lock idempotency recheck occurs after SELECT ... FOR UPDATE", () => {
    const fn = sql169.match(
      /create or replace function public\.record_invoice_payment_safe[\s\S]*?^\$\$;/m,
    )?.[0];
    expect(fn).toBeTruthy();
    const forUpdate = fn!.indexOf("for update");
    const postLock = fn!.indexOf("Post-lock idempotency recheck");
    expect(forUpdate).toBeGreaterThan(-1);
    expect(postLock).toBeGreaterThan(forUpdate);
  });

  it("cross-invoice idempotency key collision is blocked", () => {
    expect(sql169).toContain("IDEMPOTENCY_CROSS_INVOICE");
    const r = resolveIdempotencyReplay({
      key: "k1",
      targetInvoiceId: "inv-b",
      existing: { paymentId: "pay-1", invoiceId: "inv-a", key: "k1" },
    });
    expect(r).toEqual({ action: "reject", code: "IDEMPOTENCY_CROSS_INVOICE" });
  });

  it("same-key same-invoice retries converge to duplicate", () => {
    const r = resolveIdempotencyReplay({
      key: "k1",
      targetInvoiceId: "inv-a",
      existing: { paymentId: "pay-1", invoiceId: "inv-a", key: "k1" },
    });
    expect(r).toEqual({ action: "duplicate", paymentId: "pay-1" });
  });

  it("concurrent same-key payment — second request is duplicate not second insert", () => {
    const first = resolveIdempotencyReplay({
      key: "race-key",
      targetInvoiceId: "inv-1",
      existing: null,
    });
    expect(first).toEqual({ action: "proceed" });

    const second = resolveIdempotencyReplay({
      key: "race-key",
      targetInvoiceId: "inv-1",
      existing: { paymentId: "pay-winner", invoiceId: "inv-1", key: "race-key" },
    });
    expect(second).toEqual({ action: "duplicate", paymentId: "pay-winner" });
  });
});
