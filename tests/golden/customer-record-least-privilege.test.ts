/**
 * Scheduler customer-file loads. Money queries stay behind the money gate.
 * Scheduling still follows material readiness, not the deposit.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { customerSeesCustomerMoney } from "@/lib/customer-record-access";
import { buildCustomerActionCenter } from "@/lib/record-action-center";
import type { UserRole } from "@/lib/types";

const page = readFileSync("src/app/(app)/customers/[id]/page.tsx", "utf8");
const layout = readFileSync("src/app/(app)/customers/layout.tsx", "utf8");
const NOW = new Date("2026-09-24T15:00:00.000Z");

function model(role: UserRole, extra: Partial<Parameters<typeof buildCustomerActionCenter>[0]> = {}) {
  return buildCustomerActionCenter({ now: NOW, role, customerId: "c1", ...extra });
}

const readyJob = {
  id: "j1",
  title: "Kitchen",
  status: "unscheduled",
  scheduledDate: null,
  warehouseReadyAt: "2026-09-20",
  hasMaterialNeed: true,
  createdAt: "2026-09-01",
};

describe("customer record least privilege", () => {
  it("loads money only for sales and office roles", () => {
    for (const role of ["admin", "office", "sales_manager", "salesman"] as const) {
      expect(customerSeesCustomerMoney(role)).toBe(true);
    }
    for (const role of ["scheduler", "crew", "warehouse", "customer"] as const) {
      expect(customerSeesCustomerMoney(role)).toBe(false);
    }
  });

  it("does not call financial loaders unless the viewer can see money", () => {
    expect(page).toContain("seesMoney ? await listInvoicesForCustomer(id) : []");
    expect(page).toContain("seesMoney ? await listPurchaseOrdersForCustomer(id) : []");
    expect(page).toContain("seesMoney ? await getCustomerJobCosting(id) : emptyCosting");
    expect(page).toContain("seesMoney ? await getCustomerHistory(id) : emptyHistory");
    expect(page).toContain("seesMoney\n    ? await getCustomerCreditSummary");
    expect(page).toContain("seesMoney\n    ? await getCustomerDepositSummary");
    expect(page).toContain("seesMoney\n    ? await listEstimatesForCustomer(id)\n    : await listEstimateScheduleFacts(id)");
    expect(page).toContain("if (seesMoney && jobOptionIds.length)");
    expect(page).toContain("await listJobsForCustomer(id)");
    expect(page).toContain("loadCustomerRecordFacts");
    expect(layout).toContain("scheduler");
    expect(layout).not.toContain('"crew"');
    expect(layout).not.toContain('"warehouse"');
  });

  it("schedules from material readiness and does not serialize deposit or invoice facts", () => {
    const booked = model("scheduler", {
      stageName: "Won",
      estimates: [{ id: "e1", status: "approved", approvedAt: "2026-09-20" }],
      jobs: [readyJob],
      depositOnFile: null,
      openInvoices: [],
    });
    expect(booked.primary?.label).toBe("Schedule install");
    expect(booked.secondary.map((row) => row.label)).not.toContain("Collect deposit");
    expect(JSON.stringify(booked)).not.toContain("Deposit");
    expect(JSON.stringify(booked)).not.toContain("Invoice");

    const noDeposit = model("scheduler", {
      estimates: [{ id: "e1", status: "approved" }],
      jobs: [readyJob],
      depositOnFile: false,
    });
    const hasDeposit = model("scheduler", {
      estimates: [{ id: "e1", status: "approved" }],
      jobs: [readyJob],
      depositOnFile: true,
    });
    expect(noDeposit.primary?.label).toBe("Schedule install");
    expect(hasDeposit.primary?.label).toBe("Schedule install");

    const blocked = model("scheduler", {
      jobs: [{ ...readyJob, warehouseReadyAt: null }],
      depositOnFile: true,
    });
    expect(blocked.primary?.label).toBe("Review material");
    expect(blocked.secondary.map((row) => row.label)).not.toContain("Schedule install");
    expect(blocked.primary?.label).not.toBe("Schedule install");
  });

  it("does not widen crew or warehouse into customer money", () => {
    expect(model("crew").quiet).toBe("This record is not part of your work.");
    expect(model("warehouse").quiet).toBe("This record is not part of your work.");
    expect(model("customer").quiet).toBe("This record is not part of your work.");
    expect(JSON.stringify(model("crew", { depositOnFile: false, openInvoices: [{ id: "i1", number: "100", dueAt: "2026-09-01" }] }))).not.toContain("Collect deposit");
    expect(JSON.stringify(model("warehouse", { jobs: [readyJob] }))).not.toContain("Schedule install");
  });
});
