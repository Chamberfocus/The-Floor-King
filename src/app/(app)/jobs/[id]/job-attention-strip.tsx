import { cn } from "@/lib/utils";
import type { JobSnapshot } from "@/lib/job-snapshot";
import { placeJobHold, releaseJobHold } from "@/app/(app)/ops/actions";
import { Button } from "@/components/ui/button";

/**
 * Factual job snapshot. The Record Action Center is the only "what to do" control.
 * Hold place/release stays here because it is the hold itself, not a second next step.
 */
export function JobAttentionStrip({
  snapshot,
  jobId,
  activeHoldId,
  canManageHold,
}: {
  snapshot: JobSnapshot;
  jobId: string;
  activeHoldId: string | null;
  canManageHold: boolean;
}) {
  const waiting = snapshot.chips.some((chip) =>
    chip === "Waiting for material" || chip === "Material ordered" || chip === "On hold" || chip === "Service needed",
  );

  return (
    <div
      className={cn(
        "mb-4 rounded-lg border p-3",
        waiting ? "border-amber-500/40 bg-amber-500/10" : "border-border bg-muted/40",
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Job snapshot
      </div>
      <ul className="mt-2 flex flex-wrap gap-2">
        {snapshot.chips.map((chip) => (
          <li
            key={chip}
            className="inline-flex min-h-8 items-center rounded-full border bg-background px-3 text-sm font-medium"
          >
            {chip}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-muted-foreground">{snapshot.fact}</p>

      {canManageHold ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
          {activeHoldId ? (
            <form action={releaseJobHold}>
              <input type="hidden" name="hold_id" value={activeHoldId} />
              <input type="hidden" name="job_id" value={jobId} />
              <Button type="submit" size="sm" variant="outline" className="min-h-11">
                Release hold
              </Button>
            </form>
          ) : (
            <form action={placeJobHold} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="job_id" value={jobId} />
              <input type="hidden" name="category" value="other" />
              <input
                name="reason"
                required
                placeholder="Why is this job on hold?"
                aria-label="Hold reason"
                className="h-11 min-w-[12rem] rounded-md border px-2 text-sm"
              />
              <Button type="submit" size="sm" variant="outline" className="min-h-11">
                Place hold
              </Button>
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}
