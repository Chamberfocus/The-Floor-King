/**
 * High-volume queue membership. Datasets are larger than the old 200-row cap.
 * The database functions page the real lists; these fixtures prove a later
 * record is still a match, and the app calls those functions instead of
 * loading the table.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  customerSearchMatches,
  invoiceIsOverdue,
  jobHasMaterialNeed,
  jobQueueIncludes,
  recordsOnPage,
  schedulerQueueIncludes,
  warehouseSectionIncludes,
  type ScaleCustomer,
  type ScaleInvoice,
  type ScaleJob,
} from "@/lib/ops-scale";
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

const TODAY = "2026-09-26";

describe("customer search stays complete past 200 matches", () => {
  const customers: ScaleCustomer[] = Array.from({ length: 250 }, (_, i) => ({
    id: `c${i}`,
    fullName: `Match Person ${i}`,
    phone: i === 240 ? "(216) 555-1212" : "440-000-0000",
    email: `p${i}@example.com`,
    street: i === 240 ? "100 Later Ave" : "1 Main",
  }));

  it("finds a match on a later page", () => {
    const matches = customers.filter((row) => customerSearchMatches(row, "Match Person"));
    expect(matches.length).toBeGreaterThan(200);
    const later = recordsOnPage(matches, 7);
    expect(later.map((row) => row.id)).toContain("c240");
    expect(recordsOnPage(matches, 1).map((row) => row.id)).not.toContain("c240");
  });

  it("matches a phone stored with punctuation", () => {
    const row = customers.find((c) => c.id === "c240")!;
    expect(customerSearchMatches(row, "216-555-1212")).toBe(true);
    expect(customerSearchMatches(row, "(216) 555-1212")).toBe(true);
    expect(customerSearchMatches(row, "216 555 1212")).toBe(true);
    expect(customerSearchMatches(row, "2165551212")).toBe(true);
    expect(customerSearchMatches(customers[0], "2165551212")).toBe(false);
  });

  it("pages customer search in the database and keeps the user client", () => {
    const body = fnBody("src/lib/data/customers.ts", "listCustomersPage");
    expect(body).toContain("customer_queue_page");
    expect(body).not.toContain("listCustomers(");
    expect(body).not.toContain("createAdminClient");
    const sql = src("supabase/migrations/0478_ops_queue_scale.sql");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g')");
  });
});

describe("job queues include records past the old cap", () => {
  const jobs: ScaleJob[] = Array.from({ length: 250 }, (_, i) => ({
    id: `j${i}`,
    status: "unscheduled",
    scheduledDate: null,
    warehouseReadyAt: null,
    hasMaterialNeed: true,
    serviceOpen: false,
  }));
  jobs[210] = {
    id: "labor-only",
    status: "unscheduled",
    hasMaterialNeed: false,
    purchaseOrders: [{ status: "ordered" }],
  };
  jobs[215] = {
    id: "labor-po",
    status: "unscheduled",
    hasMaterialNeed: false,
    purchaseOrders: [{ status: "sent" }],
  };
  jobs[220] = {
    id: "ready-late",
    status: "unscheduled",
    hasMaterialNeed: false,
  };
  jobs[230] = {
    id: "service-late",
    status: "scheduled",
    scheduledDate: "2026-10-01",
    hasMaterialNeed: true,
    warehouseReadyAt: null,
    serviceOpen: true,
  };
  jobs[231] = {
    id: "service-done",
    status: "scheduled",
    hasMaterialNeed: false,
    serviceOpen: false,
  };

  it("keeps needs-material and ready jobs beyond record 200", () => {
    const material = jobs.filter((job) => jobQueueIncludes(job, "material"));
    expect(material.length).toBeGreaterThan(200);
    expect(recordsOnPage(material, 6).map((job) => job.id)).toContain("j205");
    expect(material.map((job) => job.id)).not.toContain("labor-only");
    expect(material.map((job) => job.id)).not.toContain("labor-po");

    const ready = jobs.filter((job) => jobQueueIncludes(job, "ready"));
    expect(ready.map((job) => job.id)).toEqual(
      expect.arrayContaining(["labor-only", "labor-po", "ready-late"]),
    );
    expect(ready.map((job) => job.id)).not.toContain("j0");
    expect(ready.map((job) => job.id)).not.toContain("service-late");
  });

  it("treats a labor-only job as schedulable even when a purchase order exists", () => {
    expect(jobHasMaterialNeed([])).toBe(false);
    expect(jobHasMaterialNeed([{ category: "labor" }])).toBe(false);
    expect(jobHasMaterialNeed([{ category: "carpet" }])).toBe(true);
    expect(jobQueueIncludes(jobs[210], "ready")).toBe(true);
    expect(jobQueueIncludes(jobs[215], "ready")).toBe(true);
    expect(jobQueueIncludes(jobs[210], "material")).toBe(false);
  });

  it("keeps an unresolved service job past record 200 and drops resolved ones", () => {
    const service = jobs.filter((job) => jobQueueIncludes(job, "service"));
    expect(service.map((job) => job.id)).toContain("service-late");
    expect(service.map((job) => job.id)).not.toContain("service-done");
    expect(jobs.findIndex((job) => job.id === "service-late")).toBeGreaterThan(200);
  });

  it("asks the database for the job page", () => {
    const body = fnBody("src/lib/data/jobs.ts", "listJobsQueue");
    expect(body).toContain("job_queue_page");
    expect(body).not.toContain(".limit(");
    const sql = src("supabase/migrations/0478_ops_queue_scale.sql");
    const materialFn = sql.slice(sql.indexOf("function public.job_has_material_need"));
    expect(materialFn.slice(0, 800)).not.toContain("purchase_orders");
    expect(materialFn.slice(0, 800)).not.toContain("deposit");
    expect(sql).toContain("when 'service' then");
    expect(sql).toContain("'open', 'scheduled', 'in_progress', 'waiting'");
  });
});

describe("overdue invoices are found past 200 open invoices", () => {
  const invoices: ScaleInvoice[] = Array.from({ length: 250 }, (_, i) => ({
    id: `i${i}`,
    status: "sent",
    dueDate: "2026-09-01",
    balance: 25,
  }));
  invoices[1] = { id: "paid", status: "paid", dueDate: "2026-09-01", balance: 0 };
  invoices[2] = { id: "zero", status: "sent", dueDate: "2026-09-01", balance: 0 };
  invoices[3] = { id: "voided", status: "void", dueDate: "2026-09-01", balance: 40 };
  invoices[220] = { id: "late-overdue", status: "partial", dueDate: "2026-08-01", balance: 12 };

  it("includes a later overdue invoice and excludes paid, zero, and void", () => {
    const overdue = invoices.filter((row) => invoiceIsOverdue(row, TODAY));
    expect(overdue.length).toBeGreaterThan(200);
    expect(recordsOnPage(overdue, 6).map((row) => row.id)).toContain("late-overdue");
    expect(overdue.map((row) => row.id)).not.toContain("paid");
    expect(overdue.map((row) => row.id)).not.toContain("zero");
    expect(overdue.map((row) => row.id)).not.toContain("voided");
  });

  it("uses the canonical open-AR function for the overdue page", () => {
    const body = fnBody("src/lib/data/invoices.ts", "listInvoicesQueue");
    expect(body).toContain("invoice_overdue_page");
    const overdue = body.slice(0, body.indexOf("safe.length >= 2"));
    expect(overdue).not.toContain(".limit(");
    const sql = src("supabase/migrations/0478_ops_queue_scale.sql");
    expect(sql).toContain("public.invoice_open_ar_balance(i.id) > 0.5");
    expect(sql).toContain("i.status <> 'void'");
  });
});

describe("warehouse and scheduler do not load every active job", () => {
  const jobs = Array.from({ length: 250 }, (_, i) => ({
    id: `w${i}`,
    status: i === 10 ? "completed" : "unscheduled",
    warehouseStatus: i >= 220 ? "staged" : i === 5 ? "delivered" : "pending",
    customer: i === 80 ? "Find Me Warehouse" : `Customer ${i}`,
  }));

  it("pages warehouse work and can find a job outside the first page", () => {
    const active = jobs.filter((job) => warehouseSectionIncludes(job, "active"));
    expect(active.length).toBeGreaterThan(200);
    expect(active.length).toBeLessThan(jobs.length);
    const first = recordsOnPage(active, 1);
    expect(first).toHaveLength(WORK_QUEUE_PAGE_SIZE);
    expect(first.map((job) => job.customer)).not.toContain("Find Me Warehouse");
    expect(active.map((job) => job.customer)).toContain("Find Me Warehouse");
    const staged = jobs.filter((job) => warehouseSectionIncludes(job, "staged"));
    expect(staged.length).toBeGreaterThan(0);
    expect(staged.every((job) => job.status !== "completed")).toBe(true);
    expect(recordsOnPage(staged, 1).length).toBeLessThanOrEqual(WORK_QUEUE_PAGE_SIZE);
  });

  it("loads one warehouse page without money columns", () => {
    const body = fnBody("src/lib/data/jobs.ts", "listWarehouseBoard");
    expect(body).toContain("warehouse_active");
    expect(body).toContain("warehouse_staged");
    expect(body).toContain("p_keep_pickup: true");
    expect(body).not.toContain('.in("status"');
    const columns = src("src/lib/data/jobs.ts");
    const board = columns.slice(columns.indexOf("WAREHOUSE_BOARD_COLUMNS"), columns.indexOf("SCHEDULER_LIST_COLUMNS"));
    expect(board).not.toContain("estimated_material_cost");
    expect(board).not.toContain("installer_collects_balance");
    expect(board).not.toContain("show_prices");
    const page = src("src/app/(app)/warehouse/page.tsx");
    expect(page).toContain("listWarehouseBoard");
    expect(page).not.toContain("listWarehouseJobs");
    expect(page.indexOf('profile.role !== "warehouse"')).toBeLessThan(page.lastIndexOf("listWarehouseBoard"));
  });

  it("finds a ready job and a booked job without loading every active job", () => {
    const schedule: ScaleJob[] = jobs.map((job, i) => ({
      id: job.id,
      status: i === 225 ? "scheduled" : i === 10 ? "completed" : "unscheduled",
      scheduledDate: i === 225 ? "2026-10-02" : null,
      hasMaterialNeed: i < 160,
      warehouseReadyAt: null,
    }));
    schedule[225] = {
      id: "booked-late",
      status: "scheduled",
      scheduledDate: "2026-10-02",
      hasMaterialNeed: true,
      warehouseReadyAt: "2026-09-01",
    };
    const ready = schedule.filter((job) => schedulerQueueIncludes(job, "ready"));
    expect(ready.length).toBeGreaterThan(0);
    expect(ready.map((job) => job.id)).toContain("w210");
    expect(recordsOnPage(ready, 1).map((job) => job.id)).not.toContain("w210");
    expect(recordsOnPage(ready, 2).map((job) => job.id)).toContain("w210");
    const booked = schedule.filter((job) => schedulerQueueIncludes(job, "booked"));
    expect(booked.map((job) => job.id)).toContain("booked-late");
    expect(booked.map((job) => job.id)).not.toContain("w0");
  });

  it("loads scheduler pages without deposit or balance columns", () => {
    const body = fnBody("src/lib/data/jobs.ts", "listSchedulerQueue");
    const fn = body.slice(0, body.indexOf("\n/**"));
    expect(fn).toContain("scheduler_ready");
    expect(fn).toContain("scheduler_booked");
    expect(fn).not.toContain("deposit");
    expect(fn).not.toContain("balance");
    const columns = src("src/lib/data/jobs.ts");
    const list = columns.slice(columns.indexOf("SCHEDULER_LIST_COLUMNS"));
    const decl = list.slice(0, list.indexOf(";"));
    expect(decl).not.toContain("installer_collects_balance");
    expect(decl).not.toContain("estimated_material_cost");
    const page = src("src/app/(app)/install-scheduler/page.tsx");
    expect(page).toContain("listSchedulerQueue");
    expect(page).not.toContain('.in("status", ["unscheduled", "scheduled", "in_progress"])');
    expect(page).toContain('.gte("scheduled_date", since)');
    expect(page).not.toContain("waiting on materials");
  });
});

describe("scale migration stays invoker and indexed for these filters", () => {
  const sql = src("supabase/migrations/0478_ops_queue_scale.sql");

  it("does not write business rows or accounting flags", () => {
    expect(sql).not.toMatch(/\binsert into\b/i);
    expect(sql).not.toMatch(/\bdelete from\b/i);
    expect(sql).not.toContain("accounting_enabled");
    expect(sql).toContain("invoices_open_due_idx");
    expect(sql).toContain("jobs_unscheduled_created_idx");
    expect(sql).toContain("jobs_active_schedule_idx");
    expect(sql).toContain("customers_updated_at_idx");
  });
});
