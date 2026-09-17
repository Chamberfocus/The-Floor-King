/**
 * Measured area vs order quantity — the distinction the rest of the CRM
 * must never blur.
 *
 * MEASURED AREA  — what was taped: rooms × sections, in square feet.
 * EQUIVALENT YD  — measured sqft ÷ 9. A conversion, NOT a carpet order.
 * BILLING QTY    — measured area expressed in the product's billing unit
 *                  (sq ft or sq yd). Still not necessarily what to buy.
 * ORDER QUANTITY — what to purchase: cuts for roll goods when entered;
 *                  measured × (1 + waste) for boxed goods; carton-rounded
 *                  only when the product actually has coverage metadata.
 *
 * Carpet is roll goods. sqft ÷ 9 is never "the amount of carpet to order".
 */

import { billsBySquareYard, normalizeUnit, unitLabel } from "@/lib/units";
import {
  billsBySqydFamily,
  defaultWastePctForFamily,
  isBoxedFamily,
  isRollGoodsFamily,
  type FlooringFamily,
} from "./families";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export type QuantityKind = "measured" | "billing" | "order";

export interface MeasuredArea {
  /** Taped / calculated area in square feet. Canonical stored area. */
  sqft: number;
  /** Mathematical equivalent (sqft / 9). Never an order quantity by itself. */
  sqydEquivalent: number;
}

export interface CartonTakeoff {
  coverageSqft: number;
  cartonCount: number;
  orderedCoverageSqft: number;
}

export type OrderBasis =
  | "cuts"
  | "measured_plus_waste"
  | "measured_plus_waste_estimated"
  | "none";

export interface MaterialTakeoff {
  family: FlooringFamily;
  /** Catalog / billing unit key (sqft, sqyd, lnft, each, box…). */
  billingUnit: string;
  measured: MeasuredArea;
  wastePct: number;
  wasteSqft: number;
  /** Area after waste, before carton rounding — still square feet. */
  orderSqft: number;
  /**
   * Quantity to bill / print in `billingUnit`.
   * For sq yd this is orderSqft / 9 (or cut yards when basis is cuts).
   */
  billingQty: number;
  orderBasis: OrderBasis;
  cartons: CartonTakeoff | null;
  notes: string[];
  warnings: string[];
}

export function measuredArea(sqft: number): MeasuredArea {
  const n = Number.isFinite(sqft) && sqft > 0 ? r2(sqft) : 0;
  return { sqft: n, sqydEquivalent: r2(n / 9) };
}

export function equivalentSqyd(sqft: number): number {
  return measuredArea(sqft).sqydEquivalent;
}

export function sqydToSqft(sqyd: number): number {
  const n = Number.isFinite(sqyd) ? sqyd : 0;
  return r2(n * 9);
}

/**
 * Carton math. Returns null when coverage is missing or non-positive —
 * we do not invent a box size.
 */
export function cartonTakeoff(
  orderSqft: number,
  sqftPerBox: number | null | undefined,
): CartonTakeoff | null {
  const cov = Number(sqftPerBox);
  if (!(cov > 0) || !(orderSqft > 0)) return null;
  const cartonCount = Math.ceil(orderSqft / cov);
  return {
    coverageSqft: r4(cov),
    cartonCount,
    orderedCoverageSqft: r2(cartonCount * cov),
  };
}

export interface ComputeTakeoffInput {
  family: FlooringFamily;
  measuredSqft: number;
  /** Override the family default waste. Empty/undefined → family default. */
  wastePct?: number | null;
  /**
   * Sum of entered carpet/sheet cuts in square feet. When > 0 on roll goods,
   * this IS the order quantity (waste already in the layout).
   */
  cutsSqft?: number | null;
  /** Product `sqft_per_box` — only used when actually present. */
  sqftPerBox?: number | null;
  /** When true, skip waste even without cuts (explicit 0 on the line). */
  wasteAlreadyInQuantity?: boolean;
}

/**
 * One function for "how much do we measure vs how much do we buy".
 */
export function computeMaterialTakeoff(input: ComputeTakeoffInput): MaterialTakeoff {
  const family = input.family;
  const measured = measuredArea(input.measuredSqft);
  const notes: string[] = [];
  const warnings: string[] = [];
  const billingUnit = billsBySqydFamily(family) ? "sqyd" : "sqft";

  const cuts = Number(input.cutsSqft);
  const hasCuts = isRollGoodsFamily(family) && Number.isFinite(cuts) && cuts > 0;

  let wastePct: number;
  let orderSqft: number;
  let orderBasis: OrderBasis;

  if (measured.sqft <= 0 && !hasCuts) {
    return {
      family,
      billingUnit,
      measured,
      wastePct: 0,
      wasteSqft: 0,
      orderSqft: 0,
      billingQty: 0,
      orderBasis: "none",
      cartons: null,
      notes,
      warnings,
    };
  }

  if (hasCuts) {
    // Cuts are the professional order quantity. Do not add a second waste
    // factor — layout waste is already in the pieces.
    wastePct = 0;
    orderSqft = r2(cuts);
    orderBasis = "cuts";
    notes.push(
      "Order quantity comes from the entered cuts, not from converting measured square feet into yards.",
    );
    if (measured.sqft > 0 && Math.abs(orderSqft - measured.sqft) > 0.5) {
      notes.push(
        `Measured area ${measured.sqft} sq ft (${measured.sqydEquivalent} sq yd equivalent) vs cut area ${orderSqft} sq ft (${r2(orderSqft / 9)} sq yd).`,
      );
    }
  } else if (isRollGoodsFamily(family)) {
    wastePct =
      input.wastePct != null && Number.isFinite(Number(input.wastePct))
        ? Number(input.wastePct)
        : defaultWastePctForFamily(family);
    orderSqft = r2(measured.sqft * (1 + wastePct / 100));
    orderBasis = "measured_plus_waste_estimated";
    warnings.push(
      family === "carpet"
        ? "No cut list yet — this order quantity is an area estimate, not a professional carpet cut plan. Roll width, seams, direction, and pattern matching can require more material."
        : "No sheet layout yet — this order quantity is an area estimate. Roll width, seams, and pattern can require more material than the measured area.",
    );
  } else {
    wastePct =
      input.wasteAlreadyInQuantity
        ? 0
        : input.wastePct != null && Number.isFinite(Number(input.wastePct))
          ? Number(input.wastePct)
          : defaultWastePctForFamily(family);
    orderSqft = r2(measured.sqft * (1 + wastePct / 100));
    orderBasis = "measured_plus_waste";
  }

  // When cuts are the basis, "waste sq ft" is not a separate add-on.
  const wasteSqftOut = hasCuts ? 0 : r2(orderSqft - measured.sqft);

  const cartons = isBoxedFamily(family) ? cartonTakeoff(orderSqft, input.sqftPerBox) : null;
  if (isBoxedFamily(family) && !(Number(input.sqftPerBox) > 0)) {
    notes.push("No carton coverage on this product — carton count is not invented.");
  }
  if (cartons) {
    notes.push(
      `Carton coverage ${cartons.coverageSqft} sq ft → ${cartons.cartonCount} carton${cartons.cartonCount === 1 ? "" : "s"} (${cartons.orderedCoverageSqft} sq ft ordered).`,
    );
  }

  const billedSqft = cartons ? cartons.orderedCoverageSqft : orderSqft;
  const billingQty = billingUnit === "sqyd" ? r2(billedSqft / 9) : r2(billedSqft);

  return {
    family,
    billingUnit,
    measured,
    wastePct,
    wasteSqft: wasteSqftOut,
    orderSqft: cartons ? cartons.orderedCoverageSqft : orderSqft,
    billingQty,
    orderBasis,
    cartons,
    notes,
    warnings,
  };
}

/** Human labels that never mix sq ft with sq yd. */
export function formatSqft(n: number): string {
  return `${r2(n)} sq ft`;
}

export function formatSqyd(n: number): string {
  return `${r2(n)} sq yd`;
}

export function formatMeasuredLabel(m: MeasuredArea, opts?: { showEquivalentYd?: boolean }): string {
  if (!opts?.showEquivalentYd) return formatSqft(m.sqft);
  return `${formatSqft(m.sqft)} (${formatSqyd(m.sqydEquivalent)} equivalent area — not an order quantity)`;
}

export function formatBillingQty(qty: number, unit: string): string {
  const key = normalizeUnit(unit);
  const label = unitLabel(unit) || unit || "each";
  if (key === "sqyd") return `${r2(qty)} ${label}`;
  if (key === "sqft") return `${r2(qty)} ${label}`;
  return `${r2(qty)} ${label}`;
}

/**
 * Canonical accessory unit from the trim *type*.
 * T-mold must not match generic "mold" and become linear feet.
 * Quarter round / shoe / base are never square feet.
 */
export function accessoryUnitForType(type: string): "lnft" | "each" {
  const t = type || "";
  if (
    /t-?mold|reducer|end\s*cap|threshold|stair\s*nose|tread|riser|vent|register|transition|metal|gripper/i.test(
      t,
    )
  ) {
    return "each";
  }
  if (/base|shoe|quarter|cove|j-?channel|tack/i.test(t)) return "lnft";
  if (/mold/i.test(t)) return "lnft";
  return "each";
}

/**
 * Force a trim line onto lnft / each / pc. Area units (sq ft / sq yd) are
 * never valid for quarter round, shoe, base, or transitions.
 */
export function coerceTrimUnit(
  type: string,
  unit: string | null | undefined,
): "lnft" | "each" | "pc" {
  const locked = accessoryUnitForType(type);
  const key = normalizeUnit(unit);
  // Blank or area units are never valid on trim — lock to the type's unit.
  if (!key || key === "sqft" || key === "sqyd") return locked;
  if (locked === "lnft") {
    if (key === "pc" || key === "each" || key === "lnft") return key;
    return "lnft";
  }
  if (key === "pc") return "pc";
  return "each";
}

/**
 * Cut/roll width for carpet or sheet vinyl. Product `roll_width_ft` wins when
 * it is actually on the catalog row — we do not invent 12' or 15'.
 */
export function defaultCutWidthFt(opts: {
  family: FlooringFamily;
  productWidthFt?: number | null;
  configWidths?: number[] | null;
}): number {
  const fromProduct = Number(opts.productWidthFt);
  if (Number.isFinite(fromProduct) && fromProduct > 0) return fromProduct;
  const cfg = (opts.configWidths ?? []).filter((n) => Number.isFinite(n) && n > 0);
  if (cfg.length) return cfg[0]!;
  return opts.family === "vinyl" ? 12 : 12;
}

/** Width chips: question config + the product's real roll width when present. */
export function cutWidthChoicesFt(opts: {
  family: FlooringFamily;
  productWidthFt?: number | null;
  configWidths?: number[] | null;
}): number[] {
  const base =
    opts.configWidths && opts.configWidths.length
      ? opts.configWidths.filter((n) => Number.isFinite(n) && n > 0)
      : opts.family === "vinyl"
        ? [6, 12]
        : [12, 15];
  const extra = Number(opts.productWidthFt);
  const out = [...base];
  if (Number.isFinite(extra) && extra > 0 && !out.includes(extra)) out.push(extra);
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * Billing unit for a catalog category — delegates to units.ts so sheet vinyl
 * cannot drift back to square feet.
 */
export function billingUnitForCategory(category: string | null | undefined): "sqft" | "sqyd" {
  return billsBySquareYard(category) ? "sqyd" : "sqft";
}

export { r2 as round2 };
