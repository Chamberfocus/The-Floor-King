/**
 * Catalog pricing — one source of truth for cost vs sell.
 *
 * Database:
 *   products.material_rate / labor_rate = OUR COST (catalog), never customer sell.
 *   product_vendors.cost                 = vendor-specific unit cost (primary vendor
 *                                          is the operational cost when present).
 *   products.clearance_price             = optional clearance SELL.
 *   products.avg_unit_cost               = inventory WAC (valuation), not catalog cost.
 *
 * Sell is not stored on the product. Estimates snapshot sell onto
 * estimate_line_items.material_rate / labor_rate via target gross margin:
 *   SELL = landedCost / (1 - margin)     (priceFromMargin)
 *
 * `material_rate` is NOT NULL DEFAULT 0, so 0 without a vendor cost is treated
 * as missing (PRICE NEEDED), not a legitimate free good. An explicit vendor
 * cost of 0 is a real zero.
 */
import { marginPct, priceFromMargin } from "@/lib/estimate-calc";
import { sellMaterialFromTargetMargin } from "@/lib/estimate-pricing";
import { catalogRateToBillingUnit, catalogUnitFactor, isAreaUnit, normalizeUnit } from "@/lib/units";
import { isRollGoodCategory } from "@/lib/types";
import {
  boxedCartonAreaTakeoffAllowed,
  familyFromCatalogCategory,
  type InstallSystem,
} from "@/lib/flooring-knowledge";
import type { Product, ProductVendor, UserRole } from "@/lib/types";

export const PRICE_NEEDED = "PRICE NEEDED";

export type CatalogCostSource = "vendor" | "material_rate" | "missing";

export type CatalogCost = {
  amount: number | null;
  source: CatalogCostSource;
  /** No usable catalog/vendor cost (default-0 material_rate and no vendor cost). */
  missing: boolean;
  /** Explicit stored zero (vendor cost 0). Distinct from missing. */
  zero: boolean;
};

export type CatalogSell = {
  amount: number | null;
  missing: boolean;
  kind: "clearance" | "target_margin" | "zero" | "missing";
};

const n = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(x) ? x : null;
};

function sortedVendors(
  vendors: ProductVendor[] | null | undefined,
): ProductVendor[] {
  return [...(vendors ?? [])].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );
}

/** Primary vendor unit cost: lowest position with a numeric cost (including 0). */
export function primaryVendorCost(
  vendors: ProductVendor[] | null | undefined,
): number | null {
  for (const v of sortedVendors(vendors)) {
    const c = n(v.cost);
    if (c != null) return c;
  }
  return null;
}

/**
 * OUR unit cost for quoting / POs.
 * Vendor cost wins when recorded; otherwise products.material_rate when > 0.
 */
export function catalogUnitCost(p: {
  material_rate?: number | string | null;
  vendors?: ProductVendor[] | null;
}): CatalogCost {
  const vendor = primaryVendorCost(p.vendors);
  if (vendor != null) {
    return {
      amount: vendor,
      source: "vendor",
      missing: false,
      zero: vendor === 0,
    };
  }
  const rate = n(p.material_rate);
  if (rate == null || rate === 0) {
    return { amount: null, source: "missing", missing: true, zero: false };
  }
  return {
    amount: rate,
    source: "material_rate",
    missing: false,
    zero: false,
  };
}

/** OUR labor catalog cost (labor items). 0 without a rate is missing. */
export function catalogLaborCost(p: {
  labor_rate?: number | string | null;
}): CatalogCost {
  const rate = n(p.labor_rate);
  if (rate == null || rate === 0) {
    return { amount: null, source: "missing", missing: true, zero: false };
  }
  return {
    amount: rate,
    source: "material_rate",
    missing: false,
    zero: false,
  };
}

export type CatalogSellInput = {
  material_rate?: number | string | null;
  labor_rate?: number | string | null;
  vendors?: ProductVendor[] | null;
  clearance?: boolean | null;
  clearance_price?: number | string | null;
  category?: string | null;
  targetMarginPct?: number | string | null;
  freightMarkupPct?: number | string | null;
};

/**
 * Customer unit sell for a catalog product at the shop target margin.
 * Does not mutate the product. Clearance sell wins when flagged and priced.
 */
export function catalogSellPrice(p: CatalogSellInput): CatalogSell {
  const clr = n(p.clearance_price);
  if (p.clearance && clr != null && clr > 0) {
    return { amount: clr, missing: false, kind: "clearance" };
  }
  const laborOnly = p.category === "labor";
  const cost = laborOnly ? catalogLaborCost(p) : catalogUnitCost(p);
  if (cost.missing || cost.amount == null) {
    return { amount: null, missing: true, kind: "missing" };
  }
  if (cost.zero || cost.amount === 0) {
    return { amount: 0, missing: false, kind: "zero" };
  }
  const sell = laborOnly
    ? priceFromMargin(cost.amount, p.targetMarginPct ?? 40)
    : sellMaterialFromTargetMargin(
        cost.amount,
        p.targetMarginPct ?? 40,
        p.freightMarkupPct,
      );
  return {
    amount: Math.round(sell * 100) / 100,
    missing: false,
    kind: "target_margin",
  };
}

/** Gross margin % from catalog cost → catalog sell (null if not computable). */
export function catalogMarginPct(cost: CatalogCost, sell: CatalogSell): number | null {
  if (cost.missing || sell.missing || cost.amount == null || sell.amount == null) {
    return null;
  }
  if (!(sell.amount > 0)) return null;
  return marginPct(sell.amount, cost.amount);
}

export type CatalogPricePurpose = "sell" | "cost" | "identity";

/** Quote roles may see customer sell. Warehouse/crew/customer/scheduler may not. */
export function roleMaySeeCatalogSell(role: UserRole | null | undefined): boolean {
  return (
    role === "admin" ||
    role === "office" ||
    role === "sales_manager" ||
    role === "salesman"
  );
}

/**
 * Cost visibility.
 * Estimate builders already see cost on lines (salesman included).
 * Inventory valuation stays admin/office/sales_manager — this is catalog cost
 * for quoting and POs, not carrying value.
 */
export function roleMaySeeCatalogCost(
  role: UserRole | null | undefined,
  purpose: CatalogPricePurpose = "sell",
): boolean {
  if (role === "customer" || role === "crew" || role === "scheduler") return false;
  if (purpose === "identity") return false;
  if (purpose === "cost") {
    return (
      role === "admin" ||
      role === "office" ||
      role === "sales_manager" ||
      role === "warehouse" ||
      role === "salesman"
    );
  }
  return (
    role === "admin" ||
    role === "office" ||
    role === "sales_manager" ||
    role === "salesman"
  );
}

/** Margin % on the picker/catalog: office commercial roles, not salesman/warehouse. */
export function roleMaySeeCatalogMargin(role: UserRole | null | undefined): boolean {
  return role === "admin" || role === "office" || role === "sales_manager";
}

/**
 * Same unit conversion the estimate builder uses when a product is picked:
 * count units 1:1; carpet/sheet vinyl bill per sq yd (×9 from per-sq-ft cost).
 * Catalog box rate onto an area line is $/coverage, not 1:1 — wrap / count How many stays 1:1.
 * Exclusive carpet-tile catalog box rate onto that area line is $/coverage, not 1:1 —
 * mixed stretch-in + tile still waits for cuts. Exclusive carpet-tile Builder boxed rate onto that area line is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay How many. AI notes exclusive carpet-tile catalog box rate onto that area line is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Exclusive carpet-tile PO / warehouse / work-order carton math from sq ft ÷ coverage — mixed stretch-in + tile and unanswered carpet stay cuts. Exclusive carpet-tile PO boxed rate onto that area line is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Hard-surface PO boxed rate onto that area line is $/coverage, not 1:1. Exclusive carpet-tile catalog picker boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Hard-surface catalog picker boxed rate onto sq ft is $/coverage, not 1:1. Hard-surface catalog picker swap boxed rate onto sq ft is $/coverage, not 1:1. Exclusive carpet-tile catalog picker swap boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Hard-surface catalog picker cost line boxed rate onto sq ft is $/coverage, not 1:1. Exclusive carpet-tile catalog picker cost line boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Do not infer exclusive tile from unit=box. Do not invent coverage.
 */
export function catalogToLineMeasure(product: {
  unit?: string | null;
  category?: string | null;
  sqft_per_box?: number | string | null;
  carpetInstallSystems?: InstallSystem[] | null;
}): {
  count: boolean;
  measureUnit: "sqft" | "sqyd";
  factor: number;
  lineUnit: string;
} {
  const catUnit = normalizeUnit(product.unit);
  // Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes.
  const boxedArea = boxedCartonAreaTakeoffAllowed({
    family: familyFromCatalogCategory(product.category ?? "other"),
    productUnit: product.unit,
    sqftPerBox: Number(product.sqft_per_box) > 0 ? Number(product.sqft_per_box) : null,
    carpetInstallSystems: product.carpetInstallSystems,
  });
  const count = boxedArea ? false : !isAreaUnit(product.unit);
  const measureUnit: "sqft" | "sqyd" = isRollGoodCategory(product.category)
    ? "sqyd"
    : catUnit === "sqyd"
      ? "sqyd"
      : "sqft";
  let factor = catalogUnitFactor(product.unit, measureUnit === "sqyd");
  if (boxedArea) {
    const cov = Number(product.sqft_per_box);
    // Catalog box rate onto an area line is $/coverage, not 1:1.
    // Wrap / count How many stays 1:1 (callers pass sqft_per_box null).
    // Do not invent coverage — boxedArea already requires cov > 0.
    factor = catalogUnitFactor("sqft", measureUnit === "sqyd") / cov;
  }
  const lineUnit = count
    ? product.unit || ""
    : measureUnit === "sqyd"
      ? "sq yd"
      : "sq ft";
  return { count, measureUnit, factor, lineUnit };
}

/**
 * Catalog per-unit rate in the line's billing unit.
 * Count units 1:1. Boxed carton WITH coverage that takeoffs as area is $/coverage, not 1:1.
 * Exclusive carpet-tile catalog box rate onto that area line is $/coverage, not 1:1 —
 * mixed stretch-in + tile still waits for cuts. Exclusive carpet-tile PO boxed rate onto that area line is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Hard-surface PO boxed rate onto that area line is $/coverage, not 1:1. Exclusive carpet-tile catalog picker boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Hard-surface catalog picker boxed rate onto sq ft is $/coverage, not 1:1. Hard-surface catalog picker swap boxed rate onto sq ft is $/coverage, not 1:1. Exclusive carpet-tile catalog picker swap boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Hard-surface catalog picker cost line boxed rate onto sq ft is $/coverage, not 1:1. Exclusive carpet-tile catalog picker cost line boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1 — omit sqft_per_box.
 * Do not invent coverage.
 */
export function catalogRateInLineUnit(
  rate: number,
  product: {
    unit?: string | null;
    category?: string | null;
    sqft_per_box?: number | string | null;
    carpetInstallSystems?: InstallSystem[] | null;
  },
  billingIsSqyd: boolean,
): number {
  const r = Number(rate) || 0;
  const boxedArea = boxedCartonAreaTakeoffAllowed({
    family: familyFromCatalogCategory(product.category ?? "other"),
    productUnit: product.unit,
    sqftPerBox: Number(product.sqft_per_box) > 0 ? Number(product.sqft_per_box) : null,
    carpetInstallSystems: product.carpetInstallSystems,
  });
  if (boxedArea) {
    return Math.round(r * catalogToLineMeasure(product).factor * 100) / 100;
  }
  return catalogRateToBillingUnit(r, product.unit, billingIsSqyd);
}

/** Catalog unit cost converted into the estimate line's billing unit. */
export function catalogCostInLineUnit(product: {
  unit?: string | null;
  category?: string | null;
  material_rate?: number | string | null;
  vendors?: ProductVendor[] | null;
  sqft_per_box?: number | string | null;
  carpetInstallSystems?: InstallSystem[] | null;
}): CatalogCost {
  const base = catalogUnitCost(product);
  if (base.missing || base.amount == null) return base;
  const { factor } = catalogToLineMeasure(product);
  const amount = Math.round(base.amount * factor * 100) / 100;
  return { ...base, amount, zero: amount === 0 };
}

/**
 * Cost + sell to snapshot onto an estimate line when a catalog product is picked.
 * Uses the estimate's target margin (not a stored sell column). Clearance sell
 * wins when flagged. Missing catalog cost → both null (PRICE NEEDED).
 */
export function catalogLineSnapshot(
  product: CatalogSellInput & {
    unit?: string | null;
    sqft_per_box?: number | string | null;
    carpetInstallSystems?: InstallSystem[] | null;
  },
  opts: { targetMarginPct: number; freightMarkupPct: number },
): {
  lineUnit: string;
  measureUnit: "sqft" | "sqyd";
  count: boolean;
  factor: number;
  materialCost: number | null;
  materialSell: number | null;
  missing: boolean;
} {
  const conv = catalogToLineMeasure(product);
  const cost = catalogCostInLineUnit(product);
  const clr = n(product.clearance_price);
  if (product.clearance && clr != null && clr > 0) {
    return {
      ...conv,
      materialCost: cost.missing ? null : cost.amount,
      materialSell: Math.round(clr * conv.factor * 100) / 100,
      missing: false,
    };
  }
  if (cost.missing || cost.amount == null) {
    return {
      ...conv,
      materialCost: null,
      materialSell: null,
      missing: true,
    };
  }
  const sell = cost.zero
    ? 0
    : sellMaterialFromTargetMargin(
        cost.amount,
        opts.targetMarginPct,
        opts.freightMarkupPct,
      );
  return {
    ...conv,
    materialCost: cost.amount,
    materialSell: Math.round(sell * 100) / 100,
    missing: false,
  };
}

export function formatCatalogPrice(
  sellOrCost: { amount: number | null; missing: boolean },
  formatMoney: (n: number) => string,
): string {
  if (sellOrCost.missing || sellOrCost.amount == null) return PRICE_NEEDED;
  return formatMoney(sellOrCost.amount);
}

/** Stamp computed catalog_cost / catalog_sell onto products (not persisted). */
export function hydrateCatalogPricing<T extends Product>(
  products: T[],
  ctx: { targetMarginPct: number; freightMarkupPct: number },
): T[] {
  return products.map((p) => {
    const cost = catalogUnitCost(p);
    const sell = catalogSellPrice({
      ...p,
      targetMarginPct: ctx.targetMarginPct,
      freightMarkupPct: ctx.freightMarkupPct,
    });
    return {
      ...p,
      catalog_cost: cost.missing ? null : cost.amount,
      catalog_sell: sell.missing ? null : sell.amount,
    };
  });
}

/** Strip cost/margin fields before sending a product to an unauthorized client. */
export function redactCatalogCost<T extends Product>(
  product: T,
  role: UserRole | null | undefined,
  purpose: CatalogPricePurpose = "sell",
): T {
  if (roleMaySeeCatalogCost(role, purpose)) return product;
  const vendors = (product.vendors ?? []).map((v) => ({ ...v, cost: null }));
  return {
    ...product,
    material_rate: 0,
    labor_rate: 0,
    catalog_cost: null,
    avg_unit_cost: null,
    vendors,
  };
}
