import type { ReactNode } from "react";
import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  checklistProgress,
  type ChecklistStep,
} from "@/lib/job-checklist";
import { StepOverride } from "@/components/step-override";

/**
 * The whole job on one screen, in order, with a way into every part of it.
 *
 * Replaces a one-step-at-a-time panel that could tell you what to do next but
 * not where you were, what had already happened, or how to get back to the work
 * order. Every row is a real record — done means the record exists, not that
 * somebody ticked a box — and every row links to the thing it's about.
 */
export function JobChecklist({
  steps,
  stageName,
  stagePosition,
  stageTotal,
  ownerName,
  actionSlots,
  override,
}: {
  steps: ChecklistStep[];
  /** The workflow stage the customer is parked on right now. */
  stageName?: string | null;
  stagePosition?: number | null;
  stageTotal?: number | null;
  ownerName?: string | null;
  /** Real one-click actions, keyed by step — approve, create the job, send it
   *  to the warehouse. Supplied by the page because they're server actions with
   *  the ids already in hand; the checklist model stays pure. */
  actionSlots?: Record<string, ReactNode>;
  /** Turns on the per-step escape hatch: mark a step done when no record will
   *  ever prove it, and undo that again. Omitted for read-only surfaces. */
  override?: { customerId: string; jobId: string | null };
}) {
  const { done, total, pct } = checklistProgress(steps);

  return (
    <div className="rounded-lg border">
      <div className="border-b px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-semibold">Job progress</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {done} of {total} done
          </span>
        </div>
        {/* The STAGE, said plainly. The checklist shows what's been done; the
            stage is what the pipeline, the reports and everyone else is going
            on — and the two are not always the same thing. */}
        {stageName ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              {stageName}
            </span>
            {stagePosition != null && stageTotal ? (
              <span className="text-xs text-muted-foreground">
                stage {stagePosition} of {stageTotal}
              </span>
            ) : null}
            {ownerName ? (
              <span className="text-xs text-muted-foreground">· {ownerName}</span>
            ) : null}
          </div>
        ) : null}
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        {done === total ? (
          <p className="mt-3 text-sm text-muted-foreground">All of these records are in.</p>
        ) : null}
      </div>

      <ol className="divide-y">
        {steps.map((s, i) => {
          const isDone = s.state === "done";
          const isOpen = s.state === "current" || s.state === "skipped";
          return (
            <li
              key={s.key}
              className={cn(
                "flex items-start gap-3 px-4 py-2.5",
                isOpen && "bg-muted/40",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  isDone && "bg-emerald-600 text-white",
                  isOpen && "border border-foreground/40 text-foreground",
                  !isDone && !isOpen && "border text-muted-foreground",
                )}
              >
                {isDone ? <Check className="size-3" /> : i + 1}
              </span>

              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-sm",
                    isDone && "text-muted-foreground",
                    isOpen && "font-medium",
                  )}
                >
                  {s.title}
                </span>
                {s.override ? (
                  <span className="mt-0.5 block text-xs font-medium text-amber-600">
                    Marked done{s.override.by ? ` by ${s.override.by}` : ""} — no
                    record{s.override.reason ? ` · ${s.override.reason}` : ""}
                  </span>
                ) : (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {isDone ? "Done" : isOpen ? "Open" : "Not yet"}
                    {s.detail ? ` · ${s.detail}` : ""}
                  </span>
                )}
                {/* Everything else this step can do. On the row, so you never
                    have to guess which page hides the staging sheet. */}
                {actionSlots?.[s.key] || s.extras.length || override ? (
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {actionSlots?.[s.key] ?? null}
                    {override ? (
                      <StepOverride
                        step={s}
                        customerId={override.customerId}
                        jobId={override.jobId}
                      />
                    ) : null}
                    {s.extras.map((x) => (
                      <Link
                        key={x.href + x.label}
                        href={x.href}
                        className="rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        {x.label}
                      </Link>
                    ))}
                  </span>
                ) : null}
              </span>

              {/* A finished step still links — going back to the work order or
                  the invoice is what you do most, and hiding the link once it's
                  done is exactly what made this hard to navigate. */}
              {s.href ? (
                <Link
                  href={s.href}
                  className={cn(
                    "shrink-0 self-center text-xs font-medium hover:underline",
                    "text-muted-foreground",
                  )}
                >
                  {s.linkLabel ?? "Open"}
                </Link>
              ) : (
                <Circle className="mt-1 size-3 shrink-0 text-muted-foreground/30" />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
