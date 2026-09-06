/**
 * Server-side install booking conflict helpers (pure).
 * UI conflict warnings are not authoritative — bookInstall must use these.
 */

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
