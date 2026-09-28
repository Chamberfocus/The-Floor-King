import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { flooringJobSnapshot } from "@/lib/job-snapshot";
import { assessMaterialsReadyForSchedule } from "@/lib/materials-ready";
import {
  SCHEDULE_FAILED_MESSAGE,
  SCHEDULE_MATERIALS_BLOCKED,
  employeeScheduleError,
} from "@/lib/scheduling-conflicts";
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

  it("uses the existing job statuses in plain labels", () => {
    expect(JOB_STATUS_LABELS.unscheduled).toBe("Not scheduled");
    expect(JOB_STATUS_LABELS.scheduled).toBe("Scheduled");
    expect(JOB_STATUS_LABELS.in_progress).toBe("Installing");
    expect(JOB_STATUS_LABELS.completed).toBe("Installed");
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
