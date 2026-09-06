import {
  BACKUP_ROOT_FOLDER_ID,
  FOLDER_DAILY,
  FOLDER_LOGS,
  FOLDER_WEEKLY,
  MARKER_SYSTEM,
  RETAIN_DAILY_SUCCESS,
  RETAIN_WEEKLY_SUCCESS,
} from "./constants";

export type BackupLane = "daily" | "weekly" | "logs" | "root" | "unknown";

export type DrivePathSegments = string[];

export function isConfiguredBackupRoot(id: string): boolean {
  return id === BACKUP_ROOT_FOLDER_ID;
}

export function assertConfiguredBackupRoot(id: string): void {
  if (!isConfiguredBackupRoot(id)) {
    throw new Error("DRIVE_ROOT_MISMATCH");
  }
}

/** True when `candidateId` is the root or appears in an inventory walked from the root. */
export function isIdUnderBackupRoot(
  candidateId: string,
  knownIds: ReadonlySet<string>,
): boolean {
  if (candidateId === BACKUP_ROOT_FOLDER_ID) return true;
  return knownIds.has(candidateId);
}

export function classifyLane(segments: DrivePathSegments): BackupLane {
  if (segments.length === 0) return "root";
  if (segments[0] === FOLDER_DAILY) return "daily";
  if (segments[0] === FOLDER_WEEKLY) return "weekly";
  if (segments[0] === FOLDER_LOGS) return "logs";
  return "unknown";
}

const DAILY_DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKLY_ID = /^\d{4}-W\d{2}$/;
const BACKUP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isManagedDailyRunPath(segments: DrivePathSegments): boolean {
  return (
    segments.length >= 3 &&
    segments[0] === FOLDER_DAILY &&
    DAILY_DATE.test(segments[1] ?? "") &&
    BACKUP_ID.test(segments[2] ?? "")
  );
}

export function isManagedWeeklyRunPath(segments: DrivePathSegments): boolean {
  return (
    segments.length >= 2 &&
    segments[0] === FOLDER_WEEKLY &&
    WEEKLY_ID.test(segments[1] ?? "")
  );
}

export function isManagedLogsPath(segments: DrivePathSegments): boolean {
  return segments[0] === FOLDER_LOGS;
}

export type RetentionRun = {
  id: string;
  lane: "daily" | "weekly";
  /** UTC calendar date or ISO week id */
  period: string;
  completedAt: string;
  status: "SUCCESS" | "FAILED" | "IN_PROGRESS";
  systemMarker: string | null;
  underRoot: boolean;
};

export type RetentionDecision = {
  deleteIds: string[];
  keepIds: string[];
  skipped: Array<{ id: string; reason: string }>;
};

export function planRetentionDeletes(
  runs: RetentionRun[],
  opts: {
    currentRunFailed: boolean;
    inventoryComplete: boolean;
  },
): RetentionDecision {
  const skipped: Array<{ id: string; reason: string }> = [];
  const keepIds: string[] = [];
  const deleteIds: string[] = [];

  if (opts.currentRunFailed) {
    return {
      deleteIds: [],
      keepIds: runs.map((r) => r.id),
      skipped: runs.map((r) => ({ id: r.id, reason: "CURRENT_RUN_FAILED" })),
    };
  }
  if (!opts.inventoryComplete) {
    return {
      deleteIds: [],
      keepIds: runs.map((r) => r.id),
      skipped: runs.map((r) => ({ id: r.id, reason: "INVENTORY_INCOMPLETE" })),
    };
  }

  const eligible = (lane: "daily" | "weekly") =>
    runs.filter(
      (r) =>
        r.lane === lane &&
        r.status === "SUCCESS" &&
        r.underRoot &&
        r.systemMarker === MARKER_SYSTEM,
    );

  const daily = eligible("daily").sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  const weekly = eligible("weekly").sort((a, b) => b.completedAt.localeCompare(a.completedAt));

  const newestDaily = daily[0];
  const newestWeekly = weekly[0];

  const protect = new Set<string>();
  if (newestDaily) protect.add(newestDaily.id);
  if (newestWeekly) protect.add(newestWeekly.id);
  if (daily.length === 1 && daily[0]) protect.add(daily[0].id);
  if (weekly.length === 1 && weekly[0]) protect.add(weekly[0].id);

  const keepDaily = new Set(daily.slice(0, RETAIN_DAILY_SUCCESS).map((r) => r.id));
  const keepWeekly = new Set(weekly.slice(0, RETAIN_WEEKLY_SUCCESS).map((r) => r.id));

  for (const run of runs) {
    if (!run.underRoot) {
      skipped.push({ id: run.id, reason: "OUTSIDE_ROOT" });
      continue;
    }
    if (run.systemMarker !== MARKER_SYSTEM) {
      skipped.push({ id: run.id, reason: "UNRELATED_FILE" });
      continue;
    }
    if (run.status === "IN_PROGRESS") {
      skipped.push({ id: run.id, reason: "IN_PROGRESS" });
      keepIds.push(run.id);
      continue;
    }
    if (run.status !== "SUCCESS") {
      skipped.push({ id: run.id, reason: "NOT_SUCCESS" });
      keepIds.push(run.id);
      continue;
    }
    if (protect.has(run.id)) {
      keepIds.push(run.id);
      continue;
    }
    const keepSet = run.lane === "daily" ? keepDaily : keepWeekly;
    if (keepSet.has(run.id)) keepIds.push(run.id);
    else deleteIds.push(run.id);
  }

  return { deleteIds, keepIds, skipped };
}
