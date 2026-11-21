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
  sell: number;
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

/** One priced row, or null when this product has no sell price. */
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
  if (sell == null) return null;
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

/** Where a customer login lands. A price-book account never opens the portal. */
export function customerHome(priceBook: { active: boolean } | null): "/portal" | "/price-book" {
  return priceBook ? "/price-book" : "/portal";
}
