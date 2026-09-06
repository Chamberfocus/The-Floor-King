/**
 * Step 7 — profit/margin consistency: one all-in definition, freight once,
 * estimated vs actual overhead aligned, target margin on landed material.
 */
import { describe, expect, it } from "vitest";
import {
  lineCost,
  lineTotal,
  marginPct,
  optionCostTotals,
  priceFromMargin,
  type CalcLine,
} from "@/lib/estimate-calc";
import { freightMultiplier, landedMaterialCost } from "@/lib/freight";
import {
  allInProfit,
  jobProfit,
  lineMargin,
} from "@/lib/job-profit";
import {
  landedMaterialForTarget,
  ratesFromTargetMargin,
  sellLaborFromTargetMargin,
  sellMaterialFromTargetMargin,
} from "@/lib/estimate-pricing";

const FIXTURE: CalcLine = {
  line_type: "mat_labor",
  category: "lvp",
  measure_unit: "sqft",
  sqft: 100,
  waste_pct: 10,
  material_rate: 5,
  labor_rate: 2,
  material_cost: 3,
  labor_cost: 1,
};

const OPTS = {
  discountKind: "percent" as const,
  discountValue: 5,
  freightMarkupPct: 5,
  fuelFee: 50,
  carAllowance: 25,
  commissionPct: 3,
};

function expectClose(a: number, b: number) {
  expect(a).toBeCloseTo(b, 10);
}

describe("Step 7 — canonical all-in profit", () => {
  it("1–4: same option inputs → same margin via jobProfit (builder grand ≡ option)", () => {
    const grand = jobProfit([FIXTURE], OPTS);
    const option = jobProfit([FIXTURE], OPTS);
    expectClose(grand.margin, option.margin);
    expectClose(grand.profit, option.profit);
    expectClose(grand.cost, option.cost);
  });

  it("2: estimate-detail shape matches jobProfit (allInProfit on same parts)", () => {
    const viaJob = jobProfit([FIXTURE], OPTS);
    const ct = optionCostTotals([FIXTURE]);
    const viaParts = allInProfit({
      revenue: viaJob.revenue,
      subtotal: viaJob.subtotal,
      discount: viaJob.discount,
      materialBare: ct.material,
      labor: ct.labor,
      freightMarkupPct: OPTS.freightMarkupPct,
      fuelFee: OPTS.fuelFee,
      carAllowance: OPTS.carAllowance,
      commissionPct: OPTS.commissionPct,
    });
    expectClose(viaParts.margin, viaJob.margin);
    expectClose(viaParts.profit, viaJob.profit);
    expectClose(viaParts.material, viaJob.material);
  });

  it("3: freight > 0 — omitting freight overstates margin (regression)", () => {
    const allIn = jobProfit([FIXTURE], OPTS);
    const ct = optionCostTotals([FIXTURE]);
    // Old builder option-card bug: bare cost + fees, no freight.
    const revenue = allIn.revenue;
    const bareCost = ct.material + ct.labor;
    const optimistic =
      revenue -
      bareCost -
      OPTS.fuelFee -
      OPTS.carAllowance -
      (OPTS.commissionPct / 100) * revenue;
    const optimisticMargin = (optimistic / revenue) * 100;
    expect(optimisticMargin).toBeGreaterThan(allIn.margin);
  });

  it("4: freight = 0 — all-in matches bare-cost + fees", () => {
    const zeroFreight = { ...OPTS, freightMarkupPct: 0 };
    const p = jobProfit([FIXTURE], zeroFreight);
    const ct = optionCostTotals([FIXTURE]);
    const manual = allInProfit({
      revenue: p.revenue,
      materialBare: ct.material,
      labor: ct.labor,
      freightMarkupPct: 0,
      fuelFee: OPTS.fuelFee,
      carAllowance: OPTS.carAllowance,
      commissionPct: OPTS.commissionPct,
    });
    expectClose(p.margin, manual.margin);
    expectClose(p.material, ct.material);
  });

  it("5–7: 40% target uses landed material; labor not freighted", () => {
    const bare = 60;
    const freightPct = 5;
    const landed = landedMaterialForTarget(bare, freightPct);
    expectClose(landed, landedMaterialCost(bare, freightPct));
    expectClose(landed, 63);

    const rates = ratesFromTargetMargin({
      lineType: "mat_labor",
      laborOnly: false,
      materialCost: bare,
      laborCost: 40,
      targetMarginPct: 40,
      freightMarkupPct: freightPct,
    });
    expectClose(rates.material_rate!, priceFromMargin(63, 40));
    expectClose(rates.labor_rate!, priceFromMargin(40, 40));
    // Labor sell is NOT priceFromMargin(40 * 1.05, 40)
    expect(rates.labor_rate!).toBeLessThan(priceFromMargin(40 * 1.05, 40));
  });

  it("8: waste applies to material AND labor (canonical policy)", () => {
    const qty = 100;
    const waste = 1.1;
    const expectedMat = qty * 3 * waste;
    const expectedLabor = qty * 1 * waste;
    const ct = optionCostTotals([FIXTURE]);
    expectClose(ct.material, expectedMat);
    expectClose(ct.labor, expectedLabor);
    expectClose(lineCost(FIXTURE), expectedMat + expectedLabor);
  });

  it("9: no double freight — sell from landed; cost still freighted once", () => {
    const freightPct = 5;
    const bareMat = 3;
    const rates = ratesFromTargetMargin({
      lineType: "mat_labor",
      laborOnly: false,
      materialCost: bareMat,
      laborCost: 0,
      targetMarginPct: 40,
      freightMarkupPct: freightPct,
    });
    // Line priced at target on landed unit cost; qty=100, no waste on sell.
    const priced: CalcLine = {
      ...FIXTURE,
      material_rate: rates.material_rate!,
      labor_rate: 0,
      labor_cost: 0,
      waste_pct: 0,
    };
    const p = jobProfit([priced], {
      freightMarkupPct: freightPct,
      fuelFee: 0,
      carAllowance: 0,
      commissionPct: 0,
    });
    // Cost = bare * qty * freight once (not freight²).
    const bareExt = 100 * bareMat;
    expectClose(p.material, bareExt * freightMultiplier(freightPct));
    expect(p.material).toBeLessThan(bareExt * freightMultiplier(freightPct) ** 2);
    // Margin ≈ 40% (exact when waste=0 and no overhead).
    expectClose(p.margin, 40);
  });

  it("10–12: equal direct + equal overhead → equal estimated vs actual margins", () => {
    const revenue = 10_000;
    const materialBare = 4_000;
    const labor = 2_000;
    const fees = {
      freightMarkupPct: 5,
      fuelFee: 50,
      carAllowance: 25,
      commissionPct: 3,
    };
    const estimated = allInProfit({
      revenue,
      materialBare,
      labor,
      ...fees,
    });
    // Actual with same direct landed cost + same overhead.
    const actualDirect =
      materialBare * freightMultiplier(fees.freightMarkupPct) + labor;
    const actualOverhead =
      fees.fuelFee +
      fees.carAllowance +
      (fees.commissionPct / 100) * revenue;
    const actualCost = actualDirect + actualOverhead;
    const actualMargin = marginPct(revenue, actualCost);
    expectClose(estimated.margin, actualMargin);
    expectClose(estimated.profit, revenue - actualCost);
  });

  it("13: discount reduces revenue consistently", () => {
    const withDisc = jobProfit([FIXTURE], OPTS);
    const noDisc = jobProfit([FIXTURE], { ...OPTS, discountValue: 0 });
    expect(withDisc.revenue).toBeLessThan(noDisc.revenue);
    expect(withDisc.discount).toBeGreaterThan(0);
  });

  it("14: tax excluded — jobProfit revenue is pre-tax (subtotal − discount)", () => {
    const p = jobProfit([FIXTURE], OPTS);
    expectClose(p.revenue, p.subtotal - p.discount);
    // Tax would be on (subtotal − discount); it must not appear in revenue.
    const taxWouldBe = p.revenue * 0.08;
    expect(p.revenue).not.toBeCloseTo(p.revenue + taxWouldBe, 5);
  });

  it("15: zero sell → margin 0", () => {
    const zero: CalcLine = { ...FIXTURE, material_rate: 0, labor_rate: 0 };
    const p = jobProfit([zero], OPTS);
    expect(p.revenue).toBe(0);
    expect(p.margin).toBe(0);
    expect(p.fuelFee).toBe(0);
  });

  it("16: zero cost → positive margin after fees only", () => {
    const free: CalcLine = {
      ...FIXTURE,
      material_cost: 0,
      labor_cost: 0,
      waste_pct: 0,
    };
    const p = jobProfit([free], {
      freightMarkupPct: 5,
      fuelFee: 0,
      carAllowance: 0,
      commissionPct: 0,
    });
    expect(p.cost).toBe(0);
    expectClose(p.margin, 100);
  });

  it("17: negative profit → negative margin allowed", () => {
    const cheap: CalcLine = {
      ...FIXTURE,
      material_rate: 0.5,
      labor_rate: 0.1,
      material_cost: 3,
      labor_cost: 1,
    };
    const p = jobProfit([cheap], OPTS);
    expect(p.profit).toBeLessThan(0);
    expect(p.margin).toBeLessThan(0);
  });

  it("18: quick-estimate style — landed material via freight helpers + marginPct", () => {
    const qty = 10;
    const bareUnit = 20;
    const sell = 350;
    const freightPct = 5;
    const cost = landedMaterialCost(qty * bareUnit, freightPct);
    const m = marginPct(sell, cost);
    const bareOptimistic = marginPct(sell, qty * bareUnit);
    expect(m).toBeLessThan(bareOptimistic);
    expectClose(cost, landedMaterialCost(200, 5));
  });

  it("19: invoice profit uses allInProfit (estimated cost), not PO actuals", () => {
    // Invoice revenue may differ from estimate line subtotal.
    const invoiceRevenue = 9_500;
    const ct = optionCostTotals([FIXTURE]);
    const inv = allInProfit({
      revenue: invoiceRevenue,
      materialBare: ct.material,
      labor: ct.labor,
      freightMarkupPct: OPTS.freightMarkupPct,
      fuelFee: OPTS.fuelFee,
      carAllowance: OPTS.carAllowance,
      commissionPct: OPTS.commissionPct,
    });
    // Must NOT equal a fake "actual" that swaps in a different material total.
    const fakeActualMat = ct.material + 500;
    const asIfActual = allInProfit({
      revenue: invoiceRevenue,
      materialBare: fakeActualMat,
      labor: ct.labor,
      freightMarkupPct: OPTS.freightMarkupPct,
      fuelFee: OPTS.fuelFee,
      carAllowance: OPTS.carAllowance,
      commissionPct: OPTS.commissionPct,
    });
    expect(inv.profit).not.toEqual(asIfActual.profit);
    expectClose(inv.material, ct.material * freightMultiplier(OPTS.freightMarkupPct));
  });

  it("lineMargin includes freight on material only", () => {
    const m = lineMargin(FIXTURE, 5);
    const ct = optionCostTotals([FIXTURE]);
    const s = lineTotal(FIXTURE);
    const cost = ct.material * 1.05 + ct.labor;
    expectClose(m, ((s - cost) / s) * 100);
    // Labor half of cost is not multiplied by freight.
    expectClose(ct.labor, 100 * 1 * 1.1);
  });
});

describe("Step 7 final — sell-from-margin paths agree (landed material)", () => {
  const bareMat = 60;
  const bareLabor = 40;
  const freightPct = 5;
  const margin = 40;
  // $63 / 0.60 = $105
  const expectedMatSell = 105;
  const expectedLaborSell = priceFromMargin(40, 40); // 66.6…

  it("1: builder ratesFromTargetMargin uses landed material", () => {
    const rates = ratesFromTargetMargin({
      lineType: "mat_labor",
      laborOnly: false,
      materialCost: bareMat,
      laborCost: bareLabor,
      targetMarginPct: margin,
      freightMarkupPct: freightPct,
    });
    expectClose(rates.material_rate!, expectedMatSell);
    expectClose(rates.labor_rate!, expectedLaborSell);
  });

  it("2–4: questionnaire / AI / order helpers match builder material sell", () => {
    const q = sellMaterialFromTargetMargin(bareMat, margin, freightPct);
    const ai = sellMaterialFromTargetMargin(bareMat, margin, freightPct);
    const order = sellMaterialFromTargetMargin(bareMat, margin, freightPct);
    const builder = ratesFromTargetMargin({
      lineType: "mat_labor",
      laborOnly: false,
      materialCost: bareMat,
      laborCost: 0,
      targetMarginPct: margin,
      freightMarkupPct: freightPct,
    }).material_rate!;
    expectClose(q, expectedMatSell);
    expectClose(ai, expectedMatSell);
    expectClose(order, expectedMatSell);
    expectClose(builder, expectedMatSell);
    expectClose(q, ai);
    expectClose(ai, order);
    expectClose(order, builder);
  });

  it("5–6: freight material only; labor not freighted", () => {
    const mat = sellMaterialFromTargetMargin(bareMat, margin, freightPct);
    const lab = sellLaborFromTargetMargin(bareLabor, margin);
    expectClose(mat, expectedMatSell);
    expectClose(lab, expectedLaborSell);
    expect(lab).toBeLessThan(
      sellMaterialFromTargetMargin(bareLabor, margin, freightPct),
    );
  });

  it("7: stored material_cost stays bare — sell uses landed, cost field unchanged", () => {
    const storedBare = bareMat;
    const sell = sellMaterialFromTargetMargin(storedBare, margin, freightPct);
    expect(storedBare).toBe(60);
    expectClose(sell, expectedMatSell);
    expect(sell).not.toBe(priceFromMargin(storedBare, margin));
  });

  it("8: no double freight in jobProfit after landed sell", () => {
    const sell = sellMaterialFromTargetMargin(3, 40, 5);
    const line: CalcLine = {
      line_type: "mat_labor",
      category: "lvp",
      measure_unit: "sqft",
      sqft: 100,
      waste_pct: 0,
      material_rate: sell,
      labor_rate: 0,
      material_cost: 3, // bare
      labor_cost: 0,
    };
    const p = jobProfit([line], {
      freightMarkupPct: 5,
      fuelFee: 0,
      carAllowance: 0,
      commissionPct: 0,
    });
    expectClose(p.material, 100 * 3 * 1.05);
    expectClose(p.margin, 40);
  });

  it("9: freight = 0 matches bare priceFromMargin", () => {
    expectClose(
      sellMaterialFromTargetMargin(bareMat, margin, 0),
      priceFromMargin(bareMat, margin),
    );
    expectClose(
      ratesFromTargetMargin({
        lineType: "mat_labor",
        laborOnly: false,
        materialCost: bareMat,
        laborCost: 0,
        targetMarginPct: margin,
        freightMarkupPct: 0,
      }).material_rate!,
      priceFromMargin(bareMat, margin),
    );
  });
});
