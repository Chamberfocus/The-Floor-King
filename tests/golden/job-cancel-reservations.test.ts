/**
 * Job cancellation must release reservations and change status together.
 * A failed release leaves the job status unchanged. A second cancel is a no-op
 * on status and does not release inventory twice. No database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  JOB_CANCEL_COMPLETED,
  JOB_CANCEL_RELEASE_FAILED,
  JOB_CANCEL_UNAVAILABLE,
  cancelJobRpcOutcome,
} from "@/lib/job-cancel";
import { stockAfterReservationRelease } from "@/lib/job-stock-reserve";

const jobs = readFileSync("src/app/(app)/jobs/actions.ts", "utf8");
const customers = readFileSync("src/app/(app)/customers/actions.ts", "utf8");
const engine = readFileSync("src/lib/workflow-engine.ts", "utf8");
const poStock = readFileSync("src/lib/po-stock.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/0489_cancel_job_with_reservations.sql",
  "utf8",
);

function slice(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("cancel job RPC outcome", () => {
  it("treats a successful release, including a repeated cancel, as success", () => {
    expect(
      cancelJobRpcOutcome({
        errorMessage: null,
        payload: { ok: true, already_cancelled: false, released_qty: 12 },
      }),
    ).toEqual({ ok: true, alreadyCancelled: false });
    expect(
      cancelJobRpcOutcome({
        errorMessage: null,
        payload: { ok: true, already_cancelled: true, released_qty: 0 },
      }),
    ).toEqual({ ok: true, alreadyCancelled: true });
  });

  it("refuses to cancel when the release fails or the guard is missing", () => {
    const failed = cancelJobRpcOutcome({
      errorMessage: "RESERVATION_RELEASE_FAILED: INV_RELEASE_EXCEEDS_JOB_RESERVED",
      payload: null,
    });
    const missing = cancelJobRpcOutcome({
      errorMessage: "Could not find the function public.cancel_job_with_reservations",
      payload: null,
    });
    const completed = cancelJobRpcOutcome({
      errorMessage: null,
      payload: { ok: false, code: "JOB_COMPLETED" },
    });
    expect(failed.ok).toBe(false);
    expect(missing.ok).toBe(false);
    expect(completed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).toBe(JOB_CANCEL_RELEASE_FAILED);
    if (!missing.ok) expect(missing.error).toBe(JOB_CANCEL_UNAVAILABLE);
    if (!completed.ok) expect(completed.error).toBe(JOB_CANCEL_COMPLETED);
    expect(cancelJobRpcOutcome({ errorMessage: null, payload: { ok: false } }).ok).toBe(false);
  });

  it("a second release of the same ledger releases nothing", () => {
    const first = stockAfterReservationRelease({
      onHand: 20,
      productReserved: 7,
      movements: [{ kind: "reserve", qty: 7 }],
    });
    const second = stockAfterReservationRelease({
      onHand: first.onHand,
      productReserved: first.productReserved,
      movements: first.movements,
    });
    expect(first.releasedQty).toBe(7);
    expect(second.releasedQty).toBe(0);
    expect(second.productReserved).toBe(0);
    expect(second.onHand).toBe(20);
  });
});

describe("cancellation paths", () => {
  it("does not change job status until the reservation transaction succeeds", () => {
    const edit = slice(jobs, "export async function updateJob", "export async function setJobStatus");
    const cancelAt = edit.indexOf("cancelJobWithReservations");
    const updateAt = edit.indexOf('.from("jobs").update');
    expect(cancelAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(cancelAt);
    expect(edit.slice(cancelAt, updateAt)).toContain("if (!cancelled.ok) return");

    const commit = slice(jobs, "async function commitJobStatus", "export async function emailJobSchedule");
    const quickAt = commit.indexOf('status === "cancelled"');
    const quickUpdate = commit.indexOf('.from("jobs").update');
    expect(quickAt).toBeGreaterThan(-1);
    expect(quickUpdate).toBeGreaterThan(quickAt);
    expect(commit.slice(quickAt, quickUpdate)).toContain("cancelJobWithReservations");
    expect(commit.slice(quickAt, quickUpdate)).toContain("return { error: cancelled.error }");
    expect(commit.slice(quickAt, quickUpdate)).not.toContain('.from("jobs").update');
  });

  it("keeps financial history out of the cancel transaction", () => {
    const fn = migration.slice(
      migration.indexOf("create or replace function public.cancel_job_with_reservations"),
    );
    const releaseAt = fn.indexOf("release_inventory_safe");
    const statusAt = fn.indexOf("set status = 'cancelled'");
    expect(releaseAt).toBeGreaterThan(-1);
    expect(statusAt).toBeGreaterThan(releaseAt);
    expect(fn).toContain("RESERVATION_RELEASE_FAILED");
    expect(fn).toContain("already_cancelled");
    expect(fn).not.toMatch(/\bdelete from\b/i);
    expect(fn).not.toContain("invoices");
    expect(fn).not.toContain("job_labor");
    expect(fn).not.toContain("installer_bills");
    expect(fn).not.toContain("job_commission");
    expect(migration).not.toMatch(/posting_enabled\s*=\s*true/i);

    const cancelCustomer = slice(
      customers,
      "export async function cancelCustomer",
      "export async function reopenCustomer",
    );
    expect(cancelCustomer).not.toContain('.from("invoices")');
    expect(cancelCustomer).not.toContain('.from("job_labor")');
    expect(cancelCustomer).not.toContain('.from("installer_bills")');
    expect(engine).toContain("cancelJobWithReservations");
  });

  it("stops a direct reservation release when the safe function reports failure", () => {
    const from = poStock.indexOf("export async function releaseJobReservations");
    expect(from).toBeGreaterThan(-1);
    const body = poStock.slice(from);
    const rpcAt = body.indexOf("release_inventory_safe");
    expect(rpcAt).toBeGreaterThan(-1);
    expect(body.indexOf("if (error || !rpcOk(data).ok)")).toBeGreaterThan(rpcAt);
    expect(body).toContain("ok: false");
    expect(body).not.toMatch(/from\("products"\)[\s\S]{0,80}update\(\{\s*reserved/);
  });
});
