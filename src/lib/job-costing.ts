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
