/**
 * Golden tests for the canonical estimate calculation engine
 * (`src/lib/estimate-calc.ts` + `job-profit.ts`).
 *
 * Expected values are derived ONLY from the formulas and comments in those
 * modules — not from invoice/PO conversion paths (those have known divergences
 * covered in downstream-protections.test.ts).
 *
 * Fixed inputs → fixed outputs. Changing financial math must break these tests.
 */
import { describe, expect, it } from "vitest";
import {
  discountAmount,
  lineAreaSqft,
  lineAreaSqyd,
  lineCost,
  lineOrderQty,
  lineProfit,
  lineQty,
  lineTotal,
  marginPct,
  markupPct,
  measurementSqft,
  measurementsSqft,
  num,
  optionCostTotals,
  optionTotals,
  optionTotalsWithDiscount,
  priceFromMargin,
  type CalcLine,
} from "@/lib/estimate-calc";
import { jobProfit, lineMargin } from "@/lib/job-profit";

/** Engine returns full floats (no cent rounding). Compare with tight tolerance. */
function expectMoney(actual: number, expected: number) {
  expect(actual).toBeCloseTo(expected, 10);
}

/** Hand-computed flooring scenarios — keep literals stable. */
const carpet360sqft10waste: CalcLine = {
  line_type: "mat_labor",
  category: "carpet",
  unit: "sq yd",
  measure_unit: "sqyd",
  sqft: 360, // 40 sq yd
  quantity: null,
  waste_pct: 10,
  material_rate: 30,
  labor_rate: 0,
  material_cost: 20,
  labor_cost: 0,
};

const lvpWithInstallLabor: CalcLine = {
  line_type: "mat_labor",
  category: "lvp",
  unit: "sq ft",
  measure_unit: "sqft",
  sqft: 500,
  waste_pct: 10,
  material_rate: 4.5,
  labor_rate: 2.0,
  material_cost: 2.5,
  labor_cost: 1.25,
};

const laborOnlyTearout: CalcLine = {
  line_type: "mat_labor",
  category: "labor",
  unit: "sq ft",
  measure_unit: "sqft",
  sqft: 500,
  waste_pct: 10,
  material_rate: 99, // must be ignored on labor lines
  labor_rate: 1.5,
  material_cost: 50,
  labor_cost: 0.9,
};

const installedPad: CalcLine = {
  line_type: "installed",
  category: "underlayment",
  unit: "sq ft",
  sqft: 200,
  waste_pct: 5,
  installed_rate: 0.85,
  material_cost: 0.4,
  labor_cost: 0.2,
};

const flatDelivery: CalcLine = {
  line_type: "flat",
  category: "other",
  flat_amount: 175,
  material_cost: 0,
  labor_cost: 40,
  waste_pct: 50, // must not affect flat sell
};

const bagsLeveler: CalcLine = {
  line_type: "mat_labor",
  category: "other",
  unit: "bag",
  measure_unit: "sqft",
  sqft: 9999, // must NOT drive count pricing
  quantity: 5,
  waste_pct: 0,
  material_rate: 32,
  labor_rate: 0,
  material_cost: 24,
  labor_cost: 0,
};

describe("num() parsing", () => {
  it("parses currency strings the builder may paste", () => {
    expect(num("$1,250.00")).toBe(1250);
    expect(num(" 42 ")).toBe(42);
    expect(num(null)).toBe(0);
    expect(num("")).toBe(0);
    expect(num("not-a-number")).toBe(0);
  });
});

describe("measurements / area", () => {
  it("computes signed piece area in sq ft (inches)", () => {
    // 144" × 120" = 12' × 10' = 120 sq ft
    expect(measurementSqft({ length_in: 144, width_in: 120, op: "add" })).toBe(120);
    expect(measurementSqft({ length_in: 144, width_in: 120, op: "subtract" })).toBe(-120);
  });

  it("sums measured pieces and rounds to 2dp", () => {
    expect(
      measurementsSqft([
        { length_in: 144, width_in: 120, op: "add" },
        { length_in: 24, width_in: 24, op: "subtract" }, // 4 sq ft cutout
      ]),
    ).toBe(116);
  });

  it("prefers stored sqft over L×W for pricing area", () => {
    expect(lineAreaSqft({ line_type: "mat_labor", sqft: 360, length_in: 12, width_in: 12 })).toBe(
      360,
    );
    expect(lineAreaSqft({ line_type: "mat_labor", length_in: 144, width_in: 120 })).toBe(120);
  });

  it("converts area to sq yd", () => {
    expect(lineAreaSqyd({ line_type: "mat_labor", sqft: 360 })).toBe(40);
  });
});

describe("lineQty — unit kind rules", () => {
  it("prices carpet (area, sq yd) from measured area / 9", () => {
    // 360 sq ft → 40 sq yd
    expect(lineQty(carpet360sqft10waste)).toBe(40);
  });

  it("prices count units from quantity and ignores sqft (old $33,600 bug)", () => {
    expect(lineQty(bagsLeveler)).toBe(5);
    expect(lineTotal(bagsLeveler)).toBe(160); // 5 × $32
  });

  it("lets unit label win over conflicting measure_unit", () => {
    // Historical bug: unit "sq ft" + measure_unit "sqyd" billed a ninth of the job.
    const tearout: CalcLine = {
      line_type: "mat_labor",
      category: "labor",
      unit: "sq ft",
      measure_unit: "sqyd",
      sqft: 723,
      labor_rate: 1,
    };
    expect(lineQty(tearout)).toBe(723);
  });

  it("falls back to measure_unit when unit is blank", () => {
    const line: CalcLine = {
      line_type: "mat_labor",
      unit: "",
      measure_unit: "sqyd",
      sqft: 90,
      material_rate: 10,
    };
    expect(lineQty(line)).toBe(10);
  });

  it("handles zero / empty quantity on count lines as $0", () => {
    const emptyBags: CalcLine = {
      line_type: "mat_labor",
      unit: "bag",
      quantity: null,
      material_rate: 32,
      sqft: 500,
    };
    expect(lineQty(emptyBags)).toBe(0);
    expect(lineTotal(emptyBags)).toBe(0);
  });
});

describe("waste — lineOrderQty and lineTotal (canonical)", () => {
  it("lineOrderQty = measured qty × (1 + waste%) — buy quantity", () => {
    // 40 sq yd × 1.10 = 44
    expect(lineOrderQty(carpet360sqft10waste)).toBe(44);
  });

  it("material-only carpet: sell = qty × rate × waste", () => {
    // 40 × $30 × 1.10 = $1320
    expectMoney(lineTotal(carpet360sqft10waste), 1320);
    expectMoney(lineCost(carpet360sqft10waste), 880); // 40 × $20 × 1.10
  });

  it("mat_labor with material+labor: waste multiplies the WHOLE line (canonical shop rule)", () => {
    // qty=500; waste 1.1
    // sell = 1.1 × (500×4.5 + 500×2) = 1.1 × 3250 = 3575
    expect(lineQty(lvpWithInstallLabor)).toBe(500);
    expectMoney(lineTotal(lvpWithInstallLabor), 3575);
    // cost = 1.1 × (500×2.5 + 500×1.25) = 1.1 × 1875 = 2062.5
    expectMoney(lineCost(lvpWithInstallLabor), 2062.5);
  });

  it("category=labor ignores material rate/cost; waste still applies to labor", () => {
    // sell = 1.1 × (0 + 500×1.5) = 825
    expectMoney(lineTotal(laborOnlyTearout), 825);
    // cost = 1.1 × (0 + 500×0.9) = 495
    expectMoney(lineCost(laborOnlyTearout), 495);
  });

  it("installed lines: qty × installed_rate × waste", () => {
    // 200 × 0.85 × 1.05 = 178.5
    expectMoney(lineTotal(installedPad), 178.5);
  });

  it("flat lines ignore waste for sell; lump costs only", () => {
    expectMoney(lineTotal(flatDelivery), 175);
    expectMoney(lineCost(flatDelivery), 40);
  });

  it("waste_pct 0 leaves order qty equal to bill qty", () => {
    const noWaste = { ...carpet360sqft10waste, waste_pct: 0 };
    expect(lineOrderQty(noWaste)).toBe(40);
    expectMoney(lineTotal(noWaste), 1200);
  });
});

describe("line profit / margin / markup / priceFromMargin", () => {
  it("lineProfit = sell − cost", () => {
    expectMoney(lineProfit(carpet360sqft10waste), 440); // 1320 − 880
  });

  it("marginPct is profit ÷ sell × 100", () => {
    expect(marginPct(1320, 880)).toBeCloseTo(((1320 - 880) / 1320) * 100, 10);
    expect(marginPct(0, 100)).toBe(0);
  });

  it("markupPct is profit ÷ cost × 100", () => {
    expect(markupPct(1320, 880)).toBeCloseTo(((1320 - 880) / 880) * 100, 10);
    expect(markupPct(100, 0)).toBe(0);
  });

  it("priceFromMargin solves sell = cost / (1 − m)", () => {
    // 40% margin on $20 cost → 20 / 0.6 = 33.333…
    expect(priceFromMargin(20, 40)).toBeCloseTo(20 / 0.6, 10);
    // out-of-range margin returns cost unchanged
    expect(priceFromMargin(20, 100)).toBe(20);
    expect(priceFromMargin(20, -5)).toBe(20);
  });
});

describe("option totals — multi-line flooring estimate", () => {
  const livingCarpet = carpet360sqft10waste;
  const install = laborOnlyTearout;
  const leveler = bagsLeveler;
  const delivery = flatDelivery;
  const lines = [livingCarpet, install, leveler, delivery];

  it("sums line totals into subtotal", () => {
    // 1320 + 825 + 160 + 175 = 2480
    const t = optionTotals(lines, 0);
    expectMoney(t.subtotal, 2480);
    expectMoney(t.tax, 0);
    expectMoney(t.total, 2480);
  });

  it("applies sales tax to full subtotal when no discount", () => {
    // tax 8% of 2480 = 198.4; total 2678.4
    const t = optionTotals(lines, 8);
    expectMoney(t.subtotal, 2480);
    expectMoney(t.tax, 198.4);
    expectMoney(t.total, 2678.4);
  });

  it("percent discount reduces taxable base before tax", () => {
    // discount 10% of 2480 = 248; taxable 2232; tax 8% = 178.56; total 2410.56
    const t = optionTotalsWithDiscount(lines, 8, "percent", 10);
    expectMoney(t.subtotal, 2480);
    expectMoney(t.discount, 248);
    expectMoney(t.tax, 178.56);
    expectMoney(t.total, 2410.56);
  });

  it("fixed-dollar discount is capped at subtotal", () => {
    const t = optionTotalsWithDiscount(lines, 8, "amount", 500);
    expectMoney(t.discount, 500);
    expectMoney(t.tax, 1980 * 0.08);
    expectMoney(t.total, 1980 + 158.4);

    expect(discountAmount(2480, "amount", 99999)).toBe(2480);
    expect(discountAmount(0, "percent", 10)).toBe(0);
    expect(discountAmount(100, "percent", 0)).toBe(0);
  });

  it("optionCostTotals splits material vs labor with waste rules", () => {
    const c = optionCostTotals(lines);
    // carpet mat 880 + bags 120 = 1000 material
    // tearout labor 495 + flat labor 40 = 535
    expectMoney(c.material, 1000);
    expectMoney(c.labor, 535);
    expectMoney(c.cost, 1535);
  });
});

describe("decimals, zeros, edge cases", () => {
  it("accepts decimal quantities on count lines", () => {
    const trim: CalcLine = {
      line_type: "mat_labor",
      unit: "lnft",
      quantity: 12.5,
      material_rate: 2.4,
      waste_pct: 0,
    };
    expect(lineQty(trim)).toBe(12.5);
    expect(lineTotal(trim)).toBe(30); // 12.5 × 2.4
  });

  it("handles all-zero line", () => {
    const z: CalcLine = {
      line_type: "mat_labor",
      unit: "sq ft",
      sqft: 0,
      quantity: 0,
      material_rate: 0,
      labor_rate: 0,
      waste_pct: 10,
    };
    expect(lineQty(z)).toBe(0);
    expect(lineTotal(z)).toBe(0);
    expect(lineCost(z)).toBe(0);
    expect(lineOrderQty(z)).toBe(0);
  });

  it("unknown line_type yields 0", () => {
    expect(lineTotal({ line_type: "nope" as CalcLine["line_type"], flat_amount: 50 })).toBe(0);
  });

  it("empty option totals are zeros", () => {
    expect(optionTotals([], 8)).toEqual({ subtotal: 0, tax: 0, total: 0 });
    expect(optionTotalsWithDiscount([], 8, "percent", 10)).toEqual({
      subtotal: 0,
      discount: 0,
      tax: 0,
      total: 0,
    });
  });

  /**
   * estimate-calc does NOT round money to cents — it returns full IEEE floats.
   * Cent rounding lives at display / invoice-create boundaries. Lock that fact.
   */
  it("does not silently round option tax to cents", () => {
    const lines: CalcLine[] = [
      {
        line_type: "flat",
        flat_amount: 33.33,
      },
    ];
    const t = optionTotals(lines, 7.5);
    // 33.33 × 0.075 = 2.49975 (not 2.50)
    expect(t.tax).toBeCloseTo(2.49975, 10);
    expect(t.total).toBeCloseTo(35.82975, 10);
  });
});

describe("jobProfit — all-in margin (canonical profit definition)", () => {
  const lines: CalcLine[] = [carpet360sqft10waste, bagsLeveler];

  it("subtracts discount before revenue; applies freight to material only", () => {
    // subtotal = 1320 + 160 = 1480
    // discount $100 → revenue 1380
    // material cost = 880 + 120 = 1000; × 1.05 freight = 1050
    // labor = 0; fuel 25; car 15; commission 5% of 1380 = 69
    // profit = 1380 − 1050 − 0 − 25 − 15 − 69 = 221
    const p = jobProfit(lines, {
      discountKind: "amount",
      discountValue: 100,
      freightMarkupPct: 5,
      fuelFee: 25,
      carAllowance: 15,
      commissionPct: 5,
    });
    expectMoney(p.subtotal, 1480);
    expectMoney(p.discount, 100);
    expectMoney(p.revenue, 1380);
    expectMoney(p.material, 1050);
    expectMoney(p.labor, 0);
    expectMoney(p.cost, 1050);
    expectMoney(p.fuelFee, 25);
    expectMoney(p.carAllowance, 15);
    expectMoney(p.commission, 69);
    expectMoney(p.profit, 221);
    expect(p.margin).toBeCloseTo((221 / 1380) * 100, 10);
  });

  it("skips job-level fees when revenue is 0", () => {
    const p = jobProfit([], { fuelFee: 25, carAllowance: 15, commissionPct: 5 });
    expect(p.fuelFee).toBe(0);
    expect(p.carAllowance).toBe(0);
    expect(p.commission).toBe(0);
    expect(p.margin).toBe(0);
  });

  it("lineMargin includes freight on material, not job fees", () => {
    // sell 1320; mat 880×1.1 freight = 968; margin = (1320−968)/1320
    expect(lineMargin(carpet360sqft10waste, 10)).toBeCloseTo(((1320 - 968) / 1320) * 100, 10);
  });
});

describe("realistic multi-room hard-surface scenario (golden fixture)", () => {
  /**
   * Living: 320 sq ft LVP @ $3.75 mat + $1.85 labor, 8% waste
   * Kitchen: 180 sq ft same product
   * Tear-out labor: 500 sq ft @ $1.25, 0% waste (category labor)
   * Self-leveler: 8 bags @ $28 sell / $19 cost
   * Discount: $200 amount
   * Tax: 8%
   */
  const living: CalcLine = {
    line_type: "mat_labor",
    category: "lvp",
    unit: "sq ft",
    sqft: 320,
    waste_pct: 8,
    material_rate: 3.75,
    labor_rate: 1.85,
    material_cost: 2.1,
    labor_cost: 1.0,
  };
  const kitchen: CalcLine = {
    line_type: "mat_labor",
    category: "lvp",
    unit: "sq ft",
    sqft: 180,
    waste_pct: 8,
    material_rate: 3.75,
    labor_rate: 1.85,
    material_cost: 2.1,
    labor_cost: 1.0,
  };
  const tearout: CalcLine = {
    line_type: "mat_labor",
    category: "labor",
    unit: "sq ft",
    sqft: 500,
    waste_pct: 0,
    labor_rate: 1.25,
    labor_cost: 0.75,
  };
  const leveler: CalcLine = {
    line_type: "mat_labor",
    unit: "bag",
    quantity: 8,
    waste_pct: 0,
    material_rate: 28,
    material_cost: 19,
  };
  const lines = [living, kitchen, tearout, leveler];

  it("locks line, option, discount, tax, cost, and order quantities", () => {
    // living sell = 1.08 × (320×3.75 + 320×1.85) = 1.08 × 1792 = 1935.36
    expect(lineTotal(living)).toBeCloseTo(1935.36, 10);
    // kitchen sell = 1.08 × (180×5.6) = 1.08 × 1008 = 1088.64
    expect(lineTotal(kitchen)).toBeCloseTo(1088.64, 10);
    expect(lineTotal(tearout)).toBe(625); // 500 × 1.25
    expect(lineTotal(leveler)).toBe(224); // 8 × 28

    const sub = 1935.36 + 1088.64 + 625 + 224; // 3872.999… → 3873
    expect(sub).toBeCloseTo(3873, 10);

    const totals = optionTotalsWithDiscount(lines, 8, "amount", 200);
    expect(totals.subtotal).toBeCloseTo(3873, 10);
    expect(totals.discount).toBe(200);
    const taxable = totals.subtotal - 200;
    expect(totals.tax).toBeCloseTo(taxable * 0.08, 10);
    expect(totals.total).toBeCloseTo(taxable + totals.tax, 10);

    // Order qty (staging / buy): living 320×1.08=345.6; kitchen 194.4; tearout 500; bags 8
    expect(lineOrderQty(living)).toBeCloseTo(345.6, 10);
    expect(lineOrderQty(kitchen)).toBeCloseTo(194.4, 10);
    expect(lineOrderQty(tearout)).toBe(500);
    expect(lineOrderQty(leveler)).toBe(8);

    // Costs with waste on area lines
    // living cost = 1.08 × (320×2.1 + 320×1) = 1.08 × 992 = 1071.36
    expect(lineCost(living)).toBeCloseTo(1071.36, 10);
    expect(lineCost(kitchen)).toBeCloseTo(1.08 * (180 * 2.1 + 180 * 1), 10);
    expect(lineCost(tearout)).toBe(375);
    expect(lineCost(leveler)).toBe(152);
  });
});
