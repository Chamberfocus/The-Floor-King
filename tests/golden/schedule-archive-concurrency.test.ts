/**
 * Archived customers cannot acquire a new install booking.
 * The database function is the write boundary. The app check is only the
 * message shown before the race window.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARCHIVED_CUSTOMER_SCHEDULE_ERROR,
  scheduleWriteDecision,
} from "@/lib/customer-operational";
import { jobEffectOnArchive } from "@/lib/customer-lifecycle";
import { scheduleRpcFailureMessage } from "@/lib/scheduling-conflicts";

const root = process.cwd();
const src = (path: string) => readFileSync(join(root, path), "utf8");
const ARCHIVED = "2026-10-05T12:00:00Z";
const sql = src("supabase/migrations/0485_schedule_refuses_archived_customer.sql");

describe("schedule write decision", () => {
  it("A. an active customer can be scheduled", () => {
    expect(
      scheduleWriteDecision({ customerCancelledAt: null, jobStatus: "unscheduled" }),
    ).toEqual({ ok: true });
  });

  it("B. an archived customer cannot be scheduled", () => {
    expect(
      scheduleWriteDecision({ customerCancelledAt: ARCHIVED, jobStatus: "unscheduled" }),
    ).toEqual({
      ok: false,
      code: "SCHEDULE_CUSTOMER_ARCHIVED",
      error: ARCHIVED_CUSTOMER_SCHEDULE_ERROR,
    });
  });

  it("C. an archive that lands after the app check is still refused by the database rule", () => {
    const atAppCheck = scheduleWriteDecision({
      customerCancelledAt: null,
      jobStatus: "scheduled",
    });
    expect(atAppCheck.ok).toBe(true);
    const atDatabase = scheduleWriteDecision({
      customerCancelledAt: ARCHIVED,
      jobStatus: "scheduled",
    });
    expect(atDatabase.ok).toBe(false);
    if (!atDatabase.ok) {
      expect(atDatabase.code).toBe("SCHEDULE_CUSTOMER_ARCHIVED");
    }
    const customerLock = sql.indexOf(
      "from public.customers c where c.id = v_customer_id for update",
    );
    const jobLock = sql.indexOf("from public.jobs where id = p_job_id for update");
    const refusal = sql.indexOf("SCHEDULE_CUSTOMER_ARCHIVED");
    const write = sql.indexOf("update public.jobs");
    expect(customerLock).toBeGreaterThan(0);
    expect(jobLock).toBeGreaterThan(customerLock);
    expect(refusal).toBeGreaterThan(jobLock);
    expect(write).toBeGreaterThan(refusal);
  });

  it("D. a restored customer may be scheduled again", () => {
    expect(
      scheduleWriteDecision({ customerCancelledAt: null, jobStatus: "unscheduled" }),
    ).toEqual({ ok: true });
    expect(
      scheduleWriteDecision({ customerCancelledAt: "", jobStatus: "scheduled" }).ok,
    ).toBe(true);
  });

  it("E. a cancelled job cannot be booked", () => {
    expect(
      scheduleWriteDecision({ customerCancelledAt: null, jobStatus: "cancelled" }),
    ).toEqual({
      ok: false,
      code: "SCHEDULE_CANCELLED",
      error: "Cannot schedule a cancelled job.",
    });
    expect(sql).toContain("code', 'SCHEDULE_CANCELLED'");
  });

  it("F. a repeated schedule updates the same job and does not insert another booking", () => {
    expect(sql).toContain("where id = p_job_id");
    expect(sql).not.toMatch(/insert into public\.jobs/i);
    expect(sql).toContain("for update");
    const first = scheduleWriteDecision({
      customerCancelledAt: null,
      jobStatus: "unscheduled",
    });
    const second = scheduleWriteDecision({
      customerCancelledAt: null,
      jobStatus: "scheduled",
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  it("G. reschedule of an archived customer is the same refusal", () => {
    expect(
      scheduleWriteDecision({ customerCancelledAt: ARCHIVED, jobStatus: "scheduled" }).ok,
    ).toBe(false);
    const jobs = src("src/app/(app)/jobs/actions.ts");
    const move = jobs.slice(jobs.indexOf("export async function rescheduleInstall"));
    expect(move).toContain("schedule_job_install_safe");
    expect(move).toContain("scheduleRpcFailureMessage");
    expect(sql).not.toContain("old.scheduled_date");
  });
});

describe("migration 0485", () => {
  it("keeps the 0178 signature, returns a domain error, and does not rewrite customers", () => {
    expect(sql).toContain("create or replace function public.schedule_job_install_safe(");
    expect(sql).toContain(
      "grant execute on function public.schedule_job_install_safe(\n  uuid, date, date, uuid, uuid, text, boolean, boolean\n) to service_role;",
    );
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain(ARCHIVED_CUSTOMER_SCHEDULE_ERROR);
    expect(sql).toContain("Does not enable accounting");
    expect(sql).not.toMatch(/\bdrop table\b/i);
    expect(sql).not.toMatch(/\bdelete from\b/i);
    expect(sql).not.toMatch(/\bupdate public\.customers\b/i);
    expect(sql).not.toContain("posting_enabled");
    expect(
      scheduleRpcFailureMessage(
        { code: "SCHEDULE_CUSTOMER_ARCHIVED", error: "SQLSTATE 23514 check violation" },
        "fallback",
      ),
    ).toBe(ARCHIVED_CUSTOMER_SCHEDULE_ERROR);
  });
});

describe("archive during an existing install", () => {
  it("keeps the job, including its stored date, and does not cancel it", () => {
    expect(jobEffectOnArchive("scheduled")).toBe("keep");
    const archive = src("src/app/(app)/customer-records/actions.ts");
    const fn = archive.slice(
      archive.indexOf("export async function archiveCustomerRecord"),
      archive.indexOf("export async function restoreCustomerRecord"),
    );
    expect(fn).not.toContain('.from("jobs")');
    expect(fn).toContain("cancelled_at");
  });
});

describe("new active work is refused in the server action", () => {
  it("guards the operational writes an archived customer must not receive", () => {
    const jobs = src("src/app/(app)/jobs/actions.ts");
    const ops = src("src/app/(app)/ops/actions.ts");
    expect(jobs).toContain("refuseNewActiveWorkForJob");
    expect(jobs).toContain("jobStatusChangeIsNewActiveWork");
    expect(ops).toContain("refuseNewActiveWorkForCustomer");
    expect(src("src/app/(app)/jobs/material-actions.ts")).toContain("refuseNewActiveWorkForJob");
    expect(src("src/app/(app)/jobs/new/actions.ts")).toContain("refuseNewActiveWorkForCustomer");
    expect(src("src/app/(app)/orders/actions.ts")).toContain("refuseNewActiveWorkForCustomer");
    expect(src("src/app/(app)/purchase-orders/actions.ts")).toContain(
      "refuseNewActiveWorkForCustomer",
    );
    const cron = src("src/app/api/cron/daily/route.ts");
    const start = cron.indexOf('update({ status: "in_progress" })');
    expect(start).toBeGreaterThan(0);
    expect(cron.slice(Math.max(0, start - 400), start)).toContain("customerIsArchived");
  });
});
