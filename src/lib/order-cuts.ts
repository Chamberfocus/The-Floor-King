import type { OrderCutRow } from "@/lib/types";

/**
 * A customer's measurements, read the same way everywhere.
 *
 * The order form has always collected cuts properly — a width and a length —
 * and then joined them into one string, which every screen re-split by hand.
 * The warehouse is cutting from these numbers, so they are read from ONE place
 * and rendered as a list, not as a sentence.
 */

export interface CutLine {
  /** "12' × 14'6"" */
  label: string;
  /** Square yards this cut consumes, or null when it can't be known. */
  sqyd: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Length in feet, folding the inches in. */
function lengthFt(c: OrderCutRow): number {
  return (Number(c.length_ft) || 0) + (Number(c.length_in) || 0) / 12;
}

export function cutLabel(c: OrderCutRow): string {
  const ft = Number(c.length_ft) || 0;
  const inch = Number(c.length_in) || 0;
  const len = `${ft}'${inch ? `${inch}"` : ""}`;
  return `${Number(c.width_ft) || 0}' × ${len}`;
}

/** Broadloom is bought by the square yard: width × length ÷ 9. */
export function cutSqYd(c: OrderCutRow): number {
  return round2(((Number(c.width_ft) || 0) * lengthFt(c)) / 9);
}

/**
 * Every cut on a line, as its own entry.
 *
 * Falls back to the old pipe-joined `cut_notes` for orders submitted before
 * the cuts column existed — those have no numbers to total, so they render as
 * labels only rather than pretending to a precision they don't have.
 */
export function cutLines(item: {
  cuts?: OrderCutRow[] | null;
  cut_notes?: string | null;
}): CutLine[] {
  const structured = item.cuts;
  if (Array.isArray(structured) && structured.length) {
    return structured.map((c) => ({ label: cutLabel(c), sqyd: cutSqYd(c) }));
  }
  return (item.cut_notes ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({ label, sqyd: null }));
}

/** Total square yards across the cuts, or null if they aren't measurable. */
export function cutsTotalSqYd(item: {
  cuts?: OrderCutRow[] | null;
  cut_notes?: string | null;
}): number | null {
  const lines = cutLines(item);
  if (!lines.length || lines.some((l) => l.sqyd == null)) return null;
  return round2(lines.reduce((s, l) => s + (l.sqyd ?? 0), 0));
}
