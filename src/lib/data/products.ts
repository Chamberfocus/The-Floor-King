import { createClient } from "@/lib/supabase/server";
import type { Product, ProductVendor, SupplierKind } from "@/lib/types";

const PAGE = 1000; // Supabase caps a single request at 1000 rows.

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Attach each product's vendor list (who we buy it from, with each vendor's
 * cost). Best-effort: if the product_vendors table isn't there yet (pre-0114),
 * products keep working with their single supplier_id — nothing breaks.
 */
async function attachProductVendors(db: Db, products: Product[]): Promise<Product[]> {
  if (!products.length) return products;
  try {
    const ids = products.map((p) => p.id);
    const byProduct = new Map<string, ProductVendor[]>();
    // Page through in case there are many vendor rows across a big catalog.
    for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300);
      const { data, error } = await db
        .from("product_vendors")
        .select("id, product_id, vendor_id, cost, vendor_sku, position, vendor:suppliers(name, kind)")
        .in("product_id", chunk)
        .order("position", { ascending: true });
      if (error) return products; // table missing → leave products as-is
      for (const r of data ?? []) {
        const rawVendor = (r as {
          vendor?: { name: string; kind: string } | { name: string; kind: string }[] | null;
        }).vendor;
        const v = Array.isArray(rawVendor) ? rawVendor[0] : rawVendor;
        const row: ProductVendor = {
          id: r.id as string,
          product_id: r.product_id as string,
          vendor_id: r.vendor_id as string,
          cost: r.cost == null ? null : Number(r.cost),
          vendor_sku: (r.vendor_sku as string) ?? null,
          position: (r.position as number) ?? 0,
          vendor_name: v?.name ?? null,
          vendor_kind: (v?.kind as SupplierKind) ?? null,
        };
        const arr = byProduct.get(row.product_id) ?? [];
        arr.push(row);
        byProduct.set(row.product_id, arr);
      }
    }
    for (const p of products) p.vendors = byProduct.get(p.id) ?? [];
    return products;
  } catch {
    return products;
  }
}

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
  return attachProductVendors(supabase, all);
}

// Text fields a catalog search does a partial (ilike) match across — including
// the vendor/supplier name. Category is an ENUM (can't be ilike'd), so it's
// matched separately by equality when a token names a category (see below).
const SEARCH_COLS = [
  "name",
  "sku",
  "manufacturer",
  "style",
  "color",
  "supplier",
] as const;

// Category enum values + a few natural-language synonyms, so a token like
// "carpet", "lvp", "tile", or "pad" also matches by category — not just text.
const CATEGORY_VALUES = [
  "carpet",
  "lvp",
  "hardwood",
  "laminate",
  "tile",
  "vinyl",
  "underlayment",
  "trim",
] as const;
const CATEGORY_SYNONYMS: Record<string, string> = {
  pad: "underlayment",
  padding: "underlayment",
  plank: "lvp",
  wood: "hardwood",
};
/** The category a search token names (exact/prefix or synonym), else null. */
function tokenCategory(token: string): string | null {
  const t = token.toLowerCase();
  if (CATEGORY_SYNONYMS[t]) return CATEGORY_SYNONYMS[t];
  return CATEGORY_VALUES.find((c) => c === t || c.startsWith(t)) ?? null;
}

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
  return searchCatalogWith(await createClient(), query, opts);
}

/**
 * The search itself, against an injected client. Exported so the exact query the
 * PO and estimate pickers run can also be exercised outside a request (tests,
 * verification) — a check that re-implements the query proves nothing about the
 * query that ships.
 */
export async function searchCatalogWith(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (t: string) => any },
  query: string,
  opts: { activeOnly?: boolean; limit?: number } = {},
): Promise<Product[]> {
  const displayLimit = opts.limit ?? 50;
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  // Gather a broad candidate pool, then RANK by relevance and slice — so the best
  // matches surface (name matches first), not just the alphabetical first-N. This
  // is the fix for "the item I know is there doesn't come up": ordering by name +
  // a small limit hid matches; ranking + a bigger pool brings them to the top.
  const pool = tokens.length ? Math.max(displayLimit * 8, 400) : displayLimit;
  let q = supabase
    .from("products")
    .select("*")
    .order("name", { ascending: true })
    .limit(pool);
  if (opts.activeOnly) q = q.eq("active", true);
  for (const token of tokens) {
    const like = likePattern(token);
    // Each token: OR across the text columns; if the token names a category,
    // also match products of that category (eq — enums can't be ilike'd).
    const parts = SEARCH_COLS.map((c) => `${c}.ilike.${like}`);
    const cat = tokenCategory(token);
    if (cat) parts.push(`category.eq.${cat}`);
    q = q.or(parts.join(","));
  }
  const { data } = await q;
  const rows = (data ?? []) as Product[];
  if (!tokens.length) return rows.slice(0, displayLimit);
  return rankProducts(rows, tokens).slice(0, displayLimit);
}

/**
 * Relevance rank: matches in the NAME beat matches in other fields, a name that
 * STARTS with the query beats a mid-name match, all-tokens-in-name beats a
 * scattered match, and active products edge out inactive ones. Tie-break by name.
 */
function rankProducts(rows: Product[], tokens: string[]): Product[] {
  const low = tokens.map((t) => t.toLowerCase());
  const joined = low.join(" ");
  const score = (p: Product): number => {
    const name = (p.name ?? "").toLowerCase();
    const other = [p.manufacturer, p.style, p.color, p.sku, p.supplier]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    let s = 0;
    if (name.includes(joined)) s += 120; // whole query appears in the name
    if (name.startsWith(low[0])) s += 40; // name starts with the first word
    for (const t of low) {
      if (name.includes(t)) s += 15;
      else if (other.includes(t)) s += 4;
    }
    if (p.active !== false) s += 3;
    return s;
  };
  return rows
    .map((p) => ({ p, s: score(p) }))
    .sort((a, b) => b.s - a.s || (a.p.name ?? "").localeCompare(b.p.name ?? ""))
    .map((x) => x.p);
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
  if (!data) return null;
  const [p] = await attachProductVendors(supabase, [data as Product]);
  return p;
}
