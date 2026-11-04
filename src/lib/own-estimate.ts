import { catalogLineSnapshot } from "@/lib/catalog-pricing";
import { productLabel } from "@/lib/product-label";
import type { Product } from "@/lib/types";
import { normalizeUnit, pickedProductUnit } from "@/lib/units";

/**
 * One line on the short "build it myself" quote.
 *
 * Saved through the same row the quick estimate already writes, so a purchase
 * order, work order, and invoice read category, product, room, and coverage
 * from one place.
 */
export interface OwnEstimateDraft {
  room: string;
  description: string;
  quantity: string;
  unit: string;
  /** Customer price per unit. Blank saves as zero and shows PRICE NEEDED. */
  rate: string;
  /** Our cost per unit. Not marked up with gas, car, or commission. */
  cost: string;
  productId: string | null;
  category: string | null;
  manufacturer: string | null;
  style: string | null;
  color: string | null;
  sku: string | null;
  sqftPerBox: number | null;
  rollWidthFt: number | null;
  coverageSqft: number | null;
  coverageThicknessIn: number | null;
}

function positive(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(x) && x > 0 ? x : null;
}

function money(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  return String(v);
}

export function emptyOwnDraft(room = ""): OwnEstimateDraft {
  return {
    room: room.trim(),
    description: "",
    quantity: "",
    unit: "each",
    rate: "",
    cost: "",
    productId: null,
    category: "labor",
    manufacturer: null,
    style: null,
    color: null,
    sku: null,
    sqftPerBox: null,
    rollWidthFt: null,
    coverageSqft: null,
    coverageThicknessIn: null,
  };
}

type CatalogPick = Pick<
  Product,
  | "id"
  | "name"
  | "category"
  | "unit"
  | "material_rate"
  | "labor_rate"
  | "sku"
  | "manufacturer"
  | "style"
  | "color"
> &
  Partial<
    Pick<
      Product,
      | "vendors"
      | "clearance"
      | "clearance_price"
      | "sqft_per_box"
      | "roll_width_ft"
      | "coverage_sqft"
      | "coverage_thickness_in"
      | "catalog_sell"
      | "catalog_cost"
    >
  >;

/**
 * A catalog pick becomes one line. Labor is the work: it keeps the name and
 * the price, and it does not keep a product id, so it cannot be ordered as a
 * material.
 */
export function draftLineFromProduct(
  product: CatalogPick,
  room: string,
  pricing: { targetMarginPct: number; freightMarkupPct: number },
): OwnEstimateDraft {
  const base = emptyOwnDraft(room);
  if ((product.category ?? "").toLowerCase() === "labor") {
    const sell = product.catalog_sell ?? positive(product.labor_rate) ?? positive(product.material_rate);
    const cost = product.catalog_cost ?? positive(product.labor_rate);
    return {
      ...base,
      description: productLabel(product),
      unit: normalizeUnit(pickedProductUnit(product.unit, "labor")) || "each",
      rate: money(sell),
      cost: money(cost),
      productId: null,
      category: "labor",
    };
  }
  const snap = catalogLineSnapshot(product, pricing);
  return {
    ...base,
    description: productLabel(product),
    unit: normalizeUnit(snap.lineUnit) || snap.lineUnit || "",
    rate: money(snap.materialSell),
    cost: money(snap.materialCost),
    productId: product.id,
    category: product.category ?? null,
    manufacturer: product.manufacturer ?? null,
    style: product.style ?? null,
    color: product.color ?? null,
    sku: product.sku ?? null,
    sqftPerBox: positive(product.sqft_per_box),
    rollWidthFt: positive(product.roll_width_ft),
    coverageSqft: positive(product.coverage_sqft),
    coverageThicknessIn: positive(product.coverage_thickness_in),
  };
}

/** A one-off typed in the picker. Not saved as a catalog product. */
export function draftLineFromCustom(
  input: {
    name: string;
    category: string;
    unit: string;
    material_rate: string;
    labor_rate: string;
    manufacturer: string;
    style: string;
    color: string;
    sku: string;
    coverage_sqft: string;
    coverage_thickness_in: string;
    specs?: Record<string, string>;
  },
  room: string,
): OwnEstimateDraft {
  const base = emptyOwnDraft(room);
  const labor = input.category.trim().toLowerCase() === "labor";
  if (labor) {
    return {
      ...base,
      description: input.name.trim(),
      unit: normalizeUnit(input.unit) || "each",
      rate: input.labor_rate.trim() || input.material_rate.trim(),
      productId: null,
      category: "labor",
    };
  }
  return {
    ...base,
    description: input.name.trim(),
    unit: normalizeUnit(input.unit) || "",
    rate: input.material_rate.trim(),
    cost: "",
    productId: null,
    category: input.category.trim() || null,
    manufacturer: input.manufacturer.trim() || null,
    style: input.style.trim() || null,
    color: input.color.trim() || null,
    sku: input.sku.trim() || null,
    sqftPerBox: positive(input.specs?.sqft_per_box),
    rollWidthFt: positive(input.specs?.roll_width_ft),
    coverageSqft: positive(input.coverage_sqft),
    coverageThicknessIn: positive(input.coverage_thickness_in),
  };
}
