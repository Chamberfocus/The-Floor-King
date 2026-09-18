/**
 * Measured area vs order quantity — the distinction the rest of the CRM
 * must never blur.
 *
 * MEASURED AREA  — what was taped: rooms × sections, in square feet.
 * EQUIVALENT YD  — measured sqft ÷ 9. A conversion, NOT a carpet order.
 * BILLING QTY    — measured area expressed in the product's billing unit
 *                  (sq ft or sq yd). Still not necessarily what to buy.
 * ORDER QUANTITY — what to purchase: cuts for roll goods when entered;
 *                  measured × (1 + waste) for boxed goods; carton-rounded
 *                  only when the product actually has coverage metadata.
 *
 * Broadloom carpet and sheet vinyl are roll goods. sqft ÷ 9 is never
 * "the amount to order". Exclusive carpet tile is modular: measured + waste,
 * carton only when the product actually has coverage. Catalog category stays
 * `carpet` — we do not invent a carpet-tile category.
 */

import { billsBySquareYard, isAreaUnit, normalizeUnit, unitIsSqyd, unitLabel } from "@/lib/units";
import {
  billsBySqydFamily,
  defaultWastePctForFamily,
  familyLabel,
  isBoxedFamily,
  isRollGoodsFamily,
  rollGoodsNeedCuts,
  type FlooringFamily,
  type InstallSystem,
} from "./families";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export type QuantityKind = "measured" | "billing" | "order";

export interface MeasuredArea {
  /** Taped / calculated area in square feet. Canonical stored area. */
  sqft: number;
  /** Mathematical equivalent (sqft / 9). Never an order quantity by itself. */
  sqydEquivalent: number;
}

export interface CartonTakeoff {
  coverageSqft: number;
  cartonCount: number;
  orderedCoverageSqft: number;
}

export type OrderBasis =
  | "cuts"
  | "measured_plus_waste"
  | "measured_plus_waste_estimated"
  | "none";

export interface MaterialTakeoff {
  family: FlooringFamily;
  /** Salesperson-facing title when family is `other` (pad / foam). */
  takeoffLabel?: string;
  /** Catalog / billing unit key (sqft, sqyd, lnft, each, box…). */
  billingUnit: string;
  measured: MeasuredArea;
  wastePct: number;
  wasteSqft: number;
  /** Area after waste, before carton rounding — still square feet. */
  orderSqft: number;
  /**
   * Quantity to bill / print in `billingUnit`.
   * For sq yd this is orderSqft / 9 (or cut yards when basis is cuts).
   */
  billingQty: number;
  orderBasis: OrderBasis;
  cartons: CartonTakeoff | null;
  notes: string[];
  warnings: string[];
}

export function measuredArea(sqft: number): MeasuredArea {
  const n = Number.isFinite(sqft) && sqft > 0 ? r2(sqft) : 0;
  return { sqft: n, sqydEquivalent: r2(n / 9) };
}

export function equivalentSqyd(sqft: number): number {
  return measuredArea(sqft).sqydEquivalent;
}

export function sqydToSqft(sqyd: number): number {
  const n = Number.isFinite(sqyd) ? sqyd : 0;
  return r2(n * 9);
}

/** True when this roll-goods family has entered cuts that own the order qty. */
export function rollGoodsHaveCuts(
  family: FlooringFamily,
  cutsSqft: number | null | undefined,
  carpetInstallSystems?: InstallSystem[] | null,
): boolean {
  const cuts = Number(cutsSqft);
  return (
    rollGoodsNeedCuts(family, carpetInstallSystems) &&
    Number.isFinite(cuts) &&
    cuts > 0
  );
}

/**
 * Whether taped / measured area may become a Builder MATERIAL line.
 * Broadloom / sheet vinyl: never. sq ft ÷ 9 is equivalent area, not an order.
 * Exclusive carpet tile is modular — measured area may become the material
 * line (carton only when coverage exists). Count-unit catalog items (gal /
 * each / bag / kit of adhesive): never — taped sq ft is not gallons of glue.
 * Family "other" with no unit: never — missing metadata is TBD, not sq ft.
 * Boxed hard surface billed by area: yes.
 */
export function areaDerivedMaterialAllowed(
  family: FlooringFamily,
  productUnit?: string | null,
  carpetInstallSystems?: InstallSystem[] | null,
): boolean {
  if (rollGoodsNeedCuts(family, carpetInstallSystems)) return false;
  const raw = productUnit == null ? "" : String(productUnit).trim();
  if (raw && !isAreaUnit(raw)) return false;
  // other/trim/labor SKUs with no unit are TBD, not taped square feet.
  if (family === "other" && !raw) return false;
  return true;
}

/**
 * Quantity that would be written onto a Builder material line from taped area.
 * Returns null for roll goods so callers cannot accidentally store sqft ÷ 9
 * as the order. Returns null for count-unit products so gallons/kits are not
 * invented from square feet.
 */
export function areaDerivedMaterialQty(args: {
  family: FlooringFamily;
  measuredSqft: number;
  billingUnit: "sqyd" | "sqft";
  productUnit?: string | null;
  carpetInstallSystems?: InstallSystem[] | null;
}): number | null {
  if (!areaDerivedMaterialAllowed(args.family, args.productUnit, args.carpetInstallSystems)) {
    return null;
  }
  const n = Number(args.measuredSqft);
  if (!(n > 0) || !Number.isFinite(n)) return null;
  return args.billingUnit === "sqyd" ? r2(n / 9) : r2(n);
}

/**
 * Measured sq ft that may ride onto an extra-SKU Review takeoff (and the
 * extra's own taped-area field). Count / TBD / roll-goods extras return
 * null — leftover typed square feet is not pad yards, not foam feet, and
 * not an order. Do not invent a 30-yard roll.
 */
export function extraMeasuredSqftForTakeoff(args: {
  family: FlooringFamily;
  productUnit?: string | null;
  measuredSqft: number;
  carpetInstallSystems?: InstallSystem[] | null;
}): number | null {
  if (!areaDerivedMaterialAllowed(args.family, args.productUnit, args.carpetInstallSystems)) {
    return null;
  }
  const n = Number(args.measuredSqft);
  if (!(n > 0) || !Number.isFinite(n)) return null;
  return r2(n);
}

/**
 * Extra SKU sold by roll / each / gal / lnft / bag. Empty unit stays TBD —
 * do not invent "each". Area-unit extras still use measured sq ft. Roll
 * goods still wait for cuts. Do not convert leftover taped sq ft or a
 * 30-yard pad roll into this count.
 */
export function extraAsksCountQty(args: {
  family: FlooringFamily;
  productUnit?: string | null;
  carpetInstallSystems?: InstallSystem[] | null;
}): boolean {
  if (areaDerivedMaterialAllowed(args.family, args.productUnit, args.carpetInstallSystems)) {
    return false;
  }
  if (rollGoodsNeedCuts(args.family, args.carpetInstallSystems)) return false;
  const raw = args.productUnit == null ? "" : String(args.productUnit).trim();
  if (!raw) return false;
  if (isAreaUnit(raw)) return false;
  return true;
}

/**
 * Typed How many for a count extra. Missing / zero qty is not an order —
 * callers emit TBD instead of inventing 1 roll or leftover sq ft.
 */
export function extraCountQtyForEmit(args: {
  family: FlooringFamily;
  productUnit?: string | null;
  qty: number;
  carpetInstallSystems?: InstallSystem[] | null;
}): { quantity: number; unit: string } | null {
  if (!extraAsksCountQty(args)) return null;
  const n = Number(args.qty);
  if (!(n > 0) || !Number.isFinite(n)) return null;
  const unit = unitLabel(args.productUnit) || String(args.productUnit ?? "").trim();
  if (!unit) return null;
  return { quantity: r2(n), unit };
}

/**
 * Whether install labor may be billed from measured area on the floor-map /
 * product path. Roll goods with cuts: no — the cuts step already emits
 * install against cut yardage. Roll goods without cuts: yes — install is
 * measured work, not an order quantity.
 */
export function measuredInstallLaborAllowed(
  family: FlooringFamily,
  cutsSqft?: number | null,
  carpetInstallSystems?: InstallSystem[] | null,
): boolean {
  return !rollGoodsHaveCuts(family, cutsSqft, carpetInstallSystems);
}

/**
 * Install labor $/yd or $/ft from the product, else the question's Settings
 * rate. Missing config is 0 — never invent $6/yd or $2/ft.
 */
export function configuredInstallRate(args: {
  billing: "yd" | "ft";
  config?: { install_yd?: number | null; install_ft?: number | null } | null;
  productLabor?: number | null;
}): number {
  const fromProduct = Number(args.productLabor);
  if (Number.isFinite(fromProduct) && fromProduct > 0) return fromProduct;
  const raw = args.billing === "yd" ? args.config?.install_yd : args.config?.install_ft;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Waste that may ride onto an emitted material LINE.
 * Roll goods without cuts: 0 — layout waste lives in the cut list, not a %.
 * Exclusive carpet tile uses the requested / family waste like boxed goods.
 */
export function materialWastePctForEmit(args: {
  family: FlooringFamily;
  cutsSqft?: number | null;
  requestedWastePct: number;
  carpetInstallSystems?: InstallSystem[] | null;
}): number {
  if (rollGoodsHaveCuts(args.family, args.cutsSqft, args.carpetInstallSystems)) return 0;
  if (rollGoodsNeedCuts(args.family, args.carpetInstallSystems)) return 0;
  const n = Number(args.requestedWastePct);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Carton math. Returns null when coverage is missing or non-positive —
 * we do not invent a box size.
 */
export function cartonTakeoff(
  orderSqft: number,
  sqftPerBox: number | null | undefined,
): CartonTakeoff | null {
  const cov = Number(sqftPerBox);
  if (!(cov > 0) || !(orderSqft > 0)) return null;
  const cartonCount = Math.ceil(orderSqft / cov);
  return {
    coverageSqft: r4(cov),
    cartonCount,
    orderedCoverageSqft: r2(cartonCount * cov),
  };
}

export interface ComputeTakeoffInput {
  family: FlooringFamily;
  measuredSqft: number;
  /** Override the family default waste. Empty/undefined → family default. */
  wastePct?: number | null;
  /**
   * Sum of entered carpet/sheet cuts in square feet. When > 0 on roll goods,
   * this IS the order quantity (waste already in the layout).
   */
  cutsSqft?: number | null;
  /** Product `sqft_per_box` — only used when actually present. */
  sqftPerBox?: number | null;
  /**
   * Carpet-install systems only. Exclusive carpet_tile uses measured + waste
   * (carton if coverage exists). Unanswered / glue-down / stretch-in stay
   * roll goods. Hard-surface glue must not be passed here.
   */
  carpetSystems?: InstallSystem[] | null;
  /** When true, skip waste even without cuts (explicit 0 on the line). */
  wasteAlreadyInQuantity?: boolean;
  /**
   * Override family billing. Pad (`carpet_pad`) is sq yd unless the SKU is
   * feet; foam (`hs_underlayment`) is sq ft unless the SKU is yards. Family
   * `other` is not roll goods — do not invent a 30-yard roll.
   */
  billingUnit?: "sqft" | "sqyd" | null;
  /** Review title when family is `other` (Carpet pad / Underlayment). */
  takeoffLabel?: string | null;
}

/** Review title for pad / foam. Catalog underlayment still maps to family `other`. */
export function padFoamTakeoffLabel(args: {
  key?: string | null;
  category?: string | null;
}): string | undefined {
  const key = (args.key ?? "").trim();
  if (key === "hs_underlayment") return "Underlayment";
  if (key === "carpet_pad") return "Carpet pad";
  if ((args.category ?? "").trim().toLowerCase() === "underlayment") return "Carpet pad";
  return undefined;
}

export function takeoffDisplayTitle(
  t: Pick<MaterialTakeoff, "family" | "takeoffLabel">,
): string {
  const custom = (t.takeoffLabel ?? "").trim();
  if (custom) return custom;
  return familyLabel(t.family);
}

/**
 * One function for "how much do we measure vs how much do we buy".
 */
export function computeMaterialTakeoff(input: ComputeTakeoffInput): MaterialTakeoff {
  const family = input.family;
  const measured = measuredArea(input.measuredSqft);
  const notes: string[] = [];
  const warnings: string[] = [];
  const billingUnit: "sqft" | "sqyd" =
    input.billingUnit === "sqyd" || input.billingUnit === "sqft"
      ? input.billingUnit
      : billsBySqydFamily(family)
        ? "sqyd"
        : "sqft";
  const takeoffLabel = (input.takeoffLabel ?? "").trim() || undefined;

  const cuts = Number(input.cutsSqft);
  const hasCuts = rollGoodsHaveCuts(family, input.cutsSqft, input.carpetSystems);
  const needCuts = rollGoodsNeedCuts(family, input.carpetSystems);
  // Family other is not roll goods and not boxed unless the SKU actually has
  // carton coverage. Do not invent a 30-yard pad roll.
  const boxedLike =
    isBoxedFamily(family) ||
    (family === "carpet" && !needCuts) ||
    (family === "other" && Number(input.sqftPerBox) > 0 && !needCuts);

  let wastePct: number;
  let orderSqft: number;
  let orderBasis: OrderBasis;

  if (measured.sqft <= 0 && !hasCuts) {
    return {
      family,
      takeoffLabel,
      billingUnit,
      measured,
      wastePct: 0,
      wasteSqft: 0,
      orderSqft: 0,
      billingQty: 0,
      orderBasis: "none",
      cartons: null,
      notes,
      warnings,
    };
  }

  if (hasCuts) {
    // Cuts are the professional order quantity. Do not add a second waste
    // factor — layout waste is already in the pieces.
    wastePct = 0;
    orderSqft = r2(cuts);
    orderBasis = "cuts";
    notes.push(
      "Order quantity comes from the entered cuts, not from converting measured square feet into yards.",
    );
    if (measured.sqft > 0 && Math.abs(orderSqft - measured.sqft) > 0.5) {
      notes.push(
        `Measured area ${measured.sqft} sq ft (${measured.sqydEquivalent} sq yd equivalent) vs cut area ${orderSqft} sq ft (${r2(orderSqft / 9)} sq yd).`,
      );
    }
  } else if (needCuts) {
    // sq ft ÷ 9 is equivalent area, not an order. Do not invent layout waste
    // or a purchase quantity until cuts exist. Exclusive carpet tile does not
    // take this branch — it is modular, not a roll cut plan.
    wastePct = 0;
    orderSqft = 0;
    orderBasis = "none";
    warnings.push(
      family === "carpet"
        ? "No cut list yet — converting sq ft ÷ 9 is equivalent area, not a professional carpet cut plan. Enter cuts (roll width × length) before ordering."
        : "No sheet layout yet — measured area is not the order quantity. Enter cuts (roll width × length) before ordering.",
    );
    notes.push("Order quantity stays TBD until cuts are entered.");
  } else {
    wastePct =
      input.wasteAlreadyInQuantity
        ? 0
        : input.wastePct != null && Number.isFinite(Number(input.wastePct))
          ? Number(input.wastePct)
          : defaultWastePctForFamily(family);
    orderSqft = r2(measured.sqft * (1 + wastePct / 100));
    orderBasis = "measured_plus_waste";
  }

  // When cuts are the basis, or roll goods have no cuts yet, waste sq ft is
  // not a separate add-on on the takeoff.
  const wasteSqftOut = orderBasis === "measured_plus_waste" ? r2(orderSqft - measured.sqft) : 0;

  const cartons = boxedLike ? cartonTakeoff(orderSqft, input.sqftPerBox) : null;
  if (boxedLike && !(Number(input.sqftPerBox) > 0)) {
    notes.push("No carton coverage on this product — carton count is not invented.");
  }
  if (cartons) {
    notes.push(
      `Carton coverage ${cartons.coverageSqft} sq ft → ${cartons.cartonCount} carton${cartons.cartonCount === 1 ? "" : "s"} (${cartons.orderedCoverageSqft} sq ft ordered).`,
    );
  }

  const billedSqft = cartons ? cartons.orderedCoverageSqft : orderSqft;
  const billingQty = billingUnit === "sqyd" ? r2(billedSqft / 9) : r2(billedSqft);

  if (family === "other" && orderBasis === "measured_plus_waste") {
    notes.push(
      billingUnit === "sqyd"
        ? "Billing is square yards from measured area — not a 30-yard roll."
        : "Billing is square feet from measured area — not pad yards and not a 30-yard roll.",
    );
  }

  return {
    family,
    takeoffLabel,
    billingUnit,
    measured,
    wastePct,
    wasteSqft: wasteSqftOut,
    orderSqft: cartons ? cartons.orderedCoverageSqft : orderSqft,
    billingQty,
    orderBasis,
    cartons,
    notes,
    warnings,
  };
}

/** Human labels that never mix sq ft with sq yd. */
export function formatSqft(n: number): string {
  return `${r2(n)} sq ft`;
}

export function formatSqyd(n: number): string {
  return `${r2(n)} sq yd`;
}

/** sq ft ÷ 9 labeled as equivalent area so it cannot be read as an order. */
export function formatEquivalentSqyd(sqft: number): string {
  return `${formatSqyd(equivalentSqyd(sqft))} equivalent area — not an order qty`;
}

/**
 * Builder fallback when the sq ft field is shown without warehouse cuts.
 * Hard-surface boxed lines may still type sq ft as the order. Roll goods
 * without cuts must never read that field as "enter the order in sq ft".
 */
export function builderAreaFallbackLabel(opts: {
  isRollGood: boolean;
  hasWarehouseCuts: boolean;
}): string {
  if (opts.isRollGood && !opts.hasWarehouseCuts) {
    return "Measured sq ft (not the order)";
  }
  return "Or enter sq ft directly";
}

/** Caption under the Builder measured-sq-ft field when roll cuts are missing. */
export const ROLL_GOODS_CUTS_MISSING_CAPTION =
  "Order TBD until you enter warehouse cuts (width × length). Sq ft ÷ 9 is equivalent area, not a cut plan.";

/** Builder warehouse-cuts panel — this list is the ORDER, not taped room sq ft. */
export const ROLL_GOODS_CUTS_HEADER = "Warehouse cuts (the order)";

export const ROLL_GOODS_CUTS_EMPTY_HINT =
  "Each cut (width × length) is the order. Measured room sq ft is not a cut plan. Width stays empty until you type it or tap a chip — we do not plant 12'.";

export function lineMeasurementsRollTotalLabel(totalSqft: number): string {
  const n = Number(totalSqft);
  if (!Number.isFinite(n) || n <= 0) return "Order TBD — not measured sq ft";
  return `${formatSqft(n)} · ${formatSqyd(equivalentSqyd(n))} from cuts (the order)`;
}

/** Per-group cuts total in Guided Estimate. Empty width is TBD, not 0 yards. */
export function questionnaireCutGroupOrderLabel(orderSqyd: number): string {
  const n = Number(orderSqyd);
  if (!Number.isFinite(n) || n <= 0) {
    return "Order TBD — width × length, not measured sq ft ÷ 9";
  }
  return `${r2(n)} sq yd to order (from cuts)`;
}

/** Grand cuts total in Guided Estimate. 0 yards is TBD, not an order of zero. */
export function questionnaireCutsGrandOrderLabel(
  orderSqyd: number,
  productNoun: string,
): { title: string; note: string } {
  const n = Number(orderSqyd);
  const noun = (productNoun || "Roll goods").trim() || "Roll goods";
  if (!Number.isFinite(n) || n <= 0) {
    return {
      title: `${noun} order TBD`,
      note: "Enter cuts (width × length). Sq ft ÷ 9 is not an order.",
    };
  }
  return {
    title: `${noun} to order: ${r2(n)} sq yd`,
    note: "from cuts — not measured sq ft ÷ 9",
  };
}

/**
 * Builder line description when a roll-goods SKU is picked but cuts are not
 * entered. Measured area may be noted in the text; it is never a warehouse
 * cut and must not look like `12' × 14'` (legacy parseCutsFromText).
 */
export function rollGoodsOrderTbdDescription(
  productLabel: string,
  measuredSqft?: number | null,
): string {
  const name = (productLabel || "Roll goods").trim() || "Roll goods";
  const base = `${name} — order TBD (enter cuts — not sq ft ÷ 9)`;
  const n = Number(measuredSqft);
  if (Number.isFinite(n) && n > 0) {
    return `${base}. Measured ${formatSqft(n)} (${formatEquivalentSqyd(n)})`;
  }
  return base;
}

export function formatMeasuredLabel(m: MeasuredArea, opts?: { showEquivalentYd?: boolean }): string {
  if (!opts?.showEquivalentYd) return formatSqft(m.sqft);
  return `${formatSqft(m.sqft)} (${formatSqyd(m.sqydEquivalent)} equivalent area — not an order quantity)`;
}

/**
 * Extra pad / foam for a specific area is MEASURED sq ft, not a 30-yard roll
 * and not the billing unit. Carpet pad bills in yards unless the SKU is feet;
 * foam (`hs_underlayment`) bills in feet unless the SKU is yards.
 */
export const EXTRA_AREA_MEASURED_LABEL = "Measured sq ft";
export const EXTRA_AREA_MEASURED_PLACEHOLDER = "measured sq ft";
export const EXTRA_AREA_MEASURED_HINT =
  "This is taped area for that extra pad — not a 30-yard roll and not the billing unit. Carpet pad bills in square yards unless the SKU is feet.";
export const EXTRA_AREA_COUNT_TBD_HINT =
  "Qty TBD in Builder (How many / Unit TBD) — not taped square feet. Do not plant leftover sq ft. Review takeoff ignores leftover taped sq ft — not pad yards. Typed How many rides onto Review as that count.";
export const EXTRA_AREA_COUNT_QTY_LABEL = "How many";
export const EXTRA_AREA_COUNT_QTY_HINT =
  "Order quantity in the SKU unit — not taped square feet and not a 30-yard roll. Review prints that count — leftover taped sq ft is still not pad yards.";

export function formatBillingQty(qty: number, unit: string): string {
  const key = normalizeUnit(unit);
  const label = unitLabel(unit) || (unit || "").trim();
  const n = r2(qty);
  if (!label) return `${n} (unit TBD)`;
  if (key === "sqyd") return `${n} ${label}`;
  if (key === "sqft") return `${n} ${label}`;
  return `${n} ${label}`;
}

/**
 * Review / job-notes line for a typed extra count. Leftover taped sq ft
 * is not pad yards and not a 30-yard roll. Missing qty stays off Review
 * (Builder still emits TBD). Do not call computeMaterialTakeoff.
 */
export function extraCountReviewLine(args: {
  family: FlooringFamily;
  productUnit?: string | null;
  qty: number;
  label?: string | null;
  carpetInstallSystems?: InstallSystem[] | null;
}): string | null {
  const counted = extraCountQtyForEmit(args);
  if (!counted) return null;
  const name = (args.label ?? "").trim() || "Extra";
  return `${name}: ${formatBillingQty(counted.quantity, counted.unit)} — not taped square feet and not a 30-yard roll`;
}

/**
 * Review line for a derived prep count (self-level bags, subfloor sheets).
 * Missing / zero qty stays off Review — do not invent a bag or a 4×8 sheet
 * from taped square feet. Builder emit still carries coverage + area so the
 * bag calculator stays live.
 */
export function prepCountReviewLine(args: {
  label?: string | null;
  qty: number;
  unit: string;
}): string | null {
  const n = Number(args.qty);
  if (!(n > 0) || !Number.isFinite(n)) return null;
  const unit = unitLabel(args.unit) || String(args.unit ?? "").trim();
  if (!unit) return null;
  const name = (args.label ?? "").trim() || "Prep";
  return `${name}: ${formatBillingQty(n, unit)} — not taped square feet`;
}

/** Printed unit key — never labels a sq ft number as sq yd or the reverse. */
export function takeoffUnitKeyLabel(unit: string | null | undefined): string {
  const key = normalizeUnit(unit);
  if (key === "sqyd") return "sq yd";
  if (key === "sqft") return "sq ft";
  return unitLabel(unit) || (unit || "").trim() || "unit TBD";
}

export type TakeoffConceptRow = {
  label: string;
  value: string;
  tone?: "muted" | "warn" | "ok";
};

function wasteConceptRow(t: MaterialTakeoff): TakeoffConceptRow {
  if (t.orderBasis === "cuts") {
    return {
      label: "Waste",
      value: "0% (layout waste is already in the entered cuts — not a second add-on)",
    };
  }
  if (t.orderBasis === "none") {
    if (t.measured.sqft > 0 && (isRollGoodsFamily(t.family) || t.family === "carpet")) {
      return {
        label: "Waste",
        value: "0% (not invented from sq ft ÷ 9 — layout waste lives in the cut list)",
        tone: "muted",
      };
    }
    return { label: "Waste", value: "0%" };
  }
  return {
    label: "Waste",
    value: t.wastePct ? `${t.wastePct}% (${formatSqft(t.wasteSqft)})` : "0%",
  };
}

function orderConceptRow(t: MaterialTakeoff): TakeoffConceptRow {
  if (t.orderBasis === "none") {
    if (t.measured.sqft > 0 && (isRollGoodsFamily(t.family) || t.family === "carpet")) {
      return {
        label: "Order quantity",
        value: "TBD — enter cuts (sq ft ÷ 9 is not an order)",
        tone: "warn",
      };
    }
    return { label: "Order quantity", value: "TBD", tone: "warn" };
  }
  if (t.orderBasis === "cuts") {
    return {
      label: "Order quantity",
      value: `${formatSqft(t.orderSqft)} · ${formatSqyd(t.billingQty)} (from cuts — not sq ft ÷ 9)`,
      tone: "ok",
    };
  }
  if (t.cartons) {
    const n = t.cartons.cartonCount;
    return {
      label: "Order quantity",
      value: `${formatSqft(t.cartons.orderedCoverageSqft)} (${n} carton${n === 1 ? "" : "s"} @ ${t.cartons.coverageSqft} sq ft)`,
      tone: "ok",
    };
  }
  const order =
    t.billingUnit === "sqyd"
      ? `${formatSqft(t.orderSqft)} · ${formatSqyd(t.billingQty)}`
      : formatSqft(t.orderSqft);
  return {
    label: "Order quantity",
    value:
      t.orderBasis === "measured_plus_waste_estimated"
        ? `${order} (estimate — not a cut plan)`
        : order,
    tone: t.orderBasis === "measured_plus_waste_estimated" ? "warn" : "ok",
  };
}

function billingConceptRow(t: MaterialTakeoff): TakeoffConceptRow {
  if (t.orderBasis === "none") {
    const equiv =
      t.billingUnit === "sqyd" && t.measured.sqydEquivalent > 0
        ? `TBD — not ${formatSqyd(t.measured.sqydEquivalent)} from taped area`
        : "TBD";
    return { label: "Billing quantity", value: equiv, tone: "warn" };
  }
  const key = normalizeUnit(t.billingUnit);
  const qty = formatBillingQty(t.billingQty, t.billingUnit);
  if (key === "sqyd") {
    return {
      label: "Billing quantity",
      value: `${qty} (this number is yards, not square feet)`,
    };
  }
  if (key === "sqft") {
    return {
      label: "Billing quantity",
      value: `${qty} (this number is square feet, not yards)`,
    };
  }
  return { label: "Billing quantity", value: qty || "TBD", tone: qty ? undefined : "warn" };
}

function unitConceptRow(t: MaterialTakeoff): TakeoffConceptRow {
  const key = normalizeUnit(t.billingUnit);
  if (key === "sqyd") {
    return {
      label: "Unit of measure",
      value: "sq yd — billed by the yard. Taped sq ft is measured area, not an order.",
    };
  }
  if (key === "sqft") {
    return {
      label: "Unit of measure",
      value: "sq ft — this job bills in square feet, not yards.",
    };
  }
  return {
    label: "Unit of measure",
    value: takeoffUnitKeyLabel(t.billingUnit),
  };
}

/**
 * Salesperson review takeoff — MEASURED / WASTE / ORDER / BILLING / UNIT
 * are always separate rows. Never omit billing on a sq-ft hard-surface job,
 * and never print taped sq ft ÷ 9 as a yard order.
 */
export function takeoffConceptRows(t: MaterialTakeoff): TakeoffConceptRow[] {
  const rows: TakeoffConceptRow[] = [
    {
      label: "Measured area",
      value: formatMeasuredLabel(t.measured, { showEquivalentYd: t.billingUnit === "sqyd" }),
    },
    wasteConceptRow(t),
  ];
  if (t.cartons) {
    rows.push({
      label: "Carton coverage",
      value: `${t.cartons.coverageSqft} sq ft`,
    });
    rows.push({
      label: "Required cartons",
      value: String(t.cartons.cartonCount),
    });
  }
  rows.push(orderConceptRow(t));
  rows.push(billingConceptRow(t));
  rows.push(unitConceptRow(t));
  for (const n of t.notes) rows.push({ label: "Note", value: n, tone: "muted" });
  return rows;
}

/**
 * One-line running takeoff. Measured / waste / order / billing / unit stay
 * labeled as themselves. Never prints a sq ft number with a "sq yd" unit
 * or the reverse.
 */
export function formatTakeoffStrip(t: MaterialTakeoff): string {
  const bits: string[] = [];
  for (const row of takeoffConceptRows(t)) {
    if (
      row.label === "Note" ||
      row.label === "Carton coverage" ||
      row.label === "Required cartons"
    ) {
      continue;
    }
    if (row.label === "Measured area") bits.push(`Measured ${row.value}`);
    else if (row.label === "Waste") bits.push(`Waste ${row.value}`);
    else if (row.label === "Order quantity") bits.push(`Order ${row.value}`);
    else if (row.label === "Billing quantity") bits.push(`Billing ${row.value}`);
    else if (row.label === "Unit of measure") bits.push(`Unit ${takeoffUnitKeyLabel(t.billingUnit)}`);
  }
  return bits.join(" · ");
}

/**
 * Canonical accessory unit from the trim *type*.
 * T-mold must not match generic "mold" and become linear feet.
 * Quarter round / shoe / base are never square feet.
 */
export function accessoryUnitForType(type: string): "lnft" | "each" {
  const t = type || "";
  if (
    /t-?mold|reducer|end\s*cap|threshold|stair\s*nose|tread|riser|vent|register|transition|metal|gripper/i.test(
      t,
    )
  ) {
    return "each";
  }
  if (/base|shoe|quarter|cove|j-?channel|tack/i.test(t)) return "lnft";
  if (/mold/i.test(t)) return "lnft";
  return "each";
}

/**
 * Force a trim line onto lnft / each / pc. Area units (sq ft / sq yd) are
 * never valid for quarter round, shoe, base, or transitions.
 */
export function coerceTrimUnit(
  type: string,
  unit: string | null | undefined,
): "lnft" | "each" | "pc" {
  const locked = accessoryUnitForType(type);
  const key = normalizeUnit(unit);
  // Blank or area units are never valid on trim — lock to the type's unit.
  if (!key || key === "sqft" || key === "sqyd") return locked;
  if (locked === "lnft") {
    if (key === "pc" || key === "each" || key === "lnft") return key;
    return "lnft";
  }
  if (key === "pc") return "pc";
  return "each";
}

/**
 * Width actually entered on a cut row. Empty / zero is not a 12' or 6' roll.
 * Catalog `roll_width_ft` or a chip click may fill the input; family chips
 * must not be re-applied at emit when the salesperson left the field empty.
 */
export function enteredCutWidthFt(raw: number | string | null | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Catalog roll width for a cut row, or 0.
 *
 * Product `roll_width_ft` wins when it is actually on the catalog row.
 * Family 12'/6' values are editor chips only — never planted as the
 * starting width or as an order quantity.
 */
export function defaultCutWidthFt(opts: {
  family: FlooringFamily;
  productWidthFt?: number | null;
  configWidths?: number[] | null;
}): number {
  const fromProduct = Number(opts.productWidthFt);
  if (Number.isFinite(fromProduct) && fromProduct > 0) return fromProduct;
  return 0;
}

/** Width chips: question config + the product's real roll width when present. */
export function cutWidthChoicesFt(opts: {
  family: FlooringFamily;
  productWidthFt?: number | null;
  configWidths?: number[] | null;
}): number[] {
  const base =
    opts.configWidths && opts.configWidths.length
      ? opts.configWidths.filter((n) => Number.isFinite(n) && n > 0)
      : opts.family === "vinyl"
        ? [6, 12]
        : [12, 15];
  const extra = Number(opts.productWidthFt);
  const out = [...base];
  if (Number.isFinite(extra) && extra > 0 && !out.includes(extra)) out.push(extra);
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * Billing unit for a catalog category — delegates to units.ts so sheet vinyl
 * cannot drift back to square feet.
 *
 * Underlayment is mixed (pad yards, foam feet). Prefer `areaBillsBySquareYard`
 * when the question key or SKU unit is known. Do not drop underlayment from
 * SQYD_CATEGORIES to "fix" foam — that would plant square feet on carpet pad.
 */
export function billingUnitForCategory(category: string | null | undefined): "sqft" | "sqyd" {
  return billsBySquareYard(category) ? "sqyd" : "sqft";
}

/**
 * Whether this line bills taped area in square yards.
 *
 * Product area unit wins when the SKU actually stores sq yd or sq ft.
 * `hs_underlayment` (laminate / LVP foam) is square feet unless the SKU is yards.
 * `carpet_pad` is square yards unless the SKU is feet.
 * Unkeyed underlayment still follows SQYD_CATEGORIES (pad yards) — do not
 * invent a 30-yard foam roll, and do not guess mixed-job unkeyed SKUs.
 */
export function areaBillsBySquareYard(args: {
  category?: string | null;
  key?: string | null;
  productUnit?: string | null;
}): boolean {
  if (unitIsSqyd(args.productUnit)) return true;
  if (normalizeUnit(args.productUnit) === "sqft") return false;
  const key = (args.key ?? "").trim();
  if (key === "hs_underlayment") return false;
  if (key === "carpet_pad") return true;
  return billsBySquareYard(args.category);
}

export function billingUnitForArea(args: {
  category?: string | null;
  key?: string | null;
  productUnit?: string | null;
}): "sqft" | "sqyd" {
  return areaBillsBySquareYard(args) ? "sqyd" : "sqft";
}

export { r2 as round2 };
