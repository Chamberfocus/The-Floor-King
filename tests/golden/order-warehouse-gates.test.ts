/**
 * Customer order → warehouse stock-check → owner approval → ready-to-stage.
 * App-only gates (no 0188). Does not invent architecture docs.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  OFFICE_ORDER_QUEUE_HINT,
  OFFICE_STOCK_HEADING,
  WAREHOUSE_ACTION_IN_STOCK,
  WAREHOUSE_ACTION_OUT,
  WAREHOUSE_ACTION_PARTIAL,
  WAREHOUSE_ORDER_ITEM_COLUMNS,
  WAREHOUSE_ORDER_QUEUE_HINT,
  WAREHOUSE_PRODUCT_FACT_COLUMNS,
  WAREHOUSE_STOCK_CHECK_REQUIRED,
  WAREHOUSE_STOCK_SECTION,
  approvalDoesNotStageCopy,
  canApproveCustomerOrder,
  canStageCustomerOrder,
  customerOrderStagingBlockMessage,
  isUnknownStock,
  officeCustomerOrderQueueHint,
  officeWarehouseStockBanner,
  orderDisplayNumber,
  warehouseCustomerOrderQueueHint,
} from "@/lib/order-warehouse-gates";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const gates = read("src/lib/order-warehouse-gates.ts");
const orderActions = read("src/app/(app)/orders/actions.ts");
const jobActions = read("src/app/(app)/jobs/actions.ts");
const warehousePage = read("src/app/(app)/warehouse/page.tsx");
const ordersPage = read("src/app/(app)/orders/page.tsx");
const approveUi = read("src/app/(app)/orders/approve-order.tsx");
const ordersData = read("src/lib/data/orders.ts");
const opsQueues = read("src/lib/data/ops-queues.ts");
const invoiceActions = read("src/app/(app)/invoices/actions.ts");
const sql0063 = read("supabase/migrations/0063_order_stock.sql");
const sql0062 = read("supabase/migrations/0062_orders.sql");
const sql0001 = read("supabase/migrations/0001_init.sql");

describe("stock / approval / staging gate unit rules", () => {
  it("unknown cannot approve and cannot stage", () => {
    expect(isUnknownStock("unknown")).toBe(true);
    expect(isUnknownStock(null)).toBe(true);
    expect(canApproveCustomerOrder("unknown")).toBe(false);
    expect(
      canStageCustomerOrder({ status: "submitted", stockStatus: "unknown" }),
    ).toBe(false);
    expect(
      canStageCustomerOrder({ status: "approved", stockStatus: "unknown" }),
    ).toBe(false);
    expect(customerOrderStagingBlockMessage({ status: "submitted", stockStatus: "unknown" })).toBe(
      WAREHOUSE_STOCK_CHECK_REQUIRED,
    );
  });

  it("owner can approve in_stock; in_stock + approved can stage", () => {
    expect(canApproveCustomerOrder("in_stock")).toBe(true);
    expect(
      canStageCustomerOrder({ status: "submitted", stockStatus: "in_stock" }),
    ).toBe(false);
    expect(
      canStageCustomerOrder({ status: "approved", stockStatus: "in_stock" }),
    ).toBe(true);
    expect(
      customerOrderStagingBlockMessage({
        status: "approved",
        stockStatus: "in_stock",
      }),
    ).toBeNull();
  });

  it("partial cannot stage; owner may still review/approve commercially", () => {
    expect(canApproveCustomerOrder("partial")).toBe(true);
    expect(approvalDoesNotStageCopy("partial")).toBe(true);
    expect(
      canStageCustomerOrder({ status: "approved", stockStatus: "partial" }),
    ).toBe(false);
    expect(
      customerOrderStagingBlockMessage({
        status: "approved",
        stockStatus: "partial",
      }),
    ).toMatch(/cannot stage/i);
  });

  it("out_of_stock cannot stage; owner may still review/approve commercially", () => {
    expect(canApproveCustomerOrder("out_of_stock")).toBe(true);
    expect(approvalDoesNotStageCopy("out_of_stock")).toBe(true);
    expect(
      canStageCustomerOrder({ status: "approved", stockStatus: "out_of_stock" }),
    ).toBe(false);
    expect(
      customerOrderStagingBlockMessage({
        status: "approved",
        stockStatus: "out_of_stock",
      }),
    ).toMatch(/cannot stage/i);
  });

  it("office and warehouse queue copy matches the workflow", () => {
    expect(
      officeCustomerOrderQueueHint({ status: "submitted", stockStatus: "unknown" }),
    ).toBe(OFFICE_ORDER_QUEUE_HINT.receivedWaiting);
    expect(
      officeCustomerOrderQueueHint({ status: "submitted", stockStatus: "in_stock" }),
    ).toBe(OFFICE_ORDER_QUEUE_HINT.verified);
    expect(
      officeCustomerOrderQueueHint({ status: "submitted", stockStatus: "partial" }),
    ).toBe(OFFICE_ORDER_QUEUE_HINT.shortage);
    expect(
      officeCustomerOrderQueueHint({ status: "submitted", stockStatus: "out_of_stock" }),
    ).toBe(OFFICE_ORDER_QUEUE_HINT.shortage);
    expect(
      warehouseCustomerOrderQueueHint({ status: "submitted", stockStatus: "unknown" }),
    ).toBe(WAREHOUSE_ORDER_QUEUE_HINT.stockCheckNeeded);
    expect(
      warehouseCustomerOrderQueueHint({
        status: "approved",
        stockStatus: "in_stock",
      }),
    ).toBe(WAREHOUSE_ORDER_QUEUE_HINT.readyToStage);
    expect(orderDisplayNumber("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe(
      "#AAAAAAAA",
    );
  });

  it("office banner copy is prominent", () => {
    expect(officeWarehouseStockBanner("unknown").headline).toBe(
      OFFICE_STOCK_HEADING.waiting,
    );
    expect(officeWarehouseStockBanner("in_stock").headline).toBe(
      OFFICE_STOCK_HEADING.inStockMark,
    );
    expect(officeWarehouseStockBanner("partial").headline).toBe(
      OFFICE_STOCK_HEADING.partial,
    );
    expect(officeWarehouseStockBanner("out_of_stock").headline).toBe(
      OFFICE_STOCK_HEADING.out,
    );
  });
});

describe("submitted customer order visible to warehouse and office", () => {
  it("warehouse page lists submitted orders in CUSTOMER ORDERS — STOCK CHECK", () => {
    expect(warehousePage).toContain("listWarehouseStockCheckOrders");
    expect(warehousePage).toContain("WAREHOUSE_STOCK_SECTION");
    expect(gates).toContain(WAREHOUSE_STOCK_SECTION);
    expect(ordersData).toContain('.eq("status", "submitted")');
    expect(ordersData).toContain("listWarehouseStockCheckOrders");
  });

  it("office /orders is admin/office and lists submitted orders", () => {
    expect(ordersPage).toContain('!["admin", "office"].includes(profile.role)');
    expect(ordersPage).toContain('o.status === "submitted"');
    expect(ordersPage).toContain("officeWarehouseStockBanner");
    expect(ordersPage).toContain("WAREHOUSE_STOCK_CHECK_REQUIRED");
    expect(OFFICE_STOCK_HEADING.waiting).toBe("WAITING ON WAREHOUSE");
  });
});

describe("warehouse stock-check write path", () => {
  it("warehouse can mark in_stock, partial, and out_of_stock via reportOrderStock", () => {
    expect(orderActions).toContain("export async function reportOrderStock");
    expect(orderActions).toContain('["in_stock", "out_of_stock", "partial"]');
    expect(orderActions).toContain('["admin", "office", "warehouse"]');
    expect(warehousePage).toContain("reportOrderStock");
    expect(warehousePage).toContain('value="in_stock"');
    expect(warehousePage).toContain('value="partial"');
    expect(warehousePage).toContain('value="out_of_stock"');
    expect(warehousePage).toContain("WAREHOUSE_ACTION_IN_STOCK");
    expect(warehousePage).toContain("WAREHOUSE_ACTION_PARTIAL");
    expect(warehousePage).toContain("WAREHOUSE_ACTION_OUT");
    expect(WAREHOUSE_ACTION_IN_STOCK).toBe("IN STOCK");
    expect(WAREHOUSE_ACTION_PARTIAL).toBe("PARTIAL");
    expect(WAREHOUSE_ACTION_OUT).toBe("NOT IN STOCK");
  });

  it("reportOrderStock writes only stock columns, never approval or price", () => {
    const start = orderActions.indexOf("export async function reportOrderStock");
    const block = orderActions.slice(start, start + 2200);
    expect(block).toContain("stock_status: status");
    expect(block).toContain("stock_note:");
    expect(block).toContain("stock_checked_by:");
    expect(block).toContain("stock_checked_at:");
    expect(block).not.toMatch(/status:\s*"approved"/);
    expect(block).not.toContain("requested_price");
    expect(block).not.toContain("retail_price");
    expect(block).not.toContain("margin");
    expect(block).not.toContain("invoice_id");
    expect(block).not.toContain("posting_enabled");
  });
});

describe("approval gate", () => {
  it("owner cannot approve unknown — UI-safe WAREHOUSE STOCK CHECK REQUIRED", () => {
    expect(orderActions).toContain("assertRole([\"admin\", \"office\"])");
    expect(orderActions).toContain("canApproveCustomerOrder");
    expect(orderActions).toContain("WAREHOUSE_STOCK_CHECK_REQUIRED");
    expect(approveUi).toContain("WAREHOUSE_STOCK_CHECK_REQUIRED");
    expect(approveUi).toContain("canApproveCustomerOrder");
    expect(approveUi).toContain("disabled");
    expect(ordersPage).toContain("WAREHOUSE_STOCK_CHECK_REQUIRED");
  });

  it("owner can approve in_stock and that path sends to warehouse", () => {
    expect(orderActions).toContain('if (stockNow === "in_stock")');
    expect(orderActions).toContain("sendApprovedInStockOrderToWarehouse");
    expect(orderActions).toContain("sendJobToWarehouse");
  });

  it("re-reads order state and locks submitted → approved so stale UI cannot race", () => {
    expect(orderActions).toContain('.eq("status", "submitted")');
    expect(orderActions).toContain("Re-read immediately before the status lock");
    expect(orderActions).toMatch(/\.eq\("id", orderId\)[\s\S]*\.eq\("status", "submitted"\)/);
  });
});

describe("ready-to-stage / sendJobToWarehouse", () => {
  it("customer-order send is blocked unless approved + in_stock", () => {
    expect(jobActions).toContain("customerOrderJobStagingBlock");
    expect(jobActions).toContain("customerOrderStagingBlockMessage");
    expect(jobActions).toContain('.eq("job_id", jobId)');
    expect(orderActions).toContain("canStageCustomerOrder");
  });

  it("partial and out_of_stock cannot stage even after commercial approval", () => {
    expect(orderActions).toContain('if (stockNow === "in_stock")');
    expect(orderActions).not.toMatch(/if \(stockNow === "partial"\)[\s\S]{0,80}sendJobToWarehouse/);
    expect(orderActions).not.toMatch(/if \(stockNow === "out_of_stock"\)[\s\S]{0,80}sendJobToWarehouse/);
  });

  it("duplicate approval / send does not duplicate the warehouse job or timestamp", () => {
    expect(orderActions).toContain(".is(\"job_id\", null)");
    expect(orderActions).toContain("ensureOrderCashCarryJob");
    expect(jobActions).toContain(".is(\"warehouse_submitted_at\", null)");
    expect(jobActions).toContain("if (job.warehouse_submitted_at) return { error: null }");
  });

  it("later in_stock on an already-approved order still sends once", () => {
    const start = orderActions.indexOf("export async function reportOrderStock");
    const block = orderActions.slice(start, start + 2800);
    expect(block).toContain("canStageCustomerOrder");
    expect(block).toContain("sendApprovedInStockOrderToWarehouse");
  });
});

describe("staging flow still works", () => {
  it("accept → complete still sets staged + warehouse_ready_at", () => {
    expect(jobActions).toContain("export async function acceptWarehouseJob");
    expect(jobActions).toContain("export async function completeWarehouseJob");
    expect(jobActions).toContain('warehouse_status: "staged"');
    expect(jobActions).toContain("warehouse_ready_at: now");
    expect(warehousePage).toContain("WarehouseJobActions");
    expect(warehousePage).toContain("READY TO STAGE");
    expect(warehousePage).toContain("STAGED / READY");
  });
});

describe("warehouse ACL — cannot approve, price, invoice, or pay", () => {
  it("warehouse cannot call approveOrder", () => {
    const start = orderActions.indexOf("export async function approveOrder");
    const head = orderActions.slice(start, start + 400);
    expect(head).toContain('assertRole(["admin", "office"])');
    expect(head).not.toContain("warehouse");
    expect(ordersPage).toContain('!["admin", "office"].includes(profile.role)');
    expect(sql0001).toContain("select public.user_role(auth.uid()) in ('admin', 'office')");
  });

  it("warehouse cannot change pricing — stock-check selects omit sell/price", () => {
    expect(WAREHOUSE_ORDER_ITEM_COLUMNS).not.toContain("retail_price");
    expect(WAREHOUSE_ORDER_ITEM_COLUMNS).not.toContain("requested_price");
    expect(WAREHOUSE_PRODUCT_FACT_COLUMNS).not.toContain("material_rate");
    expect(WAREHOUSE_PRODUCT_FACT_COLUMNS).not.toContain("clearance_price");
    expect(WAREHOUSE_PRODUCT_FACT_COLUMNS).not.toContain("avg_unit_cost");
    expect(WAREHOUSE_PRODUCT_FACT_COLUMNS).not.toContain("catalog_sell");
    expect(ordersData).toContain("WAREHOUSE_ORDER_ITEM_COLUMNS");
    expect(ordersData).toContain("WAREHOUSE_PRODUCT_FACT_COLUMNS");
    expect(warehousePage).not.toContain("retail_price");
    expect(warehousePage).not.toContain("requested_price");
    expect(warehousePage).not.toContain("formatMoney");
    expect(warehousePage).not.toContain("margin");
    expect(warehousePage).not.toContain("invoice");
  });

  it("warehouse cannot invoice or collect payment", () => {
    const inv = orderActions.slice(
      orderActions.indexOf("export async function createInvoiceFromOrder"),
      orderActions.indexOf("export async function createInvoiceFromOrder") + 250,
    );
    expect(inv).toContain('assertRole(["admin", "office"])');
    expect(invoiceActions).toContain("INVOICE_CREATE_ROLES");
    expect(invoiceActions).toContain("INVOICE_PAYMENT_ROLES");
    expect(invoiceActions).not.toMatch(
      /INVOICE_CREATE_ROLES[\s\S]{0,120}"warehouse"/,
    );
    expect(invoiceActions).not.toMatch(
      /INVOICE_PAYMENT_ROLES[\s\S]{0,120}"warehouse"/,
    );
  });

  it("warehouse RLS on orders remains SELECT-only; no broadened UPDATE", () => {
    expect(sql0063).toContain("orders_warehouse_read");
    expect(sql0063).toMatch(
      /orders_warehouse_read[\s\S]*for select to authenticated/,
    );
    expect(sql0063).toContain("the stock update itself");
    expect(sql0063).toContain("no broad");
    expect(sql0062).toContain("orders_staff_all");
    expect(sql0062).toContain("public.is_staff()");
    expect(orderActions).toContain("createAdminClient()");
  });
});

describe("office override remains", () => {
  it("office stock buttons are labeled as an authorized override", () => {
    expect(ordersPage).toContain("reportOrderStock");
    expect(ordersPage).toContain("OFFICE_STOCK_HEADING.officeOverride");
    expect(OFFICE_STOCK_HEADING.officeOverride).toBe("Office override");
  });
});

describe("tasks / today queues — derived, no new persistent schema", () => {
  it("office dashboard queue is derived from live orders", () => {
    expect(opsQueues).toContain("customer_order");
    expect(opsQueues).toContain("officeCustomerOrderQueueHint");
    expect(opsQueues).toContain('.eq("status", "submitted")');
    expect(opsQueues).not.toContain("ensureAutomatedOfficeTask");
  });
});

describe("accounting unchanged — no 0188", () => {
  it("does not create 0188 or touch posting flags", () => {
    const migrations = readdirSync(join(root, "supabase/migrations"));
    expect(migrations.some((f) => f.startsWith("0188"))).toBe(false);
    expect(existsSync(join(root, "supabase/migrations/0188_order_warehouse.sql"))).toBe(
      false,
    );
    expect(gates).not.toContain("posting_enabled");
    expect(orderActions).not.toContain("posting_enabled");
    expect(jobActions.includes("posting_enabled") && orderActions.includes("posting_enabled")).toBe(
      false,
    );
    expect(orderActions).not.toContain("estimate_approval_snapshots");
    expect(orderActions).not.toContain("DISABLE TRIGGER");
    expect(orderActions).not.toContain("wipe_customers_start_fresh");
  });
});
