import { createClient } from "@/lib/supabase/server";
import type { Product, StockMovement } from "@/lib/types";

/** Stock untouched for this many days is flagged "aged". */
export const AGED_DAYS = 90;

/** Days since the item last moved (received/pulled/adjusted). */
export function daysIdle(p: Product): number {
  const anchor = p.last_movement_at ?? p.created_at;
  if (!anchor) return 0;
  return Math.floor((Date.now() - new Date(anchor).getTime()) / 86400000);
}

export function isAged(p: Product): boolean {
  return p.track_stock && p.on_hand > 0 && daysIdle(p) >= AGED_DAYS;
}

/** Each product's primary (lowest-position) recorded unit cost from its
 *  vendors. The one source of truth for valuing inventory AT COST. */
export async function primaryCostByProduct(
  supabase: Awaited<ReturnType<typeof createClient>>,
  productIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(productIds)].filter(Boolean);
  if (!ids.length) return out;
  const best = new Map<string, { cost: number; position: number }>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase
      .from("product_vendors")
      .select("product_id, cost, position")
      .in("product_id", ids.slice(i, i + 300));
    for (const v of data ?? []) {
      if (v.cost == null) continue;
      const pid = v.product_id as string;
      const pos = Number(v.position) || 0;
      const cur = best.get(pid);
      if (!cur || pos < cur.position)
        best.set(pid, { cost: Number(v.cost), position: pos });
    }
  }
  for (const [pid, b] of best) out.set(pid, b.cost);
  return out;
}

export interface InventorySummary {
  trackedCount: number;
  lowStockCount: number;
  totalValue: number; // on_hand × cost(material_rate)
}

/** Products that are stock-tracked, with their levels (no financial valuation columns). */
/** Ops surface: no avg/carrying; no material_rate/labor_rate/clearance_price (OUR COST). */
const PRODUCT_OPS_COLS =
  "id, name, category, unit, sku, manufacturer, style, color, supplier, supplier_id, notes, active, track_stock, on_hand, on_order, reorder_point, bin_location, stock_kind, reserved, clearance, last_movement_at, created_at, updated_at";

export async function listInventory(search = ""): Promise<Product[]> {
  const supabase = await createClient();
  // Prefer ops RPC (warehouse-safe, no avg_unit_cost / carrying_value).
  const { data: viaRpc, error } = await supabase.rpc(
    "inv_list_inventory_products_ops",
    { p_search: search.trim() || null, p_limit: 2000 },
  );
  if (!error && viaRpc) return viaRpc as Product[];

  let q = supabase
    .from("products")
    .select(PRODUCT_OPS_COLS)
    .eq("track_stock", true)
    .order("name", { ascending: true });
  if (search.trim()) {
    const like = `%${search.trim()}%`;
    q = q.or(
      [`name.ilike.${like}`, `sku.ilike.${like}`, `manufacturer.ilike.${like}`].join(
        ",",
      ),
    );
  }
  const { data } = await q;
  return (data ?? []) as Product[];
}

/** Catalog products NOT yet tracked — for the "start tracking" picker. */
export async function listUntracked(search = ""): Promise<Product[]> {
  const supabase = await createClient();
  let q = supabase
    .from("products")
    .select(PRODUCT_OPS_COLS)
    .eq("track_stock", false)
    .order("name", { ascending: true })
    .limit(50);
  if (search.trim()) {
    const like = `%${search.trim()}%`;
    q = q.or([`name.ilike.${like}`, `sku.ilike.${like}`].join(","));
  }
  const { data } = await q;
  return (data ?? []) as Product[];
}

export async function inventorySummary(): Promise<InventorySummary> {
  const items = await listInventory();
  // Value at COST (what we paid), matching the "at cost" label — fall back to
  // the sell rate only when a product has no recorded vendor cost.
  const supabase = await createClient();
  const costByProduct = await primaryCostByProduct(
    supabase,
    items.map((p) => p.id),
  );
  let lowStockCount = 0;
  let totalValue = 0;
  for (const p of items) {
    if (p.reorder_point > 0 && p.on_hand <= p.reorder_point) lowStockCount++;
    totalValue += p.on_hand * (costByProduct.get(p.id) ?? (p.material_rate || 0));
  }
  return { trackedCount: items.length, lowStockCount, totalValue };
}

/** Tracked stock idle ≥ AGED_DAYS (oldest first) — the aged-stock list. */
export async function listAgedStock(): Promise<Product[]> {
  const cutoff = new Date(Date.now() - AGED_DAYS * 86400000).toISOString();
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select(PRODUCT_OPS_COLS)
    .eq("track_stock", true)
    .gt("on_hand", 0)
    .or(`last_movement_at.lte.${cutoff},last_movement_at.is.null`)
    .order("last_movement_at", { ascending: true, nullsFirst: true })
    .limit(100);
  return (data ?? []) as Product[];
}

export async function getProduct(id: string): Promise<Product | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select(PRODUCT_OPS_COLS)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const product = data as Product;
  // Financial valuation: admin/office only via SECURITY DEFINER RPC (DB-enforced).
  const { data: val } = await supabase.rpc("inv_get_product_valuation", {
    p_product_id: id,
  });
  if (val && typeof val === "object" && (val as { ok?: boolean }).ok) {
    const v = val as {
      avg_unit_cost?: number | null;
      inventory_carrying_value?: number;
    };
    product.avg_unit_cost = v.avg_unit_cost ?? null;
    (product as Product & { inventory_carrying_value?: number }).inventory_carrying_value =
      v.inventory_carrying_value;
  }
  return product;
}

export async function listMovements(productId: string): Promise<StockMovement[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let role: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    role = (profile?.role as string) ?? null;
  }
  // Warehouse: quantity-safe RPC (no unit_cost / extended_cost).
  if (role === "warehouse") {
    const { data } = await supabase.rpc("inv_list_movements_ops", {
      p_product_id: productId,
      p_limit: 100,
    });
    return (data ?? []) as StockMovement[];
  }
  // Admin/office: prefer financial RPC when 0176 applied; else table select.
  const { data: fin, error } = await supabase.rpc("inv_list_movements_financial", {
    p_product_id: productId,
    p_limit: 100,
  });
  if (!error && fin) return fin as StockMovement[];
  const { data } = await supabase
    .from("stock_movements")
    .select("*")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []) as StockMovement[];
}
