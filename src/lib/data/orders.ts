import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enrichCatalogProducts } from "@/lib/data/products";
import type { Order, OrderItem, OrderStockStatus, Product } from "@/lib/types";
import {
  WAREHOUSE_ORDER_ITEM_COLUMNS,
  WAREHOUSE_PRODUCT_FACT_COLUMNS,
} from "@/lib/order-warehouse-gates";

export interface OrderProductRetail {
  id: string;
  name: string;
  unit: string;
  price: number; // retail: clearance price, else cost priced to target margin
}

/**
 * Active products with a RETAIL unit price for the order form. Retail = the
 * clearance price if on clearance, else the cost priced to the shop's target
 * gross margin (landed material — freight included) — never the raw cost. Read
 * elevated so the public order page (no login) can use it too.
 */
export async function listOrderProducts(): Promise<OrderProductRetail[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("products")
    .select("id, name, unit, material_rate, clearance, clearance_price")
    .eq("active", true)
    .order("name", { ascending: true })
    .limit(2000);
  const priced = await enrichCatalogProducts(admin, (data ?? []) as Product[]);
  return priced.map((p) => ({
    id: p.id,
    name: p.name,
    unit: (p.unit ?? "").trim(),
    price: Math.round(Number(p.catalog_sell ?? 0) * 100) / 100,
  }));
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function attachItems(
  supabase: SupabaseServerClient,
  orders: Order[],
): Promise<Order[]> {
  if (!orders.length) return orders;
  const ids = orders.map((o) => o.id);
  const { data } = await supabase
    .from("order_items")
    .select("*")
    .in("order_id", ids)
    .order("position", { ascending: true });
  const byOrder = new Map<string, OrderItem[]>();
  for (const it of (data ?? []) as OrderItem[]) {
    const a = byOrder.get(it.order_id) ?? [];
    a.push(it);
    byOrder.set(it.order_id, a);
  }
  for (const o of orders) o.items = byOrder.get(o.id) ?? [];
  return orders;
}

export interface OrderListRow extends Order {
  customer_name: string | null;
}

/** All orders, newest first — defensive if the table isn't there yet. */
export async function listOrders(
  dbArg?: Awaited<ReturnType<typeof createClient>>,
): Promise<OrderListRow[]> {
  try {
    const supabase = dbArg ?? (await createClient());
    const { data, error } = await supabase
      .from("orders")
      .select("*, customer:customers(full_name)")
      .order("created_at", { ascending: false });
    if (error) return [];
    const rows = (data ?? []) as (Order & {
      customer?: { full_name: string | null } | null;
    })[];
    const list: OrderListRow[] = rows.map((r) => ({
      ...r,
      customer_name: r.customer?.full_name ?? null,
    }));
    await attachItems(supabase, list);
    return list;
  } catch {
    return [];
  }
}

export async function getOrder(id: string): Promise<Order | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const [o] = await attachItems(supabase, [data as Order]);
  return o;
}

/** Count of orders awaiting review — for a nav badge. Defensive. */
export async function pendingOrderCount(): Promise<number> {
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "submitted");
    return count ?? 0;
  } catch {
    return 0;
  }
}

export interface ProductStock {
  on_hand: number;
  reserved: number;
  track_stock: boolean;
  unit: string;
}

/** Live on-hand for the given catalog products — for auto stock display on
 *  orders. Defensive; missing/untracked products simply aren't in the map. */
export async function getProductStock(
  ids: string[],
  dbArg?: Awaited<ReturnType<typeof createClient>>,
): Promise<Map<string, ProductStock>> {
  const map = new Map<string, ProductStock>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  try {
    const supabase = dbArg ?? (await createClient());
    const { data } = await supabase
      .from("products")
      .select("id, on_hand, reserved, track_stock, unit")
      .in("id", unique);
    for (const p of data ?? [])
      map.set(p.id as string, {
        on_hand: Number(p.on_hand) || 0,
        reserved: Number(p.reserved) || 0,
        track_stock: !!p.track_stock,
        unit: (p.unit as string) || "",
      });
  } catch {
    /* products not readable for this role — skip auto stock */
  }
  return map;
}

export async function listOrdersForCustomer(
  customerId: string,
): Promise<Order[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });
    if (error) return [];
    return attachItems(supabase, (data ?? []) as Order[]);
  } catch {
    return [];
  }
}

export async function getOrderByJobId(jobId: string): Promise<Order | null> {
  if (!jobId) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("orders")
      .select("*")
      .eq("job_id", jobId)
      .maybeSingle();
    if (!data) return null;
    const [o] = await attachItems(supabase, [data as Order]);
    return o;
  } catch {
    return null;
  }
}

export interface WarehouseStockCheckItem {
  id: string;
  order_id: string;
  product_id: string | null;
  position: number;
  description: string;
  color: string | null;
  style: string | null;
  quantity: number | null;
  unit: string;
  cut_notes: string | null;
  cuts: OrderItem["cuts"];
}

export interface WarehouseStockCheckOrder {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  status: Order["status"];
  source: Order["source"];
  date_needed: string | null;
  notes: string | null;
  stock_status: OrderStockStatus;
  stock_note: string | null;
  stock_checked_at: string | null;
  job_id: string | null;
  created_at: string;
  items: WarehouseStockCheckItem[];
}

/**
 * Submitted customer orders for the warehouse stock-check queue.
 * Operational columns only — no retail/requested price, invoice, or payment.
 */
export async function listWarehouseStockCheckOrders(
  dbArg?: Awaited<ReturnType<typeof createClient>>,
): Promise<WarehouseStockCheckOrder[]> {
  try {
    const supabase = dbArg ?? (await createClient());
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, customer_id, contact_name, contact_phone, status, source, date_needed, notes, stock_status, stock_note, stock_checked_at, job_id, created_at, customer:customers(full_name)",
      )
      .eq("status", "submitted")
      .order("created_at", { ascending: false });
    if (error) return [];
    const rows = (data ?? []) as unknown as {
      id: string;
      customer_id: string | null;
      contact_name: string | null;
      contact_phone: string | null;
      status: Order["status"];
      source: Order["source"];
      date_needed: string | null;
      notes: string | null;
      stock_status: OrderStockStatus;
      stock_note: string | null;
      stock_checked_at: string | null;
      job_id: string | null;
      created_at: string;
      customer?: { full_name: string | null } | null;
    }[];
    const list: WarehouseStockCheckOrder[] = rows.map((r) => ({
      id: r.id,
      customer_id: r.customer_id,
      customer_name: r.customer?.full_name ?? null,
      contact_name: r.contact_name,
      contact_phone: r.contact_phone,
      status: r.status,
      source: r.source,
      date_needed: r.date_needed,
      notes: r.notes,
      stock_status: r.stock_status,
      stock_note: r.stock_note,
      stock_checked_at: r.stock_checked_at,
      job_id: r.job_id,
      created_at: r.created_at,
      items: [],
    }));
    if (!list.length) return list;
    const { data: itemData } = await supabase
      .from("order_items")
      .select(WAREHOUSE_ORDER_ITEM_COLUMNS)
      .in(
        "order_id",
        list.map((o) => o.id),
      )
      .order("position", { ascending: true });
    const byOrder = new Map<string, WarehouseStockCheckItem[]>();
    for (const it of (itemData ?? []) as WarehouseStockCheckItem[]) {
      const a = byOrder.get(it.order_id) ?? [];
      a.push(it);
      byOrder.set(it.order_id, a);
    }
    for (const o of list) o.items = byOrder.get(o.id) ?? [];
    return list;
  } catch {
    return [];
  }
}

export interface WarehouseCatalogFacts {
  id: string;
  name: string;
  manufacturer: string | null;
  sku: string | null;
  style: string | null;
  color: string | null;
  unit: string;
  on_hand: number;
  reserved: number;
  track_stock: boolean;
}

/** Operational catalog facts for warehouse stock-check — no cost or sell. */
export async function getWarehouseCatalogFacts(
  ids: string[],
  dbArg?: Awaited<ReturnType<typeof createClient>>,
): Promise<Map<string, WarehouseCatalogFacts>> {
  const map = new Map<string, WarehouseCatalogFacts>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  try {
    const supabase = dbArg ?? (await createClient());
    const { data } = await supabase
      .from("products")
      .select(WAREHOUSE_PRODUCT_FACT_COLUMNS)
      .in("id", unique);
    for (const p of data ?? []) {
      map.set(p.id as string, {
        id: p.id as string,
        name: (p.name as string) || "",
        manufacturer: (p.manufacturer as string | null) ?? null,
        sku: (p.sku as string | null) ?? null,
        style: (p.style as string | null) ?? null,
        color: (p.color as string | null) ?? null,
        unit: (p.unit as string) || "",
        on_hand: Number(p.on_hand) || 0,
        reserved: Number(p.reserved) || 0,
        track_stock: !!p.track_stock,
      });
    }
  } catch {
    /* products not readable for this role — skip auto stock */
  }
  return map;
}
