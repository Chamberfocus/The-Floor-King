"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { catalogRateToBillingUnit, isAreaUnit, lineDisplayUnit, pickedProductUnit, unitLabel } from "@/lib/units";
import { productLabel } from "@/lib/product-label";
import { catalogRateInLineUnit, catalogUnitCost, PRICE_NEEDED } from "@/lib/catalog-pricing";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Plus,
  Trash2,
  Sparkles,
  Ruler,
  ListChecks,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import {
  sellLaborFromTargetMargin,
  sellMaterialFromTargetMargin,
} from "@/lib/estimate-pricing";
import {
  linearFeetForPieces,
  piecesForLinearFeet,
  resolvedPieceLengthIn,
  TYPICAL_PIECE_LENGTH_IN,
  variesByRun,
} from "@/lib/accessories";
import { profileFor } from "@/lib/flooring-profiles";
import { carpetYardageFromCuts, stairsCarpet, subfloorSheets, resolvedSheetSqft } from "@/lib/questionnaire-calc";
import {
  questionnaireEmitToLineQty,
  smartLineToCalcLine,
} from "@/lib/questionnaire-emit";
import { lineTotal } from "@/lib/estimate-calc";
import { bagsNeeded, selfLevelPourThicknessIn, thicknessLabel } from "@/lib/floor-prep";
import type { Product, EstimateQuestion, EstimateEmit, CustomerArea } from "@/lib/types";
import { isRollGoodCategory } from "@/lib/types";
import {
  catalogCategoryForFamily,
  coerceTrimUnit,
  accessoryUnitForType,
  cutWidthChoicesFt,
  defaultCutWidthFt,
  enteredCutWidthFt,
  rollGoodsOrderTbdDescription,
  questionnaireCutGroupOrderLabel,
  questionnaireCutsGrandOrderLabel,
  computeMaterialTakeoff,
  padFoamTakeoffLabel,
  takeoffDisplayTitle,
  billingUnitForArea,
  emptyInstallContext,
  familyFromCatalogCategory,
  formatDimensionPair,
  formatMeasuredLabel,
  EXTRA_AREA_MEASURED_LABEL,
  EXTRA_AREA_MEASURED_PLACEHOLDER,
  EXTRA_AREA_MEASURED_HINT,
  EXTRA_AREA_COUNT_TBD_HINT,
  EXTRA_AREA_COUNT_QTY_LABEL,
  EXTRA_AREA_COUNT_QTY_HINT,
  formatSqft,
  formatSqyd,
  formatTakeoffStrip,
  familyLabel,
  hardwoodConstructionFromSpecies,
  installContextFromValByKey,
  withProductFamilies,
  hardSurfaceInstallMethodOptions,
  jobNeedsMixedInstallMethodPicks,
  isHardSurfaceFamily,
  isRollGoodsFamily,
  carpetInstallSystemsFromLabels,
  rollGoodsNeedCuts,
  materialWastePctForEmit,
  rollGoodsHaveCuts,
  areaBillsBySquareYard,
  areaDerivedMaterialAllowed,
  boxedCartonAreaTakeoffAllowed,
  boxedCartonCoverageTbdDescription,
  areaDerivedMaterialQty,
  extraMeasuredSqftForTakeoff,
  extraAsksCountQty,
  extraCountQtyForEmit,
  extraCountReviewLine,
  prepCountReviewLine,
  measuredInstallLaborAllowed,
  configuredInstallRate,
  rollGoodsSeamWarnings,
  measuredRectsFromRooms,
  knowledgeHelpFor,
  knowledgeWarnings,
  amountUnitLabelForQuestion,
  resolveQuestionVisibility,
  questionPurpose,
  reviewToJobNotes,
  buildSalespersonReview,
  sortEstimateQuestions,
  estimatorPhaseForQuestion,
  estimatorPhaseLabel,
  questionPhaseMap,
  prepQuantitiesAreFinal,
  answerGateValues,
  coerceYesNoChoiceAnswer,
  groupMeasuredSqftByLabel,
  groupMeasuredSqftByFamily,
  measuredSqftForFamilyTakeoff,
  measuredSqftForQuestionCover,
  roomsAssignedToFamilies,
  roomsForPrepTakeoff,
  emitAreaSqftForQuestion,
  deliveryAddonCost,
  reviewBucketForQuestion,
  prepQuantitySuffix,
  stairStepCountFromAnswers,
  applyHardSurfaceStairTrimFill,
  jobNeedsHardSurfaceStairTrim,
  jobIsExclusiveWallTile,
  choiceOptionApplies,
  answersHaveTrimType,
  keyedChoiceSelections,
  trimLabelsFromPicks,
  applyTrimTypeSeed,
  presentTrimTypes,
  HS_TRANSITION_OPTION_TO_TRIM,
  HS_BASE_OPTION_TO_TRIM,
  annotateRemovalDescription,
  type InstallContext,
  type ReviewRoom,
  type FlooringFamily,
} from "@/lib/flooring-knowledge";
import { AreaCalculator } from "@/components/area-calculator";
import { ProductPicker, type CustomProductInput } from "./product-picker";
import {
  createSmartEstimate,
  saveEstimateDraft,
  deleteEstimateDraft,
  type SmartLine,
  type EstimateDraft,
} from "./smart-actions";
import { replaceCustomerAreas } from "@/app/(app)/customers/[id]/area-actions";

const numv = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

// Which categories bill by the square yard is decided in ONE place now
// (src/lib/units.ts). Underlayment is mixed — pad yards, foam feet — so
// Guided Estimate asks areaBillsBySquareYard (question key + SKU unit)
// instead of treating every pad/foam SKU as square yards.
function billing(args: { category: string; key?: string | null; productUnit?: string | null }) {
  const wantYd = areaBillsBySquareYard(args);
  return { wantYd, measureUnit: wantYd ? ("sqyd" as const) : ("sqft" as const), unitLabel: wantYd ? "sq yd" : "sq ft" };
}
/** Convert a catalog product's per-unit rate to the line's billing unit.
 * Catalog box rate onto an area line is $/coverage, not 1:1.
 * Wrap / count How many stays 1:1 — omit boxedProduct.
 * Do not invent coverage. */
function rateFor(
  rate: number,
  productUnit: string | null,
  wantYd: boolean,
  boxedProduct?: { category?: string | null; sqft_per_box?: number | string | null } | null,
): number {
  if (boxedProduct) {
    return catalogRateInLineUnit(
      rate,
      {
        unit: productUnit,
        category: boxedProduct.category,
        sqft_per_box: boxedProduct.sqft_per_box,
      },
      wantYd,
    );
  }
  return catalogRateToBillingUnit(rate, productUnit, wantYd);
}
// --- Answer shapes ---------------------------------------------------------
// A measured area: length × width in feet + inches. `override` (from the
// multi-shape calculator) wins over L×W when set.
interface AreaSection {
  id: string;
  name: string;
  lf: string; li: string;
  wf: string; wi: string;
}
interface AreaRow {
  id: string;
  name: string;
  lf: string; li: string; // length feet / inches (used when there are no extra sections)
  wf: string; wi: string; // width feet / inches
  override: string; // total sq ft from the area calculator (irregular rooms)
  differs: boolean; // this room needs different prep than the job default
  sections?: AreaSection[];
}
const feetIn = (ft: string, inch: string) => numv(ft) + numv(inch) / 12;
const sectionSqft = (s: Pick<AreaSection, "lf" | "li" | "wf" | "wi">): number =>
  r2(feetIn(s.lf, s.li) * feetIn(s.wf, s.wi));
const rowSqft = (r: AreaRow): number => {
  if (numv(r.override) > 0) return numv(r.override);
  const extra = (r.sections ?? []).filter((s) => sectionSqft(s) > 0);
  if (extra.length) {
    const primary = sectionSqft({ lf: r.lf, li: r.li, wf: r.wf, wi: r.wi });
    return r2(primary + extra.reduce((t, s) => t + sectionSqft(s), 0));
  }
  return r2(feetIn(r.lf, r.li) * feetIn(r.wf, r.wi));
};
interface ProductAns {
  productId: string; label: string; unit: string;
  category: string | null;   // catalog category → per-product billing (yd vs ft)
  materialRate: number; laborRate: number;
  manufacturer: string | null; style: string | null; color: string | null;
  supplierName: string | null;
  source: "order" | "stock"; vendor: string;
  wastePct: string;   // raw input; "" = use the category default waste
  sqftPerBox: string; // raw input; sq ft per carton → box count (display)
  pieceLengthIn: number | null; // accessories sold by the piece: stick length → lnft ÷ this = pieces
  /** Catalog roll width in feet — drives cut defaults when present. */
  rollWidthFt: number | null;
  /** Hardwood species/construction text from the catalog, when present. */
  species: string | null;
}
/** Extra pad/foam for a specific area. `sqft` is MEASURED area, not the order.
 *  `qty` is How many in the SKU unit for count extras — never leftover sq ft. */
interface ExtraPad { id: string; product: ProductAns | null; sqft: string; qty?: string }
/** One demo type + the area it covers (repeatable "demo" step). */
interface DemoRow { id: string; option: string; sqft: string }
/** One trim/molding line — a quick-picked type with color/size, and an optional
 *  specific catalog product. */
interface TrimRow {
  id: string;
  type: string; // e.g. "Baseboard", "J-channel"
  qty: string;
  unit: string; // lnft | each | pc
  cost: string; // raw input — material $/unit (catalog or typed; never a hidden chip price)
  color: string;
  size: string;
  sized: boolean; // show the size field (J-channel, stair nose, baseboard…)
  source: "order" | "stock";
  product: ProductAns | null; // set only when you attach a specific catalog item
  linearFt?: string; // piece-sold accessories: the run you measured, before rounding to sticks
  rr?: boolean; // baseboard / shoe: remove & re-install existing (adds labor per ln ft)
  rrRate?: string; // raw input — R&R labor $/ln ft (typed; do not invent $1.50)
}

// R&R applies to wall base that gets pulled and re-set during a floor job.
const isRnREligible = (type: string): boolean => /base|shoe/i.test(type);
// A matching stairnose: source Versatrim first, else the flooring manufacturer.
const isStairnose = (type: string): boolean => /stair\s*nose/i.test(type);

/**
 * The stick length of an accessory sold by the piece, or null when the row is
 * billed by the linear foot or the catalog has no length. Vendors sell some
 * trim as pre-cut sticks, so a measured run rounds UP into whole pieces —
 * only when `piece_length_in` is actually on the product. Missing length
 * stays TBD; we do not invent 94".
 */
const pieceLenFor = (row: TrimRow): number | null => {
  if (!row.product) return null;
  const u = (row.product.unit || "").toLowerCase();
  if (u !== "each" && u !== "pc") return null;
  return resolvedPieceLengthIn(row.product.pieceLengthIn);
};

/** Count-unit label on TBD identity lines. Missing unit is TBD, not invented "each". */
const countUnitForTbd = (raw: string | null | undefined): { unit: string; phrase: string } => {
  const u = unitLabel(raw) || (raw ?? "").trim();
  return u ? { unit: u, phrase: u } : { unit: "", phrase: "unit TBD" };
};

/** Capture a measured run in linear feet for each-unit moldings/transitions.
 *  Conversion to pieces happens only when stick length is known. */
const showTrimLinearFt = (row: TrimRow): boolean => {
  const unit = coerceTrimUnit(row.type, row.unit);
  if (unit !== "each" && unit !== "pc") return false;
  return variesByRun(row.type || row.product?.label || "");
};

/** The trims you click to add. Units are real (lnft / each) — prices are not.
 *  Pick a catalog item or type a rate; do not invent $1/lnft or $45/nose. */
const TRIM_TYPES: { label: string; unit: string; sized?: boolean }[] = [
  { label: "Baseboard", unit: "lnft", sized: true },
  { label: "Shoe molding", unit: "lnft" },
  { label: "Quarter round", unit: "lnft" },
  { label: "Cove base", unit: "lnft", sized: true },
  { label: "Stair nose", unit: "each", sized: true },
  { label: "Stair tread", unit: "each", sized: true },
  { label: "Stair riser", unit: "each", sized: true },
  { label: "J-channel", unit: "lnft", sized: true },
  { label: "T-mold", unit: "each" },
  { label: "Reducer", unit: "each" },
  { label: "End cap", unit: "each" },
  { label: "Threshold", unit: "each" },
  { label: "Metal transition", unit: "each" },
  { label: "Carpet transition", unit: "each" },
  { label: "Vent / register", unit: "each" },
];
// A single carpet cut: length (ft + in) off a roll of the chosen width.
interface CutRow { id: string; lf: string; li: string; width: string }
// One carpet + its cuts (supports different carpet per area).
interface CarpetGroup { id: string; area: string; product: ProductAns | null; cuts: CutRow[] }
// A run of stairs of one wrap style (allow more than one on a job).
interface StairGroup { id: string; type: string; count: string }
type Answer =
  | { kind: "areas"; rooms: AreaRow[] }
  | { kind: "floor_map"; byRoom: Record<string, ProductAns | null> }
  | { kind: "product"; product: ProductAns | null; extras: ExtraPad[]; qty?: string }
  | { kind: "trims"; rows: TrimRow[] }
  | { kind: "yesno"; yes: boolean }
  | { kind: "number"; value: string; rateIdx: number | null }
  | { kind: "choice"; selected: string[]; note?: string }
  | { kind: "choice_areas"; rows: DemoRow[] }
  | { kind: "cuts"; same: boolean; product: ProductAns | null; groups: CarpetGroup[] }
  | { kind: "stairs"; groups: StairGroup[] }
  | { kind: "hs_stairs"; steps: string; treadRiser: boolean; product: ProductAns | null; laborRate: string; qty?: string }
  | { kind: "subfloor"; thickness: string }
  | { kind: "selflevel"; thickness: string }
  | { kind: "text"; text: string };

let cgid = 0, ctid = 0, sgid = 0;
const newCutRow = (width = ""): CutRow => ({ id: `c${ctid++}`, lf: "", li: "", width });
const newCarpetGroup = (width = ""): CarpetGroup => ({ id: `g${cgid++}`, area: "", product: null, cuts: [newCutRow(width)] });
const newStairGroup = (type = "Waterfall"): StairGroup => ({ id: `s${sgid++}`, type, count: "" });

let did = 0;
const newDemoRow = (): DemoRow => ({ id: `d${did++}`, option: "", sqft: "" });
let tid = 0;
const newTrimRow = (t?: { label: string; unit: string; sized?: boolean }): TrimRow => {
  const type = t?.label ?? "";
  return {
    id: `t${tid++}`,
    type,
    qty: "",
    unit: coerceTrimUnit(type, t?.unit ?? accessoryUnitForType(type)),
    cost: "",
    color: "",
    size: "",
    sized: !!t?.sized,
    source: "order",
    product: null,
  };
};

/** Stable key for a measured room in the floor-map (survives resume — the row
 *  id is regenerated each session, so key by name, falling back to position). */
const roomKey = (name: string, i: number): string =>
  (name || "").trim().toLowerCase() || `room-${i}`;
/** Build the answer shape for a picked catalog product (defaults to Order). */
function toProductAns(p: Product): ProductAns {
  const supplier = (p as Product & { supplier?: string | null }).supplier ?? null;
  return {
    productId: p.id,
    label: productLabel(p),
    unit: pickedProductUnit(p.unit, p.category),
    category: p.category ?? null,
    materialRate: catalogUnitCost(p).amount ?? 0,
    laborRate: Number(p.labor_rate) || 0,
    manufacturer: p.manufacturer,
    style: p.style,
    color: p.color,
    supplierName: supplier,
    source: "order",
    vendor: supplier ?? "",
    wastePct: "",
    sqftPerBox: p.sqft_per_box && p.sqft_per_box > 0 ? String(p.sqft_per_box) : "",
    pieceLengthIn: p.piece_length_in ?? null,
    rollWidthFt: p.roll_width_ft && p.roll_width_ft > 0 ? p.roll_width_ft : null,
    species: p.species?.trim() || null,
  };
}
/** A one-off product typed in the picker — used on this estimate only, never
 *  saved to the catalog (no productId). */
function customToProductAns(input: CustomProductInput): ProductAns {
  const numOr0 = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  // The shared namer — this used to join manufacturer + name + colour by hand,
  // the exact formula that printed "CDC Everlasting XL Blackjack Oak Blackjack
  // Oak" across every document.
  const label = productLabel(input) || input.name.trim();
  return {
    productId: "",
    label,
    unit: pickedProductUnit(input.unit, input.category),
    category: input.category || null,
    materialRate: numOr0(input.material_rate),
    laborRate: numOr0(input.labor_rate),
    manufacturer: input.manufacturer.trim() || null,
    style: input.style.trim() || null,
    color: input.color.trim() || null,
    supplierName: null,
    source: "order",
    vendor: "",
    wastePct: "",
    sqftPerBox:
      numOr0(input.specs?.sqft_per_box) > 0 ? String(numOr0(input.specs.sqft_per_box)) : "",
    // A one-off trim needs its stick length too, or the run you measure can't
    // be turned into pieces.
    pieceLengthIn:
      input.unit === "each" || input.unit === "pc"
        ? resolvedPieceLengthIn(input.piece_length_in)
        : null,
    rollWidthFt: numOr0(input.specs?.roll_width_ft) > 0 ? numOr0(input.specs.roll_width_ft) : null,
    species: input.specs?.species?.trim() || null,
  };
}
let xpid = 0;
const newExtra = (): ExtraPad => ({ id: `x${xpid++}`, product: null, sqft: "", qty: "" });

let rid = 0;
/** The areas a flooring job actually names, in the order you'd walk a house. */
const QUICK_ROOMS = [
  "Living room",
  "Dining room",
  "Family room",
  "Bedroom",
  "Hallway",
  "Stairs",
  "Closet",
  "Office",
  "Basement",
];

/** The whole-house carpet set — the common case, in walking order. Bedroom
 *  appears four times because that's the house most people are quoting. */
const WHOLE_HOUSE = [
  "Living room",
  "Dining room",
  "Hallway",
  "Bedroom",
  "Bedroom",
  "Bedroom",
  "Bedroom",
  "Stairs",
];

/** "Bedroom 3" -> "Bedroom", so copying a numbered room re-numbers cleanly. */
const baseRoomName = (name: string): string =>
  name.replace(/\s*\d+\s*$/, "").trim() || "Area";

/**
 * The next free name for a label: first "Bedroom", then "Bedroom 2", "Bedroom 3".
 * Singles stay unnumbered — a house has one living room, and calling it
 * "Living room 1" reads like a mistake.
 */
function nextRoomName(rooms: { name: string }[], label: string): string {
  const taken = new Set(rooms.map((r) => r.name.trim().toLowerCase()));
  if (!taken.has(label.toLowerCase())) return label;
  for (let n = 2; n < 99; n++) {
    const candidate = `${label} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return label;
}

const newRow = (name = ""): AreaRow => ({
  id: `a${rid++}`, name, lf: "", li: "", wf: "", wi: "", override: "", differs: false, sections: [],
});
/** A saved customer area → an editable questionnaire row (prefill). */
const savedToRow = (sa: CustomerArea): AreaRow => {
  const hasLW = !!(sa.length_in && sa.width_in);
  return {
    id: `a${rid++}`,
    name: sa.name || "",
    lf: sa.length_in ? String(Math.floor(sa.length_in / 12)) : "",
    li: sa.length_in ? String(Math.round(sa.length_in % 12)) : "",
    wf: sa.width_in ? String(Math.floor(sa.width_in / 12)) : "",
    wi: sa.width_in ? String(Math.round(sa.width_in % 12)) : "",
    override: !hasLW && sa.sqft ? String(sa.sqft) : "",
    differs: !!sa.differs,
    sections: [],
  };
};

/**
 * Regenerate every row/group id in a RESUMED answer. The id counters reset to 0
 * on each page load, so a saved draft's ids (c0, g0…) can collide with the next
 * counter-minted id — and two rows sharing a React key edit in lockstep (typing
 * in one appears in the other). Re-keying on resume advances the counters past
 * the draft's ids so new rows are always unique.
 */
function rekeyAnswer(a: Answer): Answer {
  switch (a.kind) {
    case "areas":
      return {
        ...a,
        rooms: a.rooms.map((r) => ({
          ...r,
          id: `a${rid++}`,
          sections: (r.sections ?? []).map((s) => ({ ...s, id: `sec${rid++}` })),
        })),
      };
    case "cuts":
      return {
        ...a,
        groups: a.groups.map((g) => ({
          ...g,
          id: `g${cgid++}`,
          cuts: g.cuts.map((c) => ({ ...c, id: `c${ctid++}` })),
        })),
      };
    case "stairs":
      return { ...a, groups: a.groups.map((g) => ({ ...g, id: `s${sgid++}` })) };
    case "trims":
      return { ...a, rows: a.rows.map((r) => ({ ...r, id: `t${tid++}` })) };
    case "choice_areas":
      return { ...a, rows: a.rows.map((r) => ({ ...r, id: `d${did++}` })) };
    case "product":
      return { ...a, extras: a.extras.map((e) => ({ ...e, id: `x${xpid++}` })) };
    default:
      return a;
  }
}

/**
 * A question that produces ONLY labor (install, tear-out, haul-away, furniture,
 * door shave, toilets, appliances, demo, all-labor floor prep). In cash & carry
 * mode these are hidden — the customer buys material only. Mixed questions
 * (stairs, subfloor, self-leveler) stay; their labor is dropped at the line
 * level so their MATERIAL still comes through.
 */
function isPureLaborQuestion(q: EstimateQuestion): boolean {
  const c = (q.config ?? {}) as {
    emit?: { role?: string };
    options?: { emit?: { role?: string } }[];
  };
  if (c.emit?.role === "labor") return true;
  const opts = c.options;
  if (Array.isArray(opts) && opts.length > 0) {
    const withEmit = opts.filter((o) => o?.emit);
    if (withEmit.length > 0 && withEmit.every((o) => o.emit?.role === "labor"))
      return true;
  }
  return false;
}

export function Questionnaire({
  customerId,
  customerName,
  targetMargin,
  freightMarkupPct = 0,
  serviceAddressId,
  questions,
  savedAreas = [],
  draft = null,
  addonDefaults = {},
}: {
  customerId: string;
  customerName: string;
  targetMargin: number;
  /** Org freight % — material sell-from-margin uses landed cost. */
  freightMarkupPct?: number;
  serviceAddressId: string;
  questions: EstimateQuestion[];
  savedAreas?: CustomerArea[];
  draft?: EstimateDraft | null;
  /** Settings → Default pricing. Delivery emits only when cost > 0. */
  addonDefaults?: Record<string, { cost: number | null; unit?: string | null; labor?: boolean }>;
}) {
  const goalRaw = targetMargin;
  const goal = goalRaw > 0 && goalRaw < 100 ? goalRaw : 40;
  const sellMat = (c: number) =>
    c > 0 ? r2(sellMaterialFromTargetMargin(c, goal, freightMarkupPct)) : 0;
  const sellLab = (c: number) =>
    c > 0 ? r2(sellLaborFromTargetMargin(c, goal)) : 0;

  const buildDefaults = (): Record<string, Answer> => {
    const init: Record<string, Answer> = {};
    for (const q of questions) {
      if (q.kind === "areas")
        init[q.id] = { kind: "areas", rooms: savedAreas.length ? savedAreas.map(savedToRow) : [newRow()] };
      else if (q.kind === "floor_map") init[q.id] = { kind: "floor_map", byRoom: {} };
      else if (q.kind === "product")
        init[q.id] = q.config.trim_list
          ? { kind: "trims", rows: [] }
          : { kind: "product", product: null, extras: [], qty: "" };
      else if (q.kind === "yesno") init[q.id] = { kind: "yesno", yes: !!q.config.default };
      else if (q.kind === "number") init[q.id] = { kind: "number", value: "", rateIdx: q.config.rate_options?.length ? 0 : null };
      else if (q.kind === "choice")
        init[q.id] = q.config.per_area
          ? { kind: "choice_areas", rows: [] }
          : { kind: "choice", selected: [] };
      else if (q.kind === "cuts") {
        // Width stays empty until catalog roll_width_ft or a chip/typed value.
        // Do not plant 12' (carpet) or 6' (vinyl) as if it were measured.
        init[q.id] = {
          kind: "cuts",
          same: true,
          product: null,
          groups: [newCarpetGroup("")],
        };
      }
      else if (q.kind === "stairs")
        init[q.id] = { kind: "stairs", groups: [newStairGroup(q.config.options?.[0]?.label ?? "Waterfall")] };
      else if (q.kind === "hs_stairs")
        init[q.id] = { kind: "hs_stairs", steps: "", treadRiser: true, product: null, laborRate: "", qty: "" };
      else if (q.kind === "subfloor")
        init[q.id] = { kind: "subfloor", thickness: q.config.options?.[0]?.label ?? "" };
      else if (q.kind === "selflevel") {
        const pour = selfLevelPourThicknessIn(q.config);
        init[q.id] = { kind: "selflevel", thickness: pour > 0 ? String(pour) : "" };
      }
      else init[q.id] = { kind: "text", text: "" };
    }
    return init;
  };

  const [answers, setAnswers] = useState<Record<string, Answer>>(() => {
    const init = buildDefaults();
    // Resume: overlay a saved draft's answers onto the defaults (only for
    // questions that still exist, so a changed question set can't corrupt it).
    if (draft?.answers) {
      for (const [k, v] of Object.entries(draft.answers)) {
        if (init[k] === undefined || !v) continue;
        const q = questions.find((x) => x.id === k);
        const coerced = q ? coerceYesNoChoiceAnswer(q.kind, v) : v;
        init[k] = rekeyAnswer(coerced as Answer);
      }
    }
    return init;
  });
  const [step, setStep] = useState(draft?.step ?? 0);
  const [resumed, setResumed] = useState(!!draft);
  const [saving, startSave] = useTransition();
  const [priceCheck, setPriceCheck] = useState(false);
  // Cash & carry: materials only, no labor. Hides every labor question and drops
  // all labor from the resulting estimate lines.
  const [cashCarry, setCashCarry] = useState<boolean>(
    (draft as { cashCarry?: boolean } | undefined)?.cashCarry ?? false,
  );

  const set = (id: string, a: Answer) => setAnswers((p) => ({ ...p, [id]: a }));

  // Per-room prep overrides: overrides[roomId][questionId] = that room's answer.
  const [overrides, setOverrides] = useState<Record<string, Record<string, Answer>>>(() => {
    const raw = (draft?.overrides as Record<string, Record<string, Answer>> | undefined) ?? {};
    const out: Record<string, Record<string, Answer>> = {};
    for (const [roomId, byQ] of Object.entries(raw)) {
      const next: Record<string, Answer> = {};
      for (const [qid, ans] of Object.entries(byQ ?? {})) {
        const q = questions.find((x) => x.id === qid);
        next[qid] = (q ? coerceYesNoChoiceAnswer(q.kind, ans) : ans) as Answer;
      }
      out[roomId] = next;
    }
    return out;
  });

  // Auto-save progress (debounced) so it can be resumed from any device. The
  // first render is skipped so simply opening the page doesn't overwrite a draft.
  // Status is shown on screen so you can SEE it saving as you go (no silent loss).
  const firstSave = useRef(true);
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    setDraftStatus("saving");
    const t = setTimeout(() => {
      saveEstimateDraft(customerId, { serviceAddressId, answers, overrides, step, cashCarry })
        .then((ok) => setDraftStatus(ok ? "saved" : "error"))
        .catch(() => setDraftStatus("error"));
    }, 1200);
    return () => clearTimeout(t);
  }, [customerId, serviceAddressId, answers, overrides, step, cashCarry]);
  const startOver = () => {
    setAnswers(buildDefaults());
    setOverrides({});
    setStep(0);
    setResumed(false);
    void deleteEstimateDraft(customerId);
  };
  const setRoomOverride = (roomId: string, qid: string, a: Answer) =>
    setOverrides((p) => ({ ...p, [roomId]: { ...(p[roomId] ?? {}), [qid]: a } }));

  // Total measured area (sq ft) across every "areas" question — the quantity
  // backbone for carpet, pad, and area-based labor.
  const totalSqft = useMemo(() => {
    let s = 0;
    for (const q of questions) {
      if (q.kind !== "areas") continue;
      const a = answers[q.id];
      if (a?.kind === "areas") s += a.rooms.reduce((t, r) => t + rowSqft(r), 0);
    }
    // Carpet-only jobs skip the generic "rooms & sizes" step — the cuts are
    // entered (once) on the "Carpet & cuts" screen — so derive the pad / labor
    // area from those cuts. Only when no rooms were measured, so a mixed job's
    // hard-surface area isn't double-counted.
    if (s === 0) {
      for (const q of questions) {
        if (q.kind !== "cuts") continue;
        const a = answers[q.id];
        if (a?.kind !== "cuts") continue;
        for (const g of a.groups) {
          s += carpetYardageFromCuts(
            g.cuts.map((c) => ({ lengthFt: numv(c.lf), lengthIn: numv(c.li), rollWidthFt: numv(c.width) })),
          ).sqft;
        }
      }
    }
    return r2(s);
  }, [questions, answers]);

  // Conditional visibility: a question shows only when its `show_if` matches the
  // answer to a keyed question. Position-INDEPENDENT — we iterate to a fixed
  // point, so a gate can sit anywhere relative to the questions it reveals (a
  // hidden question's answer never counts toward another condition).
  const visible = useMemo(() => {
    const valsOf = (a: Answer | undefined): string[] => answerGateValues(a);
    // A question's gating values = its job-level answer PLUS every per-room
    // override. So a value chosen for even ONE room counts — that's how a later
    // question "recognizes" per-room detail and stops re-asking (e.g. demo
    // disposal appears only once a room actually has demo).
    const answerVal = (q: EstimateQuestion): string[] => {
      const vals = new Set(valsOf(answers[q.id]));
      for (const roomOv of Object.values(overrides)) {
        const ov = roomOv[q.id];
        if (ov) for (const v of valsOf(ov)) vals.add(v);
      }
      return [...vals];
    };
    const vis = resolveQuestionVisibility(questions, answerVal);
    // Cash & carry: hide every pure-labor question (materials only).
    if (cashCarry) for (const q of questions) if (isPureLaborQuestion(q)) vis[q.id] = false;
    return vis;
  }, [questions, answers, overrides, cashCarry]);
  const visibleQuestions = useMemo(
    () => sortEstimateQuestions(questions.filter((q) => visible[q.id])),
    [questions, visible],
  );
  const phaseById = useMemo(() => questionPhaseMap(questions), [questions]);
  const phaseName = (qq: EstimateQuestion | null | undefined) =>
    qq ? estimatorPhaseLabel(phaseById.get(qq.id) ?? estimatorPhaseForQuestion(qq)) : "";

  const flooringCtx = useMemo(() => {
    const valByKey: Record<string, string[]> = {};
    const valsOf = (a: Answer | undefined): string[] => answerGateValues(a);
    for (const q of questions) {
      if (!visible[q.id] || !q.key) continue;
      const vals = new Set(valsOf(answers[q.id]));
      for (const roomOv of Object.values(overrides)) {
        const ov = roomOv[q.id];
        if (ov) for (const v of valsOf(ov)) vals.add(v);
      }
      valByKey[q.key] = [...vals];
    }
    const ctx = installContextFromValByKey(valByKey);
    const species: string[] = [];
    const categories: Array<string | null | undefined> = [];
    const take = (p: ProductAns | null | undefined) => {
      if (p?.species) species.push(p.species);
      if (p?.category) categories.push(p.category);
    };
    for (const q of questions) {
      if (!visible[q.id]) continue;
      const a = answers[q.id];
      if (a?.kind === "product") {
        take(a.product);
        for (const x of a.extras) take(x.product);
      } else if (a?.kind === "cuts") {
        take(a.product);
        for (const g of a.groups) take(g.product);
      } else if (a?.kind === "floor_map") {
        for (const p of Object.values(a.byRoom)) take(p);
      }
    }
    for (const s of species) {
      const c = hardwoodConstructionFromSpecies(s);
      if (c !== "unknown") {
        ctx.hardwoodConstruction = c;
        break;
      }
    }
    return withProductFamilies(ctx, categories);
  }, [questions, answers, overrides, visible]);

  const hsTransitionTrims = useMemo(
    () =>
      trimLabelsFromPicks(
        keyedChoiceSelections(questions, answers, "hs_transitions"),
        HS_TRANSITION_OPTION_TO_TRIM,
      ),
    [questions, answers],
  );
  const hsBaseTrims = useMemo(
    () =>
      trimLabelsFromPicks(
        keyedChoiceSelections(questions, answers, "hs_base_trim"),
        HS_BASE_OPTION_TO_TRIM,
      ),
    [questions, answers],
  );

  const cutsSqftByCategory = useMemo(() => {
    const out: Record<string, number> = {};
    for (const q of questions) {
      if (q.kind !== "cuts" || !visible[q.id]) continue;
      const a = answers[q.id];
      if (a?.kind !== "cuts") continue;
      const cat = q.config.category === "vinyl" ? "vinyl" : "carpet";
      let s = 0;
      for (const g of a.groups) {
        s += carpetYardageFromCuts(
          g.cuts.map((c) => ({
            lengthFt: numv(c.lf),
            lengthIn: numv(c.li),
            rollWidthFt: numv(c.width),
          })),
        ).sqft;
      }
      out[cat] = r2((out[cat] ?? 0) + s);
    }
    return out;
  }, [questions, answers, visible]);
  const cutsSqft = r2((cutsSqftByCategory.carpet ?? 0) + (cutsSqftByCategory.vinyl ?? 0));
  // Prep questions that can vary by room (subfloor, demo, skim/level, moisture…).
  const perRoomQuestions = useMemo(
    () =>
      visibleQuestions.filter(
        (q) => q.config.per_room && (q.kind === "yesno" || q.kind === "choice" || q.kind === "number"),
      ),
    [visibleQuestions],
  );
  // The upfront gate: is floor prep the same for the whole job, or set per room?
  // "By room" makes the rooms step the single source for prep and removes the
  // standalone prep steps entirely (no double-asking).
  const prepByRoom = useMemo(() => {
    const gate = questions.find((q) => q.key === "prep_scope");
    const a = gate ? answers[gate.id] : undefined;
    return a?.kind === "choice" && a.selected.some((v) => /by room/i.test(v));
  }, [questions, answers]);
  // Steps the user walks: when prep is per-room, drop the per-room prep questions
  // as standalone steps (they're answered in the rooms step instead).
  const stepQuestions = useMemo(() => {
    if (!prepByRoom) return visibleQuestions;
    const ids = new Set(perRoomQuestions.map((q) => q.id));
    return visibleQuestions.filter((q) => !ids.has(q.id));
  }, [visibleQuestions, perRoomQuestions, prepByRoom]);
  // Rooms that carry their own prep. In "by room" mode every measured room does;
  // otherwise prep is whole-job and no room is per-room.
  const flaggedRooms = useMemo(() => {
    if (!prepByRoom) return [];
    const out: AreaRow[] = [];
    for (const q of questions) {
      if (q.kind !== "areas") continue;
      const a = answers[q.id];
      if (a?.kind === "areas") out.push(...a.rooms.filter((r) => rowSqft(r) > 0));
    }
    return out;
  }, [questions, answers, prepByRoom]);
  // Every measured room with its size + cut dimensions — so the flooring can be
  // itemized per room and the measurements transfer to the estimate/work order.
  const allRooms = useMemo(() => {
    const out: { name: string; sqft: number; lenIn: number | null; widIn: number | null }[] = [];
    for (const q of questions) {
      if (q.kind !== "areas") continue;
      const a = answers[q.id];
      if (a?.kind !== "areas") continue;
      for (const r of a.rooms) {
        const sf = rowSqft(r);
        if (sf <= 0) continue;
        const usingCalc = numv(r.override) > 0;
        const extra = (r.sections ?? []).filter((s) => sectionSqft(s) > 0);
        const multi = extra.length > 0;
        out.push({
          name: r.name || "",
          sqft: sf,
          lenIn: usingCalc || multi ? null : Math.round(feetIn(r.lf, r.li) * 12) || null,
          widIn: usingCalc || multi ? null : Math.round(feetIn(r.wf, r.wi) * 12) || null,
        });
      }
    }
    return out;
  }, [questions, answers]);

  // Per-room product assignment from the floor map. Mixed jobs keep carpet
  // rooms and LVP rooms separate — whole-job taped sq ft is not cloned.
  const floorMapAssignments = useMemo(() => {
    type Room = { name: string; sqft: number; lenIn: number | null; widIn: number | null };
    const rooms: { room: Room; family: ReturnType<typeof familyFromCatalogCategory> | null; category: string | null }[] = [];
    let active = false;
    for (const q of questions) {
      if (q.kind !== "floor_map" || !visible[q.id]) continue;
      const a = answers[q.id];
      if (a?.kind !== "floor_map") continue;
      active = true;
      allRooms.forEach((rm, i) => {
        const p = a.byRoom[roomKey(rm.name, i)];
        const cat = p?.category ?? null;
        rooms.push({
          room: rm,
          family: cat ? familyFromCatalogCategory(cat) : null,
          category: cat,
        });
      });
    }
    return {
      active,
      rooms,
      byFamily: groupMeasuredSqftByFamily(
        rooms.map((r) => ({ category: r.category, measuredSqft: r.room.sqft })),
      ),
      unassignedRoomSqft: rooms
        .filter((r) => !r.family || r.family === "other")
        .reduce((s, r) => s + (r.room.sqft > 0 ? r.room.sqft : 0), 0),
    };
  }, [questions, answers, visible, allRooms]);

  const questionCoverSf = (q: { kind?: string | null; key?: string | null; category?: string | null }) =>
    measuredSqftForQuestionCover({
      kind: q.kind,
      key: q.key,
      category: q.category,
      totalSqft,
      byFamily: floorMapAssignments.byFamily,
      jobFamilies: flooringCtx.families,
    });

  // --- Answer → line items -------------------------------------------------
  // Emit one line billed against a SPECIFIC area; `room` tags per-room prep.
  const emitLineArea = (
    emit: EstimateEmit,
    areaSqft: number,
    room: string | null,
    qtyOverride?: number,
  ): SmartLine | null => {
    const mapped = questionnaireEmitToLineQty({
      emitUnit: emit.unit,
      per: emit.per,
      areaSqft,
      qtyOverride,
    });
    if (!mapped) return null;
    const isLabor = emit.role === "labor";
    const rawDesc = room ? `${emit.description} — ${room}` : emit.description;
    return {
      room,
      description: annotateRemovalDescription(rawDesc, {
        bond: keyedChoiceSelections(questions, answers, "existing_bond"),
        pad: keyedChoiceSelections(questions, answers, "existing_pad"),
        tack: keyedChoiceSelections(questions, answers, "existing_tack"),
      }),
      category: isLabor ? "labor" : emit.category || "other",
      measure_unit: mapped.measure_unit,
      sqft: mapped.sqft,
      quantity: mapped.quantity,
      length_in: null,
      width_in: null,
      unit: mapped.unit,
      material_rate: isLabor ? 0 : sellMat(emit.cost),
      labor_rate: isLabor ? sellLab(emit.cost) : 0,
      material_cost: isLabor ? 0 : emit.cost,
      labor_cost: isLabor ? emit.cost : 0,
      waste_pct: 0,
      product_id: null,
      manufacturer: null,
      style: null,
      color: null,
      from_stock: false,
    };
  };
  // All lines a yes-no / number / choice answer produces for one area + room.
  const linesForAnswer = (q: EstimateQuestion, a: Answer, areaSqft: number, room: string | null): SmartLine[] => {
    const out: SmartLine[] = [];
    if (q.kind === "yesno" && a.kind === "yesno" && a.yes && q.config.emit) {
      const l = emitLineArea(q.config.emit, areaSqft, room);
      if (l) out.push(l);
    } else if (q.kind === "number" && a.kind === "number" && q.config.emit) {
      const n = numv(a.value);
      if (n > 0) {
        const opts = q.config.rate_options ?? [];
        const opt = a.rateIdx != null ? opts[a.rateIdx] : undefined;
        const emit: EstimateEmit = {
          ...q.config.emit,
          cost: opt ? opt.cost : q.config.emit.cost,
          description: opt ? `${q.config.emit.description} — ${opt.label}` : q.config.emit.description,
        };
        const l = emitLineArea(emit, areaSqft, room, n);
        if (l) out.push(l);
      }
    } else if (q.kind === "choice" && a.kind === "choice") {
      for (const opt of q.config.options ?? []) {
        if (a.selected.includes(opt.label) && opt.emit && choiceOptionApplies(q, opt.label, flooringCtx)) {
          const l = emitLineArea(opt.emit, areaSqft, room);
          if (l) out.push(l);
        }
      }
    }
    return out;
  };

  const lines: SmartLine[] = useMemo(() => {
    const out: SmartLine[] = [];
    const carpetSystems = carpetInstallSystemsFromLabels(flooringCtx.answeredCarpetInstall);
    // Roll-goods SKU with no cuts: keep the product, do not invent yardage.
    // sqft / L×W stay null so Builder lineQty cannot price taped area as an order.
    const rollGoodsTbdLine = (
      p: ProductAns,
      room: string | null,
      measuredSqft?: number,
    ): SmartLine => {
      const cat = p.category || "carpet";
      return {
        room,
        description: rollGoodsOrderTbdDescription(p.label || cat, measuredSqft),
        category: cat,
        measure_unit: "sqyd",
        sqft: null,
        quantity: null,
        length_in: null,
        width_in: null,
        measurements: null,
        unit: "sq yd",
        material_rate: sellMat(rateFor(p.materialRate, p.unit, true)),
        labor_rate: 0,
        material_cost: rateFor(p.materialRate, p.unit, true),
        labor_cost: 0,
        waste_pct: 0,
        product_id: p.productId || null,
        manufacturer:
          p.source === "order" && p.vendor.trim() ? p.vendor.trim() : p.manufacturer,
        style: p.style,
        color: p.color,
        from_stock: p.source === "stock",
        order_as_roll: false,
        roll_width_ft: p.rollWidthFt && p.rollWidthFt > 0 ? p.rollWidthFt : null,
      };
    };
    // Floor-map owns per-room flooring emit. Pad / prep cover uses the same
    // per-family measured area as Review — never whole-job sq ft on mixed jobs.
    const floorMapActive = floorMapAssignments.active;
    for (const q of questions) {
      if (!visible[q.id]) continue; // hidden by conditional logic → no line
      const a = answers[q.id];
      if (!a) continue;
      if (q.kind === "floor_map" && a.kind === "floor_map") {
        // Each measured room → its own product, billed in that product's unit.
        // Install labor is bundled per product (one line carrying its total area),
        // priced from a per-type install rate (carpet by the yard, hard surface by
        // the foot) since catalog flooring carries no labor rate of its own.
        const fcfg = q.config as { install_yd?: number; install_ft?: number };
        const instYd = configuredInstallRate({ billing: "yd", config: fcfg });
        const instFt = configuredInstallRate({ billing: "ft", config: fcfg });
        const byProd = new Map<
          string,
          { p: ProductAns; wantYd: boolean; sqft: number }
        >();
        const tbdRoll = new Map<string, { p: ProductAns; sqft: number; rooms: string[] }>();
        const tbdBoxed = new Map<string, { p: ProductAns; sqft: number; rooms: string[] }>();
        allRooms.forEach((rm, i) => {
          const p = a.byRoom[roomKey(rm.name, i)];
          if (!p || rm.sqft <= 0) return;
          const cat = p.category || "other";
          const rollFam = familyFromCatalogCategory(cat);
          // Mixed jobs: broadloom / sheet ORDER comes from the cuts step.
          // Exclusive carpet tile is modular — taped room area may become the
          // material line. Do not also bill a second roll-goods line from cuts.
          const cutSf = isRollGoodsFamily(rollFam) ? (cutsSqftByCategory[rollFam] ?? 0) : 0;
          if (rollGoodsHaveCuts(rollFam, cutSf, carpetSystems)) return;
          const b = billing({ category: cat, productUnit: p.unit });
          const defWaste = profileFor(cat)?.waste ?? 0;
          const requested = p.wastePct.trim() !== "" ? numv(p.wastePct) : defWaste;
          const waste = materialWastePctForEmit({
            family: rollFam,
            cutsSqft: cutSf,
            requestedWastePct: requested,
            carpetInstallSystems: carpetSystems,
          });
          const spb = numv(p.sqftPerBox);
          // Flooring is AREA-billed: the builder prices area × material_cost ×
          // (1 + waste_pct/100) and shows an editable Waste % field. So pass the
          // waste through waste_pct — do NOT bake it into quantity, which area
          // pricing ignores (that's why waste appeared to "not transfer"). Box
          // count is derived from sqft ÷ sqft_per_box in the builder.
          // Roll goods without cuts: measured sqft is NOT an order. Do not emit
          // a material line with qty = sqft ÷ 9 — that is equivalent area.
          const qty = areaDerivedMaterialQty({
            family: rollFam,
            measuredSqft: rm.sqft,
            billingUnit: b.wantYd ? "sqyd" : "sqft",
            productUnit: p.unit,
            carpetInstallSystems: carpetSystems,
            sqftPerBox: spb > 0 ? spb : null,
          });
          if (qty != null && rm.sqft > 0)
            out.push({
              room: rm.name || null,
              description: p.label || cat,
              category: cat,
              measure_unit: b.measureUnit,
              sqft: rm.sqft,
              quantity: qty,
              // Room L×W is measured area. Never stuff it onto a carpet/vinyl
              // line as a warehouse cut — exclusive tile is modular, and
              // broadloom order comes from the cuts step.
              length_in: isRollGoodCategory(cat) ? null : rm.lenIn,
              width_in: isRollGoodCategory(cat) ? null : rm.widIn,
              unit: b.unitLabel,
              material_rate: sellMat(
                rateFor(p.materialRate, p.unit, b.wantYd, {
                  category: cat,
                  sqft_per_box: spb > 0 ? spb : null,
                }),
              ),
              labor_rate: 0,
              material_cost: rateFor(p.materialRate, p.unit, b.wantYd, {
                category: cat,
                sqft_per_box: spb > 0 ? spb : null,
              }),
              labor_cost: 0,
              waste_pct: waste,
              product_id: p.productId || null,
              manufacturer:
                p.source === "order" && p.vendor.trim() ? p.vendor.trim() : p.manufacturer,
              style: p.style,
              color: p.color,
              from_stock: p.source === "stock",
              sqft_per_box: spb > 0 ? spb : null,
              order_as_roll: isRollGoodCategory(cat) ? false : undefined,
            });
          else if (rollGoodsNeedCuts(rollFam, carpetSystems) && (p.productId || p.label)) {
            const key = p.productId || p.label;
            const rec = tbdRoll.get(key) ?? { p, sqft: 0, rooms: [] };
            rec.sqft += rm.sqft;
            if (rm.name && !rec.rooms.includes(rm.name)) rec.rooms.push(rm.name);
            tbdRoll.set(key, rec);
          } else if (
            boxedCartonCoverageTbdDescription({
              family: rollFam,
              productUnit: p.unit,
              sqftPerBox: spb > 0 ? spb : null,
              label: p.label,
              carpetInstallSystems: carpetSystems,
            }) &&
            (p.productId || p.label)
          ) {
            // Missing carton coverage stays TBD — do not invent a box size and not How many boxes from leftover taped sq ft.
            const key = p.productId || p.label;
            const rec = tbdBoxed.get(key) ?? { p, sqft: 0, rooms: [] };
            rec.sqft += rm.sqft;
            if (rm.name && !rec.rooms.includes(rm.name)) rec.rooms.push(rm.name);
            tbdBoxed.set(key, rec);
          }
          // Accumulate install labor per distinct product. Labor is measured
          // work even when roll-goods order quantity is still TBD.
          if (measuredInstallLaborAllowed(rollFam, cutSf, carpetSystems)) {
            const key = `${p.productId || p.label}|${p.laborRate}`;
            const agg = byProd.get(key) ?? { p, wantYd: b.wantYd, sqft: 0 };
            agg.sqft += rm.sqft;
            byProd.set(key, agg);
          }
        });
        for (const { p, sqft, rooms } of tbdRoll.values()) {
          out.push(rollGoodsTbdLine(p, rooms.length === 1 ? rooms[0] ?? null : null, sqft));
        }
        for (const { p, rooms } of tbdBoxed.values()) {
          const cat = p.category || "other";
          const desc = boxedCartonCoverageTbdDescription({
            family: familyFromCatalogCategory(cat),
            productUnit: p.unit,
            label: p.label,
            carpetInstallSystems: carpetSystems,
          });
          if (!desc) continue;
          // Builder carton-coverage TBD is How many / Unit TBD, never taped square feet.
          const { unit: countUnit } = countUnitForTbd(isAreaUnit(p.unit) ? "" : p.unit);
          out.push({
            room: rooms.length === 1 ? rooms[0] ?? null : null,
            description: desc,
            category: cat,
            measure_unit: "sqft",
            sqft: null,
            quantity: null,
            length_in: null,
            width_in: null,
            measurements: null,
            unit: countUnit,
            material_rate: sellMat(rateFor(p.materialRate, p.unit, false)),
            labor_rate: 0,
            material_cost: rateFor(p.materialRate, p.unit, false),
            labor_cost: 0,
            waste_pct: 0,
            product_id: p.productId || null,
            manufacturer:
              p.source === "order" && p.vendor.trim() ? p.vendor.trim() : p.manufacturer,
            style: p.style,
            color: p.color,
            from_stock: p.source === "stock",
          });
        }
        for (const { p, wantYd, sqft } of byProd.values()) {
          // Prefer the product's own labor rate if set, else the per-type
          // Settings rate. Missing config does not invent $6/yd or $2/ft.
          const lr = rateFor(p.laborRate, p.unit, wantYd) || (wantYd ? instYd : instFt);
          if (lr <= 0 || sqft <= 0) continue;
          out.push({
            room: null,
            description: `Installation — ${(p.label || "flooring").toLowerCase()}`,
            category: "labor",
            measure_unit: wantYd ? "sqyd" : "sqft",
            sqft: r2(sqft),
            quantity: wantYd ? Math.ceil(sqft / 9) : Math.ceil(sqft),
            length_in: null,
            width_in: null,
            unit: wantYd ? "sq yd" : "sq ft",
            material_rate: 0,
            labor_rate: sellLab(lr),
            material_cost: 0,
            labor_cost: lr,
            waste_pct: 0,
            product_id: null,
            manufacturer: null,
            style: null,
            color: null,
            from_stock: false,
          });
        }
      } else if (q.kind === "product" && a.kind === "product") {
        const cat = q.config.category || "other";
        const b = billing({ category: cat, key: q.key });
        // Editable waste per product (falls back to the category default).
        // Flooring is AREA-billed: the builder prices measured area ×
        // material_cost × (1 + waste_pct/100) and IGNORES the stored quantity,
        // so waste MUST ride through waste_pct — baking it into quantity drops
        // it (the same bug that was fixed on the per-room path). Box count is
        // derived from sqft ÷ sqft_per_box in the builder, display-only.
        const defWaste = profileFor(cat)?.waste ?? 0;
        const fam = familyFromCatalogCategory(cat);
        const cutSf = isRollGoodsFamily(fam) ? (cutsSqftByCategory[fam] ?? 0) : 0;
        const wasteOf = (p: ProductAns) =>
          materialWastePctForEmit({
            family: fam,
            cutsSqft: cutSf,
            requestedWastePct: p.wastePct.trim() !== "" ? numv(p.wastePct) : defWaste,
            carpetInstallSystems: carpetSystems,
          });
        const matLine = (
          p: ProductAns,
          size?: {
            room?: string | null;
            sqft?: number | null;
            lenIn?: number | null;
            widIn?: number | null;
            /** Explicit cut pieces (roll goods) → each becomes a warehouse cut. */
            cuts?: { label: string | null; lenIn: number; widIn: number }[];
          },
        ): SmartLine => {
          // Roll-goods warehouse cuts come from the cuts editor only.
          // Room L×W is measured area, not a fabricated cut off a 12' roll.
          const roll = isRollGoodCategory(cat);
          const pb = billing({
            category: p.category || cat,
            key: q.key,
            productUnit: p.unit,
          });
          let measurements: SmartLine["measurements"] = null;
          if (roll) {
            const pieces = (size?.cuts ?? []).filter((c) => c.lenIn > 0 && c.widIn > 0);
            if (pieces.length) {
              measurements = pieces.map((c) => ({
                label: c.label,
                length_in: c.lenIn,
                width_in: c.widIn,
                op: "add" as const,
              }));
            }
          }
          return {
          room: size?.room ?? null,
          description: p.label || cat,
          category: cat,
          measure_unit: pb.measureUnit,
          sqft: size?.sqft ?? null, // the measurement, carried for confirmation
          // Raw measured area in the billing unit (no waste, no box snap) — the
          // waste is applied via waste_pct so area pricing charges it.
          // Roll goods return null here — callers must not push those lines.
          quantity: areaDerivedMaterialQty({
            family: familyFromCatalogCategory(p.category || cat),
            measuredSqft: size?.sqft ?? 0,
            billingUnit: pb.wantYd ? "sqyd" : "sqft",
            productUnit: p.unit,
            carpetInstallSystems: carpetSystems,
            sqftPerBox: numv(p.sqftPerBox) > 0 ? numv(p.sqftPerBox) : null,
          }) ?? 0,
          // Roll goods: L×W on the line is a warehouse cut, so only explicit
          // cuts go here. Room dimensions stay on sqft (measured area).
          length_in: measurements?.[0]?.length_in ?? (roll ? null : size?.lenIn ?? null),
          width_in: measurements?.[0]?.width_in ?? (roll ? null : size?.widIn ?? null),
          measurements,
          unit: pb.unitLabel,
          material_rate: sellMat(
            rateFor(p.materialRate, p.unit, pb.wantYd, {
              category: p.category || cat,
              sqft_per_box: numv(p.sqftPerBox) > 0 ? numv(p.sqftPerBox) : null,
            }),
          ),
          labor_rate: 0,
          material_cost: rateFor(p.materialRate, p.unit, pb.wantYd, {
            category: p.category || cat,
            sqft_per_box: numv(p.sqftPerBox) > 0 ? numv(p.sqftPerBox) : null,
          }),
          labor_cost: 0,
          waste_pct: wasteOf(p),
          product_id: p.productId || null,
          // Vendor override rides on manufacturer (the PO's name fallback) only
          // when you explicitly set one; otherwise keep the real manufacturer.
          manufacturer: p.source === "order" && p.vendor.trim() ? p.vendor.trim() : p.manufacturer,
          style: p.style,
          color: p.color,
          from_stock: p.source === "stock",
          sqft_per_box: numv(p.sqftPerBox) > 0 ? numv(p.sqftPerBox) : null,
          };
        };
        if (a.product) {
          const p = a.product;
          const boxed = numv(p.sqftPerBox) > 0;
          // Floor-map already itemizes flooring per assigned room. Do not emit
          // a second whole-job (or all-room) line for the same SKU.
          const floorMapOwnsFlooring =
            floorMapActive && cat !== "underlayment" && cat !== "trim" && cat !== "other";
          const coverSf = questionCoverSf({ kind: q.kind, key: q.key, category: cat });
          const coverRooms = roomsAssignedToFamilies({
            rooms: floorMapAssignments.rooms.length
              ? floorMapAssignments.rooms
              : allRooms.map((rm) => ({ room: rm, family: null })),
            families: [fam],
            jobFamilies: flooringCtx.families,
          });
          // Flooring is itemized PER ROOM (name + sq ft + L×W) so the sizes you
          // measured show on the estimate & work order. Boxed goods bill as ONE
          // full-carton line (so the charge = the boxes bought); pad / trim /
          // other stay bundled to one line, but carry the total sq ft.
          const perRoomFloor =
            !floorMapOwnsFlooring &&
            cat !== "underlayment" && cat !== "trim" && cat !== "other" && coverRooms.length > 0 && !boxed;
          const allowAreaMat =
            (areaDerivedMaterialAllowed(fam, p.unit, carpetSystems) ||
              boxedCartonAreaTakeoffAllowed({
                family: fam,
                productUnit: p.unit,
                sqftPerBox: numv(p.sqftPerBox),
                carpetInstallSystems: carpetSystems,
              })) &&
            q.key !== "adhesive";
          // Roll goods: taped area is never a material line. Cuts own the order.
          // Adhesive / gal / kit: taped sq ft is not a glue order.
          if (floorMapOwnsFlooring) {
            // Floor-map loop above already emitted this family's rooms.
          } else if (allowAreaMat) {
            if (perRoomFloor) {
              for (const rm of coverRooms) {
                if (rm.sqft > 0) out.push(matLine(p, { room: rm.name || null, sqft: rm.sqft, lenIn: rm.lenIn, widIn: rm.widIn }));
              }
            } else if (coverSf > 0) {
              // Measured area only. Do not turn room L×W into a warehouse cut list —
              // that is the cuts/layout step, and sq ft is not a cut plan.
              out.push(matLine(p, { sqft: coverSf }));
            }
          } else if (
            !floorMapActive &&
            isRollGoodsFamily(fam) &&
            rollGoodsNeedCuts(fam, carpetSystems) &&
            (p.productId || p.label)
          ) {
            out.push(rollGoodsTbdLine(p, null, coverSf > 0 ? coverSf : undefined));
          } else if (!isRollGoodsFamily(fam) && (p.productId || p.label)) {
            // Main count SKU emits How many in that unit — not leftover sq ft and not a 30-yard roll. Empty unit stays TBD.
            // Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet.
            const counted = extraCountQtyForEmit({
              family: fam,
              productUnit: p.unit,
              qty: numv(a.qty ?? ""),
              carpetInstallSystems: carpetSystems,
            });
            const { unit: countUnit, phrase: countPhrase } = countUnitForTbd(p.unit);
            if (counted) {
              out.push({
                room: null,
                description: `${p.label || cat} — ${counted.quantity} ${counted.unit} (not taped sq ft)`,
                category: p.category || cat,
                measure_unit: "sqft",
                sqft: null,
                quantity: counted.quantity,
                length_in: null,
                width_in: null,
                unit: counted.unit,
                material_rate: sellMat(rateFor(p.materialRate, p.unit, false)),
                labor_rate: 0,
                material_cost: rateFor(p.materialRate, p.unit, false),
                labor_cost: 0,
                waste_pct: 0,
                product_id: p.productId || null,
                manufacturer:
                  p.source === "order" && p.vendor.trim() ? p.vendor.trim() : p.manufacturer,
                style: p.style,
                color: p.color,
                from_stock: p.source === "stock",
              });
            } else {
              out.push({
                room: null,
                description: `${p.label || cat} — qty TBD (${countPhrase} — not taped sq ft)`,
                category: p.category || cat,
                measure_unit: "sqft",
                sqft: null,
                quantity: null,
                length_in: null,
                width_in: null,
                unit: countUnit,
                material_rate: sellMat(rateFor(p.materialRate, p.unit, false)),
                labor_rate: 0,
                material_cost: rateFor(p.materialRate, p.unit, false),
                labor_cost: 0,
                waste_pct: 0,
                product_id: p.productId || null,
                manufacturer:
                  p.source === "order" && p.vendor.trim() ? p.vendor.trim() : p.manufacturer,
                style: p.style,
                color: p.color,
                from_stock: p.source === "stock",
              });
            }
          }
          // Install labor — bundled, with the total area recorded.
          // Cuts-owned roll goods emit install with the cut yardage instead.
          // Without cuts, labor still follows measured area (install is work,
          // not an order quantity). Glue/count picks do not get fake sq-ft labor.
          const lr = rateFor(p.laborRate, p.unit, b.wantYd);
          const laborFromMeasured =
            measuredInstallLaborAllowed(fam, cutSf, carpetSystems) && lr > 0 && coverSf > 0;
          if (
            !floorMapOwnsFlooring &&
            laborFromMeasured &&
            (allowAreaMat ||
              (!floorMapActive &&
                isRollGoodsFamily(fam) &&
                rollGoodsNeedCuts(fam, carpetSystems)))
          ) {
            const laborQty = b.wantYd ? Math.ceil(coverSf / 9) : Math.ceil(coverSf);
            out.push({
              room: null,
              description: `Installation — ${(p.label || cat).toLowerCase()}`,
              category: "labor",
              measure_unit: b.measureUnit,
              sqft: r2(coverSf),
              quantity: laborQty,
              length_in: null,
              width_in: null,
              unit: b.unitLabel,
              material_rate: 0,
              labor_rate: sellLab(lr),
              material_cost: 0,
              labor_cost: lr,
              waste_pct: 0,
              product_id: null,
              manufacturer: null,
              style: null,
              color: null,
              from_stock: false,
            });
          }
        }
        // Additional products for specific areas (e.g. upgraded pad on the
        // stairs) — each its own material line, quantity from its own area.
        // Extra carpet/sheet cannot be ordered from taped sqft — keep the SKU
        // as order TBD, same as the main roll-goods path. Count-unit extras
        // (gal/kit / empty sold-by unit) emit TBD without requiring measured
        // sq ft — do not plant leftover sq ft.
        for (const ex of a.extras) {
          if (!ex.product) continue;
          const exFam = familyFromCatalogCategory(ex.product.category || cat);
          const extraSf = extraMeasuredSqftForTakeoff({
            family: exFam,
            productUnit: ex.product.unit,
            measuredSqft: numv(ex.sqft),
            carpetInstallSystems: carpetSystems,
          });
          if (extraSf != null) {
            out.push(matLine(ex.product, { sqft: extraSf }));
            continue;
          }
          if (areaDerivedMaterialAllowed(exFam, ex.product.unit, carpetSystems)) continue;
          if (
            isRollGoodsFamily(exFam) &&
            rollGoodsNeedCuts(exFam, carpetSystems) &&
            (ex.product.productId || ex.product.label)
          ) {
            out.push(rollGoodsTbdLine(ex.product, null, numv(ex.sqft) > 0 ? numv(ex.sqft) : undefined));
            continue;
          }
          // Count extras with a sold-by unit emit How many in that unit — not leftover sq ft and not a 30-yard roll. Empty unit stays TBD.
          // Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet.
          if (ex.product.productId || ex.product.label) {
            const counted = extraCountQtyForEmit({
              family: exFam,
              productUnit: ex.product.unit,
              qty: numv(ex.qty ?? ""),
              carpetInstallSystems: carpetSystems,
            });
            const { unit: countUnit, phrase: countPhrase } = countUnitForTbd(ex.product.unit);
            if (counted) {
              out.push({
                room: null,
                description: `${ex.product.label || cat} — ${counted.quantity} ${counted.unit} (not taped sq ft)`,
                category: ex.product.category || cat,
                measure_unit: "sqft",
                sqft: null,
                quantity: counted.quantity,
                length_in: null,
                width_in: null,
                unit: counted.unit,
                material_rate: sellMat(rateFor(ex.product.materialRate, ex.product.unit, false)),
                labor_rate: 0,
                material_cost: rateFor(ex.product.materialRate, ex.product.unit, false),
                labor_cost: 0,
                waste_pct: 0,
                product_id: ex.product.productId || null,
                manufacturer:
                  ex.product.source === "order" && ex.product.vendor.trim()
                    ? ex.product.vendor.trim()
                    : ex.product.manufacturer,
                style: ex.product.style,
                color: ex.product.color,
                from_stock: ex.product.source === "stock",
              });
              continue;
            }
            out.push({
              room: null,
              description: `${ex.product.label || cat} — qty TBD (${countPhrase} — not taped sq ft)`,
              category: ex.product.category || cat,
              measure_unit: "sqft",
              sqft: null,
              quantity: null,
              length_in: null,
              width_in: null,
              unit: countUnit,
              material_rate: sellMat(rateFor(ex.product.materialRate, ex.product.unit, false)),
              labor_rate: 0,
              material_cost: rateFor(ex.product.materialRate, ex.product.unit, false),
              labor_cost: 0,
              waste_pct: 0,
              product_id: ex.product.productId || null,
              manufacturer:
                ex.product.source === "order" && ex.product.vendor.trim()
                  ? ex.product.vendor.trim()
                  : ex.product.manufacturer,
              style: ex.product.style,
              color: ex.product.color,
              from_stock: ex.product.source === "stock",
            });
          }
        }
      } else if (q.kind === "product" && a.kind === "trims") {
        // Trims / moldings — each row is a quick-picked type (with color/size) or
        // a specific catalog product, billed per its unit (lnft/each), so the
        // exact trim shows on the estimate and can be pulled from stock or ordered.
        for (const row of a.rows) {
          const qty = numv(row.qty);
          if (qty <= 0 || (!row.type && !row.product)) continue;
          const p = row.product;
          const unit = coerceTrimUnit(row.type || p?.label || "", row.unit || p?.unit);
          // R&R re-uses the existing piece — no new material, labor only (remove &
          // re-install per linear foot). A normal row charges material as entered.
          const rrLabor = row.rr ? numv(row.rrRate ?? "") : 0;
          const matCost = row.rr ? 0 : p ? p.materialRate : numv(row.cost);
          const laborCost = (p && !row.rr ? p.laborRate : 0) + rrLabor;
          const desc =
            (p?.label ||
              [row.type || "Trim", row.size ? `${row.size}"`.replace('""', '"') : "", row.color]
                .filter(Boolean)
                .join(" · ")) + (row.rr ? " (R&R)" : "");
          out.push({
            room: null,
            description: desc,
            category: "trim",
            measure_unit: "sqft",
            sqft: null,
            quantity: r2(qty),
            length_in: null,
            width_in: null,
            unit,
            material_rate: sellMat(matCost),
            labor_rate: sellLab(laborCost),
            material_cost: matCost,
            labor_cost: laborCost,
            waste_pct: 0,
            product_id: p?.productId || null,
            manufacturer: p?.source === "order" && p.vendor.trim() ? p.vendor.trim() : p?.manufacturer ?? null,
            style: p?.style ?? null,
            color: row.color || p?.color || null,
            from_stock: !row.rr && row.source === "stock",
          });
        }
      } else if (q.kind === "choice" && a.kind === "choice_areas") {
        // Multiple demo types, each billed against its own area.
        for (const row of a.rows) {
          const area = numv(row.sqft);
          if (!row.option || area <= 0) continue;
          const opt = (q.config.options ?? []).find((o) => o.label === row.option);
          if (opt?.emit) {
            const l = emitLineArea(opt.emit, area, null);
            if (l) out.push(l);
          }
        }
      } else if (q.kind === "cuts" && a.kind === "cuts") {
        // Carpet cuts → ONE carpet line carrying its cuts as first-class
        // MEASUREMENTS (the same shape the builder stores). Each cut is a measured
        // piece labeled with its area, so the cut list reads straight from the
        // estimate onto the staging sheet, work order, and PO — and the customer
        // sees one clean carpet line (total yardage), never the cut sizes.
        // "Same carpet" → one shared line for the whole job; otherwise one line
        // per area.
        const sameCarpet = a.same !== false;
        const rollCategory = q.config.category === "vinyl" ? "vinyl" : "carpet";
        const rollLabel = rollCategory === "vinyl" ? "Sheet vinyl" : "Carpet";
        const rollCoverSf = questionCoverSf({ kind: q.kind, key: q.key, category: rollCategory });
        const modularTile =
          rollCategory === "carpet" && !rollGoodsNeedCuts("carpet", carpetSystems);
        if (modularTile) {
          // Carpet tile is modular. Keep this step so the salesperson can pick
          // the SKU; do not invent a roll cut plan or a 12' warehouse piece.
          // Mixed floor-map jobs already emit assigned rooms above.
          if (!floorMapActive) {
            const emitModular = (p: ProductAns | null, roomLabel: string | null, sqft: number) => {
              if (!p || !(sqft > 0)) return;
              const spb = numv(p.sqftPerBox) > 0 ? numv(p.sqftPerBox) : null;
              const qty = areaDerivedMaterialQty({
                family: "carpet",
                measuredSqft: sqft,
                billingUnit: "sqyd",
                productUnit: p.unit,
                carpetInstallSystems: carpetSystems,
                sqftPerBox: spb,
              });
              if (qty == null) {
                // Exclusive carpet-tile carton SKU with coverage takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size.
                const tbd = boxedCartonCoverageTbdDescription({
                  family: "carpet",
                  productUnit: p.unit,
                  sqftPerBox: spb,
                  label: p.label,
                  carpetInstallSystems: carpetSystems,
                });
                if (!tbd) return;
                // Builder carton-coverage TBD is How many / Unit TBD, never taped square feet.
                const { unit: countUnit } = countUnitForTbd(isAreaUnit(p.unit) ? "" : p.unit);
                out.push({
                  room: roomLabel,
                  description: tbd,
                  category: p.category || "carpet",
                  measure_unit: "sqyd",
                  sqft: null,
                  quantity: null,
                  length_in: null,
                  width_in: null,
                  measurements: null,
                  unit: countUnit,
                  material_rate: sellMat(rateFor(p.materialRate, p.unit, true)),
                  labor_rate: 0,
                  material_cost: rateFor(p.materialRate, p.unit, true),
                  labor_cost: 0,
                  waste_pct: 0,
                  product_id: p.productId || null,
                  manufacturer:
                    p.source === "order" && p.vendor.trim() ? p.vendor.trim() : p.manufacturer,
                  style: p.style,
                  color: p.color,
                  from_stock: p.source === "stock",
                  order_as_roll: false,
                  roll_width_ft: null,
                  sqft_per_box: null,
                });
                return;
              }
              const waste = materialWastePctForEmit({
                family: "carpet",
                requestedWastePct:
                  p.wastePct.trim() !== "" ? numv(p.wastePct) : (profileFor("carpet")?.waste ?? 0),
                carpetInstallSystems: carpetSystems,
              });
              out.push({
                room: roomLabel,
                description: p.label || "Carpet tile",
                category: p.category || "carpet",
                measure_unit: "sqyd",
                sqft: r2(sqft),
                quantity: qty,
                length_in: null,
                width_in: null,
                measurements: null,
                unit: "sq yd",
                material_rate: sellMat(
                  rateFor(p.materialRate, p.unit, true, {
                    category: p.category || "carpet",
                    sqft_per_box: numv(p.sqftPerBox) > 0 ? numv(p.sqftPerBox) : null,
                  }),
                ),
                labor_rate: 0,
                material_cost: rateFor(p.materialRate, p.unit, true, {
                  category: p.category || "carpet",
                  sqft_per_box: numv(p.sqftPerBox) > 0 ? numv(p.sqftPerBox) : null,
                }),
                labor_cost: 0,
                waste_pct: waste,
                product_id: p.productId || null,
                manufacturer:
                  p.source === "order" && p.vendor.trim() ? p.vendor.trim() : p.manufacturer,
                style: p.style,
                color: p.color,
                from_stock: p.source === "stock",
                order_as_roll: false,
                roll_width_ft: null,
                sqft_per_box: numv(p.sqftPerBox) > 0 ? numv(p.sqftPerBox) : null,
              });
              const instYd = configuredInstallRate({
                billing: "yd",
                config: q.config,
                productLabor: rateFor(p.laborRate, p.unit, true),
              });
              if (instYd > 0) {
                out.push({
                  room: roomLabel,
                  description: `Carpet installation${roomLabel ? ` — ${roomLabel}` : ""}`,
                  category: "labor",
                  measure_unit: "sqyd",
                  sqft: r2(sqft),
                  quantity: Math.ceil(sqft / 9),
                  length_in: null,
                  width_in: null,
                  unit: "sq yd",
                  material_rate: 0,
                  labor_rate: sellLab(instYd),
                  material_cost: 0,
                  labor_cost: instYd,
                  waste_pct: 0,
                  product_id: null,
                  manufacturer: null,
                  style: null,
                  color: null,
                  from_stock: false,
                });
              }
            };
            if (sameCarpet) emitModular(a.product, null, questionCoverSf({ kind: q.kind, key: q.key, category: "carpet" }));
            else {
              const picked = a.groups.map((g) => g.product).find(Boolean) ?? a.product;
              emitModular(picked, null, questionCoverSf({ kind: q.kind, key: q.key, category: "carpet" }));
            }
          }
        } else {
        // stores). Every add-piece is a cut off the roll (labeled with its area),
        // and the pieces sum to the line's yardage.
        type Piece = {
          label: string | null;
          lenIn: number;
          widIn: number;
          sqft: number;
          sqyd: number;
          widthFt: number;
        };
        const groupPieces = (g: CarpetGroup, _p: ProductAns | null): Piece[] => {
          const pieces: Piece[] = [];
          for (const c of g.cuts) {
            const lenIn = numv(c.lf) * 12 + numv(c.li);
            // Catalog roll width may pre-fill the input. An empty width is not
            // a 12' or 6' roll — skip the piece until a width is entered.
            const widFt = enteredCutWidthFt(c.width);
            if (lenIn <= 0 || widFt <= 0) continue;
            const sqft = (lenIn / 12) * widFt;
            const sqyd = r2(sqft / 9);
            if (sqyd <= 0) continue;
            pieces.push({ label: g.area.trim() || null, lenIn, widIn: widFt * 12, sqft, sqyd, widthFt: widFt });
          }
          return pieces;
        };

        // ONE carpet MATERIAL line (with all its cuts as measurements) + ONE
        // install LABOR line, built from a product and its cuts.
        const emitCarpet = (
          p: ProductAns | null,
          pieces: Piece[],
          roomLabel: string | null,
        ) => {
          if (!pieces.length) return;
          const matSell = p ? sellMat(rateFor(p.materialRate, p.unit, true)) : 0;
          const matCost = p ? rateFor(p.materialRate, p.unit, true) : 0;
          const totalSqft = r2(pieces.reduce((s, x) => s + x.sqft, 0));
          const totalSqyd = r2(pieces.reduce((s, x) => s + x.sqyd, 0));
          if (totalSqyd <= 0) return;
          const first = pieces[0];
          out.push({
            room: roomLabel,
            // Product label ONLY — the cut sizes live in measurements (shown on
            // internal cut lists, kept off the customer estimate).
            description: p?.label || rollLabel,
            category: p?.category || rollCategory,
            measure_unit: "sqyd",
            sqft: totalSqft,
            quantity: totalSqyd,
            // Primary cut mirrored onto len/wid for single-cut readers.
            length_in: first.lenIn,
            width_in: first.widIn,
            unit: "sq yd",
            material_rate: matSell,
            labor_rate: 0,
            material_cost: matCost,
            labor_cost: 0,
            waste_pct: 0,
            product_id: p?.productId || null,
            manufacturer: p?.source === "order" && p.vendor.trim() ? p.vendor.trim() : p?.manufacturer ?? null,
            style: p?.style ?? null,
            color: p?.color ?? null,
            from_stock: p?.source === "stock",
            order_as_roll: true, // PO consolidates these cuts into one roll per product+width
            roll_width_ft: p?.rollWidthFt && p.rollWidthFt > 0 ? p.rollWidthFt : first.widthFt,
            measurements: pieces.map((x) => ({
              label: x.label,
              length_in: x.lenIn,
              width_in: x.widIn,
              op: "add" as const,
            })),
          });
          // Carpet INSTALL labor — product labor rate, else this question's
          // Settings $/sq yd. Missing config does not invent $6.
          const instYd = configuredInstallRate({
            billing: "yd",
            config: q.config,
            productLabor: p ? rateFor(p.laborRate, p.unit, true) : 0,
          });
          if (instYd > 0) {
            out.push({
              room: roomLabel,
              description: `${rollLabel} installation${roomLabel ? ` — ${roomLabel}` : ""}`,
              category: "labor",
              measure_unit: "sqyd",
              sqft: r2(totalSqyd * 9),
              quantity: Math.ceil(totalSqyd),
              length_in: null,
              width_in: null,
              unit: "sq yd",
              material_rate: 0,
              labor_rate: sellLab(instYd),
              material_cost: 0,
              labor_cost: instYd,
              waste_pct: 0,
              product_id: null,
              manufacturer: null,
              style: null,
              color: null,
              from_stock: false,
            });
          }
        };

        if (sameCarpet) {
          // One carpet for the whole job → ONE line, every cut labeled by its area.
          const pieces = a.groups.flatMap((g) => groupPieces(g, a.product));
          if (pieces.length) emitCarpet(a.product, pieces, null);
          else if (
            !floorMapActive &&
            a.product &&
            (a.product.productId || a.product.label)
          ) {
            out.push(rollGoodsTbdLine(a.product, null, rollCoverSf > 0 ? rollCoverSf : undefined));
          }
        } else {
          // Different carpet per area → one line per area (each with its cuts).
          let anyPieces = false;
          for (const g of a.groups) {
            const pieces = groupPieces(g, g.product);
            if (pieces.length) {
              anyPieces = true;
              emitCarpet(g.product, pieces, g.area.trim() || null);
            } else if (
              !floorMapActive &&
              g.product &&
              (g.product.productId || g.product.label)
            ) {
              out.push(rollGoodsTbdLine(g.product, g.area.trim() || null));
            }
          }
          if (!anyPieces && !floorMapActive && rollCoverSf > 0) {
            const p = a.groups.map((g) => g.product).find(Boolean) ?? a.product;
            const instYd = configuredInstallRate({
              billing: "yd",
              config: q.config,
              productLabor: p ? rateFor(p.laborRate, p.unit, true) : 0,
            });
            if (instYd > 0 && p) {
              out.push({
                room: null,
                description: `${rollLabel} installation`,
                category: "labor",
                measure_unit: "sqyd",
                sqft: r2(rollCoverSf),
                quantity: Math.ceil(rollCoverSf / 9),
                length_in: null,
                width_in: null,
                unit: "sq yd",
                material_rate: 0,
                labor_rate: sellLab(instYd),
                material_cost: 0,
                labor_cost: instYd,
                waste_pct: 0,
                product_id: null,
                manufacturer: null,
                style: null,
                color: null,
                from_stock: false,
              });
            }
          }
        }
        if (
          sameCarpet &&
          !floorMapActive &&
          rollCoverSf > 0 &&
          a.groups.flatMap((g) => groupPieces(g, a.product)).length === 0
        ) {
          const p = a.product;
          const instYd = configuredInstallRate({
            billing: "yd",
            config: q.config,
            productLabor: p ? rateFor(p.laborRate, p.unit, true) : 0,
          });
          if (instYd > 0) {
            out.push({
              room: null,
              description: `${rollLabel} installation`,
              category: "labor",
              measure_unit: "sqyd",
              sqft: r2(rollCoverSf),
              quantity: Math.ceil(rollCoverSf / 9),
              length_in: null,
              width_in: null,
              unit: "sq yd",
              material_rate: 0,
              labor_rate: sellLab(instYd),
              material_cost: 0,
              labor_cost: instYd,
              waste_pct: 0,
              product_id: null,
              manufacturer: null,
              style: null,
              color: null,
              from_stock: false,
            });
          }
        }
        }
      } else if (q.kind === "stairs" && a.kind === "stairs") {
        // Waterfall / upholstered wrap labor is stretch-in (and glue-down
        // broadloom). Exclusive carpet tile is modular — do not emit wrap $.
        if (rollGoodsNeedCuts("carpet", carpetSystems)) {
        // Stairs → step LABOR. The carpet a staircase consumes is already
        // in the cuts; do not add a second material line.
        const opts = q.config.options ?? [];
        for (const g of a.groups) {
          const n = Math.ceil(numv(g.count));
          if (n <= 0 || !g.type) continue;
          const opt = opts.find((o) => o.label === g.type);
          const laborCost = opt?.cost ?? 0;
          out.push({
            room: null,
            description: `Carpet steps — ${g.type}`,
            category: "labor",
            measure_unit: "sqft",
            sqft: null,
            quantity: n,
            length_in: null,
            width_in: null,
            unit: "step",
            material_rate: 0,
            labor_rate: sellLab(laborCost),
            material_cost: 0,
            labor_cost: laborCost,
            waste_pct: 0,
            product_id: null,
            manufacturer: null,
            style: null,
            color: null,
            from_stock: false,
          });
          /**
           * NO separate carpet line for the steps.
           *
           * This used to add "Stair carpet — n steps" at the per-yard rate on
           * top of the step labour. The carpet a staircase consumes is already
           * in the cuts measured on the "Carpet & cuts" screen — you measure the
           * roll you're pulling from, stairs included — so the material was
           * being charged twice on every job with steps.
           *
           * The step LABOUR above is still charged, per step: that's real work
           * the measurement doesn't cover.
           */
        }
        }
      } else if (q.kind === "hs_stairs" && a.kind === "hs_stairs") {
        // Hard-surface stairs: step count + trim EACH (noses/treads/risers).
        // Do not invent 8/4 sq ft of flooring per step — that is not a cut plan
        // and it double-counts Trims. Wrap product stays identity / TBD.
        // Stair labor is per step when the salesperson enters a rate (0194:
        // do not invent one). Legacy labor_per_sqft is not multiplied by 8.
        const steps = Math.ceil(numv(a.steps));
        if (steps > 0) {
          const scopeLabel = a.treadRiser ? "tread + riser" : "tread only";
          const p = a.product;
          if (p && (p.productId || p.label)) {
            const matCost = rateFor(p.materialRate, p.unit, false);
            const wrapFam = familyFromCatalogCategory(p.category);
            // Count wrap SKU emits How many in that unit — not leftover sq ft and not 8 sq ft/step. Area-unit wrap stays wrap qty TBD.
            const counted = extraCountQtyForEmit({
              family: wrapFam,
              productUnit: p.unit,
              qty: numv(a.qty ?? ""),
            });
            // Wrap extra boxes are COUNT. A boxed LVP/hardwood SKU sold by the
            // square foot must not plant that area unit onto the wrap line —
            // typing 104 sq ft in Builder would reopen the 8 sq ft/step order.
            const { unit: countUnit } = countUnitForTbd(isAreaUnit(p.unit) ? "" : p.unit);
            if (counted) {
              out.push({
                room: null,
                description: `${p.label || "Stair wrap"} — ${counted.quantity} ${counted.unit} (${steps} step${steps === 1 ? "" : "s"}, ${scopeLabel} — not an automatic sq ft/step order)`,
                category: p.category || "other",
                measure_unit: "sqft",
                sqft: null,
                quantity: counted.quantity,
                length_in: null,
                width_in: null,
                unit: counted.unit,
                material_rate: sellMat(matCost),
                labor_rate: 0,
                material_cost: matCost,
                labor_cost: 0,
                waste_pct: 0,
                product_id: p.productId || null,
                manufacturer: p.source === "order" && p.vendor.trim() ? p.vendor.trim() : p.manufacturer,
                style: p.style,
                color: p.color,
                from_stock: p.source === "stock",
              });
            } else {
              out.push({
                room: null,
                description: `${p.label || "Stair wrap"} — wrap qty TBD (${steps} step${steps === 1 ? "" : "s"}, ${scopeLabel} — not an automatic sq ft/step order)`,
                category: p.category || "other",
                measure_unit: "sqft",
                sqft: null,
                quantity: null,
                length_in: null,
                width_in: null,
                unit: countUnit,
                material_rate: sellMat(matCost),
                labor_rate: 0,
                material_cost: matCost,
                labor_cost: 0,
                waste_pct: 0,
                product_id: p.productId || null,
                manufacturer: p.source === "order" && p.vendor.trim() ? p.vendor.trim() : p.manufacturer,
                style: p.style,
                color: p.color,
                from_stock: p.source === "stock",
              });
            }
          }
          const typedRate = numv(a.laborRate);
          const configPerStep = Number(q.config.labor_per_step);
          const lr =
            typedRate > 0
              ? typedRate
              : Number.isFinite(configPerStep) && configPerStep > 0
                ? configPerStep
                : 0;
          if (lr > 0) {
            out.push({
              room: null,
              description: `Stair install — ${steps} step${steps === 1 ? "" : "s"} (${scopeLabel})`,
              category: "labor",
              measure_unit: "sqft",
              sqft: null,
              quantity: steps,
              length_in: null,
              width_in: null,
              unit: "step",
              material_rate: 0,
              labor_rate: sellLab(lr),
              material_cost: 0,
              labor_cost: lr,
              waste_pct: 0,
              product_id: null,
              manufacturer: null,
              style: null,
              color: null,
              from_stock: false,
            });
          }
        }
      } else if (q.kind === "subfloor" && a.kind === "subfloor") {
        // Subfloor → SHEETS per room (ceil(area ÷ sheet coverage)) so nothing is
        // under-ordered. The builder prices it by the sheet. Field verify / TBD
        // does not invent a sheet count — the condition still rides in notes.
        // Review prints the sheet count — taped square feet is not a plywood order.
        if (prepQuantitiesAreFinal(flooringCtx.prepConfidence)) {
        const opts = q.config.options ?? [];
        const sheetSqft = resolvedSheetSqft(q.config.sheet_sqft);
        const opt = opts.find((o) => o.label === a.thickness) ?? opts[0];
        const perSheet = opt?.cost ?? 0;
        const suffix = prepQuantitySuffix(flooringCtx.prepConfidence);
        const prepRooms = roomsForPrepTakeoff({
          rooms: floorMapAssignments.rooms.length
            ? floorMapAssignments.rooms
            : allRooms.map((rm) => ({ room: rm, family: null })),
          jobFamilies: flooringCtx.families,
        });
        const prepCover = questionCoverSf({ kind: q.kind, key: q.key, category: q.config.category });
        const rooms = prepRooms.length
          ? prepRooms
          : prepCover > 0
            ? [{ name: "", sqft: prepCover, lenIn: null, widIn: null }]
            : [];
        if (sheetSqft != null) {
        for (const rm of rooms) {
          const sheets = subfloorSheets(rm.sqft, sheetSqft);
          if (sheets <= 0) continue;
          out.push({
            room: rm.name || null,
            description: `Subfloor${a.thickness ? ` ${a.thickness}` : ""}${rm.name ? ` — ${rm.name}` : ""}${suffix}`,
            category: "underlayment",
            measure_unit: "sqft",
            sqft: r2(rm.sqft),
            quantity: sheets,
            length_in: null,
            width_in: null,
            unit: "sheet",
            material_rate: sellMat(perSheet),
            labor_rate: 0,
            material_cost: perSheet,
            labor_cost: 0,
            waste_pct: 0,
            product_id: null,
            manufacturer: null,
            style: null,
            color: null,
            from_stock: false,
          });
        }
        }
        }
      } else if (q.kind === "selflevel" && a.kind === "selflevel") {
        // Self-leveler → BAGS from area ÷ coverage-at-thickness. Coverage is
        // carried so the builder's bag calculator stays live. (Labor is the prep
        // question's job — no double-charge here.) TBD prep does not emit a
        // fake bag count. Review prints the bag count — taped square feet is not a bag order.
        if (prepQuantitiesAreFinal(flooringCtx.prepConfidence)) {
        const cov = q.config.coverage_sqft ?? 0;
        const covT = q.config.coverage_thickness_in ?? 0;
        const pour = selfLevelPourThicknessIn(q.config, a.thickness);
        const bagCost = q.config.bag_cost ?? 0;
        const suffix = prepQuantitySuffix(flooringCtx.prepConfidence);
        const prepCover = questionCoverSf({ kind: q.kind, key: q.key, category: q.config.category });
        if (cov > 0 && prepCover > 0) {
          const bags = bagsNeeded(prepCover, cov, covT > 0 ? covT : null, covT > 0 ? pour : null);
          if (bags > 0)
            out.push({
              room: null,
              description: `Self-leveler${suffix}`,
              category: "other",
              measure_unit: "sqft",
              sqft: r2(prepCover),
              quantity: bags,
              length_in: null,
              width_in: null,
              unit: "bag",
              material_rate: sellMat(bagCost),
              labor_rate: 0,
              material_cost: bagCost,
              labor_cost: 0,
              waste_pct: 0,
              product_id: null,
              manufacturer: null,
              style: null,
              color: null,
              from_stock: false,
              coverage_sqft: cov,
              coverage_thickness_in: covT > 0 ? covT : null,
              prep_thickness_in: covT > 0 ? pour : null,
            });
        }
        }
      } else if (q.kind === "yesno" || q.kind === "number" || q.kind === "choice") {
        // Per-room prep: split into a job-default line for the remaining area +
        // one room-scoped line per flagged room (its own answer/area). Otherwise
        // one job-level line. Prep labor uses HS rooms on a mixed job — demo /
        // haul stay whole-job (the old floor is not the new family).
        const emitArea = emitAreaSqftForQuestion({
          key: q.key,
          kind: q.kind,
          purpose: questionPurpose(q),
          totalSqft,
          byFamily: floorMapAssignments.byFamily,
          jobFamilies: flooringCtx.families,
        });
        if (q.config.per_room && flaggedRooms.length) {
          const flaggedArea = flaggedRooms.reduce((s, r) => s + rowSqft(r), 0);
          const remaining = r2(Math.max(0, emitArea - flaggedArea));
          if (remaining > 0) out.push(...linesForAnswer(q, a, remaining, null));
          for (const r of flaggedRooms) {
            const ov = overrides[r.id]?.[q.id] ?? a;
            out.push(...linesForAnswer(q, ov, rowSqft(r), r.name || "Room"));
          }
        } else {
          out.push(...linesForAnswer(q, a, emitArea, null));
        }
      }
    }
    for (const q of questions) {
      if (!visible[q.id] || q.key !== "delivery_scope") continue;
      const a = answers[q.id];
      if (a?.kind !== "choice") continue;
      const cost = deliveryAddonCost(a.selected, addonDefaults.Delivery?.cost);
      if (cost == null) continue;
      out.push({
        room: null,
        description: "Delivery",
        category: "other",
        measure_unit: "sqft",
        sqft: null,
        quantity: 1,
        length_in: null,
        width_in: null,
        unit: "each",
        material_rate: sellMat(cost),
        labor_rate: 0,
        material_cost: cost,
        labor_cost: 0,
        waste_pct: 0,
        product_id: null,
        manufacturer: null,
        style: null,
        color: null,
        from_stock: false,
      });
    }
    // Cash & carry: strip ALL labor — drop dedicated labor lines, and zero any
    // labor embedded on a surviving material/trim line (e.g. trim R&R). The one
    // guarantee that a cash & carry quote is materials only.
    return cashCarry
      ? out
          .filter((l) => l.category !== "labor")
          .map((l) =>
            l.labor_rate || l.labor_cost
              ? { ...l, labor_rate: 0, labor_cost: 0 }
              : l,
          )
      : out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, answers, totalSqft, goal, visible, flaggedRooms, overrides, allRooms, cashCarry, cutsSqftByCategory, flooringCtx, addonDefaults, floorMapAssignments]);

  const notes = useMemo(() => {
    // "Job conditions" — flagged choice / yes-no answers (subfloor, tackless…)
    // that aren't line items but the crew needs on the work order.
    const conditions: string[] = [];
    const freeText: string[] = [];
    // Format one flagged answer as "Label: value" (or "" if unanswered).
    const condValue = (q: EstimateQuestion, a: Answer | undefined): string => {
      if (q.kind === "choice" && a?.kind === "choice") {
        // Selected option(s) plus any typed prep instructions.
        return [a.selected.filter((l) => choiceOptionApplies(q, l, flooringCtx)).join(", "), a.note?.trim()].filter(Boolean).join(" — ");
      }
      if (q.kind === "choice" && a?.kind === "yesno") return a.yes ? "Yes" : "No";
      if (q.kind === "yesno" && a?.kind === "yesno") return a.yes ? "Yes" : "No";
      if (q.kind === "number" && a?.kind === "number") return a.value.trim();
      if (q.kind === "stairs" && a?.kind === "stairs")
        return a.groups
          .filter((g) => numv(g.count) > 0)
          .map((g) => `${g.count} ${g.type || "steps"}`)
          .join("; ");
      if (q.kind === "hs_stairs" && a?.kind === "hs_stairs") {
        const n = Math.ceil(numv(a.steps));
        if (n <= 0) return "";
        return `${n} step${n === 1 ? "" : "s"} (${a.treadRiser ? "tread + riser" : "tread only"})`;
      }
      return "";
    };
    for (const q of questions) {
      if (!visible[q.id]) continue;
      const a = answers[q.id];
      if (q.kind === "text" && a?.kind === "text" && a.text.trim()) {
        freeText.push(`${q.label} ${a.text.trim()}`);
      } else if (q.config.note) {
        const v = condValue(q, a);
        if (v) conditions.push(`${q.label}: ${v}`);
      }
    }
    // Per-room prep: a flagged room's own answer to a per-room condition, so the
    // work order can show subfloor/moisture/etc. under that specific room.
    const roomPrep = new Map<string, string[]>();
    for (const q of questions) {
      if (!visible[q.id] || !q.config.note || !q.config.per_room) continue;
      for (const r of flaggedRooms) {
        const ov = overrides[r.id]?.[q.id];
        const v = condValue(q, ov);
        if (!v) continue;
        const rn = (r.name || "Room").trim();
        const arr = roomPrep.get(rn) ?? [];
        arr.push(`${q.label}: ${v}`);
        roomPrep.set(rn, arr);
      }
    }
    const blocks: string[] = [];
    if (conditions.length) blocks.push(`Job conditions:\n${conditions.map((c) => `• ${c}`).join("\n")}`);
    if (roomPrep.size)
      blocks.push(
        `Per-room prep:\n${[...roomPrep.entries()]
          .map(([rn, items]) => `• ${rn} — ${items.join("; ")}`)
          .join("\n")}`,
      );
    if (freeText.length) blocks.push(freeText.join("\n"));
    for (const q of questions) {
      if (!visible[q.id] || q.kind !== "hs_stairs") continue;
      const a = answers[q.id];
      if (a?.kind !== "hs_stairs") continue;
      const steps = Math.ceil(numv(a.steps));
      const lr = numv(a.laborRate) || (q.config.labor_per_sqft ?? 0);
      if (steps > 0 && !(lr > 0)) {
        blocks.push("Stair install labor rate: TBD — enter a Floor King rate in Builder rather than inventing one.");
      }
    }
    return blocks.join("\n\n");
  }, [questions, answers, visible, flaggedRooms, overrides]);

  // Risk flags derived from answers already given — gentle, dismissible, never
  // blocking. They also ride along as work-order notes unless dismissed.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const warnings = useMemo(() => {
    const w: { id: string; text: string }[] = [];
    const picked: string[] = [];
    for (const qq of questions) {
      if (!visible[qq.id]) continue;
      const a = answers[qq.id];
      if (a?.kind === "choice") picked.push(...a.selected);
      if (a?.kind === "choice_areas") picked.push(...a.rows.map((r) => r.option));
    }
    for (const roomOv of Object.values(overrides))
      for (const a of Object.values(roomOv)) if (a?.kind === "choice") picked.push(...a.selected);
    const hasCarpetCuts = (cutsSqftByCategory.carpet ?? 0) > 0;
    const hasVinylCuts = (cutsSqftByCategory.vinyl ?? 0) > 0;
    w.push(
      ...knowledgeWarnings(flooringCtx, {
        hasCuts: hasCarpetCuts,
        measuredSqft: totalSqft,
        byFamily: floorMapAssignments.byFamily,
        unassignedRoomSqft: floorMapAssignments.unassignedRoomSqft,
        pickedLabels: picked,
        hasVinylCuts,
        hsStairSteps: stairStepCountFromAnswers(answers, ["hs_stairs"]),
        hasStairNose: answersHaveTrimType(answers, /stair\s*nose/i),
        neededTransitionTrims: hsTransitionTrims,
        neededBaseTrims: hsBaseTrims,
        presentTrimTypes: presentTrimTypes(answers),
      }),
    );

    const areaRows: AreaRow[] = [];
    for (const qq of questions) {
      if (qq.kind !== "areas") continue;
      const ar = answers[qq.id];
      if (ar?.kind === "areas") areaRows.push(...ar.rooms);
    }
    const rects = measuredRectsFromRooms(
      areaRows.map((r) => ({
        name: r.name,
        lengthFt: numv(r.lf),
        lengthIn: numv(r.li),
        widthFt: numv(r.wf),
        widthIn: numv(r.wi),
        sqftOverride: numv(r.override),
        sections: (r.sections ?? []).map((s) => ({
          name: s.name,
          lengthFt: numv(s.lf),
          lengthIn: numv(s.li),
          widthFt: numv(s.wf),
          widthIn: numv(s.wi),
        })),
      })),
    );
    const catalogWidths: { carpet: number[]; vinyl: number[] } = { carpet: [], vinyl: [] };
    const roomFamily = new Map<string, "carpet" | "vinyl" | "other">();
    const takeWidth = (p: ProductAns | null | undefined) => {
      if (!(p?.rollWidthFt && p.rollWidthFt > 0)) return;
      const fam = familyFromCatalogCategory(p.category);
      if (fam === "carpet" || fam === "vinyl") catalogWidths[fam].push(p.rollWidthFt);
    };
    for (const qq of questions) {
      if (!visible[qq.id]) continue;
      const a = answers[qq.id];
      if (a?.kind === "product") {
        takeWidth(a.product);
        for (const x of a.extras) takeWidth(x.product);
      } else if (a?.kind === "cuts") {
        takeWidth(a.product);
        for (const g of a.groups) takeWidth(g.product);
      } else if (a?.kind === "floor_map") {
        allRooms.forEach((rm, i) => {
          const p = a.byRoom[roomKey(rm.name, i)];
          takeWidth(p);
          const fam = familyFromCatalogCategory(p?.category);
          if (fam === "carpet" || fam === "vinyl") roomFamily.set(rm.name, fam);
          else if (p?.category) roomFamily.set(rm.name, "other");
        });
      }
    }
    const patternMatch = picked.some((l) => /pattern match required/i.test(l));
    const rectsFor = (fam: "carpet" | "vinyl") => {
      if (roomFamily.size) {
        return rects.filter((r) => {
          const base = r.name.split(" / ")[0] ?? r.name;
          return roomFamily.get(r.name) === fam || roomFamily.get(base) === fam;
        });
      }
      return flooringCtx.families.includes(fam) ? rects : [];
    };
    w.push(
      ...(rollGoodsNeedCuts("carpet", carpetInstallSystemsFromLabels(flooringCtx.answeredCarpetInstall))
        ? rollGoodsSeamWarnings({
            family: "carpet",
            catalogWidthsFt: catalogWidths.carpet,
            rooms: rectsFor("carpet"),
            patternMatch,
            hasCuts: hasCarpetCuts,
          })
        : []),
      ...rollGoodsSeamWarnings({
        family: "vinyl",
        catalogWidthsFt: catalogWidths.vinyl,
        rooms: rectsFor("vinyl"),
        hasCuts: hasVinylCuts,
      }),
    );
    // Dedupe by id so overlay + local flags don't double.
    const seen = new Set<string>();
    return w.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  }, [questions, answers, visible, overrides, flooringCtx, cutsSqftByCategory, totalSqft, hsTransitionTrims, hsBaseTrims, allRooms, floorMapAssignments]);

  const grand = lines.reduce((s, l) => s + lineTotal(smartLineToCalcLine(l)), 0);

  const salespersonReview = useMemo(() => {
    const rooms: ReviewRoom[] = [];
    for (const qq of questions) {
      if (qq.kind !== "areas" || !visible[qq.id]) continue;
      const a = answers[qq.id];
      if (a?.kind !== "areas") continue;
      for (const r of a.rooms) {
        const sf = rowSqft(r);
        if (sf <= 0 && !r.name.trim()) continue;
        const sections = [];
        const primary = sectionSqft({ lf: r.lf, li: r.li, wf: r.wf, wi: r.wi });
        if (primary > 0) {
          sections.push({
            name: "Section A",
            length: formatDimensionPair(numv(r.lf), numv(r.li), 0, 0).replace(" × ", "") || `${r.lf}' ${r.li || "0"}"`,
            width: `${r.wf || "0"}' ${r.wi || "0"}"`,
            sqft: primary,
          });
          // Prefer the dedicated formatter when both sides exist.
          const pair = formatDimensionPair(numv(r.lf), numv(r.li), numv(r.wf), numv(r.wi));
          if (pair) {
            sections[0].length = pair.split(" × ")[0] ?? sections[0].length;
            sections[0].width = pair.split(" × ")[1] ?? sections[0].width;
          }
        }
        for (const s of r.sections ?? []) {
          const ssf = sectionSqft(s);
          if (ssf <= 0) continue;
          const pair = formatDimensionPair(numv(s.lf), numv(s.li), numv(s.wf), numv(s.wi));
          const [len, wid] = pair ? pair.split(" × ") : ["", ""];
          sections.push({ name: s.name || "Section", length: len, width: wid, sqft: ssf });
        }
        rooms.push({ name: r.name || "Room", measuredSqft: sf, sections });
      }
    }
    const products: string[] = [];
    const extraCountReview: string[] = [];
    const prepCountReview: string[] = [];
    const takeoffs = [];
    const seenProd = new Set<string>();
    const familySqft = floorMapAssignments.byFamily;
    const measuredFor = (family: ReturnType<typeof familyFromCatalogCategory>, override?: number) => {
      if (override != null && override > 0) return override;
      return measuredSqftForFamilyTakeoff({
        family,
        totalSqft,
        byFamily: familySqft,
        jobFamilies: flooringCtx.families,
      });
    };
    const addProduct = (
      label: string,
      category: string | null,
      wastePct: string,
      sqftPerBox: string,
      measuredSqft?: number,
      key?: string | null,
      productUnit?: string | null,
    ) => {
      if (!label) return;
      const already = seenProd.has(label);
      if (!already) {
        seenProd.add(label);
        products.push(label);
      } else if (measuredSqft == null) {
        return;
      }
      const family = familyFromCatalogCategory(category);
      const padLabel = padFoamTakeoffLabel({ key, category });
      const isPadOrFoam = Boolean(padLabel);
      if (family === "other" && !isPadOrFoam) return;
      // Count / TBD main pad skips area Review takeoff — leftover / job sq ft
      // is not pad yards and not a 30-yard roll.
      if (
        isPadOrFoam &&
        !areaDerivedMaterialAllowed(
          family,
          productUnit,
          carpetInstallSystemsFromLabels(flooringCtx.answeredCarpetInstall),
        )
      ) {
        return;
      }
      // Review does not print taped square feet as the order when carton coverage is missing.
      if (
        boxedCartonCoverageTbdDescription({
          family,
          productUnit,
          sqftPerBox: numv(sqftPerBox) > 0 ? numv(sqftPerBox) : null,
          label,
          carpetInstallSystems: carpetInstallSystemsFromLabels(
            flooringCtx.answeredCarpetInstall,
          ),
        })
      ) {
        return;
      }
      const waste = wastePct.trim() !== "" ? numv(wastePct) : isPadOrFoam ? 0 : undefined;
      const cover = isPadOrFoam
        ? measuredSqft != null && measuredSqft > 0
          ? measuredSqft
          : measuredSqftForQuestionCover({
              kind: "product",
              key,
              category,
              totalSqft,
              byFamily: familySqft,
              jobFamilies: flooringCtx.families,
            })
        : measuredFor(family, measuredSqft);
      takeoffs.push(
        computeMaterialTakeoff({
          family,
          measuredSqft: cover,
          wastePct: waste,
          cutsSqft: family === "carpet" ? cutsSqftByCategory.carpet ?? 0 : family === "vinyl" ? cutsSqftByCategory.vinyl ?? 0 : null,
          sqftPerBox: numv(sqftPerBox) > 0 ? numv(sqftPerBox) : null,
          carpetSystems: family === "carpet" ? carpetInstallSystemsFromLabels(flooringCtx.answeredCarpetInstall) : null,
          billingUnit: isPadOrFoam
            ? billingUnitForArea({ category, key, productUnit })
            : undefined,
          takeoffLabel: padLabel,
        }),
      );
    };
    for (const qq of questions) {
      if (!visible[qq.id]) continue;
      const a = answers[qq.id];
      if (a?.kind === "product" && a.product) {
        addProduct(
          a.product.label,
          a.product.category,
          a.product.wastePct,
          a.product.sqftPerBox,
          undefined,
          qq.key,
          a.product.unit,
        );
        const mainFam = familyFromCatalogCategory(a.product.category);
        const mainSystems = carpetInstallSystemsFromLabels(
          flooringCtx.answeredCarpetInstall,
        );
        // Leftover How many is not a second Review order when carton coverage
        // still takeoffs from measured area. Missing coverage stays TBD.
        if (
          !boxedCartonAreaTakeoffAllowed({
            family: mainFam,
            productUnit: a.product.unit,
            sqftPerBox: numv(a.product.sqftPerBox),
            carpetInstallSystems: mainSystems,
          })
        ) {
          const mainCountLine =
            extraCountReviewLine({
              family: mainFam,
              productUnit: a.product.unit,
              qty: numv(a.qty ?? ""),
              label: a.product.label,
              carpetInstallSystems: mainSystems,
            }) ??
            boxedCartonCoverageTbdDescription({
              family: mainFam,
              productUnit: a.product.unit,
              sqftPerBox: numv(a.product.sqftPerBox),
              label: a.product.label,
              carpetInstallSystems: mainSystems,
            });
          if (mainCountLine) extraCountReview.push(mainCountLine);
        }
        // Count / TBD extras skip area Review takeoff — leftover measured sq ft
        // is not pad yards and not an order. Do not plant leftover sq ft.
        // Typed How many rides onto Review as that count — not leftover sq ft and not a 30-yard roll.
        for (const ex of a.extras) {
          if (!ex.product?.label) continue;
          const exFam = familyFromCatalogCategory(
            ex.product.category || qq.config.category || a.product.category,
          );
          const extraSf = extraMeasuredSqftForTakeoff({
            family: exFam,
            productUnit: ex.product.unit,
            measuredSqft: numv(ex.sqft),
            carpetInstallSystems: carpetInstallSystemsFromLabels(
              flooringCtx.answeredCarpetInstall,
            ),
          });
          if (extraSf != null) {
            addProduct(
              ex.product.label,
              ex.product.category || qq.config.category || a.product.category,
              ex.product.wastePct,
              ex.product.sqftPerBox,
              extraSf,
              qq.key,
              ex.product.unit,
            );
            continue;
          }
          const countedLine = extraCountReviewLine({
            family: exFam,
            productUnit: ex.product.unit,
            qty: numv(ex.qty ?? ""),
            label: ex.product.label,
            carpetInstallSystems: carpetInstallSystemsFromLabels(
              flooringCtx.answeredCarpetInstall,
            ),
          });
          if (!countedLine) continue;
          if (!seenProd.has(ex.product.label)) {
            seenProd.add(ex.product.label);
            products.push(ex.product.label);
          }
          extraCountReview.push(countedLine);
        }
      } else if (a?.kind === "cuts") {
        const p = a.same !== false ? a.product : a.groups.map((g) => g.product).find(Boolean) ?? null;
        if (p) {
          addProduct(
            p.label,
            p.category || qq.config.category || "carpet",
            p.wastePct,
            p.sqftPerBox,
            undefined,
            qq.key,
            p.unit,
          );
          const cutTbd = boxedCartonCoverageTbdDescription({
            family: familyFromCatalogCategory(p.category || qq.config.category || "carpet"),
            productUnit: p.unit,
            sqftPerBox: numv(p.sqftPerBox),
            label: p.label,
            carpetInstallSystems: carpetInstallSystemsFromLabels(
              flooringCtx.answeredCarpetInstall,
            ),
          });
          if (cutTbd) extraCountReview.push(cutTbd);
        }
        else {
          const fam = qq.config.category === "vinyl" ? "vinyl" : "carpet";
          const cutSf = fam === "vinyl" ? cutsSqftByCategory.vinyl ?? 0 : cutsSqftByCategory.carpet ?? 0;
          if (cutSf > 0) {
            takeoffs.push(
              computeMaterialTakeoff({
                family: fam,
                measuredSqft: measuredFor(fam),
                cutsSqft: cutSf,
                carpetSystems: fam === "carpet" ? carpetInstallSystemsFromLabels(flooringCtx.answeredCarpetInstall) : null,
              }),
            );
          }
        }
      } else if (a?.kind === "floor_map") {
        const assigned = allRooms
          .map((rm, i) => {
            const p = a.byRoom[roomKey(rm.name, i)];
            if (!p || rm.sqft <= 0) return null;
            return {
              label: p.label,
              category: p.category,
              wastePct: p.wastePct,
              sqftPerBox: p.sqftPerBox,
              measuredSqft: rm.sqft,
              unit: p.unit,
            };
          })
          .filter((x): x is NonNullable<typeof x> => !!x);
        const sqftByLabel = groupMeasuredSqftByLabel(assigned);
        const seen = new Set<string>();
        for (const p of assigned) {
          if (seen.has(p.label)) continue;
          seen.add(p.label);
          addProduct(
            p.label,
            p.category,
            p.wastePct,
            p.sqftPerBox,
            sqftByLabel[p.label] ?? p.measuredSqft,
            undefined,
            p.unit,
          );
          const mapTbd = boxedCartonCoverageTbdDescription({
            family: familyFromCatalogCategory(p.category),
            productUnit: p.unit,
            sqftPerBox: numv(p.sqftPerBox),
            label: p.label,
            carpetInstallSystems: carpetInstallSystemsFromLabels(
              flooringCtx.answeredCarpetInstall,
            ),
          });
          if (mapTbd) extraCountReview.push(mapTbd);
        }
      } else if (a?.kind === "hs_stairs" && a.product) {
        const wrapLine = extraCountReviewLine({
          family: familyFromCatalogCategory(a.product.category),
          productUnit: a.product.unit,
          qty: numv(a.qty ?? ""),
          label: a.product.label,
        });
        if (wrapLine) {
          if (!seenProd.has(a.product.label)) {
            seenProd.add(a.product.label);
            products.push(a.product.label);
          }
          extraCountReview.push(wrapLine);
        }
      } else if (a?.kind === "selflevel") {
        // Review prints the bag count — taped square feet is not a bag order.
        if (prepQuantitiesAreFinal(flooringCtx.prepConfidence)) {
          const cov = qq.config.coverage_sqft ?? 0;
          const covT = qq.config.coverage_thickness_in ?? 0;
          const pour = selfLevelPourThicknessIn(qq.config, a.thickness);
          const prepCover = questionCoverSf({
            kind: qq.kind,
            key: qq.key,
            category: qq.config.category,
          });
          const bags =
            cov > 0 && prepCover > 0
              ? bagsNeeded(prepCover, cov, covT > 0 ? covT : null, covT > 0 ? pour : null)
              : 0;
          const bagLine = prepCountReviewLine({
            label: "Self-leveler",
            qty: bags,
            unit: "bag",
          });
          if (bagLine) prepCountReview.push(bagLine);
        }
      } else if (a?.kind === "subfloor") {
        // Review prints the sheet count — taped square feet is not a plywood order.
        if (prepQuantitiesAreFinal(flooringCtx.prepConfidence)) {
          const sheetSqft = resolvedSheetSqft(qq.config.sheet_sqft);
          if (sheetSqft != null) {
            const prepRooms = roomsForPrepTakeoff({
              rooms: floorMapAssignments.rooms.length
                ? floorMapAssignments.rooms
                : allRooms.map((rm) => ({ room: rm, family: null })),
              jobFamilies: flooringCtx.families,
            });
            const prepCover = questionCoverSf({
              kind: qq.kind,
              key: qq.key,
              category: qq.config.category,
            });
            const rooms = prepRooms.length
              ? prepRooms
              : prepCover > 0
                ? [{ name: "", sqft: prepCover, lenIn: null, widIn: null }]
                : [];
            let sheets = 0;
            for (const rm of rooms) sheets += subfloorSheets(rm.sqft, sheetSqft);
            const sheetLine = prepCountReviewLine({
              label: a.thickness ? `Subfloor ${a.thickness}` : "Subfloor",
              qty: sheets,
              unit: "sheet",
            });
            if (sheetLine) prepCountReview.push(sheetLine);
          }
        }
      }
    }
    if (!takeoffs.length && totalSqft > 0) {
      const flooring = flooringCtx.families.filter((f) => f !== "other");
      if (flooring.length === 1) {
        const f = flooring[0];
        takeoffs.push(
          computeMaterialTakeoff({
            family: f,
            measuredSqft: measuredFor(f),
            cutsSqft:
              f === "carpet"
                ? cutsSqftByCategory.carpet || null
                : f === "vinyl"
                  ? cutsSqftByCategory.vinyl || null
                  : null,
            carpetSystems: f === "carpet" ? carpetInstallSystemsFromLabels(flooringCtx.answeredCarpetInstall) : null,
          }),
        );
      }
    }
    const condValue = (q: EstimateQuestion, a: Answer | undefined): string => {
      if (q.kind === "choice" && a?.kind === "choice")
        return [a.selected.filter((l) => choiceOptionApplies(q, l, flooringCtx)).join(", "), a.note?.trim()].filter(Boolean).join(" — ");
      if (q.kind === "choice" && a?.kind === "yesno") return a.yes ? "Yes" : "No";
      if (q.kind === "yesno" && a?.kind === "yesno") return a.yes ? "Yes" : "No";
      if (q.kind === "text" && a?.kind === "text") return a.text.trim();
      if (q.kind === "number" && a?.kind === "number") return a.value.trim();
      if (q.kind === "stairs" && a?.kind === "stairs")
        return a.groups
          .filter((g) => numv(g.count) > 0)
          .map((g) => `${g.count} ${g.type || "steps"}`)
          .join("; ");
      if (q.kind === "hs_stairs" && a?.kind === "hs_stairs") {
        const n = Math.ceil(numv(a.steps));
        if (n <= 0) return "";
        return `${n} step${n === 1 ? "" : "s"} (${a.treadRiser ? "tread + riser" : "tread only"})`;
      }
      if (q.kind === "product" && a?.kind === "trims")
        return a.rows
          .filter((r) => (r.type || r.product) && numv(r.qty) > 0)
          .map((r) => `${r.type || r.product?.label}: ${r.qty} ${coerceTrimUnit(r.type, r.unit)}`)
          .join("; ");
      return "";
    };
    const removal: string[] = [];
    const installation: string[] = [];
    const prep: string[] = [];
    const accessories: string[] = [];
    const specials: string[] = [];
    const buckets: Record<"removal" | "installation" | "prep" | "accessories" | "specials", string[]> = {
      removal,
      installation,
      prep,
      accessories,
      specials,
    };
    for (const q of questions) {
      if (!visible[q.id]) continue;
      const v = condValue(q, answers[q.id]);
      if (!v) continue;
      buckets[reviewBucketForQuestion(q)].push(`${q.label}: ${v}`);
    }
    if (flooringCtx.installLabels.length)
      installation.unshift(`System: ${flooringCtx.installLabels.join(", ")}`);
    accessories.push(...extraCountReview);
    prep.push(...prepCountReview);
    return buildSalespersonReview({
      rooms,
      products,
      takeoffs,
      ctx: flooringCtx,
      removal,
      installation,
      prep,
      accessories,
      specials,
      extraWarnings: warnings.filter((w) => !dismissed.has(w.id)),
      suppressedWarningIds: dismissed,
    });
  }, [questions, answers, visible, totalSqft, cutsSqft, cutsSqftByCategory, flooringCtx, allRooms, warnings, dismissed, floorMapAssignments]);

  // Steps: the currently-visible questions (conditionals reveal as you answer),
  // plus a final Review step.
  /**
   * Moving between questions.
   *
   * setStep on its own changed the content and left your scroll position where
   * it was — so answering a long question (eight rooms, a cuts editor, a trim
   * list) and pressing Next dropped you at the BOTTOM of the next one, past its
   * title, sometimes on blank space. Nothing told you the question had changed.
   *
   * Every move now goes through here: put the new question's heading at the top
   * of the view, and mark it so it can announce itself.
   */
  const cardRef = useRef<HTMLDivElement | null>(null);
  const goTo = (next: number) => {
    setStep(next);
    // After React paints the new question, not before.
    requestAnimationFrame(() => {
      const el = cardRef.current;
      if (!el) return;
      const y = el.getBoundingClientRect().top + window.scrollY - 84; // clear the header
      window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    });
  };
  const total = stepQuestions.length;
  // Estimator phases in walk order — SQL section names mixed Carpet/Hard surface
  // and did not match Area → Product → Measure → Existing → Installation → Prep.
  const sectionRail = useMemo(() => {
    const seen = new Map<string, number>();
    stepQuestions.forEach((sq, i) => {
      const name = phaseName(sq);
      if (name && !seen.has(name)) seen.set(name, i);
    });
    return [...seen.entries()].map(([name, firstIndex]) => ({ name, firstIndex }));
  }, [stepQuestions, phaseById]);
  const atReview = step >= total;
  const q = atReview ? null : stepQuestions[step];
  const currentQuestionIdRef = useRef<string | null>(null);
  if (q) currentQuestionIdRef.current = q.id;
  useEffect(() => {
    if (step >= stepQuestions.length) return;
    const id = currentQuestionIdRef.current;
    if (!id) return;
    const idx = stepQuestions.findIndex((sq) => sq.id === id);
    if (idx >= 0 && idx !== step) setStep(idx);
  }, [stepQuestions, step]);
  const answered = (qq: EstimateQuestion): boolean => {
    const a = answers[qq.id];
    if (qq.kind === "areas") return a?.kind === "areas" && a.rooms.some((r) => rowSqft(r) > 0);
    if (qq.kind === "floor_map")
      return a?.kind === "floor_map" && Object.values(a.byRoom).some(Boolean);
    if (qq.kind === "product")
      return (
        (a?.kind === "product" && !!a.product) ||
        (a?.kind === "trims" && a.rows.some((r) => (r.product || r.type) && numv(r.qty) > 0))
      );
    return true; // yesno/number/choice/text are always "answerable"
  };
  const canNext = !q || !q.required || answered(q);
  const requiredDone = stepQuestions.every((sq) => !sq.required || answered(sq));

  const save = (blankCatalogPrices = false) =>
    startSave(async () => {
      const raw = lines.filter((l) => l.description.trim());
      if (!raw.length) {
        toast.error("Answer a few questions first — add areas and a product.");
        return;
      }
      // "I'll set prices in the builder" → clear the SELL rate off every catalog
      // material line so nothing wrong-priced is carried in. The structure,
      // cuts, quantities and labor all stay.
      //
      // material_COST is deliberately KEPT. It's not a price — it's what the
      // material costs you, and it's the one number you're not overriding.
      // Clearing it too meant arriving in the builder with no cost on any line,
      // so every margin read 100% and the margin slider had nothing to price
      // from — you'd have to re-enter the cost of every product by hand.
      const built = blankCatalogPrices
        ? raw.map((l) =>
            l.product_id && l.category !== "labor"
              ? { ...l, material_rate: 0 }
              : l,
          )
        : raw;
      // Save the measured areas to the customer (their dashboard card) first —
      // createSmartEstimate redirects on success.
      const areaRooms: AreaRow[] = [];
      for (const qq of questions) {
        if (qq.kind !== "areas") continue;
        const aa = answers[qq.id];
        if (aa?.kind === "areas") areaRooms.push(...aa.rooms);
      }
      const usable = areaRooms.filter((r) => rowSqft(r) > 0 || r.name.trim());
      if (usable.length) {
        await replaceCustomerAreas(
          customerId,
          usable.map((r) => {
            const usingCalc = numv(r.override) > 0;
            return {
              name: r.name,
              length_in: usingCalc ? null : Math.round(feetIn(r.lf, r.li) * 12) || null,
              width_in: usingCalc ? null : Math.round(feetIn(r.wf, r.wi) * 12) || null,
              sqft: rowSqft(r) || null,
              differs: r.differs,
            };
          }),
        );
      }
      // Active flags ride inside salespersonReview.warnings → reviewToJobNotes.
      // Do not concatenate a second "Flags to confirm" block.
      const takeoffText = reviewToJobNotes(salespersonReview);
      const jobDesc = [notes.trim(), takeoffText].filter(Boolean).join("\n\n");
      const res = await createSmartEstimate({
        customerId,
        title: `Flooring for ${customerName}`,
        taxRate: 8,
        lines: built,
        presentation: "detailed",
        jobDescription: jobDesc || undefined,
        serviceAddressId: serviceAddressId || null,
        openEdit: true,
        targetMargin: goal,
      });
      if (res?.error) toast.error(res.error);
    });

  if (!questions.length) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No estimate questions set up yet"
        description={
          <>
            Add them in{" "}
            <span className="font-medium">Settings → Estimate questionnaire</span>.
          </>
        }
      />
    );
  }

  return (
    <div className="space-y-4" data-tour="questionnaire">
      {resumed ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">↩ Resumed your saved progress.</span>
          <button
            type="button"
            onClick={startOver}
            className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Start over
          </button>
        </div>
      ) : null}
      {/* Cash & carry — materials only, no labor. Hides every labor question and
          strips labor from the quote. */}
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
        <span>
          <span className="font-medium">Cash &amp; carry</span>
          <span className="ml-2 text-muted-foreground">
            Materials only — no labor{cashCarry ? " (labor questions hidden)" : ""}
          </span>
        </span>
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={cashCarry}
          onChange={(e) => setCashCarry(e.target.checked)}
        />
      </label>
      {/*
        Section rail — where you are in the whole thing, and a way back.
    
        A bare "12 / 27" tells you how far along you are but nothing about what
        is left or how to get back to something you want to change. Going back
        six questions meant pressing Back six times. Sections you've reached are
        one tap.
      */}
      {sectionRail.length > 1 ? (
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {sectionRail.map((s) => {
            const isCurrent = s.name === phaseName(q);
            const reached = s.firstIndex <= step;
            return (
              <button
                key={s.name}
                type="button"
                disabled={!reached}
                onClick={() => goTo(s.firstIndex)}
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                  isCurrent
                    ? "bg-primary text-primary-foreground"
                    : reached
                      ? "bg-muted text-foreground hover:bg-muted/70"
                      : "text-muted-foreground/50",
                )}
              >
                {s.name}
              </button>
            );
          })}
          <button
            type="button"
            disabled={!requiredDone}
            onClick={() => goTo(total)}
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              atReview
                ? "bg-primary text-primary-foreground"
                : requiredDone
                  ? "bg-muted text-foreground hover:bg-muted/70"
                  : "text-muted-foreground/50",
            )}
          >
            Review
          </button>
        </div>
      ) : null}

      {salespersonReview.takeoffs.some((t) => t.measured.sqft > 0 || t.orderSqft > 0) ? (
        <div className="space-y-1.5 rounded-lg border bg-muted/20 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Running takeoff — measured is not order quantity
          </div>
          {salespersonReview.takeoffs.map((t, i) =>
            t.measured.sqft > 0 || t.orderSqft > 0 ? (
              <p key={`${t.family}-${i}`} className="text-xs leading-snug">
                <span className="font-semibold">{takeoffDisplayTitle(t)}</span>
                {" · "}
                {formatTakeoffStrip(t)}
              </p>
            ) : null,
          )}
        </div>
      ) : null}

      {/* Progress */}
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${(Math.min(step, total) / total) * 100}%` }} />
        </div>
        {/* Auto-save status — proof it's saving as you go. */}
        <span
          className={cn(
            "shrink-0 text-xs tabular-nums",
            draftStatus === "error" ? "font-medium text-destructive" : "text-muted-foreground",
          )}
          aria-live="polite"
        >
          {draftStatus === "saving"
            ? "Saving…"
            : draftStatus === "saved"
              ? "✓ Saved"
              : draftStatus === "error"
                ? "⚠ Couldn't save — check connection"
                : ""}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {atReview ? "Review" : `${step + 1} / ${total}`}
        </span>
      </div>

      {q ? (
        <Card
          ref={cardRef}
          key={q.id}
          className="animate-in fade-in slide-in-from-bottom-2 border-primary/20 duration-200"
        >
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">{phaseName(q)}</div>
              <h2 className="text-lg font-semibold sm:text-xl">
                {q.required ? <span className="text-amber-600">★ </span> : null}
                {q.label}
              </h2>
              {q.help ? <p className="mt-1 text-sm text-muted-foreground">{q.help}</p> : null}
              {knowledgeHelpFor(q, flooringCtx) ? (
                <p className="mt-1 text-sm text-primary/90">{knowledgeHelpFor(q, flooringCtx)}</p>
              ) : null}
            </div>

            <QuestionBody
              q={q}
              answer={answers[q.id]}
              set={(a) => set(q.id, a)}
              update={(fn) => setAnswers((p) => ({ ...p, [q.id]: fn(p[q.id]) }))}
              sellMat={sellMat}
              sellLab={sellLab}
              totalSqft={totalSqft}
              familySqft={floorMapAssignments.byFamily}
              perRoom={prepByRoom ? perRoomQuestions : []}
              overrides={overrides}
              setRoomOverride={setRoomOverride}
              jobAnswers={answers}
              floorRooms={allRooms}
              prepRooms={roomsForPrepTakeoff({
                rooms: floorMapAssignments.rooms.length
                  ? floorMapAssignments.rooms
                  : allRooms.map((rm) => ({ room: rm, family: null })),
                jobFamilies: flooringCtx.families,
              })}
              flooringCtx={flooringCtx}
              hsTransitionTrims={hsTransitionTrims}
              hsBaseTrims={hsBaseTrims}
              cutsSqftByCategory={cutsSqftByCategory}
              goToAreas={() => {
                const i = stepQuestions.findIndex((sq) => sq.kind === "areas");
                if (i >= 0) goTo(i);
              }}
            />
          </CardContent>
        </Card>
      ) : (
        // Review
        <Card>
          <CardContent className="space-y-3 p-4">
            {salespersonReview.warnings.length ? (
              <div className="space-y-2">
                {salespersonReview.warnings.map((w) => (
                  <div key={w.id} className="flex items-start gap-2 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm dark:border-amber-500/40 dark:bg-amber-950/30">
                    <span className="shrink-0 text-amber-600">⚠</span>
                    <span className="min-w-0 flex-1 text-amber-800 dark:text-amber-200">{w.text}</span>
                    <button type="button" onClick={() => setDismissed((s) => new Set(s).add(w.id))}
                      className="shrink-0 text-xs font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-300">
                      Dismiss
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="text-sm font-semibold">Review before Builder</div>
            <p className="text-xs text-muted-foreground">
              Measured area is what you taped. Waste, order quantity, billing quantity, and unit of
              measure are listed separately. sq ft ÷ 9 is equivalent area, not a yard order. Carton
              counts appear only when the product has coverage on file.
            </p>
            {salespersonReview.sections.map((sec) => (
              <div key={sec.id} className="rounded-lg border bg-muted/20 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {sec.title}
                </div>
                <dl className="mt-1.5 space-y-1 text-sm">
                  {sec.rows.map((row, i) => (
                    <div key={`${sec.id}-${i}`} className="flex items-start justify-between gap-3">
                      <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
                      <dd
                        className={
                          row.tone === "warn"
                            ? "text-right text-amber-800 dark:text-amber-200"
                            : row.tone === "ok"
                              ? "text-right font-medium"
                              : "text-right"
                        }
                      >
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
            <div className="text-sm font-semibold">Estimate lines</div>
            {lines.length ? (
              <div className="divide-y text-sm">
                {lines.map((l, i) => {
                  const fam = familyFromCatalogCategory(l.category);
                  const rollOrderTbd =
                    isRollGoodsFamily(fam) &&
                    rollGoodsNeedCuts(fam, carpetInstallSystemsFromLabels(flooringCtx.answeredCarpetInstall)) &&
                    !(l.measurements && l.measurements.length);
                  return (
                  <div key={i} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0">
                      <span className="truncate">{l.description}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {rollOrderTbd
                          ? `${l.sqft ? `measured ${l.sqft} sq ft` : ""} · order TBD (enter cuts — not sq ft ÷ 9)`
                          : `${l.quantity} ${lineDisplayUnit(l)}${
                              l.sqft ? ` · measured ${l.sqft} sq ft` : ""
                            }${l.waste_pct ? ` · ${l.waste_pct}% waste` : ""}`}
                        {l.from_stock ? " · from stock" : ""}
                        {l.category === "labor" ? " · labor" : ""}
                      </span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatMoney(lineTotal(smartLineToCalcLine(l)))}
                    </span>
                  </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No line items yet — go back and add areas and a product.</p>
            )}
            <div className="flex items-center justify-between border-t pt-3 text-base">
              <span className="text-muted-foreground">Subtotal (before tax)</span>
              <span className="font-bold tabular-nums">{formatMoney(grand)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              <Sparkles className="mr-1 inline size-3.5 text-primary" />
              Building opens the full estimate so you can review every line, adjust prices, and send — nothing is finalized yet.
            </p>
            <Button
              type="button"
              size="lg"
              className="w-full"
              onClick={() => setPriceCheck(true)}
              disabled={saving}
            >
              {saving ? "Building…" : "Continue to Builder →"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Catalog prices can be off — confirm them, or carry the job into the
          builder unpriced and set the real prices there. */}
      <Dialog open={priceCheck} onOpenChange={setPriceCheck}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Are these catalog prices accurate?</DialogTitle>
            <DialogDescription>
              This estimate is priced from your catalog
              {grand > 0 ? (
                <>
                  {" "}
                  — <span className="font-semibold text-foreground">{formatMoney(grand)}</span>{" "}
                  before tax
                </>
              ) : null}
              . If the catalog price looks off, build it now and set the real
              prices in the builder instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              type="button"
              className="w-full"
              onClick={() => {
                setPriceCheck(false);
                save(false);
              }}
            >
              Prices are right — use them
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                setPriceCheck(false);
                save(true);
              }}
            >
              I&apos;ll set prices in the builder
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setPriceCheck(false)}
            >
              Keep answering
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        Nav — pinned to the bottom of the screen.
    
        It used to sit in the page flow after the question. On a question with
        eight rooms or a full trim list that put "Next" a long scroll away, so
        the rhythm of the whole thing became: answer, hunt for the button,
        press, get lost. It stays put now, and says WHY it's disabled instead of
        leaving you to work it out from a greyed-out button.
      */}
      <div className="sticky bottom-0 z-10 -mx-1 mt-2 border-t bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="ghost" onClick={() => goTo(Math.max(0, step - 1))} disabled={step === 0}>
            <ArrowLeft className="size-4" /> Back
          </Button>
          <span className="min-w-0 flex-1 text-center text-xs text-muted-foreground">
            {atReview
              ? `${lines.length} line item${lines.length === 1 ? "" : "s"}`
              : !canNext
                ? <span className="font-medium text-amber-600">Answer this one to carry on</span>
                : phaseName(q)}
          </span>
          {atReview ? (
            <span className="w-[5.5rem]" />
          ) : (
            <div className="flex items-center gap-2">
              {requiredDone ? (
                <Button type="button" variant="ghost" onClick={() => goTo(total)}>
                  Review
                </Button>
              ) : null}
              <Button type="button" onClick={() => goTo(step + 1)} disabled={!canNext}>
                {step === total - 1 ? "Review" : "Next"} <ArrowRight className="size-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- One question's input, by kind -----------------------------------------
function QuestionBody({
  q,
  answer,
  set,
  update,
  sellMat,
  sellLab,
  totalSqft,
  familySqft = {},
  perRoom = [],
  overrides = {},
  setRoomOverride,
  jobAnswers = {},
  floorRooms = [],
  prepRooms = [],
  goToAreas,
  flooringCtx = emptyInstallContext(),
  cutsSqftByCategory = {},
  hsTransitionTrims = [],
  hsBaseTrims = [],
}: {
  q: EstimateQuestion;
  answer: Answer | undefined;
  set: (a: Answer) => void;
  /** Functional update of THIS question's answer — reads the latest state, so a
   *  fast edit can never be overwritten by a stale render-closure snapshot. */
  update: (fn: (prev: Answer | undefined) => Answer) => void;
  sellMat: (c: number) => number;
  sellLab: (c: number) => number;
  totalSqft: number;
  /** Floor-map measured sq ft per family — mixed jobs must not clone whole-job area. */
  familySqft?: Partial<Record<FlooringFamily, number>>;
  perRoom?: EstimateQuestion[];
  overrides?: Record<string, Record<string, Answer>>;
  setRoomOverride?: (roomId: string, qid: string, a: Answer) => void;
  jobAnswers?: Record<string, Answer>;
  floorRooms?: { name: string; sqft: number; lenIn: number | null; widIn: number | null }[];
  /** Subfloor / HS prep rooms — mixed jobs omit carpet rooms. */
  prepRooms?: { name: string; sqft: number; lenIn: number | null; widIn: number | null }[];
  /** Jump to the areas step. The room-map step is useless without rooms, and
   *  telling someone to "go back" without taking them there is a wall. */
  goToAreas?: () => void;
  flooringCtx?: InstallContext;
  /** Roll-goods cut totals by catalog family — floor-map order uses cuts when present. */
  cutsSqftByCategory?: Record<string, number>;
  /** TRIM_TYPES labels the salesperson already picked on hs_transitions. */
  hsTransitionTrims?: string[];
  /** TRIM_TYPES labels the salesperson already picked on hs_base_trim. */
  hsBaseTrims?: string[];
}) {
  // How many stairs? — seeded from hs_plank_stairs when the salesperson already
  // counted steps. Declared unconditionally so hook order is stable across kinds.
  const derivedHsStairSteps = stairStepCountFromAnswers(jobAnswers, ["hs_stairs"]);
  const [stairCountTyped, setStairCountTyped] = useState<string | null>(null);
  const stairCount =
    stairCountTyped ?? (derivedHsStairSteps > 0 ? String(derivedHsStairSteps) : "");
  const coverSf = measuredSqftForQuestionCover({
    kind: q.kind,
    key: q.key,
    category: q.config.category,
    totalSqft,
    byFamily: familySqft,
    jobFamilies: flooringCtx.families,
  });
  const mixedUnassigned =
    totalSqft > 0 &&
    coverSf <= 0 &&
    flooringCtx.families.filter((f) => f !== "other").length > 1;
  if (q.kind === "areas" && answer?.kind === "areas") {
    const rooms = answer.rooms;
    const upd = (rs: AreaRow[]) => set({ kind: "areas", rooms: rs });
    const patch = (id: string, p: Partial<AreaRow>) =>
      upd(rooms.map((x) => (x.id === id ? { ...x, ...p } : x)));
    const total = rooms.reduce((t, r) => t + rowSqft(r), 0);
    const floorMap = Object.values(jobAnswers).find(
      (a): a is Extract<Answer, { kind: "floor_map" }> => a?.kind === "floor_map",
    );
    const mixedRooms = flooringCtx.families.filter((f) => f !== "other").length > 1;
    return (
      <div className="space-y-3">
        {rooms.map((r, i) => {
          const usingCalc = numv(r.override) > 0;
          const sf = rowSqft(r);
          const assigned = floorMap?.byRoom[roomKey(r.name, i)];
          const roomFam = familyFromCatalogCategory(assigned?.category);
          const roomFamilySqft: Partial<Record<FlooringFamily, number>> =
            roomFam !== "other" && sf > 0 ? { [roomFam]: sf } : {};
          return (
            <div key={r.id} className="space-y-2 rounded-lg border bg-muted/20 p-2.5">
              <div className="flex items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <Input
                  value={r.name}
                  onChange={(e) => patch(r.id, { name: e.target.value })}
                  placeholder={`Area ${i + 1} (e.g. Living room)`}
                  className="h-11 flex-1 text-base md:h-10"
                />
                {rooms.length > 1 ? (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => upd(rooms.filter((x) => x.id !== r.id))}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                ) : null}
              </div>

              <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
                <FtInField label="Length" ft={r.lf} inch={r.li} disabled={usingCalc}
                  onFt={(v) => patch(r.id, { lf: v })} onIn={(v) => patch(r.id, { li: v })} />
                <span className="pb-2.5 text-muted-foreground">×</span>
                <FtInField label="Width" ft={r.wf} inch={r.wi} disabled={usingCalc}
                  onFt={(v) => patch(r.id, { wf: v })} onIn={(v) => patch(r.id, { wi: v })} />
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">or total sq ft</label>
                  <Input
                    value={r.override}
                    onChange={(e) => patch(r.id, { override: e.target.value })}
                    inputMode="decimal"
                    placeholder="sq ft"
                    className="h-11 w-24 text-base md:h-10"
                  />
                </div>
                <div className="flex items-center gap-1 pb-0.5">
                  <AreaCalculator
                    triggerLabel={usingCalc ? "Edit areas" : "Odd shape?"}
                    triggerVariant="ghost"
                    triggerClassName="h-9 px-2 text-xs"
                    title={`Square footage — ${r.name || "area"}`}
                    initialLabel={r.name}
                    onApply={(sqft) => patch(r.id, { override: String(sqft) })}
                  />
                  {usingCalc ? (
                    <button type="button" onClick={() => patch(r.id, { override: "" })} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                      use L×W
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Extra sections (closet, offset) stay on the same room so product
                  assignment and prep stay one room, while measured area sums. */}
              {(r.sections ?? []).map((sec, si) => (
                <div key={sec.id} className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-md border border-dashed bg-background p-2">
                  <Input
                    value={sec.name}
                    onChange={(e) =>
                      patch(r.id, {
                        sections: (r.sections ?? []).map((s) =>
                          s.id === sec.id ? { ...s, name: e.target.value } : s,
                        ),
                      })
                    }
                    placeholder={`Section ${String.fromCharCode(66 + si)}`}
                    className="h-10 w-28 text-sm"
                    disabled={usingCalc}
                  />
                  <FtInField
                    label="Length"
                    ft={sec.lf}
                    inch={sec.li}
                    disabled={usingCalc}
                    onFt={(v) =>
                      patch(r.id, {
                        sections: (r.sections ?? []).map((s) =>
                          s.id === sec.id ? { ...s, lf: v } : s,
                        ),
                      })
                    }
                    onIn={(v) =>
                      patch(r.id, {
                        sections: (r.sections ?? []).map((s) =>
                          s.id === sec.id ? { ...s, li: v } : s,
                        ),
                      })
                    }
                  />
                  <span className="pb-2.5 text-muted-foreground">×</span>
                  <FtInField
                    label="Width"
                    ft={sec.wf}
                    inch={sec.wi}
                    disabled={usingCalc}
                    onFt={(v) =>
                      patch(r.id, {
                        sections: (r.sections ?? []).map((s) =>
                          s.id === sec.id ? { ...s, wf: v } : s,
                        ),
                      })
                    }
                    onIn={(v) =>
                      patch(r.id, {
                        sections: (r.sections ?? []).map((s) =>
                          s.id === sec.id ? { ...s, wi: v } : s,
                        ),
                      })
                    }
                  />
                  <span className="pb-2 text-xs tabular-nums text-muted-foreground">
                    {formatSqft(sectionSqft(sec))}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove section"
                    onClick={() =>
                      patch(r.id, { sections: (r.sections ?? []).filter((s) => s.id !== sec.id) })
                    }
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              ))}
              <button
                type="button"
                className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                onClick={() =>
                  patch(r.id, {
                    sections: [
                      ...(r.sections ?? []),
                      {
                        id: `sec${Date.now()}`,
                        name: `Section ${String.fromCharCode(66 + (r.sections?.length ?? 0))}`,
                        lf: "",
                        li: "",
                        wf: "",
                        wi: "",
                      },
                    ],
                  })
                }
              >
                + Add section (closet, offset)
              </button>

              <div className="flex flex-wrap items-center gap-x-2 text-sm">
                <span>
                  <Ruler className="mr-1 inline size-3.5 text-muted-foreground" />
                  Measured{" "}
                  <span className="font-semibold tabular-nums">{formatSqft(sf)}</span>
                  {sf > 0 ? (
                    <span className="ml-1 text-muted-foreground">
                      ({formatSqyd(sf / 9)} equivalent area — not an order qty)
                    </span>
                  ) : null}
                  {usingCalc ? <span className="ml-1 text-xs text-primary">· added up</span> : null}
                </span>
                {r.differs ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
                    custom prep
                  </span>
                ) : null}
              </div>

              {/* Per-room prep (by-room mode): each room carries its own prep — the
                  single source, so there are no separate whole-job prep steps. */}
              {perRoom.length ? (
                <details className="border-t pt-2" open>
                  <summary className="cursor-pointer text-sm font-semibold">
                    Prep for {r.name || "this room"}
                  </summary>
                  <div className="mt-2 space-y-3 rounded-md border bg-card p-2.5">
                    <p className="text-xs text-muted-foreground">
                      Leveling, primer, moisture, subfloor & demo for {r.name || "this area"} only.
                      Leave blank for none.
                      {sf > 0
                        ? ` This room ${formatSqft(sf)}${mixedRooms ? " — not the whole mixed job" : ""}${roomFam !== "other" ? ` · ${familyLabel(roomFam)}` : ""}.`
                        : ""}
                    </p>
                    {perRoom.map((pq) => (
                      <div key={pq.id} className="space-y-1">
                        <div className="text-xs font-medium">{pq.label}</div>
                        <QuestionBody
                          q={pq}
                          answer={overrides[r.id]?.[pq.id] ?? jobAnswers[pq.id]}
                          set={(a) => setRoomOverride?.(r.id, pq.id, a)}
                          update={(fn) =>
                            setRoomOverride?.(r.id, pq.id, fn(overrides[r.id]?.[pq.id] ?? jobAnswers[pq.id]))
                          }
                          sellMat={sellMat}
                          sellLab={sellLab}
                          totalSqft={sf}
                          familySqft={roomFamilySqft}
                          flooringCtx={flooringCtx}
                        />
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          );
        })}

        {/* QUICK ADD — a whole-house carpet job is eight areas before you
            measure anything, and every one of them needed a click and a typed
            name first. These drop in already named. "Bedroom" numbers itself,
            so tapping it four times gives Bedroom 1-4. */}
        <div className="rounded-lg border border-dashed p-2.5">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">
            Quick add
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ROOMS.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => upd([...rooms, newRow(nextRoomName(rooms, label))])}
                className="rounded-full border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted"
              >
                + {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                // The common whole-house set, in the order you'd walk it.
                let next = [...rooms];
                for (const label of WHOLE_HOUSE)
                  next = [...next, newRow(nextRoomName(next, label))];
                upd(next);
              }}
              className="rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/20"
            >
              + Whole house
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => upd([...rooms, newRow()])}>
              <Plus className="size-4" /> Add area
            </Button>
            {rooms.length ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  // Same size again — bedrooms in a row are usually close
                  // enough that copying and nudging beats re-measuring.
                  const last = rooms[rooms.length - 1];
                  upd([
                    ...rooms,
                    {
                      ...last,
                      id: `a${Date.now()}`,
                      name: nextRoomName(rooms, baseRoomName(last.name)),
                      sections: (last.sections ?? []).map((s) => ({
                        ...s,
                        id: `sec${Date.now()}-${s.id}`,
                      })),
                    },
                  ]);
                }}
              >
                <Plus className="size-4" /> Copy last
              </Button>
            ) : null}
          </div>
          <span className="rounded-md bg-primary/10 px-3 py-1.5 text-sm">
            Total measured <span className="font-bold tabular-nums">{formatSqft(total)}</span>
            {total > 0 ? (
              <span className="ml-1 text-muted-foreground tabular-nums">
                ({formatSqyd(total / 9)} equivalent area — not an order qty)
              </span>
            ) : null}
          </span>
        </div>
      </div>
    );
  }

  if (q.kind === "floor_map" && answer?.kind === "floor_map") {
    const byRoom = answer.byRoom;
    const setRoom = (key: string, prod: ProductAns | null) =>
      set({ kind: "floor_map", byRoom: { ...byRoom, [key]: prod } });
    const fillEmpty = (prod: ProductAns | null) => {
      if (!prod) return;
      const nb = { ...byRoom };
      floorRooms.forEach((rm, i) => {
        const k = roomKey(rm.name, i);
        if (!nb[k]) nb[k] = prod;
      });
      set({ kind: "floor_map", byRoom: nb });
    };
    // Waste "apply to all" — one value across every room's material. Each room
    // can still be overridden below (all OR each).
    const fillWaste = (pct: string) => {
      const nb = { ...byRoom };
      for (const k of Object.keys(nb)) if (nb[k]) nb[k] = { ...nb[k]!, wastePct: pct };
      set({ kind: "floor_map", byRoom: nb });
    };
    const assignedProducts = floorRooms
      .map((rm, i) => byRoom[roomKey(rm.name, i)])
      .filter(Boolean) as ProductAns[];
    const mapDefaultCategory =
      flooringCtx.families.length === 1
        ? catalogCategoryForFamily(flooringCtx.families[0])
        : undefined;
    const commonWaste =
      assignedProducts.length && assignedProducts.every((p) => p.wastePct === assignedProducts[0].wastePct)
        ? assignedProducts[0].wastePct
        : "";
    /**
     * No rooms yet.
     *
     * This step assigns a product to each room, so with no rooms there is
     * nothing to assign to — and it used to say so and stop, which reads as
     * "the guided estimate won't let me pick a floor". The step you actually
     * need is earlier in the same questionnaire, so take them to it.
     */
    if (!floorRooms.length) {
      return (
        <div className="rounded-lg border border-dashed p-4 text-sm">
          <p className="font-medium">No rooms yet</p>
          <p className="mt-1 text-muted-foreground">
            This step puts a product in each room, so it needs the rooms first —
            they come from the &ldquo;Which areas are we doing?&rdquo; step. Add
            them there and this fills in with a picker per room, plus one that
            fills every empty room at once.
          </p>
          {goToAreas ? (
            <Button
              type="button"
              size="sm"
              className="mt-3"
              onClick={goToAreas}
            >
              Go add the rooms
            </Button>
          ) : null}
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-dashed p-2.5">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Same product in most rooms? Fill the empty ones
          </div>
          <ProductPicker
            value=""
            label=""
            defaultCategory={mapDefaultCategory}
            onPick={(prod) => fillEmpty(prod ? toProductAns(prod) : null)}
            onCreated={(prod) => fillEmpty(toProductAns(prod))}
            onUseOnce={(input) => fillEmpty(customToProductAns(input))}
          />
          {/* Waste — all rooms at once (each room still overridable below). */}
          {assignedProducts.length ? (
            <div className="mt-2 flex items-center gap-2 border-t pt-2">
              <label className="text-xs font-medium text-muted-foreground">Waste — all rooms</label>
              <div className="flex items-center gap-1">
                <Input
                  value={commonWaste}
                  onChange={(e) => fillWaste(e.target.value)}
                  inputMode="decimal"
                  placeholder="mixed"
                  className="h-9 w-16 text-base"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
              <span className="text-xs text-muted-foreground">or set each room below</span>
            </div>
          ) : null}
        </div>
        {floorRooms.map((rm, i) => {
          const key = roomKey(rm.name, i);
          const p = byRoom[key] ?? null;
          const cat = p?.category || "other";
          const b = billing({ category: cat, productUnit: p?.unit });
          return (
            <div key={key} className="rounded-lg border p-3">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="font-medium">{rm.name || `Room ${i + 1}`}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  measured {formatSqft(rm.sqft)}
                  {p ? (
                    <button
                      type="button"
                      onClick={() => setRoom(key, null)}
                      className="ml-2 text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      clear
                    </button>
                  ) : null}
                </span>
              </div>
              <ProductPicker
                value={p?.productId ?? ""}
                initialLabel={p?.label ?? ""}
                label="Product for this room"
                defaultCategory={
                  (p?.category as string) || mapDefaultCategory
                }
                onPick={(prod) => setRoom(key, prod ? toProductAns(prod) : null)}
                onCreated={(prod) => setRoom(key, toProductAns(prod))}
                onUseOnce={(input) => setRoom(key, customToProductAns(input))}
              />
              {p ? (
                <div className="mt-1.5 text-xs text-muted-foreground">
                  {p.label} ·{" "}
                  {p.materialRate > 0
                    ? `sells ${formatMoney(sellMat(rateFor(p.materialRate, p.unit, b.wantYd, { category: p.category, sqft_per_box: p.sqftPerBox })))}/${b.unitLabel}`
                    : PRICE_NEEDED}
                  {q.config.ask_source ? (
                    <span className="mt-1.5 block">
                      <SourceToggle p={p} compact onChange={(np) => setRoom(key, np)} />
                    </span>
                  ) : null}
                  {/* Measured vs order for this room. Roll goods do not take a
                      waste % — layout waste lives in the cut list. */}
                  {(() => {
                    const defWaste = profileFor(cat)?.waste ?? 0;
                    const family = familyFromCatalogCategory(cat);
                    const carpetSystems = carpetInstallSystemsFromLabels(flooringCtx.answeredCarpetInstall);
                    const needCuts = rollGoodsNeedCuts(family, carpetSystems);
                    const cutSf = needCuts ? (cutsSqftByCategory[family] ?? 0) : 0;
                    const takeoff = computeMaterialTakeoff({
                      family,
                      measuredSqft: rm.sqft,
                      wastePct: p.wastePct.trim() !== "" ? numv(p.wastePct) : defWaste,
                      cutsSqft: cutSf > 0 ? cutSf : null,
                      sqftPerBox: !needCuts && numv(p.sqftPerBox) > 0 ? numv(p.sqftPerBox) : null,
                      carpetSystems: family === "carpet" ? carpetSystems : null,
                    });
                    const cartonTbd = boxedCartonCoverageTbdDescription({
                      family,
                      productUnit: p.unit,
                      sqftPerBox: numv(p.sqftPerBox) > 0 ? numv(p.sqftPerBox) : null,
                      label: p.label,
                      carpetInstallSystems: carpetSystems,
                    });
                    return (
                      <div className="mt-2 space-y-1.5">
                        <div className="flex flex-wrap items-end gap-3">
                          {!needCuts ? (
                          <div>
                            <label className="mb-1 block text-[11px] text-muted-foreground">Waste factor</label>
                            <div className="flex items-center gap-1">
                              <Input
                                value={p.wastePct}
                                onChange={(e) => setRoom(key, { ...p, wastePct: e.target.value })}
                                inputMode="decimal"
                                placeholder={String(defWaste)}
                                className="h-9 w-16 text-base"
                              />
                              <span className="text-xs text-muted-foreground">%</span>
                            </div>
                          </div>
                          ) : null}
                          {!needCuts ? (
                            <div>
                              <label className="mb-1 block text-[11px] text-muted-foreground">Sq ft per box</label>
                              <Input
                                value={p.sqftPerBox}
                                onChange={(e) => setRoom(key, { ...p, sqftPerBox: e.target.value })}
                                inputMode="decimal"
                                placeholder="if known"
                                className="h-9 w-20 text-base"
                              />
                            </div>
                          ) : null}
                        </div>
                        {rm.sqft > 0 ? (
                          <p className="text-xs">
                            Measured {formatSqft(takeoff.measured.sqft)}
                            {takeoff.billingUnit === "sqyd" ? (
                              <> ({formatSqyd(takeoff.measured.sqydEquivalent)} equivalent area — not an order qty)</>
                            ) : null}
                            {" · "}
                            {takeoff.orderBasis === "cuts"
                              ? "Order (from cuts) "
                              : takeoff.orderBasis === "none" && needCuts
                                ? "Order TBD — enter cuts "
                                : cartonTbd
                                  ? "Order TBD — carton coverage TBD "
                                  : takeoff.orderBasis === "measured_plus_waste_estimated"
                                  ? "Order (estimate — not a cut plan) "
                                  : "Order "}
                            <span className={cn("font-semibold tabular-nums", cartonTbd ? "text-amber-800 dark:text-amber-200" : "text-foreground")}>
                              {takeoff.orderBasis === "none" && needCuts
                                ? ""
                                : cartonTbd
                                  ? "(not How many boxes from leftover taped sq ft)"
                                  : takeoff.billingUnit === "sqyd"
                                  ? formatSqyd(takeoff.billingQty)
                                  : formatSqft(takeoff.orderSqft)}
                            </span>
                            {takeoff.cartons ? (
                              <>
                                {" "}
                                · {takeoff.cartons.cartonCount} carton
                                {takeoff.cartons.cartonCount === 1 ? "" : "s"}
                              </>
                            ) : null}
                          </p>
                        ) : null}
                      </div>
                    );
                  })()}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  if (q.kind === "product" && q.config.trim_list) {
    const rows = answer?.kind === "trims" ? answer.rows : [];
    const upd = (rs: TrimRow[]) => set({ kind: "trims", rows: rs });
    const patch = (id: string, pp: Partial<TrimRow>) =>
      upd(rows.map((x) => (x.id === id ? { ...x, ...pp } : x)));
    // Set qty on Stair tread + Stair riser + Stair nose (adding any missing) —
    // one of each per hard-surface step. Noses are EACH, never square feet.
    // Carpet-only jobs hide this fill; waterfall/upholstered stairs are labor.
    const fillStairs = () => {
      const n = numv(stairCount);
      if (n <= 0) return;
      upd(
        applyHardSurfaceStairTrimFill(rows, n, (label) => {
          const t = TRIM_TYPES.find((x) => x.label === label);
          return newTrimRow(t);
        }),
      );
    };
    const showHsStairFill =
      jobNeedsHardSurfaceStairTrim(flooringCtx.families) &&
      !jobIsExclusiveWallTile(flooringCtx);
    const fillFromPicks = (labels: string[]) => {
      if (!labels.length) return;
      upd(
        applyTrimTypeSeed(rows, labels, (label) => {
          const t = TRIM_TYPES.find((x) => x.label === label);
          return newTrimRow(t);
        }),
      );
    };
    return (
      <div className="space-y-3">
        {/* Quick-add: click the trims you need. */}
        <div className="flex flex-wrap gap-1.5">
          {TRIM_TYPES.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => upd([...rows, newTrimRow(t)])}
              className="rounded-full border px-3 py-1.5 text-sm font-medium hover:border-primary hover:bg-primary/5"
            >
              <Plus className="mr-0.5 inline size-3.5" />
              {t.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => upd([...rows, newTrimRow()])}
            className="rounded-full border border-dashed px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            + Other
          </button>
        </div>

        {/* Hard-surface stairs: treads, risers, and noses (each). Hidden on carpet-only. */}
        {showHsStairFill ? (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed bg-primary/5 p-2.5">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                How many stairs?
              </label>
              <Input
                value={stairCount}
                onChange={(e) => setStairCountTyped(e.target.value)}
                inputMode="numeric"
                placeholder="e.g. 13"
                className="h-9 w-24 text-base"
              />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={fillStairs}>
              Add treads, risers &amp; noses
            </Button>
            <span className="text-xs text-muted-foreground">
              One tread, one riser, and one stair nose (each) per step — then pick the product.
              {derivedHsStairSteps > 0 ? " Count came from the stair question." : ""}
            </span>
          </div>
        ) : null}

        {hsTransitionTrims.length ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed bg-primary/5 p-2.5">
            <Button type="button" variant="outline" size="sm" onClick={() => fillFromPicks(hsTransitionTrims)}>
              Add selected transitions
            </Button>
            <span className="text-xs text-muted-foreground">
              {hsTransitionTrims.join(", ")} — each, never square feet. Then pick the catalog piece.
            </span>
          </div>
        ) : null}

        {hsBaseTrims.length ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed bg-primary/5 p-2.5">
            <Button type="button" variant="outline" size="sm" onClick={() => fillFromPicks(hsBaseTrims)}>
              Add selected base / shoe / QR
            </Button>
            <span className="text-xs text-muted-foreground">
              {hsBaseTrims.join(", ")} — linear feet, never square feet.
            </span>
          </div>
        ) : null}

        {rows.map((row) => (
          <div key={row.id} className="space-y-2 rounded-md border bg-muted/20 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <Input
                value={row.type}
                onChange={(e) => {
                  const type = e.target.value;
                  patch(row.id, { type, unit: coerceTrimUnit(type, row.unit) });
                }}
                placeholder="Trim name"
                className="h-10 max-w-[16rem] flex-1 text-base font-medium"
              />
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => upd(rows.filter((x) => x.id !== row.id))}>
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              {/* An accessory sold by the piece is measured in linear feet but BOUGHT
                  in whole sticks. Enter the run; this buys enough sticks to cover it. */}
              {showTrimLinearFt(row) ? (
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Linear ft</label>
                  <Input
                    value={row.linearFt ?? ""}
                    onChange={(e) => {
                      const lf = e.target.value;
                      const len = pieceLenFor(row);
                      patch(row.id, {
                        linearFt: lf,
                        ...(len
                          ? { qty: String(piecesForLinearFeet(numv(lf), len) || "") }
                          : {}),
                      });
                    }}
                    inputMode="decimal"
                    placeholder="0"
                    className="h-10 w-24 text-base"
                  />
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {pieceLenFor(row) ? "Pieces" : "Qty"}
                </label>
                <Input value={row.qty} onChange={(e) => patch(row.id, { qty: e.target.value, linearFt: "" })} inputMode="decimal" placeholder="0" className="h-10 w-20 text-base" />
              </div>
              {pieceLenFor(row) ? (
                <p className="mb-2.5 text-xs text-muted-foreground">
                  {pieceLenFor(row)}&quot; sticks ·{" "}
                  {numv(row.qty) > 0
                    ? `covers ${linearFeetForPieces(numv(row.qty), pieceLenFor(row)!)} ln ft`
                    : "rounds up to whole sticks"}
                </p>
              ) : showTrimLinearFt(row) ? (
                <p className="mb-2.5 max-w-[14rem] text-xs text-muted-foreground">
                  Stick length is not on this product — enter pieces. {TYPICAL_PIECE_LENGTH_IN}&quot;
                  is typical but not assumed.
                </p>
              ) : (
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Unit</label>
                  <select
                    value={coerceTrimUnit(row.type, row.unit)}
                    onChange={(e) => patch(row.id, { unit: coerceTrimUnit(row.type, e.target.value) })}
                    className="h-10 rounded-md border border-input bg-transparent px-2 text-sm"
                  >
                    {accessoryUnitForType(row.type) === "lnft" ? (
                      <>
                        <option value="lnft">linear ft</option>
                        <option value="each">each (sticks)</option>
                        <option value="pc">pieces</option>
                      </>
                    ) : (
                      <>
                        <option value="each">each</option>
                        <option value="pc">pieces</option>
                      </>
                    )}
                  </select>
                  <p className="mt-0.5 max-w-[10rem] text-[10px] text-muted-foreground">
                    {accessoryUnitForType(row.type) === "lnft"
                      ? "Linear feet — never square feet."
                      : "Each / pieces — never square feet."}
                  </p>
                </div>
              )}
              {row.sized ? (
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Size</label>
                  <Input value={row.size} onChange={(e) => patch(row.id, { size: e.target.value })} placeholder='e.g. 3¼"' className="h-10 w-24 text-base" />
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Color / finish</label>
                <Input value={row.color} onChange={(e) => patch(row.id, { color: e.target.value })} placeholder="e.g. white" className="h-10 w-28 text-base" />
              </div>
              {/* No material cost on an R&R row — we're re-using the existing piece. */}
              {!row.product && !row.rr ? (
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">$ / {row.unit}</label>
                  <Input
                    value={row.cost}
                    onChange={(e) => patch(row.id, { cost: e.target.value })}
                    inputMode="decimal"
                    placeholder="catalog or type — do not invent"
                    className="h-10 w-20 text-base"
                  />
                </div>
              ) : null}
              {/* Order vs stock only applies to NEW material — an R&R row re-uses
                  what's already there, so there's nothing to order or pull. */}
              {row.rr ? (
                <div className="self-end pb-2 text-xs font-medium text-muted-foreground">
                  Re-using existing material
                </div>
              ) : (
                <div className="inline-flex overflow-hidden rounded-md border">
                  <button type="button" onClick={() => patch(row.id, { source: "order" })}
                    className={cn("px-2.5 py-2 text-sm font-medium", row.source === "order" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Order</button>
                  <button type="button" onClick={() => patch(row.id, { source: "stock" })}
                    className={cn("px-2.5 py-2 text-sm font-medium", row.source === "stock" ? "bg-amber-500 text-white" : "text-muted-foreground")}>Stock</button>
                </div>
              )}
            </div>
            {/* R&R — remove & re-install existing base/shoe during the floor job.
                Adds a labor charge per linear foot; material above stays separate
                (keep it for new base, or set $/ln ft to 0 when re-using existing). */}
            {isRnREligible(row.type) ? (
              <div className="flex flex-wrap items-center gap-2 border-t pt-2 text-sm">
                <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium">
                  <input
                    type="checkbox"
                    checked={!!row.rr}
                    onChange={(e) =>
                      patch(row.id, {
                        rr: e.target.checked,
                        rrRate: row.rrRate,
                      })
                    }
                    className="size-4 accent-primary"
                  />
                  R&R — remove &amp; re-install existing
                </label>
                {row.rr ? (
                  <span className="inline-flex items-center gap-1">
                    <label className="text-xs text-muted-foreground">labor $ / ln ft</label>
                    <Input
                      value={row.rrRate ?? ""}
                      onChange={(e) => patch(row.id, { rrRate: e.target.value })}
                      inputMode="decimal"
                      placeholder="if known"
                      className="h-9 w-20 text-base"
                    />
                  </span>
                ) : null}
              </div>
            ) : null}
            {/* Matching stairnose sourcing rule — Versatrim first, else match the
                flooring's own manufacturer. */}
            {isStairnose(row.type) ? (
              <div className="rounded border border-primary/30 bg-primary/5 px-2 py-1 text-xs">
                <span className="font-semibold">Matching stairnose:</span> default to{" "}
                <span className="font-semibold">Versatrim</span>. If Versatrim doesn&apos;t make it,
                order the matching stairnose from the flooring&apos;s manufacturer.
              </div>
            ) : null}
            {/* Optional: attach a specific catalog / Versatrim product. */}
            <details className="text-sm" open={isStairnose(row.type) && !row.product}>
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                {row.product ? `Catalog: ${row.product.label} — change` : "Find a specific product in the catalog"}
              </summary>
              <div className="mt-2">
                <ProductPicker
                  value={row.product?.productId ?? ""}
                  initialLabel={row.product?.label ?? (isStairnose(row.type) ? "Versatrim " : "")}
                  label="Search the catalog (or add a Versatrim / manufacturer item)"
                  defaultCategory="trim"
                  onPick={(prod) =>
                    patch(row.id, {
                      product: prod ? toProductAns(prod) : null,
                      unit: coerceTrimUnit(row.type || (prod ? prod.name : ""), prod?.unit || row.unit),
                      type: row.type || (prod ? prod.name : row.type),
                    })
                  }
                  onCreated={(prod) =>
                    patch(row.id, {
                      product: toProductAns(prod),
                      unit: coerceTrimUnit(row.type || prod.name, prod.unit || row.unit),
                    })
                  }
                  onUseOnce={(input) =>
                    patch(row.id, {
                      product: customToProductAns(input),
                      unit: coerceTrimUnit(row.type || input.name, input.unit || row.unit),
                    })
                  }
                />
              </div>
            </details>
          </div>
        ))}
      </div>
    );
  }

  if (q.kind === "product" && !q.config.trim_list && answer?.kind === "product") {
    const p = answer.product;
    const extras = answer.extras;
    const qty = answer.qty ?? "";
    const familyCat =
      flooringCtx.families.length === 1
        ? catalogCategoryForFamily(flooringCtx.families[0])
        : null;
    const cat =
      (q.config.category === "lvp" && familyCat && familyCat !== "other" ? familyCat : null) ||
      q.config.category ||
      "other";
    const b = billing({ category: cat, key: q.key, productUnit: p?.unit });
    const kindLabel =
      q.key === "hs_underlayment" ? "underlayment" : cat === "underlayment" ? "padding" : cat;
    // Waste + carton entry is for the flooring itself (not pad / trim / other).
    const isFlooring = ["carpet", "lvp", "vinyl", "laminate", "hardwood", "tile"].includes(cat);
    const family = familyFromCatalogCategory(cat);
    const carpetSystems = carpetInstallSystemsFromLabels(flooringCtx.answeredCarpetInstall);
    const needRollCuts = rollGoodsNeedCuts(family, carpetSystems);
    const isRoll = needRollCuts;
    const defWasteForCat = profileFor(cat)?.waste ?? 0;
    const setMain = (product: ProductAns | null) => {
      const keep = extraAsksCountQty({
        family: familyFromCatalogCategory(product?.category || cat),
        productUnit: product?.unit,
        carpetInstallSystems: carpetSystems,
      });
      set({ kind: "product", product, extras, qty: keep ? qty : "" });
    };
    const setExtras = (xs: ExtraPad[]) => set({ kind: "product", product: p, extras: xs, qty });
    const setMainQty = (next: string) => set({ kind: "product", product: p, extras, qty: next });
    const patchExtra = (id: string, patch: Partial<ExtraPad>) =>
      setExtras(extras.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const extraKeepMeasured = (prod: ProductAns | null) => {
      if (!prod) return true;
      return areaDerivedMaterialAllowed(
        familyFromCatalogCategory(prod.category || cat),
        prod.unit,
        carpetSystems,
      );
    };
    const extraKeepCountQty = (prod: ProductAns | null) => {
      if (!prod) return false;
      return extraAsksCountQty({
        family: familyFromCatalogCategory(prod.category || cat),
        productUnit: prod.unit,
        carpetInstallSystems: carpetSystems,
      });
    };
    const mainAsksCount = extraAsksCountQty({
      family,
      productUnit: p?.unit,
      carpetInstallSystems: carpetSystems,
    });
    const mainCartonTbd = boxedCartonCoverageTbdDescription({
      family,
      productUnit: p?.unit,
      sqftPerBox: p && numv(p.sqftPerBox) > 0 ? numv(p.sqftPerBox) : null,
      label: p?.label,
      carpetInstallSystems: carpetSystems,
    });
    const setExtraProduct = (id: string, product: ProductAns | null, extra: ExtraPad) =>
      patchExtra(id, {
        product,
        sqft: extraKeepMeasured(product) ? extra.sqft : "",
        qty: extraKeepCountQty(product) ? extra.qty ?? "" : "",
      });
    return (
      <div className="space-y-3">
        <ProductPicker
          value={p?.productId ?? ""}
          initialLabel={p?.label ?? ""}
          label={`Pick from the catalog (${cat})`}
          defaultCategory={cat}
          onPick={(prod) => setMain(prod ? toProductAns(prod) : null)}
          onCreated={(prod) => setMain(toProductAns(prod))}
          onUseOnce={(input) => setMain(customToProductAns(input))}
        />
        {p ? (
          <>
            <div className="rounded-md border bg-muted/30 p-2.5 text-sm">
              <div className="font-medium">{p.label}</div>
              <div className="text-xs text-muted-foreground">
                {p.materialRate > 0
                  ? `${formatMoney(p.materialRate)}/${p.unit} → sells ${formatMoney(sellMat(rateFor(p.materialRate, p.unit, b.wantYd, { category: p.category, sqft_per_box: p.sqftPerBox })))}/${b.unitLabel}`
                  : PRICE_NEEDED}
                {mainAsksCount
                  ? ""
                  : coverSf > 0
                  ? ` · measured ${formatMeasuredLabel({ sqft: coverSf, sqydEquivalent: r2(coverSf / 9) }, { showEquivalentYd: b.wantYd })}`
                  : mixedUnassigned
                    ? " · assign rooms to this product — mixed jobs do not clone whole-job sq ft"
                    : ""}
              </div>
            </div>
            {q.config.ask_source ? <SourceToggle p={p} onChange={setMain} /> : null}
            {isFlooring ? (
              (() => {
                const takeoff = computeMaterialTakeoff({
                  family,
                  measuredSqft: coverSf,
                  wastePct: p.wastePct.trim() !== "" ? numv(p.wastePct) : defWasteForCat,
                  cutsSqft: needRollCuts
                    ? (cutsSqftByCategory[family] ?? 0)
                    : null,
                  sqftPerBox: !needRollCuts && numv(p.sqftPerBox) > 0 ? numv(p.sqftPerBox) : null,
                  carpetSystems: family === "carpet" ? carpetSystems : null,
                });
                return (
                  <div className="space-y-2 rounded-md border border-dashed p-2.5">
                    <div className="flex flex-wrap items-end gap-3">
                      {!isRoll ? (
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">Waste factor</label>
                        <div className="flex items-center gap-1">
                          <Input
                            value={p.wastePct}
                            onChange={(e) => setMain({ ...p, wastePct: e.target.value })}
                            inputMode="decimal"
                            placeholder={String(defWasteForCat)}
                            className="h-10 w-20 text-base"
                          />
                          <span className="text-sm text-muted-foreground">%</span>
                        </div>
                      </div>
                      ) : null}
                      {!isRoll ? (
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">Sq ft per box</label>
                          <Input
                            value={p.sqftPerBox}
                            onChange={(e) => setMain({ ...p, sqftPerBox: e.target.value })}
                            inputMode="decimal"
                            placeholder="from product, if known"
                            className="h-10 w-28 text-base"
                          />
                        </div>
                      ) : (
                        <p className="pb-2 text-xs text-muted-foreground">
                          Roll goods — carton coverage does not apply. Order quantity comes from cuts/layout.
                        </p>
                      )}
                    </div>
                    {coverSf > 0 ? (
                      <div className="space-y-0.5 text-sm">
                        <p>
                          Measured{" "}
                          <span className="font-semibold tabular-nums">{formatSqft(takeoff.measured.sqft)}</span>
                          {b.wantYd ? (
                            <span className="text-muted-foreground">
                              {" "}
                              ({formatSqyd(takeoff.measured.sqydEquivalent)} equivalent area — not an order quantity)
                            </span>
                          ) : null}
                        </p>
                        {!isRoll ? (
                        <p>
                          Waste{" "}
                          <span className="font-semibold tabular-nums">{takeoff.wastePct}%</span>
                          {takeoff.wasteSqft > 0 ? (
                            <span className="text-muted-foreground"> ({formatSqft(takeoff.wasteSqft)})</span>
                          ) : null}
                        </p>
                        ) : null}
                        <p>
                          {takeoff.orderBasis === "none" && isRoll ? (
                            <>
                              Order{" "}
                              <span className="font-semibold tabular-nums text-amber-800 dark:text-amber-200">
                                TBD — enter cuts (not sq ft ÷ 9)
                              </span>
                            </>
                          ) : mainCartonTbd ? (
                            <>
                              Order{" "}
                              <span className="font-semibold tabular-nums text-amber-800 dark:text-amber-200">
                                TBD — carton coverage TBD (not How many boxes from leftover taped sq ft)
                              </span>
                            </>
                          ) : (
                            <>
                          Order{" "}
                          <span className="font-semibold tabular-nums">
                            {b.wantYd ? formatSqyd(takeoff.billingQty) : formatSqft(takeoff.orderSqft)}
                          </span>
                          {takeoff.cartons ? (
                            <>
                              {" "}
                              ·{" "}
                              <span className="font-semibold tabular-nums text-primary">
                                {takeoff.cartons.cartonCount}
                              </span>{" "}
                              carton{takeoff.cartons.cartonCount === 1 ? "" : "s"} ({formatSqft(takeoff.cartons.orderedCoverageSqft)})
                            </>
                          ) : null}
                          {takeoff.orderBasis === "measured_plus_waste_estimated" ? (
                            <span className="ml-1 text-xs text-amber-700 dark:text-amber-300">
                              estimate — not a cut plan
                            </span>
                          ) : null}
                            </>
                          )}
                        </p>
                      </div>
                    ) : mixedUnassigned ? (
                      <p className="text-xs text-muted-foreground">
                        Assign this product on the floor map. Mixed jobs do not clone whole-job sq ft onto every family.
                      </p>
                    ) : null}
                    {mainCartonTbd ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="text-xs text-muted-foreground">{EXTRA_AREA_COUNT_QTY_LABEL}</label>
                        <Input
                          value={qty}
                          onChange={(e) => setMainQty(e.target.value)}
                          inputMode="decimal"
                          placeholder={countUnitForTbd(p.unit).phrase}
                          className="h-10 w-28"
                        />
                        <span className="text-xs text-muted-foreground">
                          {countUnitForTbd(p.unit).phrase}
                        </span>
                        <p className="w-full text-xs text-muted-foreground">
                          Missing carton coverage stays TBD — not How many boxes from leftover taped sq ft. Typed How many rides onto Review as that count.
                        </p>
                      </div>
                    ) : null}
                  </div>
                );
              })()
            ) : extraAsksCountQty({
              family,
              productUnit: p.unit,
              carpetInstallSystems: carpetSystems,
            }) ? (
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-muted-foreground">{EXTRA_AREA_COUNT_QTY_LABEL}</label>
                <Input
                  value={qty}
                  onChange={(e) => setMainQty(e.target.value)}
                  inputMode="decimal"
                  placeholder={countUnitForTbd(p.unit).phrase}
                  className="h-10 w-28"
                />
                <span className="text-xs text-muted-foreground">
                  {countUnitForTbd(p.unit).phrase}
                </span>
                {numv(qty) > 0 ? (
                  <span className="w-full text-xs text-muted-foreground tabular-nums">
                    {extraCountReviewLine({
                      family,
                      productUnit: p.unit,
                      qty: numv(qty),
                      label: p.label,
                      carpetInstallSystems: carpetSystems,
                    })}
                  </span>
                ) : null}
                <p className="w-full text-xs text-muted-foreground">{EXTRA_AREA_COUNT_QTY_HINT}</p>
              </div>
            ) : !areaDerivedMaterialAllowed(family, p.unit, carpetSystems) &&
              (q.key === "carpet_pad" ||
                q.key === "hs_underlayment" ||
                q.key === "adhesive" ||
                cat === "underlayment") ? (
              <p className="text-xs text-muted-foreground">{EXTRA_AREA_COUNT_TBD_HINT}</p>
            ) : q.key === "carpet_pad" || q.key === "hs_underlayment" || cat === "underlayment" ? (
              coverSf > 0 ? (
                <p className="text-sm">
                  {formatTakeoffStrip(
                    computeMaterialTakeoff({
                      family,
                      measuredSqft: coverSf,
                      wastePct: p.wastePct.trim() !== "" ? numv(p.wastePct) : 0,
                      sqftPerBox: numv(p.sqftPerBox) > 0 ? numv(p.sqftPerBox) : null,
                      billingUnit: b.measureUnit,
                      takeoffLabel: padFoamTakeoffLabel({ key: q.key, category: cat }),
                    }),
                  )}
                </p>
              ) : mixedUnassigned ? (
                <p className="text-xs text-muted-foreground">
                  Assign rooms on the floor map. Mixed jobs do not clone whole-job sq ft onto pad or foam.
                </p>
              ) : null
            ) : null}
          </>
        ) : null}

        {/* One OR multiple: add another product for a specific area. */}
        {q.config.allow_additional ? (
          <div className="space-y-2 rounded-lg border border-dashed p-2.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Additional {kindLabel} for a specific area
            </div>
            <p className="text-xs text-muted-foreground">{EXTRA_AREA_MEASURED_HINT}</p>
            {extras.map((ex) => {
              const extraFam = familyFromCatalogCategory(ex.product?.category || cat);
              const extraNeedsMeasured =
                !ex.product ||
                areaDerivedMaterialAllowed(extraFam, ex.product.unit, carpetSystems);
              return (
              <div key={ex.id} className="space-y-2 rounded-md border bg-muted/20 p-2">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <ProductPicker
                      value={ex.product?.productId ?? ""}
                      initialLabel={ex.product?.label ?? ""}
                      label={`Product (${cat})`}
                      defaultCategory={cat}
                      onPick={(prod) =>
                        setExtraProduct(ex.id, prod ? toProductAns(prod) : null, ex)
                      }
                      onCreated={(prod) => setExtraProduct(ex.id, toProductAns(prod), ex)}
                      onUseOnce={(input) =>
                        setExtraProduct(ex.id, customToProductAns(input), ex)
                      }
                    />
                  </div>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setExtras(extras.filter((x) => x.id !== ex.id))}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
                {extraNeedsMeasured ? (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-muted-foreground">{EXTRA_AREA_MEASURED_LABEL}</label>
                  <Input value={ex.sqft} onChange={(e) => patchExtra(ex.id, { sqft: e.target.value })} inputMode="decimal" placeholder={EXTRA_AREA_MEASURED_PLACEHOLDER} className="h-10 w-28" />
                  {ex.product && numv(ex.sqft) > 0 ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatTakeoffStrip(
                        computeMaterialTakeoff({
                          family: familyFromCatalogCategory(ex.product.category || cat),
                          measuredSqft: numv(ex.sqft),
                          wastePct: ex.product.wastePct.trim() !== "" ? numv(ex.product.wastePct) : 0,
                          sqftPerBox: numv(ex.product.sqftPerBox) > 0 ? numv(ex.product.sqftPerBox) : null,
                          billingUnit: billing({
                            category: cat,
                            key: q.key,
                            productUnit: ex.product.unit,
                          }).measureUnit,
                          takeoffLabel: padFoamTakeoffLabel({
                            key: q.key,
                            category: ex.product.category || cat,
                          }),
                        }),
                      )}
                    </span>
                  ) : null}
                  {ex.product && q.config.ask_source ? (
                    <SourceToggle p={ex.product} compact onChange={(np) => setExtraProduct(ex.id, np, ex)} />
                  ) : null}
                </div>
                ) : extraAsksCountQty({
                  family: extraFam,
                  productUnit: ex.product?.unit,
                  carpetInstallSystems: carpetSystems,
                }) ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs text-muted-foreground">{EXTRA_AREA_COUNT_QTY_LABEL}</label>
                    <Input
                      value={ex.qty ?? ""}
                      onChange={(e) => patchExtra(ex.id, { qty: e.target.value })}
                      inputMode="decimal"
                      placeholder={countUnitForTbd(ex.product?.unit).phrase}
                      className="h-10 w-28"
                    />
                    <span className="text-xs text-muted-foreground">
                      {countUnitForTbd(ex.product?.unit).phrase}
                    </span>
                    {numv(ex.qty ?? "") > 0 ? (
                      <span className="w-full text-xs text-muted-foreground tabular-nums">
                        {extraCountReviewLine({
                          family: extraFam,
                          productUnit: ex.product?.unit,
                          qty: numv(ex.qty ?? ""),
                          label: ex.product?.label,
                          carpetInstallSystems: carpetSystems,
                        })}
                      </span>
                    ) : null}
                    <p className="w-full text-xs text-muted-foreground">{EXTRA_AREA_COUNT_QTY_HINT}</p>
                    {ex.product && q.config.ask_source ? (
                      <SourceToggle p={ex.product} compact onChange={(np) => setExtraProduct(ex.id, np, ex)} />
                    ) : null}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs text-muted-foreground">{EXTRA_AREA_COUNT_TBD_HINT}</p>
                    {ex.product && q.config.ask_source ? (
                      <SourceToggle p={ex.product} compact onChange={(np) => setExtraProduct(ex.id, np, ex)} />
                    ) : null}
                  </div>
                )}
              </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" onClick={() => setExtras([...extras, newExtra()])}>
              <Plus className="size-4" /> Add {kindLabel}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (q.kind === "yesno" && answer?.kind === "yesno") {
    return (
      <div className="flex gap-2">
        {[["Yes", true], ["No", false]].map(([lbl, val]) => (
          <button key={lbl as string} type="button" onClick={() => set({ kind: "yesno", yes: val as boolean })}
            className={cn("flex-1 rounded-lg border p-3 text-base font-medium", answer.yes === val ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
            {answer.yes === val ? <Check className="mr-1 inline size-4" /> : null}
            {lbl}
          </button>
        ))}
      </div>
    );
  }

  if (q.kind === "number" && answer?.kind === "number") {
    const opts = q.config.rate_options ?? [];
    const amountUnit = amountUnitLabelForQuestion(q);
    return (
      <div className="space-y-3">
        <label className="block text-xs text-muted-foreground">
          Amount{amountUnit ? ` (${amountUnit})` : ""}
        </label>
        <Input value={answer.value} onChange={(e) => set({ ...answer, value: e.target.value })} inputMode="decimal" placeholder="0" className="h-12 max-w-[10rem] text-lg" />
        {opts.length ? (
          <div className="flex flex-wrap gap-1.5">
            {opts.map((o, i) => (
              <button key={o.label} type="button" onClick={() => set({ ...answer, rateIdx: i })}
                className={cn("rounded-full border px-3 py-1.5 text-sm font-medium", answer.rateIdx === i ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                {o.label} · {formatMoney(o.cost)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (q.kind === "choice" && q.config.per_area) {
    const opts = (q.config.options ?? []).filter((o) => o.emit);
    const rows = answer?.kind === "choice_areas" ? answer.rows : [];
    const upd = (rs: DemoRow[]) => set({ kind: "choice_areas", rows: rs });
    const patch = (id: string, pp: Partial<DemoRow>) =>
      upd(rows.map((x) => (x.id === id ? { ...x, ...pp } : x)));
    return (
      <div className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add each demo type and the area it covers.
          </p>
        ) : null}
        {rows.map((row) => (
          <div key={row.id} className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/20 p-2">
            <div className="min-w-[9rem] flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">Demo type</label>
              <select
                value={row.option}
                onChange={(e) => patch(row.id, { option: e.target.value })}
                className="h-10 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              >
                <option value="">— Choose —</option>
                {opts.map((o) => (
                  <option key={o.label} value={o.label}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Area (sq ft)</label>
              <Input
                value={row.sqft}
                onChange={(e) => patch(row.id, { sqft: e.target.value })}
                inputMode="decimal"
                placeholder="sq ft"
                className="h-10 w-28 text-base"
              />
            </div>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => upd(rows.filter((x) => x.id !== row.id))}>
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => upd([...rows, newDemoRow()])}>
          <Plus className="size-4" /> Add demo area
        </Button>
      </div>
    );
  }

  if (q.kind === "choice" && !q.config.per_area) {
    const answerChoice: Extract<Answer, { kind: "choice" }> | null =
      answer?.kind === "choice"
        ? answer
        : answer?.kind === "yesno"
          ? { kind: "choice", selected: [answer.yes ? "Yes" : "No"] }
          : null;
    if (!answerChoice) return null;
    const configured = q.config.options ?? [];
    const knowledgeOpts =
      q.key === "install_method"
        ? hardSurfaceInstallMethodOptions(flooringCtx.families, flooringCtx.hardwoodConstruction)
        : [];
    const configuredOpts =
      q.key === "install_method" && knowledgeOpts.length
        ? (() => {
            const labels = new Set(knowledgeOpts.map((o) => o.label));
            // Keep a selected-but-not-permitted option visible so old drafts don't vanish.
            const extra = configured.filter(
              (o) => answerChoice.selected.includes(o.label) && !labels.has(o.label),
            );
            const merged = knowledgeOpts.map((o) => configured.find((c) => c.label === o.label) ?? { label: o.label });
            return [...merged, ...extra];
          })()
        : configured;
    const opts = configuredOpts.filter((o) => choiceOptionApplies(q, o.label, flooringCtx));
    const mixedHsInstall =
      q.key === "install_method" && jobNeedsMixedInstallMethodPicks(flooringCtx.families);
    const multi = q.key === "install_method" ? mixedHsInstall : q.config.multi;
    const soleInstall =
      q.key === "install_method" && opts.length === 1 ? opts[0].label : null;
    const selected =
      soleInstall && !answerChoice.selected.length ? [soleInstall] : answerChoice.selected;
    const toggle = (label: string) => {
      const on = selected.includes(label);
      if (soleInstall && on) return; // laminate / tile / sheet vinyl have one legal method
      const next = multi
        ? (on ? selected.filter((x) => x !== label) : [...selected, label])
        : (on ? [] : [label]);
      set({ kind: "choice", selected: next, note: answerChoice.note });
    };
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {opts.map((o) => (
            <button key={o.label} type="button" onClick={() => toggle(o.label)}
              className={cn("rounded-lg border px-4 py-2.5 text-base font-medium", selected.includes(o.label) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
              {selected.includes(o.label) ? <Check className="mr-1 inline size-4" /> : null}
              {o.label}
            </button>
          ))}
          {!opts.length ? <p className="text-sm text-muted-foreground">No options set for this question yet.</p> : null}
        </div>
        {q.config.note ? (
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Instructions / details (optional)
            </label>
            <textarea
              value={answerChoice.note ?? ""}
              onChange={(e) => set({ kind: "choice", selected: answerChoice.selected, note: e.target.value })}
              rows={3}
              placeholder="Describe what's needed — areas, materials, how much, anything the crew should know…"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        ) : null}
      </div>
    );
  }

  if (q.kind === "text" && answer?.kind === "text") {
    return (
      <textarea value={answer.text} onChange={(e) => set({ kind: "text", text: e.target.value })} rows={3}
        placeholder="Type your answer…"
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
    );
  }

  // CUTS → carpet yardage. "Same carpet for all cuts" (default) picks the carpet
  // ONCE and applies it to every cut; "Different per area" gives each area its
  // own carpet. The total sq yd to order is figured for you either way.
  if (q.kind === "cuts" && answer?.kind === "cuts") {
    const same = answer.same !== false;
    const groups = answer.groups;
    // Every mutation is a FUNCTIONAL update — it reads the LATEST answer inside
    // setAnswers, so a fast edit (type / delete) can never be overwritten by a
    // stale render snapshot. The yardage below only READS the cuts.
    type CutsA = { kind: "cuts"; same: boolean; product: ProductAns | null; groups: CarpetGroup[] };
    const mutate = (fn: (a: CutsA) => CutsA) =>
      update((prev) => (prev && prev.kind === "cuts" ? fn(prev) : answer));
    const setSame = (v: boolean) => mutate((a) => ({ ...a, same: v }));
    const patchGroup = (gid: string, p: Partial<CarpetGroup>) =>
      mutate((a) => ({ ...a, groups: a.groups.map((g) => (g.id === gid ? { ...g, ...p } : g)) }));
    const patchCut = (gid: string, cid: string, p: Partial<CutRow>) =>
      mutate((a) => ({
        ...a,
        groups: a.groups.map((g) =>
          g.id === gid ? { ...g, cuts: g.cuts.map((c) => (c.id === cid ? { ...c, ...p } : c)) } : g,
        ),
      }));
    const addGroup = () =>
      mutate((a) => {
        const w = defaultWidthFor(a.same !== false ? a.product : null);
        return { ...a, groups: [...a.groups, { ...newCarpetGroup(), cuts: [newCutRow(w)] }] };
      });
    const removeGroup = (gid: string) => mutate((a) => ({ ...a, groups: a.groups.filter((g) => g.id !== gid) }));
    const rollNoun = q.config.category === "vinyl" ? "sheet vinyl" : "carpet";
    const rollNounCap = q.config.category === "vinyl" ? "Sheet vinyl" : "Carpet";
    const rollFamily = q.config.category === "vinyl" ? "vinyl" : "carpet";
    const carpetSystems = carpetInstallSystemsFromLabels(flooringCtx.answeredCarpetInstall);
    const modularTile = rollFamily === "carpet" && !rollGoodsNeedCuts("carpet", carpetSystems);
    const productForWidth = (a: CutsA, g: CarpetGroup): ProductAns | null =>
      a.same !== false ? a.product : g.product;
    const widthFromProduct = (p: ProductAns | null): number | null =>
      p?.rollWidthFt && p.rollWidthFt > 0 ? p.rollWidthFt : null;
    const defaultWidthFor = (p: ProductAns | null) => {
      const w = defaultCutWidthFt({
        family: rollFamily,
        productWidthFt: widthFromProduct(p),
        configWidths: q.config.widths ?? null,
      });
      return w > 0 ? String(w) : "";
    };
    const widthChoices = (p: ProductAns | null) =>
      cutWidthChoicesFt({
        family: rollFamily,
        productWidthFt: widthFromProduct(p),
        configWidths: q.config.widths ?? null,
      });
    const applyProductWidth = (groups: CarpetGroup[], p: ProductAns | null, prevWidth: string) => {
      const next = defaultWidthFor(p);
      return groups.map((g) => ({
        ...g,
        cuts: g.cuts.map((c) =>
          !c.width || c.width === prevWidth || c.width === defaultWidthFor(null)
            ? { ...c, width: next }
            : c,
        ),
      }));
    };
    const addCut = (gid: string) =>
      mutate((a) => {
        const g = a.groups.find((x) => x.id === gid);
        const w = g?.cuts[g.cuts.length - 1]?.width || defaultWidthFor(productForWidth(a, g ?? newCarpetGroup()));
        return {
          ...a,
          groups: a.groups.map((gg) =>
            gg.id === gid ? { ...gg, cuts: [...gg.cuts, newCutRow(w)] } : gg,
          ),
        };
      });
    const removeCut = (gid: string, cid: string) =>
      mutate((a) => ({
        ...a,
        groups: a.groups.map((g) => (g.id === gid ? { ...g, cuts: g.cuts.filter((c) => c.id !== cid) } : g)),
      }));
    const yardOf = (g: CarpetGroup) =>
      carpetYardageFromCuts(g.cuts.map((c) => ({ lengthFt: numv(c.lf), lengthIn: numv(c.li), rollWidthFt: numv(c.width) })));
    const grandY = groups.reduce((s, g) => s + yardOf(g).sqyd, 0);
    const grandOrder = questionnaireCutsGrandOrderLabel(grandY, rollNounCap);
    const SegBtn = ({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) => (
      <button type="button" onClick={onClick}
        className={cn("rounded px-3 py-1.5 text-sm font-medium", on ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
        {label}
      </button>
    );
    if (modularTile) {
      const p = answer.product;
      const defWaste = profileFor("carpet")?.waste ?? 0;
      const takeoff = computeMaterialTakeoff({
        family: "carpet",
        measuredSqft: coverSf,
        wastePct: p && p.wastePct.trim() !== "" ? numv(p.wastePct) : defWaste,
        sqftPerBox: p && numv(p.sqftPerBox) > 0 ? numv(p.sqftPerBox) : null,
        carpetSystems,
      });
      const cartonTbd = p
        ? boxedCartonCoverageTbdDescription({
            family: "carpet",
            productUnit: p.unit,
            sqftPerBox: numv(p.sqftPerBox) > 0 ? numv(p.sqftPerBox) : null,
            label: p.label,
            carpetInstallSystems: carpetSystems,
          })
        : null;
      const setProduct = (product: ProductAns | null) => mutate((a) => ({ ...a, product, same: true }));
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Carpet tile is modular — pick the product. Order is measured area plus waste.
            Carton count only if coverage is on the product. This is not a roll cut plan.
          </p>
          <ProductPicker
            value={p?.productId ?? ""}
            initialLabel={p?.label ?? ""}
            label="Which carpet tile?"
            defaultCategory="carpet"
            fullWidth
            onPick={(prod) => setProduct(prod ? toProductAns(prod) : null)}
            onCreated={(prod) => setProduct(toProductAns(prod))}
            onUseOnce={(input) => setProduct(customToProductAns(input))}
          />
          {p ? (
            <div className="space-y-2 rounded-md border border-dashed p-2.5">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Waste factor</label>
                  <div className="flex items-center gap-1">
                    <Input
                      value={p.wastePct}
                      onChange={(e) => setProduct({ ...p, wastePct: e.target.value })}
                      inputMode="decimal"
                      placeholder={String(defWaste)}
                      className="h-10 w-20 text-base"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Sq ft per box</label>
                  <Input
                    value={p.sqftPerBox}
                    onChange={(e) => setProduct({ ...p, sqftPerBox: e.target.value })}
                    inputMode="decimal"
                    placeholder="if known — do not invent"
                    className="h-10 w-28 text-base"
                  />
                </div>
              </div>
              {coverSf > 0 ? (
                <p className="text-sm">
                  {cartonTbd
                    ? "Order TBD — carton coverage TBD (not How many boxes from leftover taped sq ft). Do not invent a box size."
                    : formatTakeoffStrip(takeoff)}
                </p>
              ) : mixedUnassigned ? (
                <p className="text-xs text-muted-foreground">
                  Assign carpet rooms on the floor map. Mixed jobs do not clone whole-job sq ft onto carpet tile.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Enter rooms first — this is measured area, then order.</p>
              )}
            </div>
          ) : null}
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {/* Same carpet everywhere vs a different carpet per area. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{rollNounCap}</span>
          <div className="inline-flex rounded-md border p-0.5">
            <SegBtn on={same} onClick={() => setSame(true)} label="Same for all cuts" />
            <SegBtn on={!same} onClick={() => setSame(false)} label="Different per area" />
          </div>
        </div>

        {/* Same mode: pick the product once — it applies to every cut below. */}
        {same ? (
          <ProductPicker
            value={answer.product?.productId ?? ""}
            initialLabel={answer.product?.label ?? ""}
            label={`Which ${rollNoun}? (used for every cut)`}
            defaultCategory={q.config.category === "vinyl" ? "vinyl" : "carpet"}
            fullWidth
            onPick={(prod) =>
              mutate((a) => {
                const p = prod ? toProductAns(prod) : null;
                const prev = defaultWidthFor(a.product);
                return { ...a, product: p, groups: applyProductWidth(a.groups, p, prev) };
              })
            }
            onCreated={(prod) =>
              mutate((a) => {
                const p = toProductAns(prod);
                const prev = defaultWidthFor(a.product);
                return { ...a, product: p, groups: applyProductWidth(a.groups, p, prev) };
              })
            }
            onUseOnce={(input) =>
              mutate((a) => {
                const p = customToProductAns(input);
                const prev = defaultWidthFor(a.product);
                return { ...a, product: p, groups: applyProductWidth(a.groups, p, prev) };
              })
            }
          />
        ) : null}

        {groups.map((g, gi) => {
          const y = yardOf(g);
          return (
            <div key={g.id} className="space-y-2.5 rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <Input value={g.area} onChange={(e) => patchGroup(g.id, { area: e.target.value })}
                  placeholder={!same && groups.length > 1 ? `${rollNounCap} ${gi + 1} — area / room` : "Area / room (optional)"}
                  className="h-10 flex-1" />
                {groups.length > 1 ? (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove area" onClick={() => removeGroup(g.id)}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                ) : null}
              </div>
              {!same ? (
                <ProductPicker value={g.product?.productId ?? ""} initialLabel={g.product?.label ?? ""} label={`Which ${rollNoun}?`} defaultCategory={q.config.category === "vinyl" ? "vinyl" : "carpet"} fullWidth
                  onPick={(prod) => {
                    const p = prod ? toProductAns(prod) : null;
                    mutate((a) => {
                      const prev = defaultWidthFor(g.product);
                      return {
                        ...a,
                        groups: a.groups.map((gg) =>
                          gg.id === g.id
                            ? { ...gg, product: p, cuts: applyProductWidth([gg], p, prev)[0]!.cuts }
                            : gg,
                        ),
                      };
                    });
                  }}
                  onCreated={(prod) => {
                    const p = toProductAns(prod);
                    mutate((a) => {
                      const prev = defaultWidthFor(g.product);
                      return {
                        ...a,
                        groups: a.groups.map((gg) =>
                          gg.id === g.id
                            ? { ...gg, product: p, cuts: applyProductWidth([gg], p, prev)[0]!.cuts }
                            : gg,
                        ),
                      };
                    });
                  }}
                  onUseOnce={(input) => {
                    const p = customToProductAns(input);
                    mutate((a) => {
                      const prev = defaultWidthFor(g.product);
                      return {
                        ...a,
                        groups: a.groups.map((gg) =>
                          gg.id === g.id
                            ? { ...gg, product: p, cuts: applyProductWidth([gg], p, prev)[0]!.cuts }
                            : gg,
                        ),
                      };
                    });
                  }} />
              ) : null}
              <div className="space-y-1.5">
                {g.cuts.map((c, ci) => (
                  <div key={c.id} className="flex flex-wrap items-end gap-2">
                    <FtInField label={ci === 0 ? "Length" : ""} ft={c.lf} inch={c.li}
                      onFt={(v) => patchCut(g.id, c.id, { lf: v })} onIn={(v) => patchCut(g.id, c.id, { li: v })} />
                    <span className="pb-2.5 text-muted-foreground">×</span>
                    <div>
                      {ci === 0 ? <label className="mb-1 block text-xs text-muted-foreground">Width (ft)</label> : null}
                      <Input value={c.width} onChange={(e) => patchCut(g.id, c.id, { width: e.target.value })}
                        inputMode="decimal" placeholder="Width TBD"
                        className="h-11 w-20 text-base md:h-10 md:w-16" />
                    </div>
                    <div className="flex flex-wrap gap-1 pb-2">
                      {widthChoices(productForWidth(answer, g)).map((w) => (
                        <button
                          key={w}
                          type="button"
                          onClick={() => patchCut(g.id, c.id, { width: String(w) })}
                          className={cn(
                            "rounded-full border px-2 py-1 text-[11px] font-medium",
                            numv(c.width) === w
                              ? "border-primary bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:border-primary",
                          )}
                        >
                          {w}&apos;
                        </button>
                      ))}
                      {ci === 0 && widthFromProduct(productForWidth(answer, g)) ? (
                        <span className="self-center text-[11px] text-muted-foreground">catalog roll</span>
                      ) : null}
                    </div>
                    {g.cuts.length > 1 ? (
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove cut" onClick={() => removeCut(g.id, c.id)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    ) : null}
                  </div>
                ))}
                <button type="button" onClick={() => addCut(g.id)}
                  className="text-xs font-medium text-primary hover:underline">+ Add cut</button>
              </div>
              <div className="text-sm">
                {same ? "This area" : `This ${rollNoun}`}:{" "}
                <span className="font-semibold tabular-nums">{questionnaireCutGroupOrderLabel(y.sqyd)}</span>
                {!same && !g.product ? <span className="text-muted-foreground"> — pick the {rollNoun} to price it</span> : null}
              </div>
            </div>
          );
        })}
        <Button type="button" variant="outline" size="sm" onClick={addGroup}>
          <Plus className="size-3.5" /> {same ? "Add another area" : `Different ${rollNoun} / area`}
        </Button>
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-semibold">
          {grandOrder.title}
          <span className="ml-1 font-normal text-muted-foreground">
            ({grandOrder.note})
          </span>
        </div>
      </div>
    );
  }

  // STAIRS → step labor + the carpet the steps consume.
  if (q.kind === "stairs" && answer?.kind === "stairs") {
    const opts = q.config.options ?? [{ label: "Waterfall" }, { label: "Upholstered" }];
    const groups = answer.groups;
    const upd = (gs: StairGroup[]) => set({ kind: "stairs", groups: gs });
    const patch = (id: string, p: Partial<StairGroup>) => upd(groups.map((g) => (g.id === id ? { ...g, ...p } : g)));
    return (
      <div className="space-y-3">
        {groups.map((g) => {
          const opt = opts.find((o) => o.label === g.type);
          const n = Math.ceil(numv(g.count));
          const sc = stairsCarpet(n, g.type, opt?.carpet_sqft ?? null);
          const shopAllowance = Number(opt?.carpet_sqft) > 0;
          return (
            <div key={g.id} className="space-y-2 rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Stair type</label>
                  <select value={g.type} onChange={(e) => patch(g.id, { type: e.target.value })}
                    className="h-11 rounded-md border border-input bg-transparent px-2 text-base md:h-10">
                    {opts.map((o) => <option key={o.label} value={o.label}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">How many steps?</label>
                  <Input value={g.count} onChange={(e) => patch(g.id, { count: e.target.value })} inputMode="numeric" placeholder="steps" className="h-11 w-24 text-base md:h-10" />
                </div>
                {groups.length > 1 ? (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => upd(groups.filter((x) => x.id !== g.id))}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                ) : null}
              </div>
              {n > 0 ? (
                <div className="text-sm text-muted-foreground">
                  {shopAllowance && sc.sqyd > 0 ? (
                    <>
                      Shop stair allowance{" "}
                      <span className="font-medium text-foreground tabular-nums">{sc.sqyd} sq yd</span>
                      {" "}equivalent ({n} × {opt?.carpet_sqft} sq ft) — include it in your cuts. This is not an order.
                    </>
                  ) : (
                    <>
                      Include these {n} step{n === 1 ? "" : "s"} in your cut list. We do not invent yardage from step count.
                    </>
                  )}
                  {opt?.cost ? <> · labor <span className="tabular-nums">{formatMoney(sellLab(opt.cost) * n)}</span></> : null}
                </div>
              ) : null}
            </div>
          );
        })}
        <Button type="button" variant="outline" size="sm" onClick={() => upd([...groups, newStairGroup(opts[0]?.label ?? "Waterfall")])}>
          <Plus className="size-3.5" /> Add another stair type
        </Button>
      </div>
    );
  }

  if (q.kind === "hs_stairs" && answer?.kind === "hs_stairs") {
    const a = answer;
    const upd = (p: Partial<Extract<Answer, { kind: "hs_stairs" }>>) => set({ ...a, ...p });
    const steps = Math.max(0, Math.floor(numv(a.steps)));
    const scopeLabel = a.treadRiser ? "tread + riser" : "tread only";
    const lr = numv(a.laborRate) || (Number(q.config.labor_per_step) > 0 ? Number(q.config.labor_per_step) : 0);
    const p = a.product;
    const wrapFam = familyFromCatalogCategory(p?.category);
    const wrapAsksCount = extraAsksCountQty({ family: wrapFam, productUnit: p?.unit });
    const setWrapProduct = (prod: ProductAns | null) => {
      const keep = extraAsksCountQty({
        family: familyFromCatalogCategory(prod?.category),
        productUnit: prod?.unit,
      });
      upd({ product: prod, qty: keep ? a.qty : "" });
    };
    const hsWrapCat = (() => {
      const hs = flooringCtx.families.filter(isHardSurfaceFamily);
      return hs.length === 1 ? catalogCategoryForFamily(hs[0]) : undefined;
    })();
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">How many steps?</label>
            <Input value={a.steps} onChange={(e) => upd({ steps: e.target.value })} inputMode="numeric" placeholder="0 = no stairs" className="h-11 w-28 text-base md:h-10" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Scope</label>
            <div className="inline-flex overflow-hidden rounded-md border">
              <button type="button" onClick={() => upd({ treadRiser: true })}
                className={cn("px-3 py-2 text-sm font-medium", a.treadRiser ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
                Tread + riser
              </button>
              <button type="button" onClick={() => upd({ treadRiser: false })}
                className={cn("px-3 py-2 text-sm font-medium", !a.treadRiser ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
                Tread only
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Stair labor $ / step</label>
            <Input value={a.laborRate} onChange={(e) => upd({ laborRate: e.target.value })} inputMode="decimal" placeholder="TBD" className="h-11 w-24 text-base md:h-10" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Wrap product (optional — qty is not automatic)</label>
          <ProductPicker
            value={p?.productId ?? ""}
            initialLabel={p?.label ?? ""}
            label=""
            defaultCategory={hsWrapCat}
            onPick={(prod) => setWrapProduct(prod ? toProductAns(prod) : null)}
            onCreated={(prod) => setWrapProduct(toProductAns(prod))}
            onUseOnce={(input) => setWrapProduct(customToProductAns(input))}
          />
        </div>
        {wrapAsksCount ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted-foreground">{EXTRA_AREA_COUNT_QTY_LABEL}</label>
            <Input
              value={a.qty ?? ""}
              onChange={(e) => upd({ qty: e.target.value })}
              inputMode="decimal"
              placeholder={countUnitForTbd(p?.unit).phrase}
              className="h-10 w-28"
            />
            <span className="text-xs text-muted-foreground">{countUnitForTbd(p?.unit).phrase}</span>
            {numv(a.qty ?? "") > 0 ? (
              <span className="w-full text-xs text-muted-foreground tabular-nums">
                {extraCountReviewLine({
                  family: wrapFam,
                  productUnit: p?.unit,
                  qty: numv(a.qty ?? ""),
                  label: p?.label,
                })}
              </span>
            ) : null}
            <p className="w-full text-xs text-muted-foreground">{EXTRA_AREA_COUNT_QTY_HINT}</p>
          </div>
        ) : null}
        {steps > 0 ? (
          <div className="rounded-md border border-dashed p-2.5 text-sm">
            <span className="font-semibold tabular-nums">{steps}</span> step{steps === 1 ? "" : "s"} · {scopeLabel}
            {" · "}noses / treads / risers fill on Trims in EACH
            {p && wrapAsksCount && numv(a.qty ?? "") > 0 ? (
              <> · {extraCountReviewLine({ family: wrapFam, productUnit: p.unit, qty: numv(a.qty ?? ""), label: p.label })}</>
            ) : p ? (
              <> · {p.label} wrap qty TBD (not an automatic sq ft/step order)</>
            ) : null}
            {lr > 0 ? (
              <> · labor <span className="tabular-nums">{formatMoney(sellLab(lr) * steps)}</span> ({steps} × {formatMoney(sellLab(lr))}/step)</>
            ) : (
              <> · labor rate TBD — not invented from 8 sq ft/step</>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Enter the number of steps (0 = no stairs). Wrap coverage is not 8 sq ft/step.</p>
        )}
      </div>
    );
  }

  // SUBFLOOR → sheets per room.
  if (q.kind === "subfloor" && answer?.kind === "subfloor") {
    const opts = q.config.options ?? [];
    const sheetSqft = resolvedSheetSqft(q.config.sheet_sqft);
    const rooms = prepRooms.length
      ? prepRooms
      : coverSf > 0
        ? [{ name: "", sqft: coverSf, lenIn: null, widIn: null }]
        : [];
    const totalSheets = sheetSqft != null
      ? rooms.reduce((s, r) => s + subfloorSheets(r.sqft, sheetSqft), 0)
      : 0;
    return (
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Thickness</label>
          <div className="flex flex-wrap gap-2">
            {opts.map((o) => (
              <button key={o.label} type="button" onClick={() => set({ kind: "subfloor", thickness: o.label })}
                className={cn("rounded-md border px-3 py-2 text-sm font-medium", answer.thickness === o.label ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
                {o.label}{o.cost ? <span className="ml-1 text-xs text-muted-foreground">{formatMoney(o.cost)}/sheet</span> : null}
              </button>
            ))}
          </div>
        </div>
        {sheetSqft == null ? (
          <p className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200">
            Sheet coverage is not in Settings. We do not invent a 4×8 (32 sq ft). Confirm after demo or enter coverage in Settings.
          </p>
        ) : coverSf > 0 ? (
          prepQuantitiesAreFinal(flooringCtx.prepConfidence) ? (
          <div className="space-y-1 rounded-lg border bg-muted/20 p-3 text-sm">
            {rooms.map((r, i) => (
              <div key={i} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{r.name || "Area"} — {Math.round(r.sqft)} sq ft</span>
                <span className="font-medium tabular-nums">{subfloorSheets(r.sqft, sheetSqft)} sheets</span>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t pt-1 font-semibold">
              <span>Total ({sheetSqft} sq ft / sheet, rounded up){prepQuantitySuffix(flooringCtx.prepConfidence)}</span>
              <span className="tabular-nums">{totalSheets} sheets</span>
            </div>
          </div>
          ) : (
            <p className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200">
              Prep is Field verify / TBD — sheet count is not added to the estimate. Confirm after demo.
            </p>
          )
        ) : mixedUnassigned ? (
          <p className="text-sm text-muted-foreground">
            Assign hard-surface rooms on the floor map. Mixed jobs do not order subfloor for the carpet.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Add areas first — sheets are figured from each room&apos;s sq ft.</p>
        )}
      </div>
    );
  }

  // SELF-LEVELER → bags from area ÷ coverage-at-thickness.
  if (q.kind === "selflevel" && answer?.kind === "selflevel") {
    const cov = q.config.coverage_sqft ?? 0;
    const covT = q.config.coverage_thickness_in ?? 0;
    const pour = selfLevelPourThicknessIn(q.config, answer.thickness);
    const THICKS = [
      { v: 0.0625, l: '1/16"' }, { v: 0.125, l: '1/8"' }, { v: 0.1875, l: '3/16"' },
      { v: 0.25, l: '1/4"' }, { v: 0.375, l: '3/8"' }, { v: 0.5, l: '1/2"' },
    ];
    const bags = cov > 0 && coverSf > 0 ? bagsNeeded(coverSf, cov, covT > 0 ? covT : null, covT > 0 ? pour : null) : 0;
    const label = thicknessLabel(pour) || (covT > 0 ? "stated coverage thickness" : "");
    return (
      <div className="space-y-3">
        {covT > 0 ? (
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Pour thickness</label>
            <div className="flex flex-wrap gap-2">
              {THICKS.map((t) => (
                <button key={t.v} type="button" onClick={() => set({ kind: "selflevel", thickness: String(t.v) })}
                  className={cn("rounded-md border px-3 py-2 text-sm font-medium", Math.abs(pour - t.v) < 1e-6 ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
                  {t.l}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Flat coverage — thickness doesn&apos;t change the count.</p>
        )}
        {coverSf > 0 && cov > 0 ? (
          prepQuantitiesAreFinal(flooringCtx.prepConfidence) ? (
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            {Math.round(coverSf)} sq ft{covT > 0 && label ? ` at ${label}` : ""} ÷ {cov} SF/bag ={" "}
            <span className="font-semibold tabular-nums">{bags} bag{bags === 1 ? "" : "s"}</span>
            {prepQuantitySuffix(flooringCtx.prepConfidence)}
            {covT > 0 && !(pour > 0) ? (
              <span className="mt-1 block text-xs text-muted-foreground">
                Pick a pour thickness to scale bags. We do not invent 1/4&quot;.
              </span>
            ) : null}
          </div>
          ) : (
            <p className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200">
              Prep is Field verify / TBD — bag count is not added to the estimate. Confirm after demo.
            </p>
          )
        ) : mixedUnassigned ? (
          <p className="text-sm text-muted-foreground">
            Assign hard-surface rooms on the floor map. Mixed jobs do not pour self-leveler onto the carpet.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Add areas first — bags are figured from this family&apos;s measured sq ft.</p>
        )}
      </div>
    );
  }

  return null;
}

/** Order vs From-stock (+ vendor) for a picked material. Stock → off the PO. */
function SourceToggle({
  p, onChange, compact,
}: {
  p: ProductAns; onChange: (np: ProductAns) => void; compact?: boolean;
}) {
  return (
    <div className={compact ? "flex flex-wrap items-center gap-2" : "space-y-2"}>
      <div className="inline-flex rounded-md border p-0.5">
        <button type="button" onClick={() => onChange({ ...p, source: "order" })}
          className={cn("rounded px-3 py-1.5 text-sm font-medium", p.source === "order" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
          Order
        </button>
        <button type="button" onClick={() => onChange({ ...p, source: "stock" })}
          className={cn("rounded px-3 py-1.5 text-sm font-medium", p.source === "stock" ? "bg-amber-500 text-white" : "text-muted-foreground")}>
          From stock
        </button>
      </div>
      {p.source === "order" ? (
        <div className={compact ? "" : ""}>
          {!compact ? <label className="mb-1 block text-xs text-muted-foreground">Order from (vendor)</label> : null}
          <Input value={p.vendor} onChange={(e) => onChange({ ...p, vendor: e.target.value })}
            placeholder={p.supplierName || "Vendor name"} className="h-10 max-w-xs" />
        </div>
      ) : !compact ? (
        <p className="text-xs text-amber-600">From stock — stays on the estimate &amp; work order, kept off the PO.</p>
      ) : null}
    </div>
  );
}

/** A feet + inches pair for a single dimension (length or width). */
function FtInField({
  label, ft, inch, onFt, onIn, disabled,
}: {
  label: string; ft: string; inch: string;
  onFt: (v: string) => void; onIn: (v: string) => void; disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <div className="flex items-end gap-1">
        <Input value={ft} onChange={(e) => onFt(e.target.value)} inputMode="decimal" placeholder="ft" disabled={disabled}
          className="h-11 w-16 text-base md:h-10 md:w-14" />
        <span className="pb-2.5 text-xs text-muted-foreground">ft</span>
        <Input value={inch} onChange={(e) => onIn(e.target.value)} inputMode="decimal" placeholder="in" disabled={disabled}
          className="h-11 w-14 text-base md:h-10 md:w-12" />
        <span className="pb-2.5 text-xs text-muted-foreground">in</span>
      </div>
    </div>
  );
}
