/**
 * Add-ons and subfloor accept a typed cost. A sheet price or a flat amount
 * is a real price — the line must not stay on PRICE NEEDED.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRICE_NEEDED } from "@/lib/catalog-pricing";
import { lineTotal } from "@/lib/estimate-calc";
import { ratesFromTargetMargin } from "@/lib/estimate-pricing";
import { materialSellUnresolved } from "@/lib/guided-estimate-price";
import { subfloorSheetCost } from "@/lib/price-book";

describe("subfloor and add-on prices", () => {
  it("starts 1/2 inch subfloor from the sheet cost and leaves custom blank", () => {
    expect(subfloorSheetCost('1/2" subfloor')).toBe(69.8);
    expect(subfloorSheetCost('1/2" Plywood')).toBe(69.8);
    expect(subfloorSheetCost("1/2 plywood")).toBe(69.8);
    expect(subfloorSheetCost('5/8" subfloor')).toBe(78.85);
    expect(subfloorSheetCost("Custom")).toBeNull();
    expect(subfloorSheetCost("Confirm on job site")).toBeNull();
  });

  it("treats a typed cost, installed rate, or flat amount as priced", () => {
    expect(
      materialSellUnresolved({
        category: "carpet",
        material_rate: "",
        material_cost: "",
      }),
    ).toBe(true);
    expect(
      materialSellUnresolved({
        category: "underlayment",
        material_rate: 0,
        material_cost: 69.8,
      }),
    ).toBe(false);
    expect(
      materialSellUnresolved({
        category: "underlayment",
        material_rate: 0,
        material_cost: 0,
        installed_rate: 80,
      }),
    ).toBe(false);
    expect(
      materialSellUnresolved({
        category: "other",
        material_rate: 0,
        material_cost: 0,
        flat_amount: 150,
      }),
    ).toBe(false);
    expect(
      materialSellUnresolved({
        category: "labor",
        material_rate: 0,
        material_cost: 0,
      }),
    ).toBe(false);
  });

  it("bills sheet count times the sell that comes from our cost", () => {
    const cost = subfloorSheetCost('1/2" subfloor');
    const rates = ratesFromTargetMargin({
      lineType: "mat_labor",
      laborOnly: false,
      materialCost: cost,
      laborCost: 0,
      targetMarginPct: 40,
      freightMarkupPct: 0,
    });
    expect(rates.material_rate).toBeGreaterThan(cost ?? 0);
    const total = lineTotal({
      line_type: "mat_labor",
      category: "underlayment",
      unit: "sheet",
      quantity: 4,
      material_rate: rates.material_rate,
      material_cost: cost,
      labor_rate: 0,
      labor_cost: 0,
      waste_pct: 0,
    });
    expect(total).toBeCloseTo(4 * (rates.material_rate ?? 0), 5);
    expect(
      materialSellUnresolved({
        category: "underlayment",
        material_cost: cost,
        material_rate: rates.material_rate,
      }),
    ).toBe(false);
  });

  it("puts our cost on every add-on line in the builder", () => {
    const src = readFileSync("src/app/(app)/estimates/estimate-builder.tsx", "utf8");
    const addSubfloor = src.slice(src.indexOf("const addSubfloor"), src.indexOf("const addNamedArea"));
    expect(addSubfloor).toContain('line_type: "mat_labor"');
    expect(addSubfloor).toContain("subfloorSheetCost");
    expect(addSubfloor).not.toContain('line_type: "installed"');
    expect(addSubfloor).not.toContain("setActiveLine");
    const addAddon = src.slice(src.indexOf("const addAddon"), src.indexOf("const addSubfloor"));
    expect(addAddon).not.toContain("setActiveLine");
    expect(src).toContain("function DirectPriceBar");
    expect(src).toContain("Our cost");
    expect(src).toContain(PRICE_NEEDED);
    expect(src).toContain("type our cost or a sell price");
  });

  it("shows an editable cost on every item, including catalog flooring", () => {
    const src = readFileSync("src/app/(app)/estimates/estimate-builder.tsx", "utf8");
    const card = src.slice(src.indexOf("Summary row"), src.indexOf("Editor — opens"));
    expect(card).toContain("<DirectPriceBar");
    expect(card).toContain("showQty={directPrice}");
    expect(card).toContain("changeLineCost");
    expect(card).not.toContain("{directPrice ? (");
    expect(card).toContain('Cost {sCost > 0 ? formatMoney(sCost) : "—"}');
  });
});
