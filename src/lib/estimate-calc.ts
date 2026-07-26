import type {
  EstimatePresentation,
  LineMeasurement,
  LineType,
  MeasureUnit,
} from "@/lib/types";
import { isAreaUnit } from "@/lib/units";

/** Signed square feet of one measured piece (subtract = a cutout). */
export function measurementSqft(m: LineMeasurement): number {
  const area = (num(m.length_in) / 12) * (num(m.width_in) / 12);
  return m.op === "subtract" ? -area : area;
}

/** Total square feet built up from a line's measured pieces. */
export function measurementsSqft(list: LineMeasurement[] | null | undefined): number {
  if (!list?.length) return 0;
  return Math.round(list.reduce((s, m) => s + measurementSqft(m), 0) * 100) / 100;
}

/**
 * Pure pricing math shared by the live builder (client) and the server.
 * Accepts strings or numbers so it can run directly on form-input state.
 */
export interface CalcLine {
  line_type: LineType;
  sqft?: number | string | null;
  length_in?: number | string | null;
  width_in?: number | string | null;
  measure_unit?: MeasureUnit | null;
  material_rate?: number | string | null;
  labor_rate?: number | string | null;
  installed_rate?: number | string | null;
  flat_amount?: number | string | null;
  waste_pct?: number | string | null;
  // OUR cost + explicit quantity (for margin & post-job analysis).
  material_cost?: number | string | null;
  labor_cost?: number | string | null;
  quantity?: number | string | null;
  unit?: string | null;
  // A LABOR line charges labor only — any material rate/cost on it is ignored
  // (it belongs on its own material line, never double-charged here).
  category?: string | null;
}

/** A labor line is priced on labor alone — material never counts on it. */
const isLaborLine = (line: CalcLine): boolean => line.category === "labor";

export function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** Area in square feet: from L×W (inches) when present, else the sqft field. */
export function lineAreaSqft(line: CalcLine): number {
  const len = num(line.length_in);
  const wid = num(line.width_in);
  if (len > 0 && wid > 0) return (len / 12) * (wid / 12);
  return num(line.sqft);
}

export function lineAreaSqyd(line: CalcLine): number {
  return lineAreaSqft(line) / 9;
}

/**
 * Quantity used for pricing, decided by the line's UNIT KIND (not by whether a
 * quantity happens to be > 0):
 *  - COUNT units (each / bag / linear ft / sheet / gallon…) price by their
 *    explicit quantity and NEVER fall back to area — so a bag/pail line with a
 *    blank count is $0, not "priced by the square foot" (the old $33,600 bug).
 *  - AREA units (sq ft / sq yd, or unspecified) price by the MEASURED area, so a
 *    stray quantity can't override the real measurement. Only when there's no
 *    measurement at all does a stored quantity stand in (legacy area lines).
 */
export function lineQty(line: CalcLine): number {
  const countUnit = line.unit != null && line.unit !== "" && !isAreaUnit(line.unit);
  if (countUnit) return num(line.quantity);
  const area = line.measure_unit === "sqyd" ? lineAreaSqyd(line) : lineAreaSqft(line);
  if (area > 0) return area;
  return num(line.quantity);
}

/** Waste multiplier for material (e.g. 10% waste → 1.1). */
function wasteMult(line: CalcLine): number {
  return 1 + num(line.waste_pct) / 100;
}

export function lineTotal(line: CalcLine): number {
  const qty = lineQty(line);
  switch (line.line_type) {
    case "mat_labor":
      // Waste applies to material (you order extra); labor is on actual area.
      // A labor line charges labor only — a stray material rate is not added.
      return (
        (isLaborLine(line) ? 0 : qty * num(line.material_rate) * wasteMult(line)) +
        qty * num(line.labor_rate)
      );
    case "installed":
      return qty * num(line.installed_rate) * wasteMult(line);
    case "flat":
      return num(line.flat_amount);
    default:
      return 0;
  }
}

/** OUR cost for a line (material + labor), quantity-aware. Waste raises the
 *  material you buy (you pay for the extra ordered), not labor — matching
 *  lineTotal's sell side and optionCostTotals, so margins stay consistent. */
export function lineCost(line: CalcLine): number {
  const labor = isLaborLine(line);
  if (line.line_type === "flat") {
    return (labor ? 0 : num(line.material_cost)) + num(line.labor_cost); // flat = a single lump cost
  }
  const qty = lineQty(line);
  return (labor ? 0 : qty * num(line.material_cost) * wasteMult(line)) + qty * num(line.labor_cost);
}

export function lineProfit(line: CalcLine): number {
  return lineTotal(line) - lineCost(line);
}

/** Gross margin: profit as a % of the sell price. */
export function marginPct(sell: number, cost: number): number {
  return sell > 0 ? ((sell - cost) / sell) * 100 : 0;
}

/** Markup: profit as a % of cost. */
export function markupPct(sell: number, cost: number): number {
  return cost > 0 ? ((sell - cost) / cost) * 100 : 0;
}

/** Sell price that yields a target gross margin from a given cost. */
export function priceFromMargin(
  cost: number,
  targetMarginPct: number | string,
): number {
  const m = num(targetMarginPct) / 100;
  return m < 1 && m >= 0 ? cost / (1 - m) : cost;
}

export interface CostTotals {
  material: number;
  labor: number;
  cost: number;
}

export function optionCostTotals(lines: CalcLine[]): CostTotals {
  let material = 0;
  let labor = 0;
  for (const line of lines) {
    const q = line.line_type === "flat" ? 1 : lineQty(line);
    // Waste raises material purchased (and our cost), not labor. A labor line
    // contributes labor only.
    material += isLaborLine(line) ? 0 : q * num(line.material_cost) * wasteMult(line);
    labor += q * num(line.labor_cost);
  }
  return { material, labor, cost: material + labor };
}

export interface OptionTotals {
  subtotal: number;
  tax: number;
  total: number;
}

export function optionTotals(
  lines: CalcLine[],
  taxRatePct: number | string,
): OptionTotals {
  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const tax = subtotal * (num(taxRatePct) / 100);
  return { subtotal, tax, total: subtotal + tax };
}

/** Dollar value of an estimate-level discount ($ amount or % of subtotal). */
export function discountAmount(
  subtotal: number,
  kind: string | null | undefined,
  value: number | string | null | undefined,
): number {
  const v = num(value);
  if (v <= 0 || subtotal <= 0) return 0;
  return kind === "percent"
    ? Math.min((subtotal * v) / 100, subtotal)
    : Math.min(v, subtotal);
}

export interface DiscountedTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

/** Totals with an estimate-level discount applied before tax. One source of
 *  truth for the builder, the estimate view/print, and the invoice. */
export function optionTotalsWithDiscount(
  lines: CalcLine[],
  taxRatePct: number | string,
  discountKind: string | null | undefined,
  discountValue: number | string | null | undefined,
): DiscountedTotals {
  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const discount = discountAmount(subtotal, discountKind, discountValue);
  const taxable = subtotal - discount;
  const tax = taxable * (num(taxRatePct) / 100);
  return { subtotal, discount, tax, total: taxable + tax };
}

// --- Save payload shapes (shared by the client builder and the save action) --

export interface SaveLineInput {
  room: string;
  description: string;
  note?: string | null;
  line_type: LineType;
  sqft: string | number | null;
  length_in: string | number | null;
  width_in: string | number | null;
  measure_unit: MeasureUnit;
  category?: string | null;
  material_rate: string | number | null;
  labor_rate: string | number | null;
  installed_rate: string | number | null;
  flat_amount: string | number | null;
  waste_pct?: string | number | null;
  product_id: string | null;
  manufacturer?: string | null;
  style?: string | null;
  color?: string | null;
  item_no?: string | null;
  material_cost?: string | number | null;
  labor_cost?: string | number | null;
  quantity?: string | number | null;
  unit?: string | null;
  from_stock?: boolean;
  margin_pct?: string | number | null;
  order_as_roll?: boolean;
  roll_width_ft?: string | number | null;
  sqft_per_box?: string | number | null;
  is_fill?: boolean;
  is_optional?: boolean;
  coverage_sqft?: string | number | null;
  coverage_thickness_in?: string | number | null;
  prep_thickness_in?: string | number | null;
  prep_key?: string | null;
  measurements?: LineMeasurement[] | null;
}

export interface SaveOptionInput {
  name: string;
  notes: string;
  lines: SaveLineInput[];
}

export interface SaveEstimateInput {
  title: string;
  tax_rate: string | number;
  presentation: EstimatePresentation;
  notes: string;
  job_description: string;
  options: SaveOptionInput[];
  target_margin?: string | number | null;
  discount_kind?: "amount" | "percent" | string | null;
  discount_value?: string | number | null;
  /** Index (into options) of the owner-recommended option, or null. Resolved to
   *  the persisted option id by the save action. */
  recommended_index?: number | null;
}

// --- Wizard submission (one line per room + add-on lines) -------------------

export interface WizardRoom {
  name: string;
  sqft: string | number | null;
  length_in: string | number | null;
  width_in: string | number | null;
  measure_unit: MeasureUnit;
  product_id: string | null;
  description: string;
  line_type: "mat_labor" | "installed";
  material_rate: string | number | null;
  labor_rate: string | number | null;
  installed_rate: string | number | null;
  material_cost?: string | number | null;
  labor_cost?: string | number | null;
  category?: string | null;
  manufacturer?: string | null;
  style?: string | null;
  color?: string | null;
  item_no?: string | null;
}

export interface WizardAnswer {
  question_id: string;
  label: string;
  kind: "detail" | "addon";
  included: boolean;
  value: string;
  amount: string | number | null;
  // Add-ons priced by quantity × unit price, with our cost.
  quantity?: string | number | null;
  unit?: string | null;
  unit_price?: string | number | null;
  material_cost?: string | number | null;
  labor_cost?: string | number | null;
}

export interface WizardSubmit {
  title: string;
  tax_rate: string | number;
  presentation: EstimatePresentation;
  rooms: WizardRoom[];
  answers: WizardAnswer[];
}
