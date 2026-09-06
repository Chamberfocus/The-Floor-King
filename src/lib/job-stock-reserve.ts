/**
 * Stock reservation reconciliation — pure helpers for operational scope changes.
 */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Net reserved qty still committed to one job line (reserve/release minus pulled). */
export function netReservedQty(
  movements: { kind: string; qty: number }[],
): number {
  let reserved = 0;
  let pulled = 0;
  for (const m of movements) {
    const q = Number(m.qty) || 0;
    if (m.kind === "reserve" || m.kind === "release") reserved += q;
    else if (m.kind === "pull") pulled += Math.abs(q);
  }
  return Math.max(0, round2(reserved - pulled));
}

/**
 * How much reservation to release when need drops or a line is removed.
 * Never releases below what has already been pulled.
 */
export function excessReservation(
  reservedQty: number,
  needQty: number,
  pulledQty: number,
): number {
  const targetReserve = round2(Math.max(0, needQty - pulledQty));
  return round2(Math.max(0, reservedQty - targetReserve));
}

/** Line ids with ledger activity that are no longer on the work order. */
export function orphanedStockLineIds(
  movementLineIds: string[],
  currentStockLineIds: string[],
): string[] {
  const current = new Set(currentStockLineIds);
  return [...new Set(movementLineIds.filter((id) => id && !current.has(id)))];
}
