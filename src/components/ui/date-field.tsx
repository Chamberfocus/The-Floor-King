"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The ONE date picker used everywhere. A cleanly-styled native date input: it
 * shows the OS calendar (great on mobile, familiar on desktop), has a big tap
 * target, and reads/writes a plain `YYYY-MM-DD` string with NO timezone shift —
 * so the date you pick is exactly the date that's saved and displayed (no
 * off-by-one). Drop-in for any `<input type="date">` / `<Input type="date">`:
 * pass `name`, `value`/`defaultValue`, `onChange`, `required`, `min`, `max`.
 * Class-merges cleanly (tailwind-merge), so call-site sizing still applies.
 */
export const DateField = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<"input">, "type">
>(function DateField({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      type="date"
      className={cn(
        "h-11 w-full rounded-lg border border-input bg-transparent px-3.5 py-2 text-base shadow-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:[color-scheme:dark]",
        className,
      )}
      {...props}
    />
  );
});
