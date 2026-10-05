/**
 * Operational lifecycle. Archive, cancel, and lost are different.
 * Active queues share customers.cancelled_at. Money rows are not rewritten.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  estimateQueueKeepsArchivedCustomer,
  orderQueueKeepsArchivedCustomer,
  scheduleChangeAllowed,
  serviceQueueKeepsArchivedCustomer,
  taskQueueKeepsArchivedCustomer,
} from "@/lib/customer-operational";
import {
  decideArchive,
  decideRestore,
  jobEffectOnArchive,
  jobEffectOnCancel,
  jobEffectOnLost,
  jobReturnsToActiveOpsOnRestore,
  serviceCallbackReturnsOnRestore,
  stageNameMeansLost,
  taskReturnsToActiveOpsOnRestore,
} from "@/lib/customer-lifecycle";

const root = process.cwd();
const src = (path: string) => readFileSync(join(root, path), "utf8");

const ARCHIVED = "2026-10-05T12:00:00Z";

describe("service queue", () => {
  it("treats an open callback as operational work, not a warranty ledger", () => {
    expect(serviceQueueKeepsArchivedCustomer(["open", "in_progress", "waiting"])).toBe(false);
    expect(serviceQueueKeepsArchivedCustomer(["scheduled"])).toBe(false);
    expect(serviceQueueKeepsArchivedCustomer(["resolved"])).toBe(true);
    expect(serviceQueueKeepsArchivedCustomer(null)).toBe(true);
  });
});

describe("archive, cancel, and lost", () => {
  it("archives without rewriting any job status", () => {
    for (const status of ["unscheduled", "scheduled", "in_progress", "completed", "cancelled"]) {
      expect(jobEffectOnArchive(status)).toBe("keep");
    }
  });

  it("cancels open jobs, including one in progress, and leaves finished jobs", () => {
    expect(jobEffectOnCancel("unscheduled")).toBe("cancel");
    expect(jobEffectOnCancel("scheduled")).toBe("cancel");
    expect(jobEffectOnCancel("in_progress")).toBe("cancel");
    expect(jobEffectOnCancel("completed")).toBe("keep");
    expect(jobEffectOnCancel("cancelled")).toBe("keep");
  });

  it("loses only work that has not started on site", () => {
    expect(jobEffectOnLost("unscheduled")).toBe("cancel");
    expect(jobEffectOnLost("scheduled")).toBe("cancel");
    expect(jobEffectOnLost("in_progress")).toBe("keep");
    expect(jobEffectOnLost("completed")).toBe("keep");
    expect(stageNameMeansLost("Lost / Declined")).toBe(true);
    expect(stageNameMeansLost("Cancelled")).toBe(true);
    expect(stageNameMeansLost("Install Scheduled")).toBe(false);
    expect(stageNameMeansLost("Waiting for Materials")).toBe(false);
  });

  it("does not stamp archive twice or restore an active customer", () => {
    const first = decideArchive(null, ARCHIVED);
    expect(first.action).toBe("archive");
    const second = decideArchive(first.cancelledAt, "2026-10-05T13:00:00Z");
    expect(second).toEqual({ action: "noop", cancelledAt: ARCHIVED });
    expect(decideRestore(null)).toEqual({ action: "noop" });
    expect(decideRestore(ARCHIVED)).toEqual({ action: "restore" });
    expect(decideRestore(ARCHIVED)).toEqual(decideRestore(ARCHIVED));
  });
});

describe("restore", () => {
  it("returns the same open job, task, and callback, and does not resurrect cancelled or completed work", () => {
    expect(jobReturnsToActiveOpsOnRestore("unscheduled")).toBe(true);
    expect(jobReturnsToActiveOpsOnRestore("scheduled")).toBe(true);
    expect(jobReturnsToActiveOpsOnRestore("in_progress")).toBe(true);
    expect(jobReturnsToActiveOpsOnRestore("completed")).toBe(false);
    expect(jobReturnsToActiveOpsOnRestore("cancelled")).toBe(false);
    expect(taskReturnsToActiveOpsOnRestore("open")).toBe(true);
    expect(taskReturnsToActiveOpsOnRestore("cancelled")).toBe(false);
    expect(taskReturnsToActiveOpsOnRestore("completed")).toBe(false);
    expect(serviceCallbackReturnsOnRestore("open")).toBe(true);
    expect(serviceCallbackReturnsOnRestore("resolved")).toBe(false);
  });

  it("does not recreate financial rows on archive or restore", () => {
    const action = src("src/app/(app)/customer-records/actions.ts");
    expect(action).not.toContain('.from("invoices")');
    expect(action).not.toContain('.from("payments")');
    expect(action).not.toContain('.from("jobs")');
    expect(action).not.toContain('.from("office_tasks")');
    expect(action).toContain('.is("cancelled_at", null)');
    expect(action).toContain('.not("cancelled_at", "is", null)');
  });
});

describe("list and count share a queue function", () => {
  it("pages service, tasks, estimates, and orders through the same database functions home counts use", () => {
    const home = src("src/lib/data/home-center.ts");
    expect(src("src/lib/data/ops-glue.ts")).toContain("service_queue_page");
    expect(src("src/lib/data/ops-glue.ts")).toContain("task_queue_page");
    expect(home).toContain("service_queue_page");
    expect(home).toContain("task_queue_page");
    expect(home).toContain("estimate_queue_page");
    expect(src("src/lib/data/estimates.ts")).toContain("estimate_queue_page");
    expect(home).toContain("order_queue_page");
    expect(src("src/lib/data/orders.ts")).toContain("order_queue_page");
    expect(taskQueueKeepsArchivedCustomer("open")).toBe(false);
    expect(taskQueueKeepsArchivedCustomer("completed")).toBe(true);
    expect(estimateQueueKeepsArchivedCustomer("sent")).toBe(false);
    expect(estimateQueueKeepsArchivedCustomer("approved")).toBe(true);
    expect(orderQueueKeepsArchivedCustomer(["submitted"])).toBe(false);
    expect(orderQueueKeepsArchivedCustomer(["declined", "cancelled"])).toBe(true);
  });
});

describe("scheduling refuses an archived customer", () => {
  it("blocks a new booking and a move", () => {
    expect(scheduleChangeAllowed(null)).toBe(true);
    expect(scheduleChangeAllowed(ARCHIVED)).toBe(false);
    const jobs = src("src/app/(app)/jobs/actions.ts");
    expect(jobs).toContain("Restore them before scheduling.");
    expect(jobs).toContain("Restore them before changing the install.");
  });
});

describe("migration 0483 and 0484", () => {
  it("0483 only replaces job_queue_page and does not write business rows", () => {
    const sql = src("supabase/migrations/0483_archived_customer_active_queues.sql");
    expect(sql).toContain("create or replace function public.job_queue_page(");
    expect(sql).toContain("p_queue in ('completed', 'all')");
    expect(sql).not.toMatch(/\bdrop table\b/i);
    expect(sql).not.toMatch(/\bdelete from\b/i);
    expect(sql).not.toMatch(/\bupdate public\./i);
    expect(sql).toContain("security invoker");
  });

  it("0484 keeps the 0479 signatures and skips archived customers on active attention only", () => {
    const sql = src("supabase/migrations/0484_archived_customer_attention_queues.sql");
    expect(sql).toContain("Does not enable accounting");
    expect(sql).not.toMatch(/\bdrop table\b/i);
    expect(sql).not.toMatch(/\bdelete from\b/i);
    expect(sql).not.toMatch(/\bupdate public\./i);
    expect((sql.match(/c\.cancelled_at is null/g) ?? []).length).toBe(8);
    expect(sql).toContain("p_statuses && array['resolved', 'cancelled']");
    expect(sql).toContain("p_view = 'completed'");
    expect(sql).toContain("p_status not in ('sent', 'draft')");
    expect(sql).toContain("grant execute on function public.service_queue_page(text[], text, int, int)");
    expect(sql).toContain("grant execute on function public.task_queue_page(text, uuid, boolean, timestamptz, text, int, int)");
  });
});
