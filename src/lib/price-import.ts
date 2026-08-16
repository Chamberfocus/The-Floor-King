/**
 * The shape of a staged price line, and the judgement calls about it.
 *
 * Deliberately free of any server-only import. The review screen is a client
 * component and needs these same rules — if it reached into the data layer for
 * them it would drag an SSH client into the browser bundle, and, worse, the
 * screen could drift from what apply actually does.
 */

export interface ImportLine {
  id: string;
  supplier_sku: string | null;
  description: string | null;
  new_cost: number | null;
  uom: string | null;
  product_id: string | null;
  old_cost: number | null;
  match_kind: string | null;
  applied: boolean;
  raw: Record<string, unknown> | null;
}

/**
 * Would applying this line move a cost, and is it safe to do unattended?
 *
 * Everything excluded here is excluded for a reason that costs money: a SKU
 * that matched another supplier's product, a price quoted in a unit we don't
 * sell in, or a list price masquerading as a cost.
 */
export function isSafeToApply(l: ImportLine): boolean {
  const raw = l.raw ?? {};
  return (
    l.match_kind === "exact" &&
    l.product_id != null &&
    l.new_cost != null &&
    l.new_cost !== l.old_cost &&
    raw.uom_mismatch !== true &&
    raw.list_price !== true
  );
}

/** How big a jump this is, as a fraction (0.25 = 25% up). Null if unknowable. */
export function costSwing(l: ImportLine): number | null {
  if (l.old_cost == null || l.new_cost == null || l.old_cost === 0) return null;
  return (l.new_cost - l.old_cost) / l.old_cost;
}
