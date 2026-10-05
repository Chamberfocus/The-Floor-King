/**
 * Server-side install booking conflict helpers (pure).
 * UI conflict warnings are not authoritative — bookInstall must use these.
 *
 * The schedule date itself is written only by schedule_job_install_safe.
 * A missing function must fail closed. It must not become a direct jobs update.
 * An archived customer is refused inside that function. Map its code here so
 * the screen never shows raw SQL.
 */
import { ARCHIVED_CUSTOMER_SCHEDULE_ERROR } from "@/lib/customer-operational";

export const SCHEDULE_UNAVAILABLE_MESSAGE =
  "Scheduling is temporarily unavailable. Please try again or contact an administrator.";

export const SCHEDULE_MATERIALS_BLOCKED =
  "This job cannot be scheduled until its materials are ready.";

export const SCHEDULE_FAILED_MESSAGE =
  "This installation could not be scheduled. Try again.";

/** Employee text for a schedule_job_install_safe jsonb refusal. Raw SQL stays off the screen. */
export function scheduleRpcFailureMessage(
  body: { error?: string | null; code?: string | null } | null | undefined,
  fallback: string,
): string {
  if (body?.code === "SCHEDULE_CUSTOMER_ARCHIVED") return ARCHIVED_CUSTOMER_SCHEDULE_ERROR;
  if (body?.code === "SCHEDULE_CANCELLED") return "Cannot schedule a cancelled job.";
  return employeeScheduleError(body?.error || fallback);
}

export function employeeScheduleError(raw: string | null | undefined): string {
  const msg = (raw ?? "").trim();
  if (!msg) return SCHEDULE_FAILED_MESSAGE;
  if (
    /warehouse-ready/i.test(msg) ||
    /materials are not ready/i.test(msg) ||
    /required material has not been received/i.test(msg)
  ) {
    return SCHEDULE_MATERIALS_BLOCKED;
  }
  if (
    isScheduleRpcUnavailable({ message: msg }) ||
    /sqlstate|postgres|pgrst|syntax error|violates|duplicate key/i.test(msg)
  ) {
    return SCHEDULE_FAILED_MESSAGE;
  }
  if (msg.length > 240) return SCHEDULE_FAILED_MESSAGE;
  return msg;
}

/** PostgREST / Postgres signals that schedule_job_install_safe is not callable. */
export function isScheduleRpcUnavailable(error: {
  message?: string | null;
  code?: string | null;
} | null | undefined): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  if (error.code === "PGRST202") return true;
  if (/schedule_job_install_safe/i.test(message)) return true;
  if (/could not find the function/i.test(message)) return true;
  if (/schema cache/i.test(message) && /function/i.test(message)) return true;
  return message.includes("does not exist") && /function/i.test(message);
}

export interface BookedInstallRange {
  jobId: string;
  assignedTo: string | null;
  assignedCrewId: string | null;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

export function dateRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * True when another job already holds the same installer or crew on an
 * overlapping inclusive date range.
 */
export function findInstallerScheduleConflict(args: {
  jobId: string;
  installerProfileId: string | null;
  crewId: string | null;
  start: string;
  end: string;
  existing: BookedInstallRange[];
}): BookedInstallRange | null {
  const end = args.end || args.start;
  for (const row of args.existing) {
    if (row.jobId === args.jobId) continue;
    const sameInstaller =
      !!args.installerProfileId &&
      !!row.assignedTo &&
      args.installerProfileId === row.assignedTo;
    const sameCrew =
      !!args.crewId &&
      !!row.assignedCrewId &&
      args.crewId === row.assignedCrewId;
    if (!sameInstaller && !sameCrew) continue;
    if (
      dateRangesOverlap(args.start, end, row.start, row.end || row.start)
    ) {
      return row;
    }
  }
  return null;
}
