/**
 * Guided questionnaire → estimate-line quantity mapping.
 *
 * One function decides where a typed Amount (or a measured area) lands on the
 * line the builder actually reads. `lineQty` prices AREA units from `sqft` and
 * COUNT units from `quantity`; the builder's "Sq ft" field is `sqft` and hides
 * quantity on area lines. Writing Amount only into `quantity` while labeling
 * the line sq ft / sq yd made the builder look empty and any later area edit
 * wipe the value.
 */
import { isAreaUnit, normalizeUnit, unitLabel } from "@/lib/units";
import type { CalcLine } from "@/lib/estimate-calc";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface QuestionnaireEmitQtyInput {
  /** Emit unit from the question config (`sqft` / `sqyd` / `each` / `lnft`…). */
  emitUnit: string;
  /** How quantity is sourced when there is no typed Amount. */
  per?: "area" | "flat" | "each" | null;
  /** Measured job area in square feet (used when per === "area"). */
  areaSqft: number;
  /**
   * Typed Amount from a number question. `undefined` means "not a number
   * override" (yes/no and choice still use per + area). `0` / negative skip
   * the line — the questionnaire does not emit a $0 quantity line.
   */
  qtyOverride?: number;
}

export interface QuestionnaireEmitQty {
  measure_unit: "sqft" | "sqyd";
  /** Square feet the builder's area field and `lineQty` read. Null on count lines. */
  sqft: number | null;
  /** Quantity in the emit unit (Amount, or derived from area, or 1). */
  quantity: number;
  /** Display / pricing unit label (`sq ft`, `each`, …). */
  unit: string;
}

/**
 * Map one questionnaire emit (+ optional typed Amount) onto the line fields
 * the builder, `lineQty`, save, and reload all share.
 */
export function questionnaireEmitToLineQty(
  args: QuestionnaireEmitQtyInput,
): QuestionnaireEmitQty | null {
  const unitKey = normalizeUnit(args.emitUnit);
  const area = isAreaUnit(args.emitUnit);
  const yd = unitKey === "sqyd";
  const per = args.per || "flat";

  let qty: number;
  if (args.qtyOverride != null) {
    qty = args.qtyOverride;
  } else if (per === "area") {
    // Taped square feet is not gallons, bags, each, or linear feet.
    // Number questions pass qtyOverride; count+area without an Amount is not an order.
    if (!area) return null;
    qty = yd ? Math.ceil(args.areaSqft / 9) : Math.ceil(args.areaSqft);
  } else if (per === "flat") {
    // One flat job charge (delivery / furniture moving / curb) — not an item count.
    qty = 1;
  } else {
    // per:each without Amount: type the count. Do not invent 1 T-mold / 1 lnft.
    return null;
  }
  if (!(qty > 0) || !Number.isFinite(qty)) return null;

  const unit = area
    ? yd
      ? "sq yd"
      : "sq ft"
    : unitLabel(args.emitUnit) || args.emitUnit || "";
  const measure_unit: "sqft" | "sqyd" = yd ? "sqyd" : "sqft";

  let sqft: number | null;
  if (!area) {
    // Count units never inherit taped square feet.
    sqft = null;
  } else if (args.qtyOverride != null) {
    // Amount is in the emit unit. Builder Sq ft + lineQty read square feet.
    sqft = r2(yd ? qty * 9 : qty);
  } else if (per === "area") {
    sqft = r2(args.areaSqft);
  } else {
    sqft = null;
  }

  return {
    measure_unit,
    sqft,
    quantity: r2(qty),
    unit,
  };
}

/**
 * Recover a missing `sqft` from a stored `quantity` on an area-billed line.
 * Fixes estimates saved before Amount was written into `sqft`.
 */
export function recoverAreaSqftFromQuantity(args: {
  unit: string | null | undefined;
  sqft: number | string | null | undefined;
  quantity: number | string | null | undefined;
}): string {
  const existing =
    args.sqft != null && args.sqft !== "" ? String(args.sqft) : "";
  const existingN = parseFloat(existing);
  if (existing !== "" && Number.isFinite(existingN) && existingN > 0) {
    return existing;
  }
  if (!isAreaUnit(args.unit)) return existing;
  const q =
    typeof args.quantity === "number"
      ? args.quantity
      : parseFloat(String(args.quantity ?? ""));
  if (!Number.isFinite(q) || !(q > 0)) return existing;
  if (normalizeUnit(args.unit) === "sqyd") return String(r2(q * 9));
  return String(q);
}

/** Shape the review step / tests feed into canonical `lineTotal`. */
export function smartLineToCalcLine(l: {
  category: string;
  sqft: number | null;
  quantity: number | null;
  unit: string;
  measure_unit: "sqft" | "sqyd";
  material_rate: number;
  labor_rate: number;
  material_cost: number;
  labor_cost: number;
  waste_pct: number;
}): CalcLine {
  return {
    line_type: "mat_labor",
    category: l.category,
    sqft: l.sqft,
    quantity: l.quantity,
    unit: l.unit,
    measure_unit: l.measure_unit,
    material_rate: l.material_rate,
    labor_rate: l.labor_rate,
    material_cost: l.material_cost,
    labor_cost: l.labor_cost,
    waste_pct: l.waste_pct,
  };
}
