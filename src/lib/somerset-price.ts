/**
 * Somerset Hardwood R35 price book dated 10/29/2026, from Palmer Donavin.
 *
 * A width column prints one price for the colors in that column. A price
 * sitting on the bottom color is that color only; the price above it covers
 * the other colors. Two prices stacked in one column (Light Character and
 * Heavy Character, or a species split) follow the nearest printed price.
 * Call and TBD are not prices. The same molding SKU at the same price is
 * one product.
 */
import type { PriceRow } from "@/lib/extract";

export interface SomersetTextItem {
  str: string;
  x: number;
  y: number;
}

export interface SomersetPriceBook {
  rows: PriceRow[];
  distributor: string;
  effective: string;
}

const DISTRIBUTOR = "Palmer Donavin";
const MANUFACTURER = "Somerset";
const EFFECTIVE = "10/29/2026";
const STAMP = "Sheet stamped Discontinued 12-11-26";

const STOP = new Set([
  "species",
  "color",
  "solid",
  "engineered",
  "tbd",
  "call",
  "sf/ctn",
  "lbs/ctn",
  "ctn/pallet",
  "sf/pallet",
  "wt/pallet",
  "moldings",
]);

interface Row {
  y: number;
  items: SomersetTextItem[];
}

interface SkuCell {
  sku: string;
  col: number;
  price: number | null;
}

interface DataRow {
  y: number;
  species: string;
  color: string;
  cells: SkuCell[];
}

interface Column {
  headerX: number;
  priceX: number;
  width: string;
  construction: string;
  piece: string;
}

function money(token: string): number | null {
  if (!/^\$\d+\.\d{2}$/.test(token)) return null;
  const n = Number(token.slice(1));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function isSku(token: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9]{3,}$/.test(token)) return false;
  if (/\d/.test(token)) return true;
  // A few random-width codes are letters only, like EPHCABRLE.
  if (!/^[A-Z]{8,}$/.test(token)) return false;
  return !/ENGINEERED|THRESHOLD|CHARACTER|WARRANTY|COLLECTION/.test(token);
}

function rowsOf(items: SomersetTextItem[]): Row[] {
  const rows: Row[] = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= 2.2);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  for (const row of rows) row.items.sort((a, b) => a.x - b.x);
  return rows.sort((a, b) => b.y - a.y);
}

function line(row: Row): string {
  return row.items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
}

function looksLike(pages: SomersetTextItem[][]): boolean {
  const blob = pages.flat().map((it) => it.str).join(" ");
  return /\$\/SF/.test(blob) && /SF\/ctn/.test(blob) && /Discontinued 12-11-26/.test(blob);
}

function leftText(row: Row): string {
  return row.items
    .filter((it) => it.x < 280)
    .map((it) => it.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTitle(row: Row): boolean {
  const text = leftText(row);
  const first = row.items[0];
  if (!text || !first || first.x > 80) return false;
  if (row.items.some((it) => it.x < 280 && (money(it.str) != null || isSku(it.str)))) return false;
  if (/^eased|warranty|sawn face|solid 3\/4|engineered 1\/2/i.test(text)) return false;
  return /gloss \(|\bplank\b|collection$|^moldings$|cumberland|truoak|tru oak|hand crafted|euro wide|color strip|color plank|high gloss|homestyle|homestlye/i.test(
    text,
  );
}

function titleName(row: Row): string {
  return leftText(row)
    .replace(/\s*-\s*$/g, "")
    .replace(/homestlye/i, "Homestyle")
    .replace(/\s+/g, " ")
    .trim();
}

function nearest<T extends { y: number }>(items: T[], y: number): T | null {
  let best: T | null = null;
  let dist = Infinity;
  for (const it of items) {
    const d = Math.abs(it.y - y);
    if (d < dist || (d === dist && best && it.y > best.y)) {
      dist = d;
      best = it;
    }
  }
  return best;
}

function applyColumnPrices(
  rows: DataRow[],
  col: number,
  tokens: { y: number; value: number }[],
) {
  if (!tokens.length || !rows.length) return;
  const lowest = rows.reduce((a, b) => (a.y < b.y ? a : b));
  const onLowest = tokens.find((t) => Math.abs(t.y - lowest.y) < 3);
  const others = onLowest ? tokens.filter((t) => t !== onLowest) : tokens;
  for (const row of rows) {
    const cell = row.cells.find((c) => c.col === col);
    if (!cell) continue;
    if (tokens.length === 1) {
      cell.price = tokens[0]!.value;
      continue;
    }
    if (onLowest && others.length === 1) {
      cell.price = Math.abs(row.y - lowest.y) < 3 ? onLowest.value : others[0]!.value;
      continue;
    }
    cell.price = nearest(tokens, row.y)?.value ?? null;
  }
}

function flooringSection(rows: Row[], title: string, note: string): PriceRow[] {
  const widthRow = rows.find(
    (row) =>
      row.items.some((it) => it.str === "$/SF") &&
      row.items.some((it) => /\d/.test(it.str) && /"|Random|1\/4|1\/2/.test(it.str)),
  );
  const priceHeader = rows.find((row) => row.items.filter((it) => it.str === "$/SF").length >= 1);
  if (!widthRow || !priceHeader) return [];
  const widths = widthRow.items.filter((it) => /\d/.test(it.str) && (/["¼/]/.test(it.str) || /random/i.test(it.str)));
  const priceHeads = priceHeader.items.filter((it) => it.str === "$/SF");
  const columns: Column[] = [];
  for (const head of priceHeads) {
    const width = [...widths].filter((w) => w.x < head.x + 8).sort((a, b) => b.x - a.x)[0];
    if (!width) continue;
    const solid = rows
      .flatMap((row) => row.items)
      .filter((it) => /^solid$/i.test(it.str) && it.y >= priceHeader.y - 2 && it.y <= priceHeader.y + 24);
    const engineered = rows
      .flatMap((row) => row.items)
      .filter((it) => /^engineered$/i.test(it.str) && it.y >= priceHeader.y - 2 && it.y <= priceHeader.y + 24);
    const construction =
      (engineered.some((it) => Math.abs(it.x - width.x) < 80 || (it.x < head.x && it.x > width.x - 40))
        ? "Engineered"
        : "") ||
      (solid.some((it) => it.x < head.x + 30) && head.x < 500 ? "Solid" : "") ||
      (engineered.length && !solid.length ? "Engineered" : solid.length && !engineered.length ? "Solid" : "");
    // Construction is the group label sitting above this width, not a guess from x.
    const group = [...solid, ...engineered].sort(
      (a, b) => Math.abs(a.x - width.x) - Math.abs(b.x - width.x),
    )[0];
    columns.push({
      headerX: width.x,
      priceX: head.x,
      width: width.str,
      construction: group ? (/engineered/i.test(group.str) ? "Engineered" : "Solid") : construction,
      piece: "",
    });
  }
  if (!columns.length) return [];

  const speciesMarks = rows.flatMap((row) =>
    row.items
      .filter((it) => it.x < 60 && !STOP.has(it.str.toLowerCase()) && !isSku(it.str) && !money(it.str))
      .map((it) => ({ y: row.y, text: it.str })),
  );
  const data: DataRow[] = [];
  for (const row of rows) {
    const skus = row.items.filter((it) => isSku(it.str));
    if (!skus.length) continue;
    const color = row.items.find((it) => it.x >= 60 && it.x < 160 && !isSku(it.str) && money(it.str) == null);
    if (!color) continue;
    const ownSpecies = row.items.find((it) => it.x < 60 && !STOP.has(it.str.toLowerCase()) && !isSku(it.str));
    const species = ownSpecies?.str || nearest(speciesMarks, row.y)?.text || "";
    const cells: SkuCell[] = [];
    for (const sku of skus) {
      let col = 0;
      let dist = Infinity;
      columns.forEach((column, index) => {
        const d = Math.abs(sku.x - column.headerX);
        if (d < dist) {
          dist = d;
          col = index;
        }
      });
      if (dist > 70) continue;
      cells.push({ sku: sku.str, col, price: null });
    }
    if (cells.length) data.push({ y: row.y, species, color: color.str, cells });
  }
  const tokens = rows.flatMap((row) =>
    row.items
      .map((it) => ({ y: row.y, x: it.x, value: money(it.str) }))
      .filter((it): it is { y: number; x: number; value: number } => it.value != null),
  );
  columns.forEach((column, index) => {
    const mine = tokens.filter((token) => Math.abs(token.x - column.priceX) < 26);
    applyColumnPrices(data, index, mine);
  });

  const out: PriceRow[] = [];
  for (const row of data) {
    for (const cell of row.cells) {
      if (cell.price == null) continue;
      const column = columns[cell.col]!;
      const collection = title.replace(/\s+\(\d+\)\s*$/, "").trim();
      out.push({
        name: `${MANUFACTURER} ${collection} ${row.color} ${column.width} ${column.construction}`.replace(/\s+/g, " "),
        category: "hardwood",
        unit: "sqft",
        sku: cell.sku,
        material_rate: cell.price,
        roll_rate: null,
        labor_rate: null,
        manufacturer: MANUFACTURER,
        style: collection,
        color: row.color,
        notes: [row.species, column.construction, column.width, note, `R35 ${EFFECTIVE}`, STAMP]
          .filter(Boolean)
          .join(" · "),
      });
    }
  }
  return out;
}

function moldingSection(rows: Row[], title: string): PriceRow[] {
  const header = rows.find((row) => row.items.some((it) => /touch up kit/i.test(it.str)));
  const priceRow = rows.find((row) => row.items.filter((it) => money(it.str) != null).length >= 3);
  if (!header || !priceRow) return [];
  const pieces = header.items.filter((it) => /touch up|quarter|t-mold|stair|reducer|threshold/i.test(it.str));
  const prices = priceRow.items
    .map((it) => ({ x: it.x, value: money(it.str) }))
    .filter((it): it is { x: number; value: number } => it.value != null);
  const columns = pieces.map((piece) => {
    const price = [...prices].sort((a, b) => Math.abs(a.x - piece.x) - Math.abs(b.x - piece.x))[0];
    return { headerX: piece.x, price: price && Math.abs(price.x - piece.x) < 24 ? price.value : null, piece: piece.str };
  });
  const group = line(rows.find((row) => /solid 3\/4|engineered 1\/2/i.test(line(row))) ?? { y: 0, items: [] });
  const speciesMarks = rows.flatMap((row) =>
    row.items
      .filter((it) => it.x < 100 && it.x > 40 && !isSku(it.str) && money(it.str) == null && !/species|color/i.test(it.str))
      .map((it) => ({ y: row.y, text: it.str })),
  );
  const out: PriceRow[] = [];
  for (const row of rows) {
    const skus = row.items.filter((it) => isSku(it.str) && it.x > 150);
    if (!skus.length) continue;
    const color = row.items.find((it) => it.x >= 90 && it.x < 160 && !isSku(it.str));
    if (!color) continue;
    const ownSpecies = row.items.find((it) => it.x < 90 && it.x > 40 && !isSku(it.str) && !/species|color/i.test(it.str));
    const species = ownSpecies?.str || nearest(speciesMarks, row.y)?.text || "";
    for (const sku of skus) {
      let col = 0;
      let dist = Infinity;
      columns.forEach((column, index) => {
        const d = Math.abs(sku.x - column.headerX);
        if (d < dist) {
          dist = d;
          col = index;
        }
      });
      const column = columns[col];
      if (!column || column.price == null || dist > 36) continue;
      const kind = /touch up/i.test(column.piece) ? "other" : "trim";
      const collection = title.replace(/\s+collection$/i, "").trim();
      out.push({
        name: `${MANUFACTURER} ${column.piece} ${color.str}`.replace(/\s+/g, " "),
        category: kind,
        unit: "each",
        sku: sku.str,
        material_rate: column.price,
        roll_rate: null,
        labor_rate: null,
        manufacturer: MANUFACTURER,
        style: column.piece,
        color: color.str,
        notes: [collection, species, group, `R35 ${EFFECTIVE}`, STAMP].filter(Boolean).join(" · "),
      });
    }
  }
  return out;
}

function sectionNote(rows: Row[]): string {
  const bits = rows
    .map(line)
    .filter((text) => /warranty|eased|thick|gloss|sawn/i.test(text) && !/gloss \(\d+\)/i.test(text))
    .slice(0, 2);
  return bits.join(" · ");
}

function dedupe(rows: PriceRow[]): PriceRow[] {
  const bySku = new Map<string, PriceRow>();
  const out: PriceRow[] = [];
  for (const row of rows) {
    const sku = row.sku?.trim();
    if (!sku) {
      out.push(row);
      continue;
    }
    const prev = bySku.get(sku);
    if (!prev) {
      bySku.set(sku, row);
      out.push(row);
      continue;
    }
    if (prev.material_rate !== row.material_rate) {
      out.push({ ...row, name: `${row.name} (${row.notes?.split(" · ")[0] ?? sku})` });
    }
  }
  const names = new Set<string>();
  return out.map((row) => {
    let name = row.name;
    let n = 2;
    while (names.has(name.toLowerCase())) {
      name = `${row.name} (${n})`;
      n += 1;
    }
    names.add(name.toLowerCase());
    return name === row.name ? row : { ...row, name };
  });
}

export function parseSomersetPriceList(pages: SomersetTextItem[][]): SomersetPriceBook | null {
  if (!looksLike(pages)) return null;
  const all = pages.flatMap((page) => rowsOf(page));
  const titles = all
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => isTitle(row));
  const draft: PriceRow[] = [];
  let molding = false;
  for (let i = 0; i < titles.length; i++) {
    const title = titleName(titles[i]!.row);
    if (/^moldings$/i.test(title)) {
      molding = true;
      continue;
    }
    const start = titles[i]!.index;
    const end = titles[i + 1]?.index ?? all.length;
    const slice = all.slice(start, end);
    // Cumberland Reserve is printed TBD and is not a price.
    if (/coming late|^cumberland/i.test(title)) continue;
    const note = sectionNote(slice);
    if (molding || /collection$/i.test(title)) draft.push(...moldingSection(slice, title));
    else draft.push(...flooringSection(slice, title, note));
  }
  const rows = dedupe(draft);
  if (!rows.length) return null;
  return { rows, distributor: DISTRIBUTOR, effective: EFFECTIVE };
}
