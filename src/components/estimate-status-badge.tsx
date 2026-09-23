import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import {
  ESTIMATE_STATUS_BADGE,
  ESTIMATE_STATUS_LABELS,
  type EstimateStatus,
} from "@/lib/types";

export function EstimateStatusBadge({
  status,
  className,
}: {
  status: EstimateStatus;
  className?: string;
}) {
  return (
    <StatusBadge
      label={ESTIMATE_STATUS_LABELS[status]}
      className={cn(ESTIMATE_STATUS_BADGE[status], className)}
    />
  );
}
