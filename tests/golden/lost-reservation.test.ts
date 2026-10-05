/**
 * Lost cancels unscheduled and scheduled jobs and releases their stock
 * through the same path Cancel uses. in_progress and completed stay,
 * including their reservations. A second Lost does not release again.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  jobEffectOnLost,
  jobReturnsToActiveOpsOnRestore,
  reservationEffectOnLost,
} from "@/lib/customer-lifecycle";
import {
  netReservedQty,
  stockAfterReservationRelease,
} from "@/lib/job-stock-reserve";

const root = process.cwd();
const src = (path: string) => readFileSync(join(root, path), "utf8");

function releaseHeld(onHand: number, qty: number) {
  return stockAfterReservationRelease({
    onHand,
    productReserved: qty,
    movements: [{ kind: "reserve", qty }],
  });
}

describe("Lost releases only the jobs it cancels", () => {
  it("A. a scheduled job's hold is released and products.reserved reconciles", () => {
    expect(jobEffectOnLost("scheduled")).toBe("cancel");
    expect(reservationEffectOnLost("scheduled")).toBe("release");
    const after = releaseHeld(40, 12);
    expect(after.releasedQty).toBe(12);
    expect(after.onHand).toBe(40);
    expect(after.productReserved).toBe(0);
    expect(after.available).toBe(40);
    expect(netReservedQty(after.movements)).toBe(0);
  });

  it("B. an unscheduled job's hold is released", () => {
    expect(reservationEffectOnLost("unscheduled")).toBe("release");
    const after = releaseHeld(8, 3);
    expect(after.productReserved).toBe(0);
    expect(after.available).toBe(8);
  });

  it("C. an in-progress job stays, and its reservation stays", () => {
    expect(jobEffectOnLost("in_progress")).toBe("keep");
    expect(reservationEffectOnLost("in_progress")).toBe("keep");
    const held = [{ kind: "reserve", qty: 5 }];
    expect(netReservedQty(held)).toBe(5);
  });

  it("D. a completed job stays history and does not touch inventory", () => {
    expect(jobEffectOnLost("completed")).toBe("keep");
    expect(reservationEffectOnLost("completed")).toBe("keep");
  });

  it("E. repeating the release does not take inventory twice", () => {
    const first = releaseHeld(20, 7);
    const second = stockAfterReservationRelease({
      onHand: first.onHand,
      productReserved: first.productReserved,
      movements: first.movements,
    });
    expect(second.releasedQty).toBe(0);
    expect(second.productReserved).toBe(first.productReserved);
    expect(second.available).toBe(first.available);
    expect(reservationEffectOnLost("cancelled")).toBe("keep");
  });

  it("F. Cancel still releases, and Lost uses that same function", () => {
    const cancel = src("src/app/(app)/customers/actions.ts");
    const cancelFn = cancel.slice(
      cancel.indexOf("export async function cancelCustomer"),
      cancel.indexOf("export async function reopenCustomer"),
    );
    const releaseAt = cancelFn.indexOf("releaseJobReservations");
    const statusAt = cancelFn.indexOf('.update({ status: "cancelled" })');
    expect(releaseAt).toBeGreaterThan(0);
    expect(statusAt).toBeGreaterThan(releaseAt);

    const engine = src("src/lib/workflow-engine.ts");
    const settle = engine.slice(
      engine.indexOf("export async function settleJobsForStage"),
      engine.indexOf("export async function moveToAutoActionStage"),
    );
    const lostRelease = settle.indexOf("releaseJobReservations");
    const lostCancel = settle.indexOf('.update({ status: "cancelled" })');
    expect(lostRelease).toBeGreaterThan(0);
    expect(lostCancel).toBeGreaterThan(lostRelease);
    expect(settle).toContain('jobEffectOnLost(j.status) === "cancel"');
    expect(settle).not.toContain("reserve_inventory_safe");
  });

  it("G. restore does not resurrect a cancelled job or re-reserve the stock", () => {
    expect(jobReturnsToActiveOpsOnRestore("cancelled")).toBe(false);
    expect(jobReturnsToActiveOpsOnRestore("completed")).toBe(false);
    const restore = src("src/app/(app)/customer-records/actions.ts");
    const reopen = restore.slice(restore.indexOf("export async function restoreCustomerRecord"));
    expect(reopen).not.toContain("reserve_inventory_safe");
    expect(reopen).not.toContain('.from("jobs")');
    const customers = src("src/app/(app)/customers/actions.ts");
    const reopenCustomer = customers.slice(
      customers.indexOf("export async function reopenCustomer"),
      customers.indexOf("export async function deleteCustomer"),
    );
    expect(reopenCustomer).not.toContain("reserve_inventory_safe");
    expect(reopenCustomer).not.toContain("releaseJobReservations");
  });
});

describe("migration 0486", () => {
  it("refuses a new reservation for an archived customer and starts only an active scheduled job", () => {
    const sql = src("supabase/migrations/0486_reserve_and_start_refuse_archived.sql");
    expect(sql).toContain("create or replace function public.reserve_inventory_safe(");
    expect(sql).toContain("INV_CUSTOMER_ARCHIVED");
    expect(sql).toContain("for update");
    const refusal = sql.indexOf("INV_CUSTOMER_ARCHIVED");
    const movement = sql.indexOf("inv_apply_movement");
    expect(refusal).toBeGreaterThan(0);
    expect(movement).toBeGreaterThan(refusal);
    expect(sql).toContain("advance_scheduled_job_if_active");
    expect(sql).toContain("JOB_CUSTOMER_ARCHIVED");
    expect(sql).toContain("status = 'in_progress'");
    expect(sql).toContain("grant execute on function public.advance_scheduled_job_if_active(uuid) to service_role");
    expect(sql).not.toMatch(/\bdrop table\b/i);
    expect(sql).not.toMatch(/\bdelete from\b/i);
    expect(sql).not.toMatch(/\bupdate public\.customers\b/i);
    expect(sql).not.toContain("release_inventory_safe");
    expect(sql).toContain("Does not enable accounting");
  });
});

describe("duplicate automation stays on the existing keys", () => {
  it("keeps one open automated task per source key and reuses an open callback", () => {
    const tasks = src("supabase/migrations/0160_f2_operations_glue.sql");
    expect(tasks).toContain("office_tasks_source_key_open_uidx");
    expect(src("src/lib/data/ops-automation.ts")).toContain("office_tasks_source_key");
    expect(src("src/lib/office-task.ts")).toContain("shouldCreateAutomatedTask");
    expect(src("src/lib/ops-followup.ts")).toContain("reuseOpenInstallerIssueId");
    const cron = src("src/app/api/cron/daily/route.ts");
    expect(cron).toContain("thankyou_sent_at");
    expect(cron).toContain("reminder_sent_at");
  });
});
