import { cn } from "@/lib/utils";
import type { JobOperationalState } from "@/lib/job-operational-state";
import {
  placeJobHold,
  releaseJobHold,
} from "@/app/(app)/ops/actions";
import { Button } from "@/components/ui/button";

export function JobAttentionStrip({
  state,
  jobId,
  activeHoldId,
  canManageHold,
}: {
  state: JobOperationalState;
  jobId: string;
  activeHoldId: string | null;
  canManageHold: boolean;
}) {
  const tone =
    state.severity === "urgent"
      ? "border-destructive/40 bg-destructive/10"
      : state.severity === "attention"
        ? "border-amber-500/40 bg-amber-500/10"
        : "border-border bg-muted/40";

  return (
    <div className={cn("mb-4 rounded-lg border p-3", tone)}>
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Status / attention
          </div>
          <div className="text-sm font-semibold">{state.blockerLabel}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Next action
          </div>
          <div className="text-sm">{state.nextAction}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Responsible
          </div>
          <div className="text-sm font-medium">{state.responsibleArea}</div>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{state.explanation}</p>

      {canManageHold ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
          {activeHoldId ? (
            <form action={releaseJobHold}>
              <input type="hidden" name="hold_id" value={activeHoldId} />
              <input type="hidden" name="job_id" value={jobId} />
              <Button type="submit" size="sm" variant="outline">
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
                placeholder="Hold reason"
                className="h-8 rounded-md border px-2 text-sm"
              />
              <Button type="submit" size="sm" variant="outline">
                Place hold
              </Button>
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}
