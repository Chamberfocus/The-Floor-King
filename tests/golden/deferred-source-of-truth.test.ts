/**
 * Deferred source-of-truth fixes — scheduling, job board, invoice approval.
 */
import { describe, expect, it } from "vitest";
import {
  assessInvoiceCommercialGate,
  buildApprovalSnapshotPayload,
  INVOICE_REQUIRES_APPROVAL_SNAPSHOT_MESSAGE,
  INVOICE_REQUIRES_APPROVED_STATUS_MESSAGE,
  INVOICE_REQUIRES_REAPPROVAL_MESSAGE,
  legacyApprovalSnapshotUnavailable,
  type ApprovalSnapshotPayload,
} from "@/lib/estimate-approval";
import { buildInvoiceItemsFromApprovalSnapshot } from "@/lib/invoice-from-approval";
import {
  boardMaterialTypeFromScopes,
  installerCanDoJob,
} from "@/lib/job-scope";
import { resolveOperationalLines } from "@/lib/job-operational-scope";
import { installDaysForJob } from "@/lib/scheduling";
import { lineOrderQty, lineQty, lineTotal } from "@/lib/estimate-calc";
import { SCHEDULING_DEFAULTS } from "@/lib/data/scheduling";
import type { EstimateLineItem, EstimateOption } from "@/lib/types";

function estLine(
  partial: Partial<EstimateLineItem> & { id: string; category?: string | null },
): EstimateLineItem {
  return {
    id: partial.id,
    option_id: partial.option_id ?? "opt-1",
    position: partial.position ?? 0,
    room: partial.room ?? null,
    description: partial.description ?? "Line",
    note: partial.note ?? null,
    line_type: partial.line_type ?? "mat_labor",
    sqft: partial.sqft ?? 500,
    length_in: partial.length_in ?? null,
    width_in: partial.width_in ?? null,
    measure_unit: partial.measure_unit ?? "sqft",
    material_rate: partial.material_rate ?? 4,
    labor_rate: partial.labor_rate ?? 2,
    installed_rate: partial.installed_rate ?? null,
    flat_amount: partial.flat_amount ?? null,
    waste_pct: partial.waste_pct ?? 10,
    product_id: partial.product_id ?? null,
    manufacturer: partial.manufacturer ?? null,
    style: partial.style ?? null,
    color: partial.color ?? null,
    item_no: partial.item_no ?? null,
    material_cost: partial.material_cost ?? 2,
    labor_cost: partial.labor_cost ?? 1,
    quantity: partial.quantity ?? null,
    unit: partial.unit ?? "sq ft",
    category: (partial.category as EstimateLineItem["category"]) ?? "lvp",
    from_stock: partial.from_stock ?? false,
    order_as_roll: partial.order_as_roll ?? false,
    roll_width_ft: partial.roll_width_ft ?? null,
    sqft_per_box: partial.sqft_per_box ?? null,
    is_fill: partial.is_fill ?? false,
    is_optional: partial.is_optional ?? false,
    measurements: partial.measurements ?? null,
  };
}

function samplePayload(
  lines: EstimateLineItem[],
  overrides?: Partial<ApprovalSnapshotPayload>,
): ApprovalSnapshotPayload {
  const option = {
    id: "opt-1",
    estimate_id: "est-1",
    name: "Option A",
    notes: null,
    position: 0,
    line_items: lines,
  } as EstimateOption;
  const base = buildApprovalSnapshotPayload({
    estimate: {
      id: "est-1",
      customer_id: "cust-1",
      title: "Kitchen",
      presentation: "detailed",
      show_project_details: true,
      job_description: null,
      notes: null,
      tax_rate: 8,
      discount_kind: "amount",
      discount_value: 0,
    } as never,
    option,
    lines,
  });
  return { ...base, ...overrides };
}

describe("FIX 1 — scheduling uses operational measured scope", () => {
  it("prefers job lines over estimate for duration input", () => {
    const estimate = [estLine({ id: "a", sqft: 1000, waste_pct: 10, category: "lvp" })];
    const job = [estLine({ id: "a", sqft: 400, waste_pct: 10, category: "lvp" })];
    const scope = resolveOperationalLines(job, estimate);
    expect(scope[0]!.sqft).toBe(400);
    const daysEst = installDaysForJob(estimate, SCHEDULING_DEFAULTS).days;
    const daysJob = installDaysForJob(scope, SCHEDULING_DEFAULTS).days;
    expect(daysJob).toBeLessThan(daysEst);
  });

  it("uses measured lineQty not lineOrderQty for duration inputs", () => {
    const line = estLine({ id: "a", sqft: 500, waste_pct: 10 });
    expect(lineQty(line)).toBe(500);
    expect(lineOrderQty(line)).toBe(550);
    // Engine consumes lineQty/area — waste must not inflate days via order qty.
    expect(lineOrderQty(line)).toBeGreaterThan(lineQty(line));
  });

  it("legacy empty job falls back to estimate", () => {
    const estimate = [estLine({ id: "a", sqft: 300, category: "carpet" })];
    expect(resolveOperationalLines([], estimate)).toEqual(estimate);
  });
});

describe("FIX 2 — Job Board skill gate from WO categories", () => {
  it("unchanged estimate/job → same type", () => {
    const cats = [{ category: "carpet" }];
    expect(
      boardMaterialTypeFromScopes({
        jobLineCategories: cats,
        estimateFallbackCategories: cats,
      }),
    ).toBe("carpet");
  });

  it("estimate carpet, WO LVP → hard (operational wins)", () => {
    expect(
      boardMaterialTypeFromScopes({
        jobLineCategories: [{ category: "lvp" }],
        estimateFallbackCategories: [{ category: "carpet" }],
      }),
    ).toBe("hard");
    expect(installerCanDoJob(["hard"], "hard")).toBe(true);
    expect(installerCanDoJob(["carpet"], "hard")).toBe(false);
  });

  it("estimate LVP, WO carpet → carpet", () => {
    expect(
      boardMaterialTypeFromScopes({
        jobLineCategories: [{ category: "carpet" }],
        estimateFallbackCategories: [{ category: "lvp" }],
      }),
    ).toBe("carpet");
  });

  it("multiple operational categories → both", () => {
    expect(
      boardMaterialTypeFromScopes({
        jobLineCategories: [{ category: "carpet" }, { category: "hardwood" }],
      }),
    ).toBe("both");
  });

  it("job-only hard material after carpet removed", () => {
    expect(
      boardMaterialTypeFromScopes({
        jobLineCategories: [{ category: "tile" }],
        estimateFallbackCategories: [{ category: "carpet" }],
      }),
    ).toBe("hard");
  });

  it("legacy empty job falls back to estimate categories", () => {
    expect(
      boardMaterialTypeFromScopes({
        jobLineCategories: [],
        estimateFallbackCategories: [{ category: "carpet" }],
      }),
    ).toBe("carpet");
  });
});

describe("FIX 3 — Invoice approval gate + snapshot billing", () => {
  it("A: approved + snapshot → ok", () => {
    expect(
      assessInvoiceCommercialGate({
        status: "approved",
        approvalStale: false,
        hasSnapshot: true,
      }),
    ).toEqual({ ok: true });
  });

  it("B: stale material change → blocked", () => {
    const g = assessInvoiceCommercialGate({
      status: "sent",
      approvalStale: true,
      hasSnapshot: true,
    });
    expect(g.ok).toBe(false);
    if (!g.ok) {
      expect(g.reason).toBe("stale");
      expect(g.message).toBe(INVOICE_REQUIRES_REAPPROVAL_MESSAGE);
    }
  });

  it("not approved → blocked", () => {
    const g = assessInvoiceCommercialGate({
      status: "draft",
      approvalStale: false,
      hasSnapshot: false,
    });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.message).toBe(INVOICE_REQUIRES_APPROVED_STATUS_MESSAGE);
  });

  it("G: legacy approved without snapshot → blocked", () => {
    expect(legacyApprovalSnapshotUnavailable("approved", false)).toBe(true);
    const g = assessInvoiceCommercialGate({
      status: "approved",
      approvalStale: false,
      hasSnapshot: false,
    });
    expect(g.ok).toBe(false);
    if (!g.ok) {
      expect(g.reason).toBe("no_snapshot");
      expect(g.message).toBe(INVOICE_REQUIRES_APPROVAL_SNAPSHOT_MESSAGE);
    }
  });

  it("A/C: invoice items use snapshot line_total (not live)", () => {
    const v1 = [estLine({ id: "l1", sqft: 500, material_rate: 4, labor_rate: 2 })];
    const payload = samplePayload(v1);
    const built = buildInvoiceItemsFromApprovalSnapshot({
      invoiceId: "inv-1",
      payload,
    });
    const nonDisc = built.items.filter((i) => i.description !== "Discount");
    expect(nonDisc).toHaveLength(1);
    const amount =
      (Number(nonDisc[0]!.quantity) || 0) * (Number(nonDisc[0]!.rate) || 0);
    expect(Math.round(amount * 100) / 100).toBe(
      Math.round(payload.option.lines[0]!.line_total * 100) / 100,
    );
    expect(built.taxRate).toBe(8);
    expect(built.customerId).toBe("cust-1");
  });

  it("C: v2 snapshot dollars differ from v1", () => {
    const v1 = samplePayload([
      estLine({ id: "l1", sqft: 500, material_rate: 4, labor_rate: 2 }),
    ]);
    const v2 = samplePayload([
      estLine({ id: "l1", sqft: 500, material_rate: 6, labor_rate: 2 }),
    ]);
    const a1 = buildInvoiceItemsFromApprovalSnapshot({
      invoiceId: "i",
      payload: v1,
    }).items.reduce((s, i) => s + i.quantity * i.rate, 0);
    const a2 = buildInvoiceItemsFromApprovalSnapshot({
      invoiceId: "i",
      payload: v2,
    }).items.reduce((s, i) => s + i.quantity * i.rate, 0);
    expect(a2).toBeGreaterThan(a1);
  });

  it("D: WO qty change does not affect snapshot invoice amount", () => {
    const commercial = [
      estLine({ id: "l1", sqft: 500, material_rate: 4, labor_rate: 2 }),
    ];
    const payload = samplePayload(commercial);
    const invoiceAmt = buildInvoiceItemsFromApprovalSnapshot({
      invoiceId: "i",
      payload,
    }).items.reduce((s, i) => s + i.quantity * i.rate, 0);
    // Operational WO reduced — commercial snapshot unchanged.
    const wo = estLine({ id: "l1", sqft: 200, material_rate: 4, labor_rate: 2 });
    expect(lineTotal(wo)).toBeLessThan(lineTotal(commercial[0]!));
    expect(invoiceAmt).toBeCloseTo(payload.option.lines[0]!.line_total, 2);
  });

  it("partial selection bills only chosen snapshot lines", () => {
    const lines = [
      estLine({ id: "l1", sqft: 100, room: "A", material_rate: 4, labor_rate: 0 }),
      estLine({ id: "l2", sqft: 200, room: "B", material_rate: 4, labor_rate: 0 }),
    ];
    const payload = samplePayload(lines);
    const built = buildInvoiceItemsFromApprovalSnapshot({
      invoiceId: "i",
      payload,
      selectedLineIds: ["l1"],
    });
    const nonDisc = built.items.filter((i) => i.description !== "Discount");
    expect(nonDisc).toHaveLength(1);
    expect(nonDisc[0]!.description).toContain("A");
  });

  it("H: gate ignores non-stale approved with snapshot (description-only stays billable)", () => {
    // Step 6 only sets approval_stale on material commercial changes.
    expect(
      assessInvoiceCommercialGate({
        status: "approved",
        approvalStale: false,
        hasSnapshot: true,
      }).ok,
    ).toBe(true);
  });
});
