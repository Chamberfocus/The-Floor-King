/**
 * Three different customer stops. They all can set customers.cancelled_at.
 * They do not do the same thing to jobs.
 *
 * ARCHIVE — leave job rows alone. Active queues read cancelled_at.
 *           Restore puts those same rows back into active queues.
 * CANCEL  — the transaction was called off. Open jobs become cancelled.
 *           Restore/reopen does not resurrect a cancelled job.
 * LOST    — the sale did not convert. Jobs not yet underway are cancelled,
 *           and those cancelled jobs release stock through releaseJobReservations.
 *           A job in progress or already completed stays, and so does its stock.
 *
 * workflow_stages.outcome is the Lost/Parked authority (migration 0487).
 * Display names stay editable. An explicit outcome always beats the label.
 * Null outcome still uses the old name rules, only so a row that has not been
 * backfilled keeps today's behavior. active and won are neither Lost nor Parked.
 * installed, follow-up, balance, and materials are not outcomes. They still
 * need a milestone. Do not infer them from the label here.
 */
import { customerIsArchived } from "@/lib/customer-operational";

export type JobLifecycleEffect = "keep" | "cancel";

/** Same words the pipeline already uses. Name fallback only. Not the authority. */
export function stageNameMeansLost(name: string | null | undefined): boolean {
  return /lost|declin|dead|cancel/i.test(name ?? "");
}

export function stageNameMeansParked(name: string | null | undefined): boolean {
  const n = (name ?? "").toLowerCase();
  if (/material|deliver/.test(n)) return false;
  return /\bwaiting\b|\bon hold\b|\bhold\b|\bpark/.test(n);
}

/** Stable business outcome on workflow_stages. won is accepted and unused by Lost/Parked. */
export type WorkflowStageOutcome = "active" | "won" | "lost" | "parked";

export interface StageSemantics {
  name?: string | null;
  outcome?: WorkflowStageOutcome | null;
  position?: number | null;
}

/**
 * Lost when the stage says so. A stored outcome wins over the display name.
 * Null outcome keeps the historical name rule until that row is classified.
 */
export function stageIsLost(stage: StageSemantics | null | undefined): boolean {
  if (!stage) return false;
  if (stage.outcome === "lost") return true;
  if (
    stage.outcome === "active" ||
    stage.outcome === "won" ||
    stage.outcome === "parked"
  ) {
    return false;
  }
  if (stage.outcome != null) return false;
  return stageNameMeansLost(stage.name);
}

/**
 * Parked when the stage says so. Lost, active, and won are not parked.
 * A materials label is not a parked sale when outcome is still null — the
 * name rule already excludes material and delivery. An explicit active
 * outcome stays on the spine even if the new label says "waiting".
 */
export function stageIsParked(stage: StageSemantics | null | undefined): boolean {
  if (!stage) return false;
  if (stage.outcome === "parked") return true;
  if (
    stage.outcome === "active" ||
    stage.outcome === "won" ||
    stage.outcome === "lost"
  ) {
    return false;
  }
  if (stage.outcome != null) return false;
  return stageNameMeansParked(stage.name);
}

function byPosition<T extends StageSemantics>(stages: readonly T[]): T[] {
  return [...stages].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/**
 * Where a declined estimate moves. Explicit outcome=lost wins, lowest
 * position first. A null outcome may still match the historical decline
 * label /lost|declin/. That matcher is narrower than stageNameMeansLost
 * (it does not treat "dead" or "cancel" as the decline destination).
 */
export function selectDeclineStage<T extends StageSemantics>(
  stages: readonly T[],
): T | null {
  const ordered = byPosition(stages);
  const explicit = ordered.find((s) => s.outcome === "lost");
  if (explicit) return explicit;
  return (
    ordered.find(
      (s) => s.outcome == null && /lost|declin/i.test(s.name ?? ""),
    ) ?? null
  );
}

/**
 * Where resync places a legacy customers.stage = lost row.
 * Explicit outcome=lost first. A null outcome may still match the full
 * historical Lost name rule. An active stage whose label contains "lost"
 * is not this destination.
 */
export function selectLostPlacementStage<T extends StageSemantics>(
  stages: readonly T[],
): T | null {
  const ordered = byPosition(stages);
  const explicit = ordered.find((s) => s.outcome === "lost");
  if (explicit) return explicit;
  return (
    ordered.find((s) => s.outcome == null && stageNameMeansLost(s.name)) ?? null
  );
}

/**
 * Classification migration 0487 writes. Lost name, else parked name, else
 * active. Never won. Mirrors the SQL case so a rename of the rule has one
 * TypeScript twin to test against.
 */
export function backfillOutcomeFromCurrentName(
  name: string | null | undefined,
): Exclude<WorkflowStageOutcome, "won"> {
  if (stageNameMeansLost(name)) return "lost";
  if (stageNameMeansParked(name)) return "parked";
  return "active";
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
 * Lost releases stock only for the jobs it cancels.
 * in_progress, completed, and already-cancelled jobs keep their ledger.
 * The release itself is releaseJobReservations — there is no second path.
 */
export function reservationEffectOnLost(status: string): "release" | "keep" {
  return jobEffectOnLost(status) === "cancel" ? "release" : "keep";
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
