import { isAreaUnit, normalizeUnit, unitIsSqyd } from "@/lib/units";

/**
 * A salesperson's quick estimate has to become the same line the work order,
 * purchase order, and invoice already know how to read. Category, mill, style,
 * color, unit, and quantity travel with the line. Area units also store the
 * measured square feet so a square-yard quote does not get billed as a ninth
 * of itself.
 */
export interface QuickEstimateLineInput {
  description: string;
  quantity: string | number;
  unit: string;
  rate: string | number;
  cost?: string | number | null;
  productId?: string | null;
  category?: string | null;
  manufacturer?: string | null;
  style?: string | null;
  color?: string | null;
}

const n = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined || v === "") return 0;
  const x = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(x) ? x : 0;
};

export function quickEstimateCustomerNotes(notes: string): string | null {
  const text = notes.trim();
  return text || null;
}

export function quickEstimateLineRow(line: QuickEstimateLineInput, position: number) {
  const unit = normalizeUnit(line.unit) || (line.unit ?? "").trim();
  const qty = n(line.quantity);
  const area = Boolean(unit) && isAreaUnit(unit);
  const sqyd = area && unitIsSqyd(unit);
  // A labor product is priced on labor. Putting the sell in material_rate
  // would bill $0 — labor lines ignore a material price.
  const labor = (line.category ?? "").trim().toLowerCase() === "labor";
  const sell = n(line.rate);
  const cost = n(line.cost);
  return {
    position,
    description: line.description.trim(),
    unit,
    quantity: qty,
    line_type: "mat_labor" as const,
    measure_unit: (sqyd ? "sqyd" : "sqft") as "sqyd" | "sqft",
    sqft: area ? (sqyd ? qty * 9 : qty) : null,
    material_rate: labor ? 0 : sell,
    material_cost: labor ? 0 : cost,
    labor_rate: labor ? sell : 0,
    labor_cost: labor ? cost : 0,
    waste_pct: 0,
    product_id: line.productId ?? null,
    category: line.category ?? null,
    manufacturer: line.manufacturer ?? null,
    style: line.style ?? null,
    color: line.color ?? null,
  };
}
