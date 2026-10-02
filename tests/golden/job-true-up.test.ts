import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAUSE_INCOMPLETE,
  COMMISSION_SPLIT_UNSUPPORTED,
  LABOR_INCOMPLETE,
  NO_COMMISSION_NO_GP,
  PARTIAL_PAYMENT_LIMITATION,
  TRUE_UP_FORMULA_VERSION,
  adjustmentIdempotencyKey,
  buildTrueUp,
  commissionAmountCents,
  commissionRateBps,
  commissionableRevenue,
  deriveTrueUpStatus,
  earnedIdempotencyKey,
  estimatedFreightCents,
  estimatedRevenueFromSnapshots,
  lateCostAdjustment,
  marginCauseLines,
  pageOf,
  planFullPayment,
  profitTotals,
  resolveFreight,
  resolveLabor,
  resolveMaterial,
  resolveOther,
  salespersonChangeAllowed,
  statementTotals,
  trueUpAccess,
  type StatementJob,
  type TrueUpFacts,
} from "@/lib/job-true-up";
import type { UserRole } from "@/lib/types";

const sql = readFileSync("supabase/migrations/0481_job_true_up.sql", "utf8");
const actions = readFileSync("src/app/(app)/jobs/[id]/true-up/actions.ts", "utf8");

function dollars(gp: bigint, revenue: bigint) {
  return {
    rate: commissionRateBps(gp, revenue),
    commission: commissionAmountCents(gp, revenue),
  };
}

describe("Floor King commission tiers", () => {
  it("uses formula version 1 and integer boundaries", () => {
    expect(TRUE_UP_FORMULA_VERSION).toBe(1);
    const rev = BigInt(2_000_000);
    expect(dollars(BigInt(1_000_000), rev)).toEqual({ rate: BigInt(800), commission: BigInt(80_000) });
    expect(dollars(BigInt(900_000), rev)).toEqual({ rate: BigInt(700), commission: BigInt(63_000) });
    expect(dollars(BigInt(800_000), rev)).toEqual({ rate: BigInt(600), commission: BigInt(48_000) });
    expect(dollars(BigInt(700_000), rev)).toEqual({ rate: BigInt(500), commission: BigInt(35_000) });
    expect(dollars(BigInt(600_000), rev)).toEqual({ rate: BigInt(250), commission: BigInt(15_000) });
  });

  it("keeps 49.999, 44.999, 39.999, and 34.999 on the lower tier", () => {
    const rev = BigInt(100_000);
    expect(commissionRateBps(BigInt(49_999), rev)).toBe(BigInt(700));
    expect(commissionRateBps(BigInt(45_000), rev)).toBe(BigInt(700));
    expect(commissionRateBps(BigInt(44_999), rev)).toBe(BigInt(600));
    expect(commissionRateBps(BigInt(40_000), rev)).toBe(BigInt(600));
    expect(commissionRateBps(BigInt(39_999), rev)).toBe(BigInt(500));
    expect(commissionRateBps(BigInt(35_000), rev)).toBe(BigInt(500));
    expect(commissionRateBps(BigInt(34_999), rev)).toBe(BigInt(250));
    expect(commissionRateBps(BigInt(50_000), rev)).toBe(BigInt(800));
  });

  it("pays nothing on zero or negative gross profit and does not divide by zero revenue", () => {
    expect(commissionAmountCents(BigInt(0), BigInt(2_000_000))).toBe(BigInt(0));
    expect(commissionAmountCents(BigInt(-1), BigInt(2_000_000))).toBe(BigInt(0));
    expect(commissionAmountCents(BigInt(100), BigInt(0))).toBe(BigInt(0));
    expect(commissionRateBps(BigInt(100), BigInt(0))).toBe(BigInt(0));
    expect(commissionRateBps(BigInt(-5), BigInt(-5))).toBe(BigInt(0));
  });
});

describe("commissionable revenue", () => {
  const base = {
    id: "inv-1",
    status: "sent",
    commercialKind: "original",
    sequence: 1,
    taxRatePct: "8.00",
    lines: [{ quantity: "1", rate: "20000.00" }],
  };

  it("excludes sales tax", () => {
    const revenue = commissionableRevenue({ invoices: [base] });
    expect(revenue.cents).toBe(BigInt(2_000_000));
    expect(revenue.taxCents).toBe(BigInt(160_000));
  });

  it("does not treat deposits, payments, or refunds as revenue", () => {
    const withCash = commissionableRevenue({
      invoices: [base],
      depositsCents: BigInt(500_000),
      paymentsCents: BigInt(2_000_000),
      refundsCents: BigInt(100_000),
    });
    expect(withCash.cents).toBe(BigInt(2_000_000));
    expect(withCash.depositsIgnoredCents).toBe(BigInt(500_000));
    expect(withCash.paymentsIgnoredCents).toBe(BigInt(2_000_000));
    expect(withCash.refundsIgnoredCents).toBe(BigInt(100_000));
  });

  it("reduces revenue by the pre-tax share of credits and write-offs", () => {
    const revenue = commissionableRevenue({
      invoices: [{ ...base, appliedCreditCents: BigInt(216_000), appliedWriteOffCents: BigInt(108_000) }],
    });
    expect(revenue.cents).toBe(BigInt(2_000_000) - BigInt(200_000) - BigInt(100_000));
  });

  it("drops void invoices, drafts, cancelled lines, and a second original", () => {
    const revenue = commissionableRevenue({
      invoices: [
        { ...base, id: "void", status: "void" },
        { ...base, id: "draft", status: "draft" },
        {
          ...base,
          id: "dup",
          sequence: 2,
          lines: [{ quantity: 1, rate: 999 }],
        },
        {
          ...base,
          lines: [
            { quantity: "1", rate: "20000.00" },
            { quantity: "1", rate: "500.00", cancelled: true },
          ],
        },
      ],
    });
    expect(revenue.cents).toBe(BigInt(2_000_000));
    expect(revenue.duplicateOriginalsExcluded).toEqual(["dup"]);
    expect(revenue.voidExcluded).toBe(1);
    expect(revenue.draftExcluded).toBe(1);
  });

  it("adds a supplemental change order and keeps a decrease credit", () => {
    const revenue = commissionableRevenue({
      invoices: [
        base,
        {
          id: "sup",
          status: "paid",
          commercialKind: "supplemental",
          sequence: 2,
          taxRatePct: 0,
          lines: [{ quantity: 1, rate: "350.00" }],
        },
      ],
    });
    expect(revenue.cents).toBe(BigInt(2_035_000));
  });
});

describe("estimated contract and freight", () => {
  it("keeps the original snapshot and the approved change-order delta", () => {
    const estimated = estimatedRevenueFromSnapshots([
      { version: 1, subtotalCents: BigInt(18_000_00), discountCents: BigInt(0), taxCents: BigInt(1_440_00), totalCents: BigInt(19_440_00) },
      { version: 2, subtotalCents: BigInt(20_000_00), discountCents: BigInt(0), taxCents: BigInt(1_600_00), totalCents: BigInt(21_600_00) },
    ]);
    expect(estimated.originalCents).toBe(BigInt(1_800_000));
    expect(estimated.latestCents).toBe(BigInt(2_000_000));
    expect(estimated.changeOrderCents).toBe(BigInt(200_000));
  });

  it("a decrease is a negative change-order delta and does not rewrite version 1", () => {
    const estimated = estimatedRevenueFromSnapshots([
      { version: 1, subtotalCents: BigInt(0), discountCents: BigInt(0), taxCents: BigInt(0), totalCents: BigInt(2_000_000) },
      { version: 2, subtotalCents: BigInt(0), discountCents: BigInt(0), taxCents: BigInt(0), totalCents: BigInt(1_800_000) },
    ]);
    expect(estimated.originalCents).toBe(BigInt(2_000_000));
    expect(estimated.changeOrderCents).toBe(BigInt(-200_000));
  });

  it("estimates freight from bare material and the org markup", () => {
    expect(estimatedFreightCents(BigInt(1_000_00), "10")).toBe(BigInt(10_000));
    expect(estimatedFreightCents(null, "10")).toBeNull();
  });
});

describe("missing cost is not zero", () => {
  it("flags an open PO as incomplete material", () => {
    const material = resolveMaterial({
      pulls: [],
      poLines: [{ poStatus: "ordered", description: "Carpet", quantity: "10", receivedQty: "0", unitCost: "4" }],
      entries: [],
    });
    expect(material.resolution.state).toBe("incomplete");
  });

  it("uses pulls and does not add the same received product again", () => {
    const material = resolveMaterial({
      pulls: [{ productId: "p1", qty: "10", unitCost: "4.00", extendedCost: "40.00" }],
      poLines: [{ poStatus: "received", productId: "p1", description: "Carpet", quantity: "10", receivedQty: "10", unitCost: "4" }],
      entries: [],
    });
    expect(material.resolution).toMatchObject({ state: "auto", cents: BigInt(4_000) });
  });

  it("counts received drop-ship material that was never pulled", () => {
    const material = resolveMaterial({
      pulls: [],
      poLines: [{ poStatus: "closed", description: "Special order", quantity: "2", receivedQty: "2", unitCost: "25.00" }],
      entries: [],
    });
    expect(material.resolution).toMatchObject({ state: "auto", cents: BigInt(5_000) });
  });

  it("says labor is incomplete when an installer is assigned and no bill is approved", () => {
    const labor = resolveLabor({
      bills: [],
      jobId: "job",
      installerAssigned: true,
      legacyLaborRows: 0,
      entries: [],
    });
    expect(labor.resolution).toEqual({ state: "incomplete", hint: LABOR_INCOMPLETE });
  });

  it("uses approved installer bills and ignores legacy job labor dollars", () => {
    const labor = resolveLabor({
      bills: [{ id: "b", job_id: "job", status: "approved", total: "640.00" }],
      jobId: "job",
      installerAssigned: true,
      legacyLaborRows: 3,
      entries: [],
    });
    expect(labor.resolution).toMatchObject({ state: "auto", cents: BigInt(64_000) });
  });

  it("flags freight that was ordered without an amount", () => {
    const freight = resolveFreight({
      poLines: [{ poStatus: "ordered", description: "Supplier freight", quantity: "1", receivedQty: "0", unitCost: null }],
      entries: [],
    });
    expect(freight.resolution.state).toBe("incomplete");
  });

  it("lets an authorized entry confirm zero without pretending a missing cost was zero", () => {
    const before = resolveFreight({ poLines: [], entries: [] });
    expect(before.resolution.state).toBe("unknown");
    const after = resolveFreight({
      poLines: [],
      entries: [{ category: "freight", kind: "confirm_zero", amountCents: BigInt(0), reason: "Supplier delivered free" }],
    });
    expect(after.resolution).toMatchObject({ state: "confirmed_zero", cents: BigInt(0) });
  });

  it("keeps overhead out of other direct cost", () => {
    const other = resolveOther({
      expenses: [
        { category: "rent", amountCents: BigInt(50_000) },
        { category: "tools", amountCents: BigInt(2_500) },
      ],
      issueCostCents: BigInt(0),
      hasInstallerBills: true,
      subcontractorExpenseCents: BigInt(9_000),
      entries: [],
    });
    expect(other.resolution).toMatchObject({ state: "auto", cents: BigInt(2_500) });
  });
});

function readyFacts(patch: Partial<TrueUpFacts> = {}): TrueUpFacts {
  return {
    jobCompleted: true,
    trueUpExists: true,
    salespersonId: "sales-1",
    approved: false,
    paidInFull: false,
    openBalanceCents: BigInt(0),
    hasCollectibleInvoice: true,
    collectionOverride: false,
    zeroRevenueAcknowledged: false,
    revenue: {
      cents: BigInt(2_000_000),
      taxCents: BigInt(160_000),
      state: "known",
      duplicateOriginalsExcluded: [],
      voidExcluded: 0,
      draftExcluded: 0,
      refundsIgnoredCents: BigInt(0),
      depositsIgnoredCents: BigInt(0),
      paymentsIgnoredCents: BigInt(0),
    },
    estimated: {
      originalRevenueCents: BigInt(2_000_000),
      changeOrderRevenueCents: BigInt(0),
      materialCents: BigInt(800_000),
      laborCents: BigInt(200_000),
      freightCents: BigInt(0),
      otherCents: BigInt(0),
    },
    material: {
      category: "material",
      resolution: { state: "auto", cents: BigInt(700_000), source: "pulls" },
      calculatedCents: BigInt(700_000),
      calculatedState: "auto",
      hint: null,
    },
    labor: {
      category: "labor",
      resolution: { state: "auto", cents: BigInt(400_000), source: "bills" },
      calculatedCents: BigInt(400_000),
      calculatedState: "auto",
      hint: null,
    },
    freight: {
      category: "freight",
      resolution: { state: "confirmed_zero", cents: BigInt(0), reason: "No freight" },
      calculatedCents: null,
      calculatedState: "unknown",
      hint: null,
    },
    other: {
      category: "other",
      resolution: { state: "confirmed_zero", cents: BigInt(0), reason: "None" },
      calculatedCents: null,
      calculatedState: "unknown",
      hint: null,
    },
    ...patch,
  };
}

describe("true-up workflow", () => {
  it("puts a completed job with no row into needs true-up", () => {
    expect(
      deriveTrueUpStatus({
        jobCompleted: true,
        trueUpExists: false,
        costsComplete: false,
        approved: false,
        collectionSatisfied: false,
        paidInFull: false,
      }),
    ).toBe("needs_true_up");
  });

  it("blocks approval while material, labor, or freight is missing", () => {
    const missing = buildTrueUp(
      readyFacts({
        material: {
          category: "material",
          resolution: { state: "unknown" },
          calculatedCents: null,
          calculatedState: "unknown",
          hint: null,
        },
      }),
    );
    expect(missing.canApprove).toBe(false);
    expect(missing.status).toBe("missing_costs");
    expect(missing.marginAnalysis).toEqual([CAUSE_INCOMPLETE]);
  });

  it("is ready when every category is resolved and not payable until collected", () => {
    const ready = buildTrueUp(readyFacts());
    expect(ready.status).toBe("ready_for_review");
    expect(ready.canApprove).toBe(true);
    expect(ready.commissionCents).toBe(BigInt(63_000));
    const waiting = buildTrueUp(readyFacts({ approved: true, openBalanceCents: BigInt(50_000) }));
    expect(waiting.status).toBe("approved");
    expect(waiting.commissionStatus).toBe("approved_awaiting_collection");
    const payable = buildTrueUp(readyFacts({ approved: true, openBalanceCents: BigInt(0) }));
    expect(payable.status).toBe("commission_payable");
  });

  it("lets only an admin collection override make an open balance payable", () => {
    const overridden = buildTrueUp(
      readyFacts({ approved: true, openBalanceCents: BigInt(50_000), collectionOverride: true }),
    );
    expect(overridden.collectionSatisfied).toBe(true);
    expect(overridden.status).toBe("commission_payable");
  });

  it("flags a job with no positive gross profit", () => {
    const none = buildTrueUp(
      readyFacts({
        material: {
          category: "material",
          resolution: { state: "auto", cents: BigInt(2_500_000), source: "pulls" },
          calculatedCents: BigInt(2_500_000),
          calculatedState: "auto",
          hint: null,
        },
      }),
    );
    expect(none.commissionCents).toBe(BigInt(0));
    expect(none.flags).toContain(NO_COMMISSION_NO_GP);
  });

  it("does not approve twice and does not pay a line twice", () => {
    const approved = buildTrueUp(readyFacts({ approved: true }));
    expect(approved.canApprove).toBe(false);
    expect(planFullPayment({ lines: [{ id: "1", status: "paid", amountCents: BigInt(100) }] }).ok).toBe(false);
    expect(planFullPayment({ lines: [{ id: "1", status: "payable", amountCents: BigInt(100) }] })).toEqual({
      ok: true,
      totalCents: BigInt(100),
    });
    expect(earnedIdempotencyKey("tu", 1)).toBe(earnedIdempotencyKey("tu", 1));
    expect(PARTIAL_PAYMENT_LIMITATION).toMatch(/full/);
  });

  it("carries a late freight cost as an adjustment and keeps the approved amount", () => {
    const late = lateCostAdjustment({
      approvedCommissionCents: BigInt(63_000),
      revisedRevenueCents: BigInt(2_000_000),
      revisedGpCents: BigInt(880_000),
      alreadyPaidCents: BigInt(0),
    });
    expect(late.revisedCommissionCents).toBe(BigInt(52_800));
    expect(late.adjustmentCents).toBe(BigInt(-10_200));
    expect(late.timing).toBe("before_payment");
    const afterPay = lateCostAdjustment({
      approvedCommissionCents: BigInt(63_000),
      revisedRevenueCents: BigInt(2_000_000),
      revisedGpCents: BigInt(880_000),
      alreadyPaidCents: BigInt(63_000),
    });
    expect(afterPay.timing).toBe("carry_forward");
    const credit = lateCostAdjustment({
      approvedCommissionCents: BigInt(52_800),
      revisedRevenueCents: BigInt(2_000_000),
      revisedGpCents: BigInt(900_000),
      alreadyPaidCents: BigInt(52_800),
    });
    expect(credit.adjustmentCents).toBe(BigInt(10_200));
    expect(adjustmentIdempotencyKey("tu", "880000")).toBe("adjustment:tu:880000");
  });

  it("freezes salesperson changes after approval except for an admin correction", () => {
    expect(salespersonChangeAllowed({ approved: false, role: "office" }).ok).toBe(true);
    expect(salespersonChangeAllowed({ approved: true, role: "office" }).ok).toBe(false);
    expect(salespersonChangeAllowed({ approved: true, role: "admin" }).ok).toBe(true);
    expect(salespersonChangeAllowed({ approved: false, role: "salesman" }).ok).toBe(false);
    expect(COMMISSION_SPLIT_UNSUPPORTED).toMatch(/one salesperson/);
  });

  it("states the factual margin causes when costs are complete", () => {
    const lines = marginCauseLines({
      costsComplete: true,
      revenueVariance: BigInt(35_000),
      materialImpact: BigInt(-41_000),
      laborImpact: BigInt(-64_000),
      freightImpact: BigInt(-22_500),
      otherImpact: BigInt(0),
    });
    expect(lines[0]).toContain("$350.00");
    expect(lines[1]).toContain("-$410.00");
    expect(lines).not.toContain(CAUSE_INCOMPLETE);
  });
});

describe("reports reconcile independent of the page", () => {
  const jobs: StatementJob[] = [
    {
      jobId: "a",
      customer: "A",
      completedOn: "2026-09-01",
      finalRevenueCents: BigInt(2_000_000),
      actualCostCents: BigInt(1_100_000),
      gpCents: BigInt(900_000),
      marginHundredths: BigInt(4500),
      rateBps: BigInt(700),
      commissionCents: BigInt(63_000),
      adjustmentCents: BigInt(-10_200),
      paidCents: BigInt(0),
      salespersonId: "s1",
      status: "commission_payable",
    },
    {
      jobId: "b",
      customer: "B",
      completedOn: "2026-09-02",
      finalRevenueCents: BigInt(1_000_000),
      actualCostCents: BigInt(400_000),
      gpCents: BigInt(600_000),
      marginHundredths: BigInt(6000),
      rateBps: BigInt(800),
      commissionCents: BigInt(48_000),
      adjustmentCents: BigInt(0),
      paidCents: BigInt(48_000),
      salespersonId: "s1",
      status: "commission_paid",
    },
  ];

  it("keeps statement totals equal to the detail and stable across pages", () => {
    const totals = statementTotals(jobs);
    expect(totals.commissionEarnedCents).toBe(BigInt(111_000));
    expect(totals.adjustmentCents).toBe(BigInt(-10_200));
    expect(totals.paidCents).toBe(BigInt(48_000));
    expect(totals.owedCents).toBe(BigInt(111_000) - BigInt(10_200) - BigInt(48_000));
    const page = pageOf(jobs, 2, 1);
    expect(statementTotals(jobs).owedCents).toBe(totals.owedCents);
    expect(page.rows).toHaveLength(1);
    expect(page.total).toBe(2);
  });

  it("reconciles profitability as actual gross profit minus commission", () => {
    const totals = profitTotals([
      {
        revenueCents: BigInt(2_000_000),
        estimatedCostCents: BigInt(1_000_000),
        actualCostCents: BigInt(1_100_000),
        estimatedGpCents: BigInt(1_000_000),
        actualGpCents: BigInt(900_000),
        commissionCents: BigInt(63_000),
      },
    ]);
    expect(totals.netAfterCommissionCents).toBe(BigInt(837_000));
    expect(pageOf([totals], 1, 25).total).toBe(1);
  });
});

describe("true-up security", () => {
  const roles: UserRole[] = [
    "admin",
    "office",
    "sales_manager",
    "salesman",
    "scheduler",
    "warehouse",
    "crew",
    "customer",
  ];

  it("matches the role matrix", () => {
    const admin = trueUpAccess("admin");
    expect(admin.overrideCommission && admin.markPaid && admin.ownerReport).toBe(true);
    const office = trueUpAccess("office");
    expect(office.enterCosts && office.approve && office.markPaid && office.ownerReport).toBe(true);
    expect(office.overrideCommission).toBe(false);
    expect(office.overrideCollection).toBe(false);
    expect(trueUpAccess("salesman")).toEqual({
      viewOwn: true,
      viewAll: false,
      enterCosts: false,
      approve: false,
      overrideCommission: false,
      overrideCollection: false,
      correctSalesperson: false,
      markPaid: false,
      ownerReport: false,
      performance: false,
    });
    for (const role of ["sales_manager", "scheduler", "warehouse", "crew", "customer"] as const) {
      expect(trueUpAccess(role).viewOwn).toBe(false);
      expect(trueUpAccess(role).viewAll).toBe(false);
      expect(trueUpAccess(role).ownerReport).toBe(false);
    }
    expect(roles).toHaveLength(8);
  });

  it("enforces the same roles in server actions and SQL", () => {
    expect(actions).toContain("assertRole");
    expect(actions).toContain('assertRole(["admin", "office"])');
    expect(actions).toContain('assertRole(["admin"])');
    expect(actions).toContain("assertTrueUpCapability");
    expect(sql).toContain("Not authorized.");
    expect(sql).toContain("my_role() = 'salesman' and salesperson_id = auth.uid()");
    expect(sql).toContain("Approved true-up snapshots are immutable");
    expect(sql).toContain("p_gp * 10000 >= p_rev * 5000");
    expect(sql).toContain("p_gp * 10000 >= p_rev * 4500");
    expect(sql).toContain("p_gp * 10000 >= p_rev * 3500");
    expect(sql).toContain("else 250");
    expect(sql).not.toMatch(/set\s+books_of_record/i);
    expect(sql).not.toMatch(/set\s+posting_enabled/i);
    expect(sql).not.toMatch(/set\s+backup_pitr_confirmed_at/i);
    expect(sql).toContain("Does NOT enable accounting");
    expect(sql).not.toContain("record_lifecycle_events");
    expect(sql).not.toContain("my_role() = 'customer'");
    expect(sql).not.toContain("my_role() = 'crew'");
    expect(sql).not.toContain("my_role() = 'warehouse'");
    expect(readFileSync("src/app/portal/layout.tsx", "utf8")).not.toContain("job-true-up");
    expect(readFileSync("src/lib/nav.ts", "utf8")).toContain('href: "/commissions"');
  });
});
