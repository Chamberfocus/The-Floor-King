import type { JobStatus } from "@/lib/types";

/** Canonical forward/sideways transitions for launch safety. */
const ALLOWED: Record<JobStatus, readonly JobStatus[]> = {
  unscheduled: ["unscheduled", "scheduled", "cancelled"],
  scheduled: ["scheduled", "unscheduled", "in_progress", "cancelled"],
  in_progress: ["in_progress", "completed", "cancelled", "scheduled"],
  completed: ["completed"], // reopen requires explicit admin path later
  cancelled: ["cancelled", "unscheduled"], // reopen to unscheduled only
};

export function isAllowedJobStatusTransition(
  from: JobStatus,
  to: JobStatus,
): boolean {
  if (from === to) return true;
  return (ALLOWED[from] ?? []).includes(to);
}

export const JOB_CHANGED_MESSAGE =
  "This record changed while you were working. Refresh and try again.";

/**
 * Who may drive a job status write.
 * Crew may only start or finish an assigned install (RLS still limits the row).
 * Warehouse and customers do not change installation status here.
 */
export function fieldStatusChangeAllowed(role: string, to: JobStatus): boolean {
  if (role === "customer" || role === "warehouse") return false;
  if (role === "crew") return to === "in_progress" || to === "completed";
  return true;
}

export function assessJobStatusTransition(
  from: JobStatus | null | undefined,
  to: JobStatus,
): { ok: true } | { ok: false; error: string } {
  if (!to) return { ok: false, error: "Job status is required." };
  if (!from) return { ok: true };
  if (!isAllowedJobStatusTransition(from, to)) {
    return {
      ok: false,
      error: `Cannot change job status from ${from} to ${to}.`,
    };
  }
  return { ok: true };
}

/** Patch for a manual status change — stamps completed_at on first completion. */
export function jobStatusUpdatePatch(
  status: JobStatus,
  existingCompletedAt: string | null | undefined,
  now = new Date().toISOString(),
): { status: JobStatus; completed_at?: string } {
  const patch: { status: JobStatus; completed_at?: string } = { status };
  if (status === "completed" && !existingCompletedAt) {
    patch.completed_at = now;
  }
  return patch;
}
