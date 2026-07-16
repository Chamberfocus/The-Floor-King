import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One shared "nothing here yet" block, so every list/section handles empty the
 * same way instead of ~20 bespoke one-liners. Optional icon + action.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed p-10 text-center",
        className,
      )}
    >
      {Icon ? (
        <Icon className="mx-auto mb-3 size-8 text-muted-foreground/40" aria-hidden />
      ) : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
