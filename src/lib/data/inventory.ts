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

export interface InventorySummary {
  trackedCount: number;
  lowStockCount: number;
  totalValue: number; // on_hand × cost(material_rate)
}

/** Products that are stock-tracked, with their levels. */
export async function listInventory(search = ""): Promise<Product[]> {
  const supabase = await createClient();
  let q = supabase
    .from("products")
    .select("*")
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
    .select("*")
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
  let lowStockCount = 0;
  let totalValue = 0;
  for (const p of items) {
    if (p.reorder_point > 0 && p.on_hand <= p.reorder_point) lowStockCount++;
    totalValue += p.on_hand * (p.material_rate || 0);
  }
  return { trackedCount: items.length, lowStockCount, totalValue };
}

/** Tracked stock idle ≥ AGED_DAYS (oldest first) — the aged-stock list. */
export async function listAgedStock(): Promise<Product[]> {
  const cutoff = new Date(Date.now() - AGED_DAYS * 86400000).toISOString();
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("*")
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
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as Product) ?? null;
}

export async function listMovements(productId: string): Promise<StockMovement[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("stock_movements")
    .select("*")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []) as StockMovement[];
}
