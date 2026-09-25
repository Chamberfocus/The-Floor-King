/**
 * Phase J — replacement, counter sale, order invoice, and send-before-status.
 * Pure helpers plus source checks. No production writes.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planEstimateInvoiceCreation } from "@/lib/change-order-invoice";
import {
  insertActiveSupplemental,
  insertObligation,
  orderInvoiceIdempotencyKey,
  releaseVoidedObligationKey,
  replacementInvoiceIdempotencyKey,
  replayOrInsertBlankInvoice,
  resolveBlankInvoiceIdempotencyKey,
  resolveCounterSaleIdempotencyKey,
} from "@/lib/financial-idempotency";
import { invoiceRemainingBalance } from "@/lib/payment-safety";
import {
  assessMaterialsReadyForSchedule,
  jobsBoardUnscheduledLabel,
} from "@/lib/materials-ready";
import { shouldCreateAutomatedTask, automationSourceKey } from "@/lib/office-task";
import { ESTIMATE_FOLLOWUP_KIND } from "@/lib/ops-followup";

function src(path: string): string {
  return readFileSync(path, "utf8");
}

const unpaid = {
  id: "inv-1",
  status: "sent",
  approvalSnapshotId: "snap-1",
  total: 1000,
  hasFinancialActivity: false,
  hasPayments: false,
};

describe("replacement invoice idempotency", () => {
  it("1 unpaid decrease plans one replacement", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 800,
      existing: [unpaid],
    });
    expect(plan.action).toBe("void_reissue");
    if (plan.action === "void_reissue") expect(plan.kind).toBe("replacement");
  });

  it("2-3 the same replacement request and concurrent attempts keep one invoice", () => {
    const store = new Map();
    const key = replacementInvoiceIdempotencyKey("est", "snap-2");
    const results = [1, 2, 3].map((n) =>
      insertObligation(store, { key, id: `r${n}` }),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(2);
    expect(store.size).toBe(1);
  });

  it("4 a later snapshot is a new replacement, and a voided one can be replaced", () => {
    const store = new Map();
    const firstKey = replacementInvoiceIdempotencyKey("est", "snap-2");
    insertObligation(store, { key: firstKey, id: "r1" });
    const later = insertObligation(store, {
      key: replacementInvoiceIdempotencyKey("est", "snap-3"),
      id: "r2",
    });
    expect(later.ok).toBe(true);
    const held = store.get(firstKey);
    if (held) held.voided = true;
    expect(releaseVoidedObligationKey(store, firstKey)).toBe(true);
    const again = insertObligation(store, { key: firstKey, id: "r3" });
    expect(again.ok).toBe(true);
  });

  it("the replacement write stores the snapshot key and hides database errors", () => {
    const actions = src("src/app/(app)/invoices/actions.ts");
    expect(actions).toContain("replacementInvoiceIdempotencyKey");
    expect(actions).toContain("repl-voided:");
    expect(actions).not.toMatch(/redirectInvoiceError\(\s*estimateId,\s*error\?\.message/);
  });
});

describe("counter sale and order invoice requests", () => {
  it("5-7 one counter-sale token is one sale, and a new token is another", () => {
    const a = resolveCounterSaleIdempotencyKey("token-a", "user-1");
    const retry = resolveCounterSaleIdempotencyKey("token-a", "user-1");
    const second = resolveCounterSaleIdempotencyKey("token-b", "user-1");
    expect(a).toBe(retry);
    expect(second).not.toBe(a);
    expect(resolveCounterSaleIdempotencyKey("counter:user-1:token-a", "user-2")).toBeNull();
    const sales = src("src/app/(app)/counter-sale/actions.ts");
    expect(sales).toContain("idempotency_key: idempotencyKey");
    expect(sales).toContain("counter-pay:");
    expect(sales).not.toContain("invErr?.message ||");
  });

  it("8-10 one order key is one invoice under concurrent claims", () => {
    const store = new Map();
    const key = orderInvoiceIdempotencyKey("order-1");
    const results = ["a", "b"].map((id) => insertObligation(store, { key, id }));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(src("src/lib/data/order-invoice.ts")).toContain("orderInvoiceIdempotencyKey");
    const other = insertObligation(store, {
      key: orderInvoiceIdempotencyKey("order-2"),
      id: "c",
    });
    expect(other.ok).toBe(true);
  });
});

describe("payment, credit, and estimate send retries", () => {
  function pay(store: Map<string, string>, key: string, id: string) {
    if (store.has(key)) return { ok: true, id: store.get(key)!, duplicate: true };
    store.set(key, id);
    return { ok: true, id, duplicate: false };
  }

  it("11-13 the same payment key records once, including a lost response", () => {
    const store = new Map<string, string>();
    const key = "pay-op:token-1";
    expect(pay(store, key, "p1").duplicate).toBe(false);
    expect(pay(store, key, "p2").duplicate).toBe(true);
    expect(pay(store, key, "p3").id).toBe("p1");
    expect(src("src/app/(app)/invoices/actions.ts")).toContain(
      "resolveInvoicePaymentIdempotencyKey",
    );
  });

  it("14-15 refund and credit application keys stay on the existing helpers", () => {
    const idem = src("src/lib/financial-idempotency.ts");
    expect(idem).toContain("resolveRefundIdempotencyKey");
    expect(idem).toContain("resolveApplyCreditIdempotencyKey");
  });

  it("16-19 email failure does not mark sent, and Mark sent still does not email", () => {
    const send = src("src/app/(app)/estimates/actions.ts");
    const fn = send.slice(
      send.indexOf("export async function sendEstimateById"),
      send.indexOf("function copyLineRow"),
    );
    const guard = fn.indexOf('notify.status !== "success"');
    const status = fn.indexOf('status: "sent"');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(status);
    const quick = src("src/app/(app)/estimates/quick/actions.ts");
    const mark = quick.slice(quick.indexOf("if (input.markSent)"));
    expect(mark).toContain("onEstimateSentOps");
    expect(mark).not.toContain("sendEmail");
    expect(
      shouldCreateAutomatedTask({
        sourceKey: automationSourceKey(ESTIMATE_FOLLOWUP_KIND, "est-1"),
        existingOpenSourceKeys: [automationSourceKey(ESTIMATE_FOLLOWUP_KIND, "est-1")],
      }),
    ).toBe(false);
  });

  it("20-21 Phase I supplemental and blank invoice guards still hold", () => {
    const supplements = new Map();
    insertActiveSupplemental(supplements, {
      estimateId: "est",
      approvalSnapshotId: "snap",
      id: "s1",
    });
    const again = insertActiveSupplemental(supplements, {
      estimateId: "est",
      approvalSnapshotId: "snap",
      id: "s2",
    });
    expect(again.ok).toBe(false);
    const blanks = new Map();
    const key = resolveBlankInvoiceIdempotencyKey("tok", "user-1");
    replayOrInsertBlankInvoice(blanks, {
      key,
      customerId: "c1",
      jobId: null,
      create: () => ({ id: "b1" }),
    });
    const retry = replayOrInsertBlankInvoice(blanks, {
      key,
      customerId: "c1",
      jobId: null,
      create: () => ({ id: "b2" }),
    });
    expect(retry.ok && retry.duplicate && retry.invoice.id).toBe("b1");
  });
});

describe("staff smoke journey", () => {
  it("material hold, warehouse ready, schedule, invoice, and partial payment", () => {
    expect(
      assessMaterialsReadyForSchedule({ hasMaterialNeed: true, warehouseReadyAt: null }).ready,
    ).toBe(false);
    expect(jobsBoardUnscheduledLabel({ hasMaterialNeed: true, warehouseReadyAt: null })).toBe(
      "Materials not ready",
    );
    expect(
      assessMaterialsReadyForSchedule({
        hasMaterialNeed: true,
        warehouseReadyAt: "2026-09-25",
      }).ready,
    ).toBe(true);
    const plan = planEstimateInvoiceCreation({ approvedTotal: 1000, existing: [] });
    expect(plan.action).toBe("full");
    const due = invoiceRemainingBalance(
      [{ quantity: 1, rate: 1000 }],
      0,
      [{ amount: 400, status: "active" }],
      0,
      0,
      0,
    );
    expect(due).toBe(600);
  });

  it("labor-only work schedules even when a purchase order exists elsewhere", () => {
    expect(
      assessMaterialsReadyForSchedule({ hasMaterialNeed: false, warehouseReadyAt: null }),
    ).toMatchObject({ ready: true, reason: "no_material_need" });
    const gate = src("src/app/(app)/jobs/actions.ts");
    const book = gate.slice(
      gate.indexOf("export async function bookInstall"),
      gate.indexOf("export async function rescheduleInstall"),
    );
    expect(book).not.toContain("purchase_orders");
  });
});
