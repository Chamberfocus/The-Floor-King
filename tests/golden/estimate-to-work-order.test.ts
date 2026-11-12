/**
 * Guided estimate and the builder hand the approved lines to the work order
 * and the purchase orders without dropping cost, stock, or the style number.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotLinesAsEstimateLines } from "@/lib/approval-snapshot-view";
import {
  buildApprovalSnapshotPayload,
  sanitizeApprovalPayloadForCustomer,
} from "@/lib/estimate-approval";
import { fillSnapshotOperationalFields } from "@/lib/job-operational-scope";
import type { EstimateLineItem, EstimateOption } from "@/lib/types";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function line(over: Partial<EstimateLineItem> = {}): EstimateLineItem {
  return {
    id: "line-1",
    option_id: "opt-1",
    position: 0,
    room: "Living room",
    description: "Calm Tide",
    note: "Seam at the doorway",
    line_type: "mat_labor",
    sqft: 200,
    length_in: null,
    width_in: null,
    measure_unit: "sqyd",
    material_rate: 12,
    labor_rate: 0,
    installed_rate: null,
    flat_amount: null,
    waste_pct: 10,
    product_id: "prod-1",
    manufacturer: "Shaw",
    style: "Calm",
    color: "Tide",
    item_no: "SH-1",
    material_cost: 8,
    labor_cost: 0,
    quantity: 22.22,
    unit: "sq yd",
    category: "carpet",
    from_stock: false,
    order_as_roll: true,
    roll_width_ft: 12,
    ...over,
  };
}

const option: EstimateOption = {
  id: "opt-1",
  estimate_id: "est-1",
  name: "Option A",
  position: 0,
  notes: null,
  created_at: "",
};

describe("approved copy keeps what the work order and purchase order use", () => {
  it("stores cost, stock, style number, and prep coverage on the snapshot", () => {
    const payload = buildApprovalSnapshotPayload({
      estimate: {
        id: "est-1",
        customer_id: "cust-1",
        title: "Living room",
        presentation: "detailed",
        show_project_details: true,
        job_description: "Install",
        notes: null,
        tax_rate: 0,
        discount_kind: "amount",
        discount_value: 0,
      },
      option,
      lines: [line({ from_stock: true, coverage_sqft: 40, prep_key: "level" })],
    });
    const saved = payload.option.lines[0];
    expect(saved.item_no).toBe("SH-1");
    expect(saved.material_cost).toBe(8);
    expect(saved.from_stock).toBe(true);
    expect(saved.order_as_roll).toBe(true);
    expect(saved.roll_width_ft).toBe(12);
    expect(saved.coverage_sqft).toBe(40);
    expect(saved.prep_key).toBe("level");
    expect(saved.note).toBe("Seam at the doorway");

    const safe = sanitizeApprovalPayloadForCustomer(payload);
    const customerLine = safe.option.lines[0] as unknown as Record<string, unknown>;
    expect(customerLine.material_cost).toBeUndefined();
    expect(customerLine.labor_cost).toBeUndefined();
    expect(customerLine.from_stock).toBeUndefined();
    expect(customerLine.item_no).toBe("SH-1");
    expect(customerLine.material_rate).toBe(12);

    const viewed = snapshotLinesAsEstimateLines(payload);
    expect(viewed[0].material_cost).toBe(8);
    expect(viewed[0].from_stock).toBe(true);
    expect(viewed[0].item_no).toBe("SH-1");
  });

  it("fills cost and stock onto an older approval copy from the same estimate line", () => {
    const filled = fillSnapshotOperationalFields(
      [{ id: "line-1", description: "Calm Tide", quantity: 22.22 }],
      [line({ from_stock: true })],
    )[0] as { material_cost?: number; from_stock?: boolean; item_no?: string; quantity: number };
    expect(filled.material_cost).toBe(8);
    expect(filled.from_stock).toBe(true);
    expect(filled.item_no).toBeUndefined();
    expect(filled.quantity).toBe(22.22);

    const kept = fillSnapshotOperationalFields(
      [{ id: "line-1", from_stock: false, material_cost: 3 }],
      [line({ from_stock: true, material_cost: 8 })],
    )[0];
    expect(kept.from_stock).toBe(false);
    expect(kept.material_cost).toBe(3);
  });
});

describe("the handoff writes the work order and the purchase orders together", () => {
  it("finishes purchasing before the job page opens", () => {
    const jobs = read("src/app/(app)/jobs/actions.ts");
    expect(jobs).toContain("async function finishJobForInstall");
    expect(jobs).toContain("seedJobScopeIfEmpty");
    expect(jobs).toContain("await prepareJobMaterialsFor(jobId, { admin: true })");
    expect(jobs).not.toContain("after(() => prepareJobMaterialsFor");
  });

  it("carries the catalog style number from the guided estimate onto the saved line", () => {
    const guided = read("src/app/(app)/estimates/questionnaire.tsx");
    expect(guided).toContain("sku: p.sku?.trim() || null");
    expect(guided).toContain("item_no: sku");
    const smart = read("src/app/(app)/estimates/smart-actions.ts");
    expect(smart).toContain("item_no: l.item_no?.trim() || null");
    const ops = read("src/lib/data/job-operational-lines.ts");
    expect(ops).toContain("fillSnapshotOperationalFields");
  });
});
