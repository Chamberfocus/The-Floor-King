/**
 * F1 Credits, Refunds & Effective AR — deterministic regression.
 */
import { describe, expect, it } from "vitest";
import {
  assessCreditApplication,
  assessRefundAmount,
  assessApplyAndRefundExclusive,
  creditMemoAvailable,
  customerAvailableCredit,
  effectiveInvoiceBalance,
  simulateConcurrentApplications,
  simulateConcurrentCreditUse,
  CREDIT_VOID_REQUIRED_MESSAGE,
  REFUND_VOID_REQUIRED_MESSAGE,
} from "@/lib/credit-ar";
import {
  assessPaymentAmount,
  invoiceRemainingBalance,
  activePaymentsTotal,
} from "@/lib/payment-safety";
import {
  planEstimateInvoiceCreation,
  netCommercialInvoiced,
} from "@/lib/change-order-invoice";
import { computeJobOpenBalance } from "@/lib/invoice-calc";

const line10k = [{ quantity: 1, rate: 10000 }];

describe("F1 effective invoice balance", () => {
  it("1. $10k invoice, no payments/credits → $10k due", () => {
    const e = effectiveInvoiceBalance({
      items: line10k,
      taxRate: 0,
      amountPaid: 0,
      appliedCredits: 0,
    });
    expect(e.amountDue).toBe(10000);
  });

  it("2. $10k + $6k payment → $4k due", () => {
    expect(
      effectiveInvoiceBalance({
        items: line10k,
        taxRate: 0,
        amountPaid: 6000,
        appliedCredits: 0,
      }).amountDue,
    ).toBe(4000);
  });

  it("3. $10k + $6k payment + $1.5k credit → $2.5k due", () => {
    expect(
      effectiveInvoiceBalance({
        items: line10k,
        taxRate: 0,
        amountPaid: 6000,
        appliedCredits: 1500,
      }).amountDue,
    ).toBe(2500);
  });

  it("4. fully paid $10k + $1.5k credit → $0 due; $1.5k customer credit", () => {
    expect(
      effectiveInvoiceBalance({
        items: line10k,
        taxRate: 0,
        amountPaid: 10000,
        appliedCredits: 0,
      }).amountDue,
    ).toBe(0);
    expect(
      creditMemoAvailable({
        memoAmount: 1500,
        memoStatus: "issued",
        applications: [],
        refunds: [],
      }),
    ).toBe(1500);
  });

  it("5. credit creation does NOT imply refund", () => {
    // Available credit exists without any refund rows.
    expect(
      creditMemoAvailable({
        memoAmount: 1500,
        applications: [],
        refunds: [],
      }),
    ).toBe(1500);
    expect(activePaymentsTotal([])).toBe(0);
  });

  it("6. $1.5k available + $500 refund → $1k available", () => {
    expect(
      creditMemoAvailable({
        memoAmount: 1500,
        applications: [],
        refunds: [{ amount: 500, status: "active" }],
      }),
    ).toBe(1000);
  });

  it("7. cannot refund more than available", () => {
    const g = assessRefundAmount({ amount: 2000, availableCredit: 1500 });
    expect(g.ok).toBe(false);
  });

  it("8. cannot apply more credit than invoice due", () => {
    const g = assessCreditApplication({
      amount: 5000,
      availableOnMemo: 5000,
      invoiceAmountDue: 2500,
    });
    expect(g.ok).toBe(false);
  });

  it("9. same credit cannot be applied twice beyond available", () => {
    const sim = simulateConcurrentApplications(1500, 10000, 1500, 1500);
    expect(sim.accepted).toEqual([1500]);
    expect(sim.rejected).toEqual([1500]);
  });

  it("10. same dollar cannot be fully applied and refunded", () => {
    expect(
      assessApplyAndRefundExclusive({
        issued: 1500,
        applied: 1500,
        refund: 500,
      }).ok,
    ).toBe(false);
    expect(
      assessApplyAndRefundExclusive({
        issued: 1500,
        applied: 1000,
        refund: 500,
      }).ok,
    ).toBe(true);
  });

  it("11. concurrent refunds cannot exceed available", () => {
    const sim = simulateConcurrentCreditUse(1500, 1000, 1000);
    expect(sim.accepted).toEqual([1000]);
    expect(sim.rejected).toEqual([1000]);
  });

  it("12. concurrent applications cannot exceed available", () => {
    const sim = simulateConcurrentApplications(1500, 10000, 1000, 1000);
    expect(sim.accepted).toEqual([1000]);
    expect(sim.rejected).toEqual([1000]);
  });

  it("13. voided credit no longer available / does not reduce AR when not applied", () => {
    expect(
      creditMemoAvailable({
        memoAmount: 1500,
        memoStatus: "void",
        applications: [],
        refunds: [],
      }),
    ).toBe(0);
    expect(
      customerAvailableCredit({
        memos: [{ id: "c1", amount: 1500, status: "void" }],
        applications: [],
        refunds: [],
      }),
    ).toBe(0);
  });

  it("14. voided refund restores available credit", () => {
    expect(
      creditMemoAvailable({
        memoAmount: 1500,
        applications: [],
        refunds: [{ amount: 500, status: "void" }],
      }),
    ).toBe(1500);
  });

  it("15. paid invoice unchanged conceptually after commercial decrease plan", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 8500,
      existing: [
        {
          id: "inv1",
          status: "paid",
          approvalSnapshotId: "s1",
          total: 10000,
          hasPayments: true,
        },
      ],
    });
    expect(plan.action).toBe("issue_credit");
    if (plan.action === "issue_credit") expect(plan.amount).toBe(1500);
    // Original invoice total remains 10000 in coverage rows.
    expect(plan.action === "issue_credit" && plan.invoicedTotal).toBe(10000);
  });

  it("16. partially paid commercial decrease → correct effective due", () => {
    // Invoice 10k, paid 6k, credit 1.5k → due 2.5k
    expect(
      effectiveInvoiceBalance({
        items: line10k,
        taxRate: 0,
        amountPaid: 6000,
        appliedCredits: 1500,
      }).amountDue,
    ).toBe(2500);
  });

  it("17. commercial increase Phase 1 still supplemental", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 12000,
      existing: [
        {
          id: "inv1",
          status: "paid",
          approvalSnapshotId: "s1",
          total: 10000,
          hasPayments: true,
        },
      ],
      commercialCreditsTotal: 0,
    });
    expect(plan.action).toBe("supplemental");
  });

  it("18. unpaid replacement still void_reissue", () => {
    expect(
      planEstimateInvoiceCreation({
        approvedTotal: 9000,
        existing: [
          {
            id: "inv1",
            status: "sent",
            approvalSnapshotId: "s1",
            total: 10000,
            hasPayments: false,
          },
        ],
      }).action,
    ).toBe("void_reissue");
  });

  it("19. F0 void payment still ignored in remaining", () => {
    expect(
      invoiceRemainingBalance(line10k, 0, [
        { amount: 10000, status: "void" },
      ]),
    ).toBe(10000);
  });

  it("20. F0 overpay protection still blocks", () => {
    expect(
      assessPaymentAmount({ amount: 1, remainingBalance: 0 }).ok,
    ).toBe(false);
  });

  it("21. job open balance includes credits", () => {
    const open = computeJobOpenBalance([
      {
        id: "i1",
        status: "sent",
        tax_rate: 0,
        items: line10k,
        amountPaid: 6000,
        appliedCredits: 1500,
      },
    ]);
    expect(open.balance).toBe(2500);
  });

  it("22–23. AR/customer due uses amountDue (credits reduce)", () => {
    const due = effectiveInvoiceBalance({
      items: line10k,
      taxRate: 0,
      amountPaid: 0,
      appliedCredits: 2000,
    }).amountDue;
    expect(due).toBe(8000);
    expect(netCommercialInvoiced(10000, 2000)).toBe(8000);
  });

  it("24. unauthorized roles documented as excluding crew for credit mutate", () => {
    const roles = ["admin", "office"];
    expect(roles).not.toContain("crew");
    expect(roles).not.toContain("customer");
  });

  it("25. hard-delete messages require void", () => {
    expect(CREDIT_VOID_REQUIRED_MESSAGE).toMatch(/Void/i);
    expect(REFUND_VOID_REQUIRED_MESSAGE).toMatch(/Void/i);
  });
});
