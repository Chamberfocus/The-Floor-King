/**
 * Palmer Donavin / Happy Feet R3.5 price sheet, effective 9/4/2026.
 *
 * The Carton column is the price per square foot for a full carton. It is
 * not the carton total. Stock colors on the last page use that collection
 * price. A collection with no stock colors stays one product. Trim, adhesive,
 * and underlayment prices are the piece or package price.
 */
import type { PriceRow } from "@/lib/extract";

export interface PdTextItem {
  str: string;
  x: number;
  y: number;
}

export interface PdPriceBook {
  rows: PriceRow[];
  distributor: string;
  effective: string;
}

const DISTRIBUTOR = "Palmer Donavin";
const MANUFACTURER = "Happy Feet";
const EFFECTIVE = "9/4/2026";

const FLOOR_SECTIONS: Record<string, string> = {
  laminate: "laminate",
  "engineered hardwood": "hardwood",
  "pvc / glue down": "lvp",
  "pvc / loose lay - glue down": "lvp",
  "spc / rigid": "lvp",
  wpc: "lvp",
};

/** First stock-color part number of each collection, top to bottom, per column. */
const LEFT_STARTS: [string, string][] = [
  ["HF754V", "Quick Fit"],
  ["HF1302", "Quarry Tile"],
  ["HF1501", "Dynamic Fit"],
  ["HF500", "Gladiator"],
  ["HF637", "Titan"],
  ["HF1207M", "Pinnacle"],
  ["WD2010", "Turnberry"],
];

const RIGHT_STARTS: [string, string][] = [
  ["HF945", "Regency"],
  ["DL1107", "Broadway"],
  ["HF776A", "Built-Rite II"],
  ["HF570", "Maverick"],
  ["HF490", "Mustang"],
  ["HF560", "Bronco"],
  ["HF1004", "Rescue"],
  ["HF458A", "Stone Elegance II"],
  ["HF1664W", "Urban Design Clic"],
];

function money(token: string): number | null {
  const n = Number(token.replace(/[$,]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function rowsOf(items: PdTextItem[]): { y: number; items: PdTextItem[] }[] {
  const rows: { y: number; items: PdTextItem[] }[] = [];
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= 2);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  for (const row of rows) row.items.sort((a, b) => a.x - b.x);
  return rows;
}

function textOf(row: { items: PdTextItem[] }): string {
  return row.items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
}

function canon(name: string): string {
  return name
    .toLowerCase()
    .replace(/black label/g, "")
    .replace(/designs/g, "design")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function looksLike(pages: PdTextItem[][]): boolean {
  const blob = pages.flat().map((it) => it.str).join(" ");
  return /SqFt\/Ctn/.test(blob) && /R35 Effective Date/.test(blob) && /Carton/.test(blob);
}

interface FloorProduct {
  name: string;
  category: string;
  price: number;
  notes: string;
}

function parseFloor(page: PdTextItem[]): FloorProduct[] {
  const out: FloorProduct[] = [];
  let category = "";
  for (const row of rowsOf(page)) {
    const priceItem = row.items.find((it) => /^\$\d+\.\d{2}$/.test(it.str) && it.x > 500);
    const label = textOf(row);
    const section = FLOOR_SECTIONS[label.toLowerCase()];
    if (!priceItem) {
      if (section) category = section;
      continue;
    }
    if (!category) continue;
    const nameItem = row.items.find((it) => it.x < 140 && !it.str.startsWith("$"));
    const name = nameItem?.str.replace(/\s+/g, " ").trim() ?? "";
    if (!name || /^collection$/i.test(name)) continue;
    const price = money(priceItem.str);
    if (price == null) continue;
    const rest = row.items
      .filter((it) => it !== nameItem && it !== priceItem)
      .map((it) => it.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    out.push({ name, category, price, notes: rest });
  }
  return out;
}

interface StockColor {
  collection: string;
  color: string;
  sku: string;
}

function parseColors(page: PdTextItem[]): StockColor[] {
  const parts = page.filter((it) => /^(?:HF|WD|DL)[A-Z0-9]+$/.test(it.str));
  const colors: StockColor[] = [];
  for (const [side, starts] of [
    [parts.filter((it) => it.x < 360), LEFT_STARTS],
    [parts.filter((it) => it.x >= 360), RIGHT_STARTS],
  ] as const) {
    const ordered = [...side].sort((a, b) => b.y - a.y || a.x - b.x);
    const cuts: { y: number; collection: string }[] = [];
    let cursor = Infinity;
    for (const [sku, collection] of starts) {
      const hit = ordered.find((it) => it.str === sku && it.y < cursor - 0.5);
      if (!hit) continue;
      cuts.push({ y: hit.y, collection });
      cursor = hit.y;
    }
    for (const part of ordered) {
      const cut = cuts
        .filter((c) => c.y >= part.y - 0.6)
        .sort((a, b) => a.y - b.y)[0];
      if (!cut) continue;
      const color = page
        .filter(
          (it) =>
            Math.abs(it.y - part.y) <= 2 &&
            it.x < part.x - 8 &&
            it.x > (part.x < 360 ? 80 : 380) &&
            !/^(?:HF|WD|DL)/.test(it.str),
        )
        .sort((a, b) => b.x - a.x)[0];
      if (!color) continue;
      colors.push({ collection: cut.collection, color: color.str, sku: part.str });
    }
  }
  const seen = new Set<string>();
  return colors.filter((c) => {
    const key = `${c.sku}|${c.color.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseAccessories(page: PdTextItem[]): PriceRow[] {
  const out: PriceRow[] = [];
  let family = "";
  let kind: "trim" | "adhesive" | "underlayment" | "" = "";
  for (const row of rowsOf(page)) {
    const label = textOf(row);
    if (/^trims$/i.test(label)) {
      kind = "trim";
      continue;
    }
    if (/^laminate and vinyl$/i.test(label)) {
      family = "Laminate and Vinyl";
      kind = "trim";
      continue;
    }
    if (/^hardwood$/i.test(label)) {
      family = "Hardwood";
      kind = "trim";
      continue;
    }
    if (/^adhesives$/i.test(label)) {
      kind = "adhesive";
      family = "";
      continue;
    }
    if (/^underlayment$/i.test(label)) {
      kind = "underlayment";
      family = "";
      continue;
    }
    const priceItem = [...row.items].reverse().find((it) => /^\$\d+\.\d{2}$/.test(it.str));
    if (!priceItem || !kind) continue;
    const price = money(priceItem.str);
    if (price == null) continue;
    const nameItem = row.items.find((it) => it.x < 170);
    const name = nameItem?.str.replace(/\*+$/g, "").trim() ?? "";
    if (!name || /^sku$/i.test(name)) continue;
    const bits = row.items.filter((it) => it !== nameItem && it !== priceItem).map((it) => it.str);
    const itemNo = bits.find((bit) => /^(?:HF|WD)?\d[\w-]*$/.test(bit) || /^[A-Z]{2}\d/.test(bit)) ?? null;
    const detail = bits.filter((bit) => bit !== itemNo).join(" ").replace(/\s+/g, " ").trim();
    if (kind === "trim") {
      out.push({
        name: `${MANUFACTURER} ${family} ${name}`.replace(/\s+/g, " "),
        category: "trim",
        unit: "each",
        sku: null,
        material_rate: price,
        roll_rate: null,
        labor_rate: null,
        manufacturer: MANUFACTURER,
        style: name,
        color: null,
        notes: [family, detail, `R35 effective ${EFFECTIVE}`].filter(Boolean).join(" · "),
      });
      continue;
    }
    const size = bits.find((bit) => /gallon|can|sf|x/i.test(bit)) ?? detail;
    out.push({
      name: `${MANUFACTURER} ${name}${size ? ` ${size}` : ""}`.replace(/\s+/g, " "),
      category: kind === "underlayment" ? "underlayment" : "other",
      unit: "each",
      sku: itemNo,
      material_rate: price,
      roll_rate: null,
      labor_rate: null,
      manufacturer: MANUFACTURER,
      style: name,
      color: null,
      notes: [detail, `R35 effective ${EFFECTIVE}`].filter(Boolean).join(" · "),
    });
  }
  return out;
}

export function parsePdHappyFeetPriceList(pages: PdTextItem[][]): PdPriceBook | null {
  if (!looksLike(pages)) return null;
  const floors: FloorProduct[] = [];
  const colors: StockColor[] = [];
  const rows: PriceRow[] = [];
  for (const page of pages) {
    const blob = page.map((it) => it.str).join(" ");
    if (/SqFt\/Ctn/.test(blob) && /Carton/.test(blob)) floors.push(...parseFloor(page));
    else if (/Happy Feet Part#/.test(blob)) colors.push(...parseColors(page));
    else if (/Adhesives/.test(blob) || /Underlayment/.test(blob)) rows.push(...parseAccessories(page));
  }
  const byCollection = new Map<string, FloorProduct>();
  for (const floor of floors) byCollection.set(canon(floor.name), floor);
  const used = new Set<string>();
  for (const color of colors) {
    const floor = byCollection.get(canon(color.collection));
    if (!floor) continue;
    used.add(canon(floor.name));
    rows.push({
      name: `${MANUFACTURER} ${color.collection} ${color.color}`,
      category: floor.category,
      unit: "sqft",
      sku: color.sku,
      material_rate: floor.price,
      roll_rate: null,
      labor_rate: null,
      manufacturer: MANUFACTURER,
      style: color.collection,
      color: color.color,
      notes: [floor.notes, "Carton price per sq ft", `R35 effective ${EFFECTIVE}`]
        .filter(Boolean)
        .join(" · "),
    });
  }
  for (const floor of floors) {
    if (used.has(canon(floor.name))) continue;
    rows.push({
      name: `${MANUFACTURER} ${floor.name}`,
      category: floor.category,
      unit: "sqft",
      sku: null,
      material_rate: floor.price,
      roll_rate: null,
      labor_rate: null,
      manufacturer: MANUFACTURER,
      style: floor.name,
      color: null,
      notes: [floor.notes, "Carton price per sq ft", `R35 effective ${EFFECTIVE}`]
        .filter(Boolean)
        .join(" · "),
    });
  }
  if (!rows.length) return null;
  return { rows, distributor: DISTRIBUTOR, effective: EFFECTIVE };
}
