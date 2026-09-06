// Installer bill — pure helpers shared by the estimate-approval snapshot and the
// bill generator, so both derive the SAME labor figures from one place.
//
// Everything here is COST-side (what we pay the installer): it reads
// `labor_cost` only and never touches `labor_rate`/`installed_rate` (customer
// sell) or `material_*`. That keeps the installer bill clean of margin and
// material, matching the print rules.
import { num, lineQty, optionCostTotals } from "@/lib/estimate-calc";
import type { EstimateLineItem } from "@/lib/types";

export const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export interface GeneratedBillLine {
  description: string;
  quantity: number;
  unit: string;
  rate: number; // our labor COST per unit (labor_cost), never the sell rate
  line_total: number;
}

/**
 * Bill lines generated from a job's WORK ORDER LABOR SCOPE. The labor scope is
 * exactly the `category === 'labor'` lines (the same set buildJobScope treats as
 * labor), priced at our labor COST. Nothing is invented: one bill line per real
 * labor line. If there are no labor lines, this returns [] and the caller shows
 * an empty state rather than fabricating rows.
 */
export function laborBillLinesFromScope(
  lines: EstimateLineItem[],
): GeneratedBillLine[] {
  const out: GeneratedBillLine[] = [];
  for (const l of lines) {
    if (l.category !== "labor") continue; // only the work-order labor scope
    const qty = l.line_type === "flat" ? 1 : lineQty(l);
    const rate = num(l.labor_cost); // our cost, isolated from material/sell
    const unit = l.unit || (l.measure_unit === "sqyd" ? "sqyd" : "sqft");
    const description =
      [l.room, l.description]
        .map((s) => (s ?? "").trim())
        .filter(Boolean)
        .join(" — ") || "Labor";
    out.push({
      description,
      quantity: round2(qty),
      unit,
      rate: round2(rate),
      line_total: round2(qty * rate),
    });
  }
  return out;
}

/**
 * The estimate's TOTAL isolated labor cost — snapshotted onto the job as
 * `estimated_labor_cost` when the estimate is approved. Uses the shared
 * optionCostTotals so it is exactly the estimate's labor cost with material
 * excluded. Waste raises labor for measured (non-flat) lines — same policy as
 * estimate-calc / optionCostTotals.
 */
export function estimatedLaborCostForOption(
  lines: EstimateLineItem[],
): number {
  return round2(optionCostTotals(lines as Parameters<typeof optionCostTotals>[0]).labor);
}
