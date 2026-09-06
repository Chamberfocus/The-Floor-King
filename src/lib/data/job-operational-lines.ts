/**
 * Load / seed the job's operational scope (`job_line_items`).
 *
 * Shared by job create, WO edits, materials prep, installer views, and bills so
 * every surface resolves the same lines. Seeding is idempotent and never
 * overwrites an existing operational copy.
 *
 * F7: prefer current approval snapshot lines over live estimate lines so
 * operational scope matches the commercial contract at first seed.
 */
import {
  buildJobLineSeedRows,
  preferSnapshotLinesForSeed,
  resolveOperationalLines,
  shouldSeedJobScope,
} from "@/lib/job-operational-scope";
import type { EstimateLineItem } from "@/lib/types";

/** Minimal Supabase-like client surface used here (user or admin). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ScopeDb = { from: (table: string) => any };

function snapshotLinesToSeedRows(
  payload: unknown,
  jobId: string,
): object[] | null {
  if (!payload || typeof payload !== "object") return null;
  const option = (payload as { option?: { lines?: unknown } }).option;
  const lines = option?.lines;
  if (!Array.isArray(lines) || lines.length === 0) return null;
  // Snapshot lines are a commercial subset; keep ids/qty fields for ops seed.
  return buildJobLineSeedRows(lines as object[], jobId);
}

/**
 * If the job has no `job_line_items` yet, copy the approval snapshot's lines
 * (preferred) or the estimate option's live lines once.
 * Safe for legacy jobs and for re-running ensureJobForEstimate.
 */
export async function seedJobScopeIfEmpty(
  db: ScopeDb,
  jobId: string,
): Promise<{ seeded: boolean; lineCount: number; source?: string }> {
  const { count } = await db
    .from("job_line_items")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);
  if (!shouldSeedJobScope(count ?? 0)) {
    return { seeded: false, lineCount: count ?? 0 };
  }

  const { data: job } = await db
    .from("jobs")
    .select("option_id, estimate_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job?.option_id) return { seeded: false, lineCount: 0 };

  let snapshotRows: object[] | null = null;
  const estimateId = job.estimate_id as string | null;
  if (estimateId) {
    const { data: est } = await db
      .from("estimates")
      .select("current_approval_snapshot_id")
      .eq("id", estimateId)
      .maybeSingle();
    const snapId = est?.current_approval_snapshot_id as string | null;
    if (snapId) {
      const { data: snap } = await db
        .from("estimate_approval_snapshots")
        .select("payload")
        .eq("id", snapId)
        .maybeSingle();
      snapshotRows = snapshotLinesToSeedRows(snap?.payload, jobId);
    }
  }

  const { data: liveLines } = await db
    .from("estimate_line_items")
    .select("*")
    .eq("option_id", job.option_id)
    .order("position", { ascending: true });

  const preferred = preferSnapshotLinesForSeed(
    snapshotRows,
    (liveLines ?? []) as object[],
  );
  if (!preferred.lines.length) return { seeded: false, lineCount: 0 };

  const rows =
    preferred.source === "snapshot"
      ? (preferred.lines as Array<object & { job_id: string }>)
      : buildJobLineSeedRows(preferred.lines, jobId);

  const { error } = await db.from("job_line_items").insert(rows);
  // Race: another writer may have seeded first — treat unique/conflict as OK.
  if (error) {
    const { count: after } = await db
      .from("job_line_items")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId);
    return { seeded: false, lineCount: after ?? 0 };
  }
  return {
    seeded: true,
    lineCount: rows.length,
    source: preferred.source,
  };
}

/** Job-owned lines, ordered. Empty array if none. */
export async function fetchJobScopeLines(
  db: ScopeDb,
  jobId: string,
): Promise<EstimateLineItem[]> {
  const { data } = await db
    .from("job_line_items")
    .select("*")
    .eq("job_id", jobId)
    .order("position", { ascending: true });
  return (data ?? []) as EstimateLineItem[];
}

/** Estimate option lines (commercial fallback / seed source). */
export async function fetchEstimateOptionLines(
  db: ScopeDb,
  optionId: string,
): Promise<EstimateLineItem[]> {
  const { data } = await db
    .from("estimate_line_items")
    .select("*")
    .eq("option_id", optionId)
    .order("position", { ascending: true });
  return (data ?? []) as EstimateLineItem[];
}

/**
 * Operational scope for a job: prefer `job_line_items`, else estimate option.
 * Optionally seed first so legacy jobs get a durable copy without a migration.
 */
export async function loadOperationalJobLines(
  db: ScopeDb,
  jobId: string,
  opts?: { seedIfEmpty?: boolean; optionId?: string | null },
): Promise<EstimateLineItem[]> {
  if (opts?.seedIfEmpty) {
    await seedJobScopeIfEmpty(db, jobId);
  }
  const jobLines = await fetchJobScopeLines(db, jobId);
  if (jobLines.length > 0) return jobLines;

  let optionId = opts?.optionId ?? null;
  if (!optionId) {
    const { data: job } = await db
      .from("jobs")
      .select("option_id")
      .eq("id", jobId)
      .maybeSingle();
    optionId = (job?.option_id as string | null) ?? null;
  }
  if (!optionId) return [];
  const estimateLines = await fetchEstimateOptionLines(db, optionId);
  return resolveOperationalLines(jobLines, estimateLines);
}
