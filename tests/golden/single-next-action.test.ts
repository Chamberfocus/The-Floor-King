/**
 * One employee-facing "what now" on a record: the action center.
 * Job progress may show facts. It must not name a different next step.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessJobOperationalState } from "@/lib/job-operational-state";
import {
  buildCustomerActionCenter,
  buildJobActionCenter,
} from "@/lib/record-action-center";
import { snoozeDueAt } from "@/lib/ops-followup";

const NOW = new Date("2026-09-24T15:00:00Z");

function text(model: { primary: { label: string } | null; secondary: { label: string }[]; blocker: string | null; also: string | null }) {
  return JSON.stringify(model);
}

describe("single next-action presentation", () => {
  it("does not leave a second next-step headline in the checklist or reminder card", () => {
    const checklist = readFileSync("src/components/job-checklist.tsx", "utf8");
    const rollup = readFileSync("src/app/(app)/customers/[id]/job-roll-up.tsx", "utf8");
    const reminder = readFileSync("src/app/(app)/customers/[id]/customer-next-action.tsx", "utf8");
    for (const src of [checklist, rollup, reminder]) {
      expect(src).not.toContain("passed over");
      expect(src).not.toContain("Next required");
      expect(src).not.toContain("Skipped —");
    }
    expect(checklist).not.toContain(">Next<");
    expect(rollup).not.toContain(">Next<");
    expect(reminder).toContain("does not clear a deposit");
  });

  it("A. deposit and a bookable install stay independent", () => {
    const model = buildCustomerActionCenter({
      now: NOW,
      role: "office",
      customerId: "dan",
      depositOnFile: false,
      estimates: [{ id: "e", status: "approved" }],
      jobs: [{ id: "j", title: "Flooring for Dan Nauman", status: "unscheduled", hasMaterialNeed: false }],
    });
    expect(model.primary?.label).toBe("Collect deposit");
    expect(model.secondary.map((row) => row.label)).toContain("Schedule install");
    expect(text(model)).not.toContain("staging");
    expect(text(model)).not.toContain("passed over");
  });

  it("B. material not ready removes schedule and keeps the deposit", () => {
    const model = buildCustomerActionCenter({
      now: NOW,
      role: "office",
      customerId: "dan",
      depositOnFile: false,
      estimates: [{ id: "e", status: "approved" }],
      jobs: [{ id: "j", title: "Flooring", status: "unscheduled", hasMaterialNeed: true, warehouseReadyAt: null }],
    });
    expect(model.primary?.label).toBe("Review material");
    expect(model.secondary.map((row) => row.label)).toContain("Collect deposit");
    expect(text(model)).not.toContain("Schedule install");
  });

  it("C. a collected deposit leaves schedule as the action", () => {
    const model = buildCustomerActionCenter({
      now: NOW,
      role: "office",
      customerId: "dan",
      depositOnFile: true,
      estimates: [{ id: "e", status: "approved" }],
      jobs: [{ id: "j", title: "Flooring", status: "unscheduled", hasMaterialNeed: false }],
    });
    expect(model.primary?.label).toBe("Schedule install");
    expect(text(model)).not.toContain("Collect deposit");
  });

  it("D. a booked install is not offered again", () => {
    const model = buildCustomerActionCenter({
      now: NOW,
      role: "office",
      customerId: "dan",
      depositOnFile: true,
      jobs: [{
        id: "j",
        title: "Flooring",
        status: "scheduled",
        scheduledDate: "2026-10-03",
        hasMaterialNeed: true,
        warehouseReadyAt: "2026-09-23T00:00:00Z",
      }],
    });
    expect(text(model)).not.toContain("Schedule install");
    expect(model.history.some((line) => line.includes("booked"))).toBe(true);
  });

  it("E. a finished job with a balance opens the invoice and does not schedule", () => {
    const model = buildJobActionCenter({
      now: NOW,
      role: "office",
      jobId: "j",
      title: "Flooring",
      status: "completed",
      hasMaterialNeed: false,
      openBalance: 200,
      invoiceHref: "/invoices/inv",
      ops: null,
    });
    expect(model.primary?.href).toBe("/invoices/inv");
    expect(text(model)).not.toContain("Schedule install");
    expect(model.situation).toContain("Install complete");
  });

  it("F. an open callback is the action on a finished job", () => {
    const model = buildJobActionCenter({
      now: NOW,
      role: "office",
      jobId: "j",
      title: "Flooring",
      status: "completed",
      hasMaterialNeed: false,
      hasOpenCallback: true,
      ops: assessJobOperationalState({
        status: "completed",
        scheduledDate: "2026-09-01",
        warehouseReadyAt: null,
        hasMaterialNeed: false,
        hasOpenServiceCallback: true,
        activeHold: null,
      }),
    });
    expect(model.primary?.label).toBe("Open service");
    expect(model.quiet).not.toBe("This job is on track.");
  });

  it("G. warehouse sees only the warehouse action", () => {
    const model = buildJobActionCenter({
      now: NOW,
      role: "warehouse",
      jobId: "j",
      title: "Flooring",
      status: "unscheduled",
      hasMaterialNeed: true,
      openBalance: 900,
      ops: null,
    });
    expect(model.primary?.href).toBe("/warehouse");
    expect(text(model)).not.toContain("900");
    expect(text(model)).not.toContain("Schedule install");
    expect(text(model)).not.toContain("Deposit");
  });

  it("H. a scheduler does not see deposit or invoice content", () => {
    const model = buildCustomerActionCenter({
      now: NOW,
      role: "scheduler",
      customerId: "dan",
      depositOnFile: false,
      estimates: [{ id: "e", status: "approved" }],
      openInvoices: [{ id: "inv", number: "55", dueAt: "2026-09-01" }],
      jobs: [{ id: "j", title: "Flooring", status: "unscheduled", hasMaterialNeed: false }],
    });
    expect(model.primary?.label).toBe("Schedule install");
    expect(text(model)).not.toContain("Deposit");
    expect(text(model)).not.toContain("/invoices/");
  });

  it("I. snooze only moves the reminder date and does not hide a material gate", () => {
    const due = snoozeDueAt(NOW, 3);
    expect(due > NOW.toISOString()).toBe(true);
    const model = buildCustomerActionCenter({
      now: NOW,
      role: "office",
      customerId: "dan",
      nextActionDue: due,
      depositOnFile: false,
      estimates: [{ id: "e", status: "approved" }],
      jobs: [{ id: "j", title: "Flooring", status: "unscheduled", hasMaterialNeed: true, warehouseReadyAt: null }],
    });
    expect(model.primary?.label).toBe("Review material");
    expect(text(model)).not.toContain("Schedule install");
  });

  it("J. two independent actions are not written as a sequence", () => {
    const model = buildCustomerActionCenter({
      now: NOW,
      role: "admin",
      customerId: "dan",
      depositOnFile: false,
      estimates: [{ id: "e", status: "approved" }],
      jobs: [{ id: "j", title: "Flooring", status: "unscheduled", hasMaterialNeed: false }],
    });
    expect(model.primary?.label).toBe("Collect deposit");
    expect(model.secondary[0]?.label).toBe("Schedule install");
    expect(model.also).toContain("does not hold");
    expect(text(model)).not.toContain("before");
  });
});
