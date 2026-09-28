/**
 * Phase P — purchasing facts stay factual.
 * Material need, warehouse readiness, and scheduling are not derived from a PO.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessMaterialsReadyForSchedule } from "@/lib/materials-ready";
import {
  coverageSentence,
  employeePoError,
  employeeReceiptError,
  poAttentionFact,
  poEtaMissing,
  poOwnershipFact,
  poReceiptKind,
  procurementCoverage,
} from "@/lib/po-facts";
import { materialNeedQty } from "@/lib/job-operational-scope";

function src(path: string): string {
  return readFileSync(path, "utf8");
}

describe("procurement facts", () => {
  it("takes material need from the job line, not from a purchase order", () => {
    const need = materialNeedQty({
      line_type: "mat_labor",
      quantity: 100,
      unit: "sqyd",
      waste_pct: 0,
    });
    expect(need).toBe(100);
    const covered = procurementCoverage({
      need: 0,
      needUnit: "sqyd",
      items: [{ quantity: 100, unit: "sqyd", status: "ordered" }],
    });
    expect(covered.kind).toBe("no_need");
  });

  it("does not treat a purchase order as ordered coverage until it is issued", () => {
    const draft = procurementCoverage({
      need: 100,
      needUnit: "sqyd",
      items: [{ quantity: 100, unit: "sq yd", status: "draft" }],
    });
    expect(draft.kind).toBe("draft_only");
    expect(
      coverageSentence({
        need: 100,
        unit: "sqyd",
        kind: draft.kind,
        orderedQty: draft.orderedQty,
        draftQty: draft.draftQty,
      }),
    ).toMatch(/Not ordered/);

    const partial = procurementCoverage({
      need: 100,
      needUnit: "SY",
      items: [{ quantity: 60, unit: "sqyd", status: "ordered" }],
    });
    expect(partial.kind).toBe("partial");
    expect(partial.orderedQty).toBe(60);

    const full = procurementCoverage({
      need: 100,
      needUnit: "sqyd",
      items: [
        { quantity: 40, unit: "sqyd", status: "ordered" },
        { quantity: 60, unit: "sqyd", status: "received" },
        { quantity: 25, unit: "sqyd", status: "void" },
      ],
    });
    expect(full.kind).toBe("full");
  });

  it("refuses to compare quantities in different units", () => {
    const mixed = procurementCoverage({
      need: 100,
      needUnit: "sqyd",
      items: [{ quantity: 100, unit: "sqft", status: "ordered" }],
    });
    expect(mixed.kind).toBe("unit_mismatch");
    expect(mixed.orderedQty).toBe(0);
  });

  it("keeps partial receipt off a fully received label", () => {
    expect(
      poReceiptKind([
        { quantity: 100, unit: "sqyd", received_qty: 60, received_at: "2026-09-01" },
      ]),
    ).toBe("partial");
    expect(
      poAttentionFact({
        status: "ordered",
        items: [{ quantity: 100, received_qty: 60, received_at: "2026-09-01" }],
      }),
    ).toBe("Partially received");
    expect(
      poAttentionFact({
        status: "ordered",
        backordered: true,
        items: [{ quantity: 100, received_qty: 60, received_at: "2026-09-01" }],
      }),
    ).toBe("Backordered");
    expect(
      poAttentionFact({
        status: "received",
        items: [{ quantity: 100, received_qty: 100, received_at: "2026-09-01" }],
      }),
    ).toBe("Received");
    expect(poEtaMissing({ status: "ordered", eta_date: null })).toBe(true);
    expect(poEtaMissing({ status: "received", eta_date: null })).toBe(false);
  });

  it("keeps stock orders distinct from customer jobs", () => {
    expect(poOwnershipFact(true)).toBe("stock");
    expect(poOwnershipFact(false)).toBe("job");
    expect(poOwnershipFact(null)).toBe("job");
  });

  it("does not let received or ordered status mark a job warehouse-ready", () => {
    expect(
      assessMaterialsReadyForSchedule({
        hasMaterialNeed: true,
        warehouseReadyAt: null,
      }),
    ).toEqual({ ready: false, reason: "materials_not_ready" });
    expect(
      assessMaterialsReadyForSchedule({
        hasMaterialNeed: false,
        warehouseReadyAt: null,
      }).ready,
    ).toBe(true);
    expect(
      assessMaterialsReadyForSchedule({
        hasMaterialNeed: true,
        warehouseReadyAt: "2026-09-01T12:00:00Z",
      }).reason,
    ).toBe("warehouse_ready");
  });

  it("hides database failures from purchasing employees", () => {
    expect(employeePoError("PGRST202: could not find function")).toBe(
      "This purchase order could not be saved. Try again.",
    );
    expect(employeeReceiptError("duplicate key value violates unique constraint")).toBe(
      "This receipt could not be recorded. Try again.",
    );
    expect(employeePoError("PO_SUPPLIER_REQUIRED: Assign a supplier")).toBe(
      "Pick a vendor before marking this purchase order ordered.",
    );
  });

  it("keeps the purchase queue paged and scheduling on the safe write", () => {
    const queue = src("src/lib/data/purchase-orders.ts");
    expect(queue).toContain("po_queue_page");
    expect(queue).toContain("eta_date, backordered");
    const jobs = src("src/app/(app)/jobs/actions.ts");
    expect(jobs).toContain("schedule_job_install_safe");
    const receive = src("src/app/(app)/warehouse/receiving-actions.ts");
    expect(receive).not.toContain("warehouse_ready_at");
    const facts = src("src/lib/po-facts.ts");
    expect(facts).not.toMatch(/next action|recommended action|next step/i);
    const ops = src("src/app/(app)/jobs/[id]/job-ops-facts.tsx");
    expect(ops).not.toMatch(/next action|recommended action/i);
    expect(ops).toContain("ETA not entered");
    const incoming = src("src/app/(app)/warehouse/incoming-deliveries.tsx");
    expect(incoming).toContain("receiveLock");
    expect(incoming).toContain("disabled={saving}");
    expect(incoming).toContain("does not mark the job warehouse-ready");
    const materialQueue = src("src/lib/data/job-material-queue.ts");
    expect(materialQueue).toContain("materialNeedQty");
    expect(materialQueue).toContain("not linked to this line");
    expect(materialQueue).not.toContain("unit_cost");
    expect(materialQueue).not.toContain("material_rate");
  });
});
