import { cn } from "@/lib/utils";
import { JOB_STATUS_BADGE, JOB_STATUS_LABELS, type JobStatus } from "@/lib/types";

export function JobStatusBadge({
  status,
  className,
}: {
  status: JobStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        JOB_STATUS_BADGE[status],
        className,
      )}
    >
      {JOB_STATUS_LABELS[status]}
    </span>
  );
}
