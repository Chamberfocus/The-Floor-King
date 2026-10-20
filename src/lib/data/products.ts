import { createClient } from "@/lib/supabase/server";
import { catalogUnitCost, hydrateCatalogPricing } from "@/lib/catalog-pricing";
import { rankCatalogProducts } from "@/lib/catalog-search";
import {
  measurementAliases,
  parseCatalogQuery,
  tokenMatchOr,
  type CatalogToken,
} from "@/lib/catalog-query";
import type { Product, ProductVendor, SupplierKind } from "@/lib/types";

/**
 * Catalog product columns that `authenticated` may SELECT after 0176.
 * Never include avg_unit_cost / inventory_carrying_value — PostgREST `select *`
 * requests those revoked columns and the whole query fails, which is why
 * pickers could search names but not show prices.
 */
export const CATALOG_PRODUCT_COLUMNS = [
  "id",
  "name",
  "category",
  "unit",
  "material_rate",
  "labor_rate",
  "sku",
  "manufacturer",
  "style",
  "color",
  "supplier",
  "supplier_id",
  "notes",
  "active",
  "track_stock",
  "on_hand",
  "on_order",
  "reorder_point",
  "bin_location",
  "stock_kind",
  "reserved",
  "clearance",
  "clearance_price",
  "last_movement_at",
  "created_at",
  "updated_at",
  "sqft_per_box",
  "roll_width_ft",
  "coverage_sqft",
  "coverage_thickness_in",
  "wear_layer_mil",
  "thickness_mm",
  "face_weight_oz",
  "piece_length_in",
  "fiber",
  "wear_rating",
  "species",
  "accessory_program_id",
  "accessory_type_id",
  "accessory_variant",
  "accessory_origin",
  "search_text",
  "price_override",
].join(", ");

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

/** Margin and freight change rarely. A picker keystroke must not re-read both rows. */
let pricingMemo: {
  at: number;
  value: { targetMarginPct: number; freightMarkupPct: number };
} | null = null;
const PRICING_MEMO_MS = 60_000;

async function catalogPricingContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (t: string) => any },
): Promise<{ targetMarginPct: number; freightMarkupPct: number }> {
  if (pricingMemo && Date.now() - pricingMemo.at < PRICING_MEMO_MS) return pricingMemo.value;
  let targetMarginPct = 40;
  let freightMarkupPct = 0;
  try {
    const [biz, org] = await Promise.all([
      supabase
        .from("business_settings")
        .select("target_gross_margin_pct")
        .eq("id", "default")
        .maybeSingle(),
      supabase
        .from("org_settings")
        .select("freight_markup_pct")
        .eq("id", "default")
        .maybeSingle(),
    ]);
    targetMarginPct = Number(biz?.data?.target_gross_margin_pct) || 40;
    freightMarkupPct = Number(org?.data?.freight_markup_pct) || 0;
  } catch {
    /* defaults */
  }
  const value = { targetMarginPct, freightMarkupPct };
  pricingMemo = { at: Date.now(), value };
  return value;
}

/** Vendor costs + computed catalog_cost / catalog_sell. Fail-open. */
export async function enrichCatalogProducts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: { from: (t: string) => any },
  products: Product[],
): Promise<Product[]> {
  const withVendors = await attachProductVendors(db as Awaited<ReturnType<typeof createClient>>, products);
  const ctx = await catalogPricingContext(db);
  return hydrateCatalogPricing(withVendors, ctx);
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
      .select(CATALOG_PRODUCT_COLUMNS)
      .order("category", { ascending: true })
      .order("name", { ascending: true })
      .range(from, from + PAGE - 1);
    if (opts.activeOnly) query = query.eq("active", true);
    const { data, error } = await query;
    if (error) throw error;
    const batch = (data ?? []) as unknown as Product[];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }
  // Labor is dropped HERE, not in SQL. `category <> 'labor'` matches almost
  // every row, so Postgres gains nothing from it and — with an index on
  // (active, category) — can be talked into walking that index instead of
  // scanning, which cost 2.4s on 13,558 products and timed the PO page out.
  // Fourteen rows filtered in memory is free.
  const rows = opts.includeLabor ? all : all.filter((p) => p.category !== "labor");
  return enrichCatalogProducts(supabase, rows);
}

/**
 * Columns the generated search_text already covers, plus the spec fields it
 * does not (fiber, species, notes). Category is an enum, matched by equality
 * inside tokenMatchOr when the word is trade language ("pad", "cushion").
 */
const SMART_TEXT_COLS = ["search_text", "fiber", "species", "notes"] as const;
const PLAIN_TEXT_COLS = ["name", "sku", "manufacturer", "style", "color", "supplier"] as const;

/**
 * Extra spellings of a measurement. Kept for callers that already import it.
 * Catalog search itself goes through parseCatalogQuery.
 */
export function tokenAliases(token: string): string[] {
  return measurementAliases(token);
}

/**
 * Smart, server-side product search. Every word has to show up somewhere —
 * name, SKU, brand, color, fiber — in any order. Trade words ("pad",
 * "cushion"), fractions ("1/2"), and a one-letter typo still find the product.
 * Empty query returns the first `limit` by name.
 */
export interface CatalogSearchOpts {
  activeOnly?: boolean;
  limit?: number;
  includeLabor?: boolean;
  /**
   * When set, search these categories with equality — do not score the
   * whole catalog. Null/omitted searches every category.
   */
  categories?: string[] | null;
  /** Empty-browse words OR'd against name / sku / search_text. Not compatibility. */
  browseTokens?: string[] | null;
  /** Global search only needs identity. Pricing enrichment is a second round trip. */
  enrich?: boolean;
}

export async function searchCatalog(
  query: string,
  opts: CatalogSearchOpts = {},
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
  opts: CatalogSearchOpts = {},
): Promise<Product[]> {
  const displayLimit = opts.limit ?? 50;
  const parsed = parseCatalogQuery(query);
  const required = parsed.filter((token) => !token.optional);

  let scoped: Product[] | null = null;
  try {
    scoped = await searchCatalogScoped(supabase, query, required, displayLimit, opts);
  } catch {
    scoped = null;
  }
  if (scoped) return scoped;

  // search_products_smart (0495) ranks in Postgres and uses the trigram index.
  // Until that migration is applied the RPC errors and the filter below runs
  // the same plan. The older search_products ranks by whole-string similarity
  // and is not called — it put the wrong product first.
  const browse = (opts.browseTokens ?? []).map((t) => t.trim()).filter(Boolean);
  const categories = (opts.categories ?? []).map((c) => c.trim()).filter(Boolean);
  if (supabase.rpc && !browse.length) {
    try {
      const smart = await supabase.rpc("search_products_smart", {
        q: query,
        lim: displayLimit,
        include_labor: !!opts.includeLabor,
        active_only: opts.activeOnly !== false,
        categories: categories.length ? categories : null,
      });
      if (!smart.error && Array.isArray(smart.data) && (smart.data.length > 0 || parsed.length === 0)) {
        const rows = (smart.data as Product[]).filter(
          (p) => opts.includeLabor || p.category !== "labor",
        );
        const ranked = parsed.length ? rankCatalogProducts(rows, query) : rows;
        return finishCatalogSearch(supabase, ranked.slice(0, displayLimit), opts);
      }
    } catch {
      // Function not installed yet — the filter below is the same match.
    }
  }

  const rows = await searchCatalogFiltered(supabase, query, required, displayLimit, opts, null);
  return finishCatalogSearch(supabase, rows, opts);
}

function finishCatalogSearch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (t: string) => any },
  rows: Product[],
  opts: CatalogSearchOpts,
): Promise<Product[]> {
  if (opts.enrich === false) return Promise.resolve(rows);
  return enrichCatalogProducts(supabase, rows);
}

/**
 * Category (or adhesive-word) search. Equality on category uses the category
 * index. Text uses the same token plan as the unscoped search, then ranking
 * runs only on this set. Returns null when the caller did not narrow the catalog.
 */
async function searchCatalogScoped(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (t: string) => any },
  query: string,
  tokens: CatalogToken[],
  displayLimit: number,
  opts: CatalogSearchOpts,
): Promise<Product[] | null> {
  const categories = (opts.categories ?? []).map((c) => c.trim()).filter(Boolean);
  const browse = (opts.browseTokens ?? []).map((t) => t.trim()).filter(Boolean);
  if (!categories.length && !browse.length) return null;

  const rows = await searchCatalogFiltered(supabase, query, tokens, displayLimit, opts, {
    categories,
    browse,
  });
  if (!tokens.length && browse.length && !rows.length && categories.length) {
    return searchCatalogScoped(supabase, query, tokens, displayLimit, {
      ...opts,
      browseTokens: null,
    });
  }
  return finishCatalogSearch(supabase, rows, opts);
}

/**
 * AND every required word (each word OR'd across its spellings and category).
 * If that finds nothing, one OR of the same words so a typo still shows the
 * closest products instead of an empty list.
 */
async function searchCatalogFiltered(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (t: string) => any },
  query: string,
  tokens: CatalogToken[],
  displayLimit: number,
  opts: CatalogSearchOpts,
  scope: { categories: string[]; browse: string[] } | null,
): Promise<Product[]> {
  // Enough rows to rank the real match, not just the alphabetical first page.
  // search_products_smart skips this and returns an already-ranked page.
  const pool = tokens.length ? Math.min(800, Math.max(displayLimit * 3, 400)) : displayLimit;
  const run = async (columns: readonly string[], mode: "and" | "or" | "browse") => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase
      .from("products")
      .select(CATALOG_PRODUCT_COLUMNS)
      .order("name", { ascending: true })
      .limit(mode === "or" ? Math.min(pool, 160) : pool);
    if (opts.activeOnly !== false) q = q.eq("active", true);
    const categories = scope?.categories ?? [];
    if (categories.length === 1) q = q.eq("category", categories[0]);
    else if (categories.length > 1) q = q.in("category", categories);

    if (mode === "browse") {
      const parts: string[] = [];
      for (const token of scope?.browse ?? []) {
        const clause = tokenMatchOr(
          { raw: token, forms: [token], synonyms: [], categories: [], needles: [token], optional: false },
          ["search_text", "name", "sku"],
        );
        if (clause) parts.push(clause);
      }
      if (parts.length) q = q.or(parts.join(","));
    } else if (mode === "or") {
      const parts = tokens.map((token) => tokenMatchOr(token, columns)).filter(Boolean);
      if (parts.length) q = q.or(parts.join(","));
    } else {
      for (const token of tokens) {
        const clause = tokenMatchOr(token, columns);
        if (clause) q = q.or(clause);
      }
    }
    const { data, error } = await q;
    if (error) return null;
    return ((data ?? []) as Product[]).filter(
      (p) => opts.includeLabor || p.category !== "labor",
    );
  };

  const browsing = !tokens.length && !!scope?.browse.length;
  let rows = await run(SMART_TEXT_COLS, browsing ? "browse" : "and");
  if (rows == null) rows = await run(PLAIN_TEXT_COLS, browsing ? "browse" : "and");
  if (rows == null) return [];
  if (tokens.length && rows.length === 0) {
    const relaxed = (await run(SMART_TEXT_COLS, "or")) ?? (await run(PLAIN_TEXT_COLS, "or"));
    if (relaxed?.length) rows = relaxed;
  }
  if (!query.trim()) return rows.slice(0, displayLimit);
  return rankCatalogProducts(rows, query).slice(0, displayLimit);
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

/**
 * Primary catalog/vendor unit cost keyed by product id. Used by PO builders so
 * vendor COST is never confused with customer sell (`estimate_line_items.material_rate`).
 */
export async function primaryCatalogCostByProductIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: { from: (t: string) => any },
  productIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(productIds)].filter(Boolean);
  if (!ids.length) return out;
  const { data: prods } = await db
    .from("products")
    .select("id, material_rate")
    .in("id", ids);
  const vendorsByProduct = new Map<string, ProductVendor[]>();
  try {
    for (let i = 0; i < ids.length; i += 300) {
      const { data: vendors, error } = await db
        .from("product_vendors")
        .select("id, product_id, vendor_id, cost, vendor_sku, position")
        .in("product_id", ids.slice(i, i + 300))
        .order("position", { ascending: true });
      if (error) break;
      for (const r of vendors ?? []) {
        const row: ProductVendor = {
          id: r.id as string,
          product_id: r.product_id as string,
          vendor_id: r.vendor_id as string,
          cost: r.cost == null ? null : Number(r.cost),
          vendor_sku: (r.vendor_sku as string) ?? null,
          position: (r.position as number) ?? 0,
        };
        const arr = vendorsByProduct.get(row.product_id) ?? [];
        arr.push(row);
        vendorsByProduct.set(row.product_id, arr);
      }
    }
  } catch {
    /* product_vendors missing → material_rate only */
  }
  for (const p of prods ?? []) {
    const c = catalogUnitCost({
      material_rate: p.material_rate,
      vendors: vendorsByProduct.get(p.id as string),
    });
    if (!c.missing && c.amount != null) out.set(p.id as string, c.amount);
  }
  return out;
}

export async function getProduct(id: string): Promise<Product | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select(CATALOG_PRODUCT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const [p] = await enrichCatalogProducts(supabase, [data as unknown as Product]);
  return p;
}
