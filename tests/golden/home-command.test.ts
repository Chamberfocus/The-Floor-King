import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  homeCommandText,
  homeCommandsForRole,
  homeEstimateCountArgs,
  homeJobQueueArgs,
  homeTaskCountArgs,
  homeTodayScope,
} from "@/lib/home-command";
import { installerAssignmentOrFilter } from "@/lib/installer-assignment";

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
    expect(loader).toContain("createClient");
    expect(loader).not.toContain("createAdminClient");
    expect(loader).not.toContain("customer_deposits");
    expect(loader).not.toContain("from(\"invoices\")");
    expect(loader).not.toContain("posting_enabled");
    expect(loader).not.toContain("journal");
    for (const word of ["balance", "margin", "payment", "accounting"]) {
      expect(loader.toLowerCase()).not.toContain(word);
    }
    const page = readFileSync("src/app/(app)/jobs/[id]/page.tsx", "utf8");
    expect(page).not.toContain("RecordActionCenter");
    expect(page).toContain("includeFinancials: isStaff");
    expect(page).toContain("isStaff && job.customer_id");
  });

  it("keeps crew home counts on that user's assignments", () => {
    const material = homeJobQueueArgs({
      role: "crew",
      userId: "user-1",
      queue: "material",
      crewIds: ["crew-a", ""],
    });
    expect(material).toMatchObject({
      p_queue: "material",
      p_mine: null,
      p_assigned: "user-1",
      p_crew_ids: ["crew-a"],
      p_keep_pickup: false,
    });
    const directOnly = homeJobQueueArgs({
      role: "crew",
      userId: "user-1",
      queue: "material",
      crewIds: [],
    });
    expect(directOnly.p_assigned).toBe("user-1");
    expect(directOnly.p_crew_ids).toBeNull();
    expect(homeTodayScope("crew", "user-1")).toEqual({ assignedTo: "user-1" });
    expect(installerAssignmentOrFilter("user-1", ["crew-a"])).toBe(
      "assigned_to.eq.user-1,assigned_crew_id.in.(crew-a)",
    );
    expect(installerAssignmentOrFilter("user-1", [])).toBe("assigned_to.eq.user-1");
    expect(installerAssignmentOrFilter("user-1", ["crew-a"])).not.toContain("open_for_claim");
    expect(() => homeJobQueueArgs({ role: "crew", userId: "", queue: "material" })).toThrow(
      /signed-in user/,
    );
    expect(() =>
      homeJobQueueArgs({ role: "crew", userId: "user-1", queue: "warehouse_active" }),
    ).toThrow(/Warehouse prep/);

    const jobs = readFileSync("src/lib/data/jobs.ts", "utf8");
    const start = jobs.indexOf("async function jobsOnDateBase");
    const end = jobs.indexOf("export async function listJobsOnDate");
    const body = jobs.slice(start, end);
    expect(body).toContain("await createClient()");
    expect(body).not.toContain("createAdminClient");
    expect(body).toContain("installerAssignmentOrFilter");
    expect(body).toContain('.eq("active", true)');

    const rpc = readFileSync("supabase/migrations/0478_ops_queue_scale.sql", "utf8");
    expect(rpc).toContain("or j.assigned_to = p_assigned");
    expect(rpc).toContain("j.assigned_crew_id = any (p_crew_ids)");
    expect(rpc).toContain("security invoker");
  });

  it("counts warehouse prep as a total only, and keeps a salesman on their own book", () => {
    expect(
      homeJobQueueArgs({ role: "warehouse", userId: "wh-1", queue: "warehouse_active" }),
    ).toEqual({
      p_queue: "warehouse_active",
      p_search: null,
      p_phone_like: null,
      p_digits: null,
      p_mine: null,
      p_assigned: null,
      p_crew_ids: null,
      p_keep_pickup: true,
    });
    for (const role of ["scheduler", "crew", "warehouse"] as const) {
      expect(() => homeEstimateCountArgs(role, "u", "2026-01-01")).toThrow(/Estimate follow-up/);
    }
    for (const role of ["scheduler", "crew", "salesman"] as const) {
      expect(() =>
        homeJobQueueArgs({ role, userId: "u", queue: "warehouse_active" }),
      ).toThrow(/Warehouse prep/);
    }
    expect(homeJobQueueArgs({ role: "salesman", userId: "rep-1", queue: "ready" })).toMatchObject({
      p_mine: "rep-1",
      p_assigned: null,
    });
    expect(homeTodayScope("salesman", "rep-1")).toEqual({ mineFor: "rep-1" });
    expect(homeEstimateCountArgs("salesman", "rep-1", "2026-01-01").p_mine).toBe("rep-1");
    expect(homeTaskCountArgs("salesman", "rep-1", "2026-01-01").p_see_all).toBe(false);
    expect(homeTaskCountArgs("office", "off-1", "2026-01-01").p_see_all).toBe(true);
    expect(homeTodayScope("scheduler", "sch-1")).toEqual({});
    expect(() => homeTaskCountArgs("warehouse", "wh-1", "2026-01-01")).toThrow(/Tasks/);
    expect(() => homeTaskCountArgs("crew", "user-1", "2026-01-01")).toThrow(/Tasks/);
    expect(() => homeTaskCountArgs("scheduler", "sch-1", "2026-01-01")).toThrow(/Tasks/);
  });
});
