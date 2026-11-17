/**
 * Turn a questionnaire answer into the strings `show_if` / overlay read.
 *
 * Stair kinds are not yes/no. A count > 0 means the job has stairs — that
 * is the "Yes" the landings / open-sides questions were written against
 * before the old `stairs` yes/no was folded into the stair-type steps.
 */

import { accessoryUnitForType } from "./quantities";

export type GateAnswer = {
  kind: string;
  yes?: boolean;
  selected?: string[];
  rows?: { option?: string }[];
  text?: string;
  product?: { label?: string } | null;
  value?: string;
  groups?: { type?: string; count?: string }[];
  steps?: string;
};

function positiveCount(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0;
}

/**
 * yesno ↔ choice Yes/No so a kind change (subfloor Field verify in 0206)
 * does not drop in-flight drafts. Field verify / other choice labels are
 * left alone — never coerced into a fake No.
 */
export function coerceYesNoChoiceAnswer(questionKind: string, a: unknown): unknown {
  if (!a || typeof a !== "object") return a;
  const ans = a as GateAnswer & { note?: string };
  if (questionKind === "choice" && ans.kind === "yesno") {
    const selected = [ans.yes ? "Yes" : "No"];
    return ans.note ? { kind: "choice", selected, note: ans.note } : { kind: "choice", selected };
  }
  if (questionKind === "yesno" && ans.kind === "choice") {
    const s = (ans.selected ?? [])[0] ?? "";
    if (/^yes$/i.test(s)) return { kind: "yesno", yes: true };
    if (/^no$/i.test(s)) return { kind: "yesno", yes: false };
  }
  return a;
}

/** Values a keyed answer contributes to `valByKey`. */
export function answerGateValues(a: unknown): string[] {
  if (!a || typeof a !== "object") return [];
  const ans = a as GateAnswer;
  switch (ans.kind) {
    case "yesno":
      return [ans.yes ? "Yes" : "No"];
    case "choice":
      return ans.selected ?? [];
    case "choice_areas":
      return (ans.rows ?? []).map((r) => r.option).filter((x): x is string => !!x);
    case "text": {
      const t = (ans.text ?? "").trim();
      return t ? [t] : [];
    }
    case "product":
      return ans.product?.label ? [ans.product.label] : [];
    case "number": {
      const t = (ans.value ?? "").trim();
      return t ? [t] : [];
    }
    case "stairs": {
      const groups = ans.groups ?? [];
      const active = groups.filter((g) => positiveCount(g.count) > 0);
      if (!active.length) return [];
      const types = [...new Set(active.map((g) => g.type).filter((t): t is string => !!t))];
      return ["Yes", ...types];
    }
    case "hs_stairs":
      return positiveCount(ans.steps) > 0 ? ["Yes"] : [];
    case "landings": {
      const takeoff = landingTakeoffFromAnswer(a);
      return takeoff.count > 0 || takeoff.sqft > 0 ? ["Yes"] : [];
    }
    default:
      return [];
  }
}

const STAIR_SOURCE_KEYS = ["stairs", "carpet_stairs", "hs_plank_stairs", "carpet_tile_stairs"] as const;

/**
 * The live stair questions are keyed `carpet_stairs` / `hs_plank_stairs`.
 * Landings and open-sides still (and after 0196, also) look for `stairs=Yes`.
 * Copy Yes onto `stairs` so those follow-ups actually appear.
 */
export function synthesizeStairGate(valByKey: Record<string, string[]>): Record<string, string[]> {
  const hasStairs = STAIR_SOURCE_KEYS.some((k) => (valByKey[k] ?? []).includes("Yes"));
  if (!hasStairs) return valByKey;
  const cur = valByKey.stairs ?? [];
  if (cur.includes("Yes")) return valByKey;
  return { ...valByKey, stairs: [...cur, "Yes"] };
}

export type StairAnswerKind = "stairs" | "hs_stairs";

/** Step count from one stair answer. Empty / zero is 0 — never invent stairs. */
export function stairStepCountFromAnswer(a: unknown): number {
  if (!a || typeof a !== "object") return 0;
  const ans = a as GateAnswer;
  if (ans.kind === "stairs") {
    return (ans.groups ?? []).reduce((sum, g) => sum + positiveCount(g.count), 0);
  }
  if (ans.kind === "hs_stairs") {
    return positiveCount(ans.steps);
  }
  return 0;
}

/**
 * Sum of stair steps already entered on the job.
 *
 * Carpet waterfall (`stairs`) and hard-surface plank (`hs_stairs`) are
 * different constructions. Pass `kinds` to read only one — Trims fill for
 * treads/risers/noses uses hard-surface steps, not carpet steps.
 */
export function stairStepCountFromAnswers(
  answers: Record<string, unknown> | unknown[] | null | undefined,
  kinds: readonly StairAnswerKind[] = ["stairs", "hs_stairs"],
): number {
  if (!answers) return 0;
  const values = Array.isArray(answers) ? answers : Object.values(answers);
  const allow = new Set(kinds);
  let n = 0;
  for (const a of values) {
    if (!a || typeof a !== "object") continue;
    const kind = (a as GateAnswer).kind;
    if (kind !== "stairs" && kind !== "hs_stairs") continue;
    if (!allow.has(kind)) continue;
    n += stairStepCountFromAnswer(a);
  }
  return n;
}

/**
 * Shop allowance when the stair is covered with the flooring, not a tread.
 * 8 sq ft covers the step and the riser. 4 sq ft is the tread only.
 * This is the order quantity. Room waste is not applied on top of it.
 */
export const HS_STAIR_FLOOR_SQFT_WITH_RISER = 8;
export const HS_STAIR_FLOOR_SQFT_TREAD = 4;

export type HsStairCover = "treads" | "material";
export type HsStairRiserFinish = "white_board" | "leave";

export const HS_STAIR_WHITE_BOARD_LABEL = "White board" as const;

/** Existing TRIM_TYPES labels — do not invent Versatrim SKUs or prices. */
export const HARD_SURFACE_STAIR_TRIM_LABELS = ["Stair tread", "Stair riser", "Stair nose"] as const;

export type HardSurfaceStairTrimLabel = (typeof HARD_SURFACE_STAIR_TRIM_LABELS)[number];

function matchHardSurfaceStairTrim(type: string, label: HardSurfaceStairTrimLabel): boolean {
  if (label === "Stair nose") return /stair\s*-?\s*nose|stairnose/i.test(type);
  if (label === "Stair tread") return /tread/i.test(type);
  return /riser/i.test(type);
}

/**
 * Set qty = step count on stair tread, riser, and nose rows (adding any that
 * are missing). Stair noses are EACH, never square feet — the caller must
 * create rows with the existing trim type unit.
 */
export function applyHardSurfaceStairTrimFill<T extends { type: string; qty: string }>(
  rows: T[],
  stepCount: number,
  addRow: (label: HardSurfaceStairTrimLabel) => T,
): T[] {
  if (!(stepCount > 0)) return rows;
  const qty = String(Math.ceil(stepCount));
  let rs = [...rows];
  for (const label of HARD_SURFACE_STAIR_TRIM_LABELS) {
    const idx = rs.findIndex((x) => matchHardSurfaceStairTrim(x.type, label));
    if (idx >= 0) {
      rs[idx] = { ...rs[idx], qty };
    } else {
      rs = [...rs, { ...addRow(label), qty }];
    }
  }
  return rs;
}

export function hsStairCoverOf(answer: unknown): HsStairCover | null {
  if (!answer || typeof answer !== "object") return null;
  const cover = (answer as { cover?: unknown }).cover;
  return cover === "treads" || cover === "material" ? cover : null;
}

export function hsStairRiserFinishOf(answer: unknown): HsStairRiserFinish | null {
  if (!answer || typeof answer !== "object") return null;
  const finish = (answer as { riserFinish?: unknown }).riserFinish;
  return finish === "white_board" || finish === "leave" ? finish : null;
}

/**
 * Square feet to order when the stairs are covered with the flooring.
 * Stair treads, an unchosen cover, and a zero step count add nothing.
 */
export function hsStairMaterialOrder(args: {
  steps: number;
  cover: HsStairCover | null;
  coverRiser: boolean;
}): { sqft: number; perStep: number; label: string } | null {
  if (args.cover !== "material") return null;
  const steps = Math.ceil(Number(args.steps));
  if (!(steps > 0)) return null;
  const perStep = args.coverRiser ? HS_STAIR_FLOOR_SQFT_WITH_RISER : HS_STAIR_FLOOR_SQFT_TREAD;
  return {
    sqft: steps * perStep,
    perStep,
    label: args.coverRiser ? "tread + riser" : "tread only",
  };
}

/**
 * Stamp on the flooring line so the stair allowance is part of that line's
 * square footage, and room waste is not applied to it again.
 */
export function stairAllowanceStamp(sqft: number): string {
  const n = Math.round(sqft * 100) / 100;
  return `stair allowance ${n} sq ft unwasted`;
}

export function stairAllowanceSqftFromText(text: string | null | undefined): number {
  const match = /stair allowance (\d+(?:\.\d+)?) sq ft unwasted/i.exec(text ?? "");
  if (!match) return 0;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface LandingSizeInput {
  lf?: string;
  li?: string;
  wf?: string;
  wi?: string;
  /** Direct square feet when the landing is not a simple rectangle. */
  sqft?: string;
}

function landingNum(raw: string | undefined): number {
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** Square feet of one landing. A blank size is 0 — never invent a landing. */
export function landingPieceSqft(row: LandingSizeInput): number {
  const direct = landingNum(row.sqft);
  if (direct > 0) return Math.round(direct * 100) / 100;
  const length = landingNum(row.lf) + landingNum(row.li) / 12;
  const width = landingNum(row.wf) + landingNum(row.wi) / 12;
  if (length > 0 && width > 0) return Math.round(length * width * 100) / 100;
  return 0;
}

export interface LandingTakeoff {
  /** Landings the salesperson counted, sized or not. */
  count: number;
  /** Sized landings only. This joins the flooring square footage. */
  sqft: number;
  /** Counted landings with no size yet. They are not added to the total. */
  unsized: number;
}

/** Landings from the stair-landings answer. A bare count does not invent square feet. */
export function landingTakeoffFromAnswer(answer: unknown): LandingTakeoff {
  const empty: LandingTakeoff = { count: 0, sqft: 0, unsized: 0 };
  if (!answer || typeof answer !== "object") return empty;
  const ans = answer as { kind?: string; value?: string; rows?: LandingSizeInput[] };
  if (ans.kind === "number") {
    const n = Math.ceil(landingNum(ans.value));
    const count = Number.isFinite(n) && n > 0 ? n : 0;
    return { count, sqft: 0, unsized: count };
  }
  if (ans.kind !== "landings") return empty;
  const rows = ans.rows ?? [];
  let sqft = 0;
  let unsized = 0;
  let count = 0;
  for (const row of rows) {
    const piece = landingPieceSqft(row);
    const touched =
      piece > 0 ||
      [row.lf, row.li, row.wf, row.wi, row.sqft].some((part) => String(part ?? "").trim() !== "");
    if (!touched && rows.length > 1) continue;
    if (!touched) continue;
    count += 1;
    if (piece > 0) sqft += piece;
    else unsized += 1;
  }
  return { count, sqft: Math.round(sqft * 100) / 100, unsized };
}

export function landingTakeoffFromAnswers(
  answers: Record<string, unknown> | unknown[] | null | undefined,
): LandingTakeoff {
  const empty: LandingTakeoff = { count: 0, sqft: 0, unsized: 0 };
  if (!answers) return empty;
  const values = Array.isArray(answers) ? answers : Object.values(answers);
  let count = 0;
  let sqft = 0;
  let unsized = 0;
  for (const value of values) {
    const one = landingTakeoffFromAnswer(value);
    count += one.count;
    sqft += one.sqft;
    unsized += one.unsized;
  }
  return { count, sqft: Math.round(sqft * 100) / 100, unsized };
}

/**
 * Sized landings are walked floor. They join prep, foam, and — on a carpet-only
 * job — the carpet pad. They do not join a hard-surface job's carpet pad, and
 * the stair allowance is not prep area.
 */
export function landingJoinsQuestionCover(args: {
  key?: string | null;
  kind?: string | null;
  hardSurfaceFloor: boolean;
}): boolean {
  const key = args.key ?? "";
  const kind = args.kind ?? "";
  if (kind === "selflevel" || kind === "subfloor") return true;
  if (
    key === "hs_underlayment" ||
    key === "hs_prep" ||
    key === "selflevel_needed" ||
    key === "subfloor_needed" ||
    key === "moisture_mitigation" ||
    key === "vapor_barrier" ||
    key === "vinyl_skim"
  ) {
    return true;
  }
  if (key === "carpet_pad") return !args.hardSurfaceFloor;
  return false;
}

/**
 * Square feet shown on the area page. Rooms and sized landings are measured.
 * The hard-surface stair allowance is included and is not wasted again.
 * A zero stair allowance is stair treads, carpet stairs, or no steps — nothing invented.
 */
export function areaPageSquareFeet(args: {
  roomSqft: number;
  landingSqft: number;
  stairAllowanceSqft: number;
}): { rooms: number; landings: number; stairs: number; total: number } {
  const rooms = Math.round(Math.max(0, args.roomSqft) * 100) / 100;
  const landings = Math.round(Math.max(0, args.landingSqft) * 100) / 100;
  const stairs = Math.round(Math.max(0, args.stairAllowanceSqft) * 100) / 100;
  return {
    rooms,
    landings,
    stairs,
    total: Math.round((rooms + landings + stairs) * 100) / 100,
  };
}

export function landingReviewPhrase(takeoff: LandingTakeoff): string {
  if (takeoff.count <= 0 && takeoff.sqft <= 0) return "";
  const sized =
    takeoff.sqft > 0
      ? `${takeoff.sqft} sq ft included in the flooring total`
      : "size not entered — not added to the square footage";
  const count = takeoff.count > 0 ? `${takeoff.count} landing${takeoff.count === 1 ? "" : "s"}` : "Landings";
  const missing =
    takeoff.unsized > 0 && takeoff.sqft > 0
      ? ` · ${takeoff.unsized} still need a size`
      : "";
  return `${count} — ${sized}${missing}`;
}

export interface FloorTotalLine {
  description: string;
  category: string;
  unit: string;
  sqft: number | null;
  quantity: number | null;
  room: string | null;
}

function lineHostsFloorTotal(line: FloorTotalLine, label: string, category: string): boolean {
  if (line.category === "labor") return false;
  if (/wrap qty TBD|not an automatic sq ft\/step order/i.test(line.description)) return false;
  if (/stair allowance \d+(?:\.\d+)? sq ft unwasted/i.test(line.description)) return false;
  const unit = line.unit.trim().toLowerCase();
  if (unit && !/sq/.test(unit)) return false;
  if (!(Number(line.sqft) > 0)) return false;
  if (category && line.category !== category) return false;
  if (!label) return true;
  return (
    line.description === label ||
    line.description.startsWith(`${label} `) ||
    line.description.startsWith(`${label}(`)
  );
}

/**
 * Add landing square feet and the stair allowance onto the flooring line.
 * Landings take the line's waste. The stair allowance is stamped so it is
 * not wasted again. Returns the same lines when there is no host line.
 */
export function foldFloorAdditionsIntoLines<T extends FloorTotalLine>(
  lines: T[],
  args: {
    landingSqft: number;
    stairAllowanceSqft: number;
    productLabel: string | null;
    productCategory: string | null;
  },
): { lines: T[]; folded: boolean } {
  const landing = Math.round(Math.max(0, args.landingSqft) * 100) / 100;
  const stair = Math.round(Math.max(0, args.stairAllowanceSqft) * 100) / 100;
  if (landing <= 0 && stair <= 0) return { lines, folded: false };
  const label = (args.productLabel ?? "").trim();
  const category = (args.productCategory ?? "").trim();
  const bundled = lines.findIndex(
    (line) => !line.room && lineHostsFloorTotal(line, label, category),
  );
  const idx =
    bundled >= 0
      ? bundled
      : lines.findIndex((line) => lineHostsFloorTotal(line, label, category));
  if (idx < 0) return { lines, folded: false };
  const line = lines[idx];
  const add = landing + stair;
  const nextSqft = Math.round(((line.sqft ?? 0) + add) * 100) / 100;
  const qty = line.quantity;
  const yards = /sq\s*yd|sqyd/.test(line.unit);
  const nextQty =
    qty != null && qty > 0
      ? Math.round((qty + (yards ? add / 9 : add)) * 100) / 100
      : qty;
  let description = line.description;
  if (stair > 0 && !/stair allowance /i.test(description)) {
    description = `${description} (includes ${stair} sq ft of stairs — ${stairAllowanceStamp(stair)})`;
  }
  const next = lines.slice();
  next[idx] = { ...line, sqft: nextSqft, quantity: nextQty, description };
  return { lines: next, folded: true };
}

/** A white board is the riser only when the flooring is not already covering it. */
export function hsStairRiserWantsWhiteBoard(args: {
  cover: HsStairCover | null;
  coverRiser: boolean;
  riserFinish: HsStairRiserFinish | null;
}): boolean {
  if (args.riserFinish !== "white_board") return false;
  if (args.cover === "treads") return true;
  return args.cover === "material" && !args.coverRiser;
}

/**
 * Trim pieces for a chosen stair plan.
 * Null means the cover is still unchosen — the caller keeps the legacy
 * tread + riser + nose fill and does not add square feet.
 */
export function hardSurfaceStairPiecesForPlan(args: {
  cover: HsStairCover | null;
  coverRiser: boolean;
  riserFinish: HsStairRiserFinish | null;
}): string[] | null {
  if (!args.cover) return null;
  if (args.cover === "treads") {
    const labels = ["Stair tread", "Stair nose"];
    if (args.riserFinish === "white_board") labels.splice(1, 0, HS_STAIR_WHITE_BOARD_LABEL);
    return labels;
  }
  const labels = ["Stair nose"];
  if (hsStairRiserWantsWhiteBoard(args)) labels.unshift(HS_STAIR_WHITE_BOARD_LABEL);
  return labels;
}

export function hsStairReviewPhrase(args: {
  steps: number;
  cover: HsStairCover | null;
  coverRiser: boolean;
  riserFinish: HsStairRiserFinish | null;
}): string {
  const steps = Math.ceil(Number(args.steps));
  if (!(steps > 0)) return "";
  const stepWord = `${steps} step${steps === 1 ? "" : "s"}`;
  if (!args.cover) {
    return `${stepWord} (${args.coverRiser ? "tread + riser" : "tread only"})`;
  }
  if (args.cover === "treads") {
    const riser =
      args.riserFinish === "white_board"
        ? "white board on the riser"
        : args.riserFinish === "leave"
          ? "riser left as-is"
          : "riser not chosen";
    return `${stepWord} · stair treads · ${riser}`;
  }
  const order = hsStairMaterialOrder(args);
  const riser = args.coverRiser
    ? ""
    : args.riserFinish === "white_board"
      ? " · white board on the riser"
      : args.riserFinish === "leave"
        ? " · riser left as-is"
        : " · riser not chosen";
  return `${stepWord} · flooring on the stairs · ${order?.sqft ?? 0} sq ft (${order?.perStep ?? 0} sq ft × ${steps}, ${order?.label ?? "tread"}) included in the flooring total${riser}`;
}

export interface HsStairPlan {
  steps: number;
  cover: HsStairCover | null;
  coverRiser: boolean;
  riserFinish: HsStairRiserFinish | null;
}

/** The hard-surface stair answer, if the job has one. Carpet stairs are ignored. */
export function hsStairPlanFromAnswers(
  answers: Record<string, unknown> | unknown[] | null | undefined,
): HsStairPlan {
  const empty: HsStairPlan = { steps: 0, cover: null, coverRiser: true, riserFinish: null };
  if (!answers) return empty;
  const values = Array.isArray(answers) ? answers : Object.values(answers);
  for (const a of values) {
    if (!a || typeof a !== "object") continue;
    const ans = a as { kind?: string; steps?: unknown; treadRiser?: unknown };
    if (ans.kind !== "hs_stairs") continue;
    return {
      steps: positiveCount(typeof ans.steps === "string" ? ans.steps : ans.steps == null ? undefined : String(ans.steps)),
      cover: hsStairCoverOf(a),
      coverRiser: ans.treadRiser !== false,
      riserFinish: hsStairRiserFinishOf(a),
    };
  }
  return empty;
}

/**
 * Count line for a stair piece that Trims has not added yet.
 * Price stays empty. Square feet are never used.
 */
export function stairPieceQuoteWhenMissing(
  stepCount: number,
  rows: { type?: string | null }[],
  label: "Stair tread" | "White board",
): { description: "Stair tread" | "White board"; quantity: number; unit: "each" } | null {
  const steps = Math.ceil(Number(stepCount));
  if (!(steps > 0)) return null;
  const match = label === "White board" ? /white\s*board/i : /\btread\b/i;
  if (rows.some((r) => match.test(r.type || ""))) return null;
  return { description: label, quantity: steps, unit: "each" };
}

/** True when a trims answer already has a row matching `type` (e.g. stair nose). */
export function answersHaveTrimType(
  answers: Record<string, unknown> | unknown[] | null | undefined,
  match: RegExp,
): boolean {
  if (!answers) return false;
  const values = Array.isArray(answers) ? answers : Object.values(answers);
  for (const a of values) {
    if (!a || typeof a !== "object") continue;
    const ans = a as { kind?: string; rows?: { type?: string }[] };
    if (ans.kind !== "trims") continue;
    if ((ans.rows ?? []).some((r) => match.test(r.type ?? ""))) return true;
  }
  return false;
}

const SKIP_TRIM_PICK = /none|keep existing|field verify|tbd/i;

/** Chip label on Doorway transitions. Linear feet — the existing J-channel trim. */
export const HS_TRANSITION_JCHANNEL_LABEL = "J-channel";

export const HS_TRANSITION_OPTION_TO_TRIM: Record<string, string> = {
  "T-mold": "T-mold",
  Reducer: "Reducer",
  "End cap": "End cap",
  Threshold: "Threshold",
  Metal: "Metal transition",
  "Metal transition": "Metal transition",
  "J-channel": "J-channel",
  JChannel: "J-channel",
  "J channel": "J-channel",
};

function isJChannelLabel(label: string): boolean {
  return /j-?\s*channel/i.test(label);
}

/**
 * Doorway transitions always offer J-channel, just before Field verify.
 * A saved question that predates this chip still shows it.
 */
export function ensureJChannelTransitionOption<T extends { label: string }>(options: T[]): T[] {
  const existing = options.find((o) => isJChannelLabel(o.label));
  const rest = options.filter((o) => !isJChannelLabel(o.label));
  const row = existing ?? ({ label: HS_TRANSITION_JCHANNEL_LABEL } as T);
  const idx = rest.findIndex((o) => /field verify|\btbd\b/i.test(o.label));
  if (idx >= 0) return [...rest.slice(0, idx), row, ...rest.slice(idx)];
  return [...rest, row];
}

/** Unit clause for the pieces a transitions pick implies. J-channel is linear feet. */
export function transitionTrimUnitClause(labels: string[]): string {
  const hasEach = labels.some((label) => accessoryUnitForType(label) !== "lnft");
  const hasLinear = labels.some((label) => accessoryUnitForType(label) === "lnft");
  if (hasEach && hasLinear) {
    return "each for doorway pieces, linear feet for J-channel, never square feet";
  }
  if (hasLinear) return "linear feet, never square feet";
  return "each, never square feet";
}

/** Chip the salesperson looks for on a vinyl / LVP job. Linear feet. */
export const HS_BASE_VINYL_COVE_LABEL = "Vinyl cove base";

/**
 * Base / quarter round / shoe always offers vinyl cove base, just before
 * Field verify. A saved question that predates this chip still shows it.
 * Does not invent a price or a SKU.
 */
export function ensureVinylCoveBaseOption<T extends { label: string }>(options: T[]): T[] {
  if (options.some((o) => /vinyl\s*cove/i.test(o.label))) return options;
  const row = { label: HS_BASE_VINYL_COVE_LABEL } as T;
  const idx = options.findIndex((o) => /field verify|\btbd\b/i.test(o.label));
  if (idx >= 0) return [...options.slice(0, idx), row, ...options.slice(idx)];
  return [...options, row];
}

/** Option label → existing TRIM_TYPES label. Base/QR/shoe/cove are LN FT. */
export const HS_BASE_OPTION_TO_TRIM: Record<string, string> = {
  "Quarter round": "Quarter round",
  "Shoe molding": "Shoe molding",
  Baseboard: "Baseboard",
  "Vinyl cove base": "Vinyl cove base",
  "Cove base": "Vinyl cove base",
};

/** TRIM_TYPES labels implied by a notes-only pick list (skips None / TBD). */
export function trimLabelsFromPicks(selected: string[] | undefined, map: Record<string, string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of selected ?? []) {
    if (!s || SKIP_TRIM_PICK.test(s)) continue;
    const label = map[s];
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

export function applyTrimTypeSeed<T extends { type: string }>(
  rows: T[],
  labels: string[],
  addRow: (label: string) => T,
): T[] {
  if (!labels.length) return rows;
  let rs = [...rows];
  for (const label of labels) {
    if (rs.some((x) => trimTypeLabelsMatch(x.type, label))) continue;
    rs = [...rs, addRow(label)];
  }
  return rs;
}

function trimTypeLabelsMatch(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (left === right) return true;
  return /cove\s*base/.test(left) && /cove\s*base/.test(right);
}

/**
 * Stair nose line when the stair question has a step count and Trims has no
 * nose row yet. Quantity is the step count (each). Price stays empty.
 */
export function stairNoseQuoteWhenMissing(
  stepCount: number,
  rows: { type?: string | null }[],
): { description: "Stair nose"; quantity: number; unit: "each" } | null {
  const steps = Math.ceil(Number(stepCount));
  if (!(steps > 0)) return null;
  if (rows.some((r) => /stair\s*-?\s*nose|stairnose/i.test(r.type || ""))) return null;
  return { description: "Stair nose", quantity: steps, unit: "each" };
}

/** Review lines for picks and stair noses that are not already written out. */
export function quoteTrimReviewExtras(args: {
  pickedLabels: string[];
  reviewText: string;
  stairSteps: number;
}): string[] {
  const text = args.reviewText || "";
  const out: string[] = [];
  for (const label of args.pickedLabels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(escaped, "i").test(text)) continue;
    out.push(`${label}: quantity needed`);
  }
  const steps = Math.ceil(Number(args.stairSteps));
  if (steps > 0 && !/stair\s*-?\s*nose|stairnose/i.test(text) && !out.some((l) => /stair\s*-?\s*nose|stairnose/i.test(l))) {
    out.push(`Stair nose: ${steps} each`);
  }
  return out;
}

/** Rows already on the trim question, for the stair-nose gap check. */
export function trimRowsFromAnswers(
  answers: Record<string, unknown> | unknown[] | null | undefined,
): { type?: string }[] {
  if (!answers) return [];
  const values = Array.isArray(answers) ? answers : Object.values(answers);
  const rows: { type?: string }[] = [];
  for (const a of values) {
    if (!a || typeof a !== "object") continue;
    const ans = a as { kind?: string; rows?: { type?: string }[] };
    if (ans.kind !== "trims") continue;
    rows.push(...(ans.rows ?? []));
  }
  return rows;
}

export function presentTrimTypes(
  answers: Record<string, unknown> | unknown[] | null | undefined,
): string[] {
  if (!answers) return [];
  const values = Array.isArray(answers) ? answers : Object.values(answers);
  const types: string[] = [];
  for (const a of values) {
    if (!a || typeof a !== "object") continue;
    const ans = a as { kind?: string; rows?: { type?: string }[] };
    if (ans.kind !== "trims") continue;
    for (const r of ans.rows ?? []) {
      const t = (r.type ?? "").trim();
      if (t) types.push(t);
    }
  }
  return types;
}

/** Choice selections for a keyed question (questionnaire answers are id-keyed). */
export function keyedChoiceSelections(
  questions: { id: string; key?: string | null }[],
  answers: Record<string, unknown>,
  key: string,
): string[] {
  const q = questions.find((x) => x.key === key);
  if (!q) return [];
  return answerGateValues(answers[q.id]);
}

/**
 * Suffix a tear-out line with glued-vs-floating / pad-reuse notes.
 * Does not change the catalog demo rate — Floor King prices LVP demo the same
 * until a separate glued-demo item exists.
 */
export function annotateRemovalDescription(
  description: string,
  opts: { bond?: string[]; pad?: string[]; tack?: string[] },
): string {
  if (!/tear-?out|demo|removal/i.test(description)) return description;
  const bits: string[] = [];
  const isHsVinyl = /lvp|laminate|vinyl|sheet/i.test(description);
  const isCarpet = /carpet/i.test(description) || /old floor/i.test(description);
  if (isHsVinyl) {
    const bond = opts.bond ?? [];
    if (bond.some((l) => /floating/i.test(l))) bits.push("floating / click — not glued");
    else if (bond.some((l) => /glued down/i.test(l))) bits.push("glued down — not floating");
    else if (bond.some((l) => /unknown|field verify|tbd/i.test(l))) bits.push("bond field verify");
  }
  if (isCarpet) {
    const pad = opts.pad ?? [];
    if (pad.some((l) => /reuse/i.test(l))) bits.push("reuse existing pad (explicit)");
    else if (pad.some((l) => /remove/i.test(l))) bits.push("pad removed with carpet");
    else if (pad.some((l) => /no pad/i.test(l))) bits.push("no pad");
    const tack = opts.tack ?? [];
    if (tack.some((l) => /keep/i.test(l))) bits.push("keep existing tack strip (unusual)");
    else if (tack.some((l) => /remove/i.test(l))) bits.push("tack strip removed with carpet");
    else if (tack.some((l) => /no tack/i.test(l))) bits.push("no tack strip");
    else if (tack.some((l) => /unknown|field verify|tbd/i.test(l))) bits.push("tack strip field verify");
  }
  if (!bits.length) return description;
  return `${description} (${bits.join("; ")})`;
}

export const WORK_TYPE_NEW_CONSTRUCTION = "New construction";

export function labelsAreNewConstruction(labels: string[]): boolean {
  return labels.some((l) => /^new construction$/i.test(l.trim()));
}

export function jobIsNewConstruction(valByKey: Record<string, string[]>): boolean {
  return labelsAreNewConstruction(valByKey.work_type ?? []);
}

/**
 * Every work-type pick is New construction. Mixed Replacement + New
 * construction stays open — the replacement rooms still have furniture.
 * Unanswered stays open (0142).
 */
export function labelsAreNewConstructionOnly(labels: string[]): boolean {
  const cleaned = labels.map((l) => l.trim()).filter(Boolean);
  if (!cleaned.length) return false;
  return cleaned.every((l) => /^new construction$/i.test(l));
}

export function jobIsExclusiveNewConstruction(valByKey: Record<string, string[]>): boolean {
  return labelsAreNewConstructionOnly(valByKey.work_type ?? []);
}

/** Exclusive Wall — Floor / Both / Unknown / unanswered are not wall-only. */
export function labelsAreWallOnly(labels: string[]): boolean {
  const cleaned = labels.map((l) => l.trim()).filter(Boolean);
  if (!cleaned.length) return false;
  return cleaned.every((l) => /^wall$/i.test(l));
}

export function tileJobIsWallOnly(valByKey: Record<string, string[]>): boolean {
  return labelsAreWallOnly(valByKey.tile_application ?? []);
}

export function labelsAreVacant(labels: string[]): boolean {
  const cleaned = labels.map((l) => l.trim()).filter(Boolean);
  if (!cleaned.length) return false;
  return cleaned.every((l) => /^vacant$/i.test(l));
}

export function jobIsVacant(valByKey: Record<string, string[]>): boolean {
  return labelsAreVacant(valByKey.occupancy ?? []);
}

/** Exclusive Concrete — plywood / wood / existing / unknown / unanswered stay open. */
export function labelsAreConcreteOnly(labels: string[]): boolean {
  const cleaned = labels.map((l) => l.trim()).filter(Boolean);
  if (!cleaned.length) return false;
  return cleaned.every((l) => /^concrete(\s+slab)?$/i.test(l));
}

export function jobIsExclusiveConcreteSubstrate(valByKey: Record<string, string[]>): boolean {
  return labelsAreConcreteOnly(valByKey.substrate ?? valByKey.subfloor_type ?? []);
}

/**
 * Exclusive plywood / OSB / wood deck. Concrete, existing flooring, Other,
 * and Unknown / unanswered stay open (0142).
 */
export function labelsAreWoodDeckOnly(labels: string[]): boolean {
  const cleaned = labels.map((l) => l.trim()).filter(Boolean);
  if (!cleaned.length) return false;
  return cleaned.every((l) => /^(plywood(\s*\/\s*osb)?|osb|wood)$/i.test(l));
}

/**
 * Exclusive Existing flooring. Concrete, plywood, Other, and Unknown /
 * unanswered stay open (0142). Mixed existing + concrete stays open.
 */
export function labelsAreExistingFlooringOnly(labels: string[]): boolean {
  const cleaned = labels.map((l) => l.trim()).filter(Boolean);
  if (!cleaned.length) return false;
  return cleaned.every((l) => /^existing flooring$/i.test(l));
}
