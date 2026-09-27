/**
 * Phase L: searches past the old 200-row merge, scheduler payloads, and the
 * calendar window. Database functions do the real paging; these fixtures prove
 * a later row is still on the right page.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readQueuePage } from "@/lib/data/queue-rpc";
import { assessMaterialsReadyForSchedule } from "@/lib/materials-ready";
import { jobHasMaterialNeed, jobQueueIncludes, QUEUE_LIST_UNAVAILABLE, recordsOnPage } from "@/lib/ops-scale";
import { calendarWindow, installOverlapsWindow, SCHEDULER_CALENDAR_MAX_DAYS } from "@/lib/scheduler-window";
import { WORK_QUEUE_PAGE_SIZE } from "@/lib/work-queues";

const root = process.cwd();
const src = (path: string) => readFileSync(join(root, path), "utf8");

function fnBody(file: string, name: string) {
  const text = src(file);
  const start = text.indexOf(`export async function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const next = text.indexOf("\nexport ", start + 10);
  return text.slice(start, next === -1 ? undefined : next);
}

describe("operational search pages past row 200", () => {
  const rows = Array.from({ length: 260 }, (_, i) => ({
    id: `row-${i}`,
    name: i === 250 ? "Later Oak Customer" : `Oak Customer ${i}`,
  }));

  it("keeps a match on a later page and counts every match", () => {
    const matches = rows.filter((row) => row.name.includes("Oak"));
    expect(matches.length).toBe(260);
    expect(matches.length).toBeGreaterThan(200);
    expect(recordsOnPage(matches, 1)).toHaveLength(WORK_QUEUE_PAGE_SIZE);
    expect(recordsOnPage(matches, 1).map((row) => row.id)).not.toContain("row-250");
    expect(recordsOnPage(matches, 7).map((row) => row.id)).toContain("row-250");
    const last = recordsOnPage(matches, 7);
    expect(last).toHaveLength(260 - 6 * WORK_QUEUE_PAGE_SIZE);
  });

  it("asks the database for estimate, order, purchase order, service, task, and invoice search", () => {
    const estimates = fnBody("src/lib/data/estimates.ts", "listEstimatesQueue");
    const orders = fnBody("src/lib/data/orders.ts", "listOrdersQueue");
    const pos = fnBody("src/lib/data/purchase-orders.ts", "listPurchaseOrdersQueue");
    const service = fnBody("src/lib/data/ops-glue.ts", "listServiceQueue");
    const tasks = fnBody("src/lib/data/ops-glue.ts", "listTaskQueue");
    const invoices = fnBody("src/lib/data/invoices.ts", "listInvoicesQueue");
    expect(estimates).toContain("estimate_queue_page");
    expect(orders).toContain("order_queue_page");
    expect(pos).toContain("po_queue_page");
    expect(service).toContain("service_queue_page");
    expect(tasks).toContain("task_queue_page");
    expect(invoices).toContain("invoice_queue_page");
    expect(invoices).toContain("invoice_overdue_page");
    for (const body of [estimates, orders, pos, service, tasks]) {
      expect(body).not.toContain(".limit(200)");
      expect(body).not.toContain("const cap = 200");
    }
    expect(invoices).not.toContain(".limit(200)");
    const sql = src("supabase/migrations/0479_ops_search_page.sql");
    expect(sql).toContain("e.status::text");
    expect(sql).toContain("po.status::text");
    expect(sql).toContain("i.status::text");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("t.assigned_to = p_user");
    expect(sql).toContain("purchase_orders_queue_idx");
    expect(sql).not.toMatch(/\binsert into\b/i);
    expect(sql).not.toContain("accounting_enabled");
    expect(sql).not.toContain("schedule_job_install_safe");
    expect(sql).not.toMatch(/deposit/i);
  });

  it("fails closed when a queue function is missing", async () => {
    await expect(
      readQueuePage(
        {
          rpc: async () => ({
            data: null,
            error: { message: "function public.estimate_queue_page(text) does not exist" },
          }),
        },
        "estimate_queue_page",
        {},
      ),
    ).rejects.toThrow(QUEUE_LIST_UNAVAILABLE);
  });
});

describe("scheduler page does not load a full job per row", () => {
  it("batches scheduling-safe columns and bounds the calendar", () => {
    const page = src("src/app/(app)/install-scheduler/page.tsx");
    expect(page).toContain("buildSchedulerInstallProps");
    expect(page).not.toContain("buildInstallScheduleProps");
    expect(page).not.toContain("getJob");
    expect(page).toContain('.lte("scheduled_date", window.end)');
    expect(page).toContain("calendarWindow");
    const batch = fnBody("src/lib/data/install-schedule.ts", "buildSchedulerInstallProps");
    expect(batch).not.toContain("getJob(");
    expect(batch).toContain("SCHEDULER_JOB_COLUMNS");
    expect(batch).toContain("loadInstallerOutlook");
    const file = src("src/lib/data/install-schedule.ts");
    const columns = file.slice(file.indexOf("const SCHEDULER_LINE_COLUMNS"), file.indexOf("const SCHEDULER_JOB_COLUMNS") + 400);
    for (const money of [
      "material_rate",
      "labor_rate",
      "installed_rate",
      "flat_amount",
      "material_cost",
      "labor_cost",
      "margin",
      "deposit",
      "balance",
      "invoice",
    ]) {
      expect(columns.toLowerCase()).not.toContain(money);
    }
    const jobs = src("src/lib/data/jobs.ts");
    const board = jobs.slice(jobs.indexOf("WAREHOUSE_BOARD_COLUMNS"), jobs.indexOf("SCHEDULER_LIST_COLUMNS"));
    expect(board).not.toContain("estimated_material_cost");
    expect(board).not.toContain("installer_collects_balance");
  });

  it("shows only installs that overlap the visible range", () => {
    const now = new Date(2026, 8, 26);
    const week = calendarWindow(undefined, undefined, now);
    expect(week.span).toBe(7);
    expect(week.start <= "2026-09-26" && week.end >= "2026-09-26").toBe(true);
    expect(calendarWindow("2026-01-04", "400").span).toBe(SCHEDULER_CALENDAR_MAX_DAYS);
    expect(installOverlapsWindow("2026-09-20", "2026-09-22", week.start, week.end)).toBe(true);
    expect(installOverlapsWindow("2025-01-01", "2025-01-03", week.start, week.end)).toBe(false);
    expect(installOverlapsWindow("2027-06-01", null, week.start, week.end)).toBe(false);
    expect(installOverlapsWindow(week.start, null, week.start, week.end)).toBe(true);
  });
});

describe("material readiness stays the scheduling gate", () => {
  it("allows labor-only jobs, blocks material jobs until the warehouse is ready, and ignores a purchase order", () => {
    expect(assessMaterialsReadyForSchedule({ warehouseReadyAt: null, hasMaterialNeed: false }).ready).toBe(true);
    expect(assessMaterialsReadyForSchedule({ warehouseReadyAt: null, hasMaterialNeed: true }).ready).toBe(false);
    expect(assessMaterialsReadyForSchedule({ warehouseReadyAt: "2026-09-01", hasMaterialNeed: true }).ready).toBe(true);
    expect(jobHasMaterialNeed([])).toBe(false);
    expect(jobHasMaterialNeed([{ category: "labor" }])).toBe(false);
    expect(jobQueueIncludes({ id: "po-only", status: "unscheduled", hasMaterialNeed: false, purchaseOrders: [{ status: "ordered" }] }, "ready")).toBe(true);
    expect(jobQueueIncludes({ id: "po-only", status: "unscheduled", hasMaterialNeed: false, purchaseOrders: [{ status: "ordered" }] }, "material")).toBe(false);
    const ready = src("src/lib/materials-ready.ts");
    expect(ready).not.toMatch(/deposit|purchasing|purchase_orders/i);
    const actions = src("src/app/(app)/jobs/actions.ts");
    expect(actions).toContain("schedule_job_install_safe");
    expect(src("src/lib/data/install-schedule.ts")).not.toContain("schedule_job_install_safe");
  });
});
