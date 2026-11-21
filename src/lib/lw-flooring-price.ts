/**
 * LW Flooring AM price list, effective 11/2/2026.
 *
 * Flooring tables price each color per square foot. Moldings, stair
 * treads, risers, adhesives, and the underlayment roll are priced by
 * the piece. Coming soon rows still print a price, so they are kept.
 * The stair add-on amounts stay in the notes.
 */
import type { PriceRow } from "@/lib/extract";

export interface LwTextItem {
  str: string;
  x: number;
  y: number;
}

export interface LwPriceBook {
  rows: PriceRow[];
  distributor: string;
  effective: string;
}

const DISTRIBUTOR = "LW Flooring";
const MANUFACTURER = "LW Flooring";
const EFFECTIVE = "11/2/2026";

const STYLE_WORDS: Record<string, string> = {
  WB: "Wirebrushed",
  HS: "Handscraped",
  EIR: "Embossed in Register",
  EMB: "Embossed",
};

interface Row {
  y: number;
  items: LwTextItem[];
}

function money(token: string): number | null {
  if (!/^\$\d+\.\d{2}$/.test(token)) return null;
  const n = Number(token.slice(1));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function rowsOf(items: LwTextItem[]): Row[] {
  const rows: Row[] = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= 2);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  for (const row of rows) row.items.sort((a, b) => a.x - b.x);
  return rows.sort((a, b) => b.y - a.y);
}

function line(row: Row): string {
  return row.items
    .map((it) => it.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLike(pages: LwTextItem[][]): boolean {
  const blob = pages
    .flat()
    .map((it) => it.str)
    .join(" ");
  return /LW Flooring/.test(blob) && /lwflooring\.com/.test(blob) && /SF\/CT/.test(blob);
}

function priceOf(row: Row): { value: number; x: number } | null {
  const item = [...row.items].reverse().find((it) => it.x > 500 && money(it.str) != null);
  if (!item) return null;
  return { value: money(item.str)!, x: item.x };
}

function skuOf(row: Row): string | null {
  const item = row.items.find((it) => it.x > 170 && it.x < 260 && /^[A-Z][A-Z0-9]{3,}$/.test(it.str));
  return item?.str ?? null;
}

function thicknessOf(size: string): string {
  const mm = size.match(/(\d+(?:\.\d+)?)\s*mm/i);
  if (mm) return `${mm[1]}mm`;
  return "";
}

function styleText(row: Row): string {
  const bits = row.items
    .filter((it) => it.x >= 250 && it.x < 315 && /^(WB|HS|EIR|EMB|&)$/.test(it.str))
    .map((it) => STYLE_WORDS[it.str] ?? it.str);
  return bits.join(" ").replace(/\s+/g, " ").trim();
}

function sizeOf(row: Row): string {
  return row.items.find((it) => it.x >= 300 && it.x < 430 && /\d/.test(it.str))?.str ?? "";
}

function cartonOf(row: Row): string {
  const sf = row.items.find((it) => it.x >= 430 && it.x < 480 && /^\d+(\.\d+)?$/.test(it.str));
  const ct = row.items.find((it) => it.x >= 480 && it.x < 520 && /^\d+(\.\d+)?$/.test(it.str));
  return [sf ? `${sf.str} sf/ctn` : "", ct ? `${ct.str} ctn/plt` : ""].filter(Boolean).join(", ");
}

function colorOf(row: Row): { name: string; flag: string } {
  const flag = row.items.find((it) => /new!|coming soon/i.test(it.str))?.str ?? "";
  const name = row.items
    .filter((it) => it.x < 175 && !/new!|coming soon/i.test(it.str))
    .map((it) => it.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return { name, flag };
}

function productName(row: Row): string {
  return row.items
    .filter((it) => it.x < 250 && !/new!|coming soon/i.test(it.str) && !/^[A-Z][A-Z0-9]{3,}$/.test(it.str))
    .map((it) => it.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function remarkOf(row: Row): string {
  return row.items.find((it) => it.x >= 430 && it.x < 510 && !/^\$/.test(it.str) && !/^\d/.test(it.str))?.str ?? "";
}

interface Section {
  category: string;
  finish: string;
  species: string;
  group: string;
  wear: string;
  family: string;
  thickness: string;
  thicknesses: string[];
  molding: string;
  stair: string;
  stairExtra: string;
  stairCols: { x: number; name: string }[];
}

function blankSection(): Section {
  return {
    category: "",
    finish: "",
    species: "",
    group: "",
    wear: "",
    family: "",
    thickness: "",
    thicknesses: [],
    molding: "",
    stair: "",
    stairExtra: "",
    stairCols: [],
  };
}

function lineLabel(section: Section): string {
  return [section.wear, section.family, section.thickness].filter(Boolean).join(" ");
}

function applyHeading(section: Section, text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || /lifetime residential|^\*/i.test(t)) return;
  if (t === "ENGINEERED") return;
  if (t === "HARDWOOD") {
    section.category = "hardwood";
    section.family = "";
    section.wear = "";
    section.finish = "";
    section.species = "";
    section.group = "";
    section.thickness = "";
    section.thicknesses = [];
    section.molding = "";
    section.stair = "";
    return;
  }
  if (t === "PLANK" || t === "VINYL") return;
  if (/engineered vinyl/i.test(t)) {
    section.category = "lvp";
    section.family = "Engineered Vinyl";
    section.species = "";
    section.group = "";
    section.molding = "";
    section.thickness = "";
    section.thicknesses = [];
    return;
  }
  if (/stone core vinyl/i.test(t)) {
    section.category = "lvp";
    section.family = "Stone Core Vinyl";
    section.species = "";
    section.group = "";
    section.molding = "";
    section.thickness = "";
    section.thicknesses = [];
    return;
  }
  if (t === "LAMINATE") {
    section.category = "laminate";
    section.family = "Laminate";
    section.species = "";
    section.group = "";
    section.molding = "";
    section.thickness = "";
    section.thicknesses = [];
    return;
  }
  if (/loose lay luxury/i.test(t)) {
    section.category = "lvp";
    section.family = "Loose Lay Luxury Vinyl";
    section.species = "";
    section.group = "";
    section.molding = "";
    section.thickness = "";
    section.thicknesses = [];
    return;
  }
  if (/luxury vinyl/i.test(t)) {
    section.category = "lvp";
    section.family = "Luxury Vinyl";
    section.species = "";
    section.group = "";
    section.molding = "";
    section.thickness = "";
    section.thicknesses = [];
    return;
  }
  if (/^\d+\s*mil wear layer$/i.test(t)) {
    section.wear = t.replace(/wear layer/i, "").replace(/\s+/g, " ").trim().toLowerCase();
    section.thickness = "";
    section.thicknesses = [];
    section.molding = "";
    return;
  }
  if (/ac4 waterproof/i.test(t)) {
    section.wear = "AC4";
    section.category = "laminate";
    section.thickness = "";
    section.thicknesses = [];
    section.molding = "";
    return;
  }
  if (/polyurethane finish|uv lacquer finish/i.test(t)) {
    section.finish = t.replace(/ finish/i, "");
    section.species = "";
    section.group = "";
    return;
  }
  if (/^herringbone$/i.test(t)) {
    section.group = "Herringbone";
    return;
  }
  if (/^select grade$/i.test(t)) {
    section.group = "Select Grade";
    return;
  }
  if (/oak|hickory|pecan|walnut|acacia/i.test(t) && !/molding/i.test(t)) {
    section.group = /select grade/i.test(t) ? "Select Grade" : "";
    section.species = t.replace(/\s*-\s*select grade/i, "").trim();
    section.molding = "";
    return;
  }
  if (/^moldings$/i.test(t)) {
    const thick = section.thicknesses.length === 1 ? section.thicknesses[0] : "";
    section.molding = [section.wear, section.family, thick].filter(Boolean).join(" ");
    return;
  }
  if (/acacia moldings/i.test(t)) {
    section.category = "trim";
    section.molding = "Acacia";
    return;
  }
  if (/other wood moldings/i.test(t)) {
    section.category = "trim";
    section.molding = "Wood";
    return;
  }
  if (/wood accessories/i.test(t)) {
    section.category = "trim";
    section.molding = "";
    section.stair = "";
    return;
  }
  if (/^adhesives$/i.test(t)) {
    section.category = "other";
    section.molding = "";
    section.stair = "";
    return;
  }
  if (/underlayment/i.test(t)) {
    section.category = "underlayment";
    section.molding = "";
    section.stair = "";
    return;
  }
  if (/stair tread|risers/i.test(t)) {
    section.category = "trim";
    section.stair = t
      .replace(/s$/, "")
      .replace(/\s*-\s*special order only.*/i, "")
      .replace(/^Stair Treads/, "Stair Tread")
      .replace(/^Risers/, "Riser")
      .trim();
    section.stairCols = [];
    section.stairExtra = /special order/i.test(t) ? "Special order only (3-4 week leadtime)" : "";
    section.molding = "";
  }
}

function isSpeciesHeader(row: Row): boolean {
  const names = row.items.map((it) => it.str);
  const hits = ["White Oak", "Hickory", "Maple", "Red Oak", "Primed"].filter((name) => names.includes(name));
  return hits.length >= 3 && !row.items.some((it) => money(it.str) != null);
}

function flooringRow(row: Row, section: Section, note: string): PriceRow | null {
  const price = priceOf(row);
  const sku = skuOf(row);
  if (!price || !sku || !section.category || section.category === "trim" || section.category === "other") return null;
  if (section.category === "underlayment") return null;
  const color = colorOf(row);
  if (!color.name || /^color$/i.test(color.name)) return null;
  const size = sizeOf(row);
  const thick = thicknessOf(size);
  if (thick && !section.thicknesses.includes(thick)) section.thicknesses.push(thick);
  const style = styleText(row);
  const titleBits =
    section.category === "hardwood"
      ? [section.species, section.group, color.name]
      : [[section.wear, section.family, thick].filter(Boolean).join(" "), color.name];
  return {
    name: `${MANUFACTURER} ${titleBits.filter(Boolean).join(" ")}`.replace(/\s+/g, " "),
    category: section.category,
    unit: "sqft",
    sku,
    material_rate: price.value,
    roll_rate: null,
    labor_rate: null,
    manufacturer: MANUFACTURER,
    style: section.category === "hardwood" ? section.species || section.family : lineLabel(section),
    color: color.name,
    notes: [section.finish, style, size, cartonOf(row), color.flag.replace(/!/g, ""), note, `AM effective ${EFFECTIVE}`]
      .filter(Boolean)
      .join(" · "),
  };
}

function pieceRow(row: Row, section: Section, note: string): PriceRow | null {
  const price = priceOf(row);
  if (!price || section.stair) return null;
  const sku = skuOf(row);
  const name = productName(row);
  if (!name || /^product$/i.test(name)) return null;
  if (sku && section.category !== "other" && section.category !== "underlayment" && !section.molding) return null;
  const size = sizeOf(row);
  if (section.category === "other") {
    return {
      name: `${MANUFACTURER} ${name}${size ? ` ${size}` : ""}`.replace(/\s+/g, " "),
      category: "other",
      unit: "each",
      sku,
      material_rate: price.value,
      roll_rate: null,
      labor_rate: null,
      manufacturer: MANUFACTURER,
      style: name,
      color: null,
      notes: [size, remarkOf(row), note, `AM effective ${EFFECTIVE}`].filter(Boolean).join(" · "),
    };
  }
  if (section.category === "underlayment") {
    return {
      name: `${MANUFACTURER} ${name}`,
      category: "underlayment",
      unit: "each",
      sku,
      material_rate: price.value,
      roll_rate: null,
      labor_rate: null,
      manufacturer: MANUFACTURER,
      style: name,
      color: null,
      notes: [size, note, `AM effective ${EFFECTIVE}`].filter(Boolean).join(" · "),
    };
  }
  if (!section.molding) return null;
  const kind = section.category === "trim" || section.molding ? "trim" : section.category;
  return {
    name: `${MANUFACTURER} ${section.molding} ${name}${size ? ` ${size}` : ""}`.replace(/\s+/g, " "),
    category: kind === "trim" ? "trim" : section.category,
    unit: "each",
    sku,
    material_rate: price.value,
    roll_rate: null,
    labor_rate: null,
    manufacturer: MANUFACTURER,
    style: name,
    color: null,
    notes: [remarkOf(row), size, note, `AM effective ${EFFECTIVE}`].filter(Boolean).join(" · "),
  };
}

function stairRows(row: Row, section: Section, note: string): PriceRow[] {
  if (!section.stair || !section.stairCols.length) return [];
  const length = row.items.find((it) => it.x < 100 && /^\d+"$/.test(it.str));
  if (!length) return [];
  const prices = row.items
    .map((it) => ({ x: it.x, value: money(it.str) }))
    .filter((it): it is { x: number; value: number } => it.value != null);
  const out: PriceRow[] = [];
  for (const price of prices) {
    const col = [...section.stairCols].sort((a, b) => Math.abs(a.x - price.x) - Math.abs(b.x - price.x))[0];
    if (!col || Math.abs(col.x - price.x) > 36) continue;
    out.push({
      name: `${MANUFACTURER} ${section.stair} ${col.name} ${length.str}`,
      category: "trim",
      unit: "each",
      sku: null,
      material_rate: price.value,
      roll_rate: null,
      labor_rate: null,
      manufacturer: MANUFACTURER,
      style: section.stair,
      color: col.name,
      notes: [section.stairExtra, note, `AM effective ${EFFECTIVE}`].filter(Boolean).join(" · "),
    });
  }
  return out;
}

function parsePage(rows: Row[]): PriceRow[] {
  const section = blankSection();
  const lines = rows.map(line);
  const customNote = [...new Set(
    lines
      .filter((text) => /custom order moldings sales are final/i.test(text))
      .map((text) => text.replace(/^\*+\s*/, "")),
  )].join(" · ");
  const stairNote = [...new Set(
    lines
      .filter((text) => /square or round|brushing\/distressing|handscraping/i.test(text))
      .map((text) => text.replace(/^\*+\s*/, "")),
  )].join(" · ");
  const out: PriceRow[] = [];
  for (const row of rows) {
    if (row.y < 40) continue;
    const text = line(row);
    if (/lwflooring\.com|effective 11\/2\/2026|^prices subject/i.test(text)) continue;
    if (isSpeciesHeader(row)) {
      section.stairCols = row.items
        .filter((it) => /oak|hickory|maple|primed/i.test(it.str))
        .map((it) => ({ x: it.x, name: it.str }));
      continue;
    }
    const priced = row.items.some((it) => money(it.str) != null && it.x > 140);
    if (!priced) {
      if (row.items[0] && (row.items[0].x < 130 || /wood accessories|special order prefinished/i.test(text))) {
        applyHeading(section, text);
      }
      continue;
    }
    const stairs = stairRows(row, section, section.stair.startsWith("Stair Tread") ? stairNote : "");
    if (stairs.length) {
      out.push(...stairs);
      continue;
    }
    const floor = flooringRow(row, section, "");
    if (floor) {
      out.push(floor);
      continue;
    }
    const piece = pieceRow(row, section, /custom order/i.test(remarkOf(row)) ? customNote : "");
    if (piece) out.push(piece);
  }
  return out;
}

function uniquify(rows: PriceRow[]): PriceRow[] {
  const names = new Set<string>();
  return rows.map((row) => {
    let name = row.name;
    let n = 2;
    while (names.has(name.toLowerCase())) {
      name = `${row.name} (${row.sku ?? n})`;
      n += 1;
    }
    names.add(name.toLowerCase());
    return name === row.name ? row : { ...row, name };
  });
}

export function parseLwFlooringPriceList(pages: LwTextItem[][]): LwPriceBook | null {
  if (!looksLike(pages)) return null;
  const rows = uniquify(pages.flatMap((page) => parsePage(rowsOf(page))));
  if (!rows.length) return null;
  return { rows, distributor: DISTRIBUTOR, effective: EFFECTIVE };
}
