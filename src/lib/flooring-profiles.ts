// The "brain" of the smart estimate builder: how each flooring type is built.
// Each profile knows its pricing unit, typical waste, how it's measured, and the
// companion materials/labor that job actually needs — so an estimate captures
// the full bill of materials (which the PO, warehouse, and install all rely on).

import type { ProductCategory } from "@/lib/types";

export type MeasureUnit = "sqft" | "sqyd";

/** How a companion's quantity is derived from the room. */
export type SizeBy = "area" | "perimeter" | "each";

export interface Companion {
  key: string;
  label: string;
  category: ProductCategory;
  sizeBy: SizeBy;
  unit: string; // display/billing unit
  /** Suggested ON by default (the things you almost always need). */
  defaultOn: boolean;
  /** Treated as labor (no material to order) vs a real material line. */
  labor?: boolean;
  /** Comes in full rolls of this many units — round the quantity UP to whole rolls. */
  rollUnits?: number;
  hint?: string;
}

export interface FlooringProfile {
  category: ProductCategory;
  label: string;
  /** Primary pricing/measuring unit. Carpet is sold per square yard. */
  unit: MeasureUnit;
  /** Typical material waste % for this type. */
  waste: number;
  /** Short guidance shown in the builder. */
  measureHint: string;
  companions: Companion[];
}

const tearout = (label: string, unit: string): Companion => ({
  key: "tearout",
  label,
  category: "labor",
  sizeBy: "area",
  unit,
  defaultOn: false,
  labor: true,
  hint: "Remove & haul away the old flooring.",
});

export const FLOORING_PROFILES: Record<string, FlooringProfile> = {
  carpet: {
    category: "carpet",
    label: "Carpet",
    unit: "sqyd",
    waste: 10,
    measureHint: "Carpet is priced by the square yard. Enter room L × W; we convert.",
    companions: [
      { key: "pad", label: "Carpet pad", category: "underlayment", sizeBy: "area", unit: "sqyd", defaultOn: true, rollUnits: 30, hint: "Rounded up to full 30 sq yd rolls." },
      { key: "tackstrip", label: "Tackstrip", category: "trim", sizeBy: "perimeter", unit: "lnft", defaultOn: false },
      tearout("Tear out old carpet & pad", "sqyd"),
    ],
  },
  lvp: {
    category: "lvp",
    label: "Luxury Vinyl (LVP/LVT)",
    unit: "sqft",
    waste: 8,
    measureHint: "Priced by the square foot. Add ~8% for cuts & layout.",
    companions: [
      { key: "underlayment", label: "Underlayment", category: "underlayment", sizeBy: "area", unit: "sqft", defaultOn: false, hint: "If the plank doesn't have it attached." },
      { key: "transitions", label: "Transitions / T-mold", category: "trim", sizeBy: "each", unit: "each", defaultOn: false },
      { key: "quarter", label: "Quarter round / shoe", category: "trim", sizeBy: "perimeter", unit: "lnft", defaultOn: false },
      { key: "prep", label: "Floor prep / level", category: "labor", sizeBy: "area", unit: "sqft", defaultOn: false, labor: true },
      tearout("Tear out old flooring", "sqft"),
    ],
  },
  hardwood: {
    category: "hardwood",
    label: "Hardwood",
    unit: "sqft",
    waste: 7,
    measureHint: "Priced by the square foot. ~7% waste for racking & cuts.",
    companions: [
      { key: "underlayment", label: "Underlayment / moisture barrier", category: "underlayment", sizeBy: "area", unit: "sqft", defaultOn: true },
      { key: "transitions", label: "Transitions / reducers", category: "trim", sizeBy: "each", unit: "each", defaultOn: false },
      { key: "shoe", label: "Shoe molding / quarter round", category: "trim", sizeBy: "perimeter", unit: "lnft", defaultOn: false },
      tearout("Tear out old flooring", "sqft"),
    ],
  },
  laminate: {
    category: "laminate",
    label: "Laminate",
    unit: "sqft",
    waste: 7,
    measureHint: "Priced by the square foot. Needs a foam underlayment.",
    companions: [
      { key: "underlayment", label: "Foam underlayment", category: "underlayment", sizeBy: "area", unit: "sqft", defaultOn: true },
      { key: "transitions", label: "Transitions / T-mold", category: "trim", sizeBy: "each", unit: "each", defaultOn: false },
      { key: "quarter", label: "Quarter round / shoe", category: "trim", sizeBy: "perimeter", unit: "lnft", defaultOn: false },
      tearout("Tear out old flooring", "sqft"),
    ],
  },
  tile: {
    category: "tile",
    label: "Tile",
    unit: "sqft",
    waste: 12,
    measureHint: "Priced by the square foot. Tile runs ~12% waste; needs setting materials.",
    companions: [
      { key: "thinset", label: "Thinset mortar", category: "other", sizeBy: "area", unit: "sqft", defaultOn: true, hint: "~1 bag per 50–60 sq ft." },
      { key: "grout", label: "Grout", category: "other", sizeBy: "area", unit: "sqft", defaultOn: true },
      { key: "backer", label: "Backer board / membrane", category: "underlayment", sizeBy: "area", unit: "sqft", defaultOn: false },
      { key: "trim", label: "Tile trim / edge / bullnose", category: "trim", sizeBy: "perimeter", unit: "lnft", defaultOn: false },
      tearout("Tear out old flooring", "sqft"),
    ],
  },
  vinyl: {
    category: "vinyl",
    label: "Sheet Vinyl",
    unit: "sqft",
    waste: 7,
    measureHint: "Priced by the square foot.",
    companions: [
      { key: "prep", label: "Floor prep / level", category: "labor", sizeBy: "area", unit: "sqft", defaultOn: false, labor: true },
      { key: "transitions", label: "Transitions / edge", category: "trim", sizeBy: "each", unit: "each", defaultOn: false },
      tearout("Tear out old flooring", "sqft"),
    ],
  },
};

/** The flooring types shown as the big pickers (in order). */
export const FLOORING_TYPES = [
  "carpet",
  "lvp",
  "hardwood",
  "laminate",
  "tile",
  "vinyl",
] as const;

export function profileFor(category: string): FlooringProfile | null {
  return FLOORING_PROFILES[category] ?? null;
}

/** Area in sq ft from feet dimensions. */
export function areaSqft(lengthFt: number, widthFt: number): number {
  return Math.round(lengthFt * widthFt * 100) / 100;
}

/** Quantity for a companion, given the room's sq ft and perimeter (lnft). */
export function companionQty(
  c: Companion,
  sqft: number,
  perimeterLnft: number,
): number {
  if (c.sizeBy === "each") return 1;
  if (c.sizeBy === "perimeter") return Math.round(perimeterLnft);
  // area — match the companion's unit (sqyd for carpet pad, else sqft)
  const v = c.unit === "sqyd" ? sqft / 9 : sqft;
  // Materials sold in full rolls (e.g. pad) round UP to whole rolls.
  if (c.rollUnits && c.rollUnits > 0 && v > 0) {
    return Math.ceil(v / c.rollUnits) * c.rollUnits;
  }
  return Math.round(v * 100) / 100;
}

/** Whole rolls implied by a (roll-rounded) companion quantity. */
export function companionRolls(c: Companion, qty: number): number | null {
  if (!c.rollUnits || c.rollUnits <= 0) return null;
  return Math.round(qty / c.rollUnits);
}
