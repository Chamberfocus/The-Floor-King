/**
 * Canonical flooring families and installation systems.
 *
 * Catalog categories stay the source of truth (`ProductCategory`). This module
 * maps those categories — and the questionnaire's surface-type labels — onto
 * families and install systems so the guided estimate can ask the right
 * questions without hardcoding a JSX maze per product name.
 *
 * Adding a family later is a map + permitted-systems entry, not a rewrite of
 * the questionnaire.
 */

import type { ProductCategory } from "@/lib/types";
import { profileFor, type FlooringProfile } from "@/lib/flooring-profiles";

/** Flooring sold as a finished floor — not pad, trim, labor, or other. */
export type FlooringFamily =
  | "carpet"
  | "lvp"
  | "hardwood"
  | "laminate"
  | "tile"
  | "vinyl"
  | "other";

export type HardwoodConstruction = "solid" | "engineered" | "unknown";

/**
 * How the product is installed — questionnaire + product-capability concern,
 * not a catalog column. Manufacturer/product metadata overrides these defaults
 * when it exists; today the catalog has no `install_method` column.
 */
export type InstallSystem =
  | "stretch_in"
  | "glue"
  | "carpet_tile"
  | "nail"
  | "staple"
  | "floating"
  | "loose_lay"
  | "thinset"
  | "unknown";

/** How sure we are about a site condition. Never coerce TBD into a fake number. */
export type ConditionConfidence = "known" | "estimated" | "allowance" | "field_verify";

export const CONDITION_CONFIDENCE_LABELS: Record<ConditionConfidence, string> = {
  known: "Known",
  estimated: "Estimated",
  allowance: "Allowance",
  field_verify: "Field verify / TBD",
};

/** Questionnaire surface-type labels we recognize (plus legacy aliases). */
export const SURFACE_TYPE_LABELS = {
  laminate: "Laminate",
  lvp: "LVP / LVT",
  hardwood: "Hardwood",
  engineered: "Engineered hardwood",
  tile: "Tile",
  vinyl: "Sheet vinyl",
} as const;

/** Legacy label that conflated LVP and sheet vinyl — still mapped, with a warning. */
export const LEGACY_LVP_VINYL_LABEL = "LVP / Vinyl";

const SURFACE_TO_FAMILY: Record<string, FlooringFamily> = {
  Laminate: "laminate",
  "LVP / LVT": "lvp",
  [LEGACY_LVP_VINYL_LABEL]: "lvp",
  Hardwood: "hardwood",
  Engineered: "hardwood",
  "Engineered hardwood": "hardwood",
  Tile: "tile",
  "Sheet vinyl": "vinyl",
  Vinyl: "vinyl",
  Carpet: "carpet",
};

const CATALOG_TO_FAMILY: Record<string, FlooringFamily> = {
  carpet: "carpet",
  lvp: "lvp",
  hardwood: "hardwood",
  laminate: "laminate",
  tile: "tile",
  vinyl: "vinyl",
};

/** Display labels the install-method question uses (stable strings for show_if). */
export const INSTALL_METHOD_LABELS: Record<Exclude<InstallSystem, "unknown">, string> = {
  stretch_in: "Stretch-in",
  glue: "Glue-down",
  carpet_tile: "Carpet tile",
  nail: "Nail-down",
  staple: "Staple-down",
  floating: "Floating / click",
  loose_lay: "Loose-lay",
  thinset: "Thinset / mortar",
};

const LABEL_TO_SYSTEM: Record<string, InstallSystem> = {
  "Stretch-in": "stretch_in",
  "Glue-down": "glue",
  "Carpet tile": "carpet_tile",
  "Nail-down": "nail",
  "Staple-down": "staple",
  "Floating / click": "floating",
  "Loose-lay": "loose_lay",
  "Thinset / mortar": "thinset",
};

export function familyFromCatalogCategory(
  category: string | null | undefined,
): FlooringFamily {
  return CATALOG_TO_FAMILY[category ?? ""] ?? "other";
}

export function familyFromSurfaceLabel(label: string | null | undefined): FlooringFamily | null {
  const t = (label ?? "").trim();
  if (!t) return null;
  if (SURFACE_TO_FAMILY[t]) return SURFACE_TO_FAMILY[t];
  const lower = t.toLowerCase();
  if (lower.includes("carpet")) return "carpet";
  if (lower.includes("laminate")) return "laminate";
  if (lower.includes("sheet") && lower.includes("vinyl")) return "vinyl";
  if (lower === "vinyl") return "vinyl";
  if (lower.includes("lvp") || lower.includes("lvt")) return "lvp";
  if (lower.includes("engineered")) return "hardwood";
  if (lower.includes("hardwood") || lower.includes("wood")) return "hardwood";
  if (lower.includes("tile") || lower.includes("porcelain") || lower.includes("ceramic") || lower.includes("stone"))
    return "tile";
  return null;
}

export function hardwoodConstructionFromLabel(
  label: string | null | undefined,
): HardwoodConstruction {
  const t = (label ?? "").toLowerCase();
  if (t.includes("engineered")) return "engineered";
  if (t.includes("solid") || t === "hardwood") return "solid";
  return "unknown";
}

/**
 * Product `species` text (e.g. "White oak, engineered") overrides the
 * questionnaire surface-type construction when it actually says.
 */
export function hardwoodConstructionFromSpecies(
  species: string | null | undefined,
): HardwoodConstruction {
  return hardwoodConstructionFromLabel(species);
}

export function catalogCategoryForFamily(family: FlooringFamily): ProductCategory {
  if (family === "other") return "other";
  return family;
}

export function installSystemFromLabel(label: string | null | undefined): InstallSystem {
  const t = (label ?? "").trim();
  if (!t) return "unknown";
  if (LABEL_TO_SYSTEM[t]) return LABEL_TO_SYSTEM[t];
  const lower = t.toLowerCase();
  if (lower.includes("stretch")) return "stretch_in";
  if (lower.includes("tile") && lower.includes("carpet")) return "carpet_tile";
  if (lower.includes("loose")) return "loose_lay";
  if (lower.includes("float") || lower.includes("click")) return "floating";
  if (lower.includes("staple")) return "staple";
  if (lower.includes("nail")) return "nail";
  if (lower.includes("thinset") || lower.includes("mortar") || lower.includes("mud")) return "thinset";
  if (lower.includes("glue")) return "glue";
  return "unknown";
}

/**
 * Permitted install systems for a family. Engineered hardwood is wider than
 * solid. Product/manufacturer data should narrow this further when present;
 * the catalog currently has no install-method column, so this is the default.
 */
export function permittedInstallSystems(
  family: FlooringFamily,
  construction: HardwoodConstruction = "unknown",
): InstallSystem[] {
  switch (family) {
    case "carpet":
      return ["stretch_in", "glue", "carpet_tile"];
    case "lvp":
      return ["floating", "glue", "loose_lay"];
    case "laminate":
      return ["floating"];
    case "hardwood":
      if (construction === "engineered") return ["nail", "staple", "glue", "floating"];
      if (construction === "solid") return ["nail", "staple", "glue"];
      // Unknown construction: offer the union so we don't hide a valid method.
      return ["nail", "staple", "glue", "floating"];
    case "tile":
      return ["thinset"];
    case "vinyl":
      return ["glue"];
    default:
      return ["unknown"];
  }
}

export function installMethodOptionsFor(
  family: FlooringFamily,
  construction: HardwoodConstruction = "unknown",
): { label: string; system: InstallSystem }[] {
  return permittedInstallSystems(family, construction)
    .filter((s): s is Exclude<InstallSystem, "unknown"> => s !== "unknown")
    .map((system) => ({ system, label: INSTALL_METHOD_LABELS[system] }));
}

/** Mixed jobs: union of permitted methods across every selected family. */
export function installMethodOptionsForFamilies(
  families: FlooringFamily[],
  construction: HardwoodConstruction = "unknown",
): { label: string; system: InstallSystem }[] {
  const seen = new Set<string>();
  const out: { label: string; system: InstallSystem }[] = [];
  const list = families.length ? families : (["other"] as FlooringFamily[]);
  for (const f of list) {
    for (const opt of installMethodOptionsFor(f, construction)) {
      if (seen.has(opt.label)) continue;
      seen.add(opt.label);
      out.push(opt);
    }
  }
  return out;
}

export function isRollGoodsFamily(family: FlooringFamily): boolean {
  return family === "carpet" || family === "vinyl";
}

export function isBoxedFamily(family: FlooringFamily): boolean {
  return family === "lvp" || family === "hardwood" || family === "laminate" || family === "tile";
}

/**
 * Families whose stairs use treads, risers, and stair noses — not carpet
 * waterfall / upholstered wrap. Sheet vinyl is included when the job wraps
 * stairs in that product; the trim types still come from existing TRIM_TYPES.
 */
export function isHardSurfaceStairFamily(family: FlooringFamily): boolean {
  return (
    family === "lvp" ||
    family === "hardwood" ||
    family === "laminate" ||
    family === "vinyl" ||
    family === "tile"
  );
}

/** Show the Trims stair-nose fill only when a hard-surface family is on the job. */
export function jobNeedsHardSurfaceStairTrim(families: FlooringFamily[]): boolean {
  return families.some(isHardSurfaceStairFamily);
}

export function billsBySqydFamily(family: FlooringFamily): boolean {
  // Pad is sq yd too but is not a flooring family. Carpet + sheet vinyl match
  // SQYD_CATEGORIES in units.ts for the floor itself.
  return family === "carpet" || family === "vinyl";
}

export function profileForFamily(family: FlooringFamily): FlooringProfile | null {
  if (family === "other") return null;
  return profileFor(family);
}

export function defaultWastePctForFamily(family: FlooringFamily): number {
  return profileForFamily(family)?.waste ?? 0;
}

export function familyLabel(family: FlooringFamily): string {
  switch (family) {
    case "carpet":
      return "Carpet";
    case "lvp":
      return "LVP / LVT";
    case "hardwood":
      return "Hardwood";
    case "laminate":
      return "Laminate";
    case "tile":
      return "Tile";
    case "vinyl":
      return "Sheet vinyl";
    default:
      return "Other";
  }
}

/**
 * Bag/sheet counts are only final when the salesperson did not mark prep as
 * field-verify / TBD. Unanswered stays open (do not hide quantities yet).
 */
export function prepQuantitiesAreFinal(labels: string[] | null | undefined): boolean {
  return !(labels ?? []).some((l) => /field|tbd|verify/i.test(l));
}

/** Suffix for estimated / allowance material lines. Empty when known or TBD. */
export function prepQuantitySuffix(labels: string[] | null | undefined): string {
  const t = (labels ?? []).join(" ").toLowerCase();
  if (/field|tbd|verify/.test(t)) return "";
  if (/allow/.test(t)) return " (allowance)";
  if (/estimat/.test(t)) return " (estimated)";
  return "";
}
