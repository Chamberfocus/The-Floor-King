/**
 * F4 final security + economic-date integrity (mirrors unapplied 0163).
 */
import { describe, expect, it } from "vitest";
import {
  expectedAuthenticatedExecuteGrant,
  F4_SECURITY_DEFINER_FUNCTIONS,
  mayAdminRetryOutbox,
  mayDirectExecuteClaim,
  mayDirectExecuteEnqueue,
  opsRpcMayEnqueueInternally,
  requiresFixedSearchPath,
} from "@/lib/accounting/outbox-security";
import {
  assessEnqueueEconomicDate,
  creditApplicationEconomicDate,
  economicDatePolicySummary,
  paymentEconomicDate,
  paymentVoidEconomicDate,
  refundEconomicDate,
  validateEconomicEventDate,
} from "@/lib/accounting/economic-date";
import { decideOutboxProcess } from "@/lib/accounting/outbox-processor";
import { buildPaymentOutboxSnapshot } from "@/lib/accounting/outbox-rebuild";
import type { EventFlagSettings } from "@/lib/accounting/event-status";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const flagsOn: EventFlagSettings = {
  posting_enabled: true,
  invoice_posting_enabled: false,
  payment_posting_enabled: true,
  credit_posting_enabled: true,
  ap_posting_enabled: false,
  expense_posting_enabled: false,
  deposit_posting_enabled: false,
  installer_posting_enabled: false,
  inventory_posting_enabled: false,
  cutover_date: "2026-10-01",
};

describe("F4 SECURITY DEFINER grants (1–10)", () => {
  it("1–2. non-admin cannot manufacture enqueue or claim freely", () => {
    expect(mayDirectExecuteEnqueue("authenticated")).toBe(false);
    expect(mayDirectExecuteEnqueue("anon")).toBe(false);
    expect(
      mayDirectExecuteClaim({
        dbRole: "authenticated",
        appRole: "crew",
        hasAuthUid: true,
      }),
    ).toBe(false);
    expect(
      mayDirectExecuteClaim({
        dbRole: "authenticated",
        appRole: "customer",
        hasAuthUid: true,
      }),
    ).toBe(false);
    expect(
      mayDirectExecuteClaim({
        dbRole: "authenticated",
        appRole: "sales",
        hasAuthUid: true,
      }),
    ).toBe(false);
  });

  it("3. admin retry uses service processor (claim is service_role only after 0169)", () => {
    expect(mayAdminRetryOutbox("admin")).toBe(true);
    expect(mayAdminRetryOutbox("office")).toBe(true);
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

  it("4–7. ops RPCs enqueue internally without client EXECUTE on enqueue", () => {
    expect(
      opsRpcMayEnqueueInternally({
        callerIsSecurityDefinerOwner: true,
        enqueueGrantedToAuthenticated: false,
      }),
    ).toBe(true);
    expect(expectedAuthenticatedExecuteGrant("enqueue_accounting_outbox_safe")).toBe(
      "revoked",
    );
    for (const fn of [
      "record_invoice_payment_safe",
      "void_invoice_payment_safe",
      "apply_credit_to_invoice_safe",
      "record_refund_safe",
    ] as const) {
      expect(expectedAuthenticatedExecuteGrant(fn)).toBe("granted_ops");
    }
  });

  it("8. future processor path viable via service_role", () => {
    expect(mayDirectExecuteClaim({
      dbRole: "service_role",
      appRole: null,
      hasAuthUid: false,
    })).toBe(true);
    expect(mayDirectExecuteEnqueue("service_role")).toBe(true);
  });

  it("9–10. fixed search_path + SQL migration grant audit", () => {
    for (const fn of F4_SECURITY_DEFINER_FUNCTIONS) {
      expect(requiresFixedSearchPath(fn)).toBe(true);
    }
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/0163_f4_integration_mappings_outbox.sql"),
      "utf8",
    );
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain(
      "revoke all on function public.enqueue_accounting_outbox_safe from authenticated",
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.enqueue_accounting_outbox_safe to authenticated/i,
    );
    expect(sql).toContain("ACCOUNTING_INVALID_ECONOMIC_DATE");
    // No silent today fallback in enqueue
    expect(sql).not.toContain(
      "if v_econ is null then\n    v_econ := (timezone('utc', now()))::date",
    );
    expect(sql).toContain("ACCOUNTING_INVALID_ECONOMIC_DATE");
    // claim requires is_staff when auth.uid present
    expect(sql).toContain("not public.is_staff()");
    expect(expectedAuthenticatedExecuteGrant("claim_accounting_outbox_item")).toBe(
      "revoked",
    );
  });
});

describe("F4 economic date integrity (11–20)", () => {
  it("11. posting disabled + missing date → skip, no outbox", () => {
    expect(
      assessEnqueueEconomicDate({
        postingEnabled: false,
        eventPilotEnabled: true,
        economicEventDate: null,
        processingDate: "2026-10-15",
      }).action,
    ).toBe("skip_no_outbox");
  });

  it("12–13. posting on + missing/malformed date cannot become pending/today", () => {
    const missing = assessEnqueueEconomicDate({
      postingEnabled: true,
      eventPilotEnabled: true,
      economicEventDate: null,
      processingDate: "2026-10-15",
    });
    expect(missing.action).toBe("reject");
    if (missing.action === "reject") {
      expect(missing.code).toBe("ACCOUNTING_INVALID_ECONOMIC_DATE");
    }
    const bad = validateEconomicEventDate("not-a-date");
    expect(bad.ok).toBe(false);
    const empty = validateEconomicEventDate("");
    expect(empty.ok).toBe(false);
    // Must not equal processing today
    expect(validateEconomicEventDate(null).ok).toBe(false);
  });

  it("14–17. four guaranteed event date policies", () => {
    expect(paymentEconomicDate("2026-10-05")).toBe("2026-10-05");
    expect(economicDatePolicySummary("payment")).toBe("paid_at");
    expect(refundEconomicDate("2026-10-08")).toBe("2026-10-08");
    expect(economicDatePolicySummary("refund")).toBe("refunded_at");
    expect(creditApplicationEconomicDate("2026-10-09")).toBe("2026-10-09");
    expect(economicDatePolicySummary("credit_application")).toContain(
      "application_authorization",
    );
    expect(paymentVoidEconomicDate("2026-10-10")).toBe("2026-10-10");
    expect(economicDatePolicySummary("payment_void")).toContain(
      "not_original_paid_at",
    );
  });

  it("18–20. cutover/retry/closed period use economic date, not processing", () => {
    const snap = buildPaymentOutboxSnapshot({
      paymentId: "p1",
      invoiceId: "i1",
      amount: 100,
      economicEventDate: "2026-09-30",
      paymentMethod: "card",
      cashAccountId: "uf",
      arAccountId: "ar",
    });
    const pre = decideOutboxProcess({
      status: "pending",
      attemptCount: 3,
      maxAttempts: 8,
      payload: snap,
      existingJournalId: null,
      periodStatus: "open",
      flags: flagsOn,
      now: new Date("2026-10-20T12:00:00Z"),
    });
    expect(pre.action).toBe("skip_legacy");

    const closed = decideOutboxProcess({
      status: "pending",
      attemptCount: 1,
      maxAttempts: 8,
      payload: {
        ...snap,
        economicEventDate: "2026-10-02",
      },
      existingJournalId: null,
      periodStatus: "closed",
      flags: flagsOn,
      now: new Date("2026-11-01T12:00:00Z"),
    });
    expect(closed.action).toBe("review_required");
    if (closed.action === "review_required") {
      expect(closed.message).toContain("2026-10-02");
      expect(closed.message).not.toContain("2026-11-01");
    }

    // Retry does not mutate snapshot economic date
    expect(snap.economicEventDate).toBe("2026-09-30");
  });
});
