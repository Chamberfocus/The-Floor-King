import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BALANCE_REMINDER_GAP_MS,
  BALANCE_REMINDER_PREFIX,
  balanceReminderDue,
  balanceReminderLog,
  balanceReminderText,
  invoiceOldEnoughForReminder,
  pickBalanceReminderCustomers,
  quoteText,
  visitDepositAmount,
  visitDepositMethod,
} from "@/lib/in-home-close";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("in-home close", () => {
  it("texts a short quote link and a balance reminder", () => {
    expect(
      quoteText({
        firstName: "Ann",
        company: "Cleveland Floor King",
        url: "https://floorking-crm.vercel.app/portal/estimates/abc",
      }),
    ).toBe(
      "Hi Ann, your estimate from Cleveland Floor King is ready to review and approve: https://floorking-crm.vercel.app/portal/estimates/abc",
    );
    expect(
      balanceReminderText({
        firstName: "",
        company: "Cleveland Floor King",
        amount: "$240.00",
        url: "https://floorking-crm.vercel.app/portal",
      }),
    ).toContain("Hi there, Cleveland Floor King shows $240.00 still open");
    expect(balanceReminderLog("$240.00")).toBe(
      `${BALANCE_REMINDER_PREFIX} $240.00`,
    );
  });

  it("keeps a deposit amount in cents and only the methods collected on a visit", () => {
    expect(visitDepositAmount("1,250.5")).toBe(1250.5);
    expect(visitDepositAmount("$0")).toBeNull();
    expect(visitDepositAmount("nope")).toBeNull();
    expect(visitDepositMethod("cash")).toBe("cash");
    expect(visitDepositMethod("card")).toBe("card");
    expect(visitDepositMethod("link")).toBeNull();
  });

  it("waits through the grace period and a week between balance reminders", () => {
    expect(invoiceOldEnoughForReminder("2026-11-01", "2026-11-03")).toBe(false);
    expect(invoiceOldEnoughForReminder("2026-11-01", "2026-11-04")).toBe(true);
    expect(invoiceOldEnoughForReminder("", "2026-11-04")).toBe(false);
    const now = Date.parse("2026-11-14T12:00:00Z");
    expect(
      balanceReminderDue({
        lastSentAt: new Date(now - BALANCE_REMINDER_GAP_MS + 1000).toISOString(),
        nowMs: now,
      }),
    ).toBe(false);
    expect(
      balanceReminderDue({
        lastSentAt: new Date(now - BALANCE_REMINDER_GAP_MS).toISOString(),
        nowMs: now,
      }),
    ).toBe(true);
    expect(balanceReminderDue({ lastSentAt: null, nowMs: now })).toBe(true);
  });

  it("picks the oldest reachable invoice per customer", () => {
    const picked = pickBalanceReminderCustomers(
      [
        {
          customerId: "b",
          issueDate: "2026-10-02",
          archived: false,
          email: "b@example.com",
          phone: null,
        },
        {
          customerId: "a",
          issueDate: "2026-11-12",
          archived: false,
          email: "a@example.com",
          phone: "2165550100",
        },
        {
          customerId: "a",
          issueDate: "2026-10-01",
          archived: false,
          email: "a@example.com",
          phone: "2165550100",
        },
        {
          customerId: "c",
          issueDate: "2026-09-01",
          archived: true,
          email: "c@example.com",
          phone: "2165550101",
        },
        {
          customerId: "d",
          issueDate: "2026-09-01",
          archived: false,
          email: "",
          phone: "",
        },
      ],
      "2026-11-14",
      10,
    );
    expect(picked.map((row) => row.customerId)).toEqual(["a", "b"]);
    expect(picked[0]?.issueDate).toBe("2026-10-01");
  });

  it("wires the quote text, the visit deposit, and the nightly reminder", () => {
    const page = read("src/app/(app)/estimates/[id]/page.tsx");
    const text = read("src/app/(app)/estimates/close-visit-actions.ts");
    const money = read("src/app/(app)/invoices/actions.ts");
    const cron = read("src/app/api/cron/daily/route.ts");
    expect(page).toContain("Text the quote");
    expect(page).toContain("Record deposit");
    expect(page).toContain("EstimateSendDialog");
    expect(page).toContain("recordVisitDeposit");
    expect(text).toContain("export async function textEstimate");
    expect(text).toContain("quoteText");
    expect(text).toContain("thankyou_sent_at: sentAt");
    expect(text).toContain('advanceFromAutoAction(est.customer_id as string, "build_quote")');
    expect(money).toContain("recordVisitDeposit");
    expect(money).toContain("p_estimate_id: args.estimateId ?? null");
    expect(money).toContain('p_classification: "pre_invoice_deposit"');
    expect(cron).toContain("pickBalanceReminderCustomers");
    expect(cron).toContain("balanceReminderDue");
    expect(cron).toContain("balanceReminders");
  });
});
