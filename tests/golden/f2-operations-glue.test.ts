/**
 * F2 Operations Glue — deterministic regression tests.
 */
import { describe, expect, it } from "vitest";
import {
  assessJobOperationalState,
  opsQueueGroup,
} from "@/lib/job-operational-state";
import {
  assessDuplicateOverride,
  classifyDuplicateMatches,
  normalizeEmail,
  normalizePersonName,
  normalizePhoneDigits,
  scoreCustomerDuplicate,
} from "@/lib/customer-duplicate";
import {
  assessTaskComplete,
  isTaskOverdue,
  shouldCreateAutomatedTask,
  automationSourceKey,
  isOpenTaskStatus,
} from "@/lib/office-task";
import { assessMaterialsReadyForSchedule } from "@/lib/materials-ready";
import {
  activePaymentsTotal,
  assessPaymentAmount,
  dayTaskCollectAmountDue,
  invoiceRemainingBalance,
} from "@/lib/payment-safety";
import {
  effectiveInvoiceBalance,
  assessRefundAmount,
  assessCreditApplication,
} from "@/lib/credit-ar";
import {
  planEstimateInvoiceCreation,
  invoiceCommercialEditBlocked,
} from "@/lib/change-order-invoice";
import { computeJobOpenBalance } from "@/lib/invoice-calc";
import {
  computeLineCoverage,
  isNonCoveringPoStatus,
  planPurchasingAdjust,
  type CoveragePoItem,
} from "@/lib/po-coverage";

describe("F2 day-task collect void / AR consistency", () => {
  const items = [{ quantity: 1, rate: 10000 }];

  it("active payment counts toward collected / reduces collect amount", () => {
    expect(
      dayTaskCollectAmountDue({
        items,
        taxRate: 0,
        payments: [{ amount: 4000, status: "active" }],
      }),
    ).toBe(6000);
    expect(activePaymentsTotal([{ amount: 4000, status: "active" }])).toBe(4000);
  });

  it("void payment does NOT count toward collected / paid", () => {
    expect(
      activePaymentsTotal([
        { amount: 4000, status: "active" },
        { amount: 4000, status: "void" },
      ]),
    ).toBe(4000);
    expect(
      dayTaskCollectAmountDue({
        items,
        taxRate: 0,
        payments: [
          { amount: 4000, status: "active" },
          { amount: 4000, status: "void" },
        ],
      }),
    ).toBe(6000);
  });

  it("voiding a payment restores Day Briefing collect amount", () => {
    const beforeVoid = dayTaskCollectAmountDue({
      items,
      taxRate: 0,
      payments: [{ amount: 10000, status: "active" }],
    });
    expect(beforeVoid).toBe(0);
    const afterVoid = dayTaskCollectAmountDue({
      items,
      taxRate: 0,
      payments: [{ amount: 10000, status: "void" }],
    });
    expect(afterVoid).toBe(10000);
  });

  it("matches canonical invoice remaining / effective balance", () => {
    const payments = [
      { amount: 3000, status: "active" },
      { amount: 2000, status: "void" },
    ];
    const due = dayTaskCollectAmountDue({ items, taxRate: 0, payments });
    expect(due).toBe(invoiceRemainingBalance(items, 0, payments, 0));
    expect(
      effectiveInvoiceBalance({
        items,
        taxRate: 0,
        amountPaid: activePaymentsTotal(payments),
        appliedCredits: 0,
      }).amountDue,
    ).toBe(due);
  });

  it("credits reduce amount due but are not cash collected", () => {
    const payments = [{ amount: 2000, status: "active" }];
    expect(activePaymentsTotal(payments)).toBe(2000);
    expect(
      dayTaskCollectAmountDue({
        items,
        taxRate: 0,
        payments,
        creditApplications: [{ amount: 1500, status: "active" }],
      }),
    ).toBe(6500);
  });

  it("refunds are not treated as negative payments on collect amount", () => {
    // Refunds are credit-side money-out; they do not appear in payments[].
    expect(
      dayTaskCollectAmountDue({
        items,
        taxRate: 0,
        payments: [{ amount: 5000, status: "active" }],
        creditApplications: [{ amount: 1000, status: "active" }],
      }),
    ).toBe(4000);
  });

  it("legacy payment without status still counts as active", () => {
    expect(
      dayTaskCollectAmountDue({
        items,
        taxRate: 0,
        payments: [{ amount: 2500 }],
      }),
    ).toBe(7500);
  });
});

describe("F2 office tasks", () => {
  it("1–4. open/overdue/complete semantics", () => {
    expect(isOpenTaskStatus("open")).toBe(true);
    expect(isOpenTaskStatus("cancelled")).toBe(false);
    expect(
      isTaskOverdue({
        status: "open",
        dueAt: "2020-01-01T00:00:00Z",
        now: new Date("2026-01-01"),
      }),
    ).toBe(true);
    expect(
      assessTaskComplete({
        status: "completed",
        completedAt: "2026-01-01",
        completedBy: "u1",
      }),
    ).toBe(true);
  });

  it("5. overdue false when completed", () => {
    expect(
      isTaskOverdue({
        status: "completed",
        dueAt: "2020-01-01T00:00:00Z",
      }),
    ).toBe(false);
  });

  it("6. cancelled not open", () => {
    expect(isOpenTaskStatus("cancelled")).toBe(false);
  });

  it("7. unauthorized override roles documented", () => {
    expect(
      assessDuplicateOverride({
        hasHighConfidenceMatch: true,
        forceCreate: true,
        overrideReason: "ok",
        actorRole: "crew",
      }).ok,
    ).toBe(false);
  });

  it("8. automation does not spam duplicate source keys", () => {
    const key = automationSourceKey("ready_to_schedule", "job-1");
    expect(
      shouldCreateAutomatedTask({
        sourceKey: key,
        existingOpenSourceKeys: [key],
      }),
    ).toBe(false);
    expect(
      shouldCreateAutomatedTask({
        sourceKey: key,
        existingOpenSourceKeys: [],
      }),
    ).toBe(true);
  });
});

describe("F2 job operational state", () => {
  const base = {
    status: "unscheduled",
    scheduledDate: null as string | null,
    warehouseReadyAt: null as string | null,
    hasMaterialNeed: true,
    activeHold: null as { reason: string } | null,
  };

  it("9. manual hold produces blocked state", () => {
    const s = assessJobOperationalState({
      ...base,
      activeHold: { reason: "Customer delay" },
    });
    expect(s.blocked).toBe(true);
    expect(s.blockerCode).toBe("manual_hold");
  });

  it("10. material outstanding → materials_not_ready", () => {
    const s = assessJobOperationalState(base);
    expect(s.blockerCode).toBe("materials_not_ready");
  });

  it("11. materials ready → ready_to_schedule", () => {
    const s = assessJobOperationalState({
      ...base,
      warehouseReadyAt: "2026-01-01T00:00:00Z",
    });
    expect(s.blockerCode).toBe("ready_to_schedule");
  });

  it("12. scheduled job next state", () => {
    const s = assessJobOperationalState({
      ...base,
      status: "scheduled",
      scheduledDate: "2026-02-01",
      warehouseReadyAt: "2026-01-01",
    });
    expect(s.blockerCode).toBe("scheduled");
  });

  it("13. completed does not show purchasing/scheduling next", () => {
    const s = assessJobOperationalState({
      ...base,
      status: "completed",
      hasPurchasingGap: true,
    });
    expect(s.blockerCode).toBe("completed");
    expect(s.nextAction).not.toMatch(/Schedule/i);
  });

  it("14. payment attention when in progress with balance", () => {
    const s = assessJobOperationalState({
      ...base,
      status: "in_progress",
      warehouseReadyAt: "2026-01-01",
      openBalance: 500,
    });
    expect(s.blockerCode).toBe("payment_due");
  });

  it("15. queue group consistent with state", () => {
    const s = assessJobOperationalState(base);
    expect(opsQueueGroup(s)).toBe("waiting_on_material");
  });
});

describe("F2 customer duplicates", () => {
  it("16b. same email/phone is high confidence", () => {
    expect(
      scoreCustomerDuplicate(
        { fullName: "A", email: "x@y.com" },
        { id: "1", full_name: "B", email: "X@Y.com" },
      )?.confidence,
    ).toBe("high");
    expect(
      scoreCustomerDuplicate(
        { fullName: "A", phone: "330-555-1212" },
        { id: "1", full_name: "B", phone: "(330) 555-1212" },
      )?.confidence,
    ).toBe("high");
  });

  it("16–18. email/phone normalization", () => {
    expect(normalizeEmail("  A@B.COM ")).toBe("a@b.com");
    expect(normalizePhoneDigits("(330) 555-1212")).toBe("3305551212");
    expect(normalizePhoneDigits("1-330-555-1212")).toBe("3305551212");
    expect(normalizePersonName("  Jane   Doe ")).toBe("jane doe");
  });

  it("19. name-only is possible, not auto-merge", () => {
    const scored = scoreCustomerDuplicate(
      { fullName: "Jane Doe" },
      { id: "1", full_name: "Jane Doe" },
    );
    expect(scored?.confidence).toBe("possible");
    expect(classifyDuplicateMatches([scored!]).requiresOverrideReason).toBe(
      false,
    );
  });

  it("20–21. high confidence override requires reason + role", () => {
    const gate = assessDuplicateOverride({
      hasHighConfidenceMatch: true,
      forceCreate: true,
      overrideReason: "Different tenant same building phone",
      actorRole: "office",
    });
    expect(gate.ok).toBe(true);
    expect(
      assessDuplicateOverride({
        hasHighConfidenceMatch: true,
        forceCreate: true,
        overrideReason: "  ",
        actorRole: "office",
      }).ok,
    ).toBe(false);
  });

  it("22. unauthorized override blocked", () => {
    expect(
      assessDuplicateOverride({
        hasHighConfidenceMatch: true,
        forceCreate: true,
        overrideReason: "because",
        actorRole: "warehouse",
      }).ok,
    ).toBe(false);
  });
});

describe("F2 material coordination + F0 gate", () => {
  it("23. materials readiness consistent with F0", () => {
    expect(
      assessMaterialsReadyForSchedule({
        warehouseReadyAt: null,
        hasMaterialNeed: true,
      }).ready,
    ).toBe(false);
    expect(
      assessJobOperationalState({
        status: "unscheduled",
        scheduledDate: null,
        warehouseReadyAt: null,
        hasMaterialNeed: true,
        activeHold: null,
      }).materialsReady,
    ).toBe(false);
  });

  it("24–26. coverage gap / void / ready", () => {
    const item = (
      p: Partial<CoveragePoItem> & Pick<CoveragePoItem, "poItemId" | "poId">,
    ): CoveragePoItem => ({
      jobLineId: "l1",
      productId: "p1",
      quantity: 100,
      receivedQty: null,
      receivedAt: null,
      poStatus: "ordered",
      ...p,
    });
    const full = computeLineCoverage("l1", 100, [
      item({ poItemId: "a", poId: "po1", quantity: 100 }),
    ]);
    expect(full.gap).toBe(0);
    expect(planPurchasingAdjust(full).supplementalQty).toBe(0);
    expect(isNonCoveringPoStatus("void")).toBe(true);
    const partial = computeLineCoverage("l1", 100, [
      item({ poItemId: "a", poId: "po1", quantity: 40 }),
    ]);
    expect(partial.gap).toBe(60);
  });
});

describe("F2 manual hold", () => {
  it("27–29. hold blocks; release clears; reason preserved in label path", () => {
    const held = assessJobOperationalState({
      status: "unscheduled",
      scheduledDate: null,
      warehouseReadyAt: "2026-01-01",
      hasMaterialNeed: true,
      activeHold: { reason: "Site not ready" },
    });
    expect(held.blocked).toBe(true);
    expect(held.explanation).toContain("Site not ready");
    const released = assessJobOperationalState({
      status: "unscheduled",
      scheduledDate: null,
      warehouseReadyAt: "2026-01-01",
      hasMaterialNeed: true,
      activeHold: null,
    });
    expect(released.blockerCode).toBe("ready_to_schedule");
  });
});

describe("F2 service callback surfacing", () => {
  it("30–34. open callback surfaces; completed job + callback", () => {
    const s = assessJobOperationalState({
      status: "completed",
      scheduledDate: "2026-01-01",
      warehouseReadyAt: "2026-01-01",
      hasMaterialNeed: false,
      activeHold: null,
      hasOpenServiceCallback: true,
    });
    expect(s.blockerCode).toBe("open_service_callback");
    expect(s.blocked).toBe(true);
  });
});

describe("F2 financial regressions (F0/F1)", () => {
  const line = [{ quantity: 1, rate: 10000 }];

  it("35–36. F0 overpay + void payment remaining", () => {
    expect(assessPaymentAmount({ amount: 1, remainingBalance: 0 }).ok).toBe(
      false,
    );
    expect(
      invoiceRemainingBalance(line, 0, [{ amount: 10000, status: "void" }]),
    ).toBe(10000);
  });

  it("37–39. F1 AR / credit apply / refund limits", () => {
    expect(
      effectiveInvoiceBalance({
        items: line,
        taxRate: 0,
        amountPaid: 6000,
        appliedCredits: 1500,
      }).amountDue,
    ).toBe(2500);
    expect(
      assessCreditApplication({
        amount: 5000,
        availableOnMemo: 5000,
        invoiceAmountDue: 2500,
      }).ok,
    ).toBe(false);
    expect(assessRefundAmount({ amount: 2000, availableCredit: 1500 }).ok).toBe(
      false,
    );
  });

  it("40–41. paid immutable + commercial decrease → issue_credit", () => {
    expect(invoiceCommercialEditBlocked(true).blocked).toBe(true);
    expect(
      planEstimateInvoiceCreation({
        approvedTotal: 8500,
        existing: [
          {
            id: "i1",
            status: "paid",
            approvalSnapshotId: "s",
            total: 10000,
            hasPayments: true,
          },
        ],
      }).action,
    ).toBe("issue_credit");
  });

  it("42. job open balance credit-aware", () => {
    expect(
      computeJobOpenBalance([
        {
          id: "i1",
          status: "sent",
          tax_rate: 0,
          items: line,
          amountPaid: 6000,
          appliedCredits: 1500,
        },
      ]).balance,
    ).toBe(2500);
  });

  it("43. PO gap coverage still correct", () => {
    const cov = computeLineCoverage("l1", 550, [
      {
        poItemId: "a",
        poId: "po1",
        jobLineId: "l1",
        productId: "p",
        quantity: 300,
        receivedQty: null,
        receivedAt: null,
        poStatus: "ordered",
      },
    ]);
    expect(cov.gap).toBe(250);
  });
});
