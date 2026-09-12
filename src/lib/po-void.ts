/**
 * Pure PO void / receipt-reversal planner (no DB).
 * RPC void_purchase_order_safe is the financial authority.
 */
export const PO_VOID_HAS_OPEN_BILL =
  "This PO has an open vendor bill. Void or reverse the bill before voiding the PO.";
export const PO_VOID_UNSAFE =
  "Cannot void this PO: received stock was already consumed or cannot be reversed safely.";

export type PoReceiptMovementPlan = {
  id: string;
  qty: number;
  alreadyReversed: boolean;
};

export function planPoVoid(args: {
  status: string | null | undefined;
  openBillCount: number;
  movements: PoReceiptMovementPlan[];
}):
  | {
      ok: true;
      alreadyVoid: boolean;
      reverseIds: string[];
      reverseQty: number;
    }
  | { ok: false; code: "PO_VOID_HAS_OPEN_BILL"; error: string } {
  if ((args.openBillCount || 0) > 0) {
    return { ok: false, code: "PO_VOID_HAS_OPEN_BILL", error: PO_VOID_HAS_OPEN_BILL };
  }
  const alreadyVoid = (args.status ?? "") === "void";
  const reverseIds = (args.movements ?? [])
    .filter((m) => !m.alreadyReversed && (Number(m.qty) || 0) > 0.00005)
    .map((m) => m.id);
  const reverseQty = (args.movements ?? [])
    .filter((m) => !m.alreadyReversed)
    .reduce((s, m) => s + Math.max(0, Number(m.qty) || 0), 0);
  return {
    ok: true,
    alreadyVoid,
    reverseIds,
    reverseQty: Math.round(reverseQty * 10000) / 10000,
  };
}

export function poVoidIdempotencyKey(poId: string): string {
  return `po-void:${poId}`;
}

export function poReceiptReverseIdempotencyKey(
  poId: string,
  movementId: string,
): string {
  return `po-recv-rev:${poId}:${movementId}`;
}
