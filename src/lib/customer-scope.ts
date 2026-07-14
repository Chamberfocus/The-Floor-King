/**
 * Customer-facing scope — the "what we're doing" a customer sees on an estimate
 * or invoice, with every quantity, dimension, and unit price stripped out.
 *
 * It is DERIVED from the same line items the work order and PO are built from
 * (via buildJobScope), so there is one source of truth: the customer copy and
 * the crew copy can never describe different work. The difference is purely what
 * each is allowed to show — the customer sees the scope described in words; the
 * crew keeps the square footage, cartons, and cut sizes.
 *
 * HARD RULE for everything in this module: it may read sqft/quantity/unit/rate
 * to CLASSIFY a line, but it must never put any of those numbers into its output.
 */

import {
  PRODUCT_CATEGORY_LABELS,
  type EstimateLineItem,
  type ProductCategory,
} from "@/lib/types";
import { buildJobScope, type ScopeRoom } from "@/lib/job-scope";

/** The floor itself (what's going down) vs. everything installed alongside it. */
const SURFACE = new Set<ProductCategory>([
  "carpet",
  "lvp",
  "hardwood",
  "laminate",
  "tile",
  "vinyl",
]);

/** One described line: a bold title and an optional plain-language detail. */
export interface ScopeItem {
  title: string;
  detail?: string;
}

export interface CustomerRoom {
  name: string;
  flooring: ScopeItem[]; // the surface going in this room
  included: ScopeItem[]; // pad, trim, prep, demo, labor — described, never measured
}

export interface CustomerScope {
  rooms: CustomerRoom[];
  /** Materials & work not tied to one room (job-wide trim, haul-away, install). */
  whole: { flooring: ScopeItem[]; included: ScopeItem[] };
  /** Site-wide conditions (subfloor, moisture) pulled from the job notes. */
  conditions: string[];
  /** Any remaining free-text notes meant for the customer. */
  notes: string;
}

/** A product described for the customer: brand + style + color, never a size. */
function productItem(l: EstimateLineItem): ScopeItem {
  const brand = [l.manufacturer, l.style]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const color = (l.color ?? "").trim();
  const catLabel = l.category ? PRODUCT_CATEGORY_LABELS[l.category] : "";
  const desc = (l.description ?? "").trim();

  const title = brand
    ? color
      ? `${brand} — ${color}`
      : brand
    : desc || catLabel || "Flooring";

  const detailBits: string[] = [];
  if (brand && catLabel) detailBits.push(catLabel);
  // Add the description only when it says something the title doesn't already.
  if (desc && !title.toLowerCase().includes(desc.toLowerCase())) {
    detailBits.push(desc);
  }
  return { title, detail: detailBits.join(" · ") || undefined };
}

/** A labor / prep line described as work performed — no hours, no area. */
function workItem(l: EstimateLineItem): ScopeItem {
  const desc = (l.description ?? "").trim();
  const catLabel = l.category ? PRODUCT_CATEGORY_LABELS[l.category] : "";
  return { title: desc || catLabel || "Included work" };
}

function splitRoom(room: ScopeRoom): CustomerRoom {
  const flooring: ScopeItem[] = [];
  const included: ScopeItem[] = [];
  for (const p of room.products) {
    if (p.category && SURFACE.has(p.category)) flooring.push(productItem(p));
    else included.push(productItem(p)); // pad / underlayment / trim / transitions
  }
  for (const l of room.labor) included.push(workItem(l));
  for (const prep of room.prep) included.push({ title: prep });
  return { name: room.name, flooring, included };
}

/**
 * Build the customer-facing scope from a set of line items + notes. Pass an
 * estimate option's line_items (with the estimate's notes) or a job's line_items
 * (with the job's notes) — either way the description is identical, because both
 * feed the same buildJobScope.
 */
export function buildCustomerScope(
  lineItems: EstimateLineItem[],
  notes: string | null | undefined,
): CustomerScope {
  const scope = buildJobScope(lineItems, notes);
  const wholeProducts = scope.wholeJob.products;
  return {
    rooms: scope.rooms.map(splitRoom),
    whole: {
      flooring: wholeProducts
        .filter((p) => p.category && SURFACE.has(p.category))
        .map(productItem),
      included: [
        ...wholeProducts
          .filter((p) => !(p.category && SURFACE.has(p.category)))
          .map(productItem),
        ...scope.wholeJob.labor.map(workItem),
      ],
    },
    conditions: scope.conditions,
    notes: scope.freeText,
  };
}

/** True when there is genuinely nothing to describe (guards empty sections). */
export function scopeIsEmpty(s: CustomerScope): boolean {
  return (
    s.rooms.length === 0 &&
    s.whole.flooring.length === 0 &&
    s.whole.included.length === 0 &&
    s.conditions.length === 0 &&
    !s.notes.trim()
  );
}

/** The distinct flooring products across the whole job — for the condensed view. */
export function flooringHighlights(s: CustomerScope): ScopeItem[] {
  const seen = new Set<string>();
  const out: ScopeItem[] = [];
  for (const room of s.rooms) {
    for (const f of room.flooring) {
      const k = f.title.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(f);
    }
  }
  for (const f of s.whole.flooring) {
    const k = f.title.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}
