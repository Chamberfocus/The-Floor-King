/**
 * Warehouse incoming deliveries are paged, and a second receipt of the same
 * line does not post inventory twice.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WORK_QUEUE_PAGE_SIZE } from "@/lib/work-queues";
import { assessMaterialsReadyForSchedule } from "@/lib/materials-ready";

function src(path: string): string {
  return readFileSync(path, "utf8");
}

describe("warehouse incoming page", () => {
  it("pages incoming purchase orders instead of stopping at 200", () => {
    const receiving = src("src/app/(app)/warehouse/receiving-actions.ts");
    const list = receiving.slice(receiving.indexOf("export async function listIncomingPos"));
    expect(list).toContain("WORK_QUEUE_PAGE_SIZE");
    expect(list).toContain(".range(");
    expect(list).not.toContain(".limit(200)");
    expect(WORK_QUEUE_PAGE_SIZE).toBe(40);
    const page = src("src/app/(app)/warehouse/page.tsx");
    expect(page).toContain('listIncomingPos(parseListPage(sp.deliveries), "ordered")');
    expect(page).toContain('listIncomingPos(parseListPage(sp.received), "received")');
    expect(page).toContain("WorkQueuePager");
  });

  it("keeps cost and customer money off the warehouse receiving query", () => {
    const receiving = src("src/app/(app)/warehouse/receiving-actions.ts");
    const start = receiving.indexOf("const INCOMING_PO_COLUMNS");
    const end = receiving.indexOf("export async function listIncomingPos");
    const columns = receiving.slice(start, end);
    for (const banned of [
      "unit_cost",
      "material_rate",
      "margin",
      "balance",
      "deposit",
      "payment",
      "invoice",
    ]) {
      expect(columns.toLowerCase()).not.toContain(banned);
    }
    expect(columns).toContain("received_qty");
    expect(columns).toContain("eta_date");
    expect(columns).toContain("quantity");
    expect(columns).toContain("unit");
  });

  it("serializes a repeated receipt so the same delta is not posted twice", () => {
    const stock = src("src/lib/po-stock.ts");
    expect(stock).toContain("po_recv:${args.poItemId}:${already}:${delta}");
    expect(stock).toContain("receive_inventory_safe");
    const sql = src("supabase/migrations/0176_f6_p4_inventory_accounting.sql");
    expect(sql).toContain("from public.po_items where id = p_po_item_id for update");
    expect(sql).toContain("INV_OVER_RECEIVE");
    expect(sql).toContain("inv_lock_idempotency");
    expect(sql).toContain("if v.status = 'completed' then");
    expect(sql).toContain("'duplicate', true");
  });

  it("does not treat a received purchase order as warehouse-ready", () => {
    const receiving = src("src/app/(app)/warehouse/receiving-actions.ts");
    expect(receiving).not.toContain("warehouse_ready_at");
    expect(
      assessMaterialsReadyForSchedule({ hasMaterialNeed: true, warehouseReadyAt: null }).ready,
    ).toBe(false);
    const jobs = src("src/app/(app)/jobs/actions.ts");
    expect(jobs).toContain("schedule_job_install_safe");
  });
});
