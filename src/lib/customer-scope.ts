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
  const note = customerFacingLineNote(l.note);
  return { title: customerLineLabel(l), detail: note || undefined };
}

/**
 * Crew How many identity (wrap qty TBD, carton coverage TBD, not taped sq ft,
 * order TBD / measured sq ft) stays on stored estimate lines so Builder / PO /
 * WO / hydrate skip leftover taped sq ft. Customer copy is the product name.
 *
 * Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft.
 * Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft.
 * Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order.
 * Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft.
 * Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts.
 * Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts.
 * Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts.
 * Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step.
 * Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts.
 * Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts.
 * Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay.
 * Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay.
 * Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays.
 * Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays.
 * Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay.
 */
const CREW_IDENTITY_TAIL =
  /\s*[—–-]\s*(?:wrap qty TBD\b|qty TBD\b|carton coverage TBD\b|order TBD\b|not taped square feet\b|not an automatic sq ft\/step order\b|\d+(?:\.\d+)?\s+\S+\s+\((?:[^)]*not taped sq ft[^)]*|[^)]*not an automatic sq ft\/step order[^)]*)\)|\d+\s+steps?\b(?:\s+\([^)]*\))?)/i;

const GUIDED_TAKEOFF_MATH_LABEL =
  /^(?:measured area|waste|order quantity|billing quantity|unit of measure|carton coverage|required cartons)\s*:/i;

const GUIDED_TAKEOFF_MATH_NOTE =
  /not a 30-yard roll|carton coverage|carton count is not invented|sq ft\s*[÷\/]\s*9|not a cut plan|from taped area|taped sq ft is measured area|this number is (?:yards|square feet)|layout waste|bills in square feet, not yards|billed by the yard|not pad yards/i;

/** Crew Review takeoff concept rows. Stored job_description keeps them. */
export function isGuidedTakeoffMathLine(raw: string): boolean {
  const stripped = stripCrewIdentityFromCustomerLabel(
    (raw ?? "").replace(/^[•\-]\s*/, "").trim(),
  );
  if (!stripped) return false;
  if (/^guided takeoff\s*:?\s*$/i.test(stripped)) return false;
  if (/^rooms\s*:?\s*$/i.test(stripped)) return true;
  if (/\btakeoff\s*:?\s*$/i.test(stripped)) return true;
  if (GUIDED_TAKEOFF_MATH_LABEL.test(stripped)) return true;
  if (/^note:\s*/i.test(stripped) && GUIDED_TAKEOFF_MATH_NOTE.test(stripped)) return true;
  if (/^measured .+\s+·\s+waste\s+/i.test(stripped)) return true;
  if (/\d(?:[\d.,]*)\s+sq\s*(?:ft|yd)\b/i.test(stripped)) return true;
  return false;
}

function stripPrepConfidenceSuffix(raw: string): string {
  const next = raw
    .replace(/\s*\((?:estimated|allowance|field verify(?:\s*\/\s*TBD)?)\)$/i, "")
    .trim();
  return next || raw;
}

export function stripCrewIdentityFromCustomerLabel(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return s;
  if (
    !/wrap qty TBD|carton coverage TBD|not taped sq ft|not taped square feet|not an automatic sq ft\/step order|order TBD|\d+\s+steps?\b/i.test(
      s,
    )
  ) {
    return stripPrepConfidenceSuffix(s);
  }
  const cut = s.search(CREW_IDENTITY_TAIL);
  if (cut > 0) return stripPrepConfidenceSuffix(s.slice(0, cut).trim());
  const fallback = s
    .replace(
      /\s*\([^)]*(?:not taped sq ft|not an automatic sq ft\/step order|enter cuts)[^)]*\)\s*$/i,
      "",
    )
    .replace(/\s*(?:wrap qty TBD|qty TBD|carton coverage TBD|order TBD)\b.*$/i, "")
    .replace(/\s*[—–-]\s*\d+\s+steps?\b.*$/i, "")
    .trim();
  return stripPrepConfidenceSuffix(fallback || s);
}

function isCrewFlagsHeader(s: string): boolean {
  return /^(warnings|flags to confirm|uncertainty)\s*:?\s*$/i.test(s.trim());
}

function isNonFlagSectionHeader(s: string): boolean {
  return (
    /^guided takeoff\s*:?\s*$/i.test(s.trim()) || isCrewReviewSectionHeader(s)
  );
}

/** Crew Review grouping chrome. Stored job_description keeps Removal / Prep / Accessories. */
export function isCrewReviewSectionHeader(raw: string): boolean {
  return /^(removal|installation|prep|accessories|special conditions|products|conditions|job conditions|per-room prep)\s*:?\s*$/i.test(
    (raw ?? "").trim(),
  );
}

const CREW_REVIEW_BUCKET_PREFIX =
  /^(?:removal|installation|prep|accessorie|accessories|special conditions?|products?)\s*:\s*/i;

/** Crew Review row label. Stored job_description keeps “Prep: …” / “Accessorie: …”. */
export function stripCrewReviewBucketPrefix(raw: string): string {
  const s = (raw ?? "").replace(/^[•\-]\s*/, "").trim();
  if (!s) return (raw ?? "").trim();
  const next = s.replace(CREW_REVIEW_BUCKET_PREFIX, "").trim();
  return next || s;
}

/** Crew prep-confidence stamp. Stored job_description keeps Field verify / TBD. */
export function isCrewPrepConfidenceLine(raw: string): boolean {
  const stripped = stripCrewIdentityFromCustomerLabel(
    (raw ?? "").replace(/^[•\-]\s*/, "").replace(/\?:/g, ":").trim(),
  );
  if (!stripped) return false;
  if (/how sure are we about the prep/i.test(stripped)) return true;
  if (/^prep confidence\s*:/i.test(stripped)) return true;
  if (/^prep:\s*(known|estimated|allowance|field verify)\b/i.test(stripped)) return true;
  return false;
}

/** Crew stair-step How many leftover. Stored job_description / line notes keep the count. Wrap “8 box” is accessory How many and stays. */
export function isCrewStairStepHowManyLine(raw: string): boolean {
  const stripped = stripCrewIdentityFromCustomerLabel(
    (raw ?? "").replace(/^[•\-]\s*/, "").trim(),
  );
  if (!stripped) return false;
  const shown = stripCrewReviewBucketPrefix(stripped);
  const text = shown || stripped;
  return /(?:^|:)\s*\d+\s+(?:steps?|waterfall|upholstered)\b/i.test(text);
}

const CREW_LABELED_COUNT_HOW_MANY =
  /:\s*\d+(?:\.\d+)?(?:\s+[A-Za-z][A-Za-z./-]*)?(?:\s*;|\s*$)/;

/** Crew labeled count How many (toilets / trim / metals / gal). Wrap box and Self-leveler bag stay. */
export function isCrewLabeledCountHowManyLine(raw: string): boolean {
  const stripped = stripCrewIdentityFromCustomerLabel(
    (raw ?? "").replace(/^[•\-]\s*/, "").trim(),
  );
  if (!stripped) return false;
  const shown = stripCrewReviewBucketPrefix(stripped);
  const text = shown || stripped;
  if (!text) return false;
  if (isCrewStairStepHowManyLine(raw)) return false;
  if (/:\s*\d+(?:\.\d+)?\s+(?:box|bag)\b/i.test(text)) return false;
  return CREW_LABELED_COUNT_HOW_MANY.test(text);
}

function isCrewOnlyCustomerText(raw: string): boolean {
  return (
    isGuidedTakeoffMathLine(raw) ||
    isCrewPrepConfidenceLine(raw) ||
    isCrewStairStepHowManyLine(raw) ||
    isCrewLabeledCountHowManyLine(raw)
  );
}

/** Customer print / portal narrative. Stored job_description keeps crew stamps. */
export function customerFacingJobNotes(text: string | null | undefined): string {
  if (!text) return "";
  let inFlags = false;
  return text
    .split("\n")
    .map((line) => {
      const indent = line.match(/^\s*/)?.[0] ?? "";
      const raw = line.trimStart();
      const trimmed = raw.trim();
      if (isCrewFlagsHeader(trimmed)) {
        inFlags = true;
        return "";
      }
      if (isNonFlagSectionHeader(trimmed)) inFlags = false;
      if (inFlags) return "";
      if (isCrewReviewSectionHeader(trimmed)) return "";
      const body = stripCrewIdentityFromCustomerLabel(raw);
      if (!body || isCrewOnlyCustomerText(body)) return "";
      const shown = stripCrewReviewBucketPrefix(body);
      if (!shown || isCrewReviewSectionHeader(shown) || isCrewOnlyCustomerText(shown))
        return "";
      return `${indent}${shown}`;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Customer line note. Stored estimate notes keep crew How many / taped sq ft. */
export function customerFacingLineNote(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const stripped = stripCrewIdentityFromCustomerLabel(s);
  if (!stripped || isCrewOnlyCustomerText(stripped)) return "";
  if (
    /wrap qty TBD|carton coverage TBD|not taped sq ft|not taped square feet|not an automatic sq ft\/step order|order TBD/i.test(
      stripped,
    )
  ) {
    return "";
  }
  const shown = stripCrewReviewBucketPrefix(stripped);
  if (!shown || isCrewOnlyCustomerText(shown)) return "";
  return shown;
}

/**
 * The customer-facing name for a line — the full product/description, with color
 * appended when it isn't already in it. Never a quantity, size, or price. Shared
 * by the scope view and the itemized estimate so a product reads the same way
 * everywhere.
 */
export function customerLineLabel(l: EstimateLineItem): string {
  let desc = stripCrewIdentityFromCustomerLabel((l.description ?? "").trim());
  if (desc && isCrewOnlyCustomerText(desc)) desc = "";
  const brand = [l.manufacturer, l.style].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  const color = (l.color ?? "").trim();
  const catLabel = l.category ? PRODUCT_CATEGORY_LABELS[l.category] : "";
  let label = desc || brand || catLabel || "Item";
  if (color && !label.toLowerCase().includes(color.toLowerCase())) label += ` — ${color}`;
  return label;
}

/** A labor / prep line described as work performed — no hours, no area. */
function workItem(l: EstimateLineItem): ScopeItem {
  let desc = stripCrewIdentityFromCustomerLabel((l.description ?? "").trim());
  if (desc && isCrewOnlyCustomerText(desc)) desc = "";
  const note = customerFacingLineNote(l.note);
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
  for (const prep of room.prep) {
    const title = stripCrewIdentityFromCustomerLabel(prep);
    if (!title || isCrewOnlyCustomerText(title))
      continue;
    included.push({ title });
  }
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
    conditions: scope.conditions
      .map((c) =>
        stripCrewReviewBucketPrefix(stripCrewIdentityFromCustomerLabel(c)),
      )
      .filter(
        (c) =>
          c &&
          !isCrewOnlyCustomerText(c) &&
          !isCrewReviewSectionHeader(c),
      ),
    notes: customerFacingJobNotes(scope.freeText),
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
    if (isCrewFlagsHeader(line)) {
      inFlags = true;
      continue;
    }
    if (isNonFlagSectionHeader(line)) {
      inFlags = false;
      continue;
    }
    if (inFlags || line.startsWith("⚠")) {
      flags.push(line.replace(/^⚠\s*/, ""));
      continue;
    }
    // A captured answer bullet ("• Label: value") or a free line — tidy the
    // leftover "?:" from question labels so it reads as a clean detail.
    const cleaned = stripCrewIdentityFromCustomerLabel(
      line.replace(/^[•\-]\s*/, "").replace(/\?:/g, ":"),
    );
    if (cleaned && (isCrewPrepConfidenceLine(cleaned) || isCrewStairStepHowManyLine(cleaned) || isCrewLabeledCountHowManyLine(cleaned))) {
      flags.push(cleaned);
      continue;
    }
    if (!cleaned || isGuidedTakeoffMathLine(cleaned)) continue;
    const shown = stripCrewReviewBucketPrefix(cleaned);
    if (shown && (isCrewPrepConfidenceLine(shown) || isCrewStairStepHowManyLine(shown) || isCrewLabeledCountHowManyLine(shown))) {
      flags.push(shown);
      continue;
    }
    if (
      shown &&
      !isCrewReviewSectionHeader(shown) &&
      !isGuidedTakeoffMathLine(shown) &&
      !isCrewPrepConfidenceLine(shown) &&
      !isCrewStairStepHowManyLine(shown) &&
      !isCrewLabeledCountHowManyLine(shown)
    ) {
      details.push(shown);
    }
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
