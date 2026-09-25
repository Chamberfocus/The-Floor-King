/**
 * Server-side install booking conflict helpers (pure).
 * UI conflict warnings are not authoritative — bookInstall must use these.
 *
 * The schedule date itself is written only by schedule_job_install_safe.
 * A missing function must fail closed. It must not become a direct jobs update.
 */

export const SCHEDULE_UNAVAILABLE_MESSAGE =
  "Scheduling is temporarily unavailable. Please try again or contact an administrator.";

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
