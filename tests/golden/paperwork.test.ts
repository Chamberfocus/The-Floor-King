import { describe, expect, it } from "vitest";
import { matchSupplierId, parsePaperwork, settleLine } from "@/lib/paperwork";

const CONFIRMATION = `Shaw Industries
Order Confirmation
Order number: 451239
Date: 11/02/2026
Ship to: Jane Smith
ETA: 11/15/2026

Anso Color Wall  120  SY  12.50  1,500.00
Pad 7/16  120  SY  2.10  252.00
Freight  75.00
Total  1,827.00
`;

const INVOICE = `ABC Distributing
Invoice
Invoice number: INV-9088
Invoice date: November 2, 2026
Due date: December 2, 2026
Terms: Net 30
Ship to: Jane Smith

LVP Harbor Oak  800  SF  3.25  2,600.00
Transitions  4  EA  18.00  72.00
Sales tax  0.00
Freight  85.50
Amount due  2,757.50
`;

describe("parse supplier paperwork", () => {
  it("reads an order confirmation and the lines equal the printed total", () => {
    const doc = parsePaperwork(CONFIRMATION, "Jane Smith");
    expect(doc.kind).toBe("order_confirmation");
    expect(doc.vendor).toBe("Shaw Industries");
    expect(doc.number).toBe("451239");
    expect(doc.date).toBe("2026-11-02");
    expect(doc.eta).toBe("2026-11-15");
    expect(doc.lines.map((l) => [l.description, l.quantity, l.unit, l.amount])).toEqual([
      ["Anso Color Wall", 120, "sq yd", 1500],
      ["Pad 7/16", 120, "sq yd", 252],
      ["Freight", 1, "ea", 75],
    ]);
    expect(doc.lineTotal).toBe(1827);
    expect(doc.printedTotal).toBe(1827);
    expect(doc.balanced).toBe(true);
    expect(doc.warnings).toEqual([]);
  });

  it("reads a vendor invoice with tax and freight", () => {
    const doc = parsePaperwork(INVOICE, "Jane Smith");
    expect(doc.kind).toBe("vendor_invoice");
    expect(doc.vendor).toBe("ABC Distributing");
    expect(doc.number).toBe("INV-9088");
    expect(doc.date).toBe("2026-11-02");
    expect(doc.dueDate).toBe("2026-12-02");
    expect(doc.terms).toMatch(/Net 30/i);
    expect(doc.balanced).toBe(true);
    expect(doc.lineTotal).toBe(2757.5);
    expect(doc.lines.some((l) => l.description === "Freight" && l.amount === 85.5)).toBe(true);
    expect(doc.lines.some((l) => l.description === "Sales tax" && l.amount === 0)).toBe(false);
  });

  it("sets the unit price from the printed line amount when they disagree", () => {
    const line = settleLine({
      description: "Carpet",
      quantity: 10,
      unit: "sy",
      unitCost: 12,
      amount: 125,
    });
    expect(line?.unitCost).toBe(12.5);
    expect(line?.amount).toBe(125);
    expect(line?.warning).toMatch(/printed line amount/);
  });

  it("stays unbalanced when the lines do not equal the document total", () => {
    const doc = parsePaperwork(`Mohawk
Invoice
Invoice number: 100
Date: 2026-11-02
Oak plank  10  SF  4.00  40.00
Total  55.00
`);
    expect(doc.balanced).toBe(false);
    expect(doc.lineTotal).toBe(40);
    expect(doc.printedTotal).toBe(55);
    expect(doc.warnings.some((w) => w.includes("55.00"))).toBe(true);
  });

  it("warns when the ship-to name is a different customer", () => {
    const doc = parsePaperwork(CONFIRMATION, "Robert Chen");
    expect(doc.warnings.some((w) => w.includes("Jane Smith"))).toBe(true);
  });

  it("matches one saved supplier and leaves two close names unmatched", () => {
    const list = [
      { id: "shaw", name: "Shaw Industries" },
      { id: "a", name: "Mohawk Industries" },
      { id: "b", name: "Mohawk Floors" },
    ];
    expect(matchSupplierId("Shaw Industries", list)).toBe("shaw");
    expect(matchSupplierId("Mohawk", list)).toBeNull();
  });
});
