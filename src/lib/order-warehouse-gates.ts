/**
 * Customer-order warehouse gates — one source of truth for stock check,
 * owner approval, and ready-to-stage. App-only: 0063 already stores
 * stock_status; no new tables.
 *
 * Warehouse never approves the customer transaction. Owner/office approval
 * is blocked only while stock is unknown. Staging requires BOTH owner
 * approval and in_stock.
 */
import type { OrderStatus, OrderStockStatus } from "@/lib/types";

export const WAREHOUSE_STOCK_CHECK_REQUIRED = "WAREHOUSE STOCK CHECK REQUIRED";

export const WAREHOUSE_STOCK_SECTION = "CUSTOMER ORDERS — STOCK CHECK";
export const WAREHOUSE_ACTION_IN_STOCK = "IN STOCK";
export const WAREHOUSE_ACTION_PARTIAL = "PARTIAL";
export const WAREHOUSE_ACTION_OUT = "NOT IN STOCK";

export const OFFICE_STOCK_HEADING = {
  waiting: "WAITING ON WAREHOUSE",
  inStockKicker: "WAREHOUSE STOCK CHECK",
  inStockMark: "✓ IN STOCK",
  partial: "PARTIAL STOCK",
  out: "NOT IN STOCK",
  officeOverride: "Office override",
} as const;

export const OFFICE_ORDER_QUEUE_HINT = {
  receivedWaiting: "CUSTOMER ORDER RECEIVED / WAITING ON WAREHOUSE",
  verified: "WAREHOUSE VERIFIED — READY FOR APPROVAL",
  shortage: "MATERIAL SHORTAGE",
} as const;

export const WAREHOUSE_ORDER_QUEUE_HINT = {
  stockCheckNeeded: "STOCK CHECK NEEDED",
  readyToStage: "READY TO STAGE",
} as const;

/** Catalog columns warehouse stock-check is allowed to load. No sell/cost. */
export const WAREHOUSE_PRODUCT_FACT_COLUMNS =
  "id, name, manufacturer, sku, style, color, unit, on_hand, reserved, track_stock";

/** Order-item columns warehouse stock-check is allowed to load. No sell/price. */
export const WAREHOUSE_ORDER_ITEM_COLUMNS =
  "id, order_id, product_id, position, description, color, style, quantity, unit, cut_notes, cuts";

const STOCK_RESULTS = new Set<OrderStockStatus>([
  "in_stock",
  "partial",
  "out_of_stock",
]);

export function isUnknownStock(
  stockStatus: string | null | undefined,
): boolean {
  return !stockStatus || stockStatus === "unknown";
}

export function isWarehouseStockResult(
  stockStatus: string | null | undefined,
): stockStatus is "in_stock" | "partial" | "out_of_stock" {
  return !!stockStatus && STOCK_RESULTS.has(stockStatus as OrderStockStatus);
}

/** Owner/office may commercially approve once warehouse (or office override) has a result. */
export function canApproveCustomerOrder(
  stockStatus: string | null | undefined,
): boolean {
  return !isUnknownStock(stockStatus);
}

/** Ready-to-stage: owner approved AND warehouse result is fully in stock. */
export function canStageCustomerOrder(args: {
  status: string | null | undefined;
  stockStatus: string | null | undefined;
}): boolean {
  return args.status === "approved" && args.stockStatus === "in_stock";
}

/**
 * When a job is linked to a customer order, sendJobToWarehouse must refuse
 * unless both gates pass. Returns null when staging is allowed.
 */
export function customerOrderStagingBlockMessage(args: {
  status: string | null | undefined;
  stockStatus: string | null | undefined;
}): string | null {
  if (canStageCustomerOrder(args)) return null;
  if (isUnknownStock(args.stockStatus)) return WAREHOUSE_STOCK_CHECK_REQUIRED;
  if (args.stockStatus === "partial") {
    return "PARTIAL STOCK — cannot stage until the order is fully in stock.";
  }
  if (args.stockStatus === "out_of_stock") {
    return "NOT IN STOCK — cannot stage until material is available.";
  }
  if (args.status !== "approved") {
    return "Owner approval is required before this order can be staged.";
  }
  return "This order cannot be sent to the warehouse yet.";
}

export function officeWarehouseStockBanner(stockStatus: OrderStockStatus): {
  kicker: string;
  headline: string;
  showChecker: boolean;
  showNote: boolean;
  tone: "wait" | "ok" | "warn" | "bad";
} {
  switch (stockStatus) {
    case "in_stock":
      return {
        kicker: OFFICE_STOCK_HEADING.inStockKicker,
        headline: OFFICE_STOCK_HEADING.inStockMark,
        showChecker: true,
        showNote: true,
        tone: "ok",
      };
    case "partial":
      return {
        kicker: OFFICE_STOCK_HEADING.inStockKicker,
        headline: OFFICE_STOCK_HEADING.partial,
        showChecker: true,
        showNote: true,
        tone: "warn",
      };
    case "out_of_stock":
      return {
        kicker: OFFICE_STOCK_HEADING.inStockKicker,
        headline: OFFICE_STOCK_HEADING.out,
        showChecker: true,
        showNote: true,
        tone: "bad",
      };
    default:
      return {
        kicker: OFFICE_STOCK_HEADING.inStockKicker,
        headline: OFFICE_STOCK_HEADING.waiting,
        showChecker: false,
        showNote: false,
        tone: "wait",
      };
  }
}

export function officeCustomerOrderQueueHint(args: {
  status: string | null | undefined;
  stockStatus: string | null | undefined;
}): string | null {
  if (args.status !== "submitted") return null;
  if (isUnknownStock(args.stockStatus)) {
    return OFFICE_ORDER_QUEUE_HINT.receivedWaiting;
  }
  if (args.stockStatus === "in_stock") {
    return OFFICE_ORDER_QUEUE_HINT.verified;
  }
  return OFFICE_ORDER_QUEUE_HINT.shortage;
}

export function warehouseCustomerOrderQueueHint(args: {
  status: string | null | undefined;
  stockStatus: string | null | undefined;
}): string | null {
  if (args.status === "submitted") {
    return WAREHOUSE_ORDER_QUEUE_HINT.stockCheckNeeded;
  }
  if (canStageCustomerOrder(args)) {
    return WAREHOUSE_ORDER_QUEUE_HINT.readyToStage;
  }
  return null;
}

export function orderDisplayNumber(id: string): string {
  const compact = id.replace(/-/g, "").slice(0, 8).toUpperCase();
  return compact ? `#${compact}` : "#ORDER";
}

export function approvalDoesNotStageCopy(
  stockStatus: string | null | undefined,
): boolean {
  return stockStatus === "partial" || stockStatus === "out_of_stock";
}
