/**
 * Customer pay link, install request vs confirm, dye lot on the ticket,
 * and a signed extra on the bill. No Stripe, no second calendar, no estimate rewrite.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  customerToldInstallIsLocked,
  planInstallHold,
  portalInstallHoldCopy,
} from "@/lib/install-hold";
import { extraChargeAllowed, rollTicketLine } from "@/lib/job-extra";
import {
  invoicePayAllowed,
  quoteDepositAllowed,
  quoteDepositRoom,
} from "@/lib/portal-pay";

describe("install is requested until the goods are in", () => {
  it("confirms only when the warehouse is ready or a reason is written", () => {
    expect(planInstallHold({ materialsReady: false })).toBe("requested");
    expect(planInstallHold({ materialsReady: false, overrideReason: "   " })).toBe("requested");
    expect(planInstallHold({ materialsReady: true })).toBe("confirmed");
    expect(
      planInstallHold({ materialsReady: false, overrideReason: "Customer is traveling" }),
    ).toBe("confirmed");
  });

  it("does not tell the customer a requested date is locked", () => {
    expect(customerToldInstallIsLocked("requested", true)).toBe(false);
    expect(customerToldInstallIsLocked("confirmed", true)).toBe(true);
    expect(customerToldInstallIsLocked(null, true)).toBe(true);
    expect(customerToldInstallIsLocked(null, false)).toBe(false);
    expect(portalInstallHoldCopy("Oct 28").title).toBe("Install requested");
  });
});

describe("the customer pays the balance that is actually due", () => {
  it("locks an invoice payment to the remaining balance", () => {
    expect(invoicePayAllowed(0)).toMatchObject({ ok: false });
    expect(invoicePayAllowed(240.5)).toEqual({ ok: true, amount: 240.5 });
  });

  it("caps a quote deposit at what is still uncovered", () => {
    expect(quoteDepositRoom(1000, 400)).toBe(600);
    expect(quoteDepositRoom(1000, 1000)).toBe(0);
    expect(quoteDepositAllowed(600, 1000, 400)).toEqual({ ok: true, amount: 600 });
    expect(quoteDepositAllowed(601, 1000, 400).ok).toBe(false);
    expect(quoteDepositAllowed(0, 1000, 0).ok).toBe(false);
  });
});

describe("a signed extra is a real charge", () => {
  it("rejects a blank screen and an empty description", () => {
    expect(
      extraChargeAllowed({
        description: "Transition",
        amount: 85,
        signer: "Ada",
        signature: "",
      }).ok,
    ).toBe(false);
    expect(
      extraChargeAllowed({
        description: "  ",
        amount: 85,
        signer: "Ada",
        signature: "data:image/png;base64,abc",
      }).ok,
    ).toBe(false);
    expect(
      extraChargeAllowed({
        description: "Extra reducer",
        amount: 85.5,
        signer: "Ada King",
        signature: "data:image/png;base64,abc",
      }),
    ).toEqual({
      ok: true,
      description: "Extra reducer",
      amount: 85.5,
      signer: "Ada King",
    });
  });

  it("prints the dye lot, and says when none was written", () => {
    expect(
      rollTicketLine({
        productName: "Oak",
        rollNumber: "R-14",
        dyeLot: "L-220",
        qty: 42,
        unit: "sqft",
      }),
    ).toBe("Oak — Roll R-14 · dye lot L-220 — 42 sqft");
    expect(
      rollTicketLine({
        productName: "Oak",
        rollNumber: null,
        dyeLot: null,
        qty: 10,
        unit: "sqft",
      }),
    ).toContain("No dye lot written");
  });
});

describe("store day four stays on the existing records", () => {
  const sql = readFileSync("supabase/migrations/0499_store_day_four.sql", "utf8");
  const jobs = readFileSync("src/app/(app)/jobs/actions.ts", "utf8");
  const pay = readFileSync("src/app/portal/pay-actions.ts", "utf8");
  const extra = readFileSync("src/app/(app)/jobs/extra-actions.ts", "utf8");

  it("adds the hold, the roll identity, and the signature table without deleting rows", () => {
    expect(sql).toContain("install_hold");
    expect(sql).toContain("dye_lot");
    expect(sql).toContain("roll_number");
    expect(sql).toContain("assigned_job_id");
    expect(sql).toContain("create table if not exists public.job_extras");
    expect(sql).toContain("grant select, insert on public.job_extras to authenticated");
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/^\s*begin\s*;/im);
    expect(sql).not.toMatch(/^\s*commit\s*;/im);
    expect(sql).toContain("set install_hold = 'confirmed'");
  });

  it("requests a date without the booked notifications", () => {
    const book = jobs.slice(
      jobs.indexOf("export async function bookInstall"),
      jobs.indexOf("export async function confirmRequestedInstall"),
    );
    expect(book).toContain("classifyInstallBooking");
    expect(book).not.toContain("enforceMaterialsReadyForSchedule");
    const confirmedNotify = book.indexOf('if (installHold === "confirmed" && !skipClientEmail)');
    expect(book.indexOf("notifyInstallBooked")).toBeGreaterThan(confirmedNotify);
    expect(book.indexOf("notifyInstallerAssigned")).toBeGreaterThan(confirmedNotify);
    expect(jobs).toContain("ensureWarehouseSubmitted");
  });

  it("records the customer's card through the existing payment functions", () => {
    expect(pay).toContain("record_invoice_payment_safe");
    expect(pay).toContain("record_customer_deposit_safe");
    expect(pay).toContain('p_method: "card"');
    expect(pay).toContain("Paid from the customer link");
    expect(pay).toContain("invoice.customer_id !== who.customerId");
    expect(pay).toContain("estimate.customer_id !== who.customerId");
    expect(pay).toContain("card_processing_url");
    expect(pay.toLowerCase()).not.toContain("stripe");
  });

  it("adds the signed amount to an invoice and leaves the estimate alone", () => {
    expect(extra).toContain("commercial_kind: \"supplemental\"");
    expect(extra).toContain("`Extra: ${parsed.description}`");
    expect(extra).not.toContain("estimate_line_items");
    expect(extra).not.toContain("job_line_items");
  });
});
