/**
 * Coverage-based bag calculator for prep materials (self-levelers, patches,
 * primers). Self-leveler coverage scales INVERSELY with pour thickness — the
 * stated coverage is at a reference thickness, and pouring thicker uses more
 * material. Primers/adhesives have no reference thickness → flat coverage.
 *
 * Pure + dependency-free: shared by the estimate builder (client) and the
 * server-side generators.
 */

/** Common self-leveler pour thicknesses, as decimal inches. */
export const THICKNESS_OPTIONS: { value: number; label: string }[] = [
  { value: 0.0625, label: '1/16"' },
  { value: 0.125, label: '1/8"' },
  { value: 0.1875, label: '3/16"' },
  { value: 0.25, label: '1/4"' },
  { value: 0.375, label: '3/8"' },
  { value: 0.5, label: '1/2"' },
];

/** Nearest pretty label for a decimal-inch thickness (e.g. 0.25 → 1/4"). */
export function thicknessLabel(t: number | string | null | undefined): string {
  const n = Number(t) || 0;
  if (n <= 0) return "";
  const hit = THICKNESS_OPTIONS.find((o) => Math.abs(o.value - n) < 0.001);
  return hit ? hit.label : `${n}"`;
}

/**
 * Coverage (SF per bag/unit) at a given pour thickness. A flat-coverage product
 * (no reference thickness) ignores thickness. A scaling product's coverage is
 * inversely proportional to thickness: covSf @ refT → covSf × refT / t.
 */
type Num = number | string | null | undefined;

export function coverageAt(
  coverageSf: Num,
  refThicknessIn: Num,
  tIn: Num,
): number {
  const cov = Number(coverageSf) || 0;
  if (cov <= 0) return 0;
  const ref = Number(refThicknessIn) || 0;
  const t = Number(tIn) || 0;
  if (ref <= 0) return cov; // flat coverage (primers / adhesives)
  if (t <= 0) return cov; // no thickness entered yet → assume the reference
  return (cov * ref) / t;
}

/**
 * Bags/units needed for an area — ALWAYS rounds up (you can't buy a partial bag,
 * and under-ordering prep material is a real-world failure). Returns 0 when the
 * inputs can't produce a number.
 */
export function bagsNeeded(
  areaSf: Num,
  coverageSf: Num,
  refThicknessIn: Num,
  tIn: Num,
): number {
  const area = Number(areaSf) || 0;
  const per = coverageAt(coverageSf, refThicknessIn, tIn);
  if (area <= 0 || per <= 0) return 0;
  return Math.ceil(area / per);
}

/** Whether a product carries usable coverage data (drives the calculator UI). */
export function hasCoverage(coverageSf: number | string | null | undefined): boolean {
  return (Number(coverageSf) || 0) > 0;
}

// --- Defaults for the generic self-leveler the questionnaire / add-on paths
// drop in when no specific product is picked. Real numbers get filled per
// product in the catalog; these are just starting points.
export const DEFAULT_SELFLEVELER_COVERAGE_SF = 50; // SF per 50 lb bag
export const DEFAULT_REF_THICKNESS_IN = 0.125; // stated at 1/8"
export const DEFAULT_BAG_COST = 84; // our cost per bag
export const DEFAULT_LABOR_PER_SQFT = 1.5; // self-leveling labor $/sq ft
export const DEFAULT_LABOR_PER_BAG = 15; // self-leveling labor $/bag

/** Labor basis for self-leveling — its own line, quantity from the calculator. */
export type LaborBasis = "sqft" | "bag";
