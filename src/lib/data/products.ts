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
/**
 * The product catalog — physical goods you buy, stock and sell.
 *
 * LABOR IS NOT A PRODUCT and is excluded by default. It has no SKU, no maker,
 * no carton, no roll width and nothing to stock; it sits in this table only
 * because it shares a rate and a unit. Listing it as a catalog item invited the
 * fault already found there — labor rows carrying a material cost, which then
 * billed material the job never bought — and would sweep labor into supplier
 * price feeds that match on SKU.
 *
 * Labor rates live in Settings → Pricing. Pass includeLabor to see them here.
 */
export async function listProducts(
  opts: { activeOnly?: boolean; includeLabor?: boolean } = {},
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
  // Labor is dropped HERE, not in SQL. `category <> 'labor'` matches almost
  // every row, so Postgres gains nothing from it and — with an index on
  // (active, category) — can be talked into walking that index instead of
  // scanning, which cost 2.4s on 13,558 products and timed the PO page out.
  // Fourteen rows filtered in memory is free.
  const rows = opts.includeLabor ? all : all.filter((p) => p.category !== "labor");
  return attachProductVendors(supabase, rows);
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
  pads: "underlayment",
  padding: "underlayment",
  // What the trade says vs what the catalog says. "cushion" returned nothing.
  cushion: "underlayment",
  cushions: "underlayment",
  underlay: "underlayment",
  plank: "lvp",
  planks: "lvp",
  vinyl: "lvp",
  lvt: "lvp",
  wood: "hardwood",
  timber: "hardwood",
  ceramic: "tile",
  porcelain: "tile",
  molding: "trim",
  moulding: "trim",
  transition: "trim",
  transitions: "trim",
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
 * Extra spellings of a search token that mean the same thing to a flooring
 * person but not to a database.
 *
 * Padding is the case that prompted this: "1/2 8" is how you say half-inch
 * eight-pound pad out loud, but the catalog might spell it 0.5" 8lb, .5 8#, or
 * 1/2in 8 lbs. Typing the obvious thing found nothing.
 */
export function tokenAliases(token: string): string[] {
  const out = new Set<string>([token]);
  const t = token.trim().toLowerCase();

  // Fractions <-> decimals: 1/2 <-> 0.5 <-> .5
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (frac) {
    const v = Number(frac[1]) / Number(frac[2]);
    if (Number.isFinite(v) && v > 0) {
      out.add(String(v));            // 0.5
      out.add(String(v).replace(/^0/, "")); // .5
    }
  }
  const dec = /^0?\.(\d+)$/.exec(t);
  if (dec) {
    const v = Number(`0.${dec[1]}`);
    for (const d of [2, 4, 8, 16]) {
      const n = v * d;
      if (Math.abs(n - Math.round(n)) < 1e-9) out.add(`${Math.round(n)}/${d}`);
    }
  }

  // Pound weight: 8 <-> 8lb <-> 8lbs <-> 8# — how pad density is written.
  const wt = /^(\d+(?:\.\d+)?)\s*(?:lbs?|#)$/.exec(t);
  const bare = /^(\d+(?:\.\d+)?)$/.exec(t);
  const n = wt?.[1] ?? bare?.[1];
  if (n) {
    out.add(`${n}lb`);
    out.add(`${n} lb`);
    out.add(`${n}lbs`);
    out.add(`${n}#`);
    if (wt) out.add(n);
  }
  return [...out];
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
  opts: { activeOnly?: boolean; limit?: number; includeLabor?: boolean } = {},
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
  supabase: { from: (t: string) => any; rpc?: (fn: string, args: object) => any },
  query: string,
  opts: { activeOnly?: boolean; limit?: number; includeLabor?: boolean } = {},
): Promise<Product[]> {
  const displayLimit = opts.limit ?? 50;
  const tokens = query.trim().split(/\s+/).filter(Boolean);

  /**
   * Search and rank in Postgres, where the trigram index can be used.
   *
   * The old path below ORed an ILIKE across six columns per token, pulled 400
   * rows back and ranked them here. That cost 200-430ms on 13,574 products and,
   * worse, ANDed the tokens as literal substrings — so "cushion", "1/2 8lb" and
   * "anso nylon" all returned nothing at all. search_products does strict
   * matching first and falls back to similarity rather than showing an empty
   * list. (Migration 0143.)
   */
  if (supabase.rpc) {
    try {
      const { data, error } = await supabase.rpc("search_products", {
        q: query,
        lim: displayLimit,
        include_labor: !!opts.includeLabor,
        active_only: opts.activeOnly !== false,
      });
      if (!error && Array.isArray(data)) return data as Product[];
    } catch {
      // Falls through to the original path — see below.
    }
  }

  // Fallback: the pre-0143 behaviour, so the picker still works on a database
  // where the migration hasn't been run yet.
  const pool = tokens.length ? Math.max(displayLimit * 8, 400) : displayLimit;
  let q = supabase
    .from("products")
    .select("*")
    .order("name", { ascending: true })
    .limit(pool);
  if (opts.activeOnly) q = q.eq("active", true);
  for (const token of tokens) {
    const like = likePattern(token);
    const parts: string[] = [];
    for (const alias of tokenAliases(token)) {
      const pat = alias === token ? like : likePattern(alias);
      for (const c of SEARCH_COLS) parts.push(`${c}.ilike.${pat}`);
    }
    const cat = tokenCategory(token);
    if (cat) parts.push(`category.eq.${cat}`);
    q = q.or(parts.join(","));
  }
  const { data } = await q;
  const rows = ((data ?? []) as Product[]).filter(
    (p) => opts.includeLabor || p.category !== "labor",
  );
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
  // Labor is a rounding error against the catalog and not worth a second query;
  // the list itself excludes it.
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
