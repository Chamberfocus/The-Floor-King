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

/** Quantity used for pricing, in the line's measure unit. */
export function lineQty(line: CalcLine): number {
  return line.measure_unit === "sqyd"
    ? lineAreaSqyd(line)
    : lineAreaSqft(line);
}

export function lineTotal(line: CalcLine): number {
  const qty = lineQty(line);
  switch (line.line_type) {
    case "mat_labor":
      return qty * (num(line.material_rate) + num(line.labor_rate));
    case "installed":
      return qty * num(line.installed_rate);
    case "flat":
      return num(line.flat_amount);
    default:
      return 0;
  }
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
  material_rate: string | number | null;
  labor_rate: string | number | null;
  installed_rate: string | number | null;
  flat_amount: string | number | null;
  product_id: string | null;
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
}

export interface WizardAnswer {
  question_id: string;
  label: string;
  kind: "detail" | "addon";
  included: boolean;
  value: string;
  amount: string | number | null;
}

export interface WizardSubmit {
  title: string;
  tax_rate: string | number;
  presentation: EstimatePresentation;
  rooms: WizardRoom[];
  answers: WizardAnswer[];
}
