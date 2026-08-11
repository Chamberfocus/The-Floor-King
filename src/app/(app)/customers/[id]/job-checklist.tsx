import Link from "next/link";
import { Check, ArrowRight, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  checklistProgress,
  type ChecklistStep,
} from "@/lib/job-checklist";

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
}: {
  steps: ChecklistStep[];
  /** The workflow stage the customer is parked on right now. */
  stageName?: string | null;
  stagePosition?: number | null;
  stageTotal?: number | null;
  ownerName?: string | null;
}) {
  const { done, total, pct } = checklistProgress(steps);
  const current = steps.find((s) => s.state === "current") ?? null;
  const skipped = steps.filter((s) => s.state === "skipped");

  return (
    <div className="rounded-lg border">
      <div className="border-b px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-semibold">Where this job is</span>
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
        {current ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-primary/5 px-3 py-2">
            <span className="min-w-0 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                Next
              </span>
              <span className="ml-2 font-medium">{current.title}</span>
              {current.detail ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  {current.detail}
                </span>
              ) : null}
            </span>
            {current.href ? (
              <Link
                href={current.href}
                className={cn(buttonVariants({ size: "sm" }), "shrink-0")}
              >
                {current.linkLabel ?? "Open"} <ArrowRight className="size-3.5" />
              </Link>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            Every step is done — this job is finished and closed out.
          </p>
        )}
        {skipped.length ? (
          <p className="mt-2 text-xs text-amber-600">
            {skipped.length === 1 ? "1 step was" : `${skipped.length} steps were`}{" "}
            passed over: {skipped.map((s) => s.title.toLowerCase()).join(", ")}
          </p>
        ) : null}
      </div>

      <ol className="divide-y">
        {steps.map((s, i) => {
          const isCurrent = s.state === "current";
          const isDone = s.state === "done";
          const isSkipped = s.state === "skipped";
          return (
            <li
              key={s.key}
              className={cn(
                "flex items-start gap-3 px-4 py-2.5",
                isCurrent && "bg-primary/5",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  isDone && "bg-emerald-600 text-white",
                  isCurrent && "bg-primary text-primary-foreground",
                  isSkipped && "border border-amber-500 text-amber-600",
                  !isDone && !isCurrent && !isSkipped && "border text-muted-foreground",
                )}
              >
                {isDone ? <Check className="size-3" /> : i + 1}
              </span>

              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-sm",
                    isDone && "text-muted-foreground",
                    isCurrent && "font-semibold",
                  )}
                >
                  {s.title}
                </span>
                {isSkipped ? (
                  <span className="mt-0.5 block text-xs font-medium text-amber-600">
                    Skipped — the job moved past this
                    {s.detail ? ` · ${s.detail}` : ""}
                  </span>
                ) : s.detail ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {s.detail}
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
                    isCurrent ? "text-primary" : "text-muted-foreground",
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
