/**
 * Operational job scope — pure helpers.
 *
 * After an approved estimate becomes a job, `job_line_items` is the source of
 * truth for performing the work (WO, staging, stock, PO, installer). The
 * approved estimate remains the commercial/customer record and is not rewritten
 * by ordinary job-scope edits.
 *
 * Quantity split (Step 2 + Step 3):
 *   - Measured / install qty  → lineQty        (work-order display)
 *   - Physical material need  → lineOrderQty   (stage / reserve / pull / PO)
 */
import { lineOrderQty, lineQty, type CalcLine } from "@/lib/estimate-calc";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Prefer the job's own lines when present; otherwise fall back to the estimate
 * option (legacy jobs that were never seeded). Never merges the two lists.
 */
export function resolveOperationalLines<T>(
  jobLines: T[],
  estimateFallbackLines: T[],
): T[] {
  return jobLines.length > 0 ? jobLines : estimateFallbackLines;
}

/** Seed only when the job has no operational lines yet — never overwrite edits. */
export function shouldSeedJobScope(existingJobLineCount: number): boolean {
  return existingJobLineCount === 0;
}

/**
 * Build insert rows for `job_line_items` from estimate lines.
 * Preserves estimate line UUIDs so stock_movements / PO links that already key
 * off those ids stay coherent for newly seeded jobs.
 */
/** Commercial snapshot fields that are not columns on job_line_items. */
const SNAPSHOT_ONLY_LINE_KEYS = new Set(["line_total", "markup", "gross_profit"]);

export function buildJobLineSeedRows<T extends object>(
  estimateLines: T[],
  jobId: string,
): Array<T & { job_id: string }> {
  return estimateLines.map((line) => {
    const row: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(line)) {
      if (SNAPSHOT_ONLY_LINE_KEYS.has(key)) continue;
      row[key] = value;
    }
    row.job_id = jobId;
    return row as T & { job_id: string };
  });
}

/** Fields the work order and purchase order need that older approval copies omitted. */
const OPERATIONAL_SEED_KEYS = [
  "material_cost",
  "labor_cost",
  "from_stock",
  "is_fill",
  "is_optional",
  "coverage_sqft",
  "coverage_thickness_in",
  "prep_thickness_in",
  "prep_key",
  "option_id",
] as const;

/**
 * An older approval copy has the sold price and quantity, and not the cost,
 * stock choice, or prep coverage. Fill only keys the copy left out, from the
 * estimate line with the same id. A key the copy set stays as approved.
 */
export function fillSnapshotOperationalFields<
  S extends { id?: string | null },
  L extends { id?: string | null },
>(snapshotLines: S[], liveLines: readonly L[]): S[] {
  const liveById = new Map<string, L>();
  for (const line of liveLines) {
    if (line.id) liveById.set(line.id, line);
  }
  return snapshotLines.map((line) => {
    const live = line.id ? liveById.get(line.id) : undefined;
    if (!live) return line;
    const next = { ...(line as Record<string, unknown>) };
    const fromLive = live as Record<string, unknown>;
    for (const key of OPERATIONAL_SEED_KEYS) {
      if (next[key] === undefined && fromLive[key] !== undefined) {
        next[key] = fromLive[key];
      }
    }
    return next as S;
  });
}

/**
 * Prefer approval-snapshot commercial lines when seeding operational scope.
 * Falls back to live estimate lines only when no snapshot lines exist.
 */
export function preferSnapshotLinesForSeed<T>(
  snapshotLines: T[] | null | undefined,
  liveEstimateLines: T[],
): { lines: T[]; source: "snapshot" | "live_estimate" } {
  if (snapshotLines && snapshotLines.length > 0) {
    return { lines: snapshotLines, source: "snapshot" };
  }
  return { lines: liveEstimateLines, source: "live_estimate" };
}

/** Physical material requirement (waste-inclusive). Staging / reserve / PO. */
export function materialNeedQty(line: CalcLine): number {
  return round2(lineOrderQty(line));
}

/**
 * Stock pull requirement — same as material need (waste-inclusive).
 * Step 3 decision D2: reserve, stage, pull, and PO agree on physical qty.
 */
export function stockPullNeedQty(line: CalcLine): number {
  return materialNeedQty(line);
}

/** Measured installation quantity for work-order display (no waste baked in). */
export function workOrderMeasuredQty(line: CalcLine): number {
  return lineQty(line);
}
