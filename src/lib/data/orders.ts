import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeIlikeQuery } from "@/lib/ops-followup";
import { phoneSearchPattern } from "@/lib/search-query";
import {
  WORK_QUEUE_PAGE_SIZE,
  listPageWindow,
  orderStatusesForView,
  type OrderQueueView,
} from "@/lib/work-queues";
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

const ORDER_LIST_COLUMNS =
  "id, customer_id, contact_name, contact_phone, contact_email, status, source, date_needed, notes, stock_status, stock_note, stock_checked_by, stock_checked_at, ready_date, ready_kind, invoice_id, job_id, decline_reason, created_at, customer:customers(full_name)";

function asOrderRows(
  data: (Order & { customer?: { full_name: string | null } | null })[] | null,
): OrderListRow[] {
  return (data ?? []).map((row) => ({
    ...row,
    customer_name: row.customer?.full_name ?? null,
  }));
}

/**
 * One page of customer orders. The default queue is orders waiting for review.
 * Search is capped at 200 matches and says so when that cap is hit.
 */
export async function listOrdersQueue(args: {
  view: OrderQueueView;
  search?: string;
  page?: number;
  focusId?: string;
}): Promise<{
  rows: OrderListRow[];
  total: number;
  page: number;
  pageSize: number;
  capped: boolean;
}> {
  const pageSize = WORK_QUEUE_PAGE_SIZE;
  const supabase = await createClient();
  const statuses = orderStatusesForView(args.view);
  const safe = sanitizeIlikeQuery(args.search ?? "");
  const phone = phoneSearchPattern(args.search ?? "");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyView = (query: any) => (statuses ? query.in("status", statuses) : query);

  let rows: OrderListRow[] = [];
  let total = 0;
  let capped = false;
  let page = 1;

  if (safe.length >= 2 || phone) {
    const like = `%${safe}%`;
    const ors = [
      safe.length >= 2 ? `contact_name.ilike.${like}` : null,
      safe.length >= 2 ? `contact_email.ilike.${like}` : null,
      safe.length >= 2 ? `contact_phone.ilike.${like}` : null,
      safe.length >= 2 ? `notes.ilike.${like}` : null,
      phone ? `contact_phone.ilike.${phone}` : null,
    ].filter(Boolean);
    const cap = 200;
    const jobIds = safe.length >= 2
      ? (
          await supabase.from("jobs").select("id").ilike("title", like).limit(40)
        ).data?.map((row) => row.id as string) ?? []
      : [];
    const [own, byName, byJob] = await Promise.all([
      applyView(
        supabase.from("orders").select(ORDER_LIST_COLUMNS).order("created_at", { ascending: false }),
      )
        .or(ors.join(","))
        .limit(cap),
      safe.length >= 2
        ? applyView(
            supabase
              .from("orders")
              .select(ORDER_LIST_COLUMNS.replace("customer:customers(full_name)", "customer:customers!inner(full_name)"))
              .order("created_at", { ascending: false }),
          )
            .ilike("customer.full_name", like)
            .limit(cap)
        : Promise.resolve({ data: [] as never[] }),
      jobIds.length
        ? applyView(
            supabase.from("orders").select(ORDER_LIST_COLUMNS).order("created_at", { ascending: false }),
          )
            .in("job_id", jobIds)
            .limit(cap)
        : Promise.resolve({ data: [] as never[] }),
    ]);
    const seen = new Map<string, OrderListRow>();
    for (const row of [
      ...asOrderRows(own.data as never),
      ...asOrderRows((byName.data ?? []) as never),
      ...asOrderRows((byJob.data ?? []) as never),
    ]) {
      seen.set(row.id, row);
    }
    const merged = Array.from(seen.values()).sort((a, b) =>
      (b.created_at || "").localeCompare(a.created_at || ""),
    );
    capped =
      (own.data?.length ?? 0) >= cap ||
      (byName.data?.length ?? 0) >= cap ||
      (byJob.data?.length ?? 0) >= cap;
    total = merged.length;
    const window = listPageWindow(args.page ?? 1, pageSize, total);
    page = window.page;
    rows = merged.slice(window.from, window.to);
  } else {
    let countQuery = supabase.from("orders").select("id", { count: "exact", head: true });
    if (statuses) countQuery = countQuery.in("status", statuses);
    const { count } = await countQuery;
    total = count ?? 0;
    const window = listPageWindow(args.page ?? 1, pageSize, total);
    page = window.page;
    let dataQuery = supabase
      .from("orders")
      .select(ORDER_LIST_COLUMNS)
      .order("created_at", { ascending: false });
    if (statuses) dataQuery = dataQuery.in("status", statuses);
    const { data } = await dataQuery.range(window.from, Math.max(window.from, window.to - 1));
    rows = asOrderRows(data as never);
  }

  if (args.focusId && !rows.some((row) => row.id === args.focusId)) {
    const { data } = await supabase
      .from("orders")
      .select(ORDER_LIST_COLUMNS)
      .eq("id", args.focusId)
      .maybeSingle();
    if (data) rows = [asOrderRows([data as never])[0], ...rows];
  }

  await attachItems(supabase, rows);
  return { rows, total, page, pageSize, capped };
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
