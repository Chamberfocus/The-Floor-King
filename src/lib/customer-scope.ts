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

/** A product described for the customer: its full name, never a size. The line's
 *  description holds the product name (e.g. "OVF Del Mar - JETCORE 7.25\""), so
 *  it leads; brand/category are only fallbacks when there's no description. */
function productItem(l: EstimateLineItem): ScopeItem {
  const note = (l.note ?? "").trim();
  return { title: customerLineLabel(l), detail: note || undefined };
}

/**
 * The customer-facing name for a line — the full product/description, with color
 * appended when it isn't already in it. Never a quantity, size, or price. Shared
 * by the scope view and the itemized estimate so a product reads the same way
 * everywhere.
 */
export function customerLineLabel(l: EstimateLineItem): string {
  const desc = (l.description ?? "").trim();
  const brand = [l.manufacturer, l.style].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  const color = (l.color ?? "").trim();
  const catLabel = l.category ? PRODUCT_CATEGORY_LABELS[l.category] : "";
  let label = desc || brand || catLabel || "Item";
  if (color && !label.toLowerCase().includes(color.toLowerCase())) label += ` — ${color}`;
  return label;
}

/** A labor / prep line described as work performed — no hours, no area. */
function workItem(l: EstimateLineItem): ScopeItem {
  const desc = (l.description ?? "").trim();
  const note = (l.note ?? "").trim();
  const catLabel = l.category ? PRODUCT_CATEGORY_LABELS[l.category] : "";
  return { title: desc || catLabel || "Included work", detail: note || undefined };
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

/**
 * Parse the captured questionnaire answers out of an estimate's job description
 * into a clean "Project details" list — the note-worthy answers (subfloor, prep,
 * furniture, tackless…) as plain "Label: value" lines. Internal risk flags are
 * separated out (`flags`) so they can be shown on the staff copy but never the
 * customer's. Presentation only — never emits a quantity or price.
 */
export function parseProjectDetails(
  text: string | null | undefined,
): { details: string[]; flags: string[] } {
  if (!text) return { details: [], flags: [] };
  const details: string[] = [];
  const flags: string[] = [];
  let inFlags = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^flags to confirm/i.test(line)) {
      inFlags = true;
      continue;
    }
    if (/^(job conditions|per-room prep)\s*:?$/i.test(line)) {
      inFlags = false;
      continue;
    }
    if (inFlags || line.startsWith("⚠")) {
      flags.push(line.replace(/^⚠\s*/, ""));
      continue;
    }
    // A captured answer bullet ("• Label: value") or a free line — tidy the
    // leftover "?:" from question labels so it reads as a clean detail.
    details.push(line.replace(/^[•\-]\s*/, "").replace(/\?:/g, ":"));
  }
  return { details, flags };
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
