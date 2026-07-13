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

// Fields a catalog search looks across — name/SKU/manufacturer/style/color plus
// category (carpet/lvp/tile…) and the vendor/supplier name.
const SEARCH_COLS = [
  "name",
  "sku",
  "manufacturer",
  "style",
  "color",
  "category",
  "supplier",
] as const;

/**
 * Build a PostgREST `.ilike` pattern for one search token that is safe for
 * special characters. LIKE wildcards (`%` `_`) and backslashes are escaped so
 * they're literal, and the whole pattern is double-quoted so fractions and
 * punctuation (e.g. "1/2", "3/4", "(t-mold)") don't break the request.
 */
function likePattern(token: string): string {
  const esc = token.replace(/[\\%_]/g, (m) => `\\${m}`);
  return `"%${esc}%"`;
}

/**
 * Smart, server-side product search. Splits the query into words and requires
 * EVERY word to appear somewhere in the name / sku / manufacturer / style /
 * color (in any order) — so "coretec mustang", "oak reducer 94", and "1/2
 * cheers" all match. Case-insensitive; handles fractions & special characters.
 * Empty query returns the first `limit` by name.
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
  // Each token → one OR across the searchable columns. Chaining .or() ANDs the
  // tokens, so all words must match (any order, anywhere in the text).
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const like = likePattern(token);
    q = q.or(SEARCH_COLS.map((c) => `${c}.ilike.${like}`).join(","));
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
