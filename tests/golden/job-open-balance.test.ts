/**
 * Job open balance = sum of remaining balances on all active invoices.
 * Phase 1 follow-up for original + supplemental invoices.
 */
import { describe, expect, it } from "vitest";
import {
  computeJobOpenBalance,
  type JobBalanceInvoiceInput,
} from "@/lib/invoice-calc";
import {
  planEstimateInvoiceCreation,
  type CoverageInvoiceRow,
} from "@/lib/change-order-invoice";
import { assessInvoiceCommercialGate } from "@/lib/estimate-approval";

function inv(
  partial: Partial<JobBalanceInvoiceInput> & { id: string },
): JobBalanceInvoiceInput {
  return {
    status: "sent",
    tax_rate: 0,
    items: [{ quantity: 1, rate: 10000 }],
    payments: [],
    ...partial,
  };
}

describe("computeJobOpenBalance — multi-invoice job AR", () => {
  it("1. one unpaid invoice → full remaining balance", () => {
    const r = computeJobOpenBalance([
      inv({ id: "a", items: [{ quantity: 1, rate: 10000 }] }),
    ]);
    expect(r.hasInvoice).toBe(true);
    expect(r.balance).toBe(10000);
    expect(r.invoiceId).toBe("a");
    expect(r.openInvoices).toEqual([{ invoiceId: "a", balance: 10000 }]);
  });

  it("2. original $5k remaining + supplemental $2k → $7k", () => {
    const r = computeJobOpenBalance([
      inv({
        id: "orig",
        items: [{ quantity: 1, rate: 10000 }],
        payments: [{ amount: 5000 }],
        status: "partial",
      }),
      inv({
        id: "sup",
        items: [{ quantity: 1, rate: 2000 }],
        payments: [],
        status: "sent",
      }),
    ]);
    expect(r.balance).toBe(7000);
    expect(r.openInvoices).toHaveLength(2);
  });

  it("3. original fully paid + supplemental unpaid → supplemental only", () => {
    const r = computeJobOpenBalance([
      inv({
        id: "orig",
        items: [{ quantity: 1, rate: 10000 }],
        payments: [{ amount: 10000 }],
        status: "paid",
      }),
      inv({
        id: "sup",
        items: [{ quantity: 1, rate: 2000 }],
      }),
    ]);
    expect(r.balance).toBe(2000);
    expect(r.invoiceId).toBe("sup");
  });

  it("4. original remaining + supplemental fully paid → original only", () => {
    const r = computeJobOpenBalance([
      inv({
        id: "orig",
        items: [{ quantity: 1, rate: 10000 }],
        payments: [{ amount: 5000 }],
        status: "partial",
      }),
      inv({
        id: "sup",
        items: [{ quantity: 1, rate: 2000 }],
        payments: [{ amount: 2000 }],
        status: "paid",
      }),
    ]);
    expect(r.balance).toBe(5000);
    expect(r.invoiceId).toBe("orig");
  });

  it("5. void $10k + active $2k → $2k", () => {
    const r = computeJobOpenBalance([
      inv({
        id: "voided",
        status: "void",
        items: [{ quantity: 1, rate: 10000 }],
      }),
      inv({
        id: "active",
        items: [{ quantity: 1, rate: 2000 }],
      }),
    ]);
    expect(r.balance).toBe(2000);
    expect(r.invoiceId).toBe("active");
  });

  it("6. replacement: void old + active replacement $12k → $12k", () => {
    const r = computeJobOpenBalance([
      inv({
        id: "old",
        status: "void",
        items: [{ quantity: 1, rate: 10000 }],
      }),
      inv({
        id: "repl",
        items: [{ quantity: 1, rate: 12000 }],
      }),
    ]);
    expect(r.balance).toBe(12000);
    expect(r.invoiceId).toBe("repl");
  });

  it("7. multiple partial invoices → exact sum of remainings", () => {
    const r = computeJobOpenBalance([
      inv({
        id: "a",
        items: [{ quantity: 1, rate: 10000 }],
        payments: [{ amount: 3000 }],
        status: "partial",
      }),
      inv({
        id: "b",
        items: [{ quantity: 1, rate: 2000 }],
        payments: [{ amount: 500 }],
        status: "partial",
      }),
      inv({
        id: "c",
        tax_rate: 8,
        items: [{ quantity: 1, rate: 1000 }], // total 1080
        payments: [{ amount: 80 }],
        status: "partial",
      }),
    ]);
    // 7000 + 1500 + 1000 = 9500
    expect(r.balance).toBe(9500);
  });

  it("8. no invoices → $0 / hasInvoice false", () => {
    const r = computeJobOpenBalance([]);
    expect(r).toEqual({
      hasInvoice: false,
      invoiceId: null,
      balance: 0,
      openInvoices: [],
    });
  });
});

describe("Phase 1 invoice planning still intact after balance fix", () => {
  const row = (
    p: Partial<CoverageInvoiceRow> & { id: string },
  ): CoverageInvoiceRow => ({
    status: "sent",
    approvalSnapshotId: "snap",
    total: 10000,
    hasPayments: false,
    ...p,
  });

  it("A. no prior → full original", () => {
    expect(
      planEstimateInvoiceCreation({ approvedTotal: 10000, existing: [] }).action,
    ).toBe("full");
  });

  it("B. unpaid + new approval → void_reissue", () => {
    expect(
      planEstimateInvoiceCreation({
        approvedTotal: 12000,
        existing: [row({ id: "i1", total: 10000 })],
      }).action,
    ).toBe("void_reissue");
  });

  it("C. paid + increase → supplemental", () => {
    expect(
      planEstimateInvoiceCreation({
        approvedTotal: 12000,
        existing: [row({ id: "i1", total: 10000, hasPayments: true })],
      }).action,
    ).toBe("supplemental");
  });

  it("D. multi increase → only next delta", () => {
    const p = planEstimateInvoiceCreation({
      approvedTotal: 13500,
      existing: [
        row({ id: "i1", total: 10000, hasPayments: true }),
        row({ id: "i2", total: 2000, approvalSnapshotId: "v2" }),
      ],
    });
    expect(p.action).toBe("supplemental");
    if (p.action === "supplemental") expect(p.amount).toBe(1500);
  });

  it("E. decrease with paid → issue_credit", () => {
    expect(
      planEstimateInvoiceCreation({
        approvedTotal: 9000,
        existing: [row({ id: "i1", total: 10000, hasPayments: true })],
      }).action,
    ).toBe("issue_credit");
  });

  it("F. stale estimate → invoice gate blocked", () => {
    expect(
      assessInvoiceCommercialGate({
        status: "sent",
        approvalStale: true,
        hasSnapshot: true,
      }).ok,
    ).toBe(false);
  });

  it("G. legacy unlinked → review block", () => {
    expect(
      planEstimateInvoiceCreation({
        approvedTotal: 12000,
        existing: [row({ id: "leg", approvalSnapshotId: null })],
      }).action,
    ).toBe("legacy_review");
  });

  it("H. job open balance sums active invoices", () => {
    expect(
      computeJobOpenBalance([
        inv({
          id: "o",
          items: [{ quantity: 1, rate: 5000 }],
        }),
        inv({
          id: "s",
          items: [{ quantity: 1, rate: 2000 }],
        }),
      ]).balance,
    ).toBe(7000);
  });
});
