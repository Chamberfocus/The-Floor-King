import { cn } from "@/lib/utils";
import { PO_STATUS_BADGE, PO_STATUS_LABELS, type PoStatus } from "@/lib/types";

export function PoStatusBadge({
  status,
  className,
}: {
  status: PoStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        PO_STATUS_BADGE[status],
        className,
      )}
    >
      {PO_STATUS_LABELS[status]}
    </span>
  );
}
