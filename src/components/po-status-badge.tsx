import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { PO_STATUS_BADGE, PO_STATUS_LABELS, type PoStatus } from "@/lib/types";

export function PoStatusBadge({
  status,
  className,
}: {
  status: PoStatus;
  className?: string;
}) {
  return (
    <StatusBadge
      label={PO_STATUS_LABELS[status]}
      className={cn(PO_STATUS_BADGE[status], className)}
    />
  );
}
