import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { flooringJobSnapshot } from "@/lib/job-snapshot";
import { assessMaterialsReadyForSchedule } from "@/lib/materials-ready";
import {
  SCHEDULE_FAILED_MESSAGE,
  SCHEDULE_MATERIALS_BLOCKED,
  employeeScheduleError,
} from "@/lib/scheduling-conflicts";
import { jobOperationsStatusLabel } from "@/lib/job-operations-status";
import { JOB_STATUS_LABELS } from "@/lib/types";

const base = {
  status: "unscheduled",
  todayYmd: "2026-09-28",
  hasMaterialNeed: false,
  warehouseReadyAt: null as string | null,
};

describe("job operations material wording", () => {
  it("says a labor-only job needs no material, even when a purchase order exists", () => {
    const snap = flooringJobSnapshot({
      ...base,
      purchaseOrders: [{ status: "ordered" }],
    });
    expect(snap.fact).toBe("No material is required for scheduling.");
    expect(snap.chips).toContain("Ready to schedule");
    expect(snap.chips.join(" ")).not.toMatch(/deposit|balance|ordered/i);
    expect(
      assessMaterialsReadyForSchedule({ hasMaterialNeed: false, warehouseReadyAt: null }).ready,
    ).toBe(true);
  });

  it("blocks material jobs that are not warehouse ready and ignores deposit", () => {
    const snap = flooringJobSnapshot({
      ...base,
      hasMaterialNeed: true,
      purchaseOrders: [{ status: "received" }],
    });
    expect(snap.fact).toBe("Materials are not ready.");
    expect(snap.chips).not.toContain("Ready to schedule");
    expect(snap.chips).not.toContain("Materials ready");
    expect(
      assessMaterialsReadyForSchedule({ hasMaterialNeed: true, warehouseReadyAt: null }).ready,
    ).toBe(false);
  });

  it("says materials are ready only from warehouse readiness", () => {
    const snap = flooringJobSnapshot({
      ...base,
      hasMaterialNeed: true,
      warehouseReadyAt: "2026-09-28T15:00:00Z",
    });
    expect(snap.fact).toBe("Materials ready.");
    expect(snap.chips).toContain("Ready to schedule");
  });
});

describe("schedule and job language", () => {
  it("hides database errors and states the material block in plain language", () => {
    expect(employeeScheduleError("Materials are not marked warehouse-ready")).toBe(
      SCHEDULE_MATERIALS_BLOCKED,
    );
    expect(employeeScheduleError("duplicate key value violates unique constraint")).toBe(
      SCHEDULE_FAILED_MESSAGE,
    );
    expect(
      employeeScheduleError("That installer is already booked on overlapping dates."),
    ).toBe("That installer is already booked on overlapping dates.");
  });

  it("keeps shared job labels neutral and uses flooring words only on install screens", () => {
    expect(JOB_STATUS_LABELS).toEqual({
      unscheduled: "Unscheduled",
      scheduled: "Scheduled",
      in_progress: "In Progress",
      completed: "Completed",
      cancelled: "Cancelled",
    });
    expect(jobOperationsStatusLabel("unscheduled")).toBe("Not scheduled");
    expect(jobOperationsStatusLabel("scheduled")).toBe("Scheduled");
    expect(jobOperationsStatusLabel("in_progress")).toBe("Installing");
    expect(jobOperationsStatusLabel("completed")).toBe("Installed");
    expect(jobOperationsStatusLabel("cancelled")).toBe("Cancelled");
  });
});

describe("job status label consumers", () => {
  const src = (path: string) => readFileSync(path, "utf8");

  it("uses flooring labels on install surfaces and shared labels everywhere else", () => {
    for (const path of [
      "src/app/(app)/jobs/[id]/page.tsx",
      "src/app/(app)/jobs/[id]/installation-wo.tsx",
      "src/app/(app)/installer/page.tsx",
      "src/app/(app)/customers/[id]/customer-record-rows.tsx",
    ]) {
      expect(src(path)).toContain("jobOperationsStatusLabel");
    }
    for (const path of [
      "src/app/(app)/customers/[id]/cash-carry-card.tsx",
      "src/app/(app)/customers/[id]/job-costing-tab.tsx",
      "src/app/portal/page.tsx",
      "src/app/(app)/jobs/job-form.tsx",
    ]) {
      expect(src(path)).not.toContain("jobOperationsStatusLabel");
    }
    expect(src("src/app/(app)/jobs/job-form.tsx")).toContain("JOB_STATUS_LABELS");
    expect(src("src/components/job-status-badge.tsx")).toContain("JOB_STATUS_LABELS[status]");
    expect(src("src/app/(app)/jobs/[id]/page.tsx")).toContain('delivery_type === "cash_carry"');
  });
});

describe("job operations sources", () => {
  const jobs = readFileSync("src/app/(app)/jobs/actions.ts", "utf8");
  const warehouse = readFileSync("src/app/(app)/warehouse/warehouse-job-actions.tsx", "utf8");
  const collect = readFileSync("src/app/(app)/jobs/[id]/installer-collect.tsx", "utf8");
  const strip = readFileSync("src/app/(app)/jobs/[id]/job-attention-strip.tsx", "utf8");

  it("keeps the safe scheduling write and does not add a jobs update fallback", () => {
    expect(jobs).toContain("schedule_job_install_safe");
    expect(jobs).toContain("employeeScheduleError");
    expect(jobs).not.toMatch(/\.update\(\{[^}]*scheduled_date/);
  });

  it("guards warehouse ready and on-site collection against a second click", () => {
    expect(warehouse).toContain("Materials are ready for installation");
    expect(warehouse).toContain("busy.current");
    expect(collect).toContain("busy.current");
    expect(collect).not.toContain("createAdminClient");
  });

  it("does not add a second next-action engine on the job", () => {
    expect(strip).not.toContain("Next action");
    expect(strip).not.toContain("Next step");
    expect(strip).toContain("Job snapshot");
  });
});
