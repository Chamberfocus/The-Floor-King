/**
 * Downstream protections — estimate → invoice / PO / WO / staging parity.
 *
 * Business decisions (Step 2):
 *   1) Invoice conversion bills canonical lineTotal (waste on material + labor).
 *   2) PO material quantities use lineOrderQty (waste in), matching staging.
 *
 * Work-order display quantities remain lineQty (measured/job scope).
 */
import { describe, expect, it } from "vitest";
import {
  lineOrderQty,
  lineQty,
  lineTotal,
  optionTotalsWithDiscount,
  type CalcLine,
} from "@/lib/estimate-calc";
import { invoiceTotals } from "@/lib/invoice-calc";
import { buildPoItemRows } from "@/lib/po-build";
import { poItemTotal, poTotal } from "@/lib/po-calc";
import type { EstimateLineItem } from "@/lib/types";

/**
 * Mirrors invoices/actions.ts invoiceItemFromEstimateLine money:
 * shown qty = rounded lineQty; rate adjusted so qty × rate === lineTotal.
 */
function invoiceConversionAmount(l: CalcLine): {
  quantity: number;
  rate: number;
  amount: number;
} {
  if (l.line_type === "flat") {
    const amount = Number(l.flat_amount) || 0;
    return { quantity: 1, rate: amount, amount };
  }
  const fullTotal = lineTotal(l);
  const shownQty = Math.round(lineQty(l) * 100) / 100;
  const rate = shownQty > 0 ? fullTotal / shownQty : 0;
  return { quantity: shownQty, rate, amount: shownQty * rate };
}

function asEstLine(partial: Partial<EstimateLineItem> & CalcLine): EstimateLineItem {
  const nOrNull = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  return {
    id: typeof partial.id === "string" ? partial.id : "line-1",
    option_id: typeof partial.option_id === "string" ? partial.option_id : "opt-1",
    position: typeof partial.position === "number" ? partial.position : 0,
    room: partial.room ?? null,
    description: partial.description ?? "Material",
    note: partial.note ?? null,
    line_type: partial.line_type,
    sqft: nOrNull(partial.sqft),
    length_in: nOrNull(partial.length_in),
    width_in: nOrNull(partial.width_in),
    measure_unit: partial.measure_unit === "sqyd" ? "sqyd" : "sqft",
    material_rate: nOrNull(partial.material_rate),
    labor_rate: nOrNull(partial.labor_rate),
    installed_rate: nOrNull(partial.installed_rate),
    flat_amount: nOrNull(partial.flat_amount),
    waste_pct: nOrNull(partial.waste_pct) ?? 0,
    product_id: partial.product_id ?? null,
    manufacturer: partial.manufacturer ?? null,
    style: partial.style ?? null,
    color: partial.color ?? null,
    item_no: partial.item_no ?? null,
    material_cost: nOrNull(partial.material_cost),
    labor_cost: nOrNull(partial.labor_cost),
    quantity: nOrNull(partial.quantity),
    unit: partial.unit ?? null,
    category: (partial.category as EstimateLineItem["category"]) ?? null,
    from_stock: partial.from_stock ?? false,
    order_as_roll: partial.order_as_roll ?? false,
    roll_width_ft: nOrNull(partial.roll_width_ft),
    sqft_per_box: nOrNull(partial.sqft_per_box),
    is_fill: partial.is_fill ?? false,
    is_optional: partial.is_optional ?? false,
    measurements: partial.measurements ?? null,
  };
}

describe("WORK ORDER quantities — lineQty (bill / scope display)", () => {
  it("WO bill quantity for area lines is the measured qty (no waste baked into qty)", () => {
    const line: CalcLine = {
      line_type: "mat_labor",
      unit: "sq ft",
      sqft: 500,
      waste_pct: 10,
      material_rate: 4,
    };
    // Work-order scope displays lineQty; waste is in the money via lineTotal.
    expect(lineQty(line)).toBe(500);
    expect(lineTotal(line)).toBe(2200); // 500 × 4 × 1.1
  });
});

describe("STAGING / MATERIAL quantities — lineOrderQty (waste in)", () => {
  it("staging reserves / stages measured qty × waste", () => {
    const line: CalcLine = {
      line_type: "mat_labor",
      category: "lvp",
      unit: "sq ft",
      sqft: 500,
      waste_pct: 10,
      material_rate: 4,
      material_cost: 2,
    };
    // Matches getJobMaterials: Math.round(lineOrderQty * 100) / 100
    expect(Math.round(lineOrderQty(line) * 100) / 100).toBe(550);
  });
});

describe("PURCHASE ORDER quantities — buildPoItemRows (order qty with waste)", () => {
  it("PO create qty matches lineOrderQty / staging for cut goods", () => {
    const line = asEstLine({
      id: "p1",
      line_type: "mat_labor",
      category: "lvp",
      unit: "sq ft",
      sqft: 500,
      waste_pct: 10,
      product_id: "prod-lvp",
      description: "LVP",
      material_cost: 2,
    });
    const rows = buildPoItemRows([line], {
      costOf: () => 2,
      nameOf: (l) => l.description,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(550); // 500 × 1.10
    expect(rows[0].quantity).toBe(Math.round(lineOrderQty(line) * 100) / 100);
    expect(poItemTotal(rows[0])).toBe(1100); // 550 × $2
  });

  it("consolidates the same product across rooms into one PO line", () => {
    const a = asEstLine({
      id: "a",
      product_id: "same",
      description: "LVP",
      room: "Living",
      line_type: "mat_labor",
      unit: "sq ft",
      sqft: 200,
      waste_pct: 0,
    });
    const b = asEstLine({
      id: "b",
      product_id: "same",
      description: "LVP",
      room: "Kitchen",
      line_type: "mat_labor",
      unit: "sq ft",
      sqft: 150,
      waste_pct: 0,
    });
    const rows = buildPoItemRows([a, b], {
      costOf: () => 1,
      nameOf: (l) => l.description,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(350);
    expect(poTotal(rows)).toBe(350);
  });

  it("roll goods: sums sqyd via lineOrderQty (waste in)", () => {
    const roll = asEstLine({
      id: "r1",
      product_id: "carpet-1",
      description: "Carpet",
      line_type: "mat_labor",
      category: "carpet",
      unit: "sq yd",
      measure_unit: "sqyd",
      sqft: 360, // 40 sq yd measured → 44 ordered
      waste_pct: 10,
      order_as_roll: true,
      roll_width_ft: 12,
    });
    const rows = buildPoItemRows([roll], {
      costOf: () => 20,
      nameOf: (l) => l.description,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].unit).toBe("sqyd");
    expect(rows[0].quantity).toBe(44);
  });
});

describe("INVOICE totals — after conversion to invoice_items", () => {
  it("invoiceTotals is the money engine once items exist (deposit / balance)", () => {
    const items = [
      { quantity: 40, rate: 33 }, // 1320
      { quantity: 1, rate: -100 },
    ];
    const t = invoiceTotals(items, 8, 400);
    expect(t.subtotal).toBe(1220);
    expect(t.tax).toBeCloseTo(97.6, 10);
    expect(t.total).toBeCloseTo(1317.6, 10);
    expect(t.paid).toBe(400);
    expect(t.balance).toBeCloseTo(917.6, 10);
  });

  it("invoice conversion amount equals canonical lineTotal (incl. waste × labor)", () => {
    const mixed: CalcLine = {
      line_type: "mat_labor",
      category: "lvp",
      unit: "sq ft",
      sqft: 500,
      waste_pct: 10,
      material_rate: 4.5,
      labor_rate: 2.0,
    };
    const conv = invoiceConversionAmount(mixed);
    expect(lineTotal(mixed)).toBeCloseTo(3575, 10);
    expect(conv.quantity).toBe(500); // measured qty still shown
    expect(conv.amount).toBeCloseTo(3575, 10);
    expect(conv.amount).toBeCloseTo(lineTotal(mixed), 10);
  });
});

describe("PARITY — estimate ↔ invoice ↔ staging ↔ PO ↔ stock pull (Step 2+3)", () => {
  const mixed: CalcLine = {
    line_type: "mat_labor",
    category: "lvp",
    unit: "sq ft",
    sqft: 500,
    waste_pct: 10,
    material_rate: 4.5,
    labor_rate: 2.0,
  };

  it("estimate lineTotal applies waste to material AND labor → $3575", () => {
    expect(lineTotal(mixed)).toBeCloseTo(3575, 10);
  });

  it("invoice conversion represents the same $3575", () => {
    expect(invoiceConversionAmount(mixed).amount).toBeCloseTo(3575, 10);
  });

  it("work-order measured qty stays 500 (not blindly changed to order qty)", () => {
    expect(lineQty(mixed)).toBe(500);
  });

  it("staging and PO order qty both equal 550", () => {
    const stageQty = Math.round(lineOrderQty(mixed) * 100) / 100;
    const poRows = buildPoItemRows(
      [
        asEstLine({
          id: "parity",
          product_id: "prod",
          description: "LVP",
          line_type: "mat_labor",
          category: "lvp",
          unit: "sq ft",
          sqft: 500,
          waste_pct: 10,
          material_rate: 4.5,
          labor_rate: 2.0,
        }),
      ],
      { costOf: () => 1, nameOf: (l) => l.description },
    );
    expect(stageQty).toBe(550);
    expect(poRows[0].quantity).toBe(550);
    expect(poRows[0].quantity).toBe(stageQty);
  });

  it("stock pull need also equals 550 (Step 3 D2)", async () => {
    const { stockPullNeedQty, materialNeedQty } = await import(
      "@/lib/job-operational-scope"
    );
    expect(stockPullNeedQty(mixed)).toBe(550);
    expect(stockPullNeedQty(mixed)).toBe(materialNeedQty(mixed));
  });
});

describe("Estimate commercial totals remain the source of truth", () => {
  it("optionTotalsWithDiscount is the commercial total source of truth", () => {
    const lines: CalcLine[] = [
      {
        line_type: "mat_labor",
        category: "carpet",
        unit: "sq yd",
        measure_unit: "sqyd",
        sqft: 360,
        waste_pct: 10,
        material_rate: 30,
      },
      {
        line_type: "flat",
        flat_amount: 100,
      },
    ];
    const t = optionTotalsWithDiscount(lines, 8, "percent", 10);
    expect(t.subtotal).toBe(1420);
    expect(t.discount).toBe(142);
    expect(t.tax).toBeCloseTo(102.24, 10);
    expect(t.total).toBeCloseTo(1380.24, 10);
  });
});
