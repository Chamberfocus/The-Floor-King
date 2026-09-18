/**
 * Count lines must never print as square feet just because MeasureUnit is
 * area-only (sqft|sqyd) and count rows store measure_unit "sqft" with sqft null.
 *
 * MEASURED AREA, BILLING QTY, ORDER QTY, and UNIT OF MEASURE are different
 * facts. This file locks the display/key helpers so sq ft / sq yd / each /
 * lnft / step cannot be casually interchanged.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  billedQtyToSqyd,
  billedQtyToSqft,
  catalogRateToBillingUnit,
  catalogUnitFactor,
  isCountPricedLine,
  lineDisplayUnit,
  lineUnitKey,
  normalizeUnit,
  defaultUnitForCategory,
  pickedProductUnit,
  unitIsSqyd,
  unitLabel,
} from "@/lib/units";
import { lineSpec, padRollCount, PAD_ROLL_SQYD } from "@/lib/job-scope";
import { questionnaireEmitToLineQty } from "@/lib/questionnaire-emit";
import { normUnit } from "@/lib/catalog-csv";

const root = process.cwd();

describe("lineUnitKey / lineDisplayUnit — count vs area", () => {
  it("toilets with unit each and measure_unit sqft never display as sq ft", () => {
    const line = {
      unit: "each",
      measure_unit: "sqft" as const,
      sqft: null,
      quantity: 2,
    };
    expect(lineUnitKey(line)).toBe("each");
    expect(lineDisplayUnit(line)).toBe("each");
    expect(isCountPricedLine(line)).toBe(true);
  });

  it("toilets that forgot unit do not invent each or print sq ft", () => {
    const line = {
      unit: null,
      measure_unit: "sqft" as const,
      sqft: null,
      quantity: 2,
    };
    expect(lineUnitKey(line)).toBe("");
    expect(lineDisplayUnit(line)).toBe("");
    expect(isCountPricedLine(line)).toBe(true);
  });

  it("adhesive TBD with leftover measure_unit sqft is still COUNT, not square feet", () => {
    const line = {
      unit: "",
      measure_unit: "sqft" as const,
      sqft: null,
      quantity: null,
    };
    expect(isCountPricedLine(line)).toBe(true);
    expect(lineUnitKey(line)).toBe("");
    expect(lineDisplayUnit(line)).toBe("");
    expect(isCountPricedLine({ ...line, sqft: 40, category: "other" })).toBe(true);
    expect(lineUnitKey({ ...line, sqft: 40, category: "other" })).toBe("");
    const builder = readFileSync(
      join(root, "src/app/(app)/estimates/estimate-builder.tsx"),
      "utf8",
    );
    expect(builder).toMatch(/isCountPricedLine/);
    expect(builder).toMatch(/category === "other"/);
    expect(builder).toMatch(/Unit TBD — not square feet and not invented each/);
  });

  it("pad TBD with leftover measure_unit sqft is COUNT, not square feet", () => {
    const line = {
      unit: "",
      measure_unit: "sqft" as const,
      sqft: null,
      quantity: 4,
    };
    expect(isCountPricedLine(line)).toBe(true);
    const builder = readFileSync(
      join(root, "src/app/(app)/estimates/estimate-builder.tsx"),
      "utf8",
    );
    expect(builder).toMatch(/category === "underlayment"/);
    const calc = readFileSync(join(root, "src/lib/estimate-calc.ts"), "utf8");
    expect(calc).toMatch(/isCountPricedLine\(line\)/);
  });

  it("stair labor with unit step does not fall back to sq ft", () => {
    const line = { unit: "step", measure_unit: "sqft" as const, sqft: null };
    expect(normalizeUnit("step")).toBe("step");
    expect(lineUnitKey(line)).toBe("step");
    expect(lineDisplayUnit(line)).toBe("step");
  });

  it("delivery / each with no taped area is each", () => {
    const line = { unit: "each", measure_unit: "sqft" as const, sqft: null };
    expect(lineDisplayUnit(line)).toBe("each");
  });

  it("quarter round is lnft, never sq ft", () => {
    const line = { unit: "lnft", measure_unit: "sqft" as const, sqft: null };
    expect(lineUnitKey(line)).toBe("lnft");
    expect(lineDisplayUnit(line)).toBe("lnft");
    expect(unitLabel("lnft")).toBe("lnft");
  });

  it("carpet stored as 450 sq ft + measure_unit sqyd displays sq yd, not sq ft", () => {
    const line = {
      unit: "sq yd",
      measure_unit: "sqyd" as const,
      sqft: 450,
    };
    expect(lineUnitKey(line)).toBe("sqyd");
    expect(lineDisplayUnit(line)).toBe("sq yd");
    expect(isCountPricedLine(line)).toBe(false);
  });

  it("carpet with missing unit still takes sq yd from measure_unit when area exists", () => {
    const line = { unit: "", measure_unit: "sqyd" as const, sqft: 450 };
    expect(lineUnitKey(line)).toBe("sqyd");
    expect(lineDisplayUnit(line)).toBe("sq yd");
    expect(isCountPricedLine(line)).toBe(false);
  });

  it("hard-surface 500 sq ft with missing unit displays sq ft, not sq yd", () => {
    const line = { unit: null, measure_unit: "sqft" as const, sqft: 500 };
    expect(lineUnitKey(line)).toBe("sqft");
    expect(lineDisplayUnit(line)).toBe("sq ft");
    expect(isCountPricedLine(line)).toBe(false);
  });

  it("explicit sqft unit with area is sq ft even if someone hoped for yards", () => {
    const line = { unit: "sqft", measure_unit: "sqyd" as const, sqft: 450 };
    expect(lineUnitKey(line)).toBe("sqft");
    expect(lineDisplayUnit(line)).toBe("sq ft");
  });
});

describe("normalizeUnit — SY / yard aliases are square yards", () => {
  it("catalog SY and vendor yard words map to sqyd, not a count unit", () => {
    for (const raw of ["SY", "sy", "s.y.", "sq yd", "sqyd", "yard", "yards", "square yard"]) {
      expect(normalizeUnit(raw), raw).toBe("sqyd");
      expect(lineUnitKey({ unit: raw, measure_unit: "sqft", sqft: 450 })).toBe("sqyd");
    }
  });

  it("square feet aliases stay sqft — never yards", () => {
    for (const raw of ["sqft", "sq ft", "SF", "square feet"]) {
      expect(normalizeUnit(raw), raw).toBe("sqft");
    }
  });

  it("does not treat a random yd substring (hydronic) as square yards", () => {
    expect(normalizeUnit("hydronic")).not.toBe("sqyd");
    expect(unitIsSqyd("hydronic")).toBe(false);
  });
});

describe("billedQtyToSqyd — never invent yards from count units", () => {
  it("sq yd stays yards; sq ft divides by 9; each/lnft/roll return null", () => {
    expect(billedQtyToSqyd(50, "sqyd")).toBe(50);
    expect(billedQtyToSqyd(450, "sqft")).toBe(50);
    expect(billedQtyToSqyd(2, "each")).toBeNull();
    expect(billedQtyToSqyd(20, "lnft")).toBeNull();
    expect(billedQtyToSqyd(2, "roll")).toBeNull();
    expect(billedQtyToSqyd(0, "sqyd")).toBeNull();
  });
});

describe("billedQtyToSqft — never invent square feet from count units", () => {
  it("sq ft stays feet; sq yd multiplies by 9; each/box/roll return null", () => {
    expect(billedQtyToSqft(300, "sqft")).toBe(300);
    expect(billedQtyToSqft(22.22, "sqyd")).toBeCloseTo(199.98, 10);
    expect(billedQtyToSqft(8, "box")).toBeNull();
    expect(billedQtyToSqft(8, "each")).toBeNull();
    expect(billedQtyToSqft(2, "roll")).toBeNull();
    expect(billedQtyToSqft(0, "sqft")).toBeNull();
  });
});

describe("catalogRateToBillingUnit — SY is yards, never ×9", () => {
  it("a $20/SY carpet rate stays $20 on a sq-yd line", () => {
    expect(catalogRateToBillingUnit(20, "SY", true)).toBe(20);
    expect(catalogRateToBillingUnit(20, "sy", true)).toBe(20);
    expect(catalogRateToBillingUnit(20, "sq yd", true)).toBe(20);
    expect(unitIsSqyd("SY")).toBe(true);
  });

  it("a $2/sq ft carpet rate becomes $18 on a sq-yd line", () => {
    expect(catalogRateToBillingUnit(2, "sqft", true)).toBe(18);
    expect(catalogRateToBillingUnit(2, "sq ft", true)).toBe(18);
  });

  it("a $18/sq yd hardwood rate becomes $2 on a sq-ft line", () => {
    expect(catalogRateToBillingUnit(18, "sqyd", false)).toBe(2);
  });

  it("count units stay 1:1 even on a sq-yd job", () => {
    expect(catalogRateToBillingUnit(45.62, "each", true)).toBe(45.62);
    expect(catalogRateToBillingUnit(12, "roll", true)).toBe(12);
  });

  it("catalogUnitFactor keys off the printed billing unit, not leftover measure_unit", () => {
    // Carpet line: unit sq yd, leftover measure_unit sqft. Catalog SY → factor 1.
    expect(lineUnitKey({ unit: "sq yd", measure_unit: "sqft", sqft: 450 })).toBe("sqyd");
    expect(catalogUnitFactor("SY", lineUnitKey({ unit: "sq yd", measure_unit: "sqft", sqft: 450 }) === "sqyd")).toBe(1);
    // Using leftover measure_unit would have been ÷9.
    expect(catalogUnitFactor("SY", false)).toBe(1 / 9);
    expect(catalogUnitFactor("sqft", true)).toBe(9);
    expect(catalogUnitFactor("each", true)).toBe(1);
  });
});

describe("work-order lineSpec follows the same display unit", () => {
  it("count labor with measure_unit sqft prints each, not sq ft", () => {
    const spec = lineSpec({
      quantity: 2,
      unit: "each",
      measure_unit: "sqft",
      sqft: null,
      length_in: null,
      width_in: null,
      category: "labor",
    });
    expect(spec.unit).toBe("each");
    expect(spec.qty).toMatch(/2 each/);
    expect(spec.qty).not.toMatch(/sq ft/);
    expect(spec.cartons).toBe(0);
  });

  it("count labor that forgot unit still does not print sq ft", () => {
    const spec = lineSpec({
      quantity: 3,
      unit: null,
      measure_unit: "sqft",
      sqft: null,
      length_in: null,
      width_in: null,
      category: "labor",
    });
    expect(spec.unit).toBe("");
    expect(spec.qty).not.toMatch(/sq ft/);
    expect(spec.cartons).toBe(0);
  });

  it("carpet yards print sq yd next to the yard quantity", () => {
    const spec = lineSpec({
      quantity: 50,
      unit: "sq yd",
      measure_unit: "sqyd",
      sqft: 450,
      length_in: null,
      width_in: null,
      category: "carpet",
    });
    expect(spec.unit).toBe("sq yd");
    expect(spec.qty).toMatch(/sq yd/);
    expect(spec.qty).not.toMatch(/50 sq ft/);
    expect(spec.cartons).toBe(0);
  });

  it("carpet pad billed in sq yd uses 30-yard rolls and does not divide yards by 9", () => {
    const spec = lineSpec({
      quantity: 50,
      unit: "SY",
      measure_unit: "sqft",
      sqft: 450,
      length_in: null,
      width_in: null,
      category: "underlayment",
    });
    expect(spec.unit).toBe("sq yd");
    expect(spec.qtyNum).toBe(50);
    expect(spec.rolls).toBe(Math.ceil(50 / PAD_ROLL_SQYD));
    expect(spec.rolls).toBe(2);
    expect(spec.rolls).not.toBe(Math.ceil(50 / 9 / PAD_ROLL_SQYD));
    expect(spec.cartons).toBe(0);
  });

  it("pad already counted in rolls is not converted as if it were square feet", () => {
    const spec = lineSpec({
      quantity: 2,
      unit: "roll",
      measure_unit: "sqft",
      sqft: null,
      length_in: null,
      width_in: null,
      category: "underlayment",
    });
    expect(spec.unit).toBe("roll");
    expect(spec.qtyNum).toBe(2);
    expect(spec.rolls).toBe(2);
    expect(spec.cartons).toBe(0);
  });

  it("laminate underlayment billed in sq ft is not invented as 30-yard carpet-pad rolls", () => {
    const spec = lineSpec({
      quantity: 270,
      unit: "sq ft",
      measure_unit: "sqft",
      sqft: 270,
      length_in: null,
      width_in: null,
      category: "underlayment",
    });
    expect(spec.unit).toBe("sq ft");
    expect(spec.qtyNum).toBe(270);
    expect(spec.rolls).toBe(0);
    expect(spec.cartons).toBe(0);
    expect(padRollCount("underlayment", 270, "sqft")).toBe(0);
    expect(padRollCount("underlayment", 50, "sqyd")).toBe(2);
  });

  it("wrap qty TBD leftover taped sq ft is not a work-order quantity", () => {
    const spec = lineSpec({
      quantity: null,
      unit: "box",
      measure_unit: "sqft",
      sqft: 300,
      length_in: null,
      width_in: null,
      category: "lvp",
      description:
        "Lifeproof Oak — wrap qty TBD (13 steps, tread + riser — not an automatic sq ft/step order)",
    });
    expect(spec.qtyNum).toBe(0);
    expect(spec.qty).not.toMatch(/sq ft/);
    expect(spec.qty).toBe("");
    expect(spec.cartons).toBe(0);
  });
});

describe("questionnaire emit still maps Amount onto the right unit", () => {
  it("sq yd Amount stores square feet and labels sq yd", () => {
    const mapped = questionnaireEmitToLineQty({
      emitUnit: "sqyd",
      per: "each",
      areaSqft: 0,
      qtyOverride: 50,
    });
    expect(mapped).toEqual({
      measure_unit: "sqyd",
      sqft: 450,
      quantity: 50,
      unit: "sq yd",
    });
    expect(lineDisplayUnit(mapped!)).toBe("sq yd");
    expect(lineUnitKey(mapped!)).toBe("sqyd");
  });

  it("toilets Amount stays each with sqft null", () => {
    const mapped = questionnaireEmitToLineQty({
      emitUnit: "each",
      per: "each",
      areaSqft: 400,
      qtyOverride: 2,
    });
    expect(mapped?.sqft).toBeNull();
    expect(mapped?.unit).toBe("each");
    expect(lineDisplayUnit(mapped!)).toBe("each");
    expect(lineUnitKey(mapped!)).toBe("each");
  });
});

describe("call sites no longer fall back measure_unit → sq ft on count lines", () => {
  it("the old unit || (measure_unit ? sq yd : sq ft) fallback is gone from src", () => {
    const files = [
      "src/lib/job-scope.ts",
      "src/lib/invoice-from-approval.ts",
      "src/lib/data/job-materials.ts",
      "src/lib/data/job-purchasing.ts",
      "src/lib/data/po-plan.ts",
      "src/lib/po-build.ts",
      "src/lib/installer-bill.ts",
      "src/app/(app)/estimates/estimate-builder.tsx",
      "src/app/(app)/estimates/[id]/page.tsx",
      "src/app/(app)/estimates/ai-actions.ts",
      "src/app/(app)/estimates/smart-actions.ts",
      "src/app/(app)/estimates/questionnaire.tsx",
    ];
    for (const rel of files) {
      const src = readFileSync(join(root, rel), "utf8");
      expect(src, rel).not.toMatch(
        /unit \|\| \(.*measure_unit === ["']sqyd["'] \? ["']sq ?yd["']/,
      );
      expect(src, rel).toMatch(/lineDisplayUnit|lineUnitKey/);
    }
  });
});

describe("measured sq ft is never labeled as a carpet order in sq yd", () => {
  it("customer areas card uses equivalent-area copy, not a bare sq yd order", () => {
    const src = readFileSync(join(root, "src/app/(app)/customers/[id]/areas-card.tsx"), "utf8");
    expect(src).toMatch(/formatMeasuredLabel/);
    expect(src).toMatch(/showEquivalentYd/);
    expect(src).not.toMatch(/total \/ 9\) \* 100\) \/ 100} sq yd/);
  });

  it("area calculator labels ÷ 9 as equivalent area, not Total sq yd (carpet)", () => {
    const src = readFileSync(join(root, "src/components/area-calculator.tsx"), "utf8");
    expect(src).toMatch(/formatEquivalentSqyd/);
    expect(src).toMatch(/Equivalent sq yd — not an order/);
    expect(src).not.toMatch(/Total sq yd \(carpet\)/);
    expect(src).not.toMatch(/totalSqyd = totalSqft \/ 9/);
  });

  it("inventory roll receive uses rollReceiveUnit, not includes(yd) or invented sq yd", () => {
    const src = readFileSync(join(root, "src/app/(app)/inventory/[id]/page.tsx"), "utf8");
    expect(src).toMatch(/rollReceiveUnit\(product\.unit\)/);
    expect(src).toMatch(/Unit TBD/);
    expect(src).not.toMatch(/product\.unit\?\.includes\(["']yd["']\)/);
    expect(src).not.toMatch(/unitIsSqyd\(product\.unit\)/);
  });

  it("catalog CSV import maps SY via normalizeUnit, not includes(yd)", () => {
    const src = readFileSync(join(root, "src/lib/catalog-csv.ts"), "utf8");
    expect(src).toMatch(/normalizeUnit/);
    expect(src).not.toMatch(/u\.includes\(["']yd["']\)/);
    expect(normUnit("SY")).toBe("sqyd");
    expect(normUnit("sq yd")).toBe("sqyd");
    expect(normUnit("hydronic")).toBe("sqft");
    expect(normUnit("lnft")).toBe("lnft");
    expect(normUnit("each")).toBe("each");
  });

  it("picking a catalog SKU does not plant sq ft when the unit is missing", () => {
    expect(pickedProductUnit("", "other")).toBe("");
    expect(pickedProductUnit("", "carpet")).toBe("sqyd");
    expect(pickedProductUnit("gal", "other")).toBe("gal");
    expect(defaultUnitForCategory("other")).toBe("");
    const q = readFileSync(join(root, "src/app/(app)/estimates/questionnaire.tsx"), "utf8");
    expect(q).toMatch(/pickedProductUnit\(p\.unit, p\.category\)/);
    expect(q).not.toMatch(/p\.unit \|\| "sqft"/);
    const picker = readFileSync(join(root, "src/app/(app)/estimates/product-picker.tsx"), "utf8");
    expect(picker).not.toMatch(/initialCategory \|\| "lvp"/);
  });
});
