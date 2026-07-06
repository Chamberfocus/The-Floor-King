"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { saveWorkDays } from "./actions";

const DAYS = [
  { n: 1, label: "M" },
  { n: 2, label: "T" },
  { n: 3, label: "W" },
  { n: 4, label: "T" },
  { n: 5, label: "F" },
  { n: 6, label: "S" },
  { n: 0, label: "S" },
];

/** Per-person weekly working-days toggles (office/admin). Auto-saves on tap. */
export function WorkDaysEditor({
  userId,
  workDays,
}: {
  userId: string;
  workDays: string;
}) {
  const [days, setDays] = useState<Set<number>>(
    () =>
      new Set(
        workDays
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => n >= 0 && n <= 6),
      ),
  );
  const [pending, start] = useTransition();

  const toggle = (n: number) => {
    const next = new Set(days);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    setDays(next);
    start(async () => {
      await saveWorkDays(userId, [...next]);
    });
  };

  return (
    <div className="flex items-center gap-1">
      {DAYS.map((d, i) => {
        const on = days.has(d.n);
        return (
          <button
            key={i}
            type="button"
            disabled={pending}
            aria-pressed={on}
            aria-label={`Toggle day ${d.n}`}
            onClick={() => toggle(d.n)}
            className={cn(
              "flex size-8 items-center justify-center rounded-md border text-sm font-semibold transition-colors disabled:opacity-60",
              on
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input text-muted-foreground hover:bg-muted",
            )}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}
