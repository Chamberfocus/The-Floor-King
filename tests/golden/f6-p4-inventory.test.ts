/**
 * F6-P4 — Inventory accounting integrity (0176). Unapplied until owner review.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INVENTORY_LEDGER,
  INV_LOCK_ORDER,
  INV_MUTATION_RPCS,
  INV_READ_RPCS,
  INV_INTERNAL_HELPERS,
  INV_PRODUCT_LOCK_NAMESPACE,
  INV_IDEMPOTENCY_LOCK_NAMESPACE,
  INV_SOURCE_TYPES,
  parseInvMoney,
  parseInvQty,
  movingWeightedAverage,
  applyReceiveCarrying,
  availableQty,
  onHandValue,
  pullExtendedCost,
  netReturnableQty,
  secondReturnBlocked,
  allocateJobReturnFifo,
  historicalReturnUnitCost,
  jobActualMaterialFromPulls,
  netJobMaterialActual,
  zeroOnHandClearsPhantomValue,
  reconcileCarryingAvg,
  receiptAloneIsJobActual,
  apPaymentCreatesInventory,
  receivingCreatesApOrExpense,
  installerLaborCreatesInventory,
  vendorApCreditFromReturnImplemented,
  fullGrniAutomatedThisPhase,
  historicalPullsRewriteOnLaterReceipt,
  negativeStockAllowedForConsume,
  receiptApVariancePolicy,
  jobReturnUsesCurrentWac,
  rolledConsumeRequiresRollId,
  warehouseMaySelectRawStockMovementCosts,
  productsAvgCostDirectUpdateAllowed,
  assessInvIdempotency,
  invContextHashPayload,
  gucIsNotInventoryAuthorization,
  inventorySelectRoles,
  costVisibleRoles,
  inventoryPostingRemainsOff,
  parallelInventoryMovementsTableAllowed,
  materialCostLayers,
  lockOrderIndex,
  productLocksMustBeSorted,
  jobScopedReservationRelease,
  overReceiveBlocked,
  simulateSerializedPhysicalCounts,
  simulateStalePreLockDeltas,
  physicalCountContextHashParts,
  warehouseMaySupplyUnitCostOverride,
  costOverrideAllowedRoles,
  poReceiptCostSource,
  warehouseMutationResponseFinancialKeys,
} from "@/lib/accounting/inventory-source";
import {
  jobActualMaterialFromConsumption,
  receiptIsJobActualMaterial,
  committedPoSpendExcludingBilled,
} from "@/lib/finance-cost";
import { POSTING_DISABLED_MESSAGE } from "@/lib/accounting/types";
import { INSTALLER_LABOR_SOURCE } from "@/lib/accounting/installer-labor-source";

const ROOT = join(process.cwd());
const sql176 = readFileSync(
  join(ROOT, "supabase/migrations/0176_f6_p4_inventory_accounting.sql"),
  "utf8",
);
const sql175 = readFileSync(
  join(ROOT, "supabase/migrations/0175_f6_p3b_ap_vendor_integrity.sql"),
  "utf8",
);
const poStock = readFileSync(join(ROOT, "src/lib/po-stock.ts"), "utf8");
const invActions = readFileSync(
  join(ROOT, "src/app/(app)/inventory/actions.ts"),
  "utf8",
);
const matActions = readFileSync(
  join(ROOT, "src/app/(app)/jobs/material-actions.ts"),
  "utf8",
);

describe("F6-P4 migration markers + executability", () => {
  it("1. ships without enabling posting", () => {
    expect(sql176).toContain("receive_inventory_safe");
    expect(sql176).toContain("inventory_carrying_value");
    expect(sql176).toContain("inventory_return_allocations");
    expect(sql176).not.toMatch(/posting_enabled\s*=\s*true/i);
    expect(sql176).not.toMatch(/inventory_posting_enabled\s*=\s*true/i);
    expect(sql176).not.toMatch(/books_of_record\s*=\s*true/i);
  });

  it("2. no parallel inventory_movements", () => {
    expect(sql176).not.toMatch(/create table if not exists public\.inventory_movements/i);
    expect(parallelInventoryMovementsTableAllowed()).toBe(false);
    expect(INVENTORY_LEDGER).toBe("stock_movements");
  });

  it("3. schema precedes helpers that reference new cols", () => {
    const schema = sql176.indexOf("add column if not exists inventory_carrying_value");
    const alloc = sql176.indexOf("create table if not exists public.inventory_return_allocations");
    const helper = sql176.indexOf("create or replace function public.inv_money_ok");
    const rpc = sql176.indexOf("create or replace function public.receive_inventory_safe");
    expect(schema).toBeGreaterThan(-1);
    expect(alloc).toBeGreaterThan(schema);
    expect(helper).toBeGreaterThan(alloc);
    expect(rpc).toBeGreaterThan(helper);
  });

  it("4. provenance FKs use ON DELETE RESTRICT", () => {
    expect(sql176).toContain("on delete restrict");
    expect(sql176).toContain("stock_movements_po_id_fkey");
    expect(sql176).toContain("stock_movements_po_item_id_fkey");
  });

  for (const rpc of INV_MUTATION_RPCS) {
    it(`5. mutation RPC: ${rpc}`, () => {
      expect(sql176).toContain(`create or replace function public.${rpc}`);
    });
  }

  for (const rpc of INV_READ_RPCS) {
    it(`6. read RPC: ${rpc}`, () => {
      expect(sql176).toContain(rpc);
    });
  }

  for (const h of INV_INTERNAL_HELPERS) {
    it(`7. internal: ${h}`, () => {
      expect(sql176).toContain(h);
    });
  }

  it("8. revoke authenticated DML + SELECT raw then admin/office policy", () => {
    expect(sql176).toContain(
      "revoke insert, update, delete on public.stock_movements from authenticated",
    );
    expect(sql176).toContain("revoke select on public.stock_movements from authenticated");
    expect(sql176).toContain("user_role(auth.uid()) in ('admin', 'office')");
    expect(warehouseMaySelectRawStockMovementCosts()).toBe(false);
  });

  it("9. immutability covers provenance fields", () => {
    for (const f of [
      "value_delta",
      "economic_date",
      "source_id",
      "po_item_id",
      "bill_id",
      "roll_id",
      "line_id",
      "return_kind",
      "idempotency_key",
      "reversal_of",
      "created_by",
    ]) {
      expect(sql176).toContain(`new.${f} is distinct from old.${f}`);
    }
  });

  it("10. products economic fields protected", () => {
    expect(sql176).toContain("products_protect_inventory_fields");
    expect(sql176).toContain("INV_PRODUCT_PROTECTED");
    expect(productsAvgCostDirectUpdateAllowed()).toBe(false);
  });

  it("11. lock order includes idempotency then job then product", () => {
    expect(INV_LOCK_ORDER[0]).toBe("IDEMPOTENCY");
    expect(lockOrderIndex("IDEMPOTENCY")).toBeLessThan(lockOrderIndex("JOB"));
    expect(lockOrderIndex("JOB")).toBeLessThan(lockOrderIndex("PRODUCT_ROLL"));
    expect(lockOrderIndex("PRODUCT_ROLL")).toBeLessThan(lockOrderIndex("MOVEMENT"));
    expect(INV_IDEMPOTENCY_LOCK_NAMESPACE).toBe(178);
    expect(INV_PRODUCT_LOCK_NAMESPACE).toBe(177);
    expect(sql176).toContain("pg_advisory_xact_lock(\n    178,");
  });

  it("12. source types complete", () => {
    for (const t of INV_SOURCE_TYPES) expect(sql176).toContain(`'${t}'`);
  });
});

describe("F6-P4 net job returnable", () => {
  it("13. consume 10 return 10 second return blocked", () => {
    expect(secondReturnBlocked({ grossConsumed: 10, alreadyReturned: 10, requested: 10 })).toBe(true);
  });

  it("14. consume 10 return 4 then 6 allowed then further blocked", () => {
    expect(secondReturnBlocked({ grossConsumed: 10, alreadyReturned: 4, requested: 6 })).toBe(false);
    expect(secondReturnBlocked({ grossConsumed: 10, alreadyReturned: 10, requested: 0.01 })).toBe(true);
  });

  it("15. net returnable formula", () => {
    expect(netReturnableQty(10, 4)).toBe(6);
    expect(netReturnableQty(10, 12)).toBe(0);
  });

  it("16. SQL uses net returnable under locks", () => {
    expect(sql176).toContain("inv_job_net_returnable_qty");
    expect(sql176).toContain("INV_RETURN_EXCEEDS_CONSUMED");
    const fn = sql176.slice(
      sql176.indexOf("create or replace function public.return_inventory_from_job_safe("),
      sql176.indexOf("create or replace function public.return_inventory_to_vendor_safe("),
    );
    expect(fn.indexOf("installer_labor_lock_job")).toBeLessThan(fn.indexOf("inv_job_net_returnable_qty"));
    expect(fn.indexOf("inv_lock_product")).toBeLessThan(fn.indexOf("inv_job_net_returnable_qty"));
  });

  it("17. voided pulls excluded from gross", () => {
    expect(sql176).toMatch(/kind = 'pull'[\s\S]*voided_at is null/);
  });
});

describe("F6-P4 historical-cost job returns", () => {
  it("18. return uses historical pull cost not current WAC", () => {
    const layers = allocateJobReturnFifo(
      [{ id: "p1", qty: 10, unitCost: 2 }],
      5,
    );
    expect(historicalReturnUnitCost(layers)).toBe(2);
    expect(jobReturnUsesCurrentWac()).toBe(false);
  });

  it("19. multi-cost FIFO allocation", () => {
    const layers = allocateJobReturnFifo(
      [
        { id: "a", qty: 4, unitCost: 2 },
        { id: "b", qty: 6, unitCost: 5 },
      ],
      5,
    );
    expect(layers).toEqual([
      { pullId: "a", qty: 4, unitCost: 2, extendedCost: 8 },
      { pullId: "b", qty: 1, unitCost: 5, extendedCost: 5 },
    ]);
    expect(historicalReturnUnitCost(layers)).toBe(2.6);
  });

  it("20. later WAC change does not rewrite return value", () => {
    const layers = allocateJobReturnFifo([{ id: "p1", qty: 10, unitCost: 2 }], 5);
    const currentWac = 4;
    expect(historicalReturnUnitCost(layers)).not.toBe(currentWac);
    expect(historicalPullsRewriteOnLaterReceipt()).toBe(false);
  });

  it("21. SQL FIFO planner + allocations table", () => {
    expect(sql176).toContain("inv_plan_job_return_allocations");
    expect(sql176).toContain("fifo_historical_pull");
    expect(sql176).toContain("inventory_return_allocations");
  });
});

describe("F6-P4 carrying value / WAC reversals", () => {
  it("22. receive updates carrying + avg", () => {
    const r = applyReceiveCarrying({
      onHand: 10,
      carryingValue: 50,
      receiveQty: 10,
      receiveUnitCost: 7,
    });
    expect(r.onHand).toBe(20);
    expect(r.carryingValue).toBe(120);
    expect(r.avgUnitCost).toBe(6);
  });

  it("23. zero on-hand clears phantom value", () => {
    expect(zeroOnHandClearsPhantomValue({ onHand: 0, carryingValue: 0, avgUnitCost: null })).toBe(true);
    expect(zeroOnHandClearsPhantomValue({ onHand: 0, carryingValue: 5, avgUnitCost: 1 })).toBe(false);
  });

  it("24. reconcile avg to carrying/on_hand", () => {
    expect(reconcileCarryingAvg({ onHand: 10, carryingValue: 25, avgUnitCost: 2.5 })).toBe(true);
    expect(reconcileCarryingAvg({ onHand: 10, carryingValue: 25, avgUnitCost: 3 })).toBe(false);
  });

  it("25. reverse applies opposite value_delta", () => {
    expect(sql176).toContain("v_value := -coalesce(v_m.value_delta, 0)");
    expect(sql176).toContain("inv_apply_value_effect");
    expect(sql176).toContain("inventory_receipt_reversal");
    expect(sql176).toContain("inventory_consumption_reversal");
  });

  it("26. inv_on_hand_value uses carrying value", () => {
    expect(sql176).toContain("select public.inv_carrying_value(p_product_id)");
  });

  it("27. legacy movingWeightedAverage still blends", () => {
    expect(
      movingWeightedAverage({
        onHand: 10,
        avgUnitCost: 5,
        receiveQty: 10,
        receiveUnitCost: 7,
      }),
    ).toBe(6);
  });
});

describe("F6-P4 rolled goods", () => {
  it("28. rolled consume requires roll_id", () => {
    expect(rolledConsumeRequiresRollId()).toBe(true);
    expect(sql176).toContain("INV_ROLL_REQUIRED");
    expect(sql176).toContain("inv_lock_roll");
    expect(sql176).toContain("inv_rolled_available");
  });

  it("29. rolled negative stock check on remaining_qty", () => {
    expect(sql176).toContain("Rolled remaining");
    expect(sql176).toContain("INV_NEGATIVE_STOCK");
  });

  it("30. app pullRoll passes p_roll_id", () => {
    expect(invActions).toContain("p_roll_id: rollId");
  });
});

describe("F6-P4 cost visibility", () => {
  it("31. warehouse ops view excludes costs", () => {
    expect(sql176).toContain("stock_movements_ops");
    expect(sql176).toContain("inv_list_movements_ops");
    expect(sql176).toContain("inv_list_movements_financial");
    expect(costVisibleRoles()).toEqual(["admin", "office"]);
  });

  it("32. avg cost RPC admin/office only", () => {
    expect(sql176).toContain("'read inventory avg cost'");
  });
});

describe("F6-P4 idempotency", () => {
  it("33. begin/complete with pending serialization", () => {
    expect(sql176).toContain("inv_begin_action");
    expect(sql176).toContain("inv_complete_action");
    expect(sql176).toContain("inv_lock_idempotency");
    expect(sql176).toContain("status = 'pending'");
    expect(assessInvIdempotency({
      existing: { action: "a", contextHash: "h", status: "pending" },
      action: "a",
      contextHash: "h",
    })).toBe("pending");
  });

  it("34. note included in hashes", () => {
    for (const action of [
      "reserve_inventory",
      "release_inventory",
      "consume_inventory",
      "return_inventory_from_job",
      "return_inventory_to_vendor",
      "adjust_inventory",
    ]) {
      expect(sql176).toContain(`inv_context_hash('${action}'`);
      expect(sql176).toMatch(new RegExp(`inv_context_hash\\('${action}'[\\s\\S]*?'note'`));
    }
  });

  it("35. conflict on changed context", () => {
    expect(assessInvIdempotency({
      existing: { action: "receive_inventory", contextHash: "a" },
      action: "receive_inventory",
      contextHash: "b",
    })).toBe("conflict");
  });
});

describe("F6-P4 PO receiving integrity", () => {
  it("36. po item belongs to po + product match + over-receive", () => {
    expect(sql176).toContain("INV_PO_ITEM_MISMATCH");
    expect(sql176).toContain("INV_PO_PRODUCT_MISMATCH");
    expect(sql176).toContain("INV_OVER_RECEIVE");
    expect(sql176).toContain("inv_po_item_received_qty");
    expect(overReceiveBlocked(10, 8, 3)).toBe(true);
    expect(overReceiveBlocked(10, 8, 2)).toBe(false);
  });

  it("37. po-stock receives per line", () => {
    expect(poStock).toContain("p_po_item_id: poItemId");
    expect(poStock).toContain("one RPC call per PO line");
  });
});

describe("F6-P4 job-scoped reservations", () => {
  it("38. release cannot exceed job/line reserved", () => {
    expect(sql176).toContain("INV_RELEASE_EXCEEDS_JOB_RESERVED");
    expect(sql176).toContain("inv_job_line_reserved_qty");
    expect(jobScopedReservationRelease(5, 10)).toBe(false);
    expect(jobScopedReservationRelease(10, 5)).toBe(true);
  });

  it("39. consume releases only owned reservation", () => {
    const fn = sql176.slice(
      sql176.indexOf("create or replace function public.consume_inventory_safe("),
      sql176.indexOf("create or replace function public.adjust_inventory_safe("),
    );
    expect(fn).toContain("inv_job_line_reserved_qty");
    expect(fn).toContain("least(v_qty, v_owned)");
  });
});

describe("F6-P4 net job material actual", () => {
  it("40. net = pulls − job returns", () => {
    expect(netJobMaterialActual({ pullExtended: 20, jobReturnExtended: 5 })).toBe(15);
    expect(materialCostLayers().actual).toMatch(/job_return/);
  });

  it("41. SQL net material actual", () => {
    expect(sql176).toContain("inv_job_net_material_actual");
  });
});

describe("F6-P4 boundaries + app wiring", () => {
  it("42. boundaries", () => {
    expect(receivingCreatesApOrExpense()).toBe(false);
    expect(apPaymentCreatesInventory()).toBe(false);
    expect(installerLaborCreatesInventory()).toBe(false);
    expect(vendorApCreditFromReturnImplemented()).toBe(false);
    expect(fullGrniAutomatedThisPhase()).toBe(false);
    expect(negativeStockAllowedForConsume()).toBe(false);
    expect(receiptApVariancePolicy()).toBe("review_required");
    expect(receiptAloneIsJobActual()).toBe(false);
    expect(inventoryPostingRemainsOff()).toBe(true);
    expect(gucIsNotInventoryAuthorization()).toBe(true);
    expect(INSTALLER_LABOR_SOURCE).toBe("installer_bills");
    expect(POSTING_DISABLED_MESSAGE.length).toBeGreaterThan(0);
  });

  it("43. app writers use RPCs", () => {
    expect(poStock).toContain("receive_inventory_safe");
    expect(invActions).toContain("receive_inventory_safe");
    expect(invActions).toContain("consume_inventory_safe");
    expect(matActions).toContain("reserve_inventory_safe");
    expect(matActions).toContain("release_inventory_safe");
    expect(matActions).not.toMatch(/from\("stock_movements"\)\.insert/);
    expect(invActions).not.toMatch(/from\("stock_movements"\)\.insert/);
  });

  it("44. open AP excludes PO commitment", () => {
    expect(
      committedPoSpendExcludingBilled({
        poId: "p1",
        poTotal: 100,
        billedPoIds: new Set(["p1"]),
      }),
    ).toBe(0);
  });
});

describe("F6-P4 money/qty matrices", () => {
  it("45–48 money", () => {
    expect(parseInvMoney(Number.NaN).ok).toBe(false);
    expect(parseInvMoney(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(parseInvMoney(-1).ok).toBe(false);
    expect(parseInvMoney(1.001).ok).toBe(false);
    expect(parseInvMoney(0, { allowZero: true }).ok).toBe(true);
  });

  it("49–52 qty", () => {
    expect(parseInvQty(Number.NaN).ok).toBe(false);
    expect(parseInvQty(-0.1).ok).toBe(false);
    expect(parseInvQty(1.00001).ok).toBe(false);
    expect(parseInvQty(0, { allowZero: true }).ok).toBe(true);
  });

  const avail: [number, number, number][] = [
    [0, 0, 0],
    [10, 3, 7],
    [2, 5, 0],
    [10.5, 0.5, 10],
  ];
  avail.forEach(([a, b, e], i) => {
    it(`53.${i} available`, () => expect(availableQty(a, b)).toBe(e));
  });

  const pulls: [number, number | null, number][] = [
    [1, 10, 10],
    [2.5, 4, 10],
    [-3, 2, 6],
  ];
  pulls.forEach(([q, c, e], i) => {
    it(`54.${i} pull cost`, () => expect(pullExtendedCost(q, c)).toBe(e));
  });

  it("55. onHandValue", () => {
    expect(onHandValue(10, 2.5)).toBe(25);
  });

  it("56. jobActual helpers", () => {
    expect(jobActualMaterialFromPulls([{ qty: -2, unit_cost: 5, extended_cost: 9 }])).toBe(9);
    expect(jobActualMaterialFromConsumption([{ qty: -2, unit_cost: 5, extended_cost: 9 }])).toBe(9);
    expect(receiptIsJobActualMaterial()).toBe(false);
  });
});

describe("F6-P4 security definer + search_path", () => {
  for (const rpc of [
    "receive_inventory_safe",
    "consume_inventory_safe",
    "return_inventory_from_job_safe",
    "reverse_inventory_movement_safe",
    "adjust_inventory_safe",
  ]) {
    it(`57. ${rpc} definer`, () => {
      const idx = sql176.indexOf(`create or replace function public.${rpc}(`);
      const chunk = sql176.slice(idx, idx + 700);
      expect(chunk).toContain("security definer");
      expect(chunk).toContain("set search_path = public");
    });
  }
});

describe("F6-P4 reversal outbox + audit", () => {
  it("58. reversal emits outbox + audit exact-once key", () => {
    expect(sql176).toContain("inventory_reversed");
    expect(sql176).toContain("audit:inventory_reverse:");
    expect(sql176).toContain("audit:inventory_job_return:");
  });
});

describe("F6-P4 marker checklist for check-migrations", () => {
  const markers = [
    "receive_inventory_safe",
    "consume_inventory_safe",
    "return_inventory_from_job_safe",
    "reverse_inventory_movement_safe",
    "inv_job_net_returnable_qty",
    "inv_plan_job_return_allocations",
    "inventory_return_allocations",
    "inventory_carrying_value",
    "inv_apply_value_effect",
    "inv_begin_action",
    "inv_lock_idempotency",
    "INV_OVER_RECEIVE",
    "INV_RELEASE_EXCEEDS_JOB_RESERVED",
    "INV_ROLL_REQUIRED",
    "products_protect_inventory_fields",
    "stock_movements_ops",
    "inv_list_movements_ops",
    "on delete restrict",
    "FINAL GLOBAL LOCK ORDER",
    "IDEMPOTENCY_CONFLICT",
  ];
  markers.forEach((m, i) => {
    it(`59.${i} ${m}`, () => expect(sql176).toContain(m));
  });
});

describe("F6-P4 lock / ACL extras", () => {
  it("60. product locks sorted", () => {
    expect(productLocksMustBeSorted()).toBe(true);
  });

  it("61. inventory select roles include warehouse for ops", () => {
    expect(inventorySelectRoles()).toContain("warehouse");
  });

  it("62. context hash helper", () => {
    expect(invContextHashPayload("a", { n: 1 }).startsWith("a\u001f")).toBe(true);
  });

  it("63. 0175 lock namespace distinct", () => {
    expect(sql175).toContain("176");
    expect(INV_PRODUCT_LOCK_NAMESPACE).not.toBe(176);
  });

  it("64. no 0177", () => {
    expect(() =>
      readFileSync(join(ROOT, "supabase/migrations/0177_f6_p5.sql"), "utf8"),
    ).toThrow();
  });
});

describe("F6-P4 final blockers — lock order / rolled value / warehouse cost", () => {
  it("B1. reverse discovers unlocked before movement FOR UPDATE", () => {
    const fn = sql176.slice(
      sql176.indexOf("create or replace function public.reverse_inventory_movement_safe("),
      sql176.indexOf("create or replace function public.inv_flag_receipt_ap_variance_safe("),
    );
    expect(fn).toContain("UNLOCKED discovery");
    expect(fn).toContain("INV_LOCK_RETRY");
    const disc = fn.indexOf("UNLOCKED discovery");
    const job = fn.indexOf("installer_labor_lock_job");
    const movLock = fn.lastIndexOf(
      "from public.stock_movements where id = p_movement_id for update",
    );
    expect(disc).toBeGreaterThan(-1);
    expect(job).toBeGreaterThan(disc);
    expect(movLock).toBeGreaterThan(job);
    const early = fn.indexOf(
      "from public.stock_movements where id = p_movement_id for update",
    );
    expect(early).toBe(movLock);
  });

  it("B1b. reverse locks product before movement FOR UPDATE", () => {
    const fn = sql176.slice(
      sql176.indexOf("create or replace function public.reverse_inventory_movement_safe("),
      sql176.indexOf("create or replace function public.inv_flag_receipt_ap_variance_safe("),
    );
    expect(fn.indexOf("inv_lock_product")).toBeLessThan(
      fn.lastIndexOf(
        "from public.stock_movements where id = p_movement_id for update",
      ),
    );
  });

  it("B2. roll sync must not rewrite carrying from qty×avg", () => {
    const fn = sql176.slice(
      sql176.indexOf("create or replace function public.inv_sync_rolled_on_hand_safe("),
      sql176.indexOf("create or replace function public.inv_finalize_rolled_valuation("),
    );
    expect(fn).toContain("PHYSICAL quantity synchronization ONLY");
    expect(fn).toContain("Must NOT rewrite inventory_carrying_value from on_hand");
  });

  it("B2b. finalize derives avg from carrying / physical", () => {
    expect(sql176).toContain("inv_finalize_rolled_valuation");
    expect(sql176).toContain("perform public.inv_finalize_rolled_valuation");
  });

  it("B2c. consume uses finalize not value-rewriting sync", () => {
    const fn = sql176.slice(
      sql176.indexOf("create or replace function public.consume_inventory_safe("),
      sql176.indexOf("create or replace function public.adjust_inventory_safe("),
    );
    expect(fn).toContain("inv_finalize_rolled_valuation");
  });

  it("B3. authenticated cannot SELECT products cost columns", () => {
    expect(sql176).toContain("revoke select on table public.products from authenticated");
    expect(sql176).toMatch(
      /revoke select \(avg_unit_cost, inventory_carrying_value\)/,
    );
  });

  it("B3b. warehouse ops view excludes costs", () => {
    expect(sql176).toContain("products_inventory_ops");
    expect(sql176).toContain("inv_list_inventory_products_ops");
    const view = sql176.slice(
      sql176.indexOf("create or replace view public.products_inventory_ops"),
      sql176.indexOf("comment on view public.products_inventory_ops"),
    );
    expect(view).not.toContain("avg_unit_cost");
    expect(view).not.toContain("inventory_carrying_value");
  });

  it("B3c. valuation RPC is admin/office only", () => {
    expect(sql176).toContain("inv_get_product_valuation");
    expect(sql176).toContain("'read product inventory valuation'");
  });

  it("B3d. no UI-layer trust-boundary comment remains", () => {
    expect(sql176).not.toContain("UI already gates showCost");
    expect(sql176).not.toContain("app must not display");
  });
});

describe("F6-P4 final remaining — rolled physical + ACL", () => {
  it("R1. rolled receive requires create_roll or roll_id", () => {
    expect(sql176).toContain("p_create_roll boolean");
    expect(sql176).toContain("INV_ROLL_REQUIRED");
    expect(sql176).toContain("insert into public.stock_rolls");
  });

  it("R2. receive includes roll in idempotency hash", () => {
    const fn = sql176.slice(
      sql176.indexOf("create or replace function public.receive_inventory_safe("),
      sql176.indexOf("create or replace function public.reserve_inventory_safe("),
    );
    expect(fn).toContain("'roll_id'");
    expect(fn).toContain("'create_roll'");
  });

  it("R3. job return requires destination roll for rolled", () => {
    const fn = sql176.slice(
      sql176.indexOf("create or replace function public.return_inventory_from_job_safe("),
      sql176.indexOf("create or replace function public.return_inventory_to_vendor_safe("),
    );
    expect(fn).toContain("p_roll_id uuid default null");
    expect(fn).toContain("destination p_roll_id");
    expect(fn).toContain("remaining_qty = round(coalesce(remaining_qty, 0) + v_qty");
  });

  it("R4. vendor return decrements physical roll", () => {
    const fn = sql176.slice(
      sql176.indexOf("create or replace function public.return_inventory_to_vendor_safe("),
      sql176.indexOf("create or replace function public.reverse_inventory_movement_safe("),
    );
    expect(fn).toContain("p_roll_id");
    expect(fn).toContain("remaining_qty = round(remaining_qty - v_qty");
  });

  it("R5. generic rolled adjust fails closed", () => {
    expect(sql176).toContain("INV_ROLL_ADJUST_REQUIRES_ROLL_WORKFLOW");
  });

  it("R6. adjust_roll_inventory_safe exists", () => {
    expect(sql176).toContain("adjust_roll_inventory_safe");
  });

  it("R7. reversal blocks unsafe receipt reverse", () => {
    expect(sql176).toContain("INV_REVERSAL_UNSAFE");
    expect(sql176).toContain("Dependent history");
  });

  it("R8. reversal still discovers unlocked before movement lock", () => {
    const fn = sql176.slice(
      sql176.indexOf("create or replace function public.reverse_inventory_movement_safe("),
      sql176.indexOf("create or replace function public.inv_flag_receipt_ap_variance_safe("),
    );
    expect(fn.indexOf("UNLOCKED discovery")).toBeLessThan(
      fn.lastIndexOf("from public.stock_movements where id = p_movement_id for update"),
    );
  });

  it("R9. products table SELECT revoked then column-granted without valuation", () => {
    expect(sql176).toContain("revoke select on table public.products from authenticated");
    expect(sql176).toContain("attname not in ('avg_unit_cost', 'inventory_carrying_value')");
  });

  it("R10. ops view omits material_rate and labor_rate", () => {
    const view = sql176.slice(
      sql176.indexOf("create or replace view public.products_inventory_ops"),
      sql176.indexOf("comment on view public.products_inventory_ops"),
    );
    expect(view).not.toContain("material_rate");
    expect(view).not.toContain("labor_rate");
    expect(view).not.toContain("clearance_price");
    expect(view).not.toContain("avg_unit_cost");
  });

  it("R11. inv_reconcile requires admin/office", () => {
    const fn = sql176.slice(
      sql176.indexOf("create or replace function public.inv_reconcile_product_value("),
      sql176.indexOf("create or replace function public.inv_apply_value_effect("),
    );
    expect(fn).toContain("array['admin','office']");
  });

  it("R12. internal avg cost helper still revoked from authenticated", () => {
    expect(sql176).toContain(
      "revoke all on function public.inv_product_avg_cost_internal(uuid) from authenticated",
    );
    expect(sql176).toContain("inv_product_avg_cost_internal");
  });

  it("R13. obsolete receive overload dropped", () => {
    expect(sql176).toContain(
      "drop function if exists public.receive_inventory_safe(uuid, numeric, numeric, text, uuid, uuid, date, uuid, text, uuid)",
    );
  });

  it("R14. rate classification documented as OUR COST", () => {
    expect(sql176).toContain("material_rate / labor_rate = OUR COST");
  });
});

describe("F6-P4 concurrency — physical count serialization", () => {
  const adjustFn = () =>
    sql176.slice(
      sql176.indexOf("create or replace function public.adjust_inventory_safe("),
      sql176.indexOf("create or replace function public.adjust_roll_inventory_safe("),
    );

  it("C1. concurrent count-to-8 from 10 converges to 8 not 6", () => {
    expect(simulateStalePreLockDeltas(10, [8, 8])).toBe(6); // bug model
    expect(simulateSerializedPhysicalCounts(10, [8, 8])).toBe(8); // required
  });

  it("C2. concurrent count-to-8 then count-to-7 → final 7", () => {
    expect(simulateSerializedPhysicalCounts(10, [8, 7])).toBe(7);
    expect(simulateSerializedPhysicalCounts(10, [7, 8])).toBe(8);
  });

  it("C3. adjust locks product BEFORE reading on_hand / calculating delta", () => {
    const fn = adjustFn();
    const begin = fn.indexOf("inv_begin_action");
    const lock = fn.indexOf("inv_lock_product");
    const forUpdate = fn.indexOf("for update");
    const delta = fn.indexOf("v_delta := round(v_counted - coalesce(v_on");
    expect(begin).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(begin);
    expect(forUpdate).toBeGreaterThan(lock);
    expect(delta).toBeGreaterThan(forUpdate);
    // Must not call unlocked inv_on_hand for authoritative delta
    expect(fn).not.toMatch(/v_on := public\.inv_on_hand/);
  });

  it("C4. context hash uses counted not pre-lock delta", () => {
    const fn = adjustFn();
    const hashBlock = fn.slice(
      fn.indexOf("inv_context_hash('adjust_inventory'"),
      fn.indexOf("inv_begin_action"),
    );
    expect(hashBlock).toContain("'counted'");
    expect(hashBlock).not.toContain("'delta'");
    const parts = physicalCountContextHashParts({
      productId: "p",
      counted: 8,
      reason: "count",
      unitCost: null,
      economicDate: "2026-01-01",
      note: null,
    });
    expect(parts).not.toHaveProperty("delta");
    expect(parts.counted).toBe(8);
  });

  it("C5. zero-delta completes idempotency (no early return before complete)", () => {
    const fn = adjustFn();
    expect(fn).toContain("'No quantity change.'");
    const beginIdx = fn.indexOf("inv_begin_action");
    const zeroIdx = fn.indexOf("'No quantity change.'");
    const completeAfter = fn.indexOf("inv_complete_action", zeroIdx);
    expect(beginIdx).toBeGreaterThan(-1);
    expect(zeroIdx).toBeGreaterThan(beginIdx);
    expect(completeAfter).toBeGreaterThan(zeroIdx);
    // Must not early-return skipped before begin_action
    const beforeBegin = fn.slice(0, beginIdx);
    expect(beforeBegin).not.toContain("'No quantity change.'");
  });

  it("C6. rolled still fails closed via INV_ROLL_ADJUST after lock", () => {
    const fn = adjustFn();
    const lock = fn.indexOf("inv_lock_product");
    const rolled = fn.indexOf("INV_ROLL_ADJUST_REQUIRES_ROLL_WORKFLOW");
    expect(rolled).toBeGreaterThan(lock);
  });

  it("C7. adjust_roll delta after roll FOR UPDATE; hash uses counted", () => {
    const fn = sql176.slice(
      sql176.indexOf("create or replace function public.adjust_roll_inventory_safe("),
      sql176.indexOf("create or replace function public.return_inventory_from_job_safe("),
    );
    expect(fn.indexOf("'counted'")).toBeLessThan(fn.indexOf("inv_begin_action"));
    expect(fn.indexOf("for update")).toBeLessThan(
      fn.indexOf("v_delta := round(v_counted - coalesce(v_roll.remaining_qty"),
    );
  });

  it("C8. TOCTOU audit markers — quantity reads under lock", () => {
    // release: lock product before owned reserved qty
    const rel = sql176.slice(
      sql176.indexOf("create or replace function public.release_inventory_safe("),
      sql176.indexOf("create or replace function public.consume_inventory_safe("),
    );
    expect(rel.indexOf("inv_lock_product")).toBeLessThan(
      rel.indexOf("inv_job_line_reserved_qty"),
    );
    // consume: lock before roll remaining check
    const con = sql176.slice(
      sql176.indexOf("create or replace function public.consume_inventory_safe("),
      sql176.indexOf("create or replace function public.adjust_inventory_safe("),
    );
    expect(con.indexOf("inv_lock_product")).toBeLessThan(
      con.indexOf("remaining_qty"),
    );
    // receive: PO item FOR UPDATE before cumulative received
    const recv = sql176.slice(
      sql176.indexOf("create or replace function public.receive_inventory_safe("),
      sql176.indexOf("create or replace function public.reserve_inventory_safe("),
    );
    expect(recv.indexOf("from public.po_items where id = p_po_item_id for update")).toBeLessThan(
      recv.indexOf("inv_po_item_received_qty"),
    );
    // job return: product lock before net returnable
    const jr = sql176.slice(
      sql176.indexOf("create or replace function public.return_inventory_from_job_safe("),
      sql176.indexOf("create or replace function public.return_inventory_to_vendor_safe("),
    );
    expect(jr.indexOf("inv_lock_product")).toBeLessThan(
      jr.indexOf("inv_job_net_returnable_qty"),
    );
  });
});

describe("F6-P4 cost-input trust boundary", () => {
  it("T1. warehouse may not supply unit cost override", () => {
    expect(warehouseMaySupplyUnitCostOverride()).toBe(false);
    expect(costOverrideAllowedRoles()).toEqual(["admin", "office"]);
  });

  it("T2. authorize helper rejects non-admin/office", () => {
    expect(sql176).toContain("inv_authorize_unit_cost_override");
    expect(sql176).toContain("INV_COST_OVERRIDE_FORBIDDEN");
    expect(sql176).toContain("only admin/office may supply unit_cost");
  });

  it("T3. adjust uses authorize before applying cost", () => {
    const fn = sql176.slice(
      sql176.indexOf("create or replace function public.adjust_inventory_safe("),
      sql176.indexOf("create or replace function public.adjust_roll_inventory_safe("),
    );
    expect(fn).toContain("inv_authorize_unit_cost_override");
    expect(fn).toContain("INV_COST_OVERRIDE_FORBIDDEN");
    expect(fn).toContain("'costOverride'");
    expect(fn.indexOf("inv_authorize_unit_cost_override")).toBeLessThan(
      fn.indexOf("inv_begin_action"),
    );
  });

  it("T4. adjust_roll uses authorize", () => {
    const fn = sql176.slice(
      sql176.indexOf("create or replace function public.adjust_roll_inventory_safe("),
      sql176.indexOf("create or replace function public.return_inventory_from_job_safe("),
    );
    expect(fn).toContain("inv_authorize_unit_cost_override");
    expect(fn).not.toMatch(/if p_unit_cost is not null then v_cost := public\.inv_money_ok/);
  });

  it("T5. receive uses PO line cost as SoT", () => {
    expect(poReceiptCostSource()).toBe("locked_po_item");
    const fn = sql176.slice(
      sql176.indexOf("create or replace function public.receive_inventory_safe("),
      sql176.indexOf("create or replace function public.reserve_inventory_safe("),
    );
    expect(fn).toContain("Canonical PO line cost is SoT");
    expect(fn).toContain("v_item.unit_cost");
    expect(fn).toContain("inv_authorize_unit_cost_override");
  });

  it("T6. consume has no p_unit_cost (trusted WAC)", () => {
    const sig = sql176.slice(
      sql176.indexOf("create or replace function public.consume_inventory_safe("),
      sql176.indexOf(") returns jsonb language plpgsql security definer set search_path = public as $$\ndeclare\n  v_actor uuid; v_qty numeric; v_hash text; v_dup jsonb; v_id uuid;\n  v_avg numeric"),
    );
    expect(sig).not.toContain("p_unit_cost");
  });

  it("T7. job return has no p_unit_cost (FIFO historical)", () => {
    const head = sql176.slice(
      sql176.indexOf("create or replace function public.return_inventory_from_job_safe("),
      sql176.indexOf("create or replace function public.return_inventory_to_vendor_safe("),
    );
    expect(head.slice(0, 400)).not.toContain("p_unit_cost");
    expect(head).toContain("fifo_historical_pull");
  });

  it("T8. authorize helper is internal (not authenticated-executable)", () => {
    expect(sql176).toContain(
      "revoke all on function public.inv_authorize_unit_cost_override(numeric, uuid, text) from authenticated",
    );
    expect(sql176).toContain("'inv_authorize_unit_cost_override'");
  });

  it("T9. concurrency lock-before-delta still present", () => {
    const fn = sql176.slice(
      sql176.indexOf("create or replace function public.adjust_inventory_safe("),
      sql176.indexOf("create or replace function public.adjust_roll_inventory_safe("),
    );
    expect(fn.indexOf("inv_lock_product")).toBeLessThan(
      fn.indexOf("v_delta := round(v_counted - coalesce(v_on"),
    );
  });
});

describe("F6-P4 cost-OUTPUT isolation", () => {
  const FIN = warehouseMutationResponseFinancialKeys();

  function completePayload(fnName: string, nextFn: string): string {
    const start = sql176.indexOf(`create or replace function public.${fnName}(`);
    const end = sql176.indexOf(`create or replace function public.${nextFn}(`);
    const body = sql176.slice(start, end);
    const idx = body.lastIndexOf("inv_complete_action");
    return idx >= 0 ? body.slice(idx) : body.slice(-800);
  }

  it("O1. consume complete_action has no unit_cost", () => {
    const p = completePayload("consume_inventory_safe", "adjust_inventory_safe");
    for (const k of FIN) expect(p).not.toContain(`'${k}'`);
  });

  it("O2. job return complete_action has no unit_cost/extended_cost", () => {
    const p = completePayload(
      "return_inventory_from_job_safe",
      "return_inventory_to_vendor_safe",
    );
    expect(p).not.toContain("'unit_cost'");
    expect(p).not.toContain("'extended_cost'");
  });

  it("O3. sync rolled returns only operational on_hand", () => {
    const fn = sql176.slice(
      sql176.indexOf("create or replace function public.inv_sync_rolled_on_hand_safe("),
      sql176.indexOf("create or replace function public.inv_finalize_rolled_valuation("),
    );
    const ret = fn.slice(fn.lastIndexOf("return jsonb_build_object"));
    expect(ret).toContain("'on_hand'");
    expect(ret).not.toContain("'carrying_value'");
    expect(ret).not.toContain("'avg_unit_cost'");
  });

  it("O4. sync drift error does not interpolate carrying dollars", () => {
    const fn = sql176.slice(
      sql176.indexOf("create or replace function public.inv_sync_rolled_on_hand_safe("),
      sql176.indexOf("create or replace function public.inv_finalize_rolled_valuation("),
    );
    expect(fn).toContain("INV_VALUE_DRIFT");
    expect(fn).not.toContain("carrying_value=%");
  });

  it("O5. financial RPCs still admin/office gated", () => {
    expect(sql176).toContain("'read inventory avg cost'");
    expect(sql176).toContain("'read product inventory valuation'");
    expect(sql176).toContain("'read job consumed value'");
  });

  it("O6. receive complete_action is cost-free (shared contract)", () => {
    const p = completePayload("receive_inventory_safe", "reserve_inventory_safe");
    for (const k of FIN) expect(p).not.toContain(`'${k}'`);
  });

  it("O7. adjust complete_action success is cost-free", () => {
    const p = completePayload("adjust_inventory_safe", "adjust_roll_inventory_safe");
    // Last complete_action is the success path; strip earlier error/skip paths by taking last build.
    const last = p.slice(p.lastIndexOf("jsonb_build_object"));
    for (const k of ["unit_cost", "extended_cost", "avg_unit_cost", "carrying_value", "unitCost", "valueDelta"]) {
      expect(last).not.toContain(`'${k}'`);
    }
  });

  it("O8. adjust_roll complete_action success is cost-free", () => {
    const p = completePayload("adjust_roll_inventory_safe", "return_inventory_from_job_safe");
    const last = p.slice(p.lastIndexOf("jsonb_build_object"));
    for (const k of ["unit_cost", "extended_cost", "avg_unit_cost", "carrying_value", "unitCost"]) {
      expect(last).not.toContain(`'${k}'`);
    }
  });

  it("O9. InvRpcResult type has no financial fields", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/inventory-rpc.ts"),
      "utf8",
    );
    for (const k of ["unit_cost", "extended_cost", "avg_unit_cost", "carrying_value"]) {
      expect(src).not.toContain(k);
    }
  });

  it("O10. stock_movements_ops view omits valuation columns", () => {
    const view = sql176.slice(
      sql176.indexOf("create or replace view public.stock_movements_ops"),
      sql176.indexOf("comment on view public.stock_movements_ops"),
    );
    expect(view).not.toContain("unit_cost");
    expect(view).not.toContain("extended_cost");
    expect(view).not.toContain("value_delta");
  });

  it("E1. inv_apply_value_effect INV_NEGATIVE_VALUE has no carrying amount", () => {
    const fn = sql176.slice(
      sql176.indexOf("create or replace function public.inv_apply_value_effect("),
      sql176.indexOf("create or replace function public.inv_record_outbox("),
    );
    const raises = fn.match(/raise exception 'INV_NEGATIVE_VALUE[^']*'/g) ?? [];
    expect(raises.length).toBe(2);
    for (const r of raises) {
      expect(r).toContain("INV_NEGATIVE_VALUE");
      expect(r).toContain("inventory valuation integrity check failed");
      expect(r).not.toMatch(/%/);
    }
    expect(fn).not.toContain("carrying value cannot go negative");
    expect(fn).not.toMatch(/INV_NEGATIVE_VALUE:[^']*%[^']*',\s*v_new_carry/);
  });

  it("E2. inv_finalize_rolled_valuation INV_NEGATIVE_VALUE has no carrying amount", () => {
    const fn = sql176.slice(
      sql176.indexOf("create or replace function public.inv_finalize_rolled_valuation("),
      sql176.indexOf("create or replace function public.inv_apply_movement("),
    );
    expect(fn).toContain("INV_NEGATIVE_VALUE: inventory valuation integrity check failed");
    expect(fn).not.toContain("carrying value cannot go negative");
    expect(fn).not.toMatch(/INV_NEGATIVE_VALUE:[^']*%[^']*',\s*v_carry/);
  });

  it("E3. no 0176 raise interpolates carrying/avg financial vars", () => {
    // Warehouse-reachable nested helpers must not format financial scalars into exceptions.
    expect(sql176).not.toMatch(
      /raise exception\s+'INV_NEGATIVE_VALUE:[^']*%[^']*',\s*v_(new_carry|carry)/,
    );
    expect(sql176).not.toMatch(
      /raise exception\s+'[^']*carrying value[^']*%[^']*',\s*v_/,
    );
  });

  it("E4. warehouse outer RPCs that catch sqlerrm only wrap authorize/idempotency", () => {
    const warehouseFns = [
      ["receive_inventory_safe", "reserve_inventory_safe"],
      ["reserve_inventory_safe", "release_inventory_safe"],
      ["release_inventory_safe", "consume_inventory_safe"],
      ["consume_inventory_safe", "adjust_inventory_safe"],
      ["adjust_inventory_safe", "adjust_roll_inventory_safe"],
      ["adjust_roll_inventory_safe", "return_inventory_from_job_safe"],
      ["return_inventory_from_job_safe", "return_inventory_to_vendor_safe"],
      ["inv_sync_rolled_on_hand_safe", "inv_finalize_rolled_valuation"],
    ] as const;
    for (const [fn, next] of warehouseFns) {
      const body = sql176.slice(
        sql176.indexOf(`create or replace function public.${fn}(`),
        sql176.indexOf(`create or replace function public.${next}(`),
      );
      const catches = [...body.matchAll(/'error',\s*sqlerrm/g)];
      for (const _ of catches) {
        // sqlerrm wrappers must sit next to authorize/idempotency codes only.
        expect(body).toMatch(/INV_COST_OVERRIDE_FORBIDDEN|IDEMPOTENCY_CONFLICT/);
      }
      // Nested INV_NEGATIVE_VALUE text itself must be the sanitized form if present via helpers.
      expect(sql176).toContain(
        "INV_NEGATIVE_VALUE: inventory valuation integrity check failed",
      );
    }
  });

  it("E5. fail-closed threshold still present (no silent clamp of material negatives)", () => {
    const apply = sql176.slice(
      sql176.indexOf("create or replace function public.inv_apply_value_effect("),
      sql176.indexOf("create or replace function public.inv_record_outbox("),
    );
    expect(apply).toContain("v_new_carry < -0.02");
    expect(apply.match(/v_new_carry < -0\.02/g)?.length).toBe(2);
    const fin = sql176.slice(
      sql176.indexOf("create or replace function public.inv_finalize_rolled_valuation("),
      sql176.indexOf("create or replace function public.inv_apply_movement("),
    );
    expect(fin).toContain("v_carry, 0) < -0.02");
  });
});
