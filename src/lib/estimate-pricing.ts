/**
 * Target-margin → sell-rate helpers.
 *
 * Material freight is part of material cost when pricing to a target margin.
 * Labor is never freighted. Gas / car / commission stay job-level (not here).
 *
 * `material_cost` on the line stays BARE catalog cost. Freight is used only to
 * set the selling rate; `jobProfit` / `allInProfit` still apply freight once on
 * the cost side — never store a landed cost in `material_cost` or freight is
 * double-counted.
 */
import { num, priceFromMargin } from "@/lib/estimate-calc";
import { landedMaterialCost } from "@/lib/freight";

export interface TargetMarginRateInput {
  lineType: string;
  /** When true, material cost is ignored (labor category). */
  laborOnly: boolean;
  materialCost: number | string | null | undefined;
  laborCost: number | string | null | undefined;
  targetMarginPct: number;
  freightMarkupPct?: number | string | null;
}

export interface TargetMarginRates {
  material_rate?: number;
  labor_rate?: number;
  flat_amount?: number;
  installed_rate?: number;
}

/** Landed material unit/lump cost used when aiming at a target margin. */
export function landedMaterialForTarget(
  bareMaterialCost: number | string | null | undefined,
  freightMarkupPct?: number | string | null,
): number {
  return landedMaterialCost(num(bareMaterialCost), num(freightMarkupPct));
}

/**
 * Material unit sell from bare cost + target margin, with freight applied once
 * to the cost basis. Use for every auto “cost → sell at target margin” path.
 */
export function sellMaterialFromTargetMargin(
  bareMaterialCost: number | string | null | undefined,
  targetMarginPct: number | string | null | undefined,
  freightMarkupPct?: number | string | null,
): number {
  const bare = num(bareMaterialCost);
  if (!(bare > 0)) return 0;
  const landed = landedMaterialForTarget(bare, freightMarkupPct);
  return priceFromMargin(landed, num(targetMarginPct));
}

/** Labor unit sell from bare labor cost + target margin. Never freighted. */
export function sellLaborFromTargetMargin(
  laborCost: number | string | null | undefined,
  targetMarginPct: number | string | null | undefined,
): number {
  const c = num(laborCost);
  if (!(c > 0)) return 0;
  return priceFromMargin(c, num(targetMarginPct));
}

/**
 * Sell rates (or flat/installed amount) that yield `targetMarginPct` on
 * landed material + bare labor. Returns {} if the margin is out of range.
 */
export function ratesFromTargetMargin(
  input: TargetMarginRateInput,
): TargetMarginRates {
  const m = input.targetMarginPct;
  if (!(m >= 0 && m < 100)) return {};

  const landedMat = input.laborOnly
    ? 0
    : landedMaterialForTarget(input.materialCost, input.freightMarkupPct);
  const labor = num(input.laborCost);

  if (input.lineType === "flat") {
    const cost = landedMat + labor;
    return cost > 0 ? { flat_amount: priceFromMargin(cost, m) } : {};
  }
  if (input.lineType === "installed") {
    const cost = landedMat + labor;
    return cost > 0 ? { installed_rate: priceFromMargin(cost, m) } : {};
  }

  const out: TargetMarginRates = {};
  if (landedMat > 0) out.material_rate = priceFromMargin(landedMat, m);
  if (labor > 0) out.labor_rate = priceFromMargin(labor, m);
  return out;
}
