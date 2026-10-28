import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parsePaymentChoice,
  paymentChoiceLabel,
  signoffNeedsPaymentChoice,
  signoffNotice,
  signoffPriceAlert,
  signoffPriceAlertCopy,
} from "@/lib/signoff-sheet";

const money = (n: number) => `$${n.toFixed(2)}`;

describe("sign-off price alert", () => {
  it("stays quiet when one invoice has no change order", () => {
    const alert = signoffPriceAlert({
      invoices: [
        { id: "a", status: "sent", commercialKind: "original", total: 5000, taxRatePct: 0 },
      ],
      extras: [],
    });
    expect(alert.show).toBe(false);
    expect(signoffPriceAlertCopy(alert, money)).toBeNull();
  });

  it("flags an extra that was added onto the original invoice", () => {
    const alert = signoffPriceAlert({
      invoices: [
        { id: "a", status: "sent", commercialKind: "original", total: 5200, taxRatePct: 0 },
      ],
      extras: [{ amount: 200, invoiceId: "a" }],
    });
    expect(alert.show).toBe(true);
    expect(alert.originalTotal).toBe(5000);
    expect(alert.invoiceTotal).toBe(5200);
    expect(alert.changeOrderTotal).toBe(200);
    expect(signoffPriceAlertCopy(alert, money)?.detail).toContain("$5000.00");
  });

  it("flags a supplemental invoice without counting the extra twice", () => {
    const alert = signoffPriceAlert({
      invoices: [
        { id: "a", status: "sent", commercialKind: "original", total: 5000, taxRatePct: 0 },
        { id: "b", status: "sent", commercialKind: "supplemental", total: 200, taxRatePct: 0 },
      ],
      extras: [{ amount: 200, invoiceId: "b" }],
    });
    expect(alert.originalTotal).toBe(5000);
    expect(alert.invoiceTotal).toBe(5200);
    expect(alert.changeOrderTotal).toBe(200);
  });

  it("flags a replacement against the voided original", () => {
    const alert = signoffPriceAlert({
      invoices: [
        { id: "old", status: "void", commercialKind: "original", total: 5000, taxRatePct: 0 },
        { id: "new", status: "sent", commercialKind: "replacement", total: 5500, taxRatePct: 0 },
      ],
      extras: [],
    });
    expect(alert.show).toBe(true);
    expect(alert.originalTotal).toBe(5000);
    expect(alert.invoiceTotal).toBe(5500);
    expect(alert.changeOrderTotal).toBe(500);
  });

  it("flags a change order that is not on the invoice yet", () => {
    const alert = signoffPriceAlert({
      invoices: [
        { id: "a", status: "sent", commercialKind: "original", total: 5000, taxRatePct: 0 },
      ],
      extras: [{ amount: 150, invoiceId: null }],
    });
    expect(alert.show).toBe(true);
    expect(alert.uninvoicedExtraTotal).toBe(150);
    expect(alert.changeOrderTotal).toBe(150);
    expect(signoffPriceAlertCopy(alert, money)?.detail).toContain("not on the invoice yet");
  });

  it("grosses an extra up by the invoice tax rate", () => {
    const alert = signoffPriceAlert({
      invoices: [
        { id: "a", status: "sent", commercialKind: "original", total: 5216, taxRatePct: 8 },
      ],
      extras: [{ amount: 200, invoiceId: "a" }],
    });
    expect(alert.originalTotal).toBe(5000);
    expect(alert.changeOrderTotal).toBe(216);
  });
});

describe("sign-off payment choice", () => {
  it("asks when money is still owed or a change order is not billed", () => {
    expect(signoffNeedsPaymentChoice({ balance: 10, uninvoicedExtraTotal: 0 })).toBe(true);
    expect(signoffNeedsPaymentChoice({ balance: 0, uninvoicedExtraTotal: 25 })).toBe(true);
    expect(signoffNeedsPaymentChoice({ balance: 0, uninvoicedExtraTotal: 0 })).toBe(false);
    expect(parsePaymentChoice("pay_now")).toBe("pay_now");
    expect(parsePaymentChoice("contact_store")).toBe("contact_store");
    expect(parsePaymentChoice("cash")).toBeNull();
    expect(paymentChoiceLabel("pay_now")).toBe("Pay the balance now");
    expect(paymentChoiceLabel("contact_store")).toBe("I will contact the store to pay");
  });

  it("tells the salesperson the choice and the price difference", () => {
    const alert = signoffPriceAlert({
      invoices: [
        { id: "a", status: "sent", commercialKind: "original", total: 5200, taxRatePct: 0 },
      ],
      extras: [{ amount: 200, invoiceId: "a" }],
    });
    const notice = signoffNotice({
      customerName: "Ada Floor",
      paymentChoice: "contact_store",
      balanceLabel: "$400.00",
      alert,
      money,
      jobUrl: "https://example.test/jobs/1",
    });
    expect(notice.subject).toContain("Ada Floor");
    expect(notice.sms).toContain("contact the store");
    expect(notice.sms).toContain("Change order changed the invoice price");
    expect(notice.bodyHtml).toContain("They will contact the store to make payment.");
    expect(notice.bodyHtml).toContain("$400.00");
    const pay = signoffNotice({
      customerName: "Ada Floor",
      paymentChoice: "pay_now",
      balanceLabel: "$400.00",
      alert: signoffPriceAlert({ invoices: [], extras: [] }),
      money,
      jobUrl: "https://example.test/jobs/1",
    });
    expect(pay.sms).toContain("pay the balance now");
    expect(pay.bodyHtml).not.toContain("Change order");
  });
});

describe("sign-off wiring", () => {
  it("puts the phone sheet, the two choices, and the salesperson notice on the save path", () => {
    const form = readFileSync("src/app/(app)/jobs/[id]/satisfaction-form.tsx", "utf8");
    const save = readFileSync("src/app/(app)/jobs/[id]/wo-actions.ts", "utf8");
    const installer = readFileSync("src/app/(app)/installer/page.tsx", "utf8");
    const sql = readFileSync("supabase/migrations/0505_signoff_payment_choice.sql", "utf8");
    expect(form).toContain("Pay the balance now");
    expect(form).toContain("I will contact the store to pay");
    expect(form).toContain("signoffPriceAlertCopy");
    expect(form).toContain('role="alert"');
    expect(save).toContain("deliverJobSignoffNotice");
    expect(save).toContain("payment_choice");
    expect(installer).toContain('job.status === "completed"');
    expect(sql).toContain("contact_store");
    expect(sql).not.toMatch(/posting_enabled/i);
  });
});
