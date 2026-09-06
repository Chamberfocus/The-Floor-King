/**
 * Golden tests for invoice money math (`src/lib/invoice-calc.ts`).
 *
 * Deposits / payments / balance due in this CRM live on invoices, not on
 * estimate rows. This suite locks that payment arithmetic.
 */
import { describe, expect, it } from "vitest";
import { invoiceTotals, itemAmount } from "@/lib/invoice-calc";

describe("itemAmount", () => {
  it("is quantity × rate", () => {
    expect(itemAmount({ quantity: 40, rate: 30 })).toBe(1200);
    expect(itemAmount({ quantity: "12.5", rate: "2.40" })).toBe(30);
    expect(itemAmount({ quantity: null, rate: 10 })).toBe(0);
  });
});

describe("invoiceTotals — deposits, payments, balance due", () => {
  const items = [
    { quantity: 40, rate: 30 }, // 1200
    { quantity: 1, rate: -100 }, // discount line (how estimate discounts become invoice rows)
  ];

  it("computes subtotal, tax, total with no payments", () => {
    // subtotal 1100; tax 8% = 88; total 1188; balance 1188
    const t = invoiceTotals(items, 8, 0);
    expect(t.subtotal).toBe(1100);
    expect(t.tax).toBe(88);
    expect(t.total).toBe(1188);
    expect(t.paid).toBe(0);
    expect(t.balance).toBe(1188);
  });

  it("treats a deposit/payment as amountPaid reducing balance", () => {
    // $500 deposit on 1188 → balance 688
    const t = invoiceTotals(items, 8, 500);
    expect(t.paid).toBe(500);
    expect(t.balance).toBe(688);
  });

  it("allows overpayment (negative balance) without inventing clamping", () => {
    const t = invoiceTotals(items, 8, 2000);
    expect(t.balance).toBe(1188 - 2000);
  });

  it("handles empty invoice", () => {
    expect(invoiceTotals([], 8, 0)).toEqual({
      subtotal: 0,
      tax: 0,
      total: 0,
      paid: 0,
      balance: 0,
    });
  });

  it("does not round tax to cents inside invoiceTotals", () => {
    const t = invoiceTotals([{ quantity: 1, rate: 33.33 }], 7.5, 0);
    expect(t.tax).toBeCloseTo(2.49975, 10);
  });
});
