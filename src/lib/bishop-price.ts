/**
 * Bishop Distributing price list summary for The Floor King (account 030835).
 *
 * The sheet is one row per product: a code, a description, the mill, one
 * price, and a unit. Sheet vinyl also prints a cut price. That cut is the
 * catalog cost, and the lower price is the full roll. Every other row has
 * one price, and that price is the cost. No color is invented.
 */
import type { PriceRow } from "@/lib/extract";

export interface BishopTextItem {
  str: string;
  x: number;
  y: number;
}

export interface BishopPriceBook {
  rows: PriceRow[];
  distributor: string;
  effective: string;
}

const DISTRIBUTOR = "Bishop Distributing Co";
const EFFECTIVE = "11/20/2026";

/** Column centers on the Bishop summary, in PDF points. */
const COLUMNS: [string, number][] = [
  ["sku", 57],
  ["name", 110],
  ["euc", 178],
  ["mfrCode", 265],
  ["mfr", 305],
  ["date", 360],
  ["price", 456],
  ["cut", 532],
  ["uom", 565],
];

/** How far a wrapped description can sit from its price before it belongs to the next row. */
const MAX_WRAP = 16;

function columnOf(x: number): string | null {
  let best: string | null = null;
  let dist = 28;
  for (const [name, center] of COLUMNS) {
    const d = Math.abs(x - center);
    if (d < dist) {
      dist = d;
      best = name;
    }
  }
  return best;
}

function money(token: string | undefined): number | null {
  if (!token) return null;
  const n = Number(token);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function titleCase(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/(^|[^a-z0-9])([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

function manufacturerName(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim().toUpperCase();
  if (s.includes("HOMECREST")) return "Homecrest";
  if (s.includes("MERCIER")) return "Mercier Wood Flooring";
  if (s.includes("JOHNSON")) return "Johnson Hardwood";
  if (s.includes("FLEXCO")) return "Flexco";
  if (s.includes("MATREXX")) return "Matrexx";
  if (s.includes("CONGOLEUM")) return "Congoleum";
  if (s.includes("KAHRS")) return "Kahrs";
  if (s.includes("PRECISION")) return "Precision Flooring Products";
  return titleCase(raw);
}

function categoryFor(euc: string): string {
  if (euc === "LF") return "laminate";
  if (euc === "LV" || euc === "LW") return "lvp";
  if (euc === "SV") return "vinyl";
  if (euc === "VT") return "trim";
  if (euc === "WD") return "hardwood";
  return "other";
}

function unitFor(uom: string): string {
  if (uom === "SF") return "sqft";
  if (uom === "SY") return "sqyd";
  if (uom === "CT") return "box";
  return "each";
}

function looksLikeBook(pages: BishopTextItem[][]): boolean {
  const blob = pages
    .flat()
    .map((it) => it.str)
    .join(" ")
    .toUpperCase();
  return blob.includes("PRICE LIST SUMMARY") && blob.includes("BISHOP");
}

/**
 * Read one Bishop summary. Pages are separate because each page restarts its
 * vertical position. Returns null when the text is some other price list.
 */
export function parseBishopPriceList(pages: BishopTextItem[][]): BishopPriceBook | null {
  if (!looksLikeBook(pages)) return null;
  const draft: PriceRow[] = [];

  for (const page of pages) {
    const items = page.filter((it) => it.str && it.str.trim());
    const anchors = items.filter((it) => {
      if (columnOf(it.x) !== "price" || !/^\d+\.\d{3}$/.test(it.str)) return false;
      return items.some(
        (sku) =>
          Math.abs(sku.y - it.y) < 1.2 &&
          columnOf(sku.x) === "sku" &&
          /[A-Za-z]/.test(sku.str),
      );
    });

    const anchorYs = anchors.map((it) => it.y);
    const wrapLimit = (anchorY: number) => {
      let gap = Infinity;
      for (const other of anchorYs) {
        const d = Math.abs(other - anchorY);
        if (d > 0.8 && d < gap) gap = d;
      }
      return Math.min(MAX_WRAP, gap / 2 - 0.4);
    };
    const belongs = (y: number, anchorY: number) => Math.abs(y - anchorY) <= wrapLimit(anchorY);

    for (const anchor of anchors) {
      const near = (col: string) =>
        items
          .filter((it) => columnOf(it.x) === col && belongs(it.y, anchor.y))
          .sort((a, b) => b.y - a.y || a.x - b.x);
      const onRow = (col: string) =>
        items.find((it) => columnOf(it.x) === col && Math.abs(it.y - anchor.y) < 1.2);

      const sku = onRow("sku")?.str.trim() ?? "";
      const nameBits = near("name").map((it) => it.str.trim()).filter(Boolean);
      const name = titleCase(nameBits.join(" "));
      if (!sku || !name) continue;

      const price1 = money(onRow("price")?.str);
      const cut = money(onRow("cut")?.str);
      const uom = (onRow("uom")?.str ?? "").toUpperCase();
      const euc = (onRow("euc")?.str ?? "").toUpperCase();
      const unit = unitFor(uom);
      // Sheet vinyl is a roll good: the cut is what we pay for a piece, and
      // Price 1 is the full roll when the sheet prints both.
      const rollGood = unit === "sqyd" && cut != null;
      const material = rollGood ? cut : price1;
      const roll = rollGood && price1 != null && price1 !== cut ? price1 : null;
      if (material == null) continue;

      const mill = manufacturerName(near("mfr").map((it) => it.str).join(" "));
      const priceNote =
        roll != null
          ? `Roll $${roll.toFixed(2)}. Cut $${material.toFixed(2)}.`
          : `Price $${material.toFixed(2)}.`;
      const carton = unit === "box" ? " Priced per carton." : "";

      draft.push({
        name,
        category: categoryFor(euc),
        unit,
        sku,
        material_rate: material,
        roll_rate: roll,
        labor_rate: null,
        manufacturer: mill || null,
        style: titleCase(nameBits[0] ?? name),
        color: null,
        notes: `SKU ${sku}. Bishop price list effective ${EFFECTIVE}.${carton} ${priceNote}`.replace(
          /\s+/g,
          " ",
        ),
      });
    }
  }

  if (draft.length < 5) return null;

  const counts = new Map<string, number>();
  for (const row of draft) {
    const key = row.name.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rows = draft.map((row) =>
    (counts.get(row.name.toLowerCase()) ?? 0) > 1 ? { ...row, name: `${row.name} (${row.sku})` } : row,
  );
  return { rows, distributor: DISTRIBUTOR, effective: EFFECTIVE };
}
