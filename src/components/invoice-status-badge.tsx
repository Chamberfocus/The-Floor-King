import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
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
    <StatusBadge
      label={INVOICE_STATUS_LABELS[status]}
      className={cn(INVOICE_STATUS_BADGE[status], className)}
    />
  );
}
