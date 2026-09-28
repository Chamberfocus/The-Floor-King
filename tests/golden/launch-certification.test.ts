import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  employeeFileSaveError,
  safeDisplayFileName,
  safeStorageFileName,
} from "@/lib/upload-name";
import {
  fieldStatusChangeAllowed,
  JOB_CHANGED_MESSAGE,
} from "@/lib/job-status";
import { jobStatusEmployeeMessage } from "@/lib/install-closeout";
import {
  employeePaymentError,
  PAYMENT_SAVE_FAILED_MESSAGE,
} from "@/lib/payment-safety";
import { SERVICE_CHANGED_MESSAGE } from "@/lib/service-callback";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("launch certification — employee-safe failures", () => {
  it("keeps payment business sentences and hides database text", () => {
    expect(
      employeePaymentError("Payment exceeds the remaining balance of $40.00."),
    ).toBe("Payment exceeds the remaining balance of $40.00.");
    expect(employeePaymentError("Cannot record a payment on a void invoice.")).toBe(
      "Cannot record a payment on a void invoice.",
    );
    expect(employeePaymentError("Invoice has no remaining balance.")).toBe(
      "Invoice has no remaining balance.",
    );
    expect(
      employeePaymentError(
        "ACCOUNTING_FORBIDDEN: Only admin/office may record invoice payments (got crew).",
      ),
    ).toBe(PAYMENT_SAVE_FAILED_MESSAGE);
    expect(
      employeePaymentError(
        'duplicate key value violates unique constraint "payments_idempotency_key_key"',
      ),
    ).toBe(PAYMENT_SAVE_FAILED_MESSAGE);
    expect(employeePaymentError("PGRST202 Could not find the function")).toBe(
      PAYMENT_SAVE_FAILED_MESSAGE,
    );
    expect(employeePaymentError("")).toBe(PAYMENT_SAVE_FAILED_MESSAGE);
  });

  it("does not put the original filename into a storage key", () => {
    const stored = safeStorageFileName("../../notes/cost-margin.pdf");
    expect(stored).not.toContain("..");
    expect(stored).not.toContain("/");
    expect(stored).not.toContain("cost-margin");
    expect(stored).toMatch(/^[0-9a-f-]{36}\.pdf$/i);
    expect(safeDisplayFileName("../../notes/cost-margin.pdf")).toBe("cost-margin.pdf");
    expect(employeeFileSaveError("signature")).toBe(
      "This signature could not be saved. Try again.",
    );
    expect(employeeFileSaveError("signature")).not.toMatch(/pgrst|sqlstate|violates/i);
  });

  it("blocks crew and warehouse from install status writes they do not own", () => {
    expect(fieldStatusChangeAllowed("crew", "in_progress")).toBe(true);
    expect(fieldStatusChangeAllowed("crew", "completed")).toBe(true);
    expect(fieldStatusChangeAllowed("crew", "cancelled")).toBe(false);
    expect(fieldStatusChangeAllowed("crew", "unscheduled")).toBe(false);
    expect(fieldStatusChangeAllowed("warehouse", "completed")).toBe(false);
    expect(fieldStatusChangeAllowed("customer", "in_progress")).toBe(false);
    expect(fieldStatusChangeAllowed("office", "cancelled")).toBe(true);
    expect(jobStatusEmployeeMessage("complete", "stale")).toBe(JOB_CHANGED_MESSAGE);
    expect(SERVICE_CHANGED_MESSAGE).toMatch(/Refresh and try again/);
  });
});

describe("launch certification — critical writes stay on their canonical path", () => {
  it("job status writes match the row that was read", () => {
    const jobs = read("src/app/(app)/jobs/actions.ts");
    const commit = jobs.slice(
      jobs.indexOf("async function commitJobStatus"),
      jobs.indexOf("export async function emailJobSchedule"),
    );
    expect(commit).toContain('.eq("status", from)');
    expect(commit).toContain("fieldStatusChangeAllowed");
    expect(commit).not.toContain("scheduled_date");
    const collect = jobs.slice(jobs.indexOf("export async function collectJobBalance"));
    expect(collect).toContain("employeePaymentError");
    expect(collect).toContain("record_invoice_payment_safe");
    expect(collect).not.toContain("throw new Error(error.message");
  });

  it("service resolve and schedule stay on the callback row that was read", () => {
    const ops = read("src/app/(app)/ops/actions.ts");
    const resolve = ops.slice(
      ops.indexOf("export async function resolveServiceCallback"),
      ops.indexOf("export async function cancelServiceCallback"),
    );
    expect(resolve).toContain("serviceResolvePatch");
    expect(resolve).toContain('.eq("status", prior.status as string)');
    expect(resolve).toContain("SERVICE_CHANGED_MESSAGE");
    expect(resolve).not.toContain('.from("jobs")');
    expect(resolve).not.toContain('.from("invoices")');
    expect(resolve).not.toContain('.from("payments")');
    const schedule = ops.slice(
      ops.indexOf("export async function scheduleServiceVisit"),
      ops.indexOf("export async function assignServiceCallback"),
    );
    expect(schedule).toContain("serviceSchedulePatch");
    expect(schedule).toContain('.eq("status", prior.status as string)');
  });

  it("work-order price and collection toggles are office-only", () => {
    const wo = read("src/app/(app)/jobs/[id]/wo-actions.ts");
    expect(wo).toContain('await assertRole(["admin", "office"])');
    expect(wo).toContain("safeStorageFileName");
    expect(wo).not.toContain("return { error: error.message }");
    expect(wo).not.toContain("return { error: upErr.message }");
  });
});
