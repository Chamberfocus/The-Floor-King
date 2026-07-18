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
        "rounded-xl border border-dashed border-border/70 bg-card/40 p-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-warm-soft text-warm-strong">
          <Icon className="size-7" aria-hidden />
        </div>
      ) : null}
      <p className="text-base font-semibold">{title}</p>
      {description ? (
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
