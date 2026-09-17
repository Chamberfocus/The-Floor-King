/**
 * Roll-goods layout implications — not a cut plan.
 *
 * An experienced estimator looks at room L×W against the product's real roll
 * width and says "you'll have a seam" or "run it the short way." We capture
 * that warning. We do not invent cuts, fill pieces, or an order quantity.
 *
 * Catalog `roll_width_ft` must be present. Family defaults (12'/15') are for
 * the cuts editor chips, not for asserting a seam as fact.
 */

import { formatDimensionPair } from "./takeoff";

export interface MeasuredRect {
  name: string;
  lengthFt: number;
  widthFt: number;
}

export type SeamKind = "must_seam" | "direction_matters" | "fits";

function feet(ft: number, inch?: number): number {
  const f = Number(ft);
  const i = Number(inch);
  const n = (Number.isFinite(f) ? f : 0) + (Number.isFinite(i) ? i / 12 : 0);
  return n > 0 ? n : 0;
}

function dimLabel(lengthFt: number, widthFt: number): string {
  const parts = (n: number): [number, number] => {
    const whole = Math.floor(n + 1e-9);
    const inch = Math.round((n - whole) * 12);
    if (inch === 12) return [whole + 1, 0];
    return [whole, inch];
  };
  const [lf, li] = parts(lengthFt);
  const [wf, wi] = parts(widthFt);
  return formatDimensionPair(lf, li, wf, wi) || `${lengthFt}' × ${widthFt}'`;
}

/**
 * Pull L×W rectangles from room + section dimensions.
 * Sq ft overrides (irregular rooms) have no shape — skip them rather than
 * inventing a rectangle from area.
 */
export function measuredRectsFromRooms(
  rooms: {
    name?: string;
    lengthFt: number;
    lengthIn?: number;
    widthFt: number;
    widthIn?: number;
    sqftOverride?: number;
    sections?: {
      name?: string;
      lengthFt: number;
      lengthIn?: number;
      widthFt: number;
      widthIn?: number;
    }[];
  }[],
): MeasuredRect[] {
  const out: MeasuredRect[] = [];
  for (const r of rooms) {
    const override = Number(r.sqftOverride);
    const hasOverride = Number.isFinite(override) && override > 0;
    const extras = (r.sections ?? []).filter(
      (s) => feet(s.lengthFt, s.lengthIn) > 0 && feet(s.widthFt, s.widthIn) > 0,
    );
    const push = (name: string, lengthFt: number, widthFt: number) => {
      if (lengthFt > 0 && widthFt > 0) out.push({ name: name.trim() || "Room", lengthFt, widthFt });
    };
    // Irregular override with no typed L×W: unknown shape.
    if (hasOverride && extras.length === 0) {
      const L = feet(r.lengthFt, r.lengthIn);
      const W = feet(r.widthFt, r.widthIn);
      if (L > 0 && W > 0) push(r.name ?? "Room", L, W);
      continue;
    }
    push(r.name ?? "Room", feet(r.lengthFt, r.lengthIn), feet(r.widthFt, r.widthIn));
    const roomName = (r.name ?? "Room").trim() || "Room";
    for (const s of extras) {
      const sec = (s.name ?? "Section").trim() || "Section";
      push(`${roomName} / ${sec}`, feet(s.lengthFt, s.lengthIn), feet(s.widthFt, s.widthIn));
    }
  }
  return out;
}

/**
 * Compare one rectangle to a known catalog roll width.
 * Returns null when width or dimensions are missing — we do not invent 12'.
 */
export function seamImplication(
  room: MeasuredRect,
  rollWidthFt: number | null | undefined,
): SeamKind | null {
  const R = Number(rollWidthFt);
  const L = Number(room.lengthFt);
  const W = Number(room.widthFt);
  if (!(R > 0) || !(L > 0) || !(W > 0)) return null;
  const shorter = Math.min(L, W);
  const longer = Math.max(L, W);
  // Tiny float slack so 12.0001' vs 12' is not a fake seam.
  const slack = 0.05;
  if (shorter > R + slack) return "must_seam";
  if (longer > R + slack) return "direction_matters";
  return "fits";
}

function uniquePositive(nums: Array<number | null | undefined>): number[] {
  const set = new Set<number>();
  for (const n of nums) {
    const v = Number(n);
    if (Number.isFinite(v) && v > 0) set.add(v);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Estimator-style warnings. Not a cut list. Skips entirely when cuts already
 * exist (the salesperson already laid out the roll) or when catalog width is
 * missing (do not assert a 12' seam from a chip default).
 */
export function rollGoodsSeamWarnings(args: {
  family: "carpet" | "vinyl";
  rollWidthFt?: number | null;
  /** When products disagree, we warn instead of picking a width. */
  catalogWidthsFt?: Array<number | null | undefined>;
  rooms: MeasuredRect[];
  patternMatch?: boolean;
  hasCuts?: boolean;
}): { id: string; text: string }[] {
  if (args.hasCuts) return [];
  const widths = uniquePositive(
    args.catalogWidthsFt && args.catalogWidthsFt.length
      ? args.catalogWidthsFt
      : [args.rollWidthFt],
  );
  if (widths.length === 0) return [];

  const noun = args.family === "vinyl" ? "sheet vinyl" : "carpet";
  const w: { id: string; text: string }[] = [];

  if (widths.length > 1) {
    w.push({
      id: `${args.family}-roll-widths`,
      text: `Assigned ${noun} products have different catalog roll widths (${widths.map((n) => `${n}'`).join(" and ")}). Confirm which width goes in which room before cutting — do not invent a layout.`,
    });
    return w;
  }

  const roll = widths[0]!;
  const rooms = args.rooms.filter((r) => r.lengthFt > 0 && r.widthFt > 0);
  if (!rooms.length) return [];

  const must: MeasuredRect[] = [];
  const direction: MeasuredRect[] = [];
  for (const r of rooms) {
    const kind = seamImplication(r, roll);
    if (kind === "must_seam") must.push(r);
    else if (kind === "direction_matters") direction.push(r);
  }

  const list = (rows: MeasuredRect[]) =>
    rows
      .map((r) => `${r.name} (${dimLabel(r.lengthFt, r.widthFt)})`)
      .join("; ");

  if (must.length) {
    const match = args.patternMatch
      ? " Pattern matching will take more than a plain seam."
      : "";
    w.push({
      id: `${args.family}-must-seam`,
      text: `${must.length === 1 ? "This area is" : "These areas are"} wider than the ${roll}' ${noun} roll in both directions, so a seam is required: ${list(must)}. Enter cuts — this is not a cut plan.${match}`,
    });
  }
  if (direction.length) {
    w.push({
      id: `${args.family}-direction`,
      text: `${direction.length === 1 ? "This area fits" : "These areas fit"} one way on the ${roll}' ${noun} roll — confirm direction before cutting: ${list(direction)}. Running it the long way would need a seam.`,
    });
  }
  return w;
}
