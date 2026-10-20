/**
 * Catalog picker scope.
 *
 * Scope uses category (and, for adhesives, words that already appear on the
 * product). It does not invent compatibility between a carpet and a pad.
 * Ranking lives in catalog-query.ts and runs on the rows already fetched.
 */

export { scoreCatalogProduct, rankCatalogProducts } from "@/lib/catalog-query";
export type { RankableProduct } from "@/lib/catalog-query";

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

