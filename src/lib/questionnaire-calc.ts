// Smart auto-calcs for the guided questionnaire. Pure functions — the single
// source of truth for the math the estimator shouldn't have to do by hand.
// Bags reuse the builder's floor-prep engine (coverageAt/bagsNeeded).

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** A single carpet cut off the roll: a length (ft + in) against a roll width. */
export interface CarpetCut {
  lengthFt: number | string;
  lengthIn?: number | string;
  rollWidthFt: number | string; // 12 or 15 (the roll width the cut comes off)
}

/**
 * Total carpet to ORDER from a set of cuts. Each cut consumes
 * rollWidth × length off the roll, so its area = rollWidthFt × lengthFt. We sum
 * the areas and convert to square yards (÷9) — carpet is quoted by the sq yd.
 */
export function carpetYardageFromCuts(cuts: CarpetCut[]): {
  sqft: number;
  sqyd: number;
  perCut: { sqft: number; sqyd: number }[];
} {
  const perCut = cuts.map((c) => {
    const lenFt = num(c.lengthFt) + num(c.lengthIn) / 12;
    const widFt = num(c.rollWidthFt);
    const sqft = lenFt > 0 && widFt > 0 ? lenFt * widFt : 0;
    return { sqft: r2(sqft), sqyd: r2(sqft / 9) };
  });
  const sqft = perCut.reduce((s, c) => s + c.sqft, 0);
  return { sqft: r2(sqft), sqyd: r2(sqft / 9), perCut };
}

/** Per-step carpet allowance (sq ft of carpet per stair), by wrap style.
 *  Upholstered (cap & band) wraps the sides, so it uses more than a waterfall.
 *  Defaults — overridable per question via config.step_allowance_sqft. */
export const STAIR_ALLOWANCE_SQFT: Record<string, number> = {
  waterfall: 6, // ~ 2ft run × 3ft wide
  upholstered: 8, // wraps the nosing + sides
};

/** Carpet (sq ft + sq yd) needed for stairs: count × per-step allowance by type. */
export function stairsCarpet(
  count: number | string,
  type: string,
  allowanceSqft: number | string | null = null,
): { sqft: number; sqyd: number } {
  const n = Math.max(0, Math.ceil(num(count)));
  const per =
    num(allowanceSqft) > 0
      ? num(allowanceSqft)
      : STAIR_ALLOWANCE_SQFT[(type || "").toLowerCase()] ?? STAIR_ALLOWANCE_SQFT.waterfall;
  const sqft = n * per;
  return { sqft: r2(sqft), sqyd: r2(sqft / 9) };
}

/** Sheets of subfloor for an area. A 4'×8' sheet covers 32 sq ft; round UP so
 *  you never under-order. Sheet size overridable (e.g. 4'×8'=32, 2'×2'=4). */
export function subfloorSheets(
  areaSqft: number | string,
  sheetSqft: number | string = 32,
): number {
  const a = num(areaSqft);
  const s = num(sheetSqft) > 0 ? num(sheetSqft) : 32;
  return a > 0 ? Math.ceil(a / s) : 0;
}
