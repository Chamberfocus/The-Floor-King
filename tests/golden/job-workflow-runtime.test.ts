/**
 * Job workflow runtime fixes — regression tests (no live DB).
 */
import { describe, expect, it } from "vitest";
import { warehouseJobIdFromForm } from "@/lib/job-warehouse";
import { jobStatusUpdatePatch } from "@/lib/job-status";
import { estimatedDirectCostFromScope } from "@/lib/job-costing";
import {
  buildLegacyCoverageContext,
  computeLineCoverage,
  planPurchasingAdjust,
  planPurchasingAdjustWithReview,
  type CoveragePoItem,
} from "@/lib/po-coverage";
import {
  excessReservation,
  netReservedQty,
  orphanedStockLineIds,
} from "@/lib/job-stock-reserve";
import type { EstimateLineItem } from "@/lib/types";
import type { CalcLine } from "@/lib/estimate-calc";

function item(
  partial: Partial<CoveragePoItem> & Pick<CoveragePoItem, "poItemId" | "poStatus" | "quantity">,
): CoveragePoItem {
  return {
    poId: partial.poId ?? "po-1",
    jobLineId: partial.jobLineId ?? null,
    productId: partial.productId ?? "prod-1",
    receivedQty: partial.receivedQty ?? null,
    receivedAt: partial.receivedAt ?? null,
    ...partial,
  };
}

function estLine(
  partial: Partial<EstimateLineItem> & CalcLine & { id: string },
): EstimateLineItem {
  return {
    id: partial.id,
    option_id: partial.option_id ?? "opt-1",
    position: partial.position ?? 0,
    room: partial.room ?? null,
    description: partial.description ?? "Line",
    note: partial.note ?? null,
    line_type: partial.line_type,
    sqft: partial.sqft ?? null,
    length_in: partial.length_in ?? null,
    width_in: partial.width_in ?? null,
    measure_unit: partial.measure_unit ?? "sqft",
    material_rate: partial.material_rate ?? null,
    labor_rate: partial.labor_rate ?? null,
    installed_rate: partial.installed_rate ?? null,
    flat_amount: partial.flat_amount ?? null,
    waste_pct: partial.waste_pct ?? 0,
    product_id: partial.product_id ?? null,
    manufacturer: partial.manufacturer ?? null,
    style: partial.style ?? null,
    color: partial.color ?? null,
    item_no: partial.item_no ?? null,
    material_cost: partial.material_cost ?? null,
    labor_cost: partial.labor_cost ?? null,
    quantity: partial.quantity ?? null,
    unit: partial.unit ?? null,
    category: partial.category ?? null,
    from_stock: partial.from_stock ?? false,
    order_as_roll: partial.order_as_roll ?? false,
    roll_width_ft: partial.roll_width_ft ?? null,
    sqft_per_box: partial.sqft_per_box ?? null,
    is_fill: partial.is_fill ?? false,
    is_optional: partial.is_optional ?? false,
    measurements: partial.measurements ?? null,
  };
}

describe("FIX 1 — warehouse form contract", () => {
  it("reads job_id from form data", () => {
    const fd = new FormData();
    fd.set("job_id", "job-abc");
    expect(warehouseJobIdFromForm(fd)).toBe("job-abc");
  });

  it("ignores id field (wrong contract)", () => {
    const fd = new FormData();
    fd.set("id", "job-wrong");
    expect(warehouseJobIdFromForm(fd)).toBeNull();
  });
});

describe("FIX 2 — profitability uses operational scope for cost", () => {
  const commercial: EstimateLineItem[] = [
    estLine({
      id: "line-1",
      line_type: "mat_labor",
      category: "lvp",
      sqft: 500,
      waste_pct: 10,
      material_cost: 2,
      labor_cost: 1,
      material_rate: 4,
      labor_rate: 2,
    }),
  ];

  const operational: EstimateLineItem[] = [
    estLine({
      id: "line-1",
      line_type: "mat_labor",
      category: "lvp",
      sqft: 400,
      waste_pct: 10,
      material_cost: 2,
      labor_cost: 1,
      material_rate: 4,
      labor_rate: 2,
    }),
  ];

  it("edited job scope yields lower estimated cost than commercial estimate", () => {
    const commercialCost = estimatedDirectCostFromScope(commercial, 5);
    const opsCost = estimatedDirectCostFromScope(operational, 5);
    expect(opsCost.total).toBeLessThan(commercialCost.total);
    expect(opsCost.material).toBeLessThan(commercialCost.material);
  });
});

describe("FIX 3 — legacy PO coverage", () => {
  it("linked modern PO covers normally", () => {
    const cov = computeLineCoverage("jl-1", 550, [
      item({ poItemId: "i1", jobLineId: "jl-1", poStatus: "ordered", quantity: 550 }),
    ]);
    expect(cov.gap).toBe(0);
  });

  it("deterministic legacy match by unique product_id", () => {
    const items = [
      item({
        poItemId: "legacy",
        jobLineId: null,
        productId: "prod-a",
        poStatus: "ordered",
        quantity: 550,
      }),
    ];
    const ctx = buildLegacyCoverageContext(
      [{ id: "jl-1", productId: "prod-a" }],
      items,
    );
    expect(ctx.reviewRequired).toBe(false);
    expect(ctx.legacyByLine.get("jl-1")).toHaveLength(1);
    const cov = computeLineCoverage("jl-1", 550, items, ctx.legacyByLine.get("jl-1"));
    expect(cov.gap).toBe(0);
    expect(planPurchasingAdjust(cov).supplementalQty).toBe(0);
  });

  it("ambiguous legacy PO (two lines same product) → review required, no supplemental", () => {
    const items = [
      item({
        poItemId: "legacy",
        jobLineId: null,
        productId: "prod-a",
        poStatus: "ordered",
        quantity: 550,
      }),
    ];
    const ctx = buildLegacyCoverageContext(
      [
        { id: "jl-1", productId: "prod-a" },
        { id: "jl-2", productId: "prod-a" },
      ],
      items,
    );
    expect(ctx.reviewRequired).toBe(true);
    const cov = computeLineCoverage("jl-1", 550, items);
    expect(cov.gap).toBe(550);
    const plan = planPurchasingAdjustWithReview(cov, true);
    expect(plan.supplementalQty).toBe(0);
  });

  it("void/cancelled legacy PO does not cover", () => {
    const items = [
      item({
        poItemId: "void",
        jobLineId: null,
        productId: "prod-a",
        poStatus: "void",
        quantity: 550,
      }),
    ];
    const ctx = buildLegacyCoverageContext([{ id: "jl-1", productId: "prod-a" }], items);
    expect(ctx.legacyByLine.size).toBe(0);
  });

  it("partial legacy coverage leaves gap without supplemental when review required", () => {
    const items = [
      item({
        poItemId: "legacy",
        jobLineId: null,
        productId: "prod-a",
        poStatus: "ordered",
        quantity: 200,
      }),
    ];
    const ctx = buildLegacyCoverageContext(
      [
        { id: "jl-1", productId: "prod-a" },
        { id: "jl-2", productId: "prod-a" },
      ],
      items,
    );
    expect(ctx.reviewRequired).toBe(true);
    const plan = planPurchasingAdjustWithReview(
      computeLineCoverage("jl-1", 550, items),
      true,
    );
    expect(plan.supplementalQty).toBe(0);
  });

  it("issued excess on linked PO is reported", () => {
    const cov = computeLineCoverage("jl-1", 440, [
      item({ poItemId: "i1", jobLineId: "jl-1", poStatus: "ordered", quantity: 550 }),
    ]);
    expect(cov.excessIssued).toBe(110);
  });
});

describe("FIX 5 — stock reservation reconciliation", () => {
  it("releases excess when qty reduced", () => {
    expect(excessReservation(100, 60, 0)).toBe(40);
    // 60 need − 20 pulled = 40 should remain reserved; release 60 of 100.
    expect(excessReservation(100, 60, 20)).toBe(60);
  });

  it("does not release when already under-reserved", () => {
    expect(excessReservation(30, 60, 0)).toBe(0);
    expect(excessReservation(5, 60, 50)).toBe(0);
  });

  it("orphaned line ids detected", () => {
    expect(orphanedStockLineIds(["a", "b", "c"], ["a"])).toEqual(["b", "c"]);
  });

  it("net reserved from movements", () => {
    const net = netReservedQty([
      { kind: "reserve", qty: 100 },
      { kind: "release", qty: -20 },
      { kind: "pull", qty: -30 },
    ]);
    expect(net).toBe(50);
  });
});

describe("FIX 6 — manual completion timestamp", () => {
  it("sets completed_at on first completion", () => {
    const patch = jobStatusUpdatePatch("completed", null, "2026-01-15T12:00:00.000Z");
    expect(patch).toEqual({
      status: "completed",
      completed_at: "2026-01-15T12:00:00.000Z",
    });
  });

  it("preserves existing completed_at on re-complete", () => {
    const patch = jobStatusUpdatePatch("completed", "2026-01-01T00:00:00.000Z");
    expect(patch).toEqual({ status: "completed" });
  });

  it("does not set completed_at for in_progress", () => {
    expect(jobStatusUpdatePatch("in_progress", null)).toEqual({ status: "in_progress" });
  });
});
