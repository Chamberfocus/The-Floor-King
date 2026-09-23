import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared badge chrome. Callers pass the real status label — this component
 * does not know estimate, job, invoice, or PO states, and it never stores one.
 * Color is optional. The text is the meaning.
 */
export function StatusBadge({
  label,
  className,
  icon: Icon,
}: {
  label: string;
  className?: string;
  icon?: LucideIcon;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        Icon ? "gap-1" : null,
        className,
      )}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      {label}
    </span>
  );
}
