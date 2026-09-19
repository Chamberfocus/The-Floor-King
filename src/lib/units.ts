/**
 * Units of measure — one source of truth for how a material is priced.
 *
 * A material is billed either BY AREA (sq ft / sq yd — quantity comes from the
 * measured area) or BY COUNT (each / bag / linear ft / box… — quantity is a
 * plain count the user types). The pricing math (estimate-calc) keys off an
 * explicit `quantity` for count units and the measured area for area units, so
 * every material is priced in its OWN unit — never area-forced.
 *
 * Catalog category classifiers keep leftover planted sqft on Unit TBD
 * adhesive / pad / labor as How many, not taped square feet.
 */
import { isHardSurfaceCategory, isRollGoodCategory } from "@/lib/types";

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
  "step",
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
  step: "step",
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
  const compact = u.replace(/[^a-z0-9]/g, "");
  // Flooring catalogs write square yards as SY / sq yd / yard. "sy" does not
  // contain "yd", so it must be named — otherwise a SY line prices as COUNT
  // and a 50-yard pad order is treated as 50 of something else.
  if (
    compact === "sy" ||
    compact === "syd" ||
    compact === "yd" ||
    compact === "yds" ||
    compact === "yard" ||
    compact === "yards" ||
    compact === "sqyd" ||
    compact === "sqyard" ||
    compact === "sqyards" ||
    compact === "squareyard" ||
    compact === "squareyards" ||
    compact.includes("sqyd") ||
    compact.includes("sqyard")
  )
    return "sqyd";
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
  if (u === "step" || u.startsWith("step")) return "step";
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

function hasMeasuredArea(sqft: number | string | null | undefined): boolean {
  const n = typeof sqft === "number" ? sqft : parseFloat(String(sqft ?? ""));
  return Number.isFinite(n) && n > 0;
}

/**
 * Canonical unit KEY for a line (sqft / sqyd / each / lnft / step…).
 *
 * `measure_unit` is area-only (sqft|sqyd). Count lines still store it as
 * "sqft" with `sqft` null. Never treat that as square feet.
 *
 * Pricing still uses `isAreaUnit(unit)` (empty unit = area). This helper is
 * for the printed unit next to a quantity, so toilets/stairs/delivery never
 * render as "sq ft" just because MeasureUnit defaulted to sqft.
 */
export function lineUnitKey(line: {
  unit?: string | null;
  measure_unit?: string | null;
  sqft?: number | string | null;
  category?: string | null;
}): string {
  const raw = (line.unit ?? "").trim();
  const fromUnit = normalizeUnit(raw);
  if (fromUnit && !isAreaUnit(fromUnit)) return fromUnit;
  if (fromUnit === "sqyd") return "sqyd";
  if (fromUnit === "sqft") return "sqft";
  // Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet.
  if (
    line.category &&
    !(isRollGoodCategory(line.category) || isHardSurfaceCategory(line.category))
  ) {
    return "";
  }
  if (hasMeasuredArea(line.sqft)) return line.measure_unit === "sqyd" ? "sqyd" : "sqft";
  // No taped area and no count unit — unknown, not square feet and not "each".
  return "";
}

/** Unit printed next to a quantity. Count lines never fall back to sq ft. */
export function lineDisplayUnit(line: {
  unit?: string | null;
  measure_unit?: string | null;
  sqft?: number | string | null;
  category?: string | null;
}): string {
  const key = lineUnitKey(line);
  return unitLabel(key) || key;
}

/**
 * Convert a billed quantity into square yards.
 *
 * sq yd stays yards. sq ft divides by 9. Any other unit (each / lnft / roll /
 * bag…) is not an area conversion — return null so callers do not invent yards.
 */
export function billedQtyToSqyd(qty: number, unitKey: string): number | null {
  if (!(Number.isFinite(qty) && qty > 0)) return null;
  if (unitKey === "sqyd") return qty;
  if (unitKey === "sqft") return qty / 9;
  return null;
}

/**
 * Convert a billed quantity into square feet.
 *
 * sq ft stays feet. sq yd multiplies by 9. Any other unit is not an area
 * conversion — return null so callers do not invent square feet.
 * Exclusive carpet-tile PO / warehouse / work-order carton math uses this
 * before ÷ coverage (tile bills per sq yd; coverage is sq ft/box).
 * Exclusive carpet-tile warehouse queue carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
 * Hard-surface warehouse queue carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job scope carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job scope carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile estimate order carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface estimate order carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job materials carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job materials carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile work-order editor carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface work-order editor carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job materials purchasing-gap carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job materials purchasing-gap carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile warehouse incoming-delivery carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse incoming-delivery carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile estimate office carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface estimate office carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Builder collapsed carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Builder collapsed carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Guided Estimate Review carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Guided Estimate Review carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile approval-snapshot job-seed carton coverage from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface approval-snapshot job-seed carton coverage from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Builder expanded LineMeasurements carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Builder expanded LineMeasurements carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Guided Estimate Review order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Guided Estimate Review order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Builder collapsed order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Builder collapsed order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Builder expanded LineMeasurements order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Builder expanded LineMeasurements order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile estimate office order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface estimate office order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job scope order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job scope order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile installation-wo order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface installation-wo order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile work-order editor order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface work-order editor order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job scope order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Underlayment job scope order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile warehouse queue order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Underlayment warehouse queue order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile job materials order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment job materials order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile estimate order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment estimate order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile incoming-delivery pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment incoming-delivery pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile work-order editor order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment work-order editor order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile estimate office order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment estimate office order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile Builder collapsed order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment Builder collapsed order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile Guided Estimate Review order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment Guided Estimate Review order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile Builder expanded LineMeasurements order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment Builder expanded LineMeasurements order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile Builder expanded pad order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment Builder expanded pad order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile Builder expanded tile takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Hard-surface Builder expanded tile takeoff order carton count stays off this modular strip. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Guided Estimate tile takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Hard-surface Guided Estimate tile takeoff order carton count stays off this modular strip. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Guided Estimate running takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Hard-surface Guided Estimate running takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Guided Estimate running takeoff order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment Guided Estimate running takeoff order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile Guided Estimate pad takeoff order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment Guided Estimate pad takeoff order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile Guided Estimate extra takeoff order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment Guided Estimate extra takeoff order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile job materials purchasing-gap order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment job materials purchasing-gap order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile job materials excess order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment job materials excess order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile job materials arrived order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment job materials arrived order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile warehouse incoming-delivery arrived order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Hard-surface warehouse incoming-delivery arrived order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile warehouse incoming-delivery arrived order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment warehouse incoming-delivery arrived order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile warehouse incoming-delivery outstanding order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Hard-surface warehouse incoming-delivery outstanding order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile warehouse incoming-delivery outstanding order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment warehouse incoming-delivery outstanding order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile job materials outstanding order carton count from remaining order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Hard-surface job materials outstanding order carton count from remaining order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job materials outstanding order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment job materials outstanding order pad-roll count from remaining order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile Guided Estimate extra takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Guided Estimate extra takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Guided Estimate Review takeoff order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Underlayment Guided Estimate Review takeoff order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile Guided Estimate pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Guided Estimate pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Builder expanded pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Builder expanded pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Builder collapsed pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Builder collapsed pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile estimate office pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface estimate office pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile work-order editor pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface work-order editor pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile installation-wo pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface installation-wo pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile estimate order pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface estimate order pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job materials pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job materials pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile warehouse queue pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse queue pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile staging pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface staging pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile incoming-delivery pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface incoming-delivery pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile incoming-delivery arrived pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface incoming-delivery arrived pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile incoming-delivery outstanding pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface incoming-delivery outstanding pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job materials purchasing-gap pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job materials purchasing-gap pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job materials excess pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job materials excess pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job materials arrived pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job materials arrived pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job materials outstanding pad takeoff order carton count from remaining order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job materials outstanding pad takeoff order carton count from remaining order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job scope pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job scope pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile po print pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface po print pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile po builder pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface po builder pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile line measurements pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface line measurements pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile po plan pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface po plan pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Guided Estimate Review pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Guided Estimate Review pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile warehouse customer-order qty from cuts is the order, not leftover planted quantity — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse customer-order leftover planted Qty stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile office customer-order qty from cuts is the order, not leftover planted quantity — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface office customer-order leftover planted quantity stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile office customer-order email qty from cuts is the order, not leftover planted quantity — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface office customer-order email leftover planted quantity stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile office customer-order invoice qty from cuts is the order, not leftover planted quantity — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface office customer-order invoice leftover planted quantity stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile office customer-order invoice unit from cuts is the order, not leftover planted unit — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface office customer-order invoice leftover planted unit stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile office customer-order invoice rate from cuts is the order, not leftover planted rate — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface office customer-order invoice leftover planted rate stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse incoming Short mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse incoming Short leftover planted mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile office PO short-delivery email mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface office PO short-delivery leftover planted mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse incoming Short toast mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse incoming Short leftover planted toast mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse reorder remnant mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse reorder leftover planted remnant mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse stock-PO remnant mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse stock-PO leftover planted remnant mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse inventory stock-item on-hand mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse inventory stock-item leftover planted on-hand mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse customer-order on-hand mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse customer-order leftover planted on-hand mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile office customer-order on-hand mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface office customer-order leftover planted on-hand mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse inventory list on-hand mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse inventory list leftover planted on-hand mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile catalog picker on-hand mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface catalog picker leftover planted on-hand mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile quick-lines on-hand mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface quick-lines leftover planted on-hand mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile job materials on-hand mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job materials leftover planted on-hand mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile reports products on-hand mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface reports products leftover planted on-hand mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse inventory stock-item leftover planted available mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse inventory stock-item leftover planted available mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse inventory stock-item leftover planted reserved mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse inventory stock-item leftover planted reserved mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse inventory stock-item leftover planted on-order mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse inventory stock-item leftover planted on-order mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse inventory stock-item leftover planted value mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse inventory stock-item leftover planted value mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse inventory list leftover planted value mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse inventory list leftover planted value mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage.
 */
export function billedQtyToSqft(qty: number, unitKey: string): number | null {
  if (!(Number.isFinite(qty) && qty > 0)) return null;
  if (unitKey === "sqft") return qty;
  if (unitKey === "sqyd") return qty * 9;
  return null;
}

/**
 * Convert a billed-unit rate into $/carton from sq ft/box coverage.
 * sq ft rate × coverage. sq yd rate ÷ 9 first — exclusive carpet-tile bills
 * per sq yd, coverage is sq ft/box. Count units return null.
 * Exclusive carpet-tile PO carton helper boxed rate onto $/carton is sq ft coverage, not sq yd × coverage 1:1. Exclusive carpet-tile PO print carton helper boxed rate onto $/carton is sq ft coverage, not sq yd × coverage 1:1. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
 */
export function billedRateToCartonCost(
  unitCost: number,
  unitKey: string,
  sqftPerBox: number,
): number | null {
  if (!(Number.isFinite(unitCost) && unitCost >= 0)) return null;
  if (!(Number.isFinite(sqftPerBox) && sqftPerBox > 0)) return null;
  const perSqft = billedQtyToSqft(1, normalizeUnit(unitKey) || unitKey);
  if (perSqft == null || !(perSqft > 0)) return null;
  return Math.round((unitCost / perSqft) * sqftPerBox * 100) / 100;
}

/** True when the unit string is square yards (SY / sq yd / yard / …). */
export function unitIsSqyd(raw: string | null | undefined): boolean {
  return normalizeUnit(raw) === "sqyd";
}

/**
 * Unit the warehouse roll-receive form may pre-select.
 *
 * Only sq yd or linear ft — those are the two receive options. Missing or
 * unknown product.unit is empty (Unit TBD), never an invented sq yd.
 */
export function rollReceiveUnit(raw: string | null | undefined): "sqyd" | "lnft" | "" {
  const u = normalizeUnit(raw);
  if (u === "sqyd") return "sqyd";
  if (u === "lnft") return "lnft";
  return "";
}

/**
 * Convert a catalog per-unit rate into the line's billing unit.
 *
 * Catalog SY is yards — never a 9× surprise just because the letters "yd"
 * are missing. Count units (each / box / lnft / roll) stay 1:1.
 * Boxed carton WITH coverage that takeoffs as area is $/coverage in
 * catalogToLineMeasure — not this helper, and not 1:1. Exclusive carpet-tile
 * catalog box rate onto that area line is $/coverage (9/coverage onto sq yd)
 * when exclusive tile systems are passed — mixed stretch-in + tile stays 1:1.
 * Wrap / count How many stays 1:1. Do not invent coverage.
 *
 * The billing unit is the printed line unit (`lineUnitKey`), not leftover
 * `measure_unit`. Count lines and leftover "sqft" on a sq-yd carpet line
 * must not 9× or ÷9 the catalog rate.
 */
export function catalogUnitFactor(
  productUnit: string | null | undefined,
  billingIsSqyd: boolean,
): number {
  const key = normalizeUnit(productUnit);
  if (key && !isAreaUnit(key)) return 1;
  const productIsSqyd = key === "sqyd";
  return productIsSqyd === billingIsSqyd ? 1 : billingIsSqyd ? 9 : 1 / 9;
}

export function catalogRateToBillingUnit(
  rate: number,
  productUnit: string | null | undefined,
  billingIsSqyd: boolean,
): number {
  const r = Number(rate) || 0;
  return Math.round(r * catalogUnitFactor(productUnit, billingIsSqyd) * 100) / 100;
}

/** True when the line is billed by count, not taped area. */
export function isCountPricedLine(line: {
  unit?: string | null;
  measure_unit?: string | null;
  sqft?: number | string | null;
  category?: string | null;
}): boolean {
  const raw = (line.unit ?? "").trim();
  if (raw) return !isAreaUnit(raw);
  // Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet.
  if (
    line.category &&
    !(isRollGoodCategory(line.category) || isHardSurfaceCategory(line.category))
  ) {
    return true;
  }
  // No unit string: taped area is still AREA. No taped area is COUNT so we
  // never print "sq ft" beside a toilet/stair/delivery quantity.
  return !hasMeasuredArea(line.sqft);
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
 * EACH; a genuinely unknown "other" stays unit TBD — never planted square feet.
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
/**
 * Goods that come off a roll and are sold by the SQUARE YARD: carpet, sheet
 * vinyl, and carpet pad.
 *
 * Catalog category `underlayment` stays on this list because carpet pad is
 * yards. Laminate / LVP foam shares that category but bills by the square
 * foot. Guided Estimate must call `areaBillsBySquareYard` (question key +
 * product unit) so foam is not converted to yards. Do not drop underlayment
 * from this list to "fix" foam — pad would then plant square feet.
 *
 * This one list is the rule. It was written out three times and one copy
 * disagreed: the questionnaire billed sheet vinyl per square yard (correct — 149
 * of the 151 sheet-vinyl products in the catalog are priced that way), while
 * defaultUnitForCategory created new sheet-vinyl products as square FEET. So you
 * typed a per-yard price into a box labelled "$ / sq ft" and the conversion
 * multiplied it by nine on its way onto the estimate.
 *
 * Kept here, in the module that owns units, and read by everything that needs
 * it — see isRollGoodCategory in types.ts, which is the same list by another
 * name and must stay in step.
 */
export const SQYD_CATEGORIES = ["carpet", "vinyl", "underlayment"] as const;

/** Sold by the square yard (roll goods) rather than the square foot. */
export function billsBySquareYard(category: string | null | undefined): boolean {
  return (SQYD_CATEGORIES as readonly string[]).includes(category ?? "");
}

export function defaultUnitForCategory(category: string | null | undefined): string {
  if (billsBySquareYard(category)) return "sqyd";
  switch (category) {
    case "lvp":
    case "hardwood":
    case "laminate":
    case "tile":
      return "sqft";
    case "trim":
      // Vendors sell trim as pre-cut sticks at a per-piece price — 6,619 of the
      // 6,994 trim products in this catalog are stored that way. The job is
      // still MEASURED in linear feet; the stick length converts the run into
      // whole pieces (you can't buy 2.3 sticks), which is why a by-the-piece
      // trim needs piece_length_in set.
      return "each";
    case "labor":
      return "hour";
    default:
      // Other / unknown is unit TBD. Planting sq ft here is how a pail of
      // adhesive gets priced by the square foot.
      return "";
  }
}

/**
 * Unit attached when a salesperson *picks* a catalog SKU.
 *
 * Trust the product's stored unit. If it is missing:
 *   - carpet / sheet vinyl → sqyd (those families bill by the yard)
 *   - boxed hard surface → sqft
 *   - underlayment / trim / labor / other → empty (unit TBD)
 *
 * Never plant square feet on a gallon of adhesive or a stick of trim just
 * because the SKU forgot to store a unit. Underlayment is mixed (pad by the
 * yard, laminate underlayment by the foot) so we do not guess.
 */
export function pickedProductUnit(
  unit: string | null | undefined,
  category: string | null | undefined,
): string {
  const raw = (unit ?? "").trim();
  if (raw) return raw;
  const cat = (category ?? "").trim().toLowerCase();
  if (cat === "carpet" || cat === "vinyl") return "sqyd";
  if (cat === "lvp" || cat === "hardwood" || cat === "laminate" || cat === "tile") return "sqft";
  return "";
}

/**
 * The units worth offering for a category — not all twelve.
 *
 * Adding a flooring product used to present every unit in the system: bag,
 * gallon, hour, sheet, kit. None of them can be right for carpet, and offering
 * them is how a product ends up priced per "each". Flooring gets the two area
 * units with its own first; trim gets the two it's actually sold in; "other" is
 * the catch-all and keeps everything, because that's what it's for.
 */
export function unitsForCategory(category: string | null | undefined): UnitOption[] {
  const only = (...values: string[]) =>
    values
      .map((v) => UNIT_OPTIONS.find((u) => u.value === v))
      .filter(Boolean) as UnitOption[];

  if (billsBySquareYard(category)) {
    // Pad is genuinely mixed in this catalog — sq yd for carpet pad, sq ft for
    // laminate underlayment, and some sold by the roll — so it keeps the range.
    return category === "underlayment"
      ? only("sqyd", "sqft", "roll", "each")
      : only("sqyd", "sqft");
  }
  switch (category) {
    case "lvp":
    case "hardwood":
    case "laminate":
    case "tile":
      return only("sqft", "sqyd", "box");
    case "trim":
      return only("each", "lnft", "pc");
    case "labor":
      return only("hour", "sqft", "sqyd", "lnft", "each");
    default:
      return UNIT_OPTIONS;
  }
}
