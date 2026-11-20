/**
 * Ohio Valley Flooring price books for The Floor King (account 032320).
 *
 * A color's floor price is the cost. Coordinated trim is a separate piece
 * at the price in that column. A carton amount that is only the square-foot
 * price times the coverage is not a second price. Commercial sheet and tile
 * keep the unit printed on that table (box, square foot, square yard, linear foot).
 */
import type { PriceRow } from "@/lib/extract";

export interface OvfSheet {
  name: string;
  rows: string[][];
}

export interface OvfBook {
  rows: PriceRow[];
  distributor: string;
}

const DISTRIBUTOR = "Ohio Valley Flooring";

function cell(row: string[] | undefined, index: number): string {
  return (row?.[index] ?? "").replace(/\s+/g, " ").replace(/[“”]/g, '"').trim();
}

function moneyOf(raw: string): number | null {
  const t = raw.replace(/\s+/g, " ").replace(/[“”]/g, '"').trim();
  if (!t || /^n\/?a$/i.test(t) || /^-+$/.test(t) || t.toUpperCase() === "NA") return null;
  if (!/\$|\/\s*(ea|sf|sy|ct|lf|pc)\b/i.test(t) && !/^\d{1,4}\.\d{2}$/.test(t)) return null;
  const nums = t.replace(/,/g, "").match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length !== 1) return null;
  const n = Number(nums[0]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function looksLikeCode(raw: string): boolean {
  const t = raw.replace(/\s+/g, "");
  if (!t || /^n\/?a$/i.test(t) || moneyOf(raw) != null) return false;
  if (/[•/\\]/.test(raw) || t.length > 24) return false;
  if (/^\d{4,}$/.test(t)) return true;
  return t.length >= 4 && /[A-Za-z]/.test(t) && /\d/.test(t);
}

function nice(raw: string): string {
  const t = raw.replace(/\s+/g, " ").replace(/[“”]/g, '"').trim();
  if (!t || t !== t.toUpperCase() || !/[A-Z]/.test(t)) return t;
  return t
    .toLowerCase()
    .replace(/(^|[^a-z0-9'’])([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase());
}

function notesJoin(parts: Array<string | null | undefined>): string | null {
  const out: string[] = [];
  for (const part of parts) {
    const t = (part ?? "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (out.some((item) => item.toLowerCase() === t.toLowerCase())) continue;
    out.push(t);
  }
  return out.length ? out.join(" · ") : null;
}

function rowText(row: string[]): string {
  return row.map((c) => c.trim()).filter(Boolean).join(" ");
}

function blank(row: string[] | undefined): boolean {
  return !row || row.every((c) => !c.trim());
}

interface Built {
  name: string;
  category: string;
  unit: string;
  sku: string | null;
  material_rate: number;
  manufacturer: string;
  style: string | null;
  color: string | null;
  notes: string | null;
}

function toRow(item: Built): PriceRow {
  return {
    name: item.name,
    category: item.category,
    unit: item.unit,
    sku: item.sku,
    material_rate: item.material_rate,
    roll_rate: null,
    labor_rate: null,
    manufacturer: item.manufacturer,
    style: item.style,
    color: item.color,
    notes: item.notes,
  };
}

function uniquify(rows: PriceRow[]): PriceRow[] {
  const used = new Set<string>();
  return rows.map((row) => {
    const sku = row.sku?.trim();
    let name = row.name.trim();
    let n = 2;
    while (used.has(name.toLowerCase())) {
      name = sku ? `${row.name.trim()} (${sku})` : `${row.name.trim()} (${n})`;
      if (used.has(name.toLowerCase())) name = `${name} (${n})`;
      n += 1;
    }
    used.add(name.toLowerCase());
    return name === row.name ? row : { ...row, name };
  });
}

function trimLabel(raw: string): string {
  const length = raw.match(/(\d+(?:\.\d+)?)\s*"/);
  const len = length ? ` ${length[1]}"` : "";
  const n = raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (/q round|quarter round/.test(n)) return `Quarter Round${len}`;
  if (/t mold/.test(n)) return `T-Mold${len}`;
  if (/flush stair|stair nose|stairnose|stair nosing|overlap stair/.test(n)) return `Stair Nosing${len}`;
  if (/multi reducer/.test(n)) return `Multi Reducer${len}`;
  if (/reducer/.test(n)) return `Reducer${len}`;
  if (/end cap/.test(n)) return `End Cap${len}`;
  if (/threshold/.test(n)) return `Threshold${len}`;
  if (/touch/.test(n)) return "Touch-up Kit";
  if (/5 in 1 base/.test(n)) return "5-in-1 Base";
  if (/5 in 1/.test(n)) return "5-in-1";
  return nice(raw);
}

function isSpecLine(line: string): boolean {
  if (!line) return false;
  if (/sf\/ct|ct\/p[al]|lb\/ct|warranty|wear rating|engineered|coordinated trim|bevel|sawn|centerply|truecore|glaze|nuoil|floorscore|handcraft|wire brush|micro-bevel|micro bevel/i.test(line))
    return true;
  if (/^\d/.test(line)) return true;
  if (/\d\s*mm\b/i.test(line) || /\d\s*"/.test(line)) return true;
  return false;
}

function isVariantLabel(line: string): boolean {
  if (!line || /indicates item|prepared especially/i.test(line)) return false;
  if (/grade/i.test(line)) return true;
  if (/"/.test(line) && /\d/.test(line) && !/sf\/ct/i.test(line)) return true;
  return false;
}

function shortVariant(line: string): string {
  const cut = line.split(/\s+-\s+/)[0].replace(/[“”]/g, '"').trim();
  return cut.length > 90 ? cut.slice(0, 90).trim() : cut;
}

function isCoverageLine(line: string): boolean {
  return /sf\/ct|ct\/p[al]|lb\/ct/i.test(line) && !/grade/i.test(line);
}

type BandKind = "floor" | "old" | "trim" | "accessory";

interface BandCol {
  index: number;
  kind: BandKind | "color";
  label: string;
}

function bandHeader(row: string[]): BandCol[] | null {
  if (!row.some((c) => /species\s*\/\s*color|item\s*#/i.test(c))) return null;
  const cols: BandCol[] = [];
  row.forEach((raw, index) => {
    const label = raw.replace(/\s+/g, " ").trim();
    if (!label) return;
    const n = label.toLowerCase();
    let kind: BandCol["kind"] = "trim";
    if (/species|color/.test(n)) kind = "color";
    else if (/old item/.test(n)) kind = "old";
    else if (/item\s*#|new item/.test(n)) kind = "floor";
    else if (/touch/.test(n)) kind = "accessory";
    cols.push({ index, kind, label });
  });
  return cols.some((c) => c.kind === "floor") ? cols : null;
}

function parseBand(
  rows: string[][],
  manufacturer: string,
  categoryFor: (collection: string, specs: string) => string,
): PriceRow[] {
  const drafts: Array<Built & { variant: string }> = [];
  let collection = "";
  let collectionNote = "";
  let category = "other";
  let cols: BandCol[] | null = null;
  let prices = new Map<number, number | null>();
  let species = "";
  let variant = "";
  let pendingVariant = "";
  let coverage = "";

  const emitColor = (row: string[]) => {
    if (!cols) return;
    if (pendingVariant) {
      variant = pendingVariant;
      pendingVariant = "";
    }
    const colorCol = cols.find((c) => c.kind === "color");
    const color = cell(row, colorCol?.index ?? 0);
    if (!color || /indicates item/i.test(color)) return;
    const floor = cols.find((c) => c.kind === "floor");
    const floorSku = floor ? cell(row, floor.index) : "";
    const floorPrice = floor ? prices.get(floor.index) : null;
    const old = cols.find((c) => c.kind === "old");
    const oldSku = old ? cell(row, old.index) : "";
    const dropped = /dropped/i.test(color);
    const speciesBit = species && !color.toLowerCase().includes(species.toLowerCase()) ? species : "";
    const head = `${manufacturer} ${collection}`.trim();
    const floorName = [head, speciesBit, color].filter(Boolean).join(" — ");
    if (floorPrice != null && looksLikeCode(floorSku)) {
      drafts.push({
        name: floorName,
        category,
        unit: "sqft",
        sku: floorSku.replace(/\s+/g, ""),
        material_rate: floorPrice,
        manufacturer,
        style: collection,
        color,
        variant,
        notes: notesJoin([
          species && speciesBit === "" ? species : null,
          variant || null,
          coverage || collectionNote || null,
          looksLikeCode(oldSku) ? `Previous item ${oldSku.replace(/\s+/g, "")}` : null,
          dropped ? "Dropped — limited inventory." : null,
        ]),
      });
    }
    for (const col of cols) {
      if (col.kind !== "trim" && col.kind !== "accessory") continue;
      const sku = cell(row, col.index);
      const price = prices.get(col.index);
      if (price == null || !looksLikeCode(sku)) continue;
      const piece = trimLabel(col.label);
      drafts.push({
        name: `${floorName} — ${piece}`,
        category: col.kind === "accessory" ? "other" : "trim",
        unit: "each",
        sku: sku.replace(/\s+/g, ""),
        material_rate: price,
        manufacturer,
        style: collection,
        color,
        variant,
        notes: notesJoin([variant || null, dropped ? "Dropped — limited inventory." : null]),
      });
    }
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (blank(row)) continue;
    const header = bandHeader(row);
    if (header) {
      cols = header;
      prices = new Map();
      species = "";
      variant = "";
      pendingVariant = "";
      coverage = "";
      const specs: string[] = [];
      let title = "";
      for (let k = i - 1; k >= 0 && i - k < 12; k--) {
        const line = cell(rows[k], 0);
        if (!line) {
          if (title || specs.length) break;
          continue;
        }
        if (bandHeader(rows[k] ?? [])) break;
        if (/prepared especially|indicates item|coordinated trim/i.test(line)) continue;
        if (isSpecLine(line) && !title) {
          specs.unshift(line);
          continue;
        }
        title = line;
        break;
      }
      collection = title || collection;
      collectionNote = specs.filter((line) => /\d/.test(line)).slice(0, 2).join(" · ");
      category = categoryFor(collection, collectionNote);
      continue;
    }
    if (!cols) continue;
    const floor = cols.find((c) => c.kind === "floor");
    const floorCell = floor ? cell(row, floor.index) : "";
    const colorCol = cols.find((c) => c.kind === "color");
    const colorCell = cell(row, colorCol?.index ?? 0);
    if (moneyOf(floorCell) != null || /^n\/?a$/i.test(floorCell)) {
      if (pendingVariant) {
        variant = pendingVariant;
        pendingVariant = "";
      }
      if (colorCell && moneyOf(colorCell) == null && !looksLikeCode(colorCell)) species = nice(colorCell);
      for (const col of cols) {
        if (col.kind === "color") continue;
        const amount = moneyOf(cell(row, col.index));
        prices.set(col.index, amount);
      }
      continue;
    }
    if (looksLikeCode(floorCell)) {
      emitColor(row);
      continue;
    }
    const only = rowText(row);
    if (isVariantLabel(only)) pendingVariant = shortVariant(only);
    else if (isCoverageLine(only)) coverage = only;
  }

  const variants = new Map<string, Set<string>>();
  for (const draft of drafts) {
    const key = `${draft.style}`.toLowerCase();
    const set = variants.get(key) ?? new Set<string>();
    if (draft.variant) set.add(draft.variant);
    variants.set(key, set);
  }
  return uniquify(
    drafts.map((draft) => {
      const many = (variants.get(`${draft.style}`.toLowerCase())?.size ?? 0) > 1;
      const name = many && draft.variant ? `${draft.name} — ${draft.variant}` : draft.name;
      return toRow({ ...draft, name });
    }),
  );
}

function parseInhaus(rows: string[][]): PriceRow[] {
  return parseBand(rows, "Inhaus", (collection) => (/ceramin/i.test(collection) ? "lvp" : "laminate"));
}

function parseHallmark(rows: string[][]): PriceRow[] {
  return parseBand(rows, "Hallmark", (collection, specs) => {
    const blob = `${collection} ${specs}`;
    if (/laminate/i.test(blob)) return "laminate";
    if (/pvp|vinyl plank/i.test(blob)) return "lvp";
    return "hardwood";
  });
}

function parseQuickStep(rows: string[][]): PriceRow[] {
  const out: Built[] = [];
  let collection = "";
  let note = "";
  let category = "laminate";
  let floorPrice: number | null = null;
  let carton = "";
  let trims: { index: number; label: string; price: number | null }[] = [];

  const flushTitle = (row: string[], i: number) => {
    const title = cell(row, 0);
    if (!title || /prepared especially/i.test(title) || isSpecLine(title)) return false;
    let sfAt = -1;
    const specs: string[] = [];
    for (let k = i + 1; k < Math.min(rows.length, i + 8); k++) {
      const line = rowText(rows[k] ?? []);
      if (/\$\s*\d/.test(line) && /\/\s*SF/i.test(line)) {
        sfAt = k;
        break;
      }
      if (cell(rows[k], 0)) specs.push(cell(rows[k], 0));
    }
    if (sfAt < 0) return false;
    collection = nice(title.replace(/\s+collection$/i, " Collection"));
    const warranty = row.map(cellish).filter((c) => /warranty/i.test(c)).join(" ");
    note = notesJoin([...specs, warranty]) ?? "";
    category = /engineered hardwood/i.test(`${title} ${specs.join(" ")}`) ? "hardwood" : "laminate";
    floorPrice = null;
    carton = "";
    trims = [];
    return true;
  };

  function cellish(c: string): string {
    return c.replace(/\s+/g, " ").trim();
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (blank(row)) continue;
    const line = rowText(row);
    if (/\$\s*\d/.test(line) && /\/\s*SF/i.test(line)) {
      floorPrice = moneyOf(cell(row, 0));
      trims = [];
      row.forEach((raw, index) => {
        if (index === 0) return;
        const label = raw.replace(/\s+/g, " ").trim();
        if (!label || moneyOf(label) != null) return;
        trims.push({ index, label: trimLabel(label), price: null });
      });
      continue;
    }
    if (/\$\s*\d/.test(line) && /\/\s*CT/i.test(line)) {
      const amount = moneyOf(cell(row, 0));
      carton = amount != null ? `Carton $${amount.toFixed(2)}` : "";
      for (const trim of trims) trim.price = moneyOf(cell(row, trim.index));
      continue;
    }
    const sku = cell(row, 0);
    const color = cell(row, 1);
    if (isSpecLine(sku) && !looksLikeCode(sku)) continue;
    if (floorPrice != null && looksLikeCode(sku) && color && !/\$/.test(color)) {
      out.push({
        name: `Quick-Step ${collection} — ${color}`,
        category,
        unit: "sqft",
        sku: sku.replace(/\s+/g, ""),
        material_rate: floorPrice,
        manufacturer: "Quick-Step",
        style: collection,
        color,
        notes: notesJoin([note, carton]),
      });
      for (const trim of trims) {
        const trimSku = cell(row, trim.index);
        if (trim.price == null || !looksLikeCode(trimSku)) continue;
        out.push({
          name: `Quick-Step ${collection} — ${color} — ${trim.label}`,
          category: "trim",
          unit: "each",
          sku: trimSku.replace(/\s+/g, ""),
          material_rate: trim.price,
          manufacturer: "Quick-Step",
          style: collection,
          color,
          notes: null,
        });
      }
      continue;
    }
    flushTitle(row, i);
  }
  return uniquify(out.map(toRow));
}

function schonoxCategory(section: string): string {
  return /tool|accessor/i.test(section) ? "other" : "underlayment";
}

function parseSchonox(rows: string[][]): PriceRow[] {
  const out: Built[] = [];
  let section = "";
  let product = "";
  for (const row of rows) {
    if (blank(row)) continue;
    const values = row.map((c) => c.replace(/\s+/g, " ").trim());
    const priceIndex = values.findIndex((c) => moneyOf(c) != null);
    const priced = priceIndex >= 0;
    if (!priced) {
      const title = values[0] ?? "";
      const extras = values.slice(1).filter((c) => c && !/stocking/i.test(c));
      if (!title || extras.length || title.length > 70 || title.endsWith(".")) continue;
      if (/materials|compounds|adhesives|tools|systems/i.test(title) && !/sch[oö]nox/i.test(title)) {
        section = title;
        product = "";
      } else if (!/^approx/i.test(title)) {
        product = title;
      }
      continue;
    }
    const sku = values.find((c) => looksLikeCode(c)) ?? "";
    const uom = values.find((c) => /\b(bag|gal|gallon|pail|kit|ea)\b/i.test(c) && moneyOf(c) == null) ?? "";
    const coverage = values.find((c) => /sf|sqft|sq ft/i.test(c) && moneyOf(c) == null) ?? "";
    const named = values[0] && values[0] !== sku ? values[0] : product;
    const cleanName = named.replace(/\s*-\s*stocking\s*$/i, "").trim();
    const head = /sch[oö]nox/i.test(cleanName) ? cleanName : `Schönox ${cleanName || sku}`;
    const unit = /bag/i.test(uom) ? "bag" : "each";
    const coverageBit = coverage.replace(/^approx\.?\s*/i, "").trim();
    out.push({
      name: uom ? `${head} — ${uom}` : head,
      category: schonoxCategory(section),
      unit,
      sku: sku.replace(/\s+/g, "") || null,
      material_rate: moneyOf(values[priceIndex]) ?? 0,
      manufacturer: "Schönox",
      style: cleanName || null,
      color: null,
      notes: notesJoin([section ? nice(section) : null, coverageBit || null]),
    });
  }
  return uniquify(out.filter((row) => row.material_rate > 0).map(toRow));
}

function normKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function widthKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/herringbone|herr\.?/g, "herr")
    .replace(/[”"]/g, '"')
    .replace(/\s+/g, "");
}

interface MiragePrice {
  price: number;
  construction: string;
  width: string;
  lengths: string;
  species: string;
  collection: string;
  grade: string;
}

function parseMirage(rows: string[][]): PriceRow[] {
  const colorAt = rows.findIndex((row) => row.some((c) => /^colors$/i.test(c.trim())));
  if (colorAt < 0) return [];
  const prices = new Map<string, MiragePrice>();
  const put = (key: string, value: MiragePrice) => {
    if (!prices.has(key)) prices.set(key, value);
  };

  for (let i = 2; i < colorAt; i++) {
    if (!rows[i]?.some((c) => /^specie$/i.test(c.trim()) || /^grades$/i.test(c.trim()))) continue;
    const widths = rows[i - 1] ?? [];
    const cons = rows[i - 2] ?? [];
    const lengths = rows[i] ?? [];
    let construction = "";
    const filled: { index: number; construction: string; width: string; lengths: string }[] = [];
    for (let c = 3; c < 17; c++) {
      if (cell(cons, c)) construction = cell(cons, c);
      const width = cell(widths, c);
      if (!width || !construction) continue;
      filled.push({ index: c, construction, width, lengths: cell(lengths, c) });
    }
    let collection = "";
    let species = "";
    for (let r = i + 1; r < colorAt; r++) {
      if (blank(rows[r])) break;
      if (cell(rows[r], 0)) collection = cell(rows[r], 0);
      if (cell(rows[r], 2) && !/\$/.test(cell(rows[r], 2))) species = cell(rows[r], 2);
      const grade = cell(rows[r], 3);
      if (!grade || moneyOf(grade) != null) continue;
      for (const col of filled) {
        const price = moneyOf(cell(rows[r], col.index));
        if (price == null) continue;
        const value: MiragePrice = {
          price,
          construction: col.construction,
          width: col.width,
          lengths: col.lengths,
          species,
          collection,
          grade,
        };
        put(`${normKey(collection)}|${normKey(grade)}|${normKey(col.construction)}|${widthKey(col.width)}`, value);
      }
    }
  }

  const out: Built[] = [];
  let sectionSpecies = "";
  for (let i = colorAt; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (cell(row, 0) && /brushed|traditional|cashmere|dura/i.test(cell(row, 0)) && row.some((c) => /trubalance|classic|lock/i.test(c))) {
      sectionSpecies = cell(row, 0).replace(/\s+/g, " ").trim();
    }
    if (!row.some((c) => /^colors$/i.test(c.trim()))) continue;
    const widths = rows[i - 2] ?? rows[i - 1] ?? [];
    const consRow = rows[i - 4] ?? rows[i - 3] ?? [];
    let construction = "";
    const columns: { index: number; construction: string; width: string; lengths: string }[] = [];
    for (let c = 3; c < 17; c++) {
      if (cell(consRow, c)) construction = cell(consRow, c);
      const width = cell(widths, c);
      if (!width) continue;
      columns.push({
        index: c,
        construction: construction || cell(consRow, c),
        width,
        lengths: cell(row, c),
      });
    }
    let collection = "";
    let grade = "";
    for (let r = i + 1; r < rows.length; r++) {
      const data = rows[r] ?? [];
      if (blank(data)) break;
      if (/^\*/.test(cell(data, 0)) || /^colors$/i.test(cell(data, 2))) break;
      if (cell(data, 0) && /brushed|traditional|cashmere|packaging/i.test(cell(data, 0)) && !cell(data, 2)) break;
      if (cell(data, 0)) collection = cell(data, 0);
      if (cell(data, 1)) grade = cell(data, 1);
      const color = cell(data, 2);
      if (!color || !collection || !grade) continue;
      for (const col of columns) {
        const sku = cell(data, col.index);
        if (!/^\d{4,}$/.test(sku)) continue;
        const key = `${normKey(collection)}|${normKey(grade)}|${normKey(col.construction)}|${widthKey(col.width)}`;
        let found = prices.get(key);
        if (!found && normKey(collection) === "escape" && normKey(grade) === "traditional") {
          found = prices.get(`lakeside|${normKey(grade)}|${normKey(col.construction)}|${widthKey(col.width)}`);
        }
        if (!found) continue;
        out.push({
          name: `Mirage ${collection} ${grade} — ${color} — ${col.construction} ${col.width}`,
          category: "hardwood",
          unit: "sqft",
          sku,
          material_rate: found.price,
          manufacturer: "Mirage",
          style: `${collection} ${grade}`,
          color,
          notes: notesJoin([
            sectionSpecies,
            found.species && found.species !== sectionSpecies ? found.species : null,
            col.lengths || found.lengths || null,
            "Effective February 3, 2025",
            found.collection.toLowerCase() === "lakeside" && collection.toLowerCase() !== "lakeside"
              ? "Priced on the Lakeside line."
              : null,
          ]),
        });
      }
    }
  }
  return uniquify(out.map(toRow));
}

interface Template {
  description: string;
  price: number;
  unit: string;
  sizeKey: string;
  style: string;
}

interface PriceGroup {
  priceCol: number;
  unit: string;
  start: number;
  header: string[];
}

function isPriceHeaderCell(raw: string): boolean {
  const t = raw.trim();
  if (!t || t.length > 42) return false;
  if (/price\s*ref/i.test(t)) return false;
  return /\bprice\b/i.test(t);
}

function unitFromHeader(raw: string): string {
  const t = raw.toLowerCase();
  if (/box/.test(t)) return "box";
  if (/\bsy\b|sq\.?\s*yd/.test(t)) return "sqyd";
  if (/\bsf\b|sq\.?\s*ft/.test(t)) return "sqft";
  if (/\blf\b|linear/.test(t)) return "lnft";
  if (/each|piece/.test(t)) return "each";
  return "";
}

function sizeKey(raw: string): string {
  const t = raw.replace(/[“”]/g, '"');
  const m = t.match(/(\d+(?:\s+\d\/\d+)?(?:\.\d+)?)\s*["']?\s*[x×]\s*(\d+(?:\s+\d\/\d+)?(?:\.\d+)?)/i);
  if (!m) return "";
  return `${m[1].replace(/\s+/g, "")}x${m[2].replace(/\s+/g, "")}`.toLowerCase();
}

function groupsFrom(header: string[]): PriceGroup[] {
  const cols: number[] = [];
  header.forEach((h, i) => {
    if (isPriceHeaderCell(h)) cols.push(i);
  });
  return cols.map((priceCol, index) => ({
    priceCol,
    unit: unitFromHeader(header[priceCol] ?? ""),
    start: index === 0 ? 0 : cols[index - 1] + 1,
    header,
  }));
}

function headerHit(header: string[], start: number, end: number, test: RegExp): number {
  for (let i = start; i < end; i++) if (test.test(header[i] ?? "")) return i;
  return -1;
}

function isOrderLine(text: string): boolean {
  return /full carton|how to order|non-standard|non standard|custom color|overrun|pricing will|no standard|select a product|to create a custom|dropped|not available|lead time|discontinued|see color|color chart/i.test(
    text,
  );
}

function cleanDesc(raw: string): string {
  return raw
    .replace(/\s*\(see color table[\s\S]*$/i, "")
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/(\)|[A-Za-z])\d+(?:\s+\d+)*\s*$/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function tarkettCategory(section: string, name: string, unit: string): string {
  const product = name.toLowerCase();
  const blob = `${section} ${name}`.toLowerCase();
  // The product name wins. A leftover section such as "Underlayment" must not
  // recategorize a vinyl tile that happens to be listed after it.
  if (/wall\s*base|cove|mould|mold|reducer|nosing|stair|tread|transition|\bcap\b|trim/.test(product))
    return "trim";
  if (/lvt|latitude|plank/.test(product)) return "lvp";
  if (/vct|\btile\b/.test(product)) return "tile";
  if (/adhesive|primer|patch|level|underlayment|surestart/.test(product)) return "underlayment";
  if (unit === "sqyd" || /sheet|\biq\b|linoleum|heterogeneous|\brolls?\b/.test(product)) return "vinyl";
  if (unit === "lnft" || unit === "each") return "trim";
  if (/adhesive|primer|patch|underlayment|surestart/.test(blob)) return "underlayment";
  if (/vct|\btile\b/.test(blob)) return "tile";
  return "vinyl";
}

function uomUnit(raw: string, fallback: string): string {
  const t = raw.toLowerCase();
  if (/\bsy\b|sq\.?\s*yd/.test(t)) return "sqyd";
  if (/\bsf\b|sq\.?\s*ft/.test(t)) return "sqft";
  if (/\blf\b|linear/.test(t)) return "lnft";
  if (/\bea\b|each/.test(t)) return "each";
  if (/box|ctn|carton/.test(t)) return "box";
  return fallback || "each";
}

function parseTarkett(rows: string[][]): PriceRow[] {
  const out: Built[] = [];
  const templates: Template[] = [];
  let family = "";
  let section = "";
  let sectionAt = -1;
  let groups: PriceGroup[] | null = null;
  let quiet = 0;
  let banner = "";
  let color: { sku: number; color: number; size: number; stock: number } | null = null;
  let matrix: { collection: number; color: number; saps: { index: number; size: string; roll: boolean }[] } | null = null;
  let stickyCollection = "";
  let stickyColor = "";

  const add = (item: Built) => {
    if (!(item.material_rate > 0) || !item.name.trim()) return;
    out.push(item);
  };

  const remember = (item: Omit<Template, "style"> & { style?: string }) => {
    templates.push({ ...item, style: item.style || cleanDesc(item.description) });
  };

  const emitPriceGroups = (row: string[]) => {
    if (!groups) return false;
    let hit = false;
    for (const group of groups) {
      const price = moneyOf(cell(row, group.priceCol));
      if (price == null) continue;
      hit = true;
      const header = group.header;
      const end = group.priceCol;
      const descCol = headerHit(header, group.start, end, /description|format|pattern|profile|design|adhesive|^item$|^type$/i);
      const skuCol = headerHit(header, group.start, end, /^(sku|sap#|item)$|sap part number|product code/i);
      const sizeCol = headerHit(header, group.start, end, /dimension|tile size|^size$/i);
      const thickCol = headerHit(header, group.start, end, /^thickness$|^height$/i);
      const widthCol = headerHit(header, group.start, end, /^width$/i);
      const lengthCol = headerHit(header, group.start, end, /^length$/i);
      const coverCol = headerHit(header, group.start, end, /sf\/|square feet|sf per|feet per/i);
      const uomCol = headerHit(header, group.start, end, /^uom$|unit of measure|unit size/i);
      let description = descCol >= 0 ? cleanDesc(cell(row, descCol)) : "";
      const skuRaw = skuCol >= 0 ? cell(row, skuCol) : "";
      let dimension = sizeCol >= 0 ? cell(row, sizeCol) : "";
      const thick = thickCol >= 0 ? cell(row, thickCol) : "";
      if (thick && !dimension.toLowerCase().includes(thick.toLowerCase())) {
        dimension = dimension ? `${dimension}, ${thick}` : thick;
      }
      if (!sizeKey(dimension) && widthCol >= 0 && lengthCol >= 0) {
        const width = cell(row, widthCol);
        const length = cell(row, lengthCol);
        if (width && length) {
          const sized = `${width} x ${length}`;
          dimension =
            thick && !sized.toLowerCase().includes(thick.toLowerCase()) ? `${sized}, ${thick}` : sized;
        }
      }
      const shared = group.start > 0 ? cleanDesc(cell(row, 0)) : "";
      if (!description) description = shared;
      else if (shared && group.start > 0 && !description.toLowerCase().includes(shared.toLowerCase()))
        description = `${shared} ${description}`;
      let orderNote: string | null = null;
      const order = description.match(/^(.*?)\s+-\s+(full (?:cartons?|rolls?)(?:\s+only)?)\s*$/i);
      if (order) {
        description = order[1].trim();
        orderNote = order[2];
      }
      const skuFoot = skuRaw.match(/^(\d{5,})\s+(\d+)$/);
      // "MW XX X62" is the printed color-slot code. Only a numeric code ending in XXX is a template.
      const sku = (skuFoot ? skuFoot[1] : skuRaw).replace(/\s+/g, " ").trim();
      const headerUnit = group.header[group.priceCol] ?? "";
      const lfFor = headerUnit.match(/lf price for\s+([a-z0-9-]+)/i);
      let unit = group.unit || uomUnit(uomCol >= 0 ? cell(row, uomCol) : "", "");
      if (lfFor && `${description} ${sku}`.toLowerCase().includes(lfFor[1].toLowerCase())) unit = "lnft";
      const sized = sizeKey(dimension) || sizeKey(description);
      const placeholder = /X{3,}/.test(skuRaw) || /see color table/i.test(cell(row, descCol));
      const style = cleanDesc(description).replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
      remember({
        description,
        price,
        unit: unit || "each",
        sizeKey: sized,
        style,
      });
      if (placeholder) continue;
      const heads = [family, section].filter(
        (part, index, all) =>
          Boolean(part) &&
          all.indexOf(part) === index &&
          !`${description} ${dimension}`.toLowerCase().includes(part.toLowerCase()),
      );
      const bits = [...heads, description, dimension].filter(Boolean);
      add({
        name: `Tarkett ${bits.join(" — ")}`,
        category: tarkettCategory(section, description, unit || "each"),
        unit: unit || uomUnit("", "each"),
        sku: looksLikeCode(sku) ? sku : null,
        material_rate: price,
        manufacturer: "Tarkett",
        style: style || null,
        color: null,
        notes: notesJoin([
          section,
          orderNote,
          coverCol >= 0 && cell(row, coverCol) ? `${cell(row, coverCol)} per carton` : null,
          skuFoot ? "Order minimum applies as of 4/01/2026." : null,
        ]),
      });
    }
    return hit;
  };

  const matchingTemplates = (size: string): Template[] => {
    const b = banner.toLowerCase();
    let pool = templates.filter((t) => /vct|latitude|lvt|quartz|slip|solid/i.test(t.description));
    if (b.includes("standard vct") && !b.includes("premium")) pool = pool.filter((t) => /standard vct/i.test(t.description));
    else if (b.includes("quartz")) pool = pool.filter((t) => /quartz/i.test(t.description));
    else if (b.includes("slip")) pool = pool.filter((t) => /slip/i.test(t.description));
    else if (b.includes("solid")) pool = pool.filter((t) => /premium solid|solid color/i.test(t.description));
    else if (b.includes("lvt")) pool = pool.filter((t) => /latitude/i.test(t.description));
    else return [];
    if (size) {
      const sized = pool.filter((t) => t.sizeKey === size);
      if (sized.length) pool = sized;
    }
    return pool;
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (blank(row)) continue;
    const text = rowText(row);
    if (/^available colors for/i.test(text)) {
      banner = text;
      color = null;
      matrix = null;
      groups = null;
      continue;
    }
    if (
      row.filter((c) => c.trim()).length === 1 &&
      text.length < 70 &&
      !/^note\b/i.test(text) &&
      !text.startsWith("(") &&
      !/^\d/.test(text) &&
      !/\$/.test(text) &&
      !isOrderLine(text)
    ) {
      if (section && i - sectionAt < 4 && section !== text) family = section;
      else family = "";
      section = text;
      sectionAt = i;
    }
    const headerPrices = groupsFrom(row);
    if (headerPrices.length && row.some((c) => /sku|description|format|product code|sap|pattern|type|item/i.test(c))) {
      groups = headerPrices;
      color = null;
      matrix = null;
      quiet = 0;
      continue;
    }
    if (row.some((c) => /color description/i.test(c)) && row.some((c) => /sap part number/i.test(c))) {
      color = {
        sku: row.findIndex((c) => /sap part number/i.test(c)),
        color: row.findIndex((c) => /color description/i.test(c)),
        size: row.findIndex((c) => /^size$/i.test(c.trim())),
        stock: row.findIndex((c) => /stock loc/i.test(c)),
      };
      matrix = null;
      groups = null;
      continue;
    }
    if (row.some((c) => /^collection$/i.test(c.trim())) && row.some((c) => /^color$/i.test(c.trim())) && row.some((c) => /sap part/i.test(c))) {
      const saps: { index: number; size: string; roll: boolean }[] = [];
      row.forEach((raw, index) => {
        if (!/sap part/i.test(raw) || /weld/i.test(raw)) return;
        const sized = sizeKey(raw);
        saps.push({ index, size: sized, roll: !sized });
      });
      matrix = {
        collection: row.findIndex((c) => /^collection$/i.test(c.trim())),
        color: row.findIndex((c) => /^color$/i.test(c.trim())),
        saps,
      };
      color = null;
      groups = null;
      stickyCollection = "";
      stickyColor = "";
      continue;
    }
    if (groups) {
      if (emitPriceGroups(row)) quiet = 0;
      else quiet += 1;
      if (quiet >= 12) groups = null;
      continue;
    }
    if (color && /^\d{5,}/.test(cell(row, color.sku))) {
      const skuRaw = cell(row, color.sku);
      const skuFoot = skuRaw.match(/^(\d{5,})\s+(\d+)$/);
      const sku = skuFoot ? skuFoot[1] : skuRaw.replace(/\s+/g, "");
      const colorName = cell(row, color.color);
      const size = color.size >= 0 ? sizeKey(cell(row, color.size)) : "";
      const pool = matchingTemplates(size);
      if (!pool.length || !colorName) continue;
      const samePrice = new Set(pool.map((t) => `${t.price}|${t.unit}`));
      const chosen = samePrice.size === 1 ? pool : pool.slice(0, 1);
      const styleSource = new Set(chosen.map((t) => t.style.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim()));
      const style = styleSource.size === 1 ? [...styleSource][0] : "iD Latitude";
      const price = chosen[0].price;
      const unit = chosen[0].unit;
      const stock = color.stock >= 0 ? cell(row, color.stock) : "";
      add({
        name: `Tarkett ${style} — ${colorName}${size ? ` — ${size}` : ""}`,
        category: tarkettCategory(section, style, unit),
        unit,
        sku,
        material_rate: price,
        manufacturer: "Tarkett",
        style,
        color: colorName,
        notes: notesJoin([
          chosen[0].description !== style ? chosen.map((t) => t.description).join(" / ") : null,
          size ? null : chosen[0].sizeKey || null,
          stock || null,
          skuFoot ? "Order minimum applies as of 4/01/2026." : null,
        ]),
      });
      continue;
    }
    if (matrix) {
      if (cell(row, matrix.collection)) stickyCollection = cell(row, matrix.collection);
      if (cell(row, matrix.color)) stickyColor = cell(row, matrix.color);
      if (!stickyCollection || !stickyColor || /^collection$/i.test(stickyCollection)) continue;
      for (const sap of matrix.saps) {
        const sku = cell(row, sap.index).replace(/\s+/g, "");
        if (!/^\d{5,}$/.test(sku)) continue;
        const match = templates.find((t) => {
          if (normKey(t.style) !== normKey(stickyCollection) && !normKey(t.description).includes(normKey(stickyCollection)))
            return false;
          if (sap.roll) return t.unit === "sqyd";
          return t.unit === "sqft" && t.sizeKey === sap.size;
        });
        if (!match) continue;
        add({
          name: `Tarkett ${stickyCollection} — ${stickyColor}${sap.roll ? "" : ` — ${sap.size}`}`,
          category: sap.roll ? "vinyl" : "tile",
          unit: match.unit,
          sku,
          material_rate: match.price,
          manufacturer: "Tarkett",
          style: stickyCollection,
          color: stickyColor,
          notes: sap.roll ? "Sheet" : null,
        });
      }
    }
  }

  const kept = out.filter((item) => {
    if (item.color) return true;
    if (/\d{5,}/.test(item.sku ?? "")) return true;
    const kids = out.filter(
      (other) =>
        other.color &&
        other.style === item.style &&
        other.unit === item.unit &&
        other.material_rate === item.material_rate &&
        /\d{5,}/.test(other.sku ?? ""),
    );
    return kids.length < 3;
  });
  return uniquify(kept.map(toRow));
}

function sheetBlob(sheet: OvfSheet, limit = 25): string {
  return sheet.rows
    .slice(0, limit)
    .map((row) => row.join(" "))
    .join("\n");
}

function parseOvfSheet(sheet: OvfSheet): PriceRow[] | null {
  if (/terms/i.test(sheet.name)) return null;
  const blob = sheetBlob(sheet, 40);
  const hasSpecies = sheet.rows.some((row) => row.some((c) => /species\s*\/\s*color/i.test(c)));
  if (hasSpecies && /inhaus|inspiration laminate|ceramin/i.test(`${sheet.name} ${blob}`))
    return parseInhaus(sheet.rows);
  if (hasSpecies) return parseHallmark(sheet.rows);
  if (/usa distributors\s*-\s*flooring price list/i.test(blob)) return parseMirage(sheet.rows);
  if (/sch[oö]nox/i.test(`${sheet.name} ${blob}`) && sheet.rows.some((row) => row.some((c) => /item\s*#/i.test(c))))
    return parseSchonox(sheet.rows);
  if (sheet.rows.some((row) => row.some((c) => /\$\s*\d/.test(c) && /\/\s*SF/i.test(c))))
    return parseQuickStep(sheet.rows);
  if (sheet.rows.some((row) => row.some((c) => isPriceHeaderCell(c)))) return parseTarkett(sheet.rows);
  return null;
}

/** Read an Ohio Valley workbook. Any other spreadsheet returns null so the column mapper still runs. */
export function parseOvfWorkbook(sheets: OvfSheet[]): OvfBook | null {
  const blob = sheets
    .map((sheet) => `${sheet.name}\n${sheetBlob(sheet, 12)}`)
    .join("\n");
  if (!/ohio valley|the floor king|usa distributors|sch[oö]nox/i.test(blob)) return null;
  const rows: PriceRow[] = [];
  let matched = false;
  for (const sheet of sheets) {
    const parsed = parseOvfSheet(sheet);
    if (!parsed?.length) continue;
    matched = true;
    rows.push(...parsed);
  }
  if (!matched) return null;
  return { rows: uniquify(rows), distributor: DISTRIBUTOR };
}
