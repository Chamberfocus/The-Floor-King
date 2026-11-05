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
  /** Which room this line belongs to. Blank means the whole job. */
  room?: string | null;
  /** Catalog SKU. Stored as item_no so the purchase order can print it. */
  sku?: string | null;
  sqftPerBox?: string | number | null;
  rollWidthFt?: string | number | null;
  coverageSqft?: string | number | null;
  coverageThicknessIn?: string | number | null;
}

const n = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined || v === "") return 0;
  const x = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(x) ? x : 0;
};

function blank(v: string | null | undefined): string | null {
  const text = (v ?? "").trim();
  return text || null;
}

/** A missing or zero coverage is "not set", never a made-up carton or roll. */
function positiveOrNull(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = n(v);
  return x > 0 ? x : null;
}

export function quickEstimateCustomerNotes(notes: string): string | null {
  const text = notes.trim();
  return text || null;
}

export function quickEstimateLineRow(line: QuickEstimateLineInput, position: number) {
  const unit = normalizeUnit(line.unit) || (line.unit ?? "").trim();
  const qty = n(line.quantity);
  const area = Boolean(unit) && isAreaUnit(unit);
  const sqyd = area && unitIsSqyd(unit);
  // A labor line is priced on labor. Putting the sell in material_rate
  // would bill $0 — labor lines ignore a material price. Labor is not a product.
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
    room: blank(line.room),
    item_no: blank(line.sku),
    sqft_per_box: positiveOrNull(line.sqftPerBox),
    roll_width_ft: positiveOrNull(line.rollWidthFt),
    coverage_sqft: positiveOrNull(line.coverageSqft),
    coverage_thickness_in: positiveOrNull(line.coverageThicknessIn),
  };
}

/**
 * Switching sq ft ↔ sq yd changes the quantity and the price together, so the
 * line total stays the same. Other unit changes leave the numbers alone.
 */
export function rescaleQuotedUnit(
  line: { quantity: string; rate: string; cost: string; unit: string },
  nextUnit: string,
): { quantity: string; rate: string; cost: string; unit: string } {
  const from = normalizeUnit(line.unit);
  const to = normalizeUnit(nextUnit) || nextUnit.trim();
  if (!to || from === to) return { ...line, unit: to || line.unit };
  const areaSwap =
    (from === "sqft" || from === "sqyd") && (to === "sqft" || to === "sqyd");
  if (!areaSwap) return { ...line, unit: to };
  const qtyFactor = from === "sqft" && to === "sqyd" ? 1 / 9 : 9;
  const scale = (raw: string, mult: number) => {
    if (raw.trim() === "") return "";
    const x = n(raw) * mult;
    const cents = Math.round(x * 100) / 100;
    if (Math.abs(x - cents) < 1e-8) return String(cents);
    return String(Math.round(x * 1e6) / 1e6);
  };
  return {
    quantity: scale(line.quantity, qtyFactor),
    rate: scale(line.rate, 1 / qtyFactor),
    cost: scale(line.cost, 1 / qtyFactor),
    unit: to,
  };
}
