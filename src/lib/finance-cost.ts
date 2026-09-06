/**
 * F0 canonical cost helpers — avoid counting the same material spend twice.
 *
 * Period / owner P&L rule:
 * - Vendor bill payments post materials `expenses` (actual economic cost).
 * - Committed PO totals are a purchasing *commitment* until billed.
 * - When a PO already has an *open* vendor bill (`bills.po_id` + ap_lifecycle=open),
 *   do NOT also subtract that PO total (the AP bill is the actual).
 * - Unbilled committed POs still count as poSpend (commitment / open cost).
 * - Payments do not create a second expense.
 *
 * Job costing (F6-P4):
 * - Actual material prefers stock_movements kind=pull (consumption snapshot).
 * - Receipt alone is not job actual unless pulled.
 * - Open AP replaces PO commitment (existing exclusion helpers).
 *
 * Job costing may still show PO + stock + expenses with awareness; period net
 * uses this exclusion.
 */
export function committedPoSpendExcludingBilled(args: {
  poId: string;
  poTotal: number;
  billedPoIds: Set<string> | ReadonlySet<string>;
}): number {
  if (args.billedPoIds.has(args.poId)) return 0;
  return Math.max(0, Number(args.poTotal) || 0);
}

export function sumCommittedPoSpendExcludingBilled(
  pos: { id: string; total: number }[],
  billedPoIds: Set<string> | ReadonlySet<string>,
): number {
  return Math.round(
    pos.reduce(
      (s, p) =>
        s +
        committedPoSpendExcludingBilled({
          poId: p.id,
          poTotal: p.total,
          billedPoIds,
        }),
      0,
    ) * 100,
  ) / 100;
}

/** Job actual material from pull movements (snapshot extended_cost or qty×unit_cost). */
export function jobActualMaterialFromConsumption(
  pulls: { qty: number; unit_cost?: number | null; extended_cost?: number | null }[],
): number {
  return (
    Math.round(
      pulls.reduce((s, p) => {
        if (p.extended_cost != null && Number.isFinite(Number(p.extended_cost))) {
          return s + (Number(p.extended_cost) || 0);
        }
        return s + Math.abs(Number(p.qty) || 0) * (Number(p.unit_cost) || 0);
      }, 0) * 100,
    ) / 100
  );
}

/** Receipt without a pull is ownership, not job COGS. */
export function receiptIsJobActualMaterial(): boolean {
  return false;
}
