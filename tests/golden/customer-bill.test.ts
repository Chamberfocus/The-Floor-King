/**
 * Carpet questionnaire, project-details Off, and a salesperson quick estimate.
 * Gas, car allowance, and commission live in bill-recovery and are covered there.
 */
import { describe, expect, it } from "vitest";
import { lineQty, lineTotal, type CalcLine } from "@/lib/estimate-calc";
import { projectDetailsShown } from "@/lib/customer-scope";
import { simplifyCarpetQuestionnaire } from "@/lib/flooring-knowledge/show-if";
import { quickEstimateCustomerNotes, quickEstimateLineRow } from "@/lib/quick-estimate";

describe("project details toggle", () => {
  it("treats an explicit off as hidden and anything else as shown", () => {
    expect(projectDetailsShown(false)).toBe(false);
    expect(projectDetailsShown("false")).toBe(false);
    expect(projectDetailsShown("off")).toBe(false);
    expect(projectDetailsShown(0)).toBe(false);
    expect(projectDetailsShown(true)).toBe(true);
    expect(projectDetailsShown(null)).toBe(true);
    expect(projectDetailsShown(undefined)).toBe(true);
  });
});

describe("carpet questionnaire", () => {
  const questions = [
    { id: "install", key: "carpet_install", label: "How is the carpet installed?" },
    { id: "dup", key: null, label: "How is the carpet installed?" },
    { id: "heat", key: "radiant_heat", label: "Radiant heat?" },
    { id: "vapor", key: "vapor_barrier", label: "6-mil vapor barrier?" },
    { id: "stairs", key: "hs_plank_stairs", label: "Plank stairs?" },
    { id: "pad", key: "carpet_pad", label: "What pad?" },
  ];
  const visible = Object.fromEntries(questions.map((q) => [q.id, true]));

  it("on a carpet-only job hides hard-surface leftovers and the duplicate", () => {
    const next = simplifyCarpetQuestionnaire(questions, visible, true);
    expect(next.install).toBe(true);
    expect(next.pad).toBe(true);
    expect(next.dup).toBe(false);
    expect(next.heat).toBe(false);
    expect(next.vapor).toBe(false);
    expect(next.stairs).toBe(false);
  });

  it("on a mixed job still drops the duplicate and keeps hard-surface questions", () => {
    const next = simplifyCarpetQuestionnaire(questions, visible, false);
    expect(next.dup).toBe(false);
    expect(next.heat).toBe(true);
    expect(next.vapor).toBe(true);
  });
});

describe("salesperson quick estimate transfers to the job", () => {
  it("keeps carpet yards, product identity, and the same sell the quote showed", () => {
    const row = quickEstimateLineRow(
      {
        description: "Shaw · Calm · Tide",
        quantity: "50",
        unit: "sq yd",
        rate: "20",
        cost: "8",
        productId: "prod-1",
        category: "carpet",
        manufacturer: "Shaw",
        style: "Calm",
        color: "Tide",
      },
      0,
    );
    expect(row.unit).toBe("sqyd");
    expect(row.measure_unit).toBe("sqyd");
    expect(row.sqft).toBe(450);
    expect(row.category).toBe("carpet");
    expect(row.manufacturer).toBe("Shaw");
    expect(row.style).toBe("Calm");
    expect(row.color).toBe("Tide");
    expect(row.product_id).toBe("prod-1");
    expect(lineQty(row as CalcLine)).toBe(50);
    expect(lineTotal(row as CalcLine)).toBe(1000);
  });

  it("bills square feet and each by the quantity that was typed", () => {
    const sqft = quickEstimateLineRow(
      { description: "LVP", quantity: 120, unit: "sq ft", rate: 4, category: "lvp" },
      0,
    );
    expect(sqft.measure_unit).toBe("sqft");
    expect(sqft.sqft).toBe(120);
    expect(lineQty(sqft as CalcLine)).toBe(120);
    expect(lineTotal(sqft as CalcLine)).toBe(480);

    const each = quickEstimateLineRow(
      { description: "Toilet reset", quantity: 2, unit: "each", rate: 75, category: "labor" },
      1,
    );
    expect(each.sqft).toBeNull();
    expect(each.unit).toBe("each");
    expect(lineQty(each as CalcLine)).toBe(2);
    expect(lineTotal(each as CalcLine)).toBe(150);
  });

  it("puts the salesperson's notes on the customer copy and the work order", () => {
    expect(quickEstimateCustomerNotes("  Two rooms of carpet.  ")).toBe("Two rooms of carpet.");
    expect(quickEstimateCustomerNotes("   ")).toBeNull();
  });
});
