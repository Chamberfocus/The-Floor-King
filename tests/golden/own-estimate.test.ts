/**
 * Build-it-myself quotes stay short, and the saved line is the one the
 * purchase order and work order already know how to read.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lineQty, lineTotal, type CalcLine } from "@/lib/estimate-calc";
import { buildJobScope, isMaterialLine } from "@/lib/job-scope";
import { draftLineFromCustom, draftLineFromProduct } from "@/lib/own-estimate";
import { quickEstimateLineRow, rescaleQuotedUnit } from "@/lib/quick-estimate";
import type { EstimateLineItem } from "@/lib/types";

function src(path: string) {
  return readFileSync(path, "utf8");
}

function asScopeLine(
  row: ReturnType<typeof quickEstimateLineRow>,
  id: string,
): EstimateLineItem {
  return {
    id,
    option_id: "opt",
    note: null,
    length_in: null,
    width_in: null,
    installed_rate: null,
    flat_amount: null,
    ...row,
  } as EstimateLineItem;
}

const pricing = { targetMarginPct: 40, freightMarkupPct: 0 };

describe("build it myself", () => {
  it("keeps a room, a product, and box or roll coverage for the purchase order", () => {
    const draft = draftLineFromProduct(
      {
        id: "prod-1",
        name: "Calm Tide",
        category: "carpet",
        unit: "sqyd",
        material_rate: 8,
        labor_rate: 0,
        sku: "SH-1",
        manufacturer: "Shaw",
        style: "Calm",
        color: "Tide",
        roll_width_ft: 12,
      },
      "Living room",
      pricing,
    );
    expect(draft.productId).toBe("prod-1");
    expect(draft.category).toBe("carpet");
    expect(draft.unit).toBe("sqyd");
    expect(draft.sku).toBe("SH-1");
    expect(draft.rollWidthFt).toBe(12);
    expect(Number(draft.cost)).toBe(8);
    expect(Number(draft.rate)).toBeGreaterThan(8);

    const row = quickEstimateLineRow({ ...draft, quantity: "50" }, 0);
    expect(row.room).toBe("Living room");
    expect(row.item_no).toBe("SH-1");
    expect(row.manufacturer).toBe("Shaw");
    expect(row.style).toBe("Calm");
    expect(row.color).toBe("Tide");
    expect(row.roll_width_ft).toBe(12);
    expect(row.sqft_per_box).toBeNull();
    expect(row.sqft).toBe(450);
    expect(row.product_id).toBe("prod-1");
    expect(row.line_type).toBe("mat_labor");
    expect(row.category).not.toBe("labor");
    expect(isMaterialLine(row)).toBe(true);
    expect(lineQty(row as CalcLine)).toBe(50);
    expect(lineTotal(row as CalcLine)).toBe(50 * Number(draft.rate));

    const lvp = draftLineFromProduct(
      {
        id: "lvp-1",
        name: "Oak",
        category: "lvp",
        unit: "sqft",
        material_rate: 3,
        labor_rate: 0,
        sku: null,
        manufacturer: null,
        style: "Oak",
        color: null,
        sqft_per_box: 24,
      },
      "Kitchen",
      pricing,
    );
    const lvpRow = quickEstimateLineRow({ ...lvp, quantity: 120 }, 0);
    expect(lvp.unit).toBe("sqft");
    expect(lvpRow.sqft_per_box).toBe(24);
    expect(lvpRow.sqft).toBe(120);
    expect(lvpRow.room).toBe("Kitchen");
    expect(isMaterialLine(lvpRow)).toBe(true);
  });

  it("keeps labor as work in the room, with no product to order", () => {
    const draft = draftLineFromProduct(
      {
        id: "labor-sku",
        name: "Install",
        category: "labor",
        unit: "hour",
        material_rate: 10,
        labor_rate: 45,
        sku: "LAB",
        manufacturer: "Shop",
        style: null,
        color: null,
      },
      "Living room",
      pricing,
    );
    expect(draft.productId).toBeNull();
    expect(draft.category).toBe("labor");
    expect(draft.sku).toBeNull();
    expect(draft.manufacturer).toBeNull();
    expect(draft.rate).toBe("45");

    const labor = quickEstimateLineRow({ ...draft, quantity: 2 }, 1);
    expect(labor.product_id).toBeNull();
    expect(labor.category).toBe("labor");
    expect(labor.material_rate).toBe(0);
    expect(labor.labor_rate).toBe(45);
    expect(labor.room).toBe("Living room");
    expect(isMaterialLine(labor)).toBe(false);
    expect(lineTotal(labor as CalcLine)).toBe(90);

    const carpet = quickEstimateLineRow(
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
        room: "Living room",
        sku: "SH-1",
        rollWidthFt: 12,
      },
      0,
    );
    const scope = buildJobScope(
      [asScopeLine(carpet, "m"), asScopeLine(labor, "l")],
      null,
    );
    expect(scope.rooms.map((r) => r.name)).toEqual(["Living room"]);
    expect(scope.rooms[0]?.products).toHaveLength(1);
    expect(scope.rooms[0]?.labor).toHaveLength(1);
    expect(scope.wholeJob.products).toHaveLength(0);

    const whole = quickEstimateLineRow(
      { description: "Haul away", quantity: 1, unit: "each", rate: 75, category: "labor" },
      0,
    );
    expect(whole.room).toBeNull();
    expect(whole.product_id).toBeNull();
    expect(whole.sqft_per_box).toBeNull();
    const open = buildJobScope([asScopeLine(whole, "w")], null);
    expect(open.rooms).toHaveLength(0);
    expect(open.wholeJob.labor).toHaveLength(1);
  });

  it("does not turn a one-off labor note into a product", () => {
    const work = draftLineFromCustom(
      {
        name: "Move appliances",
        category: "labor",
        unit: "each",
        material_rate: "80",
        labor_rate: "",
        manufacturer: "Nope",
        style: "Nope",
        color: "",
        sku: "NO",
        coverage_sqft: "10",
        coverage_thickness_in: "",
      },
      "",
    );
    expect(work.productId).toBeNull();
    expect(work.manufacturer).toBeNull();
    expect(work.sku).toBeNull();
    expect(work.coverageSqft).toBeNull();
    expect(work.rate).toBe("80");
    const row = quickEstimateLineRow({ ...work, quantity: 1 }, 0);
    expect(isMaterialLine(row)).toBe(false);
    expect(row.product_id).toBeNull();

    const nose = draftLineFromCustom(
      {
        name: "Oak stair nose",
        category: "trim",
        unit: "each",
        material_rate: "12",
        labor_rate: "4",
        manufacturer: "Mill",
        style: "",
        color: "Oak",
        sku: "N-1",
        coverage_sqft: "",
        coverage_thickness_in: "",
      },
      "Stairs",
    );
    expect(nose.productId).toBeNull();
    expect(nose.rate).toBe("12");
    const noseRow = quickEstimateLineRow({ ...nose, quantity: 3 }, 0);
    expect(isMaterialLine(noseRow)).toBe(true);
    expect(noseRow.item_no).toBe("N-1");
    expect(noseRow.room).toBe("Stairs");
    expect(lineTotal(noseRow as CalcLine)).toBe(36);
  });

  it("switches sq ft and sq yd without changing the line total", () => {
    const toFt = rescaleQuotedUnit(
      { quantity: "50", rate: "18", cost: "9", unit: "sq yd" },
      "sqft",
    );
    expect(toFt).toEqual({ quantity: "450", rate: "2", cost: "1", unit: "sqft" });
    const back = rescaleQuotedUnit(toFt, "sqyd");
    expect(back).toEqual({ quantity: "50", rate: "18", cost: "9", unit: "sqyd" });

    const stayed = rescaleQuotedUnit(
      { quantity: "2", rate: "75", cost: "0", unit: "each" },
      "hour",
    );
    expect(stayed).toEqual({ quantity: "2", rate: "75", cost: "0", unit: "hour" });
  });

  it("opens a short quote instead of an empty full builder", () => {
    const start = src("src/components/new-estimate.tsx");
    expect(start).toContain("/estimates/build?");
    expect(start).not.toContain("await createEstimate");
    const page = src("src/app/(app)/estimates/build/page.tsx");
    expect(page).not.toContain('.from("products")');
    expect(page).toContain("serviceAddressId");
    const actions = src("src/app/(app)/estimates/quick/actions.ts");
    expect(actions).toContain("service_address_id: serviceAddressId");
    expect(actions).toContain("quickEstimateLineRow");
    expect(src("src/app/(app)/estimates/quick/page.tsx")).toContain("serviceAddressId");
  });
});
