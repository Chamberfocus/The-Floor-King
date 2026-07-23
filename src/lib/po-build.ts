import { lineQty } from "@/lib/estimate-calc";
import type { EstimateLineItem } from "@/lib/types";

/** A PO line row derived from estimate lines — the shape (minus po_id/position)
 *  that both PO creation and the carpet re-sync insert. */
export interface PoItemRow {
  product_id: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_cost: number;
  manufacturer: string | null;
  style: string | null;
  color: string | null;
  item_no: string | null;
  category: string | null;
  roll_width_ft: number | null;
}

/**
 * Turn a vendor's estimate lines into PO item rows — the ONE place the
 * carpet-cut → order math lives, shared by createPOFromEstimate and the carpet
 * re-sync so a PO's ordered yardage is always exactly what the cuts dictate.
 * A PO is a what-to-BUY list, so items are ordered COLLECTIVELY by product —
 * never split by room or area:
 *  - "order as roll" lines consolidate into one roll per product + width (the
 *    yardage that must come off the roll, fill pieces included),
 *  - every other line (hard surface / carton goods / individual cuts) is summed
 *    into one line per product — the same product used across rooms becomes a
 *    single PO line with the total quantity.
 * Per-piece cut sizes are NOT on the PO order line; they live on the warehouse
 * cut list. Carpet identity (category / roll_width_ft) rides along so the
 * re-sync can find and replace exactly the roll-good rows.
 */
export function buildPoItemRows(
  glines: EstimateLineItem[],
  opts: { costOf: (l: EstimateLineItem) => number; nameOf: (l: EstimateLineItem) => string },
): PoItemRow[] {
  const { costOf, nameOf } = opts;
  const cutLines = glines.filter((l) => !l.order_as_roll);
  const rollLines = glines.filter((l) => l.order_as_roll);

  // Combine the same product across rooms/areas into one collective PO line.
  const cutGroups = new Map<string, PoItemRow>();
  for (const l of cutLines) {
    const unit = l.unit || (l.measure_unit === "sqyd" ? "sqyd" : "sqft");
    const key = [
      l.product_id ?? nameOf(l).toLowerCase(),
      unit,
      l.manufacturer ?? "",
      l.style ?? "",
      l.color ?? "",
      l.item_no ?? "",
      l.category ?? "",
      l.roll_width_ft != null ? Number(l.roll_width_ft) : "",
    ].join("|");
    const qty = Math.round(lineQty(l) * 100) / 100;
    const existing = cutGroups.get(key);
    if (existing) {
      existing.quantity = Math.round((existing.quantity + qty) * 100) / 100;
      continue;
    }
    cutGroups.set(key, {
      product_id: l.product_id ?? null,
      description: nameOf(l),
      quantity: qty,
      unit,
      unit_cost: costOf(l),
      manufacturer: l.manufacturer ?? null,
      style: l.style ?? null,
      color: l.color ?? null,
      item_no: l.item_no ?? null,
      category: l.category ?? null,
      roll_width_ft: l.roll_width_ft != null ? Number(l.roll_width_ft) : null,
    });
  }
  const rows: PoItemRow[] = [...cutGroups.values()];

  // Group roll lines by product + width → one roll line (linear ft + yardage).
  const rollGroups = new Map<
    string,
    { product_id: string | null; width: number; sqyd: number; sample: EstimateLineItem }
  >();
  for (const l of rollLines) {
    const width = Number(l.roll_width_ft) > 0 ? Number(l.roll_width_ft) : 12;
    const key = `${l.product_id ?? nameOf(l)}|${width}`;
    const g = rollGroups.get(key) ?? { product_id: l.product_id ?? null, width, sqyd: 0, sample: l };
    // Roll math is in square yards regardless of the line's billing unit.
    const sqyd = l.measure_unit === "sqyd" ? lineQty(l) : lineQty(l) / 9;
    g.sqyd += sqyd;
    rollGroups.set(key, g);
  }
  for (const g of rollGroups.values()) {
    const sqyd = Math.round(g.sqyd * 100) / 100;
    const linft = Math.round(((sqyd * 9) / g.width) * 10) / 10;
    rows.push({
      product_id: g.product_id,
      description: `Full roll — ${nameOf(g.sample)} — ${linft} lin ft (${sqyd} sq yd) @ ${g.width} ft wide`,
      quantity: sqyd,
      unit: "sqyd",
      unit_cost: costOf(g.sample),
      manufacturer: g.sample.manufacturer ?? null,
      style: g.sample.style ?? null,
      color: g.sample.color ?? null,
      item_no: g.sample.item_no ?? null,
      category: g.sample.category ?? null,
      roll_width_ft: g.width,
    });
  }
  return rows;
}

/** A stable signature of a PO's carpet order, for drift detection. */
export function carpetSignature(
  rows: { product_id: string | null; roll_width_ft: number | null; quantity: number | null; description?: string }[],
): string {
  return rows
    .map((r) => `${r.product_id ?? r.description ?? "?"}|${r.roll_width_ft ?? ""}|${Math.round((r.quantity ?? 0) * 100) / 100}`)
    .sort()
    .join(";");
}
