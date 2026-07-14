/**
 * Accessory programs — the shared, pure logic behind generated trim items.
 *
 * An accessory catalog is a cross-product: TYPE × VARIANT.
 *   - a TYPE  (T-Mold, Quarter Round, Baseboard) carries the price and the unit
 *   - a VARIANT is a color (pulled from the floors we carry) or a size
 *   - a PROGRAM binds priced types to one flooring line, so a color always
 *     coordinates with a real product instead of a free-standing list
 *
 * Every function here is pure so the generator (server), the settings screen
 * (client), and the estimate math all agree on names, keys, and quantities.
 */

import type { ProductCategory } from "@/lib/types";

/** Categories whose colors can drive an accessory program. */
export const FLOORING_CATEGORIES: ProductCategory[] = [
  "carpet",
  "lvp",
  "hardwood",
  "laminate",
  "tile",
  "vinyl",
];

/** Vendors sell trim as pre-cut sticks. 94" is the near-universal length. */
export const DEFAULT_PIECE_LENGTH_IN = 94;

export type AccessoryAxis = "color" | "size" | "none";
export type AccessoryUnit = "each" | "lnft";

// --- Keys & display ---------------------------------------------------------

/**
 * The identity of a variant. Case-, space-, and punctuation-insensitive, so
 * "Gunstock Oak", "GUNSTOCK OAK", and "gunstock-oak" are ONE variant and can
 * never generate two catalog items. This is the key the database's unique index
 * is built on, so it is also what makes regeneration idempotent.
 */
export function variantKey(raw: string | null | undefined): string {
  return (raw ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Display form of a color: "GUNSTOCK OAK" / "gunstock oak" → "Gunstock Oak". */
export function displayVariant(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  // Leave a deliberately-cased name alone (e.g. "McKinley", "VIVID 3D"); only
  // fix the all-caps and all-lower cases the vendor lists arrive in.
  const isAllCaps = s === s.toUpperCase();
  const isAllLower = s === s.toLowerCase();
  if (!isAllCaps && !isAllLower) return s;
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\b(Of|And|The|In|On)\b/g, (w) => w.toLowerCase());
}

/**
 * The catalog name of a generated item. Manufacturer + line + type + variant, so
 * it is unambiguous in search — "Driftwood" alone exists on five manufacturers.
 */
export function accessoryItemName(opts: {
  manufacturer?: string | null;
  style?: string | null;
  typeName: string;
  variant?: string | null;
}): string {
  const line = [opts.manufacturer?.trim(), opts.style?.trim()]
    .filter(Boolean)
    .join(" ");
  const variant = displayVariant(opts.variant);
  return [line, opts.typeName.trim(), variant ? `— ${variant}` : ""]
    .filter(Boolean)
    .join(" ")
    .trim();
}

// --- Quantity math ----------------------------------------------------------

/**
 * How many sticks to buy for a run of linear feet. Trim is sold by the piece, so
 * you always round UP — you cannot buy 2.3 sticks.
 *
 * This is the bridge between how the job is measured (linear feet along a wall
 * or doorway) and how the vendor sells (94" pieces at a per-piece price), and it
 * is why a generated item keeps its vendor unit instead of being flattened to a
 * $/lnft rate that would never tie back to the vendor's invoice.
 */
export function piecesForLinearFeet(
  linearFeet: number,
  pieceLengthIn: number = DEFAULT_PIECE_LENGTH_IN,
): number {
  const lf = Number(linearFeet);
  const len = Number(pieceLengthIn);
  if (!Number.isFinite(lf) || lf <= 0) return 0;
  if (!Number.isFinite(len) || len <= 0) return 0;
  return Math.ceil((lf * 12) / len);
}

/** Linear feet covered by n pieces — the inverse, for showing coverage back. */
export function linearFeetForPieces(
  pieces: number,
  pieceLengthIn: number = DEFAULT_PIECE_LENGTH_IN,
): number {
  const n = Number(pieces);
  const len = Number(pieceLengthIn);
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(len) || len <= 0) return 0;
  return Math.round(((n * len) / 12) * 100) / 100;
}

/**
 * The quantity to put on an estimate/PO line for an accessory, given how much
 * the job needs in linear feet. `each` → whole pieces; `lnft` → the run itself.
 */
export function accessoryQuantity(opts: {
  linearFeet: number;
  unit: AccessoryUnit;
  pieceLengthIn?: number | null;
}): number {
  if (opts.unit === "lnft") {
    const lf = Number(opts.linearFeet);
    return Number.isFinite(lf) && lf > 0 ? Math.round(lf * 100) / 100 : 0;
  }
  return piecesForLinearFeet(
    opts.linearFeet,
    opts.pieceLengthIn ?? DEFAULT_PIECE_LENGTH_IN,
  );
}

// --- Type parsing (used to reverse-engineer programs from imported rows) -----

/**
 * Canonical accessory types, most specific first. Order matters: "Overlap Stair
 * Nose" must be tested before "Stair Nose", or every overlap nose collapses into
 * the plain type and its (different) price averages away.
 */
const BASE_TYPES: [string, RegExp][] = [
  ["Stair Tread", /\btread\b/i],
  ["Stair Riser", /\briser\b/i],
  ["Stair Nose", /stair\s?nos(e|ing)|stairnos(e|ing)|strnos(e|ing)|st\s?nose|step\s?nose|stepnose|\bnosing\b|\bnose\b/i],
  ["Reducer", /reducer/i],
  ["T-Mold", /\bt[\s-]?mold(ing)?\b|\btmold(ing)?\b/i],
  ["End Cap", /end\s?cap|endcap/i],
  ["Threshold", /thresh(old)?/i],
  ["Quarter Round", /quarter[\s-]?round|qtr[\s-]?round|\bqtr\b/i],
  ["Shoe Molding", /base\s?shoe|shoe\s?mold|\bshoe\b/i],
  ["Cove Base", /cove\s?base|wall\s?base/i],
  ["Baseboard", /base\s?board|baseboard|\bbase\b/i],
  ["Multi-Purpose", /\b\d\s?[\s-]?in[\s-]?\d\b|multi[\s-]?purpose|multipurpose/i],
  ["J-Channel", /j[\s-]?channel/i],
  ["Transition", /transition/i],
  ["Track", /\btrack\b/i],
  ["Shim", /\bshim\b/i],
  ["Edge Strip", /edge\s?(strip|guard)|seam\s?bind/i],
];

/** Profile modifiers. Only meaningful on the types that actually come in them. */
const MODIFIERS: [string, RegExp][] = [
  ["Overlap", /\boverlap\b|\bo\s+(stairnose|strnose|reducer)\b/i],
  ["Flush", /\bflush\b/i],
  ["Round", /\bround\b/i],
  ["Flat", /\bflat\b/i],
  ["Square", /\bsquare\b/i],
  ["Baby", /\bbaby\b/i],
];
const TAKES_MODIFIER = new Set([
  "Stair Nose",
  "Reducer",
  "Stair Tread",
  "Threshold",
]);

/**
 * Read an accessory type out of a vendor product name.
 * Returns null when nothing recognisable is there — the caller must flag those
 * for a human rather than force them into a program. Guessing here would mean
 * mis-pricing a real item.
 */
export function parseAccessoryType(name: string): string | null {
  const n = name ?? "";
  let base: string | null = null;
  for (const [type, re] of BASE_TYPES) {
    if (re.test(n)) {
      base = type;
      break;
    }
  }
  if (!base) return null;
  if (!TAKES_MODIFIER.has(base)) return base;
  // "Quarter Round" contains the word "round" — never let that become a modifier.
  const mod = MODIFIERS.find(
    ([label, re]) =>
      re.test(n) && !(label === "Round" && /quarter[\s-]?round|qtr/i.test(n)),
  );
  return mod ? `${mod[0]} ${base}` : base;
}

/** The default unit/axis for a type created by hand in Settings. */
export function defaultsForType(typeName: string): {
  unit: AccessoryUnit;
  axis: AccessoryAxis;
} {
  // Millwork is primed and sold by the foot — it does NOT come in floor colors.
  // Generating "Baseboard — Gunstock Oak" would be nonsense, so these vary by size.
  if (/baseboard|shoe molding|cove base/i.test(typeName)) {
    return { unit: "lnft", axis: "size" };
  }
  return { unit: "each", axis: "color" };
}

/**
 * Does this type run along a wall or doorway, so that a length of it is what you
 * measure? True for transitions and moldings; FALSE for stair treads and risers,
 * which you buy one of per stair.
 *
 * Only run goods get a stick length, because only they need the linear-feet →
 * whole-pieces conversion. Offering "enter linear feet" for a stair tread would
 * invite a quantity that means nothing.
 */
export function variesByRun(typeName: string): boolean {
  return !/stair tread|stair riser|\briser\b|\btread\b/i.test(typeName);
}

/** Suggested sizes for the size-axis millwork types. */
export const DEFAULT_SIZES: Record<string, string[]> = {
  Baseboard: ['3¼"', '4¼"', '5¼"'],
  "Shoe Molding": ['¾"'],
  "Cove Base": ['4"', '6"'],
};

/**
 * The reason a vendor row could not be attached to a program. Surfaced in
 * Settings so nothing is silently dropped.
 */
export type UnprogrammedReason =
  | "no_type"
  | "no_line"
  | "color_polluted"
  | "no_color";

export const UNPROGRAMMED_LABELS: Record<UnprogrammedReason, string> = {
  no_type: "No recognisable accessory type in the name",
  no_line: "No manufacturer / product line to hang colors on",
  color_polluted: "The color field contains the item type (bad import)",
  no_color: "No color — needs a size or a one-off item",
};

/** True when the color column has had the item type dumped into it on import. */
export function isColorPolluted(color: string | null | undefined): boolean {
  const c = (color ?? "").trim();
  if (!c) return false;
  return /quarter\s?round|reducer|t-?mold|stair\s?nose|stairnose|thresh|end\s?cap|riser|tread|molding|moulding/i.test(
    c,
  );
}

/**
 * Does the `style` column hold a real product line, or just a repeat of the item
 * type? Vendor sheets often shove "OVERLAP REDUCER" into style, which is not a
 * line and cannot source colors.
 */
export function styleIsNotALine(style: string | null | undefined): boolean {
  const s = variantKey(style);
  if (!s) return true;
  if (!parseAccessoryType(s)) return false;
  // Every word is trim vocabulary → it's a type, not a line.
  return s
    .split(" ")
    .every((w) =>
      /^(overlap|flush|round|flat|square|baby|stair|nose|stairnose|stairnosing|strnose|nosing|reducer|t|mold|molding|tmold|end|cap|endcap|threshold|thresh|quarter|qtr|shoe|base|cove|wall|board|riser|tread|track|shim|transition|j|channel|multi|purpose|kit|with|w|profile|vinyl|wood|the)$/.test(
        w,
      ),
    );
}
