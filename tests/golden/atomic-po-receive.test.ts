/**
 * Atomic PO receiving. Planners mirror the ledger rules. Source and migration
 * markers lock the all-or-none batch. These tests do not execute SQL.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  committedReceiptDeltas,
  planPoReceiveDelta,
  poStatusAfterRequiredReceipt,
} from "@/lib/po-stock";

const ROOT = join(process.cwd());
const stock = readFileSync(join(ROOT, "src/lib/po-stock.ts"), "utf8");
const poActions = readFileSync(
  join(ROOT, "src/app/(app)/purchase-orders/actions.ts"),
  "utf8",
);
const receiving = readFileSync(
  join(ROOT, "src/app/(app)/warehouse/receiving-actions.ts"),
  "utf8",
);
const inventory = readFileSync(
  join(ROOT, "src/app/(app)/inventory/actions.ts"),
  "utf8",
);
const sql = readFileSync(
  join(ROOT, "supabase/migrations/0491_atomic_po_receive.sql"),
  "utf8",
);

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  return source.slice(from, to === -1 ? undefined : to);
}

describe("atomic PO receive — failure, retry, duplicate, partial, concurrency", () => {
  it("rejects an over-receive before any line is posted", () => {
    const plan = planPoReceiveDelta({
      orderedQty: 60,
      targetReceivedQty: 80,
      alreadyOnLedger: 0,
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe("INV_OVER_RECEIVE");
  });

  it("retry and duplicate of the same stamp post nothing", () => {
    const first = planPoReceiveDelta({
      orderedQty: 100,
      targetReceivedQty: 40,
      alreadyOnLedger: 0,
    });
    expect(first).toEqual({ ok: true, delta: 40 });
    const retry = planPoReceiveDelta({
      orderedQty: 100,
      targetReceivedQty: 40,
      alreadyOnLedger: 40,
    });
    expect(retry).toEqual({ ok: true, delta: 0 });
  });

  it("keeps a valid partial sequence of 40, then 35, then 25", () => {
    let already = 0;
    const deltas: number[] = [];
    for (const target of [40, 75, 100]) {
      const plan = planPoReceiveDelta({
        orderedQty: 100,
        targetReceivedQty: target,
        alreadyOnLedger: already,
      });
      expect(plan.ok).toBe(true);
      if (!plan.ok) continue;
      deltas.push(plan.delta);
      already += plan.delta;
    }
    expect(deltas).toEqual([40, 35, 25]);
    expect(already).toBe(100);
  });

  it("a concurrent second request sees the first commit and does not double-post", () => {
    const first = planPoReceiveDelta({
      orderedQty: 60,
      targetReceivedQty: 40,
      alreadyOnLedger: 0,
    });
    expect(first).toEqual({ ok: true, delta: 40 });
    const second = planPoReceiveDelta({
      orderedQty: 60,
      targetReceivedQty: 40,
      alreadyOnLedger: first.ok ? first.delta : 0,
    });
    expect(second).toEqual({ ok: true, delta: 0 });
    const over = planPoReceiveDelta({
      orderedQty: 60,
      targetReceivedQty: 80,
      alreadyOnLedger: 40,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe("INV_OVER_RECEIVE");
  });

  it("a failed line drops every delta in the batch", () => {
    const failed = committedReceiptDeltas([
      { id: "a", delta: 40, postOk: true },
      { id: "b", delta: 25, postOk: false },
      { id: "c", delta: 10, postOk: true },
    ]);
    expect(failed).toEqual({ committed: false, deltas: [] });

    const posted = committedReceiptDeltas([
      { id: "a", delta: 40, postOk: true },
      { id: "b", delta: 0, postOk: true },
      { id: "c", delta: 25, postOk: true },
    ]);
    expect(posted).toEqual({
      committed: true,
      deltas: [
        { id: "a", delta: 40 },
        { id: "c", delta: 25 },
      ],
    });
  });

  it("leaves the previous status when the required stock movement did not post", () => {
    expect(
      poStatusAfterRequiredReceipt({
        previousStatus: "ordered",
        requestedStatus: "received",
        stockPosted: false,
      }),
    ).toBe("ordered");
    expect(
      poStatusAfterRequiredReceipt({
        previousStatus: "ordered",
        requestedStatus: "received",
        stockPosted: true,
      }),
    ).toBe("received");
    expect(
      poStatusAfterRequiredReceipt({
        previousStatus: null,
        requestedStatus: "received",
        stockPosted: false,
      }),
    ).toBe("ordered");
  });
});

describe("atomic PO receive — one batch in the app", () => {
  it("applyReceiptToStock posts the batch once and plans before that call", () => {
    const fn = between(
      stock,
      "export async function applyReceiptToStock",
      "export async function reconcilePoStock",
    );
    expect(fn).toContain("postPoReceiptLines");
    expect(fn.match(/postPoReceiptLines/g)).toHaveLength(1);
    expect(fn).not.toContain("receive_inventory_safe");
    expect(fn.indexOf("planPoReceiveDelta")).toBeGreaterThan(0);
    expect(fn.indexOf("planPoReceiveDelta")).toBeLessThan(fn.indexOf("postPoReceiptLines"));
    expect(fn).toContain("if (!plan.ok) throw new Error");
    expect(fn).toContain("if (plan.delta <= EPS) continue");
    expect(fn).toContain("reverse_po_receipts_safe");
    expect(fn.indexOf("reverse_po_receipts_safe")).toBeLessThan(fn.indexOf("const batch"));
  });

  it("applyPoStatus and save write received only after stock reconciliation", () => {
    const apply = between(
      poActions,
      "export async function applyPoStatus",
      "export async function",
    );
    const becoming = apply.indexOf(
      'const becomingReceived = prev !== "received" && status === "received"',
    );
    const stockCall = apply.indexOf("await reconcilePoStock(supabase, id, prev, status)", becoming);
    const statusWrite = apply.indexOf(
      'await supabase.from("purchase_orders").update({ status }).eq("id", id)',
      stockCall,
    );
    expect(becoming).toBeGreaterThan(0);
    expect(stockCall).toBeGreaterThan(becoming);
    expect(statusWrite).toBeGreaterThan(stockCall);

    expect(poActions).toContain(
      "status: becomingReceived || leavingReceived ? (prevStatus ?? input.status) : input.status",
    );
    const saveStock = poActions.indexOf(
      "await reconcilePoStock(supabase, poId, prevStatus, input.status)",
    );
    const saveStatus = poActions.indexOf("update({ status: input.status })", saveStock);
    expect(saveStock).toBeGreaterThan(0);
    expect(saveStatus).toBeGreaterThan(saveStock);
  });

  it("warehouse receiving posts the batch before it can mark the PO received", () => {
    const fn = between(receiving, "export async function receivePoLines", "export async function unreceivePoLine");
    const post = fn.indexOf("postPoReceiptLines");
    const status = fn.indexOf("applyPoStatus");
    expect(post).toBeGreaterThan(0);
    expect(status).toBeGreaterThan(post);
    expect(fn.indexOf("if (!posted.ok)")).toBeGreaterThan(post);
    expect(fn.indexOf("if (!posted.ok)")).toBeLessThan(status);
    expect(fn).toContain("stamp_received_qty: true");
    expect(fn).not.toContain("applyPoLineReceiptDelta");
  });

  it("a stock-PO line is marked received only after receive_inventory_safe succeeds", () => {
    const fn = between(
      inventory,
      "export async function receiveStockPOLine",
      "export async function deleteStockPO",
    );
    const rpc = fn.indexOf("receive_inventory_safe");
    const gate = fn.indexOf("if (!receiptOk) return");
    const stamp = fn.indexOf("received_qty: newReceived");
    const status = fn.indexOf('status: "received"');
    expect(rpc).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(rpc);
    expect(stamp).toBeGreaterThan(gate);
    expect(status).toBeGreaterThan(gate);
    expect(fn.indexOf("on_order:")).toBeGreaterThan(gate);
  });
});

describe("atomic PO receive — migration 0491", () => {
  it("locks the PO, recomputes the key, and raises so a failed line rolls back", () => {
    const lock = sql.indexOf("for update");
    const lines = sql.indexOf("jsonb_array_elements");
    const recv = sql.indexOf("receive_inventory_safe(");
    const failed = sql.indexOf("raise exception 'PO_RECEIVE_FAILED'");
    expect(lock).toBeGreaterThan(0);
    expect(lines).toBeGreaterThan(lock);
    expect(recv).toBeGreaterThan(lines);
    expect(failed).toBeGreaterThan(recv);
    expect(sql).toContain("po_recv:");
    expect(sql).toContain("inv_po_item_received_qty");
    expect(sql).toContain("INV_OVER_RECEIVE");
    expect(sql).toContain("INV_RECEIVE_DECREASE");
    expect(sql).toContain("PO_RECEIVE_CLOSED");
    expect(sql).toContain("Does not enable accounting");
    expect(sql).not.toMatch(/update\s+public\.purchase_orders/i);
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/delete\s+from/i);
    expect(sql).not.toMatch(/^begin;/im);
    expect(sql).not.toMatch(/^commit;/im);
    expect(sql).toContain("grant execute on function public.receive_po_lines_safe(uuid, jsonb, uuid) to service_role");
  });
});
