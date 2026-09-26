import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { flooringJobSnapshot } from "@/lib/job-snapshot";
import { phoneSearchPattern, searchTypesForRole } from "@/lib/search-query";
import { quickCreateForRole } from "@/lib/nav";
import {
  ESTIMATE_CHANGED_AFTER_APPROVAL_MESSAGE,
  INVOICE_REQUIRES_APPROVAL_SNAPSHOT_MESSAGE,
} from "@/lib/estimate-approval";

const base = {
  status: "unscheduled",
  todayYmd: "2026-09-25",
  hasMaterialNeed: false,
  warehouseReadyAt: null as string | null,
};

describe("flooring job snapshot", () => {
  it("lets a labor-only job read as ready to schedule even when a purchase order exists", () => {
    const snap = flooringJobSnapshot({
      ...base,
      purchaseOrders: [{ status: "ordered" }],
    });
    expect(snap.chips).toEqual(["Ready to schedule"]);
    expect(snap.chips.join(" ")).not.toMatch(/ordered|waiting/i);
    expect(snap.fact).not.toMatch(/schedule the install/i);
  });

  it("says material is not ready in plain language", () => {
    const snap = flooringJobSnapshot({
      ...base,
      hasMaterialNeed: true,
    });
    expect(snap.chips).toContain("Waiting for material");
    expect(snap.fact).toBe("Material isn't ready yet.");
    expect(snap.chips).not.toContain("Ready to schedule");
  });

  it("marks ordered material without calling it received", () => {
    const snap = flooringJobSnapshot({
      ...base,
      hasMaterialNeed: true,
      purchaseOrders: [{ status: "ordered" }],
    });
    expect(snap.chips).toContain("Material ordered");
    expect(snap.chips).not.toContain("Material received");
  });

  it("shows material received and ready to schedule from warehouse ready", () => {
    const snap = flooringJobSnapshot({
      ...base,
      hasMaterialNeed: true,
      warehouseReadyAt: "2026-09-24T12:00:00Z",
    });
    expect(snap.chips).toEqual(["Material received", "Ready to schedule"]);
  });

  it("says the install is today, booked, complete, or needs service", () => {
    expect(
      flooringJobSnapshot({
        ...base,
        status: "scheduled",
        scheduledDate: "2026-09-25",
      }).chips,
    ).toContain("Installing today");
    expect(
      flooringJobSnapshot({
        ...base,
        status: "scheduled",
        scheduledDate: "2026-09-28",
      }).chips,
    ).toContain("Install booked");
    const done = flooringJobSnapshot({
      ...base,
      status: "completed",
      hasOpenServiceCallback: true,
      openBalance: 40,
    });
    expect(done.chips).toEqual(["Install complete", "Service needed", "Balance due"]);
    expect(
      flooringJobSnapshot({ ...base, status: "completed", openBalance: null }).chips,
    ).not.toContain("Balance due");
  });

  it("does not invent a next-action button", () => {
    const src = readFileSync("src/app/(app)/jobs/[id]/job-attention-strip.tsx", "utf8");
    expect(src).not.toContain("Next action");
    expect(src).toContain("Job snapshot");
  });
});

describe("search and quick add", () => {
  it("hides money and customer files from crew and warehouse", () => {
    expect(searchTypesForRole("crew")).toEqual(["job"]);
    expect(searchTypesForRole("warehouse")).toEqual(["job", "product"]);
    expect(searchTypesForRole("scheduler")).not.toContain("invoice");
    expect(searchTypesForRole("scheduler")).not.toContain("order");
    expect(searchTypesForRole("office")).toEqual([
      "customer",
      "estimate",
      "job",
      "order",
      "invoice",
      "po",
      "product",
    ]);
    expect(searchTypesForRole("customer")).toEqual([]);
  });

  it("matches a formatted phone from digits", () => {
    expect(phoneSearchPattern("(216) 555-0100")).toBe("%216%555%0100%");
    expect(phoneSearchPattern("2165550100")).toBe("%216%555%0100%");
    expect(phoneSearchPattern("Smith")).toBeNull();
  });

  it("adds a task shortcut only where the dashboard already exists", () => {
    expect(quickCreateForRole("office").map((action) => action.href)).toContain("/dashboard");
    expect(quickCreateForRole("salesman").map((action) => action.id)).not.toContain("task");
    expect(quickCreateForRole("warehouse")).toEqual([]);
  });
});

describe("employee language", () => {
  it("does not ask the employee to apply a migration", () => {
    expect(ESTIMATE_CHANGED_AFTER_APPROVAL_MESSAGE).toMatch(/customer approval is needed again/i);
    expect(INVOICE_REQUIRES_APPROVAL_SNAPSHOT_MESSAGE).not.toMatch(/snapshot|migration/i);
    const po = readFileSync("src/app/(app)/purchase-orders/actions.ts", "utf8");
    expect(po).not.toContain("apply migration");
    expect(po).toContain("We couldn't cancel that purchase order. Try again.");
  });
});
