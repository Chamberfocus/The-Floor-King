import type { EstimatePresentation, LineType } from "@/lib/types";

/**
 * Pure pricing math shared by the live builder (client) and the server.
 * Accepts strings or numbers so it can run directly on form-input state.
 */
export interface CalcLine {
  line_type: LineType;
  sqft?: number | string | null;
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

export function lineTotal(line: CalcLine): number {
  const sqft = num(line.sqft);
  switch (line.line_type) {
    case "mat_labor":
      return sqft * (num(line.material_rate) + num(line.labor_rate));
    case "installed":
      return sqft * num(line.installed_rate);
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
