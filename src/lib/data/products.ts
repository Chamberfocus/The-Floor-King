import { createClient } from "@/lib/supabase/server";
import type { Product } from "@/lib/types";

const PAGE = 1000; // Supabase caps a single request at 1000 rows.

/**
 * Load products. The catalog can exceed Supabase's 1000-row request cap, so we
 * page through with .range() until every row is fetched.
 */
export async function listProducts(
  opts: { activeOnly?: boolean } = {},
): Promise<Product[]> {
  const supabase = await createClient();
  const all: Product[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from("products")
      .select("*")
      .order("category", { ascending: true })
      .order("name", { ascending: true })
      .range(from, from + PAGE - 1);
    if (opts.activeOnly) query = query.eq("active", true);
    const { data, error } = await query;
    if (error) throw error;
    const batch = (data ?? []) as Product[];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }
  return all;
}

/**
 * Server-side product search — fetches only what matches so big catalogs stay
 * fast. Empty query returns the first `limit` by name.
 */
export async function searchCatalog(
  query: string,
  opts: { activeOnly?: boolean; limit?: number } = {},
): Promise<Product[]> {
  const supabase = await createClient();
  const limit = opts.limit ?? 50;
  let q = supabase
    .from("products")
    .select("*")
    .order("name", { ascending: true })
    .limit(limit);
  if (opts.activeOnly) q = q.eq("active", true);
  const term = query.trim();
  if (term) {
    const like = `%${term}%`;
    q = q.or(
      [
        `name.ilike.${like}`,
        `sku.ilike.${like}`,
        `manufacturer.ilike.${like}`,
        `style.ilike.${like}`,
        `color.ilike.${like}`,
      ].join(","),
    );
  }
  const { data } = await q;
  return (data ?? []) as Product[];
}

export async function productCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true });
  return count ?? 0;
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
