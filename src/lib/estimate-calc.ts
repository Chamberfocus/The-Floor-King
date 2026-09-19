import {
  isHardSurfaceCategory,
  isRollGoodCategory,
  type EstimatePresentation,
  type LineMeasurement,
  type LineType,
  type MeasureUnit,
} from "@/lib/types";
import { billedQtyToSqft, isAreaUnit, isCountPricedLine, lineUnitKey, normalizeUnit } from "@/lib/units";

/** Signed square feet of one measured piece (subtract = a cutout). */
export function measurementSqft(m: LineMeasurement): number {
  const area = (num(m.length_in) / 12) * (num(m.width_in) / 12);
  return m.op === "subtract" ? -area : area;
}

/** Total square feet built up from a line's measured pieces. */
export function measurementsSqft(list: LineMeasurement[] | null | undefined): number {
  if (!list?.length) return 0;
  return Math.round(list.reduce((s, m) => s + measurementSqft(m), 0) * 100) / 100;
}

/**
 * Pure pricing math shared by the live builder (client) and the server.
 * Accepts strings or numbers so it can run directly on form-input state.
 */
export interface CalcLine {
  line_type: LineType;
  sqft?: number | string | null;
  length_in?: number | string | null;
  width_in?: number | string | null;
  measure_unit?: MeasureUnit | null;
  material_rate?: number | string | null;
  labor_rate?: number | string | null;
  installed_rate?: number | string | null;
  flat_amount?: number | string | null;
  waste_pct?: number | string | null;
  // OUR cost + explicit quantity (for margin & post-job analysis).
  material_cost?: number | string | null;
  labor_cost?: number | string | null;
  quantity?: number | string | null;
  unit?: string | null;
  // A LABOR line charges labor only — any material rate/cost on it is ignored
  // (it belongs on its own material line, never double-charged here).
  category?: string | null;
  /** Warehouse cut pieces. Roll-goods order comes from these, not taped sq ft. */
  measurements?: LineMeasurement[] | null;
  /** Stair wrap TBD / carton-coverage TBD are identified from the description. */
  description?: string | null;
}

/** A labor line is priced on labor alone — material never counts on it. */
const isLaborLine = (line: CalcLine): boolean => line.category === "labor";

export function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  // Strip currency symbols, thousands separators, and spaces so a pasted value
  // like "$1,250.00" parses as 1250, not 1 (parseFloat stops at the comma).
  const n =
    typeof v === "number" ? v : parseFloat(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Area in square feet used for PRICING. The measured TOTAL lives in `sqft` — for
 * a multi-cut line, length_in/width_in hold only the FIRST cut (they exist for
 * the warehouse cut list), so pricing off L×W would bill just one piece. Prefer
 * the total `sqft`; fall back to a single L×W only for legacy lines that stored
 * no sqft.
 */
export function lineAreaSqft(line: CalcLine): number {
  const sf = num(line.sqft);
  if (sf > 0) return sf;
  const len = num(line.length_in);
  const wid = num(line.width_in);
  if (len > 0 && wid > 0) return (len / 12) * (wid / 12);
  return 0;
}

export function lineAreaSqyd(line: CalcLine): number {
  return lineAreaSqft(line) / 9;
}

/**
 * Hard-surface stair wrap from Guided Estimate. Extra boxes / EACH — never
 * taped sq ft and never 8 sq ft per step. The questionnaire stamps
 * "wrap qty TBD" so leftover product unit sqft cannot reopen that order.
 */
export function lineIsStairWrapTbd(line: { description?: string | null }): boolean {
  const d = (line.description ?? "").trim();
  // Typed How many wrap omits "wrap qty TBD" but still stamps the step-order
  // phrase so leftover taped sq ft cannot reopen 8 sq ft/step.
  return /wrap qty TBD|not an automatic sq ft\/step order/i.test(d);
}

/**
 * Boxed LVP / hardwood / exclusive carpet-tile sold by the carton when
 * coverage is missing. How many / Unit TBD — never leftover taped sq ft
 * as the order, and never an invented box size.
 */
export function lineIsBoxedCartonTbd(line: { description?: string | null }): boolean {
  return /carton coverage TBD/i.test((line.description ?? "").trim());
}

/**
 * Main / extra count SKU identity from Guided Estimate. How many / Unit TBD
 * — leftover taped sq ft is not the order, and not a 30-yard roll.
 */
export function lineIsCountNotTapedSqft(line: { description?: string | null }): boolean {
  return /not taped sq ft/i.test((line.description ?? "").trim());
}

/**
 * Wrap / carton-coverage TBD / qty TBD How many is already the order.
 * A count unit (box / each / roll) is already How many. Do not divide
 * leftover taped sq ft — or a box count — by sq ft/box.
 */
export function lineSkipsAreaCartonMath(line: {
  description?: string | null;
  unit?: string | null;
}): boolean {
  if (
    lineIsStairWrapTbd(line) ||
    lineIsBoxedCartonTbd(line) ||
    lineIsCountNotTapedSqft(line)
  ) {
    return true;
  }
  const u = (line.unit ?? "").trim();
  return !!u && !isAreaUnit(u);
}

type AreaCartonLine = {
  description?: string | null;
  category?: string | null;
  unit?: string | null;
  measure_unit?: string | null;
  sqft?: number | string | null;
  quantity?: number | string | null;
  sqft_per_box?: number | string | null;
  roll_width_ft?: number | string | null;
  order_as_roll?: boolean | null;
  length_in?: number | string | null;
  width_in?: number | string | null;
  measurements?: { length_in?: number | string | null; width_in?: number | string | null; op?: string | null }[] | null;
};

/**
 * Hard-surface, or exclusive carpet tile (category stays carpet — do not invent
 * a carpet-tile category). Mixed stretch-in + tile, unanswered carpet, and a
 * roll-width / cut plan stay cuts. Do not infer exclusive tile from unit=box.
 */
export function lineUsesAreaCartonMath(line: AreaCartonLine): boolean {
  if (lineSkipsAreaCartonMath(line)) return false;
  if (isHardSurfaceCategory(line.category)) return true;
  if ((line.category ?? "") !== "carpet") return false;
  if (Number(line.roll_width_ft) > 0) return false;
  if (line.order_as_roll === true) return false;
  const pieces = (line.measurements ?? []).filter(
    (m) => m.op !== "subtract" && Number(m.length_in) > 0 && Number(m.width_in) > 0,
  );
  if (pieces.length) return false;
  if (Number(line.length_in) > 0 && Number(line.width_in) > 0) return false;
  const cov = Number(line.sqft_per_box);
  return Number.isFinite(cov) && cov > 0;
}

/**
 * Hard-surface carton count from MEASURED area ÷ coverage.
 * Exclusive carpet-tile PO / warehouse / work-order carton math from sq ft ÷ coverage — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
 * Exclusive carpet-tile warehouse queue carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
 * Hard-surface warehouse queue carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job scope carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job scope carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile estimate order carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface estimate order carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job materials carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job materials carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile work-order editor carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface work-order editor carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job materials purchasing-gap carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job materials purchasing-gap carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile warehouse incoming-delivery carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse incoming-delivery carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile estimate office carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface estimate office carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Builder collapsed carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Builder collapsed carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Guided Estimate Review carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Guided Estimate Review carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile approval-snapshot job-seed carton coverage from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface approval-snapshot job-seed carton coverage from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Builder expanded LineMeasurements carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Builder expanded LineMeasurements carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Guided Estimate Review order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Guided Estimate Review order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Builder collapsed order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Builder collapsed order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Builder expanded LineMeasurements order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Builder expanded LineMeasurements order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile estimate office order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface estimate office order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job scope order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job scope order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile installation-wo order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface installation-wo order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile work-order editor order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface work-order editor order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job scope order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Underlayment job scope order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile warehouse queue order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Underlayment warehouse queue order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile job materials order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment job materials order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile estimate order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment estimate order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile incoming-delivery pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment incoming-delivery pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile work-order editor order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment work-order editor order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile estimate office order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment estimate office order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile Builder collapsed order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment Builder collapsed order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile Guided Estimate Review order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment Guided Estimate Review order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile Builder expanded LineMeasurements order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment Builder expanded LineMeasurements order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile Builder expanded pad order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment Builder expanded pad order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile Builder expanded tile takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Hard-surface Builder expanded tile takeoff order carton count stays off this modular strip. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Guided Estimate tile takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Hard-surface Guided Estimate tile takeoff order carton count stays off this modular strip. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Guided Estimate running takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Hard-surface Guided Estimate running takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Guided Estimate running takeoff order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment Guided Estimate running takeoff order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile Guided Estimate pad takeoff order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment Guided Estimate pad takeoff order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile Guided Estimate extra takeoff order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment Guided Estimate extra takeoff order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile job materials purchasing-gap order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment job materials purchasing-gap order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile job materials excess order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment job materials excess order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile job materials arrived order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment job materials arrived order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile warehouse incoming-delivery arrived order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Hard-surface warehouse incoming-delivery arrived order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile warehouse incoming-delivery arrived order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment warehouse incoming-delivery arrived order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile warehouse incoming-delivery outstanding order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Hard-surface warehouse incoming-delivery outstanding order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile warehouse incoming-delivery outstanding order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment warehouse incoming-delivery outstanding order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile job materials outstanding order carton count from remaining order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Hard-surface job materials outstanding order carton count from remaining order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job materials outstanding order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box Underlayment job materials outstanding order pad-roll count from remaining order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile Guided Estimate extra takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Guided Estimate extra takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Guided Estimate Review takeoff order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Underlayment Guided Estimate Review takeoff order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. Exclusive carpet-tile Guided Estimate pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Guided Estimate pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Builder expanded pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Builder expanded pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Builder collapsed pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Builder collapsed pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile estimate office pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface estimate office pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile work-order editor pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface work-order editor pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile installation-wo pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface installation-wo pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile estimate order pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface estimate order pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job materials pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job materials pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile warehouse queue pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse queue pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile staging pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface staging pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile incoming-delivery pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface incoming-delivery pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile incoming-delivery arrived pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface incoming-delivery arrived pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile incoming-delivery outstanding pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface incoming-delivery outstanding pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job materials purchasing-gap pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job materials purchasing-gap pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job materials excess pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job materials excess pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job materials arrived pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job materials arrived pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job materials outstanding pad takeoff order carton count from remaining order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job materials outstanding pad takeoff order carton count from remaining order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job scope pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job scope pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile po print pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface po print pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile po builder pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface po builder pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile line measurements pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface line measurements pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile po plan pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface po plan pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile Guided Estimate Review pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface Guided Estimate Review pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile warehouse customer-order qty from cuts is the order, not leftover planted quantity — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse customer-order leftover planted Qty stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile office customer-order qty from cuts is the order, not leftover planted quantity — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface office customer-order leftover planted quantity stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile office customer-order email qty from cuts is the order, not leftover planted quantity — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface office customer-order email leftover planted quantity stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile office customer-order invoice qty from cuts is the order, not leftover planted quantity — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface office customer-order invoice leftover planted quantity stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile office customer-order invoice unit from cuts is the order, not leftover planted unit — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface office customer-order invoice leftover planted unit stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile office customer-order invoice rate from cuts is the order, not leftover planted rate — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface office customer-order invoice leftover planted rate stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse incoming Short mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse incoming Short leftover planted mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile office PO short-delivery email mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface office PO short-delivery leftover planted mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse incoming Short toast mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse incoming Short leftover planted toast mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse reorder remnant mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse reorder leftover planted remnant mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse stock-PO remnant mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse stock-PO leftover planted remnant mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse inventory stock-item on-hand mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse inventory stock-item leftover planted on-hand mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse customer-order on-hand mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse customer-order leftover planted on-hand mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile office customer-order on-hand mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface office customer-order leftover planted on-hand mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse inventory list on-hand mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse inventory list leftover planted on-hand mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile catalog picker on-hand mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface catalog picker leftover planted on-hand mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile quick-lines on-hand mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface quick-lines leftover planted on-hand mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile job materials on-hand mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job materials leftover planted on-hand mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile reports products on-hand mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface reports products leftover planted on-hand mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse inventory stock-item leftover planted available mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse inventory stock-item leftover planted available mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse inventory stock-item leftover planted reserved mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse inventory stock-item leftover planted reserved mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse inventory stock-item leftover planted on-order mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse inventory stock-item leftover planted on-order mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse inventory stock-item leftover planted value mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse inventory stock-item leftover planted value mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse inventory list leftover planted value mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse inventory list leftover planted value mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile reports products leftover planted value mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface reports products leftover planted value mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile warehouse inventory list leftover planted summary totalValue mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse inventory list leftover planted summary totalValue mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile reports products leftover planted deadValue mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface reports products leftover planted deadValue mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile pulse leftover planted deadStockValue mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface pulse leftover planted deadStockValue mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile dashboard ask leftover planted deadStockValue mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface dashboard ask leftover planted deadStockValue mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile catalog export leftover planted on-hand mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface catalog export leftover planted on-hand mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile insights leftover planted deadStockValue mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface insights leftover planted deadStockValue mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile reports products leftover planted units mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface reports products leftover planted units mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile job scope leftover planted taped sq ft is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job scope leftover planted taped sq ft stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile edit scope leftover planted taped sq ft is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface edit scope leftover planted taped sq ft stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. Exclusive carpet-tile assistant leftover planted taped sq ft is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface assistant leftover planted taped sq ft stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage.
 * PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet.
 */
export function hardSurfaceAreaCartonCount(
  line: AreaCartonLine,
  areaSqft: number,
): number {
  if (!lineUsesAreaCartonMath(line)) return 0;
  const spb = Number(line.sqft_per_box);
  if (!Number.isFinite(spb) || !(spb > 0)) return 0;
  const billed = Number(areaSqft);
  if (!Number.isFinite(billed) || !(billed > 0)) return 0;
  const key = lineUnitKey({
    unit: line.unit,
    measure_unit: line.measure_unit,
    sqft: line.sqft,
    category: line.category,
  });
  const sf =
    key === "sqyd" || key === "sqft"
      ? billedQtyToSqft(billed, key)
      : isHardSurfaceCategory(line.category)
        ? billed
        : billedQtyToSqft(billed, "sqyd");
  if (sf == null || !(sf > 0)) return 0;
  return Math.ceil(sf / spb);
}

/**
 * Keep Guided Estimate identity stamps when a catalog product is picked.
 * Wrap / carton-coverage TBD / qty TBD stay How many until coverage exists
 * on a non-wrap flooring SKU. Room prefixes stay on ordinary area lines.
 */
export function knowledgePickDescription(
  prev: string,
  nextName: string,
  opts?: { dropTbd?: boolean },
): string {
  const name = (nextName ?? "").trim() || "Flooring";
  const d = (prev ?? "").trim();
  const wrap = lineIsStairWrapTbd({ description: d });
  const tbd =
    lineIsBoxedCartonTbd({ description: d }) || lineIsCountNotTapedSqft({ description: d });
  if (wrap || (tbd && !opts?.dropTbd)) {
    const sep = d.indexOf(" — ");
    return sep > 0 ? `${name}${d.slice(sep)}` : d ? `${name} — ${d}` : name;
  }
  if (opts?.dropTbd && tbd) {
    // Prefix before the TBD stamp is the old SKU name, not a room.
    return name;
  }
  if (!d) return name;
  const sep = d.indexOf(" — ");
  return sep > 0 ? `${d.slice(0, sep)} — ${name}` : name;
}

/**
 * Warehouse pieces that make a roll-goods ORDER. Taped room square feet are
 * measured area, not these.
 */
export function rollGoodsLineHasCuts(line: CalcLine): boolean {
  const pieces = (line.measurements ?? []).filter(
    (m) => m.op !== "subtract" && num(m.length_in) > 0 && num(m.width_in) > 0,
  );
  if (pieces.length) return true;
  return num(line.length_in) > 0 && num(line.width_in) > 0;
}

/**
 * Quantity used for pricing, decided by the line's UNIT KIND (not by whether a
 * quantity happens to be > 0):
 *  - COUNT units (each / bag / linear ft / sheet / gallon…) price by their
 *    explicit quantity and NEVER fall back to area — so a bag/pail line with a
 *    blank count is $0, not "priced by the square foot" (the old $33,600 bug).
 *  - AREA units (sq ft / sq yd, or unspecified) price by the MEASURED area, so a
 *    stray quantity can't override the real measurement. Only when there's no
 *    measurement at all does a stored quantity stand in (legacy area lines).
 *  - ROLL GOODS (carpet / sheet vinyl) without warehouse cuts: measured sq ft
 *    is not an order. Exclusive carpet tile and a salesperson qty override
 *    bill from `quantity`. Broadloom/sheet without cuts stay $0 (order TBD)
 *    — never sq ft ÷ 9.
 */
export function lineQty(line: CalcLine): number {
  // Count vs area is one decision (`isCountPricedLine`). Empty unit + leftover
  // measure_unit "sqft" with no taped area is COUNT — toilets, adhesive, pad
  // TBD — never square feet. Roll goods without cuts still bill from quantity
  // only (sq ft ÷ 9 is not an order), including exclusive carpet tile.
  // Stair wrap TBD is extra boxes, even when the wrap SKU is sold by the sq ft.
  if (lineIsStairWrapTbd(line)) return num(line.quantity);
  // Builder carton-coverage TBD is How many / Unit TBD, never taped square feet.
  if (lineIsBoxedCartonTbd(line)) return num(line.quantity);
  // Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet.
  if (lineIsCountNotTapedSqft(line)) return num(line.quantity);
  // Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet.
  if (isCountPricedLine(line)) return num(line.quantity);
  if (isRollGoodCategory(line.category) && line.category !== "labor" && !rollGoodsLineHasCuts(line)) {
    return num(line.quantity);
  }
  /**
   * The LABEL decides the number.
   *
   * `unit` is what every document prints beside the quantity; `measure_unit` is
   * a second field holding the same fact, and nothing stopped the two from
   * drifting apart. When they did, the maths used one and the paperwork printed
   * the other — so a tear-out measured at 723 sq ft, saved with unit "sq ft" and
   * measure_unit "sqyd", billed as "80.33 sq ft". A ninth of the job, on the
   * estimate, the invoice, the work order and the installer's pay.
   *
   * So `unit` wins whenever it says something, and `measure_unit` is only the
   * fallback for lines that carry no unit at all. The printed number and the
   * printed unit now come from the same place and cannot disagree.
   */
  const labelled = normalizeUnit(line.unit);
  const areaUnit = labelled || (line.measure_unit === "sqyd" ? "sqyd" : "sqft");
  const area = areaUnit === "sqyd" ? lineAreaSqyd(line) : lineAreaSqft(line);
  if (area > 0) return area;
  return num(line.quantity);
}

/** Waste multiplier for material (e.g. 10% waste → 1.1). */
function wasteMult(line: CalcLine): number {
  return 1 + num(line.waste_pct) / 100;
}

/**
 * How much material to BUY for a line — the measured area plus its waste.
 *
 * `lineQty` is the measurement. `lineTotal` bills `lineQty × waste`, because
 * waste is material you consume and charge for. The purchase order was built
 * from `lineQty` alone, so on any line carrying waste the shop ordered less
 * than it sold: 634.7 sq ft billed, 577 ordered — the crew arrives 57 sq ft
 * short and somebody drives back to the branch.
 *
 * Same multiplier the price uses, so what you buy and what you charge for can
 * never drift apart.
 */
export function lineOrderQty(line: CalcLine): number {
  return lineQty(line) * wasteMult(line);
}

export function lineTotal(line: CalcLine): number {
  const qty = lineQty(line);
  switch (line.line_type) {
    case "mat_labor":
      // Waste rides on the WHOLE area line, labor included. This shop sells —
      // and pays its installers on — the square footage sold, waste in. Billing
      // labor on the bare measured area while the material beside it billed the
      // waste-inclusive footage under-charged every job that had any waste.
      // A labor line charges labor only — a stray material rate is not added.
      return (
        wasteMult(line) *
        ((isLaborLine(line) ? 0 : qty * num(line.material_rate)) +
          qty * num(line.labor_rate))
      );
    case "installed":
      return qty * num(line.installed_rate) * wasteMult(line);
    case "flat":
      return num(line.flat_amount);
    default:
      return 0;
  }
}

/** OUR cost for a line (material + labor), quantity-aware. Waste raises BOTH:
 *  you buy the extra material AND you pay the installer on the footage sold.
 *  Mirrors lineTotal exactly, so a line priced at margin m returns margin m. */
export function lineCost(line: CalcLine): number {
  const labor = isLaborLine(line);
  if (line.line_type === "flat") {
    return (labor ? 0 : num(line.material_cost)) + num(line.labor_cost); // flat = a single lump cost
  }
  const qty = lineQty(line);
  return (
    wasteMult(line) *
    ((labor ? 0 : qty * num(line.material_cost)) + qty * num(line.labor_cost))
  );
}

export function lineProfit(line: CalcLine): number {
  return lineTotal(line) - lineCost(line);
}

/** Gross margin: profit as a % of the sell price. */
export function marginPct(sell: number, cost: number): number {
  return sell > 0 ? ((sell - cost) / sell) * 100 : 0;
}

/** Markup: profit as a % of cost. */
export function markupPct(sell: number, cost: number): number {
  return cost > 0 ? ((sell - cost) / cost) * 100 : 0;
}

/** Sell price that yields a target gross margin from a given cost. */
export function priceFromMargin(
  cost: number,
  targetMarginPct: number | string,
): number {
  const m = num(targetMarginPct) / 100;
  return m < 1 && m >= 0 ? cost / (1 - m) : cost;
}

export interface CostTotals {
  material: number;
  labor: number;
  cost: number;
}

export function optionCostTotals(lines: CalcLine[]): CostTotals {
  let material = 0;
  let labor = 0;
  for (const line of lines) {
    // A FLAT line is a single lump cost — no quantity, no waste (matches
    // lineCost). Everything else: waste raises the material bought AND the
    // labor paid, because installers are paid on the footage sold.
    if (line.line_type === "flat") {
      material += isLaborLine(line) ? 0 : num(line.material_cost);
      labor += num(line.labor_cost);
      continue;
    }
    const q = lineQty(line);
    const w = wasteMult(line);
    material += isLaborLine(line) ? 0 : q * num(line.material_cost) * w;
    labor += q * num(line.labor_cost) * w;
  }
  return { material, labor, cost: material + labor };
}

export interface OptionTotals {
  subtotal: number;
  tax: number;
  total: number;
}

export function optionTotals(
  lines: CalcLine[],
  taxRatePct: number | string,
): OptionTotals {
  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const tax = subtotal * (num(taxRatePct) / 100);
  return { subtotal, tax, total: subtotal + tax };
}

/** Dollar value of an estimate-level discount ($ amount or % of subtotal). */
export function discountAmount(
  subtotal: number,
  kind: string | null | undefined,
  value: number | string | null | undefined,
): number {
  const v = num(value);
  if (v <= 0 || subtotal <= 0) return 0;
  return kind === "percent"
    ? Math.min((subtotal * v) / 100, subtotal)
    : Math.min(v, subtotal);
}

export interface DiscountedTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

/** Totals with an estimate-level discount applied before tax. One source of
 *  truth for the builder, the estimate view/print, and the invoice. */
export function optionTotalsWithDiscount(
  lines: CalcLine[],
  taxRatePct: number | string,
  discountKind: string | null | undefined,
  discountValue: number | string | null | undefined,
): DiscountedTotals {
  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const discount = discountAmount(subtotal, discountKind, discountValue);
  const taxable = subtotal - discount;
  const tax = taxable * (num(taxRatePct) / 100);
  return { subtotal, discount, tax, total: taxable + tax };
}

// --- Save payload shapes (shared by the client builder and the save action) --

export interface SaveLineInput {
  /** Stable `estimate_line_items.id` when editing an existing line; omit for new lines. */
  id?: string | null;
  room: string;
  description: string;
  note?: string | null;
  line_type: LineType;
  sqft: string | number | null;
  length_in: string | number | null;
  width_in: string | number | null;
  measure_unit: MeasureUnit;
  category?: string | null;
  material_rate: string | number | null;
  labor_rate: string | number | null;
  installed_rate: string | number | null;
  flat_amount: string | number | null;
  waste_pct?: string | number | null;
  product_id: string | null;
  manufacturer?: string | null;
  style?: string | null;
  color?: string | null;
  item_no?: string | null;
  material_cost?: string | number | null;
  labor_cost?: string | number | null;
  quantity?: string | number | null;
  unit?: string | null;
  from_stock?: boolean;
  margin_pct?: string | number | null;
  order_as_roll?: boolean;
  roll_width_ft?: string | number | null;
  sqft_per_box?: string | number | null;
  is_fill?: boolean;
  is_optional?: boolean;
  coverage_sqft?: string | number | null;
  coverage_thickness_in?: string | number | null;
  prep_thickness_in?: string | number | null;
  prep_key?: string | null;
  measurements?: LineMeasurement[] | null;
}

export interface SaveOptionInput {
  name: string;
  notes: string;
  lines: SaveLineInput[];
}

export interface SaveEstimateInput {
  title: string;
  tax_rate: string | number;
  presentation: EstimatePresentation;
  notes: string;
  job_description: string;
  options: SaveOptionInput[];
  target_margin?: string | number | null;
  discount_kind?: "amount" | "percent" | string | null;
  discount_value?: string | number | null;
  /** Index (into options) of the owner-recommended option, or null. Resolved to
   *  the persisted option id by the save action. */
  recommended_index?: number | null;
  /**
   * Per-estimate salesperson commission override. Empty/null = org default %.
   * Amount (dollars) wins over percent. Profitability only — not a customer price.
   */
  commission_override_pct?: string | number | null;
  commission_override_amount?: string | number | null;
}

// --- Wizard submission (one line per room + add-on lines) -------------------

export interface WizardRoom {
  name: string;
  sqft: string | number | null;
  length_in: string | number | null;
  width_in: string | number | null;
  measure_unit: MeasureUnit;
  product_id: string | null;
  description: string;
  line_type: "mat_labor" | "installed";
  material_rate: string | number | null;
  labor_rate: string | number | null;
  installed_rate: string | number | null;
  material_cost?: string | number | null;
  labor_cost?: string | number | null;
  category?: string | null;
  manufacturer?: string | null;
  style?: string | null;
  color?: string | null;
  item_no?: string | null;
}

export interface WizardAnswer {
  question_id: string;
  label: string;
  kind: "detail" | "addon";
  included: boolean;
  value: string;
  amount: string | number | null;
  // Add-ons priced by quantity × unit price, with our cost.
  quantity?: string | number | null;
  unit?: string | null;
  unit_price?: string | number | null;
  material_cost?: string | number | null;
  labor_cost?: string | number | null;
}

export interface WizardSubmit {
  title: string;
  tax_rate: string | number;
  presentation: EstimatePresentation;
  rooms: WizardRoom[];
  answers: WizardAnswer[];
}
