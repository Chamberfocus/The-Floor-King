/** Canonical service_callbacks facts. Not a second workflow engine. */

export const SERVICE_STATUSES = [
  "open",
  "scheduled",
  "in_progress",
  "waiting",
  "resolved",
  "cancelled",
] as const;

export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

const ALLOWED: Record<ServiceStatus, readonly ServiceStatus[]> = {
  open: ["open", "scheduled", "in_progress", "waiting", "resolved", "cancelled"],
  scheduled: ["scheduled", "open", "in_progress", "waiting", "resolved", "cancelled"],
  in_progress: ["in_progress", "scheduled", "waiting", "resolved", "cancelled"],
  waiting: ["waiting", "open", "scheduled", "in_progress", "resolved", "cancelled"],
  resolved: ["resolved"],
  cancelled: ["cancelled"],
};

export function isServiceStatus(value: string): value is ServiceStatus {
  return (SERVICE_STATUSES as readonly string[]).includes(value);
}

export function serviceStatusLabel(status: string): string {
  switch (status) {
    case "open":
      return "Open";
    case "scheduled":
      return "Scheduled";
    case "in_progress":
      return "In progress";
    case "waiting":
      return "Waiting";
    case "resolved":
      return "Resolved";
    case "cancelled":
      return "Cancelled";
    default:
      return "Open";
  }
}

export function assessServiceTransition(
  from: string | null | undefined,
  to: ServiceStatus,
): { ok: true } | { ok: false; error: string } {
  if (!isServiceStatus(to)) {
    return { ok: false, error: serviceEmployeeMessage("update") };
  }
  const current = isServiceStatus(from ?? "") ? (from as ServiceStatus) : "open";
  if (current === to) return { ok: true };
  if (!ALLOWED[current].includes(to)) {
    return { ok: false, error: serviceEmployeeMessage("update") };
  }
  return { ok: true };
}

export function canMoveServiceTo(from: string | null | undefined, to: ServiceStatus): boolean {
  return assessServiceTransition(from, to).ok && from !== to;
}

/** Days since reported_at. Descriptive only — not a score. */
export function serviceReportedAge(
  reportedAt: string | null | undefined,
  now = new Date(),
): string | null {
  if (!reportedAt) return null;
  const day = reportedAt.slice(0, 10);
  const start = new Date(`${day}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const days = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  if (days <= 0) return "Reported today";
  if (days === 1) return "Reported 1 day ago";
  return `Reported ${days} days ago`;
}

export function serviceVisitLabel(input: {
  status: string;
  followUpAt: string | null | undefined;
}): string {
  if (!input.followUpAt) {
    return input.status === "scheduled" ? "Visit date not entered" : "No visit scheduled";
  }
  return input.status === "scheduled" ? "Visit scheduled" : "Follow-up date";
}

/**
 * Fields a service schedule write may touch. Install dates and warehouse
 * readiness are intentionally absent.
 */
export function serviceSchedulePatch(followUpAt: string): {
  status: "scheduled";
  follow_up_at: string;
  updated_at: string;
} {
  return {
    status: "scheduled",
    follow_up_at: followUpAt,
    updated_at: new Date().toISOString(),
  };
}

export function serviceResolvePatch(
  resolutionNotes: string | null,
  now = new Date().toISOString(),
): { status: "resolved"; resolution_notes: string | null; completed_at: string; updated_at: string } {
  return {
    status: "resolved",
    resolution_notes: resolutionNotes,
    completed_at: now,
    updated_at: now,
  };
}

export const SERVICE_CHANGED_MESSAGE =
  "This service issue changed while you were working. Refresh and try again.";

export function serviceEmployeeMessage(
  action: "create" | "update" | "schedule" | "resolve" | "assign",
): string {
  if (action === "create") {
    return "This service issue could not be recorded. Refresh and try again.";
  }
  if (action === "schedule") {
    return "This visit could not be scheduled. Refresh and try again.";
  }
  if (action === "resolve") {
    return "This service issue could not be marked resolved. Refresh and try again.";
  }
  if (action === "assign") {
    return "This service issue could not be assigned. Refresh and try again.";
  }
  return "This service issue could not be updated. Refresh and try again.";
}
