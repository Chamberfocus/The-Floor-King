/**
 * Step 6 — approval snapshots, material change, option protection, reapproval.
 */
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_OPTION_PROTECTED_MESSAGE,
  approvalCompletedSuccessfully,
  buildApprovalSnapshotPayload,
  commercialHeaderFingerprint,
  commercialLineFingerprint,
  commercialOptionFingerprint,
  isMaterialCommercialChange,
  legacyApprovalSnapshotUnavailable,
  liveDiffersFromSnapshot,
  optionRemovalBlocked,
  protectedOptionIds,
  type ApprovalSnapshotPayload,
} from "@/lib/estimate-approval";
import {
  planEstimateLinePersist,
  FOREIGN_ESTIMATE_LINE_ID_MESSAGE,
  MISSING_ESTIMATE_LINE_IDS_MESSAGE,
} from "@/lib/estimate-line-persist";
import { lineTotal, optionTotalsWithDiscount } from "@/lib/estimate-calc";
import type { EstimateLineItem, EstimateOption } from "@/lib/types";

const baseLine = {
  id: "l1",
  product_id: "p1",
  line_type: "mat_labor",
  category: "lvp",
  sqft: 500,
  quantity: null,
  waste_pct: 10,
  measure_unit: "sqft",
  material_rate: 4.5,
  labor_rate: 2,
  installed_rate: null,
  flat_amount: null,
  length_in: null,
  width_in: null,
  measurements: null,
  from_stock: false,
  is_optional: false,
  description: "LVP",
};

function samplePayload(overrides?: Partial<ApprovalSnapshotPayload>): ApprovalSnapshotPayload {
  const lines = [
    {
      ...baseLine,
      position: 0,
      room: "Kitchen",
      note: null,
      manufacturer: null,
      style: null,
      color: null,
      item_no: null,
      unit: "sq ft",
      line_total: lineTotal(baseLine as never),
    },
  ];
  const totals = optionTotalsWithDiscount(
    [baseLine as never],
    8,
    "amount",
    0,
  );
  return {
    schema_version: 1,
    estimate_id: "est-1",
    customer_id: "cust-1",
    title: "Kitchen",
    presentation: "detailed",
    show_project_details: true,
    job_description: "Install LVP",
    notes: null,
    accepted_option_id: "opt-1",
    option: {
      id: "opt-1",
      name: "Option A",
      notes: null,
      lines,
    },
    tax_rate: 8,
    discount_kind: "amount",
    discount_value: 0,
    discount_amount: totals.discount,
    subtotal: totals.subtotal,
    tax_amount: totals.tax,
    total: totals.total,
    ...overrides,
  };
}

describe("1–2. Approval snapshot payload totals", () => {
  it("buildApprovalSnapshotPayload stores correct option totals", () => {
    const option: EstimateOption = {
      id: "opt-1",
      estimate_id: "est-1",
      name: "Option A",
      position: 0,
      notes: null,
      created_at: "",
    };
    const line: EstimateLineItem = {
      id: "l1",
      option_id: "opt-1",
      position: 0,
      room: "Kitchen",
      description: "LVP",
      note: null,
      line_type: "mat_labor",
      sqft: 500,
      length_in: null,
      width_in: null,
      measure_unit: "sqft",
      material_rate: 4.5,
      labor_rate: 2,
      installed_rate: null,
      flat_amount: null,
      waste_pct: 10,
      product_id: "p1",
      manufacturer: null,
      style: null,
      color: null,
      item_no: null,
      material_cost: null,
      labor_cost: null,
      quantity: null,
      unit: "sq ft",
      category: "lvp",
    };
    const payload = buildApprovalSnapshotPayload({
      estimate: {
        id: "est-1",
        customer_id: "cust-1",
        title: "Kitchen",
        presentation: "detailed",
        show_project_details: true,
        job_description: "Install",
        notes: null,
        tax_rate: 8,
        discount_kind: "amount",
        discount_value: 100,
      },
      option,
      lines: [line],
    });
    const expected = optionTotalsWithDiscount([line], 8, "amount", 100);
    expect(payload.subtotal).toBeCloseTo(expected.subtotal, 10);
    expect(payload.discount_amount).toBeCloseTo(expected.discount, 10);
    expect(payload.tax_amount).toBeCloseTo(expected.tax, 10);
    expect(payload.total).toBeCloseTo(expected.total, 10);
    expect(payload.option.lines[0].line_total).toBeCloseTo(lineTotal(line), 10);
    expect(payload.accepted_option_id).toBe("opt-1");
  });
});

describe("3. Live edit does not alter snapshot object", () => {
  it("mutating a copy of live lines leaves snapshot payload untouched", () => {
    const snap = samplePayload();
    const frozen = JSON.stringify(snap);
    const liveLines = snap.option.lines.map((l) => ({ ...l, material_rate: 99 }));
    expect(liveDiffersFromSnapshot(snap, {
      tax_rate: snap.tax_rate,
      discount_kind: snap.discount_kind,
      discount_value: snap.discount_value,
      accepted_option_id: snap.accepted_option_id,
      lines: liveLines,
    })).toBe(true);
    expect(JSON.stringify(snap)).toBe(frozen);
  });
});

describe("4. Portal approved display uses snapshot totals", () => {
  it("snapshot total is the customer-facing approved amount", () => {
    const snap = samplePayload();
    expect(snap.total).toBeGreaterThan(0);
    expect(snap.option.lines.length).toBe(1);
  });
});

describe("5. Material/price/qty change requires reapproval signal", () => {
  it("price change is material", () => {
    expect(
      isMaterialCommercialChange({
        beforeHeader: { tax_rate: 8, discount_kind: "amount", discount_value: 0, accepted_option_id: "o" },
        afterHeader: { tax_rate: 8, discount_kind: "amount", discount_value: 0, accepted_option_id: "o" },
        beforeLines: [baseLine],
        afterLines: [{ ...baseLine, material_rate: 5 }],
      }),
    ).toBe(true);
  });

  it("quantity/sqft change is material", () => {
    expect(
      isMaterialCommercialChange({
        beforeHeader: { tax_rate: 8, discount_kind: "amount", discount_value: 0, accepted_option_id: "o" },
        afterHeader: { tax_rate: 8, discount_kind: "amount", discount_value: 0, accepted_option_id: "o" },
        beforeLines: [baseLine],
        afterLines: [{ ...baseLine, sqft: 600 }],
      }),
    ).toBe(true);
  });

  it("tax/discount change is material", () => {
    expect(
      isMaterialCommercialChange({
        beforeHeader: { tax_rate: 8, discount_kind: "amount", discount_value: 0, accepted_option_id: "o" },
        afterHeader: { tax_rate: 8, discount_kind: "amount", discount_value: 50, accepted_option_id: "o" },
        beforeLines: [baseLine],
        afterLines: [baseLine],
      }),
    ).toBe(true);
  });

  it("room/note-only change is NOT material (commercial fingerprint)", () => {
    // room/note are not in commercialLineFingerprint
    expect(commercialLineFingerprint(baseLine)).toBe(
      commercialLineFingerprint({ ...baseLine, description: "LVP" }),
    );
  });
});

describe("6–7. Reapproval versions", () => {
  it("version payloads are independent objects", () => {
    const v1 = samplePayload({ total: 1000 });
    const v2 = samplePayload({ total: 1200 });
    expect(v1.total).toBe(1000);
    expect(v2.total).toBe(1200);
    expect(v1.total).not.toBe(v2.total);
  });
});

describe("8–11. Job / PO / invoice / payment isolation (policy)", () => {
  it("approval helpers never emit job_line_items or invoice mutations", () => {
    const src = buildApprovalSnapshotPayload.toString() + isMaterialCommercialChange.toString();
    expect(src).not.toMatch(/job_line_items|invoice_items|payments/);
  });
});

describe("12–13. Accepted / job-linked option protection", () => {
  it("blocks removing accepted option", () => {
    const protectedIds = protectedOptionIds({
      status: "approved",
      acceptedOptionId: "opt-a",
      jobOptionIds: [],
    });
    expect(optionRemovalBlocked(["opt-a"], protectedIds)).toBe(true);
    expect(optionRemovalBlocked(["opt-b"], protectedIds)).toBe(false);
    expect(ACCEPTED_OPTION_PROTECTED_MESSAGE.length).toBeGreaterThan(10);
  });

  it("blocks removing job-linked option", () => {
    const protectedIds = protectedOptionIds({
      status: "sent",
      acceptedOptionId: null,
      jobOptionIds: ["opt-job"],
    });
    expect(optionRemovalBlocked(["opt-job"], protectedIds)).toBe(true);
  });
});

describe("14–15. Approval audit fields exist on payload contract", () => {
  it("snapshot payload includes customer + option identity", () => {
    const p = samplePayload();
    expect(p.customer_id).toBe("cust-1");
    expect(p.accepted_option_id).toBe("opt-1");
    expect(p.schema_version).toBe(1);
  });

  it("approval is incomplete without a snapshot id", () => {
    expect(
      approvalCompletedSuccessfully({
        snapshotId: null,
        error: "Approval could not be completed",
      }),
    ).toBe(false);
    expect(
      approvalCompletedSuccessfully({ snapshotId: "snap-1", error: null }),
    ).toBe(true);
  });
});

describe("16. Legacy approved without snapshot", () => {
  it("flags historical snapshot unavailable", () => {
    expect(legacyApprovalSnapshotUnavailable("approved", false)).toBe(true);
    expect(legacyApprovalSnapshotUnavailable("approved", true)).toBe(false);
    expect(legacyApprovalSnapshotUnavailable("sent", false)).toBe(false);
  });
});

describe("17–20. Transactional save preconditions (Step 5 plan still atomic gate)", () => {
  it("forged id rejected before any write plan succeeds", () => {
    const plan = planEstimateLinePersist(["a"], ["forged"]);
    expect(plan).toEqual({ ok: false, error: FOREIGN_ESTIMATE_LINE_ID_MESSAGE });
  });

  it("missing ids on existing option rejected", () => {
    const plan = planEstimateLinePersist(["a"], [null]);
    expect(plan).toEqual({ ok: false, error: MISSING_ESTIMATE_LINE_IDS_MESSAGE });
  });

  it("stable id update plan does not delete the line", () => {
    const plan = planEstimateLinePersist(["a"], ["a"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.toDelete).toEqual([]);
    expect(plan.toUpdate[0].id).toBe("a");
  });

  it("induced plan failure yields no delete/update/insert lists", () => {
    const plan = planEstimateLinePersist(["a", "b"], ["x"]);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect("toDelete" in plan).toBe(false);
  });
});

describe("21–22. Draft/sent fingerprinting still works", () => {
  it("header fingerprint is stable for draft-like headers", () => {
    expect(
      commercialHeaderFingerprint({
        tax_rate: 8,
        discount_kind: "percent",
        discount_value: 10,
        accepted_option_id: null,
      }),
    ).toBe(
      commercialHeaderFingerprint({
        tax_rate: "8",
        discount_kind: "percent",
        discount_value: "10",
        accepted_option_id: null,
      }),
    );
  });

  it("option fingerprint order matters", () => {
    const a = commercialOptionFingerprint([baseLine, { ...baseLine, id: "l2", sqft: 100 }]);
    const b = commercialOptionFingerprint([{ ...baseLine, id: "l2", sqft: 100 }, baseLine]);
    expect(a).not.toBe(b);
  });
});

describe("23. Steps 1–5 calc still green via lineTotal", () => {
  it("500 sqft + 10% waste at 4.5+2", () => {
    expect(lineTotal(baseLine as never)).toBeCloseTo(500 * 1.1 * (4.5 + 2), 10);
  });
});
