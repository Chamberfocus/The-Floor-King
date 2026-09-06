/**
 * F6-P4 inventory accounting — formulas, lock order, double-count rules.
 *
 * Source of truth: stock_movements (append-only ledger).
 * Cached fields on products (on_hand, reserved, avg_unit_cost, inventory_carrying_value)
 * must reconcile to movement economics; they are not an independent financial SoT.
 * Posting stays OFF.
 */

export const INVENTORY_LEDGER = "stock_movements" as const;

/** FINAL GLOBAL LOCK ORDER (compatible with 0174/0175). */
export const INV_LOCK_ORDER = [
  "IDEMPOTENCY", // advisory 178
  "JOB", // advisory 174
  "SOURCE", // PO + PO line FOR UPDATE
  "VENDOR_INVOICE", // advisory 176 when AP identity involved
  "PRODUCT_ROLL", // advisory 177
  "AP_BILL", // advisory 175 when bill-linked
  "MOVEMENT", // stock_movements FOR UPDATE on reverse
  "OUTBOX",
] as const;

export const INV_PRODUCT_LOCK_NAMESPACE = 177;
export const INV_IDEMPOTENCY_LOCK_NAMESPACE = 178;

export const INV_SOURCE_TYPES = [
  "po_receipt",
  "manual_receive",
  "job_pull",
  "job_reserve",
  "job_release",
  "adjust",
  "vendor_return",
  "job_return",
  "reversal",
  "legacy",
] as const;

export type InvSourceType = (typeof INV_SOURCE_TYPES)[number];

export const INV_MUTATION_RPCS = [
  "receive_inventory_safe",
  "reserve_inventory_safe",
  "release_inventory_safe",
  "consume_inventory_safe",
  "adjust_inventory_safe",
  "return_inventory_from_job_safe",
  "return_inventory_to_vendor_safe",
  "reverse_inventory_movement_safe",
  "inv_flag_receipt_ap_variance_safe",
  "inv_sync_rolled_on_hand_safe",
] as const;

export const INV_READ_RPCS = [
  "inv_on_hand",
  "inv_reserved",
  "inv_available",
  "inv_product_avg_cost",
  "inv_carrying_value",
  "inv_on_hand_value",
  "inv_job_consumed_qty",
  "inv_job_consumed_value",
  "inv_job_gross_consumed_qty",
  "inv_job_returned_qty",
  "inv_job_net_returnable_qty",
  "inv_job_net_material_actual",
  "inv_job_line_reserved_qty",
  "inv_po_item_received_qty",
  "inv_reconcile_product_value",
  "inv_rolled_available",
  "inv_list_movements_ops",
  "inv_list_movements_financial",
] as const;

export const INV_INTERNAL_HELPERS = [
  "inv_money_ok",
  "inv_qty_ok",
  "inv_lock_product",
  "inv_lock_products_sorted",
  "inv_lock_roll",
  "inv_lock_idempotency",
  "inv_begin_action",
  "inv_complete_action",
  "inv_apply_movement",
  "inv_apply_value_effect",
  "inv_plan_job_return_allocations",
] as const;

export const INV_MONEY_ERROR = {
  NAN: "INV_INVALID_AMOUNT: NaN/Infinity rejected.",
  NEGATIVE: "INV_INVALID_AMOUNT: negative amount rejected.",
  PRECISION: "INV_INVALID_AMOUNT: more than two decimal places.",
} as const;

export const INV_QTY_ERROR = {
  NAN: "INV_INVALID_QTY: NaN/Infinity rejected.",
  NEGATIVE: "INV_INVALID_QTY: negative quantity rejected.",
  PRECISION: "INV_INVALID_QTY: more than four decimal places.",
} as const;

export function roundMoney2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function roundQty4(n: number): number {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

export function parseInvMoney(
  v: number | string | null | undefined,
  opts?: { allowZero?: boolean },
): { ok: true; amount: number } | { ok: false; error: string } {
  const n = typeof v === "number" ? v : v == null || v === "" ? NaN : Number(v);
  if (Number.isNaN(n)) return { ok: false, error: INV_MONEY_ERROR.NAN };
  if (!Number.isFinite(n)) return { ok: false, error: INV_MONEY_ERROR.NAN };
  if (n < 0) return { ok: false, error: INV_MONEY_ERROR.NEGATIVE };
  if (!opts?.allowZero && n === 0) {
    return { ok: false, error: "INV_INVALID_AMOUNT: zero amount rejected." };
  }
  if (roundMoney2(n) !== n) return { ok: false, error: INV_MONEY_ERROR.PRECISION };
  return { ok: true, amount: roundMoney2(n) };
}

export function parseInvQty(
  v: number | string | null | undefined,
  opts?: { allowZero?: boolean },
): { ok: true; qty: number } | { ok: false; error: string } {
  const n = typeof v === "number" ? v : v == null || v === "" ? NaN : Number(v);
  if (Number.isNaN(n)) return { ok: false, error: INV_QTY_ERROR.NAN };
  if (!Number.isFinite(n)) return { ok: false, error: INV_QTY_ERROR.NAN };
  if (n < 0) return { ok: false, error: INV_QTY_ERROR.NEGATIVE };
  if (!opts?.allowZero && n === 0) {
    return { ok: false, error: "INV_INVALID_QTY: zero quantity rejected." };
  }
  if (roundQty4(n) !== n) return { ok: false, error: INV_QTY_ERROR.PRECISION };
  return { ok: true, qty: roundQty4(n) };
}

/** Carrying-value based average after a valued receive. */
export function applyReceiveCarrying(args: {
  onHand: number;
  carryingValue: number;
  receiveQty: number;
  receiveUnitCost: number;
}): { onHand: number; carryingValue: number; avgUnitCost: number | null } {
  const on = roundQty4((Number(args.onHand) || 0) + (Number(args.receiveQty) || 0));
  const carry = roundMoney2(
    (Number(args.carryingValue) || 0) +
      (Number(args.receiveQty) || 0) * (Number(args.receiveUnitCost) || 0),
  );
  if (Math.abs(on) < 0.00005) {
    return { onHand: 0, carryingValue: 0, avgUnitCost: null };
  }
  return { onHand: on, carryingValue: carry, avgUnitCost: roundQty4(carry / on) };
}

/** Legacy WAC helper — equivalent to carrying-value path for pure receives. */
export function movingWeightedAverage(args: {
  onHand: number;
  avgUnitCost: number | null;
  receiveQty: number;
  receiveUnitCost: number;
}): number {
  const priorCarry =
    (Number(args.onHand) || 0) * (args.avgUnitCost == null ? 0 : Number(args.avgUnitCost));
  const next = applyReceiveCarrying({
    onHand: args.onHand,
    carryingValue: priorCarry,
    receiveQty: args.receiveQty,
    receiveUnitCost: args.receiveUnitCost,
  });
  return next.avgUnitCost ?? (Number(args.receiveUnitCost) || 0);
}

export function availableQty(onHand: number, reserved: number): number {
  return Math.max(0, roundQty4((Number(onHand) || 0) - (Number(reserved) || 0)));
}

export function onHandValue(onHand: number, avgUnitCost: number | null): number {
  return roundMoney2((Number(onHand) || 0) * (Number(avgUnitCost) || 0));
}

export function pullExtendedCost(qty: number, unitCost: number | null): number {
  return roundMoney2(Math.abs(Number(qty) || 0) * (Number(unitCost) || 0));
}

export function netReturnableQty(grossConsumed: number, returned: number): number {
  return Math.max(0, roundQty4((Number(grossConsumed) || 0) - (Number(returned) || 0)));
}

export function secondReturnBlocked(args: {
  grossConsumed: number;
  alreadyReturned: number;
  requested: number;
}): boolean {
  return args.requested > netReturnableQty(args.grossConsumed, args.alreadyReturned) + 0.00005;
}

/** FIFO allocation of a job return against historical pulls. */
export function allocateJobReturnFifo(
  pulls: { id: string; qty: number; unitCost: number; alreadyReturned?: number }[],
  returnQty: number,
): { pullId: string; qty: number; unitCost: number; extendedCost: number }[] {
  let need = roundQty4(returnQty);
  const out: { pullId: string; qty: number; unitCost: number; extendedCost: number }[] = [];
  for (const p of pulls) {
    if (need <= 0.00005) break;
    const remain = roundQty4(
      Math.abs(p.qty) - (Number(p.alreadyReturned) || 0),
    );
    if (remain <= 0.00005) continue;
    const take = Math.min(need, remain);
    out.push({
      pullId: p.id,
      qty: take,
      unitCost: p.unitCost,
      extendedCost: roundMoney2(take * p.unitCost),
    });
    need = roundQty4(need - take);
  }
  if (need > 0.00005) {
    throw new Error(`INV_RETURN_EXCEEDS_CONSUMED: short ${need}`);
  }
  return out;
}

export function historicalReturnUnitCost(
  layers: { qty: number; extendedCost: number }[],
): number {
  const qty = layers.reduce((s, l) => s + l.qty, 0);
  const ext = layers.reduce((s, l) => s + l.extendedCost, 0);
  return qty > 0 ? roundQty4(ext / qty) : 0;
}

export function jobActualMaterialFromPulls(
  pulls: { qty: number; unit_cost: number | null; extended_cost?: number | null }[],
): number {
  return roundMoney2(
    pulls.reduce((s, p) => {
      if (p.extended_cost != null) return s + (Number(p.extended_cost) || 0);
      return s + pullExtendedCost(p.qty, p.unit_cost);
    }, 0),
  );
}

export function netJobMaterialActual(args: {
  pullExtended: number;
  jobReturnExtended: number;
}): number {
  return roundMoney2(
    (Number(args.pullExtended) || 0) - (Number(args.jobReturnExtended) || 0),
  );
}

export function zeroOnHandClearsPhantomValue(args: {
  onHand: number;
  carryingValue: number;
  avgUnitCost: number | null;
}): boolean {
  if (Math.abs(args.onHand) >= 0.00005) return true;
  return Math.abs(args.carryingValue) <= 0.02 && args.avgUnitCost == null;
}

export function reconcileCarryingAvg(args: {
  onHand: number;
  carryingValue: number;
  avgUnitCost: number | null;
}): boolean {
  if (Math.abs(args.onHand) < 0.00005) {
    return zeroOnHandClearsPhantomValue(args);
  }
  const derived = roundQty4(args.carryingValue / args.onHand);
  return (
    args.avgUnitCost != null &&
    Math.abs(Number(args.avgUnitCost) - derived) <= 0.00015
  );
}

export function receiptAloneIsJobActual(): boolean {
  return false;
}

export function apPaymentCreatesInventory(): boolean {
  return false;
}

export function apPaymentCreatesSecondJobMaterialCost(): boolean {
  return false;
}

export function receivingCreatesApOrExpense(): boolean {
  return false;
}

export function installerLaborCreatesInventory(): boolean {
  return false;
}

export function vendorApCreditFromReturnImplemented(): boolean {
  return false;
}

export function fullGrniAutomatedThisPhase(): boolean {
  return false;
}

export function historicalPullsRewriteOnLaterReceipt(): boolean {
  return false;
}

export function negativeStockAllowedForConsume(): boolean {
  return false;
}

export function receiptApVariancePolicy(): "review_required" {
  return "review_required";
}

export function jobReturnUsesCurrentWac(): boolean {
  return false;
}

export function rolledConsumeRequiresRollId(): boolean {
  return true;
}

export function warehouseMaySelectRawStockMovementCosts(): boolean {
  return false;
}

export function warehouseMaySelectProductAvgUnitCost(): boolean {
  return false;
}

export function rollSyncRewritesCarryingValue(): boolean {
  return false;
}

export function reverseLocksMovementBeforeJob(): boolean {
  return false;
}

export function productsAvgCostDirectUpdateAllowed(): boolean {
  return false;
}

/**
 * Physical-count serialization model: each request applies
 * delta = counted - locked_on_hand under exclusive product lock.
 * Concurrent count-to-N requests converge to N (not N - k*(initial-N)).
 */
export function simulateSerializedPhysicalCounts(
  initialOnHand: number,
  countedRequests: number[],
): number {
  let onHand = initialOnHand;
  for (const counted of countedRequests) {
    const delta = counted - onHand;
    onHand = onHand + delta; // == counted
  }
  return onHand;
}

/** Stale pre-lock delta bug: each request computes delta from the same snapshot. */
export function simulateStalePreLockDeltas(
  initialOnHand: number,
  countedRequests: number[],
): number {
  let onHand = initialOnHand;
  const deltas = countedRequests.map((c) => c - initialOnHand);
  for (const d of deltas) onHand += d;
  return onHand;
}

export function physicalCountContextHashParts(args: {
  productId: string;
  counted: number;
  reason: string;
  unitCost: number | null;
  economicDate: string;
  note: string | null;
}): Record<string, unknown> {
  // Must NOT include derived delta — only caller-controlled count context.
  return {
    product_id: args.productId,
    counted: args.counted,
    reason: args.reason,
    unit_cost: args.unitCost,
    economic_date: args.economicDate,
    note: args.note,
  };
}

/** Warehouse must not supply/override financial unit_cost on mutation RPCs. */
export function warehouseMaySupplyUnitCostOverride(): boolean {
  return false;
}

export function costOverrideAllowedRoles(): readonly string[] {
  return ["admin", "office"] as const;
}

export function poReceiptCostSource(): "locked_po_item" {
  return "locked_po_item";
}

/** Keys that must never appear on warehouse-shared mutation/idempotency responses. */
export function warehouseMutationResponseFinancialKeys(): readonly string[] {
  return [
    "unit_cost",
    "extended_cost",
    "value_delta",
    "avg_unit_cost",
    "carrying_value",
    "inventory_carrying_value",
    "unitCost",
    "valueDelta",
    "historicalAmount",
    "costOverride",
    "material_rate",
    "labor_rate",
    "clearance_price",
  ] as const;
}

export function assessInvIdempotency(args: {
  existing: { action: string; contextHash: string; status?: string } | null;
  action: string;
  contextHash: string;
}): "miss" | "hit" | "conflict" | "pending" {
  if (!args.existing) return "miss";
  if (
    args.existing.action !== args.action ||
    args.existing.contextHash !== args.contextHash
  ) {
    return "conflict";
  }
  if (args.existing.status === "pending") return "pending";
  return "hit";
}

export function invContextHashPayload(action: string, payload: unknown): string {
  return `${action}\u001f${JSON.stringify(payload)}`;
}

export function gucIsNotInventoryAuthorization(): boolean {
  return true;
}

export function inventorySelectRoles(): ("admin" | "office" | "warehouse")[] {
  return ["admin", "office", "warehouse"];
}

export function costVisibleRoles(): ("admin" | "office")[] {
  return ["admin", "office"];
}

export function inventoryPostingRemainsOff(): boolean {
  return true;
}

export function parallelInventoryMovementsTableAllowed(): boolean {
  return false;
}

export function materialCostLayers(): {
  estimated: string;
  committed: string;
  received: string;
  actual: string;
} {
  return {
    estimated: "job_line_items / approval snapshot",
    committed: "open committed POs (excluding billed)",
    received: "stock_movements kind=receive",
    actual: "net pull − job_return (historical snapshot)",
  };
}

export function lockOrderIndex(step: (typeof INV_LOCK_ORDER)[number]): number {
  return INV_LOCK_ORDER.indexOf(step);
}

export function productLocksMustBeSorted(): boolean {
  return true;
}

export function compareUuidForLock(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function jobScopedReservationRelease(
  jobReserved: number,
  releaseQty: number,
): boolean {
  return releaseQty <= jobReserved + 0.00005;
}

export function overReceiveBlocked(
  ordered: number,
  alreadyReceived: number,
  incoming: number,
): boolean {
  return alreadyReceived + incoming > ordered + 0.00005;
}
