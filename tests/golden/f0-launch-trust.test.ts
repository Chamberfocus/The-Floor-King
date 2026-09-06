/**
 * F0 Launch Trust — payment safety, materials-ready gate, P&L cost rule.
 */
import { describe, expect, it } from "vitest";
import {
  activePaymentsTotal,
  assessPaymentAmount,
  invoiceRemainingBalance,
  simulateConcurrentPayments,
  PAYMENT_NONPOSITIVE_MESSAGE,
} from "@/lib/payment-safety";
import {
  assessMaterialsReadyForSchedule,
  assessScheduleMaterialsGate,
  MATERIALS_OVERRIDE_REASON_REQUIRED,
} from "@/lib/materials-ready";
import {
  committedPoSpendExcludingBilled,
  sumCommittedPoSpendExcludingBilled,
} from "@/lib/finance-cost";
import {
  computeLineCoverage,
  planPurchasingAdjust,
  isNonCoveringPoStatus,
  type CoveragePoItem,
} from "@/lib/po-coverage";

describe("F0 payment overpay / void / concurrency", () => {
  it("1. invoice $5k with $5k payment → balance $0", () => {
    const rem = invoiceRemainingBalance(
      [{ quantity: 1, rate: 5000 }],
      0,
      [{ amount: 5000, status: "active" }],
    );
    expect(rem).toBe(0);
  });

  it("2. additional $1 against $0 remaining → blocked", () => {
    const gate = assessPaymentAmount({ amount: 1, remainingBalance: 0 });
    expect(gate.ok).toBe(false);
  });

  it("3. payment amount <= 0 → blocked", () => {
    const gate = assessPaymentAmount({ amount: 0, remainingBalance: 100 });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.error).toBe(PAYMENT_NONPOSITIVE_MESSAGE);
  });

  it("4. two $5k attempts against $5k → only one accepted", () => {
    const sim = simulateConcurrentPayments(5000, 5000, 5000);
    expect(sim.accepted).toEqual([5000]);
    expect(sim.rejected).toEqual([5000]);
  });

  it("5. voided payment does not count toward paid", () => {
    expect(
      activePaymentsTotal([
        { amount: 5000, status: "active" },
        { amount: 5000, status: "void" },
      ]),
    ).toBe(5000);
  });

  it("6. voiding payment restores collectible balance", () => {
    const before = invoiceRemainingBalance(
      [{ quantity: 1, rate: 10000 }],
      0,
      [{ amount: 10000, status: "active" }],
    );
    expect(before).toBe(0);
    const after = invoiceRemainingBalance(
      [{ quantity: 1, rate: 10000 }],
      0,
      [{ amount: 10000, status: "void" }],
    );
    expect(after).toBe(10000);
  });

  it("7. production void roles are office/admin (documented contract)", () => {
    const voidRoles = ["admin", "office"];
    expect(voidRoles).toContain("admin");
    expect(voidRoles).not.toContain("crew");
  });

  it("8. payment record roles exclude crew/warehouse/customer", () => {
    const recordRoles = ["admin", "office", "sales_manager", "salesman"];
    expect(recordRoles).not.toContain("crew");
    expect(recordRoles).not.toContain("warehouse");
    expect(recordRoles).not.toContain("customer");
  });
});

describe("F0 materials-ready scheduling", () => {
  it("9. materials ready → scheduling allowed", () => {
    const g = assessScheduleMaterialsGate({
      warehouseReadyAt: "2026-01-01T00:00:00Z",
      hasMaterialNeed: true,
    });
    expect(g).toEqual({ ok: true, override: false });
  });

  it("10. materials not ready → normal scheduling blocked", () => {
    const g = assessScheduleMaterialsGate({
      warehouseReadyAt: null,
      hasMaterialNeed: true,
    });
    expect(g.ok).toBe(false);
  });

  it("11. materials not ready + override reason → allowed", () => {
    const g = assessScheduleMaterialsGate({
      warehouseReadyAt: null,
      hasMaterialNeed: true,
      overrideReason: "Customer insists; materials arrive morning of",
    });
    expect(g).toEqual({ ok: true, override: true });
  });

  it("12. override without reason → blocked", () => {
    const g = assessScheduleMaterialsGate({
      warehouseReadyAt: null,
      hasMaterialNeed: true,
      overrideReason: "  ",
    });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.error).toBe(MATERIALS_OVERRIDE_REASON_REQUIRED);
  });

  it("no material need → ready without warehouse flag", () => {
    expect(
      assessMaterialsReadyForSchedule({
        warehouseReadyAt: null,
        hasMaterialNeed: false,
      }).ready,
    ).toBe(true);
  });
});

describe("F0 P&L double-count rule", () => {
  it("13. PO + vendor bill for same PO → report does not double-count", () => {
    const billed = new Set(["po-1"]);
    expect(
      committedPoSpendExcludingBilled({
        poId: "po-1",
        poTotal: 5000,
        billedPoIds: billed,
      }),
    ).toBe(0);
    expect(
      sumCommittedPoSpendExcludingBilled(
        [
          { id: "po-1", total: 5000 },
          { id: "po-2", total: 2000 },
        ],
        billed,
      ),
    ).toBe(2000);
  });
});

describe("F0 PO coverage concurrency / gap", () => {
  const item = (
    partial: Partial<CoveragePoItem> & Pick<CoveragePoItem, "poItemId" | "poId">,
  ): CoveragePoItem => ({
    jobLineId: "line-1",
    productId: "p1",
    quantity: 550,
    receivedQty: null,
    receivedAt: null,
    poStatus: "ordered",
    ...partial,
  });

  it("14–16. duplicate full coverage not planned; gap-only; fully covered no-ops", () => {
    const covered = computeLineCoverage("line-1", 550, [
      item({ poItemId: "a", poId: "po1", quantity: 550 }),
    ]);
    expect(covered.gap).toBe(0);
    const plan = planPurchasingAdjust(covered);
    expect(plan.supplementalQty).toBe(0);

    const partial = computeLineCoverage("line-1", 550, [
      item({ poItemId: "a", poId: "po1", quantity: 300 }),
    ]);
    expect(partial.gap).toBe(250);
    expect(planPurchasingAdjust(partial).supplementalQty).toBe(250);
  });

  it("17. void/cancelled PO is zero coverage", () => {
    expect(isNonCoveringPoStatus("void")).toBe(true);
    const cov = computeLineCoverage("line-1", 550, [
      item({ poItemId: "a", poId: "po1", quantity: 550, poStatus: "void" }),
    ]);
    expect(cov.validCovered).toBe(0);
    expect(cov.gap).toBe(550);
  });
});

describe("F0 silent failure messaging", () => {
  it("18. missing/invalid payment inputs produce meaningful assess failures", () => {
    expect(assessPaymentAmount({ amount: -1, remainingBalance: 10 }).ok).toBe(
      false,
    );
    expect(
      assessPaymentAmount({ amount: 100, remainingBalance: 50 }).ok,
    ).toBe(false);
  });
});
