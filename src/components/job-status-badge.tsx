import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { JOB_STATUS_BADGE, JOB_STATUS_LABELS, type JobStatus } from "@/lib/types";

export function JobStatusBadge({
  status,
  className,
}: {
  status: JobStatus;
  className?: string;
}) {
  return (
    <StatusBadge
      label={JOB_STATUS_LABELS[status]}
      className={cn(JOB_STATUS_BADGE[status], className)}
    />
  );
}
