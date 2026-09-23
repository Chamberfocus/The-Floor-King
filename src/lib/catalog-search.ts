/**
 * Catalog picker scope and ranking.
 *
 * Scope uses category (and, for adhesives, words that already appear on the
 * product). It does not invent compatibility between a carpet and a pad.
 * Ranking runs on the rows already fetched — not a fuzzy scan of the catalog.
 */

export const HARD_SURFACE_CATEGORIES = ["lvp", "hardwood", "laminate", "tile", "vinyl"] as const;

export interface PickerCatalogScope {
  /** Null means the whole catalog (Search all products). */
  categories: string[] | null;
  /**
   * Empty-box text filter on real columns (name / sku / search_text).
   * OR'd, not a compatibility rule. Cleared when the salesperson types.
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
      browseTokens: ["transition", "reducer", "threshold", "t-mold", "end cap"],
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
  const joined = tokens.join(" ");
  const skuNorm = squash(sku);
  const queryNorm = squash(query);
  let s = 0;

  if (sku && (sku === joined || (queryNorm.length > 0 && skuNorm === queryNorm))) s += 10000;
  else if (sku && (sku.startsWith(joined) || (queryNorm.length > 0 && skuNorm.startsWith(queryNorm)))) s += 2500;
  else if (sku && tokens.every((t) => tokenIn(t, sku))) s += 1800;

  if (name && name === joined) s += 8000;
  else if (name && name.startsWith(joined)) s += 5000;

  const inName = (t: string) => tokenIn(t, name);
  const inMfr = (t: string) => tokenIn(t, mfr);
  if (tokens.some(inMfr) && tokens.some(inName) && tokens.every((t) => inName(t) || inMfr(t))) {
    s += 3500;
  }
  if (name.startsWith(tokens[0]) || words(name)[0]?.startsWith(tokens[0])) s += 800;

  const other = [p.style, p.color, p.supplier, p.fiber, p.species, p.notes, p.category, p.search_text]
    .filter(Boolean)
    .join(" ");

  let all = true;
  for (const t of tokens) {
    if (inName(t)) s += 200;
    else if (inMfr(t)) s += 120;
    else if (tokenIn(t, sku)) s += 160;
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
