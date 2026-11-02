/**
 * Catalog picker scope and ranking.
 *
 * Scope uses category (and, for adhesives, words that already appear on the
 * product). It does not invent compatibility between a carpet and a pad.
 * Ranking runs on the rows already fetched — not a fuzzy scan of the catalog.
 */
import { colorNumberFromText } from "@/lib/catalog-identity";

export const HARD_SURFACE_CATEGORIES = ["lvp", "hardwood", "laminate", "tile", "vinyl"] as const;

export interface PickerCatalogScope {
  /** Null means the whole catalog (Search all products). */
  categories: string[] | null;
  /**
   * Empty-box text filter on real columns (name / sku / style / color /
   * notes / search_text). OR'd, not a compatibility rule. Cleared when the
   * salesperson types.
   */
  browseTokens: string[] | null;
  label: string | null;
}

const HARD = new Set<string>(HARD_SURFACE_CATEGORIES);

/**
 * What the open question is asking for. Search all stays available in the picker.
 */
export function pickerCatalogScope(input: {
  category?: string | null;
  key?: string | null;
}): PickerCatalogScope {
  const key = (input.key ?? "").trim();
  const category = (input.category ?? "").trim();

  if (key === "adhesive") {
    return { categories: null, browseTokens: ["adhesive", "glue"], label: "Adhesives" };
  }
  if (key === "carpet_pad" || key === "attached_pad" || key === "pad" || key === "padding") {
    return { categories: ["underlayment"], browseTokens: null, label: "Padding" };
  }
  if (key === "hs_underlayment") {
    return { categories: ["underlayment"], browseTokens: null, label: "Underlayment" };
  }
  if (key === "hs_transitions" || key === "metal_type" || key === "metals_needed") {
    return {
      categories: ["trim"],
      browseTokens: ["transition", "reducer", "threshold", "t-mold", "end cap", "j-channel"],
      label: "Transitions",
    };
  }
  if (key === "hs_base_trim") {
    return { categories: ["trim"], browseTokens: null, label: "Trim" };
  }
  if (key === "carpet_cuts" || key === "carpet" || category === "carpet") {
    return { categories: ["carpet"], browseTokens: null, label: "Carpet" };
  }
  if (category === "underlayment") {
    return { categories: ["underlayment"], browseTokens: null, label: "Underlayment" };
  }
  if (category === "vinyl") {
    return { categories: ["vinyl"], browseTokens: null, label: "Sheet vinyl" };
  }
  if (HARD.has(category)) {
    return { categories: [category], browseTokens: null, label: categoryLabel(category) };
  }
  if (category === "trim") {
    return { categories: ["trim"], browseTokens: null, label: "Trim" };
  }
  if (key === "hard_surface" || key === "surface_type") {
    return {
      categories: [...HARD_SURFACE_CATEGORIES],
      browseTokens: null,
      label: "Hard surface",
    };
  }
  return { categories: null, browseTokens: null, label: null };
}

function categoryLabel(category: string): string {
  if (category === "lvp") return "LVP";
  if (category === "hardwood") return "Hardwood";
  if (category === "laminate") return "Laminate";
  if (category === "tile") return "Tile";
  return category;
}

export function productInPickerScope(
  category: string | null | undefined,
  scope: { categories: string[] | null },
): boolean {
  if (!scope.categories || !scope.categories.length) return true;
  return scope.categories.includes(category ?? "");
}

/**
 * Nothing here is added to the estimate. The salesperson picks.
 * "Commonly used" is the scoped catalog list, not a compatibility claim.
 */
export function catalogSuggestionPlan(): { autoAdd: false; compatibleClaim: false } {
  return { autoAdd: false, compatibleClaim: false };
}

export interface RankableProduct {
  id?: string;
  name?: string | null;
  sku?: string | null;
  manufacturer?: string | null;
  style?: string | null;
  color?: string | null;
  supplier?: string | null;
  category?: string | null;
  notes?: string | null;
  fiber?: string | null;
  species?: string | null;
  search_text?: string | null;
  active?: boolean | null;
}

function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9./]+/g, "");
}

function words(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9./]+/).filter(Boolean);
}

function tokenIn(token: string, text: string): boolean {
  if (!token || !text) return false;
  const low = text.toLowerCase();
  if (low.includes(token)) return true;
  if (token.length >= 2 && words(low).some((w) => w.startsWith(token))) return true;
  if (token.length >= 2 && squash(low).includes(squash(token))) return true;
  return false;
}

/**
 * Higher is better. Exact SKU, then exact name, then a name prefix,
 * then manufacturer + product, then a partial hit. No edit-distance scan.
 */
export function scoreCatalogProduct(p: RankableProduct, query: string): number {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return p.active === false ? 0 : 1;
  const name = (p.name ?? "").toLowerCase();
  const sku = (p.sku ?? "").toLowerCase();
  const mfr = (p.manufacturer ?? "").toLowerCase();
  const style = (p.style ?? "").toLowerCase();
  const color = (p.color ?? "").toLowerCase();
  const notes = (p.notes ?? "").toLowerCase();
  const colorNum = (
    colorNumberFromText(p.notes) ?? colorNumberFromText(p.color) ?? ""
  ).toLowerCase();
  const joined = tokens.join(" ");
  const skuNorm = squash(sku);
  const queryNorm = squash(query);
  let s = 0;

  if (sku && (sku === joined || (queryNorm.length > 0 && skuNorm === queryNorm))) s += 10000;
  else if (sku && (sku.startsWith(joined) || (queryNorm.length > 0 && skuNorm.startsWith(queryNorm)))) s += 2500;
  else if (sku && tokens.every((t) => tokenIn(t, sku))) s += 1800;

  // A color number is how the mill identifies the colorway. An exact fragment
  // of it outranks a product that merely contains those digits in another field.
  if (colorNum && tokens.every((t) => t.length >= 2) && (colorNum === joined || squash(colorNum) === queryNorm)) {
    s += 9000;
  } else if (colorNum && tokens.every((t) => t.length >= 2 && tokenIn(t, colorNum))) {
    s += 2600;
  }

  if (name && name === joined) s += 8000;
  else if (name && name.startsWith(joined)) s += 5000;

  const inName = (t: string) => tokenIn(t, name);
  const inMfr = (t: string) => tokenIn(t, mfr);
  if (tokens.some(inMfr) && tokens.some(inName) && tokens.every((t) => inName(t) || inMfr(t))) {
    s += 3500;
  }
  if (name.startsWith(tokens[0]) || words(name)[0]?.startsWith(tokens[0])) s += 800;

  if (style && tokens.every((t) => t.length >= 2 && tokenIn(t, style))) s += 2000;
  if (color && tokens.every((t) => t.length >= 2 && tokenIn(t, color))) s += 2200;

  const other = [p.supplier, p.fiber, p.species, p.category, p.search_text]
    .filter(Boolean)
    .join(" ");

  let all = true;
  for (const t of tokens) {
    if (inName(t)) s += 200;
    else if (inMfr(t)) s += 120;
    else if (tokenIn(t, sku)) s += 160;
    else if (t.length >= 2 && tokenIn(t, color)) s += 280;
    else if (t.length >= 2 && tokenIn(t, style)) s += 240;
    else if (t.length >= 2 && tokenIn(t, notes)) s += 200;
    else if (tokenIn(t, other)) s += 40;
    else all = false;
  }
  if (all && tokens.length) s += 500;
  if (p.active !== false) s += 3;
  return s;
}

export function rankCatalogProducts<T extends RankableProduct>(rows: T[], query: string): T[] {
  const q = query.trim();
  if (!q) return rows;
  return rows
    .map((p) => ({ p, s: scoreCatalogProduct(p, q) }))
    .filter((x) => x.s > 3)
    .sort((a, b) => b.s - a.s || (a.p.name ?? "").localeCompare(b.p.name ?? ""))
    .map((x) => x.p);
}

const PAD_WORDS = new Set([
  "pad",
  "pads",
  "padding",
  "cushion",
  "cushions",
  "rebond",
  "underlayment",
  "underlay",
]);

function padQueryTokens(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .replace(/(\d+)\s*\/\s*(\d+)/g, "$1/$2")
    .split(/[^a-z0-9/]+/)
    .filter(Boolean);
}

/** 7/16, 1/2, 8lb — how padding is asked for. A bare number is not enough. */
export function isPadSearchQuery(query: string): boolean {
  const tokens = padQueryTokens(query);
  if (!tokens.length) return false;
  let fractions = 0;
  let words = 0;
  let weights = 0;
  for (const t of tokens) {
    if (/^\d+\/\d+$/.test(t)) fractions += 1;
    else if (PAD_WORDS.has(t)) words += 1;
    else if (/^\d+(?:\.\d+)?(?:lb|lbs|#)$/.test(t)) weights += 1;
    else return false;
  }
  return fractions > 0 || words > 0 || weights > 0;
}

/** Spellings of a pad thickness that show up in names and notes. */
export function padFractionSpellings(token: string): string[] {
  const t = token.trim().toLowerCase();
  const out = new Set<string>([t]);
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (!frac) return [...out];
  const v = Number(frac[1]) / Number(frac[2]);
  if (Number.isFinite(v) && v > 0) {
    const dec = String(Math.round(v * 10000) / 10000);
    out.add(dec);
    out.add(dec.replace(/^0/, ""));
    out.add(`${frac[1]}/${frac[2]}in`);
    out.add(`${frac[1]}/${frac[2]} in`);
  }
  return [...out];
}

function padHaystack(p: RankableProduct): string {
  return [p.name, p.sku, p.manufacturer, p.style, p.color, p.notes, p.search_text, p.fiber]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** True when the row actually carries this thickness, weight, or pad word. */
export function productMatchesPadQuery(p: RankableProduct, query: string): boolean {
  const hay = padHaystack(p);
  const squashed = hay.replace(/[^a-z0-9./]+/g, "");
  const tokens = padQueryTokens(query);
  return tokens.some((token) => {
    if (PAD_WORDS.has(token)) return hay.includes(token);
    return padFractionSpellings(token).some((spelling) => {
      const compact = spelling.replace(/[^a-z0-9./]+/g, "");
      return hay.includes(spelling) || (compact.length > 0 && squashed.includes(compact));
    });
  });
}

/**
 * Thickness matches first, then the rest of the padding. A 7/16 search must
 * not come back empty just because one row spells the thickness differently.
 */
export function rankPadCatalog<T extends RankableProduct>(rows: T[], query: string): T[] {
  const q = query.trim();
  if (!q) return rows;
  const hits: T[] = [];
  const rest: T[] = [];
  for (const p of rows) {
    if (productMatchesPadQuery(p, q)) hits.push(p);
    else rest.push(p);
  }
  const byScore = (a: T, b: T) =>
    scoreCatalogProduct(b, q) - scoreCatalogProduct(a, q) ||
    (a.name ?? "").localeCompare(b.name ?? "");
  hits.sort(byScore);
  rest.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  return [...hits, ...rest];
}
