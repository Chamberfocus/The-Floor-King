import { createClient } from "@/lib/supabase/server";
import type { Order, OrderItem } from "@/lib/types";

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
export async function listOrders(): Promise<OrderListRow[]> {
  try {
    const supabase = await createClient();
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
): Promise<Map<string, ProductStock>> {
  const map = new Map<string, ProductStock>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  try {
    const supabase = await createClient();
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
