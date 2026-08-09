// Job costing — pure helpers shared by the estimate-approval snapshot and the
// read-only per-customer costing view. Cost-side only; isolates material from
// labor via the shared optionCostTotals.
import { optionCostTotals } from "@/lib/estimate-calc";
import type { EstimateLineItem } from "@/lib/types";

export const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

/** The estimate's isolated MATERIAL cost (waste raises material, never labor) —
 *  snapshotted onto the job as estimated_material_cost at approval. */
export function estimatedMaterialCostForOption(lines: EstimateLineItem[]): number {
  return round2(
    optionCostTotals(lines as Parameters<typeof optionCostTotals>[0]).material,
  );
}

/**
 * THE rule for what a job was estimated to cost.
 *
 * The snapshot is written once at approval, so later edits to the estimate
 * can't retroactively move a job's baseline. But jobs created before those
 * columns existed have no snapshot, and for them the honest answer is to
 * recompute from the estimate's own lines — NOT to call it zero.
 *
 * Reading `snapshot ?? 0` is the trap: it turns "nobody recorded this" into
 * "it cost nothing", so a job with $5,639 of real estimated cost compares
 * against $0 and every actual dollar reads as pure overrun. The close-out
 * screen did exactly that for 13 of 24 jobs.
 *
 * Pure on purpose — callers fetch in whatever shape suits them (one job, or
 * a whole customer's worth in bulk) and apply the same rule.
 */
export function estimatedCostFor(
  snapshot: { material: number | null; labor: number | null },
  fallback: { material: number; labor: number } | null,
): { material: number; labor: number; total: number; fromSnapshot: boolean } {
  const hasSnapshot = snapshot.material != null || snapshot.labor != null;
  const material = round2(
    snapshot.material != null ? Number(snapshot.material) : (fallback?.material ?? 0),
  );
  const labor = round2(
    snapshot.labor != null ? Number(snapshot.labor) : (fallback?.labor ?? 0),
  );
  return { material, labor, total: round2(material + labor), fromSnapshot: hasSnapshot };
}

/** The estimate's isolated LABOR + MATERIAL cost from its lines — the fallback
 *  when a job predates the snapshot columns. */
export function costTotalsForLines(
  lines: EstimateLineItem[],
): { material: number; labor: number } {
  const t = optionCostTotals(lines as Parameters<typeof optionCostTotals>[0]);
  return { material: round2(t.material), labor: round2(t.labor) };
}

/**
 * Variance percent with the STEP 3 rule baked in: variance ÷ estimated, but
 * NULL (→ "N/A") whenever estimated is null or zero — never a division result.
 */
export function variancePercent(
  varianceDollars: number | null,
  estimated: number | null,
): number | null {
  if (varianceDollars == null) return null;
  if (estimated == null || estimated === 0) return null;
  return round2((varianceDollars / estimated) * 100);
}
