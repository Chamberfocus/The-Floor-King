import {
  isRollGoodCategory,
  isHardSurfaceCategory,
  type EstimateLineItem,
} from "@/lib/types";
import { lineQty, type CalcLine } from "@/lib/estimate-calc";

// Carpet padding is bought by the roll; the shop's standard roll covers this
// many square yards (matches the estimate builder's roll math).
export const PAD_ROLL_SQYD = 30;

/** Total inches → a tidy feet-and-inches label, e.g. 186 → 15' 6". */
export function ftIn(totalIn: number | null | undefined): string {
  const t = Number(totalIn) || 0;
  if (t <= 0) return "";
  const ft = Math.floor(t / 12);
  const inch = Math.round(t % 12);
  return inch ? `${ft}' ${inch}"` : `${ft}'`;
}

/**
 * Strip a room baked onto a line description so the same product across rooms
 * reads (and groups) as ONE item. The questionnaire writes prep/addon lines as
 * "<desc> — <room>" (see questionnaire.tsx), so a subfloor used in the kitchen
 * and the bedroom would otherwise look like two different products on a
 * collective (product-summary) list. Only an exact trailing room token after a
 * separator (— – · -) is removed; if that would empty the name, the original is
 * kept. Product names that don't end in the room are untouched.
 */
export function stripRoomFromName(
  name: string,
  room: string | null | undefined,
): string {
  const r = (room ?? "").trim();
  if (!r) return name;
  const esc = r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = name.replace(new RegExp(`\\s*[—–·-]\\s*${esc}\\s*$`, "i"), "").trim();
  return stripped || name;
}

/** What the crew needs per line: order quantity, cut size, pad rolls, fill flag. */
export function lineSpec(l: {
  quantity: number | null;
  unit: string | null;
  measure_unit: string | null;
  sqft: number | null;
  length_in: number | null;
  width_in: number | null;
  category: string | null;
  is_fill?: boolean | null;
}): { qty: string; qtyNum: number; unit: string; cut: string; rolls: number; isFill: boolean } {
  // Use the SAME billed quantity as the estimate and invoice (measured area for
  // area lines, count for count lines) — never the raw stored quantity, which
  // could be waste-baked or off by rounding and made the work order disagree.
  const q = lineQty(l as unknown as CalcLine);
  const unit = l.unit || (l.measure_unit === "sqyd" ? "sq yd" : "sq ft");
  const qty = q > 0 ? `${Math.round(q * 100) / 100} ${unit}` : l.sqft ? `${l.sqft} sq ft` : "";
  // Cuts only apply to roll goods (carpet / sheet vinyl). Hard surface is sold
  // by the square foot in cartons and never has a cut size.
  const isRoll = isRollGoodCategory(l.category);
  const cut =
    isRoll && l.length_in && l.width_in
      ? `${ftIn(l.width_in)} × ${ftIn(l.length_in)}`
      : "";
  const sqyd = q > 0 ? (unit.toLowerCase().includes("yd") ? q : q / 9) : 0;
  const rolls = l.category === "underlayment" && sqyd > 0 ? Math.ceil(sqyd / PAD_ROLL_SQYD) : 0;
  return { qty, qtyNum: q, unit, cut, rolls, isFill: isRoll && !!l.is_fill };
}

/**
 * A single carpet/sheet-vinyl piece to cut off the roll — the shared "cut list"
 * model behind the staging sheet, work order, and purchase order so all three
 * show the SAME cuts (each piece, its size, and whether it's a fill piece).
 */
export interface CarpetCut {
  room: string; // area it belongs under ("Unassigned" if none)
  name: string; // product / description label
  size: string; // "W' × L'" (empty if not both dimensions)
  isFill: boolean; // extra fill/seam piece for the area
  sqyd: number; // square yards this piece consumes off the roll
}
/** One roll's worth of cuts, grouped by product + broadloom width. */
export interface CarpetRoll {
  name: string;
  width: number | null; // broadloom width (ft), null if unknown
  totalSqyd: number;
  linft: number | null; // total sqft ÷ width (null when width unknown)
  count: number; // number of cuts (incl. fill pieces)
}
/** The minimal per-line shape the cut list needs — snake_case so estimate line
 *  items and PO items feed it directly; adapt camelCase sources at the call site. */
export interface CutSource {
  room: string | null;
  description: string | null;
  category: string | null;
  length_in: number | null;
  width_in: number | null;
  /** The line's area — a safety net so a carpet line with yardage but no cut
   *  dimensions still yields a cut (derived from sq ft ÷ roll width). */
  sqft?: number | null;
  is_fill?: boolean | null;
  roll_width_ft?: number | null;
  manufacturer?: string | null;
  color?: string | null;
  /** First-class measured pieces — each "add" piece is a cut. When present these
   *  win over the single length_in/width_in (which is just the primary cut). */
  measurements?: {
    label?: string | null;
    length_in: number;
    width_in: number;
    op?: string | null;
  }[] | null;
}

/**
 * Cut sizes that the legacy carpet flow stored ONLY in the line DESCRIPTION text
 * (e.g. "Mohawk Renovate II — cuts: 25'6\"×15'") rather than in length_in/
 * width_in. Parses each `L'I"×W'` into inches so the cut list can read a line's
 * cuts whether they're structured or still in the text — it reads the line's own
 * data, not a separate copy. Width falls back to the line's roll width.
 */
export function parseCutsFromText(
  desc: string | null | undefined,
  rollWidthFt?: number | null,
): { lengthIn: number; widthIn: number }[] {
  const out: { lengthIn: number; widthIn: number }[] = [];
  const rollWidIn = Number(rollWidthFt) > 0 ? Number(rollWidthFt) * 12 : 0;
  const re = /(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*")?\s*[×xX]\s*(\d+(?:\.\d+)?)\s*'?/g;
  const s = desc ?? "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const lengthIn = Math.round((parseFloat(m[1]) * 12 + (m[2] ? parseFloat(m[2]) : 0)) * 100) / 100;
    const widthIn = m[3] ? parseFloat(m[3]) * 12 : rollWidIn;
    if (lengthIn > 0 && widthIn > 0) out.push({ lengthIn, widthIn });
  }
  return out;
}

/**
 * Build the carpet cut list from any line source: every roll-good piece with a
 * measured W×L, grouped for display and summed per roll. Each cut is read from
 * the line's OWN data — structured length_in/width_in when present, else the size
 * text the legacy flow left in the description (parseCutsFromText). Fill pieces
 * are kept (flagged) and still count toward yardage. Non-carpet or dimensionless
 * lines are ignored.
 */
export function carpetCutList(items: CutSource[]): {
  cuts: CarpetCut[];
  rolls: CarpetRoll[];
  totalSqyd: number;
  hasFill: boolean;
} {
  const cuts: CarpetCut[] = [];
  const rollMap = new Map<string, CarpetRoll>();
  for (const l of items) {
    if (!isRollGoodCategory(l.category)) continue;
    // Prefer the first-class measured pieces — each "add" piece is its own cut
    // (with its own room label). Fall back to the single cut, then to any cut
    // sizes the legacy flow left in the description text.
    const measured = (l.measurements ?? [])
      .filter((m) => m.op !== "subtract" && Number(m.length_in) > 0 && Number(m.width_in) > 0)
      .map((m) => ({
        lengthIn: Number(m.length_in),
        widthIn: Number(m.width_in),
        room: (m.label && m.label.trim()) || null,
      }));
    const len = Number(l.length_in) || 0;
    const wid = Number(l.width_in) || 0;
    let lineCuts = measured.length
      ? measured
      : (len > 0 && wid > 0
          ? [{ lengthIn: len, widthIn: wid, room: null as string | null }]
          : parseCutsFromText(l.description, l.roll_width_ft).map((c) => ({
              ...c,
              room: null as string | null,
            })));
    // SAFETY NET: a carpet line with real yardage but no cut dimensions must
    // NEVER vanish from the cut sheet. Derive one cut from the area at the roll
    // width (default 12'), labelled with its room, so the warehouse still gets it.
    if (!lineCuts.length) {
      const sf = Number(l.sqft) || 0;
      if (sf > 0) {
        const rollFt = Number(l.roll_width_ft) > 0 ? Number(l.roll_width_ft) : 12;
        const widthIn = rollFt * 12;
        const lengthIn = Math.round((sf / rollFt) * 12 * 100) / 100;
        lineCuts = [{ lengthIn, widthIn, room: (l.room && l.room.trim()) || null }];
      }
    }
    if (!lineCuts.length) continue;
    // Product name without the "— cuts: …" text the legacy flow appended.
    const baseName = (l.description ?? "").replace(/\s*[—–-]?\s*cuts?:.*$/i, "").trim();
    const name =
      baseName ||
      [l.manufacturer, l.color].filter(Boolean).join(" · ") ||
      "Carpet";
    for (const cut of lineCuts) {
      const sqft = (cut.lengthIn / 12) * (cut.widthIn / 12);
      const sqyd = Math.round((sqft / 9) * 100) / 100;
      cuts.push({
        room: cut.room || (l.room && l.room.trim()) || "Unassigned",
        name,
        size: `${ftIn(cut.widthIn)} × ${ftIn(cut.lengthIn)}`,
        isFill: !!l.is_fill,
        sqyd,
      });
      const width =
        Number(l.roll_width_ft) > 0
          ? Number(l.roll_width_ft)
          : Math.round((cut.widthIn / 12) * 100) / 100;
      const key = `${name}|${width ?? ""}`;
      const r = rollMap.get(key) ?? { name, width, totalSqyd: 0, linft: null, count: 0 };
      r.totalSqyd = Math.round((r.totalSqyd + sqyd) * 100) / 100;
      r.count += 1;
      rollMap.set(key, r);
    }
  }
  const rolls = [...rollMap.values()].map((r) => ({
    ...r,
    linft: r.width ? Math.round(((r.totalSqyd * 9) / r.width) * 10) / 10 : null,
  }));
  const totalSqyd = Math.round(cuts.reduce((s, c) => s + c.sqyd, 0) * 100) / 100;
  return { cuts, rolls, totalSqyd, hasFill: cuts.some((c) => c.isFill) };
}

/** Whether a job is roll goods (carpet + sheet vinyl), hard surface, or both —
 *  from its line items. Sheet vinyl is a ROLL GOOD (sold by the sq yd, cut to
 *  size), NOT hard surface — the single source of truth is isRollGoodCategory /
 *  isHardSurfaceCategory in types.ts. */
export type MaterialType = "carpet" | "hard" | "both" | null;
export const MATERIAL_TYPE_LABEL: Record<"carpet" | "hard" | "both", string> = {
  carpet: "Carpet / sheet vinyl",
  hard: "Hard surface",
  both: "Roll goods & hard surface",
};

export function jobMaterialType(lineItems: { category: string | null }[]): MaterialType {
  let roll = false;
  let hard = false;
  for (const l of lineItems) {
    if (isRollGoodCategory(l.category)) roll = true;
    else if (isHardSurfaceCategory(l.category)) hard = true;
  }
  if (roll && hard) return "both";
  if (roll) return "carpet";
  if (hard) return "hard";
  return null;
}

/** Installer material skills, stored on the install crew. */
export type InstallerSkill = "carpet" | "hard";

/**
 * Whether an installer with these skills should be offered a job of this
 * material type on the Job Board.
 *
 * - No skills set → does everything (safe rollout: the filter only kicks in once
 *   an installer's skills are configured, so nobody's board goes empty).
 * - Unknown material → shown (never hide a job we can't classify).
 * - A mixed carpet + hard-surface job needs BOTH skills — one installer doing the
 *   whole job. (Targeting a specialist to their part is still done explicitly.)
 */
export function installerCanDoJob(
  skills: string[] | null | undefined,
  jobType: MaterialType,
): boolean {
  const s = skills ?? [];
  if (s.length === 0) return true;
  if (jobType === null) return true;
  const carpet = s.includes("carpet");
  const hard = s.includes("hard");
  if (jobType === "carpet") return carpet;
  if (jobType === "hard") return hard;
  if (jobType === "both") return carpet && hard;
  return true;
}

const isLabor = (l: EstimateLineItem) => l.category === "labor";
/** Money-only flat lines (discounts, fees) don't belong on a work order. */
const isMoneyFlat = (l: EstimateLineItem) => l.line_type === "flat" && l.category !== "labor";

// Categories that are physical MATERIAL (staged by the warehouse). Everything
// else — labor, and services in the "other" catch-all (tear-out, appliance
// move, haul-away) — is work, not material.
const MATERIAL_CATEGORIES = new Set([
  "carpet",
  "lvp",
  "hardwood",
  "laminate",
  "tile",
  "vinyl",
  "underlayment",
  "trim",
]);

/**
 * Is this line a physical material (vs. labor / a service)? The ONE rule shared
 * by the staging sheet (what to pull/order) and the work order (material vs
 * labor grouping) so they can't disagree. A definite material category is
 * always material; a bare "other" line with no product identity is a service.
 */
export function isMaterialLine(l: {
  category?: string | null;
  line_type?: string | null;
  product_id?: string | null;
  manufacturer?: string | null;
  color?: string | null;
  sqft_per_box?: number | null;
  roll_width_ft?: number | null;
}): boolean {
  if (l.line_type === "flat") return false;
  const cat = (l.category ?? "").toLowerCase();
  if (cat === "labor") return false;
  if (MATERIAL_CATEGORIES.has(cat)) return true;
  return !!(
    l.product_id ||
    (l.manufacturer && l.manufacturer.trim()) ||
    (l.color && l.color.trim()) ||
    l.sqft_per_box ||
    l.roll_width_ft
  );
}

export interface ScopeRoom {
  name: string;
  products: EstimateLineItem[];
  labor: EstimateLineItem[];
  prep: string[]; // per-room conditions carried on the job notes
  sqft: number | null;
}

export interface JobScope {
  /** Rooms with a name — flooring/prep scoped to that area, first-seen order. */
  rooms: ScopeRoom[];
  /** Bundled/whole-job lines (pad, trim, install labor, demo, haul-away…). */
  wholeJob: { products: EstimateLineItem[]; labor: EstimateLineItem[] };
  /** Job-wide conditions (subfloor, moisture…) that apply to all areas. */
  conditions: string[];
  /** Free-text notes that aren't structured conditions. */
  freeText: string;
}

/**
 * Pull the structured "Job conditions" and "Per-room prep" blocks out of the job
 * notes (written by the estimate questionnaire) so each can be shown where it
 * belongs — job-wide vs under a specific room. Anything else stays free text.
 */
export function parseNotes(notes: string | null | undefined): {
  conditions: string[];
  roomPrep: Map<string, string[]>;
  freeText: string;
} {
  const conditions: string[] = [];
  const roomPrep = new Map<string, string[]>();
  const freeBlocks: string[] = [];
  const text = (notes ?? "").replace(/\r\n/g, "\n");
  if (!text.trim()) return { conditions, roomPrep, freeText: "" };

  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n");
    const head = (lines[0] ?? "").trim().toLowerCase();
    if (head === "job conditions:") {
      for (const ln of lines.slice(1)) {
        const m = ln.replace(/^[•\-*]\s*/, "").trim();
        if (m) conditions.push(m);
      }
    } else if (head === "per-room prep:") {
      for (const ln of lines.slice(1)) {
        const m = ln.replace(/^[•\-*]\s*/, "").trim();
        const idx = m.indexOf(" — ");
        if (idx <= 0) continue;
        const room = m.slice(0, idx).trim();
        const rest = m.slice(idx + 3).trim();
        const arr = roomPrep.get(room) ?? [];
        for (const part of rest.split(";")) {
          const p = part.trim();
          if (p) arr.push(p);
        }
        roomPrep.set(room, arr);
      }
    } else if (block.trim()) {
      freeBlocks.push(block.trim());
    }
  }
  return { conditions, roomPrep, freeText: freeBlocks.join("\n\n").trim() };
}

/** One presentation of the job's scope, grouped by room — the single source
 *  both the installer work order and the on-screen scope render from. */
export function buildJobScope(
  lineItems: EstimateLineItem[],
  notes: string | null | undefined,
): JobScope {
  const { conditions, roomPrep, freeText } = parseNotes(notes);
  const order: string[] = [];
  const byRoom = new Map<string, ScopeRoom>();
  const wholeJob = { products: [] as EstimateLineItem[], labor: [] as EstimateLineItem[] };

  const ensure = (name: string): ScopeRoom => {
    let r = byRoom.get(name);
    if (!r) {
      r = { name, products: [], labor: [], prep: [], sqft: null };
      byRoom.set(name, r);
      order.push(name);
    }
    return r;
  };

  for (const l of lineItems) {
    if (isMoneyFlat(l)) continue;
    // Materials go under products; labor AND services (tear-out, appliance move,
    // haul-away — the "other" catch-all) go under labor, matching the staging
    // sheet's material/labor split so the two documents agree.
    const material = isMaterialLine(l);
    const room = (l.room ?? "").trim();
    if (!room) {
      (material ? wholeJob.products : wholeJob.labor).push(l);
      continue;
    }
    const r = ensure(room);
    if (!material) r.labor.push(l);
    else {
      r.products.push(l);
      const sf = Number(l.sqft) || 0;
      if (sf > 0) r.sqft = (r.sqft ?? 0) + sf;
    }
  }

  for (const [room, prep] of roomPrep) ensure(room).prep.push(...prep);

  return { rooms: order.map((n) => byRoom.get(n) as ScopeRoom), wholeJob, conditions, freeText };
}
