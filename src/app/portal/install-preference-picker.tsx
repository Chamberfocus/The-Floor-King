"use client";

import { useMemo, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { portalSubmitInstallPreferences } from "./actions";

const WD = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m: m - 1, d };
};

/**
 * Customer-facing install-date REQUEST. Tap up to 3 available days to rank your
 * preferences; greyed days aren't available (no other-job details shown). This
 * only submits a request — the office confirms the final date + installer.
 */
export function InstallPreferencePicker({
  jobId,
  days,
  availableStarts,
  existing,
}: {
  jobId: string;
  days: number;
  availableStarts: string[];
  existing: string[];
}) {
  const openSet = useMemo(() => new Set(availableStarts), [availableStarts]);
  const [selected, setSelected] = useState<string[]>(existing.slice(0, 3));

  const firstOpen = availableStarts[0] ? parse(availableStarts[0]) : null;
  const startMonth = firstOpen
    ? { y: firstOpen.y, m: firstOpen.m }
    : (() => {
        const n = new Date();
        return { y: n.getFullYear(), m: n.getMonth() };
      })();
  const [view, setView] = useState(startMonth);

  const toggle = (d: string) =>
    setSelected((sel) => {
      if (sel.includes(d)) return sel.filter((x) => x !== d);
      if (sel.length >= 3) return sel;
      return [...sel, d];
    });

  const firstDow = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const monthLabel = new Date(view.y, view.m, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const prev = () => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }));
  const next = () => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }));

  if (!availableStarts.length) {
    return (
      <p className="text-sm text-muted-foreground">
        We&apos;re working out available install dates — we&apos;ll reach out shortly to
        schedule with you.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-950/30">
        <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
          <Info className="size-4" /> This is a request — not a confirmed date
        </div>
        <p className="mt-0.5 text-amber-900 dark:text-amber-200">
          Pick your preferred start dates below. We&apos;ll confirm the final date and
          your installer, and then it becomes official.
        </p>
      </div>

      <p className="text-sm">
        <CalendarClock className="mr-1 inline size-4 text-primary" />
        This install is expected to take about{" "}
        <strong>
          {days} day{days === 1 ? "" : "s"}
        </strong>
        . Please pick a start date with room for that. Greyed days aren&apos;t available.
      </p>

      <div className="rounded-lg border p-3">
        <div className="mb-2 flex items-center justify-between">
          <Button type="button" variant="ghost" size="icon-sm" onClick={prev} aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm font-semibold">{monthLabel}</span>
          <Button type="button" variant="ghost" size="icon-sm" onClick={next} aria-label="Next month">
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
          {WD.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (d === null) return <div key={i} />;
            const dstr = ymd(view.y, view.m, d);
            const open = openSet.has(dstr);
            const rank = selected.indexOf(dstr);
            return (
              <button
                key={i}
                type="button"
                disabled={!open}
                onClick={() => toggle(dstr)}
                className={cn(
                  "relative flex h-10 items-center justify-center rounded-md text-sm",
                  rank >= 0
                    ? "bg-primary font-semibold text-primary-foreground"
                    : open
                      ? "border hover:border-primary hover:bg-primary/5"
                      : "cursor-not-allowed text-muted-foreground/40 line-through",
                )}
                title={open ? "" : "Not available"}
              >
                {d}
                {rank >= 0 ? (
                  <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                    {rank + 1}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {selected.length ? (
        <div className="text-sm">
          <div className="mb-1 font-medium">Your preferred dates (in order)</div>
          <ol className="space-y-1">
            {selected.map((d, i) => (
              <li
                key={d}
                className="flex items-center justify-between rounded-md border px-2.5 py-1.5"
              >
                <span>
                  <strong>{i + 1}.</strong> {formatDate(d)}
                </span>
                <button
                  type="button"
                  onClick={() => toggle(d)}
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  remove
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Tap up to 3 available days above to rank your preferences (1 = best).
        </p>
      )}

      <form action={portalSubmitInstallPreferences}>
        <input type="hidden" name="job_id" value={jobId} />
        {selected.map((d) => (
          <input key={d} type="hidden" name="dates" value={d} />
        ))}
        <SubmitButton
          disabled={selected.length === 0}
          pendingText="Sending…"
          confirm="Preferences sent — we'll confirm your date soon"
        >
          {existing.length ? "Update my preferred dates" : "Send my preferred dates"}
        </SubmitButton>
      </form>
    </div>
  );
}
