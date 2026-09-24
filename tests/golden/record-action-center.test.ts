import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessJobOperationalState } from "@/lib/job-operational-state";
import {
  buildCustomerActionCenter,
  buildEstimateActionCenter,
  buildJobActionCenter,
} from "@/lib/record-action-center";
import type { UserRole } from "@/lib/types";

const NOW = new Date("2026-09-24T15:00:00Z");

function customer(role: UserRole, extra: Partial<Parameters<typeof buildCustomerActionCenter>[0]> = {}) {
  return buildCustomerActionCenter({ now: NOW, role, customerId: "c1", ...extra });
}

describe("record action center", () => {
  it("shows deposit and schedule as separate actions on a customer", () => {
    const model = customer("office", {
      now: NOW,
      role: "office",
      customerId: "cust-dan",
      depositOnFile: false,
      estimates: [{ id: "e1", status: "approved", approvedAt: "2026-09-21T12:00:00Z" }],
      jobs: [
        {
          id: "job-dan",
          title: "Living room",
          status: "unscheduled",
          hasMaterialNeed: false,
          createdAt: "2026-09-21T12:00:00Z",
        },
      ],
    });
    expect(model.primary).toMatchObject({ label: "Collect deposit", href: "/customers/cust-dan" });
    expect(model.secondary).toContainEqual({ label: "Schedule install", href: "/jobs/job-dan" });
    expect(model.also).toContain("does not hold");
    expect(model.blocker).toBeNull();
    expect(JSON.stringify(model)).not.toContain("before scheduling");
  });

  it("blocks schedule when material is not ready and still shows the deposit", () => {
    const model = customer("office", {
      now: NOW,
      role: "office",
      customerId: "c1",
      depositOnFile: false,
      estimates: [{ id: "e1", status: "approved" }],
      jobs: [
        {
          id: "job-1",
          title: "Living room carpet",
          status: "unscheduled",
          hasMaterialNeed: true,
          warehouseReadyAt: null,
        },
      ],
    });
    expect(model.blocker).toContain("Living room carpet");
    expect(model.primary).toMatchObject({ label: "Review material", href: "/jobs/job-1" });
    expect(model.secondary.map((row) => row.label)).toContain("Collect deposit");
    expect(JSON.stringify(model.primary) + JSON.stringify(model.secondary)).not.toContain("Schedule install");
  });

  it("names each job when a customer has more than one", () => {
    const model = customer("admin", {
      now: NOW,
      role: "admin",
      customerId: "c1",
      depositOnFile: true,
      jobs: [
        { id: "a", title: "Kitchen", status: "unscheduled", hasMaterialNeed: true, warehouseReadyAt: null },
        { id: "b", title: "Hall", status: "unscheduled", hasMaterialNeed: false },
      ],
    });
    expect(model.blocker).toContain("Kitchen");
    expect(model.secondary.map((row) => row.href)).toContain("/jobs/b");
  });

  it("says the customer is caught up when nothing is due", () => {
    const model = customer("office", {
      now: NOW,
      role: "office",
      customerId: "c1",
      depositOnFile: true,
      estimates: [{ id: "e", status: "declined" }],
      jobs: [],
    });
    expect(model.quiet).toBe("You're caught up on this customer.");
    expect(model.primary).toBeNull();
  });

  it("describes a draft estimate without inventing a send when it has no options", () => {
    const model = buildEstimateActionCenter({
      now: NOW,
      role: "salesman",
      estimateId: "e",
      customerId: "c",
      status: "draft",
      hasOptions: false,
    });
    expect(model.situation).toContain("Draft");
    expect(model.attention).toContain("priced option");
    expect(model.primary).toBeNull();
  });

  it("asks for follow-up after a sent estimate ages past the existing delay", () => {
    const model = buildEstimateActionCenter({
      now: NOW,
      role: "office",
      estimateId: "e",
      customerId: "c",
      status: "sent",
      sentAt: "2026-09-20T12:00:00Z",
    });
    expect(model.primary).toMatchObject({ label: "Follow up", href: "/customers/c" });
    expect(model.history[0]).toContain("Sep 20");
  });

  it("does not ask for follow-up the day an estimate is sent", () => {
    const model = buildEstimateActionCenter({
      now: NOW,
      role: "office",
      estimateId: "e",
      customerId: "c",
      status: "sent",
      sentAt: "2026-09-24T12:00:00Z",
    });
    expect(model.quiet).toBe("No follow-up is due yet.");
    expect(model.primary?.label).not.toBe("Follow up");
  });

  it("shows deposit on an approved estimate and schedule when the job can be booked", () => {
    const model = buildEstimateActionCenter({
      now: NOW,
      role: "office",
      estimateId: "e",
      customerId: "c",
      status: "approved",
      depositOnFile: false,
      linkedJob: { id: "j", title: "Living room", bookable: true },
    });
    expect(model.primary).toMatchObject({ label: "Collect deposit" });
    expect(model.secondary).toContainEqual({ label: "Schedule install", href: "/jobs/j" });
    expect(model.also).toContain("does not hold");
  });

  it("does not offer a new job when approval is stale", () => {
    const model = buildEstimateActionCenter({
      now: NOW,
      role: "admin",
      estimateId: "e",
      customerId: "c",
      status: "sent",
      approvalStale: true,
      linkedJob: { id: "j", title: "Living room" },
    });
    expect(model.blocker).toContain("approved again");
    expect(JSON.stringify(model)).not.toContain("Create job");
    expect(model.secondary).toContainEqual({ label: "Open job", href: "/jobs/j" });
  });

  it("points a converted estimate at the existing job", () => {
    const model = buildEstimateActionCenter({
      now: NOW,
      role: "office",
      estimateId: "e",
      customerId: "c",
      status: "approved",
      depositOnFile: true,
      linkedJob: { id: "j", title: "Living room", bookable: false },
    });
    expect(model.secondary.map((row) => row.href)).toContain("/jobs/j");
    expect(model.primary?.label).not.toBe("Schedule install");
  });

  it("schedules a job with no material lines", () => {
    const model = buildJobActionCenter({
      now: NOW,
      role: "scheduler",
      jobId: "j",
      title: "Hall",
      status: "unscheduled",
      hasMaterialNeed: false,
      ops: assessJobOperationalState({
        status: "unscheduled",
        scheduledDate: null,
        warehouseReadyAt: null,
        hasMaterialNeed: false,
        activeHold: null,
      }),
    });
    expect(model.primary).toMatchObject({ label: "Schedule install", href: "/jobs/j" });
    expect(model.blocker).toBeNull();
  });

  it("schedules when material is warehouse-ready", () => {
    const model = buildJobActionCenter({
      now: NOW,
      role: "office",
      jobId: "j",
      title: "Hall",
      status: "unscheduled",
      hasMaterialNeed: true,
      warehouseReadyAt: "2026-09-23T00:00:00Z",
      ops: null,
    });
    expect(model.situation).toContain("Ready to schedule");
    expect(model.primary?.label).toBe("Schedule install");
  });

  it("does not schedule when material is not ready", () => {
    const model = buildJobActionCenter({
      now: NOW,
      role: "office",
      jobId: "j",
      title: "Carpet",
      status: "unscheduled",
      hasMaterialNeed: true,
      warehouseReadyAt: null,
      ops: null,
    });
    expect(model.blocker).toContain("cannot be scheduled");
    expect(model.primary).toMatchObject({ label: "Review material" });
    expect(model.secondary).toEqual([]);
  });

  it("keeps a near-term install on the calendar and points at material", () => {
    const model = buildJobActionCenter({
      now: NOW,
      role: "scheduler",
      jobId: "j",
      title: "Carpet",
      status: "scheduled",
      scheduledDate: "2026-09-25",
      hasMaterialNeed: true,
      warehouseReadyAt: null,
      ops: null,
    });
    expect(model.blocker).toContain("already booked");
    expect(model.primary?.label).toBe("Review material");
    expect(JSON.stringify(model)).not.toContain("Schedule install");
  });

  it("says a healthy booked install is on track", () => {
    const model = buildJobActionCenter({
      now: NOW,
      role: "office",
      jobId: "j",
      title: "Hall",
      status: "scheduled",
      scheduledDate: "2026-10-03",
      hasMaterialNeed: true,
      warehouseReadyAt: "2026-09-23T00:00:00Z",
      ops: assessJobOperationalState({
        status: "scheduled",
        scheduledDate: "2026-10-03",
        warehouseReadyAt: "2026-09-23T00:00:00Z",
        hasMaterialNeed: true,
        activeHold: null,
      }),
    });
    expect(model.quiet).toBe("This job is on track.");
    expect(model.situation[0]).toContain("Oct 3");
    expect(model.primary).toBeNull();
  });

  it("treats an open balance on a finished job as separate from the install", () => {
    const model = buildJobActionCenter({
      now: NOW,
      role: "office",
      jobId: "j",
      title: "Hall",
      status: "completed",
      hasMaterialNeed: false,
      openBalance: 400,
      invoiceHref: "/invoices/inv",
      ops: null,
    });
    expect(model.primary).toMatchObject({ href: "/invoices/inv" });
    expect(model.blocker).toBeNull();
    expect(model.also).toContain("does not change");
  });

  it("sends an open callback to service", () => {
    const model = buildJobActionCenter({
      now: NOW,
      role: "office",
      jobId: "j",
      title: "Hall",
      status: "completed",
      hasMaterialNeed: false,
      hasOpenCallback: true,
      ops: null,
    });
    expect(model.primary).toMatchObject({ label: "Open service", href: "/service" });
  });

  it("does not claim a purchasing gap blocks the schedule write", () => {
    const ops = assessJobOperationalState({
      status: "unscheduled",
      scheduledDate: null,
      warehouseReadyAt: "2026-09-23T00:00:00Z",
      hasMaterialNeed: true,
      hasPurchasingGap: true,
      activeHold: null,
    });
    expect(ops.blockerCode).toBe("needs_purchasing");
    const model = buildJobActionCenter({
      now: NOW,
      role: "office",
      jobId: "j",
      title: "Hall",
      status: "unscheduled",
      hasMaterialNeed: true,
      warehouseReadyAt: "2026-09-23T00:00:00Z",
      ops,
    });
    expect(model.primary?.label).toBe("Schedule install");
    expect(model.also).toContain("coverage gap");
    expect(model.blocker).toBeNull();
  });

  it("hides deposit and invoice facts from a scheduler", () => {
    const model = customer("scheduler", {
      now: NOW,
      role: "scheduler",
      customerId: "c",
      depositOnFile: false,
      estimates: [{ id: "e", status: "approved" }],
      openInvoices: [{ id: "inv", number: "100", dueAt: "2026-09-01", label: "Balance $900" }],
      jobs: [{ id: "j", title: "Hall", status: "unscheduled", hasMaterialNeed: false }],
    });
    const text = JSON.stringify(model);
    expect(text).not.toContain("Deposit");
    expect(text).not.toContain("900");
    expect(text).not.toContain("/invoices/");
    expect(model.primary).toMatchObject({ label: "Schedule install" });
  });

  it("limits a salesman to the same deposit and schedule facts without another customer's data", () => {
    const model = customer("salesman", {
      now: NOW,
      role: "salesman",
      customerId: "mine",
      depositOnFile: false,
      estimates: [{ id: "e", status: "approved" }],
      jobs: [{ id: "j", title: "Mine", status: "unscheduled", hasMaterialNeed: false }],
    });
    expect(model.primary?.href).toBe("/customers/mine");
    expect(model.secondary[0]?.href).toBe("/jobs/j");
  });

  it("shows warehouse only a staging action", () => {
    const model = buildJobActionCenter({
      now: NOW,
      role: "warehouse",
      jobId: "j",
      title: "Hall",
      status: "scheduled",
      scheduledDate: "2026-09-25",
      hasMaterialNeed: true,
      openBalance: 500,
      ops: null,
    });
    expect(model.primary).toMatchObject({ href: "/warehouse" });
    expect(JSON.stringify(model)).not.toContain("500");
    expect(JSON.stringify(model)).not.toContain("Schedule install");
  });

  it("keeps crew off deposit details", () => {
    const model = buildJobActionCenter({
      now: NOW,
      role: "crew",
      jobId: "j",
      title: "Hall",
      status: "scheduled",
      scheduledDate: "2026-10-03",
      hasMaterialNeed: false,
      openBalance: 800,
      ops: null,
    });
    expect(JSON.stringify(model)).not.toContain("800");
    expect(model.quiet).toBe("This job is on track.");
  });

  it("does not invent a step for an unknown estimate or job status", () => {
    const estimate = buildEstimateActionCenter({
      now: NOW,
      role: "admin",
      estimateId: "e",
      customerId: "c",
      status: "archived",
    });
    const job = buildJobActionCenter({
      now: NOW,
      role: "admin",
      jobId: "j",
      title: null,
      status: "mystery",
      hasMaterialNeed: false,
      ops: null,
    });
    expect(estimate.primary).toBeNull();
    expect(estimate.quiet).toContain("not one");
    expect(job.primary).toBeNull();
  });

  it("drops a deposit follow-up task when the deposit action is already shown", () => {
    const model = customer("office", {
      now: NOW,
      role: "office",
      customerId: "c",
      depositOnFile: false,
      estimates: [{ id: "e", status: "approved" }],
      tasks: [
        { title: "Collect the deposit", dueAt: "2026-09-01T00:00:00Z", status: "open", sourceKey: "deposit_due:e" },
        { title: "Order samples", dueAt: "2026-09-01T00:00:00Z", status: "open", sourceKey: "manual:1" },
      ],
    });
    expect(model.secondary.filter((row) => row.label === "Open task")).toHaveLength(1);
  });

  it("leaves the customer portal redirect in place", () => {
    expect(readFileSync("src/app/(app)/layout.tsx", "utf8")).toContain('redirect("/portal")');
    const hidden = buildCustomerActionCenter({
      now: NOW,
      role: "customer",
      customerId: "c",
      depositOnFile: false,
      estimates: [{ id: "e", status: "approved" }],
    });
    expect(hidden.primary).toBeNull();
    expect(JSON.stringify(hidden)).not.toContain("Deposit");
  });

  it("ignores null dates instead of inventing history", () => {
    const model = buildEstimateActionCenter({
      now: NOW,
      role: "office",
      estimateId: "e",
      customerId: "c",
      status: "sent",
      sentAt: null,
    });
    expect(model.history).toEqual([]);
    expect(model.situation[0]).toBe("Sent to customer");
  });
});
