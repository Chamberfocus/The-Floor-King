"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { JobProgress } from "@/lib/job-progress";

export interface JobCelebration extends JobProgress {
  title: string | null;
  /** True on the job page right after the work order was created. */
  justCreated?: boolean;
}

const KEY = (id: string) => `fk-job-step:${id}`;

/**
 * A friendly, non-blocking celebration that fires ONCE per real stage
 * advancement (per device). It diffs the job's derived stage against the last
 * one we saw in localStorage — so it never nags, never repeats, and only shows
 * when something actually got done. Pass one job (job/customer page) or several
 * (installer page); it queues them and shows one at a time.
 */
export function JobStepPopup({ jobs }: { jobs: JobCelebration[] }) {
  const [queue, setQueue] = useState<JobCelebration[]>([]);
  const [active, setActive] = useState<JobCelebration | null>(null);

  // A signature that only changes when a job's actual stage changes. Depending
  // on this (not the always-new `jobs` array) re-checks after a same-page
  // server action advances a job (e.g. "Mark complete" revalidates in place),
  // while staying stable across unrelated re-renders.
  const sig = jobs
    .map((j) => `${j.jobId}:${j.currentIndex}:${j.cancelled ? 1 : 0}:${j.justCreated ? 1 : 0}`)
    .join("|");

  // Build the celebration queue from what changed since we last looked.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const toCelebrate: JobCelebration[] = [];
    for (const job of jobs) {
      if (job.cancelled) continue;
      const raw = window.localStorage.getItem(KEY(job.jobId));
      const stored = raw === null ? null : Number(raw);
      if (stored === null) {
        // First time we've seen this job on this device.
        if (job.justCreated) toCelebrate.push(job);
        // Seed silently either way so we don't fire on plain browsing.
        window.localStorage.setItem(KEY(job.jobId), String(job.currentIndex));
      } else if (job.currentIndex > stored) {
        toCelebrate.push(job);
        window.localStorage.setItem(KEY(job.jobId), String(job.currentIndex));
      }
    }
    if (toCelebrate.length) {
      // Reading localStorage must happen after mount (it isn't available during
      // SSR/hydration), so syncing that external state into React here is the
      // correct use of an effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActive(toCelebrate[0]);
      setQueue(toCelebrate.slice(1));
    }
    // Re-run only when a job's stage signature changes (see `sig`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  if (!active) return null;

  const dismiss = () => {
    setActive(queue[0] ?? null);
    setQueue((q) => q.slice(1));
  };

  const done = active.current;
  const next = active.next;

  return (
    <div
      key={`${active.jobId}:${active.currentIndex}`}
      role="status"
      aria-live="polite"
      className="fk-enter-anim fixed inset-x-3 bottom-3 z-[60] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[22rem]"
    >
      <style>{`
        @keyframes fk-enter { from { transform: translateY(1rem); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes fk-pop { 0% { transform: scale(0.4); } 60% { transform: scale(1.15); } 100% { transform: scale(1); } }
        @keyframes fk-fall { 0% { transform: translateY(-8px) rotate(0deg); opacity: 1; } 100% { transform: translateY(60px) rotate(240deg); opacity: 0; } }
        .fk-enter-anim { animation: fk-enter 300ms ease-out; }
        .fk-pop-anim { animation: fk-pop 500ms ease-out; }
        @media (prefers-reduced-motion: reduce) {
          .fk-enter-anim, .fk-pop-anim { animation: none; }
        }
      `}</style>

      <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-card p-4 shadow-xl">
        {/* Confetti — decorative, hidden when the user prefers less motion. */}
        <div className="pointer-events-none absolute inset-0 motion-reduce:hidden" aria-hidden="true">
          {[
            "#f59e0b", "#10b981", "#3b82f6", "#ef4444",
            "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
          ].map((c, i) => (
            <span
              key={i}
              className="absolute top-0 size-1.5 rounded-[1px]"
              style={{
                left: `${8 + i * 11}%`,
                background: c,
                animation: `fk-fall 900ms ease-in ${i * 70}ms forwards`,
              }}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>

        <div className="flex items-start gap-3 pr-6">
          <span className="fk-pop-anim text-3xl" aria-hidden="true">
            {active.isComplete ? "🎉" : done?.emoji ?? "✓"}
          </span>
          <div className="min-w-0">
            {active.isComplete ? (
              <>
                <div className="font-semibold">Job complete! 🎊</div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Nice work{active.title ? ` — ${active.title}` : ""} is all wrapped up.
                </p>
              </>
            ) : (
              <>
                <div className="font-semibold">
                  <span className="text-emerald-600">✓</span> {done?.label}
                </div>
                {active.title ? (
                  <p className="truncate text-xs text-muted-foreground">{active.title}</p>
                ) : null}
                {next ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Next up: <span className="font-medium text-foreground">{next.label}</span>
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>

        {!active.isComplete && next ? (
          <div className="mt-3 flex items-center justify-end gap-2 pl-9">
            <button
              type="button"
              onClick={dismiss}
              className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Later
            </button>
            <Link
              href={next.actionHref}
              onClick={dismiss}
              className={cn(buttonVariants({ size: "sm" }))}
            >
              {next.emoji} {next.actionLabel}
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
