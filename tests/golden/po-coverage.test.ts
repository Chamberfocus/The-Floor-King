/**
 * Step 4 — purchasing coverage & PO lifecycle policy (P1–P9).
 */
import { describe, expect, it } from "vitest";
import {
  arrivedQuantity,
  computeLineCoverage,
  coveringQuantity,
  isImmutablePoStatus,
  isNonCoveringPoStatus,
  planPurchasingAdjust,
  shouldRoutePurchasingToJob,
  supplementalGapOnly,
  type CoveragePoItem,
} from "@/lib/po-coverage";
import { materialNeedQty } from "@/lib/job-operational-scope";
import type { CalcLine } from "@/lib/estimate-calc";

const need550: CalcLine = {
  line_type: "mat_labor",
  category: "lvp",
  unit: "sq ft",
  sqft: 500,
  waste_pct: 10,
};

function item(
  partial: Partial<CoveragePoItem> & Pick<CoveragePoItem, "poItemId" | "poStatus" | "quantity">,
): CoveragePoItem {
  return {
    poId: partial.poId ?? "po-1",
    jobLineId: partial.jobLineId ?? "jl-1",
    productId: partial.productId ?? "prod-1",
    receivedQty: partial.receivedQty ?? null,
    receivedAt: partial.receivedAt ?? null,
    ...partial,
  };
}

describe("material need uses lineOrderQty (waste in)", () => {
  it("500 sq ft + 10% waste → need 550", () => {
    expect(materialNeedQty(need550)).toBe(550);
  });
});

describe("1. Job need 550 / no PO → full gap", () => {
  it("gap equals need; arrival order", () => {
    const cov = computeLineCoverage("jl-1", 550, []);
    expect(cov.gap).toBe(550);
    expect(cov.validCovered).toBe(0);
    expect(cov.arrival).toBe("order");
    const plan = planPurchasingAdjust(cov);
    expect(plan.supplementalQty).toBe(550);
    expect(plan.targetDraftQty).toBe(0);
  });
});

describe("2. Draft 550 + repeated prep → no duplicate gap", () => {
  it("second coverage pass shows gap 0", () => {
    const items = [item({ poItemId: "i1", poStatus: "draft", quantity: 550 })];
    const cov = computeLineCoverage("jl-1", 550, items);
    expect(cov.gap).toBe(0);
    expect(cov.draftQty).toBe(550);
    const plan = planPurchasingAdjust(cov);
    expect(plan.shouldAdjustDraft).toBe(false);
    expect(plan.supplementalQty).toBe(0);
  });
});

describe("3. Need 550 → 660 with draft 550", () => {
  it("draft target becomes 660; no supplemental stack", () => {
    const cov = computeLineCoverage("jl-1", 660, [
      item({ poItemId: "i1", poStatus: "draft", quantity: 550 }),
    ]);
    expect(cov.gap).toBe(110);
    const plan = planPurchasingAdjust(cov);
    expect(plan.targetDraftQty).toBe(660);
    expect(plan.shouldAdjustDraft).toBe(true);
    expect(plan.supplementalQty).toBe(0);
  });
});

describe("4. Need 550 → 660 with ordered 550", () => {
  it("ordered stays; supplemental draft = 110 only", () => {
    const cov = computeLineCoverage("jl-1", 660, [
      item({ poItemId: "i1", poStatus: "ordered", quantity: 550 }),
    ]);
    expect(cov.orderedQty).toBe(550);
    expect(cov.gap).toBe(110);
    expect(isImmutablePoStatus("ordered")).toBe(true);
    const plan = planPurchasingAdjust(cov);
    // No draft yet → supplemental = gap
    expect(plan.supplementalQty).toBe(110);
    expect(plan.targetDraftQty).toBe(0);
    expect(supplementalGapOnly(660, 550)).toBe(110);
  });
});

describe("5. Need 550 → 440 with draft", () => {
  it("draft shrinks to 440", () => {
    const cov = computeLineCoverage("jl-1", 440, [
      item({ poItemId: "i1", poStatus: "draft", quantity: 550 }),
    ]);
    expect(cov.gap).toBe(0);
    expect(cov.validCovered).toBe(550); // over-covered by draft until adjusted
    const plan = planPurchasingAdjust(cov);
    expect(plan.targetDraftQty).toBe(440);
    expect(plan.shouldAdjustDraft).toBe(true);
    expect(plan.excessIssued).toBe(0);
  });
});

describe("6. Need 550 → 440 after ordered", () => {
  it("ordered remains 550; excessIssued = 110", () => {
    const cov = computeLineCoverage("jl-1", 440, [
      item({ poItemId: "i1", poStatus: "ordered", quantity: 550 }),
    ]);
    expect(cov.orderedQty).toBe(550);
    expect(cov.excessIssued).toBe(110);
    expect(cov.gap).toBe(0);
    const plan = planPurchasingAdjust(cov);
    expect(plan.excessIssued).toBe(110);
    expect(plan.supplementalQty).toBe(0);
    expect(plan.targetDraftQty).toBe(0);
  });
});

describe("7. Void/cancelled do not cover", () => {
  it("void 550 + need 550 → gap 550", () => {
    expect(isNonCoveringPoStatus("void")).toBe(true);
    expect(isNonCoveringPoStatus("cancelled")).toBe(true);
    expect(coveringQuantity(item({ poItemId: "v", poStatus: "void", quantity: 550 }))).toBe(0);
    const cov = computeLineCoverage("jl-1", 550, [
      item({ poItemId: "v", poStatus: "void", quantity: 550 }),
      item({ poItemId: "c", poStatus: "cancelled", quantity: 550, poId: "po-2" }),
    ]);
    expect(cov.validCovered).toBe(0);
    expect(cov.gap).toBe(550);
  });
});

describe("8. Material B after Material A has a PO", () => {
  it("B has its own gap; A coverage does not apply to B", () => {
    const items = [
      item({ poItemId: "a", jobLineId: "line-a", poStatus: "ordered", quantity: 550 }),
    ];
    const covA = computeLineCoverage("line-a", 550, items);
    const covB = computeLineCoverage("line-b", 300, items);
    expect(covA.gap).toBe(0);
    expect(covB.gap).toBe(300);
  });
});

describe("9. Job-only material is orderable via gap", () => {
  it("line never on estimate still has purchasing gap", () => {
    const cov = computeLineCoverage("job-only-1", 120, []);
    expect(planPurchasingAdjust(cov).supplementalQty).toBe(120);
  });
});

describe("10. Two job lines same product — explicit job_line_id", () => {
  it("arrival/coverage attributed per line", () => {
    const items = [
      item({
        poItemId: "i1",
        jobLineId: "jl-a",
        productId: "same",
        poStatus: "received",
        quantity: 200,
        receivedQty: 200,
        receivedAt: "2026-01-01",
      }),
      item({
        poItemId: "i2",
        jobLineId: "jl-b",
        productId: "same",
        poStatus: "ordered",
        quantity: 200,
      }),
    ];
    const a = computeLineCoverage("jl-a", 200, items);
    const b = computeLineCoverage("jl-b", 200, items);
    expect(a.arrival).toBe("arrived");
    expect(b.arrival).toBe("order");
    expect(b.gap).toBe(0); // ordered covers purchasing
    expect(b.arrivedQty).toBe(0);
  });
});

describe("11–13. Partial / full / supplemental receipt", () => {
  it("partial receipt → partial arrival, outstanding remains", () => {
    const cov = computeLineCoverage("jl-1", 550, [
      item({
        poItemId: "i1",
        poStatus: "ordered",
        quantity: 550,
        receivedQty: 200,
        receivedAt: "2026-01-01",
      }),
    ]);
    expect(cov.arrival).toBe("partial");
    expect(cov.arrivedQty).toBe(200);
    expect(cov.outstandingArrival).toBe(350);
  });

  it("full receipt → arrived", () => {
    const cov = computeLineCoverage("jl-1", 550, [
      item({
        poItemId: "i1",
        poStatus: "received",
        quantity: 550,
        receivedQty: 550,
        receivedAt: "2026-01-01",
      }),
    ]);
    expect(cov.arrival).toBe("arrived");
    expect(cov.outstandingArrival).toBe(0);
  });

  it("supplemental receipts combine to satisfy need", () => {
    const items = [
      item({
        poItemId: "base",
        poStatus: "received",
        quantity: 550,
        receivedQty: 550,
        receivedAt: "2026-01-01",
      }),
      item({
        poItemId: "supp",
        poId: "po-2",
        poStatus: "received",
        quantity: 110,
        receivedQty: 110,
        receivedAt: "2026-01-02",
      }),
    ];
    const cov = computeLineCoverage("jl-1", 660, items);
    expect(cov.arrivedQty).toBe(660);
    expect(cov.arrival).toBe("arrived");
    expect(cov.gap).toBe(0);
  });
});

describe("14. Carpet — draft adjustable; ordered immutable", () => {
  it("ordered carpet qty is immutable; draft may be targeted", () => {
    expect(isImmutablePoStatus("ordered")).toBe(true);
    expect(isImmutablePoStatus("draft")).toBe(false);
    const ordered = computeLineCoverage("jl-c", 100, [
      item({ poItemId: "o", jobLineId: "jl-c", poStatus: "ordered", quantity: 80 }),
    ]);
    expect(planPurchasingAdjust(ordered).supplementalQty).toBe(20);

    const draft = computeLineCoverage("jl-c", 100, [
      item({ poItemId: "d", jobLineId: "jl-c", poStatus: "draft", quantity: 80 }),
    ]);
    expect(planPurchasingAdjust(draft).targetDraftQty).toBe(100);
  });
});

describe("15. Estimate ordering after job exists", () => {
  it("routes purchasing to the job (blocks stale estimate scope)", () => {
    expect(shouldRoutePurchasingToJob(true)).toBe(true);
    expect(shouldRoutePurchasingToJob(false)).toBe(false);
  });
});

describe("15b. Historical PO without job_line_id", () => {
  it("does not crash; does not cover any job line", () => {
    const orphan = item({
      poItemId: "old",
      jobLineId: null,
      poStatus: "ordered",
      quantity: 550,
    });
    expect(coveringQuantity(orphan)).toBe(550); // still a real PO qty
    const cov = computeLineCoverage("jl-1", 550, [orphan]);
    expect(cov.validCovered).toBe(0);
    expect(cov.gap).toBe(550);
  });
});

describe("16. Compatibility arrival for header-received without line stamp", () => {
  it("treats full quantity as arrived when PO received", () => {
    const it = item({
      poItemId: "legacy",
      poStatus: "received",
      quantity: 550,
      receivedQty: null,
      receivedAt: null,
    });
    expect(arrivedQuantity(it)).toBe(550);
  });
});

describe("17. Ordered + draft together when need rises", () => {
  it("grows draft to fill gap only (issued untouched)", () => {
    const cov = computeLineCoverage("jl-1", 660, [
      item({ poItemId: "o", poStatus: "ordered", quantity: 550 }),
      item({ poItemId: "d", poId: "po-d", poStatus: "draft", quantity: 50 }),
    ]);
    // valid = 600, gap = 60; target draft = need - issued = 110
    expect(cov.gap).toBe(60);
    const plan = planPurchasingAdjust(cov);
    expect(plan.targetDraftQty).toBe(110);
    expect(plan.supplementalQty).toBe(0);
  });
});
