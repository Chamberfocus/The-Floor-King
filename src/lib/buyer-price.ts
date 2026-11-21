/**
 * Sell price for a price-book login.
 *
 * Same formula as the catalog and the estimate builder:
 *   landed = catalog cost × (1 + shop freight markup)
 *   sell   = landed / (1 − this person's gross margin)
 *
 * Vendor cost wins over the catalog rate, matching catalogUnitCost.
 * Clearance is a shop promo, not this person's margin, so it is not used.
 * The returned row has the sell price only.
 */
import { catalogSellPrice } from "@/lib/catalog-pricing";
import type { ProductVendor } from "@/lib/types";

export type BuyerPriceSource = {
  id: string;
  name: string | null;
  category?: string | null;
  unit?: string | null;
  sku?: string | null;
  manufacturer?: string | null;
  style?: string | null;
  color?: string | null;
  supplier?: string | null;
  notes?: string | null;
  search_text?: string | null;
  material_rate?: number | string | null;
  labor_rate?: number | string | null;
  vendors?: ProductVendor[] | null;
};

export type BuyerPriceRow = {
  id: string;
  name: string;
  category: string;
  unit: string;
  sku: string | null;
  manufacturer: string | null;
  style: string | null;
  color: string | null;
  /** Null when this product has no cost yet. The cost itself is never included. */
  sell: number | null;
};

const PUBLIC_KEYS = [
  "id",
  "name",
  "category",
  "unit",
  "sku",
  "manufacturer",
  "style",
  "color",
  "sell",
] as const;

export function buyerSellPrice(input: {
  material_rate?: number | string | null;
  labor_rate?: number | string | null;
  vendors?: ProductVendor[] | null;
  category?: string | null;
  marginPct: number;
  freightMarkupPct?: number | null;
}): number | null {
  const margin = Number(input.marginPct);
  if (!Number.isFinite(margin) || margin < 0 || margin >= 100) return null;
  const sell = catalogSellPrice({
    material_rate: input.material_rate,
    labor_rate: input.labor_rate,
    vendors: input.vendors,
    category: input.category,
    clearance: false,
    clearance_price: null,
    targetMarginPct: margin,
    freightMarkupPct: input.freightMarkupPct ?? 0,
  });
  if (sell.missing || sell.amount == null || !(sell.amount > 0)) return null;
  return sell.amount;
}

/** One catalog row for this login. Sell is null when the shop has no cost yet. */
export function buyerPriceRow(
  product: BuyerPriceSource,
  marginPct: number,
  freightMarkupPct: number,
): BuyerPriceRow | null {
  if (!product.id || !product.name?.trim()) return null;
  if ((product.category ?? "") === "labor") return null;
  const sell = buyerSellPrice({
    material_rate: product.material_rate,
    labor_rate: product.labor_rate,
    vendors: product.vendors,
    category: product.category,
    marginPct,
    freightMarkupPct,
  });
  const row: BuyerPriceRow = {
    id: product.id,
    name: product.name.trim(),
    category: product.category ?? "other",
    unit: product.unit ?? "each",
    sku: product.sku ?? null,
    manufacturer: product.manufacturer ?? null,
    style: product.style ?? null,
    color: product.color ?? null,
    sell,
  };
  const leaked = Object.keys(row).filter(
    (key) => !PUBLIC_KEYS.includes(key as (typeof PUBLIC_KEYS)[number]),
  );
  if (leaked.length) return null;
  return row;
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9./]+/).filter(Boolean);
}

/** One insertion, deletion, or substitution. */
function oneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length > b.length) return oneEdit(b, a);
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length === b.length) i += 1;
    j += 1;
  }
  return true;
}

function wordRank(word: string, token: string): number {
  if (word === token) return 100;
  if (word.includes(token)) return 80;
  if (token.length >= 4 && word.startsWith(token)) return 60;
  if (token.length >= 5 && word.length >= 5 && oneEdit(word, token)) return 40;
  return 0;
}

function productWords(
  product: Pick<
    BuyerPriceSource,
    "name" | "sku" | "manufacturer" | "style" | "color" | "supplier" | "notes" | "search_text"
  >,
): string[] {
  return wordsOf(
    [
      product.name,
      product.manufacturer,
      product.supplier,
      product.style,
      product.color,
      product.sku,
      product.search_text,
      product.notes,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/**
 * Higher is a closer match. 0 means it is not a match.
 * The typed letters have to appear, or miss by one letter. "primary" and
 * "promise" are not matches for "primose". "Primrose" is.
 */
export function buyerMatchRank(
  product: Pick<
    BuyerPriceSource,
    "name" | "sku" | "manufacturer" | "style" | "color" | "supplier" | "notes" | "search_text"
  >,
  query: string,
): number {
  const tokens = wordsOf(query).filter((token) => token.length >= 2);
  if (!tokens.length) return 0;
  const words = productWords(product);
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const word of words) best = Math.max(best, wordRank(word, token));
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/** Every typed word is in the product, allowing one letter off. */
export function buyerQueryMatches(
  product: Pick<
    BuyerPriceSource,
    "name" | "sku" | "manufacturer" | "style" | "color" | "supplier" | "notes" | "search_text"
  >,
  query: string,
): boolean {
  return buyerMatchRank(product, query) > 0;
}

/**
 * Patterns for one indexed lookup. The token itself, plus a single-character
 * gap so "primose" can see "Primrose". Not a chopped stem like "primo".
 */
export function buyerSearchPatterns(token: string): string[] {
  const patterns = [token];
  if (token.length >= 5 && token.length <= 20) {
    for (let i = 0; i <= token.length; i++) patterns.push(`${token.slice(0, i)}_${token.slice(i)}`);
  }
  return patterns;
}

/** Where a customer login lands. A price-book account never opens the portal. */
export function customerHome(priceBook: { active: boolean } | null): "/portal" | "/price-book" {
  return priceBook ? "/price-book" : "/portal";
}
