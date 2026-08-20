import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check, MapPin, Wrench, FileText, Trash2 } from "lucide-react";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { deleteJob } from "@/app/(app)/jobs/actions";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { JobChecklist } from "@/components/job-checklist";
import type { JobProgress } from "@/lib/data/job-checklists";

/**
 * The account's work, one card per job.
 *
 * Replaces a single checklist that had to pick ONE job to be about. That pick
 * was "the oldest job that isn't finished", which on Abington Arms landed on an
 * empty placeholder and left the real Unit 813 work with no progress, no next
 * step and no way in. A job is the unit of work; this lists them.
 */
export function JobRollUp({
  customerId,
  jobs,
  stageName,
  stagePosition,
  stageTotal,
  ownerName,
  actionSlots,
  canOverride = false,
}: {
  customerId: string;
  jobs: JobProgress[];
  stageName?: string | null;
  stagePosition?: number | null;
  stageTotal?: number | null;
  ownerName?: string | null;
  /** One-click actions the checklist hosts on the step they belong to — see
   *  `JobChecklist`. Passed down from the page, which holds the server actions. */
  actionSlots?: Record<string, ReactNode>;
  /** Whether this viewer may mark a step done without the record behind it. */
  canOverride?: boolean;
}) {
  if (!jobs.length) return null;
  const multiple = jobs.length > 1;

  /**
   * One job — which is 39 of 40 accounts — gets the FULL checklist here.
   *
   * Splitting the checklist onto the job page fixed the two-job case and broke
   * the ordinary one: opening a customer stopped showing the steps and left a
   * progress bar with "Next: …". The list IS the thing you work from. Only when
   * there is genuinely more than one job does it collapse to a card each, and
   * even then every card opens onto its own full list.
   */
  if (!multiple) {
    const only = jobs[0];
    return (
      <div className="space-y-3">
        <JobChecklist
          steps={only.steps}
          stageName={stageName}
          stagePosition={stagePosition}
          stageTotal={stageTotal}
          ownerName={ownerName}
          actionSlots={actionSlots}
          override={canOverride ? { customerId, jobId: only.jobId } : undefined}
        />
        {only.jobId ? (
          <Link
            href={`/jobs/${only.jobId}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
          >
            <Wrench className="size-3.5" /> Open the work order
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <span className="text-sm font-semibold">
          {multiple ? `${jobs.length} jobs on this account` : "The job"}
        </span>
        {/* The stage belongs to the ACCOUNT — where these people sit in the
            pipeline. Each job below tracks its own progress separately. */}
        <span className="flex flex-wrap items-center gap-2">
          {stageName ? (
            <span className="inline-flex items-center rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-foreground">
              {stageName}
              {stagePosition != null && stageTotal ? (
                <span className="ml-1.5 font-medium opacity-75">
                  {stagePosition}/{stageTotal}
                </span>
              ) : null}
            </span>
          ) : null}
          {ownerName ? (
            <span className="text-xs text-muted-foreground">{ownerName}</span>
          ) : null}
        </span>
      </div>

      <ul className="divide-y">
        {jobs.map((j, i) => {
          const href = j.jobId ? `/jobs/${j.jobId}` : (j.current?.href ?? null);
          const finished = !j.current;
          return (
            <li key={j.jobId ?? `pre-${i}`} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-2">
                  {j.jobId ? (
                    <Wrench className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
                  ) : (
                    <FileText className="size-4 shrink-0 text-blue-600 dark:text-blue-400" />
                  )}
                  {j.jobId ? (
                    <Link href={`/jobs/${j.jobId}`} className="min-w-0 break-words text-sm font-semibold hover:underline">
                      {j.title}
                    </Link>
                  ) : (
                    <span className="min-w-0 break-words text-sm font-semibold">{j.title}</span>
                  )}
                  {j.siteLabel ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      <MapPin className="size-3" /> {j.siteLabel}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {j.done} of {j.total}
                </span>
              </div>

              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    finished ? "bg-emerald-600" : "bg-primary",
                  )}
                  style={{ width: `${j.pct}%` }}
                />
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                {finished ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                    <Check className="size-3.5" /> Finished and closed out
                  </span>
                ) : (
                  <span className="min-w-0 text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                      Next
                    </span>
                    <span className="ml-2 font-medium">{j.current?.title}</span>
                    {j.current?.detail ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {j.current.detail}
                      </span>
                    ) : null}
                  </span>
                )}
                <span className="flex shrink-0 items-center gap-2">
                  {/* A blank job is a stray "New job" click — nothing is
                      attached to it, and no estimate delete can ever remove it
                      because it was never tied to one. Let it go from here. */}
                  {j.isBlank && j.jobId ? (
                    <form action={deleteJob}>
                      <input type="hidden" name="id" value={j.jobId} />
                      <input type="hidden" name="customer_id" value={customerId} />
                      <ConfirmButton
                        size="sm"
                        variant="ghost"
                        title="Remove this empty job?"
                        description="Nothing is attached to it — no estimate, no invoice, no purchase order, no date."
                        confirmLabel="Remove it"
                      >
                        <Trash2 className="size-3.5" /> Remove
                      </ConfirmButton>
                    </form>
                  ) : null}
                  {href ? (
                    <Link
                      href={href}
                      className={cn(buttonVariants({ size: "sm", variant: finished ? "outline" : "default" }))}
                    >
                      {j.jobId ? "Open the job" : (j.current?.linkLabel ?? "Open")}{" "}
                      <ArrowRight className="size-3.5" />
                    </Link>
                  ) : null}
                </span>
              </div>

              {/* The steps, right here — a card that only says "8 of 14" makes
                  you open the job to find out which eight. */}
              <details className="group/steps mt-2">
                <summary className="cursor-pointer list-none text-xs font-medium text-primary hover:underline">
                  <span className="group-open/steps:hidden">Show the steps</span>
                  <span className="hidden group-open/steps:inline">Hide the steps</span>
                </summary>
                <div className="mt-2">
                  <JobChecklist
                    steps={j.steps}
                    actionSlots={actionSlots}
                    override={canOverride ? { customerId, jobId: j.jobId } : undefined}
                  />
                </div>
              </details>
            </li>
          );
        })}
      </ul>

      <p className="border-t px-4 py-2 text-xs text-muted-foreground">
        Every step, and the tools to do it, live on the job.
      </p>
    </div>
  );
}
