/**
 * Actual-cost integrity for commission. These cases are synthetic.
 * They do not write invoices, stock, purchase orders, or accounting.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LABOR_INCOMPLETE,
  adjustmentIdempotencyKey,
  buildTrueUp,
  commissionAmountCents,
  commissionRateBps,
  commissionableRevenue,
  estimatedRevenueFromSnapshots,
  lateCostAdjustment,
  marginCauseLines,
  pageOf,
  resolutionCents,
  resolveFreight,
  resolveLabor,
  resolveMaterial,
  resolveOther,
  statementTotals,
  type CategoryResolution,
  type PoLineFact,
  type PullFact,
  type StatementJob,
  type TrueUpFacts,
} from "@/lib/job-true-up";

const sql = readFileSync("supabase/migrations/0481_job_true_up.sql", "utf8");

function materialOf(pulls: PullFact[], poLines: PoLineFact[] = []) {
  return resolveMaterial({ pulls, poLines, entries: [] });
}

function charged(result: CategoryResolution): bigint | null {
  return resolutionCents(result.resolution);
}

describe("material flooring scenarios", () => {
  it("A. charges only the consumed part of a roll and leaves the rest in inventory", () => {
    const result = materialOf(
      [{ productId: "roll-1", qty: "40", unitCost: "4.00", kind: "pull" }],
      [{
        poStatus: "received",
        productId: "roll-1",
        trackStock: true,
        description: "Carpet roll",
        quantity: "100",
        receivedQty: "100",
        unitCost: "4.00",
      }],
    );
    expect(charged(result)).toBe(BigInt(16_000));
    expect(result.resolution.state).toBe("auto");
    // Purchased 100 sy × $4 = $400. Consumed 40 sy. Remaining 60 sy stays inventory.
  });

  it("B. sums multiple cuts from one roll without charging the whole roll", () => {
    const result = materialOf(
      [
        { productId: "roll-1", qty: "15", unitCost: "4.00", kind: "pull" },
        { productId: "roll-1", qty: "10", unitCost: "4.00", kind: "pull" },
      ],
      [{
        poStatus: "received",
        productId: "roll-1",
        trackStock: true,
        description: "Carpet roll",
        quantity: "100",
        receivedQty: "100",
        unitCost: "4.00",
      }],
    );
    expect(charged(result)).toBe(BigInt(10_000));
  });

  it("C. adds material from two rolls at each roll's own cost", () => {
    const result = materialOf([
      { productId: "roll-1", qty: "20", unitCost: "5.00", kind: "pull" },
      { productId: "roll-2", qty: "10", unitCost: "6.00", kind: "pull" },
    ]);
    expect(charged(result)).toBe(BigInt(16_000));
  });

  it("D. gives each job only the portion it pulled from a shared roll", () => {
    const job1 = materialOf([{ productId: "roll-1", qty: "30", unitCost: "4.00", kind: "pull" }]);
    const job2 = materialOf([{ productId: "roll-1", qty: "20", unitCost: "4.00", kind: "pull" }]);
    expect(charged(job1)).toBe(BigInt(12_000));
    expect(charged(job2)).toBe(BigInt(8_000));
    expect((charged(job1) ?? BigInt(0)) + (charged(job2) ?? BigInt(0))).toBe(BigInt(20_000));
  });

  it("E. keeps separate dye-lot costs on the same product", () => {
    const result = materialOf([
      { productId: "carpet", qty: "10", unitCost: "4.00", kind: "pull" },
      { productId: "carpet", qty: "8", unitCost: "7.00", kind: "pull" },
    ]);
    expect(charged(result)).toBe(BigInt(9_600));
  });

  it("F. subtracts material returned to inventory", () => {
    const result = materialOf([
      { productId: "roll-1", qty: "40", unitCost: "4.00", kind: "pull" },
      { productId: "roll-1", qty: "10", unitCost: "4.00", kind: "return", sourceType: "job_return" },
    ]);
    expect(charged(result)).toBe(BigInt(12_000));
    expect(result.resolution.state).toBe("auto");
  });

  it("G. stays incomplete when more material is ordered after a pull", () => {
    const result = materialOf(
      [{ productId: "roll-1", qty: "20", unitCost: "4.00", kind: "pull" }],
      [{
        poStatus: "ordered",
        productId: "roll-1",
        trackStock: true,
        description: "Additional carpet",
        quantity: "10",
        receivedQty: "0",
        unitCost: "4.00",
      }],
    );
    expect(result.resolution.state).toBe("incomplete");
    expect(charged(result)).toBeNull();
  });

  it("H. charges a fully received drop-ship that never entered inventory", () => {
    const result = materialOf([], [{
      poStatus: "closed",
      description: "Drop-ship vinyl",
      quantity: "25",
      receivedQty: "25",
      unitCost: "3.50",
    }]);
    expect(charged(result)).toBe(BigInt(8_750));
    expect(result.resolution.state).toBe("auto");
  });

  it("I. keeps a partial receipt incomplete and does not finalize the received slice", () => {
    const result = materialOf([], [{
      poStatus: "received",
      description: "Special-order carpet",
      quantity: "100",
      receivedQty: "40",
      unitCost: "4.00",
    }]);
    expect(result.resolution.state).toBe("incomplete");
    expect(charged(result)).toBeNull();
  });

  it("J. keeps an ordered but unreceived PO incomplete", () => {
    const result = materialOf([], [{
      poStatus: "ordered",
      productId: "reducer",
      trackStock: false,
      description: "Reducer",
      quantity: "4",
      receivedQty: "0",
      unitCost: "10.00",
    }]);
    expect(result.resolution.state).toBe("incomplete");
    expect(charged(result)).toBeNull();
  });

  it("K. uses the inventory cost on the pull when the vendor price changed", () => {
    const result = materialOf(
      [{ productId: "roll-1", qty: "40", unitCost: "4.50", extendedCost: "180.00", kind: "pull" }],
      [{
        poStatus: "received",
        productId: "roll-1",
        trackStock: true,
        description: "Carpet roll",
        quantity: "100",
        receivedQty: "100",
        unitCost: "4.00",
      }],
    );
    expect(charged(result)).toBe(BigInt(18_000));
  });

  it("L. does not subtract a vendor return from the job", () => {
    const result = materialOf([
      { productId: "roll-1", qty: "40", unitCost: "4.00", kind: "pull" },
      { productId: "roll-1", qty: "10", unitCost: "4.00", kind: "return", sourceType: "vendor_return" },
    ]);
    expect(charged(result)).toBe(BigInt(16_000));
  });

  it("M. does not apply waste a second time when the pull quantity already includes it", () => {
    const result = materialOf(
      [{ productId: "roll-1", qty: "110", unitCost: "4.00", kind: "pull" }],
      [{
        poStatus: "received",
        productId: "roll-1",
        trackStock: true,
        description: "Carpet roll",
        quantity: "120",
        receivedQty: "120",
        unitCost: "4.00",
      }],
    );
    expect(charged(result)).toBe(BigInt(44_000));
  });

  it("N. uses the canonical inventory cost of stock already owned", () => {
    const result = materialOf([{ productId: "roll-owned", qty: "40", unitCost: "3.25", kind: "pull" }]);
    expect(charged(result)).toBe(BigInt(13_000));
    expect(result.resolution.state).toBe("auto");
  });

  it("O. treats a missing unit cost as incomplete instead of zero", () => {
    const result = materialOf([{ productId: "roll-1", qty: "10", unitCost: null, extendedCost: null, kind: "pull" }]);
    expect(result.resolution.state).toBe("incomplete");
    expect(charged(result)).toBeNull();
    expect(result.hint).toBe("Material movement is missing a unit cost");
  });

  it("ignores a voided pull and does not turn it into zero", () => {
    const onlyVoid = materialOf([{ productId: "roll-1", qty: "40", unitCost: "4.00", kind: "pull", voided: true }]);
    expect(onlyVoid.resolution.state).toBe("unknown");
    const live = materialOf([
      { productId: "roll-1", qty: "40", unitCost: "4.00", kind: "pull", voided: true },
      { productId: "roll-1", qty: "12", unitCost: "4.00", kind: "pull" },
    ]);
    expect(charged(live)).toBe(BigInt(4_800));
  });

  it("keeps an explicit zero unit cost as a real zero", () => {
    const result = materialOf([{ productId: "sample", qty: "1", unitCost: "0.00", kind: "pull" }]);
    expect(result.resolution.state).toBe("auto");
    expect(charged(result)).toBe(BigInt(0));
  });
});

describe("material is not counted twice", () => {
  it("charges a stock pull once and adds only drop-ship lines that were not pulled", () => {
    const result = materialOf(
      [{ productId: "carpet", qty: "40", unitCost: "4.00", kind: "pull" }],
      [
        {
          poStatus: "received",
          productId: "carpet",
          trackStock: true,
          description: "Carpet roll",
          quantity: "100",
          receivedQty: "100",
          unitCost: "4.00",
        },
        {
          poStatus: "received",
          productId: "reducer",
          trackStock: false,
          description: "Reducer",
          quantity: "4",
          receivedQty: "4",
          unitCost: "10.00",
        },
        {
          poStatus: "closed",
          description: "Transition special order",
          quantity: "2",
          receivedQty: "2",
          unitCost: "15.00",
        },
      ],
    );
    expect(charged(result)).toBe(BigInt(23_000));
    expect(result.resolution.state).toBe("auto");
  });

  it("does not add a drop-ship receipt when a pull already represents that product", () => {
    const result = materialOf(
      [{ productId: "vinyl", qty: "20", unitCost: "3.00", kind: "pull" }],
      [{
        poStatus: "received",
        productId: "vinyl",
        trackStock: false,
        description: "Vinyl",
        quantity: "20",
        receivedQty: "20",
        unitCost: "3.00",
      }],
    );
    expect(charged(result)).toBe(BigInt(6_000));
  });

  it("does not charge a tracked receipt that was never pulled", () => {
    const result = materialOf([], [{
      poStatus: "received",
      productId: "carpet",
      trackStock: true,
      description: "Carpet roll",
      quantity: "100",
      receivedQty: "100",
      unitCost: "4.00",
    }]);
    expect(result.resolution.state).toBe("incomplete");
    expect(charged(result)).toBeNull();
    expect(result.hint).toBe("Received stock has not been pulled to the job");
  });

  it("replaces calculated material with a manual amount instead of adding it", () => {
    const result = resolveMaterial({
      pulls: [{ productId: "carpet", qty: "40", unitCost: "4.00", kind: "pull" }],
      poLines: [],
      entries: [{ category: "material", kind: "manual_amount", amountCents: BigInt(10_000), reason: "Final counted cost" }],
    });
    expect(charged(result)).toBe(BigInt(10_000));
    expect(result.calculatedCents).toBe(BigInt(16_000));
  });
});

describe("labor cost", () => {
  const jobId = "job-1";

  it("does not count a draft installer bill", () => {
    const labor = resolveLabor({
      bills: [{ id: "d", job_id: jobId, status: "draft", total: "500.00" }],
      jobId,
      installerAssigned: true,
      legacyLaborRows: 0,
      entries: [],
    });
    expect(labor.resolution.state).toBe("incomplete");
    expect(charged(labor)).toBeNull();
  });

  it("counts an approved bill once and does not count it again when the same bill is paid", () => {
    const approved = resolveLabor({
      bills: [{ id: "b", job_id: jobId, status: "approved", total: "640.00" }],
      jobId,
      installerAssigned: true,
      legacyLaborRows: 0,
      entries: [],
    });
    const paid = resolveLabor({
      bills: [{ id: "b", job_id: jobId, status: "paid", total: "640.00" }],
      jobId,
      installerAssigned: true,
      legacyLaborRows: 0,
      entries: [],
    });
    expect(charged(approved)).toBe(BigInt(64_000));
    expect(charged(paid)).toBe(BigInt(64_000));
  });

  it("sums distinct installer bills", () => {
    const labor = resolveLabor({
      bills: [
        { id: "a", job_id: jobId, status: "approved", total: "400.00" },
        { id: "b", job_id: jobId, status: "paid", total: "250.00" },
      ],
      jobId,
      installerAssigned: true,
      legacyLaborRows: 0,
      entries: [],
    });
    expect(charged(labor)).toBe(BigInt(65_000));
  });

  it("stays incomplete while a draft is still open beside an approved bill", () => {
    const labor = resolveLabor({
      bills: [
        { id: "a", job_id: jobId, status: "approved", total: "400.00" },
        { id: "d", job_id: jobId, status: "draft", total: "100.00" },
      ],
      jobId,
      installerAssigned: true,
      legacyLaborRows: 0,
      entries: [],
    });
    expect(labor.resolution.state).toBe("incomplete");
    expect(charged(labor)).toBeNull();
  });

  it("is incomplete when an installer is assigned and no bill exists", () => {
    const labor = resolveLabor({
      bills: [],
      jobId,
      installerAssigned: true,
      legacyLaborRows: 0,
      entries: [],
    });
    expect(labor.resolution).toEqual({ state: "incomplete", hint: LABOR_INCOMPLETE });
  });

  it("does not add legacy job_labor on top of an installer bill", () => {
    const labor = resolveLabor({
      bills: [{ id: "b", job_id: jobId, status: "approved", total: "640.00" }],
      jobId,
      installerAssigned: true,
      legacyLaborRows: 1,
      legacyLaborCents: BigInt(30_000),
      entries: [],
    });
    expect(charged(labor)).toBe(BigInt(64_000));
  });

  it("shows legacy labor dollars without using them as actual cost", () => {
    const labor = resolveLabor({
      bills: [],
      jobId,
      installerAssigned: false,
      legacyLaborRows: 1,
      legacyLaborCents: BigInt(30_000),
      entries: [],
    });
    expect(labor.resolution.state).toBe("incomplete");
    expect(charged(labor)).toBeNull();
    expect(labor.hint).toContain("$300.00");
    expect(labor.hint).toContain(LABOR_INCOMPLETE);
  });
});

describe("freight", () => {
  it("counts freight, shipping, and delivery lines once each", () => {
    const freight = resolveFreight({
      poLines: [
        { poStatus: "received", description: "Inbound freight", quantity: "1", receivedQty: "1", unitCost: "225.00" },
        { poStatus: "received", description: "Shipping charge", quantity: "1", receivedQty: "1", unitCost: "40.00" },
        { poStatus: "closed", description: "Job delivery", quantity: "1", receivedQty: "1", unitCost: "75.00" },
      ],
      entries: [],
    });
    expect(charged(freight)).toBe(BigInt(34_000));
  });

  it("keeps a partial freight receipt incomplete", () => {
    const freight = resolveFreight({
      poLines: [{ poStatus: "received", description: "Freight", quantity: "2", receivedQty: "1", unitCost: "100.00" }],
      entries: [],
    });
    expect(freight.resolution.state).toBe("incomplete");
    expect(charged(freight)).toBeNull();
  });

  it("keeps unreceived freight incomplete", () => {
    const freight = resolveFreight({
      poLines: [{ poStatus: "ordered", description: "Freight", quantity: "1", receivedQty: "0", unitCost: "200.00" }],
      entries: [],
    });
    expect(freight.resolution.state).toBe("incomplete");
  });

  it("leaves missing freight unknown until it is confirmed", () => {
    const freight = resolveFreight({ poLines: [], entries: [] });
    expect(freight.resolution.state).toBe("unknown");
    expect(charged(freight)).toBeNull();
  });

  it("replaces automatic freight with a manual amount", () => {
    const freight = resolveFreight({
      poLines: [{ poStatus: "received", description: "Freight", quantity: "1", receivedQty: "1", unitCost: "225.00" }],
      entries: [{ category: "freight", kind: "manual_amount", amountCents: BigInt(30_000), reason: "Final carrier bill" }],
    });
    expect(charged(freight)).toBe(BigInt(30_000));
    expect(freight.calculatedCents).toBe(BigInt(22_500));
  });
});

describe("other direct cost", () => {
  it("counts an expense and a job-issue cost once", () => {
    const other = resolveOther({
      expenses: [{ category: "tools", amountCents: BigInt(4_500) }],
      issueCostCents: BigInt(2_000),
      hasInstallerBills: false,
      subcontractorExpenseCents: BigInt(0),
      entries: [],
    });
    expect(charged(other)).toBe(BigInt(6_500));
  });

  it("does not add a subcontractor expense when an installer bill exists", () => {
    const other = resolveOther({
      expenses: [{ category: "other", amountCents: BigInt(1_500) }],
      issueCostCents: BigInt(2_000),
      hasInstallerBills: true,
      subcontractorExpenseCents: BigInt(9_000),
      entries: [],
    });
    expect(charged(other)).toBe(BigInt(3_500));
  });

  it("excludes company overhead", () => {
    const other = resolveOther({
      expenses: [
        { category: "rent", amountCents: BigInt(50_000) },
        { category: "fuel", amountCents: BigInt(8_000) },
        { category: "payroll", amountCents: BigInt(90_000) },
        { category: "materials", amountCents: BigInt(1_200) },
      ],
      issueCostCents: BigInt(0),
      hasInstallerBills: true,
      subcontractorExpenseCents: BigInt(0),
      entries: [],
    });
    expect(charged(other)).toBe(BigInt(1_200));
  });

  it("keeps a credit-style issue and a negative expense", () => {
    const other = resolveOther({
      expenses: [
        { category: "tools", amountCents: BigInt(4_000) },
        { category: "other", amountCents: BigInt(-1_500) },
      ],
      issueCostCents: BigInt(-2_500),
      hasInstallerBills: true,
      subcontractorExpenseCents: BigInt(-9_000),
      entries: [],
    });
    expect(charged(other)).toBe(BigInt(0));
  });
});

describe("final commissionable revenue", () => {
  it("uses pre-tax invoice dollars and ignores tax, deposits, payments, voids, and drafts", () => {
    const original = commissionableRevenue({
      invoices: [{
        id: "orig",
        status: "sent",
        commercialKind: "original",
        sequence: 1,
        taxRatePct: "8",
        lines: [{ quantity: "1", rate: "20000.00" }],
      }],
      depositsCents: BigInt(500_000),
      paymentsCents: BigInt(2_000_000),
    });
    expect(original.cents).toBe(BigInt(2_000_000));
    expect(original.taxCents).toBe(BigInt(160_000));
    expect(original.depositsIgnoredCents).toBe(BigInt(500_000));
    expect(original.paymentsIgnoredCents).toBe(BigInt(2_000_000));

    const withSupplement = commissionableRevenue({
      invoices: [
        {
          id: "orig",
          status: "paid",
          commercialKind: "original",
          sequence: 1,
          taxRatePct: "8",
          lines: [{ quantity: "1", rate: "20000.00" }],
        },
        {
          id: "sup",
          status: "sent",
          commercialKind: "supplemental",
          sequence: 2,
          taxRatePct: "8",
          lines: [{ quantity: "1", rate: "1500.00" }],
        },
      ],
    });
    expect(withSupplement.cents).toBe(BigInt(2_150_000));

    const credit = commissionableRevenue({
      invoices: [{
        id: "orig",
        status: "partial",
        commercialKind: "original",
        taxRatePct: "8",
        lines: [{ quantity: "1", rate: "20000.00" }],
        appliedCreditCents: BigInt(216_000),
      }],
      refundsCents: BigInt(216_000),
    });
    expect(credit.cents).toBe(BigInt(1_800_000));
    expect(credit.refundsIgnoredCents).toBe(BigInt(216_000));

    const writeOff = commissionableRevenue({
      invoices: [{
        id: "orig",
        status: "paid",
        commercialKind: "original",
        taxRatePct: "8",
        lines: [{ quantity: "1", rate: "20000.00" }],
        appliedWriteOffCents: BigInt(108_000),
      }],
    });
    expect(writeOff.cents).toBe(BigInt(1_900_000));

    const excluded = commissionableRevenue({
      invoices: [
        { id: "void", status: "void", commercialKind: "original", lines: [{ quantity: "1", rate: "9000.00" }] },
        { id: "draft", status: "draft", commercialKind: "original", lines: [{ quantity: "1", rate: "4000.00" }] },
        {
          id: "live",
          status: "sent",
          commercialKind: "original",
          sequence: 1,
          lines: [
            { quantity: "1", rate: "18000.00" },
            { quantity: "1", rate: "500.00", cancelled: true },
          ],
        },
      ],
    });
    expect(excluded.cents).toBe(BigInt(1_800_000));
    expect(excluded.voidExcluded).toBe(1);
    expect(excluded.draftExcluded).toBe(1);
  });

  it("records a change-order increase and decrease on the approved contract", () => {
    const increased = estimatedRevenueFromSnapshots([
      { version: 1, subtotalCents: BigInt(2_000_000), discountCents: BigInt(0), taxCents: BigInt(160_000), totalCents: BigInt(2_160_000) },
      { version: 2, subtotalCents: BigInt(2_150_000), discountCents: BigInt(0), taxCents: BigInt(172_000), totalCents: BigInt(2_322_000) },
    ]);
    expect(increased.originalCents).toBe(BigInt(2_000_000));
    expect(increased.changeOrderCents).toBe(BigInt(150_000));
    expect(increased.latestCents).toBe(BigInt(2_150_000));

    const decreased = estimatedRevenueFromSnapshots([
      { version: 1, subtotalCents: BigInt(2_000_000), discountCents: BigInt(0), taxCents: BigInt(160_000), totalCents: BigInt(2_160_000) },
      { version: 2, subtotalCents: BigInt(1_920_000), discountCents: BigInt(0), taxCents: BigInt(153_600), totalCents: BigInt(2_073_600) },
    ]);
    expect(decreased.changeOrderCents).toBe(BigInt(-80_000));
    expect(decreased.latestCents).toBe(BigInt(1_920_000));
  });
});

function knownRevenue(cents: bigint): TrueUpFacts["revenue"] {
  return {
    cents,
    taxCents: BigInt(0),
    state: "known",
    duplicateOriginalsExcluded: [],
    voidExcluded: 0,
    draftExcluded: 0,
    refundsIgnoredCents: BigInt(0),
    depositsIgnoredCents: BigInt(0),
    paymentsIgnoredCents: BigInt(0),
  };
}

function autoCost(category: "material" | "labor" | "freight" | "other", cents: bigint): CategoryResolution {
  return {
    category,
    resolution: { state: "auto", cents, source: "synthetic" },
    calculatedCents: cents,
    calculatedState: "auto",
    hint: null,
  };
}

function flooringJob(args: {
  revenueCents: bigint;
  materialCents: bigint;
  laborCents: bigint;
  freightCents: bigint;
  otherCents: bigint;
  estimated?: TrueUpFacts["estimated"];
}): ReturnType<typeof buildTrueUp> {
  const facts: TrueUpFacts = {
    jobCompleted: true,
    trueUpExists: true,
    salespersonId: "sales-1",
    approved: false,
    paidInFull: false,
    openBalanceCents: BigInt(0),
    hasCollectibleInvoice: true,
    collectionOverride: false,
    zeroRevenueAcknowledged: false,
    revenue: knownRevenue(args.revenueCents),
    estimated: args.estimated ?? {
      originalRevenueCents: args.revenueCents,
      changeOrderRevenueCents: BigInt(0),
      materialCents: args.materialCents,
      laborCents: args.laborCents,
      freightCents: args.freightCents,
      otherCents: args.otherCents,
    },
    material: autoCost("material", args.materialCents),
    labor: autoCost("labor", args.laborCents),
    freight: autoCost("freight", args.freightCents),
    other: autoCost("other", args.otherCents),
  };
  return buildTrueUp(facts);
}

describe("five flooring jobs", () => {
  const revenue = BigInt(2_000_000);

  const jobs = [
    { name: "A", material: BigInt(420_000), labor: BigInt(380_000), freight: BigInt(120_000), other: BigInt(80_000), rate: BigInt(800), commission: BigInt(80_000) },
    { name: "B", material: BigInt(510_000), labor: BigInt(400_000), freight: BigInt(110_000), other: BigInt(80_000), rate: BigInt(700), commission: BigInt(63_000) },
    { name: "C", material: BigInt(620_000), labor: BigInt(390_000), freight: BigInt(110_000), other: BigInt(80_000), rate: BigInt(600), commission: BigInt(48_000) },
    { name: "D", material: BigInt(700_000), labor: BigInt(400_000), freight: BigInt(120_000), other: BigInt(80_000), rate: BigInt(500), commission: BigInt(35_000) },
    { name: "E", material: BigInt(780_000), labor: BigInt(420_000), freight: BigInt(120_000), other: BigInt(80_000), rate: BigInt(250), commission: BigInt(15_000) },
  ];

  for (const job of jobs) {
    it(`job ${job.name} earns the tier commission on actual gross profit`, () => {
      const result = flooringJob({
        revenueCents: revenue,
        materialCents: job.material,
        laborCents: job.labor,
        freightCents: job.freight,
        otherCents: job.other,
      });
      const cost = job.material + job.labor + job.freight + job.other;
      expect(result.actualRevenueCents).toBe(revenue);
      expect(result.actualCostCents).toBe(cost);
      expect(result.actualGpCents).toBe(revenue - cost);
      expect(result.rateBps).toBe(job.rate);
      expect(result.commissionCents).toBe(job.commission);
      expect(commissionRateBps(revenue - cost, revenue)).toBe(job.rate);
      expect(commissionAmountCents(revenue - cost, revenue)).toBe(job.commission);
    });
  }
});

describe("margin variance reconciliation", () => {
  it("ties revenue and cost variances to gross-profit and margin-point variance", () => {
    const result = flooringJob({
      revenueCents: BigInt(2_100_000),
      materialCents: BigInt(640_000),
      laborCents: BigInt(320_000),
      freightCents: BigInt(70_000),
      otherCents: BigInt(20_000),
      estimated: {
        originalRevenueCents: BigInt(2_000_000),
        changeOrderRevenueCents: BigInt(0),
        materialCents: BigInt(600_000),
        laborCents: BigInt(300_000),
        freightCents: BigInt(50_000),
        otherCents: BigInt(0),
      },
    });

    expect(result.revenue.varianceCents).toBe(BigInt(100_000));
    expect(result.material.varianceCents).toBe(BigInt(40_000));
    expect(result.labor.varianceCents).toBe(BigInt(20_000));
    expect(result.freight.varianceCents).toBe(BigInt(20_000));
    expect(result.other.varianceCents).toBe(BigInt(20_000));
    expect(result.totalDirect.varianceCents).toBe(BigInt(100_000));
    expect(result.grossProfit.estimatedCents).toBe(BigInt(1_050_000));
    expect(result.grossProfit.actualCents).toBe(BigInt(1_050_000));
    expect(result.grossProfit.varianceCents).toBe(BigInt(0));
    expect(result.marginHundredths.estimated).toBe(BigInt(5_250));
    expect(result.marginHundredths.actual).toBe(BigInt(5_000));
    expect(result.marginHundredths.variance).toBe(BigInt(-250));

    const gpFromParts =
      (result.revenue.varianceCents ?? BigInt(0))
      - (result.material.varianceCents ?? BigInt(0))
      - (result.labor.varianceCents ?? BigInt(0))
      - (result.freight.varianceCents ?? BigInt(0))
      - (result.other.varianceCents ?? BigInt(0));
    expect(gpFromParts).toBe(result.grossProfit.varianceCents);

    const causes = marginCauseLines({
      costsComplete: true,
      revenueVariance: result.revenue.varianceCents,
      materialImpact: BigInt(-40_000),
      laborImpact: BigInt(-20_000),
      freightImpact: BigInt(-20_000),
      otherImpact: BigInt(-20_000),
    });
    expect(causes).toEqual([
      "Revenue variance $1,000.00",
      "Material variance -$400.00",
      "Labor variance -$200.00",
      "Freight variance -$200.00",
      "Other variance -$200.00",
    ]);
  });
});

describe("late cost after approval", () => {
  it("keeps the approved snapshot and posts only the new commission gap", () => {
    const approvedSnapshot = {
      commissionCents: BigInt(63_000),
      materialCents: BigInt(400_000),
      laborCents: BigInt(500_000),
      freightCents: BigInt(100_000),
      otherCents: BigInt(100_000),
    };
    const frozen = { ...approvedSnapshot };
    const revenue = BigInt(2_000_000);

    const afterFreight = lateCostAdjustment({
      approvedCommissionCents: approvedSnapshot.commissionCents,
      revisedRevenueCents: revenue,
      revisedGpCents: BigInt(880_000),
      alreadyPaidCents: BigInt(0),
    });
    expect(afterFreight).toEqual({
      revisedCommissionCents: BigInt(52_800),
      adjustmentCents: BigInt(-10_200),
      timing: "before_payment",
    });

    const afterLabor = lateCostAdjustment({
      approvedCommissionCents: approvedSnapshot.commissionCents,
      priorAdjustmentCents: afterFreight.adjustmentCents,
      revisedRevenueCents: revenue,
      revisedGpCents: BigInt(850_000),
      alreadyPaidCents: BigInt(0),
    });
    expect(afterLabor).toEqual({
      revisedCommissionCents: BigInt(51_000),
      adjustmentCents: BigInt(-1_800),
      timing: "before_payment",
    });

    const returned = materialOf([
      { productId: "roll-1", qty: "100", unitCost: "40.00", kind: "pull" },
      { productId: "roll-1", qty: "12.5", unitCost: "40.00", kind: "return", sourceType: "job_return" },
    ]);
    expect(charged(returned)).toBe(BigInt(350_000));

    const afterCredit = lateCostAdjustment({
      approvedCommissionCents: approvedSnapshot.commissionCents,
      priorAdjustmentCents: afterFreight.adjustmentCents + afterLabor.adjustmentCents,
      revisedRevenueCents: revenue,
      revisedGpCents: BigInt(900_000),
      alreadyPaidCents: BigInt(63_000),
    });
    expect(afterCredit).toEqual({
      revisedCommissionCents: BigInt(63_000),
      adjustmentCents: BigInt(12_000),
      timing: "carry_forward",
    });
    expect(afterFreight.adjustmentCents + afterLabor.adjustmentCents + afterCredit.adjustmentCents).toBe(BigInt(0));
    expect(approvedSnapshot).toEqual(frozen);

    const fingerprint = adjustmentIdempotencyKey("true-1", "63000:1100000:2000000");
    expect(adjustmentIdempotencyKey("true-1", "63000:1100000:2000000")).toBe(fingerprint);
    expect(sql).toContain("v_revised - (v_approved + v_delta)");
  });
});

describe("commission statement reconciliation", () => {
  it("keeps the amount owed equal to earned plus adjustments minus payments on every page", () => {
    const rows: StatementJob[] = [
      { jobId: "A", customer: "A", completedOn: "2026-09-01", finalRevenueCents: BigInt(2_000_000), actualCostCents: BigInt(1_000_000), gpCents: BigInt(1_000_000), marginHundredths: BigInt(5_000), rateBps: BigInt(800), commissionCents: BigInt(80_000), adjustmentCents: BigInt(0), paidCents: BigInt(80_000), salespersonId: "sales-1", status: "commission_paid" },
      { jobId: "B", customer: "B", completedOn: "2026-09-02", finalRevenueCents: BigInt(2_000_000), actualCostCents: BigInt(1_100_000), gpCents: BigInt(900_000), marginHundredths: BigInt(4_500), rateBps: BigInt(700), commissionCents: BigInt(63_000), adjustmentCents: BigInt(-10_200), paidCents: BigInt(0), salespersonId: "sales-1", status: "commission_payable" },
      { jobId: "C", customer: "C", completedOn: "2026-09-03", finalRevenueCents: BigInt(2_000_000), actualCostCents: BigInt(1_200_000), gpCents: BigInt(800_000), marginHundredths: BigInt(4_000), rateBps: BigInt(600), commissionCents: BigInt(48_000), adjustmentCents: BigInt(0), paidCents: BigInt(48_000), salespersonId: "sales-1", status: "commission_paid" },
      { jobId: "D", customer: "D", completedOn: "2026-09-04", finalRevenueCents: BigInt(2_000_000), actualCostCents: BigInt(1_300_000), gpCents: BigInt(700_000), marginHundredths: BigInt(3_500), rateBps: BigInt(500), commissionCents: BigInt(35_000), adjustmentCents: BigInt(0), paidCents: BigInt(35_000), salespersonId: "sales-1", status: "commission_paid" },
      { jobId: "E", customer: "E", completedOn: "2026-09-05", finalRevenueCents: BigInt(2_000_000), actualCostCents: BigInt(1_400_000), gpCents: BigInt(600_000), marginHundredths: BigInt(3_000), rateBps: BigInt(250), commissionCents: BigInt(15_000), adjustmentCents: BigInt(2_400), paidCents: BigInt(0), salespersonId: "sales-1", status: "commission_payable" },
    ];
    const summary = statementTotals(rows);
    const detailEarned = rows.reduce((s, r) => s + r.commissionCents, BigInt(0));
    const detailAdj = rows.reduce((s, r) => s + r.adjustmentCents, BigInt(0));
    const detailPaid = rows.reduce((s, r) => s + r.paidCents, BigInt(0));
    expect(summary.commissionEarnedCents).toBe(detailEarned);
    expect(summary.adjustmentCents).toBe(detailAdj);
    expect(summary.paidCents).toBe(detailPaid);
    expect(summary.owedCents).toBe(detailEarned + detailAdj - detailPaid);
    expect(summary.owedCents).toBe(BigInt(70_200));

    const page1 = pageOf(rows, 1, 2);
    const page2 = pageOf(rows, 2, 2);
    const page3 = pageOf(rows, 3, 2);
    expect(statementTotals(rows)).toEqual(summary);
    expect(statementTotals(page1.rows).jobs).toBe(2);
    const pagedOwed = [page1, page2, page3].reduce(
      (s, page) => s + statementTotals(page.rows).owedCents,
      BigInt(0),
    );
    expect(pagedOwed).toBe(summary.owedCents);
    expect(page1.total).toBe(rows.length);
  });
});

describe("approval SQL matches the cost rules", () => {
  it("nets job returns, skips voided movements, and does not price a blank cost as zero", () => {
    expect(sql).toContain("sm.source_type = 'job_return'");
    expect(sql).toContain("sm.voided_at is null");
    expect(sql).toContain("p.track_stock = false");
    expect(sql).toContain("p.track_stock = true");
    expect(sql).not.toContain("coalesce(sm.unit_cost, 0)");
    expect(sql).toContain("coalesce(ji.cost_impact, 0) <> 0");
    expect(sql).not.toContain("vendor_return' and sm.voided_at");
  });
});
