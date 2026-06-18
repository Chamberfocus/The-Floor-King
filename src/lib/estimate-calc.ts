import type { EstimatePresentation, LineType, MeasureUnit } from "@/lib/types";

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
}

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

/** Quantity used for pricing. An explicit `quantity` wins (e.g. add-ons by the
 *  each / linear foot); otherwise it's the measured area in the line's unit. */
export function lineQty(line: CalcLine): number {
  const q = num(line.quantity);
  if (q > 0) return q;
  return line.measure_unit === "sqyd"
    ? lineAreaSqyd(line)
    : lineAreaSqft(line);
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
      return (
        qty * num(line.material_rate) * wasteMult(line) +
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

/** OUR cost for a line (material + labor), quantity-aware. */
export function lineCost(line: CalcLine): number {
  const unitCost = num(line.material_cost) + num(line.labor_cost);
  if (line.line_type === "flat") return unitCost; // flat = a single lump cost
  return lineQty(line) * unitCost;
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
    // Waste raises material purchased (and our cost), not labor.
    material += q * num(line.material_cost) * wasteMult(line);
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

// --- Save payload shapes (shared by the client builder and the save action) --

export interface SaveLineInput {
  room: string;
  description: string;
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
