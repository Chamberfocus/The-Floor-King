/**
 * Home action center. Presentation rules only — no ledger, inventory, or
 * schedule mutations.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildHomeCenter,
  homeSectionCount,
  type HomeSignals,
} from "@/lib/home-actions";
import type { UserRole } from "@/lib/types";

const NOW = new Date("2026-09-24T15:00:00Z");

function base(role: UserRole, extra: Partial<HomeSignals> = {}): HomeSignals {
  return {
    now: NOW,
    role,
    userId: "user-1",
    firstName: "Alex",
    ...extra,
  };
}

describe("Home action center", () => {
  it("greets by first name and stays quiet when nothing is due", () => {
    const center = buildHomeCenter(base("office"));
    expect(center.greeting).toBe("Good afternoon, Alex");
    expect(center.caughtUp).toBe(true);
    expect(center.sections).toEqual([]);
  });

  it("explains an overdue follow-up with the stage next action", () => {
    const center = buildHomeCenter(
      base("office", {
        followUps: [
          {
            id: "c1",
            name: "Jones",
            dueAt: "2026-09-21T12:00:00Z",
            nextAction: "Call about the estimate",
            ownerId: null,
          },
        ],
      }),
    );
    const item = center.sections.find((s) => s.id === "attention")?.items[0];
    expect(item).toMatchObject({
      title: "Stuck",
      why: "Call about the estimate",
      subject: "Jones",
      action: "Open customer",
      href: "/customers/c1",
      priority: "urgent",
    });
    expect(homeSectionCount(center, "attention")).toBe(1);
  });

  it("does not call a follow-up stuck when the stage has no next action", () => {
    const center = buildHomeCenter(
      base("admin", {
        followUps: [
          {
            id: "c2",
            name: "Lee",
            dueAt: "2026-09-23T12:00:00Z",
            nextAction: null,
            ownerId: null,
          },
        ],
      }),
    );
    expect(center.sections[0]?.items[0]?.title).toBe("Follow-up overdue");
    expect(center.sections[0]?.items[0]?.why).toBe("The follow-up date has passed.");
  });

  it("puts a follow-up due later today in Today, and next week in Coming up", () => {
    const center = buildHomeCenter(
      base("office", {
        followUps: [
          {
            id: "today",
            name: "Today",
            dueAt: "2026-09-24T20:00:00Z",
            nextAction: null,
            ownerId: null,
          },
          {
            id: "soon",
            name: "Soon",
            dueAt: "2026-09-28T15:00:00Z",
            nextAction: null,
            ownerId: null,
          },
        ],
      }),
    );
    expect(center.sections.find((s) => s.id === "today")?.items.map((i) => i.subject)).toEqual(["Today"]);
    expect(center.sections.find((s) => s.id === "upcoming")?.items.map((i) => i.subject)).toEqual(["Soon"]);
  });

  it("flags a sent estimate and a won deal that still needs a deposit", () => {
    const center = buildHomeCenter(
      base("salesman", {
        sentEstimates: [
          {
            id: "e1",
            name: "Jones",
            sentAt: "2026-09-20T15:00:00Z",
            totalLabel: "$6,840",
            ownerId: "user-1",
          },
        ],
        deposits: [
          {
            id: "e2",
            name: "Dan Nauman",
            approvedAt: "2026-09-22T15:00:00Z",
            amountLabel: "$2,450",
            ownerId: "user-1",
          },
        ],
      }),
    );
    const titles = center.sections.flatMap((s) => s.items.map((i) => i.title));
    expect(titles).toContain("Estimate follow-up");
    expect(titles).toContain("Deposit needed");
    expect(center.sections.flatMap((s) => s.items).find((i) => i.title === "Deposit needed")).toMatchObject({
      action: "Collect deposit",
      href: "/estimates/e2",
      priority: "urgent",
    });
  });

  it("does not show another salesperson's customers to a salesman", () => {
    const center = buildHomeCenter(
      base("salesman", {
        followUps: [
          {
            id: "other",
            name: "Not mine",
            dueAt: "2026-09-20T12:00:00Z",
            nextAction: "Call",
            ownerId: "someone-else",
          },
        ],
        sentEstimates: [
          {
            id: "e",
            name: "Other",
            sentAt: "2026-09-01T00:00:00Z",
            totalLabel: "$1",
            ownerId: "someone-else",
          },
        ],
      }),
    );
    expect(center.sections).toEqual([]);
  });

  it("classifies invoices by due date and ignores ones with no due date", () => {
    const center = buildHomeCenter(
      base("office", {
        invoices: [
          { id: "late", name: "Late", number: "100", dueAt: "2026-09-20", balanceLabel: "$400", ownerId: null },
          { id: "due", name: "Due", number: "101", dueAt: "2026-09-24", balanceLabel: "$50", ownerId: null },
          { id: "none", name: "Open", number: "102", dueAt: null, balanceLabel: "$9", ownerId: null },
        ],
      }),
    );
    expect(center.sections.find((s) => s.id === "attention")?.items[0]).toMatchObject({
      title: "Overdue invoice",
      href: "/invoices/late",
    });
    expect(center.sections.find((s) => s.id === "today")?.items.map((i) => i.href)).toEqual(["/invoices/due"]);
    expect(JSON.stringify(center)).not.toContain("invoices/none");
  });

  it("puts today's measure in Today and a healthy install in Today, not attention", () => {
    const center = buildHomeCenter(
      base("scheduler", {
        measures: [
          {
            id: "m1",
            name: "Brown",
            startsAt: "2026-09-24T14:30:00Z",
            ownerName: "Fred Kalial",
            href: "/calendar",
          },
        ],
        installs: [
          {
            id: "j1",
            name: "Smith",
            scheduledDate: "2026-09-24",
            assigneeId: "crew-1",
            customerOwnerId: null,
            warehouseReadyAt: "2026-09-23T00:00:00Z",
            hasMaterialNeed: true,
            href: "/jobs/j1",
          },
        ],
      }),
    );
    const today = center.sections.find((s) => s.id === "today");
    expect(today?.items.map((i) => i.title)).toEqual(["Measure today", "Install today"]);
    expect(today?.items[0]).toMatchObject({ subject: "Brown", owner: "Fred Kalial", action: "Open measure" });
    expect(center.sections.find((s) => s.id === "attention")).toBeUndefined();
    expect(homeSectionCount(center, "today")).toBe(today?.items.length);
  });

  it("flags an install within two days when materials are not warehouse-ready", () => {
    const center = buildHomeCenter(
      base("office", {
        installs: [
          {
            id: "j2",
            name: "Smith",
            scheduledDate: "2026-09-25",
            assigneeId: null,
            customerOwnerId: null,
            warehouseReadyAt: null,
            hasMaterialNeed: true,
            href: "/jobs/j2",
          },
        ],
      }),
    );
    expect(center.sections.find((s) => s.id === "attention")?.items[0]).toMatchObject({
      title: "Material not ready",
      priority: "urgent",
      action: "Review material",
      href: "/jobs/j2",
    });
  });

  it("offers a ready unscheduled job to the scheduler and not to the warehouse", () => {
    const row = {
      id: "j3",
      name: "Ready",
      assigneeId: null,
      customerOwnerId: null,
      hasMaterialNeed: false,
      warehouseReadyAt: null,
      href: "/jobs/j3",
    };
    const scheduler = buildHomeCenter(base("scheduler", { unscheduled: [row] }));
    expect(scheduler.sections[0]?.items[0]).toMatchObject({
      title: "Ready to schedule",
      href: "/install-scheduler",
    });
    const warehouse = buildHomeCenter(base("warehouse", { unscheduled: [row] }));
    expect(warehouse.sections.flatMap((s) => s.items).map((i) => i.title)).not.toContain("Ready to schedule");
  });

  it("keeps crew on their assigned install and off sales and money", () => {
    const center = buildHomeCenter(
      base("crew", {
        followUps: [
          { id: "c", name: "Secret", dueAt: "2026-09-01T00:00:00Z", nextAction: "Call", ownerId: null },
        ],
        invoices: [
          { id: "i", name: "Bill", number: "1", dueAt: "2026-09-01", balanceLabel: "$1", ownerId: null },
        ],
        installs: [
          {
            id: "mine",
            name: "My job",
            scheduledDate: "2026-09-24",
            assigneeId: "user-1",
            customerOwnerId: null,
            warehouseReadyAt: "2026-09-20T00:00:00Z",
            hasMaterialNeed: true,
            href: "/jobs/mine",
          },
          {
            id: "other",
            name: "Other job",
            scheduledDate: "2026-09-24",
            assigneeId: "crew-2",
            customerOwnerId: null,
            warehouseReadyAt: null,
            hasMaterialNeed: true,
            href: "/jobs/other",
          },
        ],
      }),
    );
    expect(center.sections.flatMap((s) => s.items)).toEqual([
      expect.objectContaining({ title: "Install today", subject: "My job", href: "/jobs/mine" }),
    ]);
  });

  it("shows warehouse staging without a sales or invoice link", () => {
    const center = buildHomeCenter(
      base("warehouse", {
        invoices: [
          { id: "i", name: "Bill", number: "1", dueAt: "2026-09-01", balanceLabel: "$1", ownerId: null },
        ],
        sentEstimates: [
          { id: "e", name: "Est", sentAt: "2026-09-01T00:00:00Z", totalLabel: "$1", ownerId: null },
        ],
        installs: [
          {
            id: "j",
            name: "Smith",
            scheduledDate: "2026-09-24",
            assigneeId: null,
            customerOwnerId: null,
            warehouseReadyAt: null,
            hasMaterialNeed: true,
            href: "/jobs/j",
          },
        ],
      }),
    );
    const items = center.sections.flatMap((s) => s.items);
    expect(items).toEqual([
      expect.objectContaining({ title: "Staging needed", href: "/warehouse", subject: "Smith" }),
    ]);
  });

  it("puts an open callback in Needs attention and uses the task overdue helper", () => {
    const center = buildHomeCenter(
      base("office", {
        callbacks: [{ id: "s1", name: "Johnson", followUpAt: "2026-09-22T12:00:00Z", href: "/service" }],
        tasks: [
          { id: "t1", title: "Order samples", dueAt: "2026-09-22T12:00:00Z", status: "open", href: "/customers/c" },
          { id: "t2", title: "Later", dueAt: "2026-10-20T12:00:00Z", status: "open", href: "/customers/c" },
        ],
      }),
    );
    expect(center.sections.find((s) => s.id === "attention")?.items.map((i) => i.title)).toEqual([
      "Service issue",
      "Task overdue",
    ]);
    expect(center.sections.find((s) => s.id === "mine")).toBeUndefined();
  });

  it("keeps the section count equal to the rows on screen", () => {
    const center = buildHomeCenter(
      base("admin", {
        measures: [
          { id: "m", name: "A", startsAt: "2026-09-24T10:00:00Z", ownerName: null, href: "/calendar" },
        ],
      }),
    );
    for (const section of center.sections) {
      expect(homeSectionCount(center, section.id)).toBe(section.items.length);
    }
  });

  it("does not import accounting or change the customer portal redirect", () => {
    const page = readFileSync("src/app/(app)/home/page.tsx", "utf8");
    const view = readFileSync("src/components/home-center-view.tsx", "utf8");
    const lib = readFileSync("src/lib/home-actions.ts", "utf8");
    const loader = readFileSync("src/lib/data/home-center.ts", "utf8");
    for (const src of [page, view, lib, loader]) {
      expect(src).not.toContain("posting_enabled");
      expect(src).not.toContain("journal");
    }
    expect(readFileSync("src/app/(app)/layout.tsx", "utf8")).toContain('redirect("/portal")');
    expect(view).toContain("aria-labelledby");
    expect(view).toContain("min-h-11");
    expect(view).not.toContain("<table");
  });
});
