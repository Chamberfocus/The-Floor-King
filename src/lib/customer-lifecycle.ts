/**
 * Three different customer stops. They all can set customers.cancelled_at.
 * They do not do the same thing to jobs.
 *
 * ARCHIVE — leave job rows alone. Active queues read cancelled_at.
 *           Restore puts those same rows back into active queues.
 * CANCEL  — the transaction was called off. Open jobs become cancelled.
 *           Restore/reopen does not resurrect a cancelled job.
 * LOST    — the sale did not convert. Jobs not yet underway are cancelled.
 *           A job in progress or already completed stays. That work is real.
 *
 * Stage display names still classify lost/park until workflow_stages has a
 * stable outcome column. Do not add that column in this phase.
 *
 * Next phase (not this migration): workflow_stages.outcome text, null or one
 * of active, won, lost, parked. Display name stays freely editable. Business
 * logic reads outcome. While outcome is null, keep the name fallback so
 * existing shops do not change behavior the day the column appears. Backfill
 * lost from stageNameMeansLost and parked from stageNameMeansParked. Leave
 * every other stage null (treated as active). Do not overload outcome for
 * "installed" or "follow" — those are pipeline steps, not terminal outcomes.
 * Install, follow-up, balance, and materials keep needing an explicit
 * auto_action or milestone, because a renamed display label must not move them.
 */
import { customerIsArchived } from "@/lib/customer-operational";

export type JobLifecycleEffect = "keep" | "cancel";

/** Same words the pipeline already uses. One copy, not one regex per page. */
export function stageNameMeansLost(name: string | null | undefined): boolean {
  return /lost|declin|dead|cancel/i.test(name ?? "");
}

export function stageNameMeansParked(name: string | null | undefined): boolean {
  const n = (name ?? "").toLowerCase();
  if (/material|deliver/.test(n)) return false;
  return /\bwaiting\b|\bon hold\b|\bhold\b|\bpark/.test(n);
}

export function decideArchive(
  cancelledAt: string | null | undefined,
  nowIso: string,
): { action: "noop"; cancelledAt: string } | { action: "archive"; cancelledAt: string } {
  if (customerIsArchived(cancelledAt)) {
    return { action: "noop", cancelledAt: cancelledAt as string };
  }
  return { action: "archive", cancelledAt: nowIso };
}

export function decideRestore(
  cancelledAt: string | null | undefined,
): { action: "noop" | "restore" } {
  return { action: customerIsArchived(cancelledAt) ? "restore" : "noop" };
}

/** Archive never rewrites a job. */
export function jobEffectOnArchive(_status: string): JobLifecycleEffect {
  return "keep";
}

/** Cancel closes every job that is still open, including one in progress. */
export function jobEffectOnCancel(status: string): JobLifecycleEffect {
  if (status === "completed" || status === "cancelled") return "keep";
  return "cancel";
}

/**
 * Lost closes work that has not started on site.
 * in_progress and completed stay. Those are real jobs, not an open quote.
 */
export function jobEffectOnLost(status: string): JobLifecycleEffect {
  if (status === "completed" || status === "cancelled" || status === "in_progress") {
    return "keep";
  }
  return "cancel";
}

/**
 * After restore, a job re-enters active operations only if its status is
 * still an open operational status. Cancelled and completed never come back.
 */
export function jobReturnsToActiveOpsOnRestore(status: string): boolean {
  return status === "unscheduled" || status === "scheduled" || status === "in_progress";
}

/** An open task row comes back on restore. A cancelled or completed task does not. */
export function taskReturnsToActiveOpsOnRestore(status: string): boolean {
  return status === "open" || status === "in_progress";
}

/** An open callback row comes back on restore. Resolved history stays history. */
export function serviceCallbackReturnsOnRestore(status: string): boolean {
  return status === "open" || status === "scheduled" || status === "in_progress" || status === "waiting";
}

/** Routes whose operational lists depend on customers.cancelled_at. */
export const OPERATIONAL_SURFACE_PATHS = [
  "/customer-records",
  "/customers",
  "/home",
  "/dashboard",
  "/tasks",
  "/jobs",
  "/install-scheduler",
  "/installer",
  "/warehouse",
  "/board",
  "/service",
  "/estimates",
  "/calendar",
  "/client-status",
  "/orders",
] as const;
