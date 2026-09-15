/**
 * Guided questionnaire Amount → builder estimate line quantity.
 *
 * Root cause: number questions stored Amount on `quantity` while labeling the
 * line sq ft / sq yd. The builder prices/displays area lines from `sqft` and
 * hides quantity, so Amount vanished from the visible field.
 */
import { describe, expect, it } from "vitest";
import { lineQty, lineTotal, type CalcLine } from "@/lib/estimate-calc";
import {
  questionnaireEmitToLineQty,
  recoverAreaSqftFromQuantity,
  smartLineToCalcLine,
} from "@/lib/questionnaire-emit";

describe("questionnaire Amount → builder line fields", () => {
  it("sq ft Amount lands in sqft AND quantity so the builder Sq ft field fills", () => {
    const mapped = questionnaireEmitToLineQty({
      emitUnit: "sqft",
      per: "each",
      areaSqft: 800,
      qtyOverride: 250,
    });
    expect(mapped).toEqual({
      measure_unit: "sqft",
      sqft: 250,
      quantity: 250,
      unit: "sq ft",
    });
    const calc = smartLineToCalcLine({
      category: "labor",
      ...mapped!,
      material_rate: 0,
      labor_rate: 2,
      material_cost: 0,
      labor_cost: 1,
      waste_pct: 0,
    });
    expect(lineQty(calc)).toBe(250);
    expect(lineTotal(calc)).toBe(500);
  });

  it("sq yd Amount is stored as square feet (×9) so lineQty bills yards", () => {
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
    expect(lineQty({ ...mapped!, line_type: "mat_labor" } as CalcLine)).toBe(50);
  });

  it("count Amount (each / lnft) stays on quantity with sqft null", () => {
    const each = questionnaireEmitToLineQty({
      emitUnit: "each",
      per: "each",
      areaSqft: 400,
      qtyOverride: 12.5,
    });
    expect(each).toEqual({
      measure_unit: "sqft",
      sqft: null,
      quantity: 12.5,
      unit: "each",
    });
    expect(lineQty(smartLineToCalcLine({
      category: "other",
      ...each!,
      material_rate: 10,
      labor_rate: 0,
      material_cost: 4,
      labor_cost: 0,
      waste_pct: 0,
    }))).toBe(12.5);

    const lnft = questionnaireEmitToLineQty({
      emitUnit: "lnft",
      per: "each",
      areaSqft: 400,
      qtyOverride: 36,
    });
    expect(lnft?.sqft).toBeNull();
    expect(lnft?.quantity).toBe(36);
    expect(lnft?.unit).toBe("lnft");
  });

  it("decimal and large Amounts transfer without falling back to 1 or 0", () => {
    expect(
      questionnaireEmitToLineQty({
        emitUnit: "sqft",
        per: "each",
        areaSqft: 0,
        qtyOverride: 12.75,
      })?.sqft,
    ).toBe(12.75);
    expect(
      questionnaireEmitToLineQty({
        emitUnit: "each",
        per: "each",
        areaSqft: 0,
        qtyOverride: 10000,
      })?.quantity,
    ).toBe(10000);
  });

  it("Amount 0 / negative / non-finite skip the line (no silent qty 1)", () => {
    expect(
      questionnaireEmitToLineQty({
        emitUnit: "sqft",
        per: "each",
        areaSqft: 500,
        qtyOverride: 0,
      }),
    ).toBeNull();
    expect(
      questionnaireEmitToLineQty({
        emitUnit: "each",
        per: "each",
        areaSqft: 500,
        qtyOverride: -3,
      }),
    ).toBeNull();
    expect(
      questionnaireEmitToLineQty({
        emitUnit: "each",
        per: "each",
        areaSqft: 500,
        qtyOverride: Number.NaN,
      }),
    ).toBeNull();
  });

  it("yes/no per=area still uses measured sqft (does not invent a second qty)", () => {
    const mapped = questionnaireEmitToLineQty({
      emitUnit: "sqft",
      per: "area",
      areaSqft: 723.4,
    });
    expect(mapped?.sqft).toBe(723.4);
    expect(mapped?.quantity).toBe(724);
    expect(mapped?.unit).toBe("sq ft");
  });

  it("yes/no per=each (qty 1) is unchanged — not an Amount override", () => {
    const mapped = questionnaireEmitToLineQty({
      emitUnit: "each",
      per: "each",
      areaSqft: 500,
    });
    expect(mapped).toEqual({
      measure_unit: "sqft",
      sqft: null,
      quantity: 1,
      unit: "each",
    });
  });

  it("same answers emit the same qty — regeneration does not invent extra lines", () => {
    const a = questionnaireEmitToLineQty({
      emitUnit: "sqft",
      per: "each",
      areaSqft: 100,
      qtyOverride: 80,
    });
    const b = questionnaireEmitToLineQty({
      emitUnit: "sqft",
      per: "each",
      areaSqft: 100,
      qtyOverride: 80,
    });
    expect(a).toEqual(b);
  });
});

describe("reload hydration recovers Amount stored only on quantity", () => {
  it("copies quantity into empty sqft on an area-unit line", () => {
    expect(
      recoverAreaSqftFromQuantity({
        unit: "sq ft",
        sqft: null,
        quantity: 250,
      }),
    ).toBe("250");
  });

  it("converts stored sq-yd quantity back to square feet", () => {
    expect(
      recoverAreaSqftFromQuantity({
        unit: "sq yd",
        sqft: "",
        quantity: 40,
      }),
    ).toBe("360");
  });

  it("does not overwrite a real stored sqft", () => {
    expect(
      recoverAreaSqftFromQuantity({
        unit: "sq ft",
        sqft: 180,
        quantity: 1,
      }),
    ).toBe("180");
  });

  it("does not invent sqft for count units", () => {
    expect(
      recoverAreaSqftFromQuantity({
        unit: "each",
        sqft: null,
        quantity: 12,
      }),
    ).toBe("");
  });
});

describe("PRICE NEEDED / product path is not this mapper", () => {
  it("product area still prices from measured sqft via lineQty (no Amount override)", () => {
    const line: CalcLine = {
      line_type: "mat_labor",
      category: "lvp",
      unit: "sq ft",
      measure_unit: "sqft",
      sqft: 500,
      quantity: 500,
      material_rate: 0, // PRICE NEEDED
      labor_rate: 2,
      material_cost: 3,
      labor_cost: 1,
      waste_pct: 0,
    };
    expect(lineQty(line)).toBe(500);
    expect(lineTotal(line)).toBe(1000);
  });
});
