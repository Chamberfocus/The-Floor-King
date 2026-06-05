import { cn } from "@/lib/utils";
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
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        ESTIMATE_STATUS_BADGE[status],
        className,
      )}
    >
      {ESTIMATE_STATUS_LABELS[status]}
    </span>
  );
}
