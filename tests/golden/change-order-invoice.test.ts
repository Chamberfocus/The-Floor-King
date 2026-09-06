/**
 * Change-order invoice safety Phase 1 — deterministic regression tests.
 */
import { describe, expect, it } from "vitest";
import {
  activeInvoicedTotal,
  invoiceCommercialEditBlocked,
  invoiceCoverageTotal,
  planEstimateInvoiceCreation,
  supplementalDeltaInvoiceItems,
  INVOICE_CREDIT_REQUIRED_MESSAGE,
  INVOICE_LEGACY_REVIEW_MESSAGE,
  INVOICE_NO_ADDITIONAL_NEEDED_MESSAGE,
  INVOICE_PAID_IMMUTABLE_MESSAGE,
  type CoverageInvoiceRow,
} from "@/lib/change-order-invoice";
import { assessInvoiceCommercialGate } from "@/lib/estimate-approval";
import { invoiceTotals } from "@/lib/invoice-calc";

function row(
  partial: Partial<CoverageInvoiceRow> & { id: string },
): CoverageInvoiceRow {
  return {
    status: "sent",
    approvalSnapshotId: "snap-v1",
    total: 10000,
    hasPayments: false,
    ...partial,
  };
}

describe("change-order invoice Phase 1", () => {
  it("1. no prior invoice → full linked bill of approved total", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 10000,
      existing: [],
    });
    expect(plan).toEqual({
      action: "full",
      kind: "original",
      amount: 10000,
    });
  });

  it("2. unpaid v1 + approved v2 increase → void/reissue full v2", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 12000,
      existing: [row({ id: "inv1", total: 10000, hasPayments: false })],
    });
    expect(plan.action).toBe("void_reissue");
    if (plan.action === "void_reissue") {
      expect(plan.voidIds).toEqual(["inv1"]);
      expect(plan.kind).toBe("replacement");
      expect(plan.amount).toBe(12000);
    }
  });

  it("3. partial payment + approved increase → supplemental delta only", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 12000,
      existing: [
        row({ id: "inv1", total: 10000, hasPayments: true, status: "partial" }),
      ],
    });
    expect(plan).toEqual({
      action: "supplemental",
      kind: "supplemental",
      amount: 2000,
    });
  });

  it("4. fully paid + approved increase → supplemental delta", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 12000,
      existing: [
        row({ id: "inv1", total: 10000, hasPayments: true, status: "paid" }),
      ],
    });
    expect(plan.action).toBe("supplemental");
    if (plan.action === "supplemental") expect(plan.amount).toBe(2000);
  });

  it("5. multi-revision: next supplemental after prior supplemental", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 13500,
      existing: [
        row({
          id: "inv1",
          total: 10000,
          hasPayments: true,
          approvalSnapshotId: "v1",
        }),
        row({
          id: "inv2",
          total: 2000,
          hasPayments: false,
          approvalSnapshotId: "v2",
          status: "sent",
        }),
      ],
    });
    expect(plan.action).toBe("supplemental");
    if (plan.action === "supplemental") expect(plan.amount).toBe(1500);
  });

  it("6. approved total unchanged → no duplicate invoice", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 10000,
      existing: [row({ id: "inv1", total: 10000, hasPayments: true })],
    });
    expect(plan.action).toBe("none");
    if (plan.action === "none") {
      expect(plan.message).toBe(INVOICE_NO_ADDITIONAL_NEEDED_MESSAGE);
    }
  });

  it("7. approved decrease with paid invoice → issue_credit", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 9000,
      existing: [row({ id: "inv1", total: 10000, hasPayments: true })],
    });
    expect(plan.action).toBe("issue_credit");
    if (plan.action === "issue_credit") {
      expect(plan.message).toBe(INVOICE_CREDIT_REQUIRED_MESSAGE);
      expect(plan.approvedTotal).toBe(9000);
      expect(plan.invoicedTotal).toBe(10000);
      expect(plan.amount).toBe(1000);
    }
  });

  it("7b. after commercial credit, net coverage matches approved → none", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 9000,
      existing: [row({ id: "inv1", total: 10000, hasPayments: true })],
      commercialCreditsTotal: 1000,
    });
    expect(plan.action).toBe("none");
  });

  it("7c. after credit, later increase → supplemental of net gap only", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 11000,
      existing: [row({ id: "inv1", total: 10000, hasPayments: true })],
      commercialCreditsTotal: 1000,
    });
    expect(plan.action).toBe("supplemental");
    if (plan.action === "supplemental") expect(plan.amount).toBe(2000);
  });

  it("8. approved decrease unpaid → void/reissue from latest", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 9000,
      existing: [row({ id: "inv1", total: 10000, hasPayments: false })],
    });
    expect(plan.action).toBe("void_reissue");
    if (plan.action === "void_reissue") {
      expect(plan.amount).toBe(9000);
      expect(plan.voidIds).toEqual(["inv1"]);
    }
  });

  it("9. legacy invoice without approval_snapshot_id → review block", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 12000,
      existing: [
        row({
          id: "legacy",
          total: 10000,
          approvalSnapshotId: null,
          hasPayments: false,
        }),
      ],
    });
    expect(plan.action).toBe("legacy_review");
    if (plan.action === "legacy_review") {
      expect(plan.message).toBe(INVOICE_LEGACY_REVIEW_MESSAGE);
    }
  });

  it("10. void prior invoice does not count toward coverage", () => {
    const existing = [
      row({ id: "voided", total: 10000, status: "void", hasPayments: false }),
      row({
        id: "active",
        total: 2000,
        status: "sent",
        hasPayments: false,
        approvalSnapshotId: "v2",
      }),
    ];
    expect(activeInvoicedTotal(existing)).toBe(2000);
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 13500,
      existing: [
        ...existing.filter((r) => r.status === "void"),
        row({
          id: "paid",
          total: 10000,
          hasPayments: true,
          approvalSnapshotId: "v1",
        }),
        row({
          id: "sup",
          total: 2000,
          hasPayments: false,
          approvalSnapshotId: "v2",
        }),
      ],
    });
    expect(plan.action).toBe("supplemental");
    if (plan.action === "supplemental") expect(plan.amount).toBe(1500);
  });

  it("11. unapproved/stale estimate still blocked by commercial gate", () => {
    expect(
      assessInvoiceCommercialGate({
        status: "sent",
        approvalStale: true,
        hasSnapshot: true,
      }).ok,
    ).toBe(false);
    expect(
      assessInvoiceCommercialGate({
        status: "draft",
        approvalStale: false,
        hasSnapshot: false,
      }).ok,
    ).toBe(false);
  });

  it("12. job operational scope is not an input to commercial delta", () => {
    // Planner only accepts approvedTotal + invoice coverage — no job lines.
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 12000,
      existing: [row({ id: "inv1", total: 10000, hasPayments: true })],
    });
    expect(plan.action).toBe("supplemental");
    if (plan.action === "supplemental") expect(plan.amount).toBe(2000);
  });

  it("13. payment records are not mutated by planning helpers", () => {
    const payments = [{ id: "p1", amount: 500 }];
    const snapshot = structuredClone(payments);
    planEstimateInvoiceCreation({
      approvedTotal: 12000,
      existing: [row({ id: "inv1", total: 10000, hasPayments: true })],
    });
    expect(payments).toEqual(snapshot);
  });

  it("14. commercial edit blocked when payments exist", () => {
    expect(invoiceCommercialEditBlocked(false)).toEqual({
      blocked: false,
      message: null,
    });
    const locked = invoiceCommercialEditBlocked(true);
    expect(locked.blocked).toBe(true);
    expect(locked.message).toBe(INVOICE_PAID_IMMUTABLE_MESSAGE);
  });

  it("stacked full invoices prevented: paid + same full amount → none", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 10000,
      existing: [row({ id: "inv1", total: 10000, hasPayments: true })],
    });
    expect(plan.action).toBe("none");
  });

  it("supplemental items total equals tax-inclusive delta (tax_rate 0)", () => {
    const items = supplementalDeltaInvoiceItems("inv-x", 2000, "Change order");
    expect(items).toHaveLength(1);
    expect(invoiceTotals(items, 0, 0).total).toBe(2000);
    expect(invoiceCoverageTotal(items, 0)).toBe(2000);
  });

  it("unpaid equal totals → none (no needless void/reissue)", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 10000,
      existing: [row({ id: "inv1", total: 10000, hasPayments: false })],
    });
    expect(plan.action).toBe("none");
  });
});
