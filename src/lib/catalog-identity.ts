/**
 * Style number and color number, kept findable.
 *
 * The catalog has no separate columns for them. The style number is the SKU.
 * A color number that arrived beside a color name is stored in notes as
 * "Color # 00712" so search can match any fragment of it, and the color
 * name itself stays the color.
 */
import { productLabel } from "@/lib/product-label";

const COLOR_NUMBER = /Color\s*#\s*([A-Za-z0-9][A-Za-z0-9./-]*)/i;
const HASH_NUMBER = /(?:^|[^\w])#\s*([A-Za-z0-9][A-Za-z0-9./-]*)/;

/** The color number written on a product, if we kept one. */
export function colorNumberFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.match(COLOR_NUMBER)?.[1] ?? text.match(HASH_NUMBER)?.[1] ?? null;
}

/**
 * Keep a color name and a separate color number together without dropping
 * either. A column that is only a name (no separate number) stays the color.
 */
export function foldCatalogColor(
  colorName: string | null | undefined,
  colorCode: string | null | undefined,
  notes: string | null | undefined,
): { color: string | null; notes: string | null } {
  const name = (colorName ?? "").trim();
  const code = (colorCode ?? "").trim();
  const existing = (notes ?? "").trim();
  if (!name && !code) return { color: null, notes: existing || null };
  if (!name) return { color: code, notes: existing || null };
  if (!code || name.toLowerCase().includes(code.toLowerCase())) {
    return { color: name, notes: existing || null };
  }
  // A real second field. Codes carry a digit (00712, 5T43). A second word
  // with no digit is part of the color name, not a number to hide in notes.
  if (!/\d/.test(code)) {
    return { color: `${name} ${code}`.trim(), notes: existing || null };
  }
  const tag = `Color # ${code}`;
  if (existing.toLowerCase().includes(code.toLowerCase())) {
    return { color: name, notes: existing };
  }
  return { color: name, notes: existing ? `${tag} · ${existing}` : tag };
}

/**
 * Color copied onto an estimate line. The color name stays, and the color
 * number rides along so the warehouse, the work order, and the invoice can
 * order the colorway that was picked.
 */
export function lineColorFromCatalog(
  color: string | null | undefined,
  notes: string | null | undefined,
): string {
  const name = (color ?? "").trim();
  const num = colorNumberFromText(notes);
  if (!num) return name;
  if (name.toLowerCase().includes(num.toLowerCase())) return name;
  return name ? `${name} · #${num}` : `#${num}`;
}

export interface CatalogDetailInput {
  name?: string | null;
  manufacturer?: string | null;
  style?: string | null;
  color?: string | null;
  sku?: string | null;
  notes?: string | null;
  categoryLabel?: string | null;
}

/**
 * The second line of a catalog result: style number and color number stay
 * visible even when the product name already says the color.
 */
export function catalogPickerDetail(p: CatalogDetailInput): string {
  const label = productLabel(p).toLowerCase();
  const parts: string[] = [];
  const push = (value: string | null | undefined) => {
    const v = (value ?? "").trim();
    if (!v || label.includes(v.toLowerCase())) return;
    parts.push(v);
  };
  push(p.manufacturer);
  push(p.categoryLabel);
  push(p.style);
  push(p.color);
  const sku = (p.sku ?? "").trim();
  if (sku) parts.push(`Style # ${sku}`);
  const num = colorNumberFromText(p.notes) ?? colorNumberFromText(p.color);
  if (num) parts.push(`Color # ${num}`);
  return parts.join(" · ");
}
