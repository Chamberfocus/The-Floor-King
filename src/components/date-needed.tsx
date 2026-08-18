import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * When the customer needs it.
 *
 * Shown as a date AND as a distance ("in 2 days", "tomorrow", "3 days late"),
 * because a date alone makes everyone do the arithmetic themselves — and the
 * arithmetic is the whole reason the field exists. Colour is the same signal a
 * second time, for whoever is scanning a screen full of orders.
 */
export function DateNeeded({
  date,
  className,
}: {
  date: string | null | undefined;
  className?: string;
}) {
  if (!date) return null;

  // Parse at midday so a plain yyyy-mm-dd can't slip a day either way on a
  // timezone boundary.
  const when = new Date(`${date}T12:00:00`);
  if (Number.isNaN(when.getTime())) return null;

  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((when.getTime() - today.getTime()) / 86_400_000);

  const relative =
    days < 0
      ? `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} late`
      : days === 0
        ? "today"
        : days === 1
          ? "tomorrow"
          : `in ${days} days`;

  const tone =
    days < 0
      ? "bg-destructive/10 text-destructive"
      : days <= 2
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
        : "bg-muted text-muted-foreground";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        tone,
        className,
      )}
    >
      <CalendarClock className="size-3" />
      Needed{" "}
      {when.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })}
      <span className="font-normal opacity-80">· {relative}</span>
    </span>
  );
}
