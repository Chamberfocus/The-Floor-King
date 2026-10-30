/**
 * Customer bill vs margin.
 *
 * Gas, the car allowance, and commission are added to what the customer pays
 * and buried in the line prices. They are not job costs. Of the gas, the
 * salesperson's share is recorded and is not subtracted. Margin stays
 * (flooring revenue − material − labor) / flooring revenue.
 */
import { describe, expect, it } from "vitest";
import { lineQty, lineTotal, type CalcLine } from "@/lib/estimate-calc";
import { jobProfit } from "@/lib/job-profit";
import { projectDetailsShown } from "@/lib/customer-scope";
import { simplifyCarpetQuestionnaire } from "@/lib/flooring-knowledge/show-if";
import {
  buryAddOnInPricedRows,
  customerBillForLines,
  flooringPriceForCustomerPreTax,
  marginRevenueForInvoice,
  spreadBillAddOn,
} from "@/lib/job-bill";
import { quickEstimateCustomerNotes, quickEstimateLineRow } from "@/lib/quick-estimate";

const RATES = {
  fuelCharge: 60,
  salespersonGas: 50,
  carAllowance: 110,
  commissionPct: 3.5,
};

describe("customer bill buries gas, car, and commission", () => {
  it("adds them on top of the flooring sale and splits them across the lines", () => {
    const bill = customerBillForLines({
      lineSells: [1000, 1000],
      rates: RATES,
    });
    expect(bill.flooringRevenue).toBe(2000);
    expect(bill.fuelCharge).toBe(60);
    expect(bill.salespersonGas).toBe(50);
    expect(bill.carAllowance).toBe(110);
    expect(bill.commission).toBe(70);
    expect(bill.added).toBe(240);
    expect(bill.preTax).toBe(2240);
    expect(bill.lineAmounts.reduce((s, n) => s + n, 0)).toBe(2240);
    expect(bill.lineAmounts[0]).toBe(bill.lineAmounts[1]);
  });

  it("does not lower the flooring margin", () => {
    const line: CalcLine = {
      line_type: "flat",
      flat_amount: 2000,
    };
    const withFees = jobProfit([line], {
      fuelFee: 50,
      carAllowance: 110,
      commissionPct: 3.5,
    });
    const bare = jobProfit([line], {
      fuelFee: 0,
      carAllowance: 0,
      commissionPct: 0,
    });
    expect(withFees.profit).toBe(bare.profit);
    expect(withFees.margin).toBe(bare.margin);
    expect(withFees.fuelFee).toBe(50);
    expect(withFees.commission).toBe(70);
  });

  it("solves the flooring price underneath a customer total", () => {
    expect(flooringPriceForCustomerPreTax(2240, RATES)).toBe(2000);
  });

  it("caps the salesperson's gas at the gas on the bill", () => {
    const bill = customerBillForLines({
      lineSells: [500],
      rates: { ...RATES, fuelCharge: 40, salespersonGas: 50 },
    });
    expect(bill.fuelCharge).toBe(40);
    expect(bill.salespersonGas).toBe(40);
  });

  it("keeps a discount line and lands the buried total on the cent", () => {
    const rows = buryAddOnInPricedRows(
      [
        { quantity: 3, rate: 100 },
        { quantity: 1, rate: -25 },
      ],
      10,
    );
    const sum = rows.reduce((s, r) => s + r.quantity * r.rate, 0);
    expect(rows[1].rate).toBe(-25);
    expect(sum).toBeCloseTo(285, 2);
    const odd = spreadBillAddOn([10.01, 10.02], 0.01);
    expect(odd.reduce((s, n) => s + n, 0)).toBeCloseTo(20.04, 2);
  });

  it("backs buried charges out of an invoice before judging margin", () => {
    const bill = customerBillForLines({ lineSells: [2000], rates: RATES });
    expect(marginRevenueForInvoice(bill.preTax, bill.flooringRevenue, bill.preTax)).toBe(2000);
    expect(marginRevenueForInvoice(2000, bill.flooringRevenue, bill.preTax)).toBe(2000);
  });
});

describe("project details toggle", () => {
  it("treats an explicit off as hidden and anything else as shown", () => {
    expect(projectDetailsShown(false)).toBe(false);
    expect(projectDetailsShown("false")).toBe(false);
    expect(projectDetailsShown("off")).toBe(false);
    expect(projectDetailsShown(0)).toBe(false);
    expect(projectDetailsShown(true)).toBe(true);
    expect(projectDetailsShown(null)).toBe(true);
    expect(projectDetailsShown(undefined)).toBe(true);
  });
});

describe("carpet questionnaire", () => {
  const questions = [
    { id: "install", key: "carpet_install", label: "How is the carpet installed?" },
    { id: "dup", key: null, label: "How is the carpet installed?" },
    { id: "heat", key: "radiant_heat", label: "Radiant heat?" },
    { id: "vapor", key: "vapor_barrier", label: "6-mil vapor barrier?" },
    { id: "stairs", key: "hs_plank_stairs", label: "Plank stairs?" },
    { id: "pad", key: "carpet_pad", label: "What pad?" },
  ];
  const visible = Object.fromEntries(questions.map((q) => [q.id, true]));

  it("on a carpet-only job hides hard-surface leftovers and the duplicate", () => {
    const next = simplifyCarpetQuestionnaire(questions, visible, true);
    expect(next.install).toBe(true);
    expect(next.pad).toBe(true);
    expect(next.dup).toBe(false);
    expect(next.heat).toBe(false);
    expect(next.vapor).toBe(false);
    expect(next.stairs).toBe(false);
  });

  it("on a mixed job still drops the duplicate and keeps hard-surface questions", () => {
    const next = simplifyCarpetQuestionnaire(questions, visible, false);
    expect(next.dup).toBe(false);
    expect(next.heat).toBe(true);
    expect(next.vapor).toBe(true);
  });
});

describe("salesperson quick estimate transfers to the job", () => {
  it("keeps carpet yards, product identity, and the same sell the quote showed", () => {
    const row = quickEstimateLineRow(
      {
        description: "Shaw · Calm · Tide",
        quantity: "50",
        unit: "sq yd",
        rate: "20",
        cost: "8",
        productId: "prod-1",
        category: "carpet",
        manufacturer: "Shaw",
        style: "Calm",
        color: "Tide",
      },
      0,
    );
    expect(row.unit).toBe("sqyd");
    expect(row.measure_unit).toBe("sqyd");
    expect(row.sqft).toBe(450);
    expect(row.category).toBe("carpet");
    expect(row.manufacturer).toBe("Shaw");
    expect(row.style).toBe("Calm");
    expect(row.color).toBe("Tide");
    expect(row.product_id).toBe("prod-1");
    expect(lineQty(row as CalcLine)).toBe(50);
    expect(lineTotal(row as CalcLine)).toBe(1000);
  });

  it("bills square feet and each by the quantity that was typed", () => {
    const sqft = quickEstimateLineRow(
      { description: "LVP", quantity: 120, unit: "sq ft", rate: 4, category: "lvp" },
      0,
    );
    expect(sqft.measure_unit).toBe("sqft");
    expect(sqft.sqft).toBe(120);
    expect(lineQty(sqft as CalcLine)).toBe(120);
    expect(lineTotal(sqft as CalcLine)).toBe(480);

    const each = quickEstimateLineRow(
      { description: "Toilet reset", quantity: 2, unit: "each", rate: 75, category: "labor" },
      1,
    );
    expect(each.sqft).toBeNull();
    expect(each.unit).toBe("each");
    expect(lineQty(each as CalcLine)).toBe(2);
    expect(lineTotal(each as CalcLine)).toBe(150);
  });

  it("puts the salesperson's notes on the customer copy and the work order", () => {
    expect(quickEstimateCustomerNotes("  Two rooms of carpet.  ")).toBe("Two rooms of carpet.");
    expect(quickEstimateCustomerNotes("   ")).toBeNull();
  });
});
