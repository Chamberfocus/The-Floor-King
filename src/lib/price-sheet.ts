/**
 * A flooring price sheet, read down to the only fields that change per color.
 *
 * From the file: style, color, cut price, and roll price when the sheet has a
 * separate roll column. Manufacturer, distributor, category, unit, and the
 * specs that apply to every color are supplied by the person uploading the
 * list — a price book is one material from one mill, bought from one place.
 */
import { foldCatalogColor } from "@/lib/catalog-identity";
import { parseColorMatrix, parseStructuredRows } from "@/lib/catalog-csv";
import type { PriceRow } from "@/lib/extract";

export interface PriceSheetLine {
  style: string;
  color: string;
  styleNumber: string | null;
  colorNumber: string | null;
  /** Cut price, or the only price when the sheet does not split cut and roll. */
  cutPrice: number;
  /** Full-roll price. Null when the sheet has no separate roll column. */
  rollPrice: number | null;
}

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

type Field =
  | "styleName"
  | "styleNumber"
  | "colorName"
  | "colorNumber"
  | "cut"
  | "roll"
  | "price"
  | "skip";

const HEADER_PHRASES: [string, Field][] = [
  ["style name", "styleName"],
  ["style number", "styleNumber"],
  ["style no", "styleNumber"],
  ["style num", "styleNumber"],
  ["style #", "styleNumber"],
  ["stylename", "styleName"],
  ["styleno", "styleNumber"],
  ["stylenumber", "styleNumber"],
  ["pattern name", "styleName"],
  ["collection name", "styleName"],
  ["color name", "colorName"],
  ["colour name", "colorName"],
  ["colorway", "colorName"],
  ["color number", "colorNumber"],
  ["colour number", "colorNumber"],
  ["color no", "colorNumber"],
  ["colour no", "colorNumber"],
  ["color num", "colorNumber"],
  ["color #", "colorNumber"],
  ["colour #", "colorNumber"],
  ["color code", "colorNumber"],
  ["colour code", "colorNumber"],
  ["cut price", "cut"],
  ["cut order", "cut"],
  ["cut length", "cut"],
  ["cut yd", "cut"],
  ["cut yard", "cut"],
  ["cut sy", "cut"],
  ["price per yard", "cut"],
  ["roll price", "roll"],
  ["full roll", "roll"],
  ["your cost", "price"],
  ["your price", "price"],
  ["dealer price", "price"],
  ["dealer net", "price"],
  ["dealer cost", "price"],
  ["net price", "price"],
  ["unit cost", "price"],
  ["carton price", "price"],
  ["box price", "price"],
  ["product name", "styleName"],
  ["product number", "styleNumber"],
  ["product no", "styleNumber"],
  ["product #", "styleNumber"],
  ["product code", "styleNumber"],
  ["color description", "colorName"],
  ["style", "styleName"],
  ["pattern", "styleName"],
  ["collection", "styleName"],
  ["series", "styleName"],
  ["product", "styleName"],
  ["description", "colorName"],
  ["color", "colorName"],
  ["colour", "colorName"],
  ["shade", "colorName"],
  ["sku", "styleNumber"],
  ["item", "styleNumber"],
  ["item no", "styleNumber"],
  ["item #", "styleNumber"],
  ["cut", "cut"],
  ["cuts", "cut"],
  ["roll", "roll"],
  ["rolls", "roll"],
  ["price", "price"],
  ["cost", "price"],
  ["net", "price"],
];

const SKIP_WORDS = new Set([
  "per",
  "sy",
  "sf",
  "sq",
  "yd",
  "yard",
  "yards",
  "each",
  "ea",
  "usd",
  "$",
  "/",
]);

/** Columns that are not our cost. Skipped so a real cut/roll header still matches. */
const IGNORE_PHRASES = [
  "suggested retail",
  "retail price",
  "list price",
  "street price",
  "msrp",
  "retail",
  "suggested",
  "margin",
];

function clusterRows(items: PdfTextItem[]): PdfTextItem[][] {
  const usable = items.filter((it) => it.str && it.str.trim());
  if (!usable.length) return [];
  const sorted = [...usable].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: PdfTextItem[][] = [];
  for (const it of sorted) {
    const h = it.height > 0 ? it.height : 8;
    const tol = Math.max(2, h * 0.45);
    const last = groups[groups.length - 1];
    const anchor = last?.[0];
    if (anchor && Math.abs(anchor.y - it.y) <= Math.max(tol, (anchor.height || h) * 0.45)) {
      last.push(it);
    } else {
      groups.push([it]);
    }
  }
  return groups;
}

/** Words that sit close together are one cell. A wide gap is the next column. */
function gapCells(row: PdfTextItem[]): PdfTextItem[][] {
  const cells = [...row].sort((a, b) => a.x - b.x);
  const groups: PdfTextItem[][] = [];
  let prev: PdfTextItem | null = null;
  for (const c of cells) {
    let split = false;
    if (prev) {
      const prevWidth =
        prev.width > 0 ? prev.width : prev.str.length * Math.max(prev.height, 8) * 0.5;
      const gap = c.x - (prev.x + prevWidth);
      const h = Math.max(prev.height, c.height, 8);
      split = gap > Math.max(10, h * 1.15);
    }
    if (split || !groups.length) groups.push([]);
    groups[groups.length - 1].push(c);
    prev = c;
  }
  return groups;
}

function cellText(group: PdfTextItem[]): string {
  return group
    .map((c) => c.str)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Join cells with tabs. Leading tabs stay — they are empty columns. */
function lineFromCells(texts: string[]): string {
  return texts.join("\t").replace(/[ \t]+$/g, "");
}

/**
 * Rebuild visual rows from PDF text items.
 * Once a style/color/price header is found, later rows are aligned to those
 * column positions, so a blank style cell stays blank instead of shifting the
 * color into the style column.
 */
export function pdfItemsToLines(items: PdfTextItem[]): string[] {
  const rows = clusterRows(items);
  const lines: string[] = [];
  let anchors: number[] | null = null;

  for (const row of rows) {
    const groups = gapCells(row);
    const texts = groups.map(cellText);
    const gapLine = lineFromCells(texts);
    const header = headerColumns(gapLine);
    if (header && texts.length === header.length) {
      anchors = groups.map((g) => g[0].x);
      lines.push(gapLine);
      continue;
    }
    if (anchors && anchors.length >= 2) {
      const assigned = Array.from({ length: anchors.length }, () => "");
      for (const it of [...row].sort((a, b) => a.x - b.x)) {
        let idx = 0;
        for (let i = 0; i < anchors.length; i++) {
          if (it.x + 6 >= anchors[i]) idx = i;
        }
        const piece = it.str.trim();
        if (!piece) continue;
        assigned[idx] = assigned[idx] ? `${assigned[idx]} ${piece}` : piece;
      }
      const aligned = lineFromCells(assigned);
      if (aligned.replace(/\t/g, "").trim()) lines.push(aligned);
      continue;
    }
    const plain = texts.join(" ").replace(/\s+/g, " ").trim();
    if (plain) lines.push(plain);
  }
  return lines;
}

function isNoise(line: string): boolean {
  const t = line.trim();
  if (t.length < 2) return true;
  if (/^page\s+\d+/i.test(t)) return true;
  if (/^\d+\s*(?:of|\/)\s*\d+$/i.test(t)) return true;
  if (
    /^(effective|prices?\s+effective|confidential|continued|all rights|copyright|freight|f\.?o\.?b|terms|phone|fax|www\.|https?:)/i.test(
      t,
    )
  )
    return true;
  if (/dealer\s+price\s+list|price\s+list|suggested\s+retail|price\s+guide/i.test(t)) return true;
  return false;
}

function normalizeHeader(line: string): string {
  return line
    .toLowerCase()
    .replace(/[$]/g, " ")
    .replace(/[/|]+/g, " ")
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** One header cell: the price column it is, or "skip" for width, weight, retail, and the rest. */
function classifyHeaderCell(cell: string): Field {
  const words = normalizeHeader(cell).split(" ").filter(Boolean);
  while (words.length > 1 && SKIP_WORDS.has(words[words.length - 1])) words.pop();
  const phrase = words.join(" ");
  if (!phrase) return "skip";
  if (IGNORE_PHRASES.some((p) => phrase === p || phrase.startsWith(`${p} `))) return "skip";
  let best: { len: number; field: Field } | null = null;
  for (const [p, field] of HEADER_PHRASES) {
    if (phrase === p || phrase.startsWith(`${p} `)) {
      if (!best || p.length > best.len) best = { len: p.length, field };
    }
  }
  return best?.field ?? "skip";
}

/**
 * A tab- or gap-separated header. Extra columns (width, fiber, retail) stay in
 * place as "skip" so the cut and roll prices don't slide into the wrong cell.
 */
function headerFromCells(cells: string[]): Field[] | null {
  const usable = cells.map((c) => c.trim());
  if (usable.length < 2 || usable.length > 16) return null;
  const moneyish = usable.filter((c) => /^\$?\s*\d+(?:\.\d+)?\s*$/.test(c.replace(/,/g, ""))).length;
  if (moneyish > 0) return null;
  const fields = usable.map(classifyHeaderCell);
  const hasColor = fields.includes("colorName") || fields.includes("colorNumber");
  const hasPrice = fields.includes("cut") || fields.includes("roll") || fields.includes("price");
  const named = fields.filter((f) => f !== "skip").length;
  if (!hasColor || !hasPrice || named < 2) return null;
  return fields;
}

/** Match a header line to columns. Null when it is not a style/color/price header. */
function headerColumns(line: string): Field[] | null {
  const cells = line.includes("\t")
    ? line.split("\t")
    : /\s{2,}/.test(line)
      ? line.split(/\s{2,}/)
      : null;
  if (cells && cells.filter((c) => c.trim()).length >= 2) {
    const fromCells = headerFromCells(cells);
    if (fromCells) return fromCells;
  }
  const words = normalizeHeader(line).split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 18) return null;
  const fields: Field[] = [];
  let i = 0;
  while (i < words.length) {
    const rest = words.slice(i).join(" ");
    const ignored = IGNORE_PHRASES.find((p) => rest === p || rest.startsWith(p + " "));
    if (ignored) {
      i += ignored.split(" ").length;
      continue;
    }
    let matched: [string, Field] | null = null;
    for (const phrase of HEADER_PHRASES) {
      if (rest === phrase[0] || rest.startsWith(phrase[0] + " ")) {
        matched = phrase;
        break;
      }
    }
    if (matched) {
      fields.push(matched[1]);
      i += matched[0].split(" ").length;
      continue;
    }
    if (SKIP_WORDS.has(words[i])) {
      i += 1;
      continue;
    }
    return null;
  }
  const hasColor = fields.includes("colorName") || fields.includes("colorNumber");
  const hasPrice = fields.includes("cut") || fields.includes("roll") || fields.includes("price");
  if (!hasColor || !hasPrice) return null;
  return fields;
}

function splitCells(line: string): string[] | null {
  if (line.includes("\t")) {
    return line.split("\t").map((s) => s.trim());
  }
  if (/\s{2,}/.test(line)) {
    return line.split(/\s{2,}/).map((s) => s.trim());
  }
  return null;
}

function moneyCell(cell: string): number | null {
  const t = cell.trim();
  if (!t || /^(-|—|–|n\/?a|call|tbd|\.)$/i.test(t)) return null;
  const nums = t.replace(/,/g, "").match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length !== 1) return null;
  if (/^20\d{2}$/.test(nums[0])) return null;
  const n = parseFloat(nums[0]);
  if (!Number.isFinite(n) || n <= 0 || n >= 100000) return null;
  return Math.round(n * 100) / 100;
}

function styleFromLabeledLine(line: string): { style: string; styleNumber: string | null } | null {
  const t = line.trim();
  const labeled = t.match(
    /^(?:style|pattern|collection|series)(?:\s+name)?\s*[:\-–]\s*(.+)$/i,
  );
  if (!labeled) {
    const numOnly = t.match(
      /^(?:style\s*(?:no|num|number|#)|sku|item\s*#)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9./-]{1,20})\s*$/i,
    );
    if (!numOnly) return null;
    return { style: "", styleNumber: numOnly[1] };
  }
  return splitStyleAndNumber(labeled[1]);
}

function splitStyleAndNumber(raw: string): { style: string; styleNumber: string | null } {
  let s = raw.trim();
  let num: string | null = null;
  const hash = s.match(/\bstyle\s*#\s*([A-Za-z0-9][A-Za-z0-9./-]*)/i);
  if (hash) {
    num = hash[1];
    s = s.replace(hash[0], " ");
  }
  const paren = s.match(/\(([A-Za-z0-9]*\d[A-Za-z0-9./-]*)\)\s*$/);
  if (paren && paren.index != null) {
    num = num ?? paren[1];
    s = s.slice(0, paren.index);
  }
  s = s.replace(/\s+/g, " ").replace(/[\s\-–:,]+$/g, "").trim();
  return { style: s, styleNumber: num };
}

function looksLikeStyleBanner(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 48) return false;
  if (headerColumns(t)) return false;
  if (isNoise(t)) return false;
  if (/[.!?]/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 5) return false;
  const letters = t.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3;
}

function blankToNull(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t || null;
}

/**
 * Pull one row per color. Returns null when the text does not look like a
 * style / color / price sheet, so the caller can try another reader.
 */
export function parsePriceSheet(text: string): PriceSheetLine[] | null {
  // Keep leading tabs. They are empty cells, and trimming them shifts the
  // color into the style column on a continued row.
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[ ]+/, "").replace(/[ \t]+$/g, ""))
    .filter((l) => l.replace(/\t/g, "").trim().length > 0);
  if (lines.length < 2) return null;

  const out: PriceSheetLine[] = [];
  let columns: Field[] | null = null;
  let style = "";
  let styleNumber: string | null = null;
  type Banner = { style: string; styleNumber: string | null };
  let pendingBanner: Banner | null = null;

  const rememberBanner = (current: Banner | null, labeled: Banner): Banner => ({
    style: labeled.style || current?.style || "",
    styleNumber: labeled.styleNumber ?? current?.styleNumber ?? null,
  });

  for (const line of lines) {
    if (isNoise(line)) {
      pendingBanner = null;
      continue;
    }

    const labeled = styleFromLabeledLine(line);
    if (labeled && !splitCells(line)) {
      pendingBanner = rememberBanner(pendingBanner, labeled);
      // A labeled style line is the style, even before we see the header.
      if (labeled.style) style = labeled.style;
      if (labeled.styleNumber) styleNumber = labeled.styleNumber;
      continue;
    }

    const header = headerColumns(line);
    if (header) {
      columns = header;
      if (pendingBanner?.style) style = pendingBanner.style;
      if (pendingBanner?.styleNumber) styleNumber = pendingBanner.styleNumber;
      pendingBanner = null;
      continue;
    }

    if (!columns) {
      if (looksLikeStyleBanner(line) && !splitCells(line)) {
        const split = splitStyleAndNumber(line);
        pendingBanner = {
          style: split.style || line.trim(),
          styleNumber: split.styleNumber,
        };
      }
      continue;
    }

    const cells = splitCells(line);
    if (!cells) {
      // A style printed on its own line under a header applies to the colors below.
      if (looksLikeStyleBanner(line)) {
        const split = splitStyleAndNumber(line.trim());
        if (split.style) style = split.style;
        if (split.styleNumber) styleNumber = split.styleNumber;
      }
      continue;
    }
    // A repeated header, or a line that is only column titles.
    if (headerColumns(cells.join(" "))) continue;

    const at = (field: Field) => {
      const i = columns!.indexOf(field);
      return i >= 0 ? (cells[i] ?? "").trim() : "";
    };

    const rowStyle = at("styleName");
    const rowStyleNo = at("styleNumber");
    if (rowStyle) style = rowStyle;
    if (rowStyleNo) styleNumber = rowStyleNo;
    if (!rowStyle && !rowStyleNo && pendingBanner) {
      if (pendingBanner.style) style = pendingBanner.style;
      if (pendingBanner.styleNumber) styleNumber = pendingBanner.styleNumber;
      pendingBanner = null;
    }

    const colorName = at("colorName");
    const colorCode = at("colorNumber");
    const color = colorName || colorCode;
    if (!color || /^(color|colour|total|subtotal|style)$/i.test(color)) continue;

    const cutCell = at("cut");
    const rollCell = at("roll");
    const priceCell = at("price");
    let cut = moneyCell(cutCell);
    let roll: number | null = columns.includes("roll") ? moneyCell(rollCell) : null;
    if (cut == null && columns.includes("price")) cut = moneyCell(priceCell);
    // A sheet with only a roll column: that figure is the price, not a second tier.
    if (cut == null && roll != null && !columns.includes("cut") && !columns.includes("price")) {
      cut = roll;
      roll = null;
    }
    if (cut == null) continue;
    if (!columns.includes("roll")) roll = null;

    out.push({
      style: style || rowStyle,
      color,
      styleNumber: blankToNull(rowStyleNo) ?? styleNumber,
      colorNumber: colorName ? blankToNull(colorCode) : null,
      cutPrice: cut,
      rollPrice: roll,
    });
  }

  return out.length ? out : null;
}

/** The catalog name for one color: the style, then the color, said once. */
export function priceSheetProductName(style: string, color: string): string {
  const s = style.trim();
  const c = color.trim();
  if (!s) return c;
  if (!c) return s;
  if (s.toLowerCase() === c.toLowerCase()) return s;
  if (s.toLowerCase().includes(c.toLowerCase())) return s;
  return `${s} — ${c}`;
}

/** Turn parsed colors into catalog rows. Shared facts are applied separately. */
export function sheetLinesToPriceRows(lines: PriceSheetLine[]): PriceRow[] {
  return lines.map((l) => {
    const folded = foldCatalogColor(l.color, l.colorNumber, null);
    const style = (l.style || l.styleNumber || "").trim();
    const color = (folded.color ?? "").trim();
    return {
      name: priceSheetProductName(style, color),
      category: "other",
      unit: "",
      sku: l.styleNumber,
      material_rate: l.cutPrice,
      roll_rate: l.rollPrice,
      labor_rate: null,
      manufacturer: null,
      style: style || null,
      color: folded.color,
      notes: folded.notes,
    };
  });
}

export interface SheetFacts {
  manufacturer: string;
  /** Who you order it from. Stored as the product's supplier / vendor. */
  distributor: string;
  category: string;
  unit: string;
  /** Optional note copied onto every color. */
  note: string;
}

/**
 * Stamp the answers that belong to the whole upload onto every color.
 * Idempotent: calling it twice does not stack the note or the manufacturer.
 */
export function applySheetFacts(
  rows: PriceRow[],
  facts: SheetFacts,
  opts: { lockCategory?: boolean } = {},
): PriceRow[] {
  const mfr = facts.manufacturer.trim();
  const cat = facts.category.trim();
  const unit = facts.unit.trim();
  const note = facts.note.trim();
  return rows.map((r) => {
    const next: PriceRow = { ...r };
    if (mfr) next.manufacturer = mfr;
    if (cat && (opts.lockCategory || !r.category || r.category === "other")) {
      next.category = cat;
    }
    if (unit && (opts.lockCategory || !r.unit)) next.unit = unit;
    const style = (r.style ?? "").trim();
    const color = (r.color ?? "").trim();
    if (opts.lockCategory && (style || color)) {
      next.name = priceSheetProductName(style, color);
    }
    if (note) {
      const existing = (r.notes ?? "").trim();
      if (!existing.toLowerCase().includes(note.toLowerCase())) {
        next.notes = existing ? `${existing} · ${note}` : note;
      }
    }
    return next;
  });
}

function textHasCutOrRollHeader(text: string): boolean {
  return text.split(/\r?\n/).some((line) => {
    const cols = headerColumns(line);
    return Boolean(cols?.includes("cut") || cols?.includes("roll"));
  });
}

/**
 * Read price-list text into catalog rows.
 * A cut/roll price sheet wins over a color-matrix book. A color matrix wins
 * over a loose style/color/price read. A normal spreadsheet is last.
 */
export function readPriceText(text: string): { rows: PriceRow[]; sheet: boolean } | null {
  const sheet = parsePriceSheet(text);
  const cutRoll = textHasCutOrRollHeader(text) || Boolean(sheet?.some((r) => r.rollPrice != null));
  if (sheet?.length && cutRoll) return { rows: sheetLinesToPriceRows(sheet), sheet: true };
  const matrix = parseColorMatrix(text);
  if (matrix?.length) return { rows: matrix, sheet: true };
  if (sheet?.length) return { rows: sheetLinesToPriceRows(sheet), sheet: true };
  const structured = parseStructuredRows(text);
  if (structured?.length) return { rows: structured, sheet: false };
  return null;
}
