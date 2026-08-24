/**
 * How a product is named, in one place.
 *
 * Eight screens each built this themselves as roughly
 * `[manufacturer, name, color].filter(Boolean).join(" ")`. That is wrong for
 * this catalog: `products.name` is already "style + colour" for 860 of 1000
 * products, and already carries the manufacturer for 508 of them. So the
 * formula printed the colour twice, and often the brand twice:
 *
 *   "CDC" + "Everlasting XL Blackjack Oak" + "Blackjack Oak"
 *     → "CDC Everlasting XL Blackjack Oak Blackjack Oak"
 *   "IFC" + "IFC Founder's Collection Leconte Oak" + "Leconte Oak"
 *     → "IFC IFC Founder's Collection Leconte Oak Leconte Oak"
 *
 * 26 of 120 product lines on live estimates read like that — on the estimate the
 * customer signs, the invoice they pay, the work order the crew carries and the
 * staging sheet the warehouse picks from. And because the purchase order built
 * its label from `style` instead of `name`, the PO named the same product
 * differently again, so no two documents agreed.
 *
 * One function now. It adds a part only when the name doesn't already say it.
 */

/** Compare loosely: case, punctuation and spacing shouldn't decide a match. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function alreadySays(label: string, part: string): boolean {
  const n = norm(part);
  return !!n && norm(label).includes(n);
}

export interface ProductLike {
  name?: string | null;
  /** Falls back to `style` for rows that carry one but no name (PO items). */
  style?: string | null;
  manufacturer?: string | null;
  color?: string | null;
}

/**
 * The product's full name: brand, style, colour — each said once.
 *
 * Deliberately additive rather than reconstructive: whatever the catalog calls
 * the product stays the spine of the label, and brand/colour are only prepended
 * or appended when they're genuinely missing from it. That way a supplier feed
 * that names things well isn't second-guessed, and one that names them poorly
 * still gets a complete label.
 */
export function productLabel(p: ProductLike): string {
  let label = (p.name || p.style || "").trim();
  const mfr = (p.manufacturer ?? "").trim();
  const color = (p.color ?? "").trim();

  if (!label) return [mfr, color].filter(Boolean).join(" ");
  if (mfr && !alreadySays(label, mfr)) label = `${mfr} ${label}`;
  if (color && !alreadySays(label, color)) label = `${label} ${color}`;
  return label;
}

/**
 * The same name, split for documents that print a spec line under the product
 * (the purchase order does this). Never repeats what the label already said.
 */
export function productSpec(p: ProductLike): string {
  const label = productLabel(p);
  return [p.manufacturer, p.style, p.color]
    .map((x) => (x ?? "").trim())
    .filter((x) => x && !alreadySays(label, x))
    .join(" / ");
}
