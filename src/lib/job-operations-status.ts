import type { JobStatus } from "@/lib/types";

/**
 * Presentation labels for a flooring installation.
 * Stored job status values stay on JOB_STATUS_LABELS. This does not
 * change transitions or decide what an employee should do next.
 */
const JOB_OPERATIONS_STATUS_LABELS: Record<JobStatus, string> = {
  unscheduled: "Not scheduled",
  scheduled: "Scheduled",
  in_progress: "Installing",
  completed: "Installed",
  cancelled: "Cancelled",
};

export function jobOperationsStatusLabel(status: JobStatus): string {
  return JOB_OPERATIONS_STATUS_LABELS[status];
}
