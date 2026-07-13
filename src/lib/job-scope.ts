import { isRollGoodCategory, type EstimateLineItem } from "@/lib/types";

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

/** What the crew needs per line: order quantity, cut size, and pad rolls. */
export function lineSpec(l: {
  quantity: number | null;
  unit: string | null;
  measure_unit: string | null;
  sqft: number | null;
  length_in: number | null;
  width_in: number | null;
  category: string | null;
}): { qty: string; cut: string; rolls: number } {
  const q = Number(l.quantity) || 0;
  const unit = l.unit || (l.measure_unit === "sqyd" ? "sq yd" : "sq ft");
  const qty = q > 0 ? `${Math.round(q * 100) / 100} ${unit}` : l.sqft ? `${l.sqft} sq ft` : "";
  // Cuts only apply to roll goods (carpet / sheet vinyl). Hard surface is sold
  // by the square foot in cartons and never has a cut size.
  const cut =
    isRollGoodCategory(l.category) && l.length_in && l.width_in
      ? `${ftIn(l.width_in)} × ${ftIn(l.length_in)}`
      : "";
  const sqyd = q > 0 ? (unit.toLowerCase().includes("yd") ? q : q / 9) : 0;
  const rolls = l.category === "underlayment" && sqyd > 0 ? Math.ceil(sqyd / PAD_ROLL_SQYD) : 0;
  return { qty, cut, rolls };
}

/** Whether a job is carpet, hard surface, or both — from its line items. */
export type MaterialType = "carpet" | "hard" | "both" | null;
const HARD_CATS = new Set(["lvp", "hardwood", "laminate", "tile", "vinyl"]);
export const MATERIAL_TYPE_LABEL: Record<"carpet" | "hard" | "both", string> = {
  carpet: "Carpet",
  hard: "Hard surface",
  both: "Carpet & hard surface",
};

export function jobMaterialType(lineItems: { category: string | null }[]): MaterialType {
  let carpet = false;
  let hard = false;
  for (const l of lineItems) {
    const c = (l.category || "").toLowerCase();
    if (c === "carpet") carpet = true;
    else if (HARD_CATS.has(c)) hard = true;
  }
  if (carpet && hard) return "both";
  if (carpet) return "carpet";
  if (hard) return "hard";
  return null;
}

const isLabor = (l: EstimateLineItem) => l.category === "labor";
/** Money-only flat lines (discounts, fees) don't belong on a work order. */
const isMoneyFlat = (l: EstimateLineItem) => l.line_type === "flat" && l.category !== "labor";

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
    const room = (l.room ?? "").trim();
    if (!room) {
      (isLabor(l) ? wholeJob.labor : wholeJob.products).push(l);
      continue;
    }
    const r = ensure(room);
    if (isLabor(l)) r.labor.push(l);
    else {
      r.products.push(l);
      const sf = Number(l.sqft) || 0;
      if (sf > 0) r.sqft = (r.sqft ?? 0) + sf;
    }
  }

  for (const [room, prep] of roomPrep) ensure(room).prep.push(...prep);

  return { rooms: order.map((n) => byRoom.get(n) as ScopeRoom), wholeJob, conditions, freeText };
}
