/**
 * Gas, car allowance, and commission are added to the customer bill.
 * The salesperson's gas is a share of the fuel charge, not a second cost.
 */
import { describe, expect, it } from "vitest";
import {
  addedShareForSelection,
  buryAddedOnExtendedPrices,
  computeBillRecovery,
  flooringBaseForCustomerTotal,
  presentCustomerBill,
  spreadRecoveryOntoAmounts,
} from "@/lib/bill-recovery";
import { customerCopyNarrative } from "@/lib/customer-scope";
import {
  hideDuplicateQuestionKeys,
  hideNonCarpetSectionsWhenCarpetOnly,
} from "@/lib/flooring-knowledge";

describe("bill recovery", () => {
  it("adds fuel, car, and commission on the flooring sale and caps salesperson gas", () => {
    const r = computeBillRecovery(1380, {
      fuelCharge: 60,
      salespersonGas: 50,
      carAllowance: 110,
      commissionPct: 3.5,
    });
    expect(r.fuelCharge).toBe(60);
    expect(r.salespersonGas).toBe(50);
    expect(r.carAllowance).toBe(110);
    expect(r.commission).toBeCloseTo(1380 * 0.035, 10);
    expect(r.customerRevenue).toBeCloseTo(1380 + 60 + 110 + 1380 * 0.035, 10);
    expect(r.added).toBeCloseTo(r.customerRevenue - 1380, 10);
  });

  it("pays salesperson gas only out of the fuel charge", () => {
    expect(
      computeBillRecovery(1000, { fuelCharge: 40, salespersonGas: 50 }).salespersonGas,
    ).toBe(40);
    expect(
      computeBillRecovery(1000, { fuelCharge: 0, salespersonGas: 50 }).salespersonGas,
    ).toBe(0);
    expect(computeBillRecovery(0, { fuelCharge: 60, salespersonGas: 50, carAllowance: 110 }).added).toBe(0);
  });

  it("solves the flooring base that lands on a typed customer total", () => {
    const settings = { fuelCharge: 60, carAllowance: 15, commissionPct: 5 };
    const base = flooringBaseForCustomerTotal(1524, settings);
    expect(base).toBeCloseTo(1380, 10);
    expect(computeBillRecovery(base, settings).customerRevenue).toBeCloseTo(1524, 2);
  });

  it("spreads extra cents onto the largest lines and keeps the sum", () => {
    const spread = spreadRecoveryOntoAmounts([100, 50, 0], 0.02);
    expect(spread[2]).toBe(0);
    expect(spread.reduce((s, n) => s + n, 0)).toBeCloseTo(150.02, 10);
    expect(spread[0]).toBeGreaterThan(100);
  });

  it("buries the add in line prices and taxes the higher total", () => {
    const bill = presentCustomerBill({
      lineTotals: [800, 200],
      discount: 0,
      taxRatePct: 8,
      added: 100,
    });
    expect(bill.lineTotals.reduce((s, n) => s + n, 0)).toBeCloseTo(1100, 10);
    expect(bill.subtotal).toBeCloseTo(1100, 10);
    expect(bill.tax).toBeCloseTo(88, 10);
    expect(bill.total).toBeCloseTo(1188, 10);
  });

  it("gives a partial invoice only its share of the add", () => {
    const share = addedShareForSelection(1000, 250, 80);
    expect(share).toBe(20);
    const items = buryAddedOnExtendedPrices(
      [
        { quantity: 2, rate: 100 },
        { quantity: 1, rate: -40 },
      ],
      share,
    );
    expect(items[0].quantity * items[0].rate).toBeCloseTo(220, 10);
    expect(items[1].rate).toBe(-40);
  });
});

describe("project details on the customer copy", () => {
  const text = ["Living room carpet, pad, and tack strip.", "• Pad: 8 lb", "• Stairs: yes"].join(
    "\n",
  );

  it("keeps captured answers when project details are on", () => {
    const on = customerCopyNarrative(text, true);
    expect(on.toLowerCase()).toContain("pad");
    expect(on.toLowerCase()).toContain("stairs");
  });

  it("drops captured answers when project details are off", () => {
    const off = customerCopyNarrative(text, false);
    expect(off.toLowerCase()).not.toContain("pad: 8 lb");
    expect(off.toLowerCase()).not.toContain("stairs: yes");
  });
});

describe("carpet questionnaire duplicates", () => {
  it("keeps one question when the same key is asked twice", () => {
    const questions = [
      { id: "a", key: "carpet_pad", position: 1 },
      { id: "b", key: "carpet_pad", position: 2 },
      { id: "c", key: "tack_strip", position: 3 },
    ];
    const visible = hideDuplicateQuestionKeys(questions, {
      a: true,
      b: true,
      c: true,
    });
    expect(visible.a).toBe(true);
    expect(visible.b).toBe(false);
    expect(visible.c).toBe(true);
  });

  it("hides unkeyed tile and hardwood questions on an exclusive carpet job", () => {
    const questions = [
      { id: "pad", key: "carpet_pad", section: "Carpet" },
      { id: "grout", key: null, section: "Tile" },
      { id: "species", key: "", section: "Hardwood" },
      { id: "stairs", key: "carpet_stairs", section: "Carpet" },
    ];
    const visible = hideNonCarpetSectionsWhenCarpetOnly(
      questions,
      { pad: true, grout: true, species: true, stairs: true },
      true,
    );
    expect(visible.pad).toBe(true);
    expect(visible.stairs).toBe(true);
    expect(visible.grout).toBe(false);
    expect(visible.species).toBe(false);
  });
});
