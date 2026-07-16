/**
 * Units of measure — one source of truth for how a material is priced.
 *
 * A material is billed either BY AREA (sq ft / sq yd — quantity comes from the
 * measured area) or BY COUNT (each / bag / linear ft / box… — quantity is a
 * plain count the user types). The pricing math (estimate-calc) keys off an
 * explicit `quantity` for count units and the measured area for area units, so
 * every material is priced in its OWN unit — never area-forced.
 *
 * Pure + dependency-free so both the client builder and the server can use it.
 */

export type UnitKind = "area" | "count";

/** Canonical area unit keys. */
export const AREA_UNITS = ["sqft", "sqyd"] as const;

/** Count units offered in the pickers, in display order. */
export const COUNT_UNITS = [
  "each",
  "bag",
  "box",
  "lnft",
  "pc",
  "gal",
  "roll",
  "sheet",
  "hour",
  "set",
  "kit",
] as const;

const LABELS: Record<string, string> = {
  sqft: "sq ft",
  sqyd: "sq yd",
  each: "each",
  bag: "bag",
  box: "box",
  lnft: "lnft",
  pc: "piece",
  gal: "gallon",
  roll: "roll",
  sheet: "sheet",
  hour: "hour",
  set: "set",
  kit: "kit",
};

/**
 * Map any free-typed / legacy unit string to a canonical key (sqft, sqyd, bag…).
 * Unknown strings fall through as their trimmed lowercase form and are treated
 * as a COUNT unit — so a genuinely custom unit still prices by quantity, never
 * by area.
 */
export function normalizeUnit(raw: string | null | undefined): string {
  const u = (raw ?? "").trim().toLowerCase();
  if (!u) return "";
  if (u.includes("yd")) return "sqyd";
  if (u === "sf" || u === "ft" || u === "sqft" || u.includes("sq f") || u.includes("square f"))
    return "sqft";
  if (u === "lf" || u === "lnft" || u.includes("ln ft") || u.includes("lin ft") || u.includes("linear"))
    return "lnft";
  if (u === "ea" || u.startsWith("each")) return "each";
  if (u.startsWith("bag")) return "bag";
  if (u.startsWith("box") || u.startsWith("carton") || u === "ctn") return "box";
  if (u === "pc" || u === "pcs" || u.startsWith("piece")) return "pc";
  if (u.startsWith("gal")) return "gal";
  if (u.startsWith("roll")) return "roll";
  if (u.startsWith("sheet") || u === "sht") return "sheet";
  if (u === "hr" || u.startsWith("hour")) return "hour";
  if (u === "set") return "set";
  if (u === "kit") return "kit";
  return u;
}

/** True when the unit bills by measured AREA (sq ft / sq yd). Empty = area (the
 *  default), so legacy area lines with no explicit unit keep working. */
export function isAreaUnit(raw: string | null | undefined): boolean {
  const u = normalizeUnit(raw);
  return u === "" || u === "sqft" || u === "sqyd";
}

export function unitKind(raw: string | null | undefined): UnitKind {
  return isAreaUnit(raw) ? "area" : "count";
}

/** Human label for a unit, e.g. "bag", "sq ft". Falls back to the raw string. */
export function unitLabel(raw: string | null | undefined): string {
  const u = normalizeUnit(raw);
  if (!u) return "";
  return LABELS[u] ?? u;
}

export interface UnitOption {
  value: string;
  label: string;
  kind: UnitKind;
}

/** Every unit a picker offers — area first, then count. */
export const UNIT_OPTIONS: UnitOption[] = [
  { value: "sqft", label: "sq ft", kind: "area" },
  { value: "sqyd", label: "sq yd", kind: "area" },
  ...COUNT_UNITS.map((u) => ({ value: u, label: LABELS[u] ?? u, kind: "count" as const })),
];

/**
 * Words that mark a product as sold BY THE CONTAINER (a pail / gallon / tube /
 * cartridge / bag…), so an importer never defaults these to square feet. Kept
 * conservative — flooring words like "glue down" are deliberately NOT here.
 */
const CONTAINER_RE =
  /\b(?:adhesive|sealant|sealer|primer|mastic|leveler|self-?leveling|underlayment\s+compound|skim(?:\s?coat)?|patch(?:ing)?|grout|caulk|mortar|thinset|epoxy|remover|degreaser|hardener|activator)\b|\b(?:tube|cartridge|sausage|pail|bucket|gallon|gal|quart|qt|oz|bottle|kit|pouch|jug|can|bag|case|ctn|carton|drum)\b|megabond|toughbond|sikabond/i;

/**
 * Infer a product's unit at import time. If the price list already gave a unit,
 * trust it. Otherwise: real flooring categories bill by their area default;
 * anything that reads like a container (adhesive / gallon / pail…) bills by the
 * EACH; only a genuinely unknown "other" falls back to square feet. This stops
 * the old "default everything to sqft" bug that priced pails by the square foot.
 */
export function inferUnit(
  name: string | null | undefined,
  parsedUnit: string | null | undefined,
  category?: string | null,
): string {
  const p = normalizeUnit(parsedUnit);
  if (p) return p; // the source named a unit — keep it
  const cat = category ?? "other";
  // Flooring / area goods keep their area unit regardless of the name.
  if (cat !== "other" && cat !== "labor") return defaultUnitForCategory(cat);
  if (CONTAINER_RE.test(name ?? "")) return "each";
  return defaultUnitForCategory(cat);
}

/**
 * Parse a prep material's coverage from its name, e.g. "SikaLevel 225 — 28 SF @
 * 1/4\"" or "Schonox US 60 sf at 1/8". Requires the "<num> SF @/at <thickness>"
 * shape so it never mistakes a price like "$2.59 SF" for coverage. Fractions
 * (1/4) become decimals. Returns null when there's no coverage spec.
 */
export function parseCoverage(
  name: string | null | undefined,
): { coverage_sqft: number; coverage_thickness_in: number } | null {
  const s = (name ?? "").toLowerCase();
  const m = s.match(
    /(\d+(?:\.\d+)?)\s*(?:sf|sq\.?\s?ft|sqft)\s*(?:@|at)\s*(\d+\s*\/\s*\d+|\d*\.?\d+)\s*(?:"|in\b|inch(?:es)?)?/i,
  );
  if (!m) return null;
  const cov = parseFloat(m[1]);
  if (!Number.isFinite(cov) || cov <= 0) return null;
  let thickness: number;
  const t = m[2].trim();
  if (t.includes("/")) {
    const [a, b] = t.split("/").map((x) => parseFloat(x));
    thickness = b ? a / b : 0;
  } else {
    thickness = parseFloat(t) || 0;
  }
  if (!(thickness > 0)) return null;
  return { coverage_sqft: cov, coverage_thickness_in: thickness };
}

/**
 * A sensible default unit for a product category, so the on-the-fly add form
 * starts on the right unit and a bag/each item isn't mis-saved as area.
 */
export function defaultUnitForCategory(category: string | null | undefined): string {
  switch (category) {
    case "carpet":
      return "sqyd";
    case "lvp":
    case "hardwood":
    case "laminate":
    case "tile":
    case "vinyl":
      return "sqft";
    case "underlayment":
      return "sqft";
    case "trim":
      return "lnft";
    case "labor":
      return "hour";
    default:
      return "sqft";
  }
}
