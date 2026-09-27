import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { homeCommandText, homeCommandsForRole } from "@/lib/home-command";

function ids(role: Parameters<typeof homeCommandsForRole>[0]) {
  return homeCommandsForRole(role).map((spec) => spec.id);
}

function href(role: Parameters<typeof homeCommandsForRole>[0], id: string) {
  return homeCommandsForRole(role).find((spec) => spec.id === id)?.href;
}

describe("home command board", () => {
  it("links a ready-to-schedule count to the filtered scheduler or jobs queue", () => {
    expect(href("scheduler", "ready")).toBe("/install-scheduler");
    expect(href("office", "ready")).toBe("/install-scheduler");
    expect(href("salesman", "ready")).toBe("/jobs?view=ready");
    expect(homeCommandText(7, homeCommandsForRole("office").find((s) => s.id === "ready")!)).toBe(
      "7 jobs ready to schedule",
    );
    expect(homeCommandText(1, homeCommandsForRole("office").find((s) => s.id === "ready")!)).toBe(
      "1 job ready to schedule",
    );
  });

  it("hides money queues from scheduler, warehouse, and crew", () => {
    for (const role of ["scheduler", "warehouse", "crew"] as const) {
      const specs = homeCommandsForRole(role);
      expect(specs.map((spec) => spec.id)).not.toContain("estimates");
      expect(specs.map((spec) => spec.id)).not.toContain("orders");
      for (const spec of specs) {
        expect(spec.href).not.toMatch(/invoice|payment|accounting|bills|deposit/i);
      }
    }
    expect(ids("warehouse")).toEqual(["warehouse"]);
    expect(ids("crew")).toEqual(["material", "today"]);
    expect(ids("scheduler")).not.toContain("warehouse");
    expect(href("warehouse", "warehouse")).toBe("/warehouse");
    expect(href("admin", "today")).toBe("/jobs?view=scheduled&day=today");
    expect(href("salesman", "estimates")).toBe("/estimates?view=followup");
    expect(href("salesman", "tasks")).toBe("/tasks?view=mine");
    expect(href("office", "tasks")).toBe("/tasks?view=open");
    expect(href("office", "orders")).toBe("/orders");
    expect(href("office", "followups")).toBe("/customers?stuck=1");
  });

  it("counts from queue totals and does not load deposits or invoices", () => {
    const loader = readFileSync("src/lib/data/home-center.ts", "utf8");
    expect(loader).toContain("p_limit: 1");
    expect(loader).toContain("estimate_queue_page");
    expect(loader).toContain("job_queue_page");
    expect(loader).not.toContain("customer_deposits");
    expect(loader).not.toContain("from(\"invoices\")");
    expect(loader).not.toContain("posting_enabled");
    expect(loader).not.toContain("journal");
    const page = readFileSync("src/app/(app)/jobs/[id]/page.tsx", "utf8");
    expect(page).not.toContain("RecordActionCenter");
    expect(page).toContain("includeFinancials: isStaff");
    expect(page).toContain("isStaff && job.customer_id");
  });
});
