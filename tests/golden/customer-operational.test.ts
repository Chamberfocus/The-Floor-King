/**
 * Archive is customers.cancelled_at. Active operational queues read that flag.
 * They do not require a second write that rewrites the job.
 * Completed history and the All list stay available.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activeOperationalQueueExcludesArchivedCustomer,
  customerIsArchived,
  showOnActiveInstallCalendar,
} from "@/lib/customer-operational";
import {
  jobQueueIncludes,
  schedulerQueueIncludes,
  warehouseSectionIncludes,
  type ScaleJob,
} from "@/lib/ops-scale";

const root = process.cwd();
const src = (path: string) => readFileSync(join(root, path), "utf8");

const readyJob: ScaleJob = {
  id: "job-1",
  status: "unscheduled",
  scheduledDate: null,
  hasMaterialNeed: false,
  warehouseReadyAt: null,
};

describe("archived customer operational stop", () => {
  it("treats cancelled_at as the archive flag", () => {
    expect(customerIsArchived(null)).toBe(false);
    expect(customerIsArchived(undefined)).toBe(false);
    expect(customerIsArchived("")).toBe(false);
    expect(customerIsArchived("2026-10-05T12:00:00Z")).toBe(true);
  });

  it("keeps an active customer's ready install in Needs a date", () => {
    expect(jobQueueIncludes(readyJob, "ready")).toBe(true);
    expect(schedulerQueueIncludes(readyJob, "ready")).toBe(true);
  });

  it("drops an archived customer's unscheduled install from Needs a date", () => {
    const archived = { ...readyJob, customerCancelledAt: "2026-10-05T12:00:00Z" };
    expect(jobQueueIncludes(archived, "ready")).toBe(false);
    expect(schedulerQueueIncludes(archived, "ready")).toBe(false);
    expect(jobQueueIncludes(archived, "material")).toBe(false);
    expect(schedulerQueueIncludes(
      { ...archived, status: "scheduled", scheduledDate: "2026-10-06" },
      "booked",
    )).toBe(false);
  });

  it("drops archived customers from the warehouse queue and keeps a live job", () => {
    expect(warehouseSectionIncludes(
      { status: "unscheduled", warehouseStatus: null, customerCancelledAt: "2026-10-05T12:00:00Z" },
      "active",
    )).toBe(false);
    expect(warehouseSectionIncludes(
      { status: "unscheduled", warehouseStatus: null },
      "active",
    )).toBe(true);
  });

  it("hides archived and cancelled installs from the active calendar and keeps a completed day", () => {
    expect(showOnActiveInstallCalendar({
      status: "scheduled",
      customerCancelledAt: "2026-10-05T12:00:00Z",
    })).toBe(false);
    expect(showOnActiveInstallCalendar({
      status: "cancelled",
      customerCancelledAt: null,
    })).toBe(false);
    expect(showOnActiveInstallCalendar({
      status: "completed",
      customerCancelledAt: null,
    })).toBe(true);
    expect(showOnActiveInstallCalendar({
      status: "scheduled",
      customerCancelledAt: null,
    })).toBe(true);
  });

  it("names the queues that must exclude an archived customer", () => {
    expect(activeOperationalQueueExcludesArchivedCustomer("scheduler_ready")).toBe(true);
    expect(activeOperationalQueueExcludesArchivedCustomer("ready")).toBe(true);
    expect(activeOperationalQueueExcludesArchivedCustomer("completed")).toBe(false);
    expect(activeOperationalQueueExcludesArchivedCustomer("all")).toBe(false);
  });

  it("teaches job_queue_page to skip archived customers on active queues only", () => {
    const sql = src("supabase/migrations/0483_archived_customer_active_queues.sql");
    expect(sql).toContain("scheduler_ready");
    expect(sql).toContain("p_queue in ('completed', 'all')");
    expect((sql.match(/c\.cancelled_at is null/g) ?? []).length).toBe(2);
    expect(sql).toContain("Does not enable accounting");
    expect(sql).not.toContain("update public.jobs");
    expect(sql).not.toContain("update public.invoices");
  });

  it("refreshes the install scheduler when a customer is archived", () => {
    const action = src("src/app/(app)/customer-records/actions.ts");
    expect(action).toContain('revalidatePath("/install-scheduler")');
    expect(action).toContain("cancelled_at: new Date().toISOString()");
    const scheduler = src("src/app/(app)/install-scheduler/page.tsx");
    expect(scheduler).toContain("showOnActiveInstallCalendar");
    expect(scheduler).toContain("cancelled_at");
    const jobs = src("src/lib/data/jobs.ts");
    expect(jobs).toContain('.is("customer.cancelled_at", null)');
  });
});
