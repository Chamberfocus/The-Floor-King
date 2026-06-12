import { createClient } from "@/lib/supabase/server";
import type { Product, StockMovement } from "@/lib/types";

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
