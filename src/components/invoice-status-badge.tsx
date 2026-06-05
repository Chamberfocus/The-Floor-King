import { cn } from "@/lib/utils";
import {
  INVOICE_STATUS_BADGE,
  INVOICE_STATUS_LABELS,
  type InvoiceStatus,
} from "@/lib/types";

export function InvoiceStatusBadge({
  status,
  className,
}: {
  status: InvoiceStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        INVOICE_STATUS_BADGE[status],
        className,
      )}
    >
      {INVOICE_STATUS_LABELS[status]}
    </span>
  );
}
