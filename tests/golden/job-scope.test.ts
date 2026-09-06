/**
 * Step 3 — operational job scope.
 *
 * Business decisions:
 *   D1 — Unify ops around job_line_items; seed on job create (idempotent).
 *   D2 — Stock pull need = lineOrderQty (agree with stage / reserve / PO).
 *   D3 — Job edits do not rewrite the approved estimate.
 *   D4 — Installer / bill use the same operational job scope as staff WO.
 *
 * Pre-implementation characterization of D2 asymmetry lived here briefly as
 * "pull used lineQty"; after wiring, assertions encode intended policy.
 */
import { describe, expect, it } from "vitest";
import {
  lineOrderQty,
  lineQty,
  lineTotal,
  type CalcLine,
} from "@/lib/estimate-calc";
import {
  buildJobLineSeedRows,
  materialNeedQty,
  resolveOperationalLines,
  shouldSeedJobScope,
  stockPullNeedQty,
  workOrderMeasuredQty,
} from "@/lib/job-operational-scope";
import { laborBillLinesFromScope } from "@/lib/installer-bill";
import { buildJobScope } from "@/lib/job-scope";
import type { EstimateLineItem } from "@/lib/types";

const area500w10: CalcLine = {
  line_type: "mat_labor",
  category: "lvp",
  unit: "sq ft",
  sqft: 500,
  waste_pct: 10,
  material_rate: 4,
  material_cost: 2,
};

function estLine(
  partial: Partial<EstimateLineItem> & CalcLine & { id: string },
): EstimateLineItem {
  const nOrNull = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  return {
    id: partial.id,
    option_id: typeof partial.option_id === "string" ? partial.option_id : "opt-1",
    position: typeof partial.position === "number" ? partial.position : 0,
    room: partial.room ?? null,
    description: partial.description ?? "Line",
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

describe("resolveOperationalLines — prefer job scope", () => {
  it("uses job lines when present (even if estimate differs)", () => {
    const job = [
      estLine({
        id: "j1",
        description: "Job edit",
        line_type: "mat_labor",
        category: "lvp",
        unit: "sq ft",
        sqft: 520,
        waste_pct: 10,
        material_rate: 4,
      }),
    ];
    const est = [
      estLine({
        id: "e1",
        description: "Estimate",
        line_type: "mat_labor",
        category: "lvp",
        unit: "sq ft",
        sqft: 500,
        waste_pct: 10,
      }),
    ];
    const resolved = resolveOperationalLines(job, est);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].description).toBe("Job edit");
    expect(lineQty(resolved[0])).toBe(520);
  });

  it("falls back to estimate when job has no lines yet", () => {
    const est = [
      estLine({
        id: "e1",
        line_type: "mat_labor",
        category: "lvp",
        unit: "sq ft",
        sqft: 500,
        waste_pct: 10,
      }),
    ];
    expect(resolveOperationalLines([], est)).toEqual(est);
  });

  it("staff WO and installer resolve from the same lists identically", () => {
    const job = [
      estLine({
        id: "j1",
        note: "Installer: tape base",
        line_type: "mat_labor",
        category: "lvp",
        unit: "sq ft",
        sqft: 500,
        waste_pct: 10,
      }),
    ];
    const est = [
      estLine({
        id: "e1",
        line_type: "mat_labor",
        category: "lvp",
        unit: "sq ft",
        sqft: 500,
        waste_pct: 10,
      }),
    ];
    const staff = resolveOperationalLines(job, est);
    const installer = resolveOperationalLines(job, est);
    expect(staff).toEqual(installer);
    expect(buildJobScope(staff, null).rooms.length).toBe(
      buildJobScope(installer, null).rooms.length,
    );
  });
});

describe("shouldSeedJobScope — idempotent seed gate", () => {
  it("seeds only when empty", () => {
    expect(shouldSeedJobScope(0)).toBe(true);
    expect(shouldSeedJobScope(1)).toBe(false);
    expect(shouldSeedJobScope(12)).toBe(false);
  });
});

describe("buildJobLineSeedRows — copy estimate → job without mutating estimate", () => {
  it("attaches job_id and preserves estimate line ids", () => {
    const lines = [
      estLine({
        id: "line-a",
        description: "LVP",
        line_type: "mat_labor",
        category: "lvp",
        unit: "sq ft",
        sqft: 500,
        waste_pct: 10,
      }),
      estLine({
        id: "line-b",
        line_type: "mat_labor",
        category: "labor",
        unit: "sq ft",
        sqft: 500,
        labor_cost: 1.5,
        description: "Install",
      }),
    ];
    const rows = buildJobLineSeedRows(lines, "job-1");
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe("line-a");
    expect(rows[0].job_id).toBe("job-1");
    expect(rows[1].id).toBe("line-b");
    expect("job_id" in lines[0]).toBe(false);
  });

  it("second seed gate blocks overwrite of operational edits", () => {
    const seeded = buildJobLineSeedRows(
      [
        estLine({
          id: "line-a",
          line_type: "mat_labor",
          category: "lvp",
          unit: "sq ft",
          sqft: 500,
          waste_pct: 10,
        }),
      ],
      "job-1",
    );
    expect(shouldSeedJobScope(seeded.length)).toBe(false);
  });
});

describe("Quantity semantics — measured vs physical material need", () => {
  it("WO measured qty stays lineQty (500)", () => {
    expect(workOrderMeasuredQty(area500w10)).toBe(500);
    expect(workOrderMeasuredQty(area500w10)).toBe(lineQty(area500w10));
  });

  it("staging / reserve / PO material need is lineOrderQty (550)", () => {
    expect(materialNeedQty(area500w10)).toBe(550);
    expect(materialNeedQty(area500w10)).toBe(
      Math.round(lineOrderQty(area500w10) * 100) / 100,
    );
  });

  it("stock pull need matches material need (550) — Step 3 D2", () => {
    expect(stockPullNeedQty(area500w10)).toBe(550);
    expect(stockPullNeedQty(area500w10)).toBe(materialNeedQty(area500w10));
    expect(stockPullNeedQty(area500w10)).not.toBe(lineQty(area500w10));
  });

  it("reserve, stage, pull, PO physical qty all agree at 550", () => {
    const need = materialNeedQty(area500w10);
    expect(need).toBe(550);
    expect(stockPullNeedQty(area500w10)).toBe(need);
  });
});

describe("Job edits vs approved estimate (D3) — pure invariants", () => {
  it("operational edit of qty does not require changing estimate lineTotal", () => {
    const approved = estLine({
      id: "e1",
      line_type: "mat_labor",
      category: "lvp",
      unit: "sq ft",
      sqft: 500,
      waste_pct: 10,
      material_rate: 4.5,
      labor_rate: 2,
    });
    const approvedTotal = lineTotal(approved);
    const jobEdited = estLine({
      id: "e1",
      line_type: "mat_labor",
      category: "lvp",
      unit: "sq ft",
      sqft: 520,
      waste_pct: 10,
      material_rate: 4.5,
      labor_rate: 2,
      note: "Added closet",
    });
    expect(lineTotal(approved)).toBe(approvedTotal);
    expect(lineQty(jobEdited)).toBe(520);
    expect(materialNeedQty(jobEdited)).toBe(572); // 520 × 1.1
    expect(lineTotal(approved)).not.toBe(lineTotal(jobEdited));
  });
});

describe("Installer bill labor from operational scope (D4)", () => {
  it("bill lines come from the same labor lines staff WO would use", () => {
    const jobLabor = [
      estLine({
        id: "lab-1",
        line_type: "mat_labor",
        category: "labor",
        unit: "sq ft",
        sqft: 500,
        waste_pct: 10,
        labor_cost: 2,
        description: "Install LVP",
        room: "Living",
      }),
    ];
    const estimateLabor = [
      estLine({
        id: "lab-old",
        line_type: "mat_labor",
        category: "labor",
        unit: "sq ft",
        sqft: 400,
        labor_cost: 2,
        description: "Old estimate labor",
      }),
    ];
    const scope = resolveOperationalLines(jobLabor, estimateLabor);
    const bill = laborBillLinesFromScope(scope);
    expect(bill).toHaveLength(1);
    expect(bill[0].description).toContain("Install LVP");
    expect(bill[0].quantity).toBe(500);
  });
});

describe("Mixed stock + purchased — sourcing is per-line on operational rows", () => {
  it("from_stock and order lines can coexist in one job scope", () => {
    const stock = estLine({
      id: "s1",
      product_id: "prod-stock",
      from_stock: true,
      description: "Stock pad",
      line_type: "mat_labor",
      category: "underlayment",
      unit: "sq ft",
      sqft: 500,
      waste_pct: 10,
    });
    const order = estLine({
      id: "o1",
      product_id: "prod-order",
      from_stock: false,
      description: "Special-order LVP",
      line_type: "mat_labor",
      category: "lvp",
      unit: "sq ft",
      sqft: 500,
      waste_pct: 10,
    });
    const scope = resolveOperationalLines([stock, order], []);
    expect(scope).toHaveLength(2);
    expect(scope[0].from_stock).toBe(true);
    expect(scope[1].from_stock).toBe(false);
    expect(materialNeedQty(scope[0])).toBe(550);
    expect(materialNeedQty(scope[1])).toBe(550);
  });
});
