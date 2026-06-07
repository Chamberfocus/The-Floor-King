// Structured catalog CSV: a clean template + a fast parser that skips the AI
// when a file already has recognizable column headers. Browser-safe (no deps).
import type { PriceRow } from "@/lib/extract";

/** The exact columns the catalog understands. First row of the template. */
export const CATALOG_TEMPLATE_HEADERS = [
  "name",
  "category",
  "manufacturer",
  "style",
  "color",
  "sku",
  "unit",
  "material_rate",
  "labor_rate",
  "notes",
] as const;

const CATEGORIES = [
  "carpet",
  "lvp",
  "hardwood",
  "laminate",
  "tile",
  "vinyl",
  "underlayment",
  "trim",
  "labor",
  "other",
];

/** A downloadable template with the right headers and one example row. */
export function buildCatalogTemplate(): string {
  const example = [
    "Coretec Plus HD",
    "lvp",
    "Shaw",
    "Coretec",
    "Honey Oak",
    "VV031-01",
    "sqft",
    "3.50",
    "2.00",
    "7yr warranty",
  ];
  return (
    CATALOG_TEMPLATE_HEADERS.join(",") +
    "\n" +
    example.map(csvCell).join(",") +
    "\n"
  );
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Parse one delimited line, honoring quotes. */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Header synonyms → our canonical column key.
const HEADER_MAP: Record<string, string> = {};
const addSyn = (key: string, syns: string[]) =>
  syns.forEach((s) => (HEADER_MAP[norm(s)] = key));
addSyn("name", ["name", "product", "productname", "item", "itemname", "description", "product description"]);
addSyn("category", ["category", "type", "producttype", "flooringtype"]);
addSyn("manufacturer", ["manufacturer", "mfg", "brand", "vendor", "supplier", "make"]);
addSyn("style", ["style", "stylename", "pattern", "collection", "series"]);
addSyn("color", ["color", "colour", "colorname", "shade", "finish"]);
addSyn("sku", ["sku", "item", "itemno", "itemnumber", "itemnum", "partno", "partnumber", "stylenumber", "styleno", "stylenum"]);
addSyn("unit", ["unit", "uom", "unitofmeasure", "priceper"]);
addSyn("material_rate", ["materialrate", "material", "materialprice", "materialcost", "cost", "price", "unitprice", "yourcost", "matrate", "msrp"]);
addSyn("labor_rate", ["laborrate", "labor", "labour", "laborprice", "laborcost", "install", "installrate", "installprice"]);
addSyn("notes", ["notes", "note", "comments", "comment", "remarks"]);

function mapCategory(v: string): string {
  const n = norm(v);
  if (!n) return "other";
  if (CATEGORIES.includes(n)) return n;
  if (/(lvp|lvt|luxuryvinylplank|vinylplank|rigidcore|spc|wpc)/.test(n)) return "lvp";
  if (/sheetvinyl/.test(n)) return "vinyl";
  if (/(carpet|broadloom)/.test(n)) return "carpet";
  if (/(hardwood|wood|engineered)/.test(n)) return "hardwood";
  if (/laminate/.test(n)) return "laminate";
  if (/(tile|ceramic|porcelain)/.test(n)) return "tile";
  if (/vinyl/.test(n)) return "vinyl";
  if (/(underlayment|pad|cushion)/.test(n)) return "underlayment";
  if (/(trim|molding|moulding|transition|baseboard)/.test(n)) return "trim";
  if (/(labor|labour|install)/.test(n)) return "labor";
  return "other";
}

function toNum(v: string): number | null {
  if (!v) return null;
  const n = parseFloat(v.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * If `text` looks like a structured spreadsheet (a header row we recognize,
 * including a name column), parse it directly into rows — no AI needed.
 * Returns null if it isn't structured, so the caller can fall back to AI.
 */
export function parseStructuredRows(text: string): PriceRow[] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return null;

  const delim = lines[0].includes("\t") && !lines[0].includes(",") ? "\t" : ",";
  const headerCells = splitLine(lines[0], delim);
  const cols = headerCells.map((h) => HEADER_MAP[norm(h)] ?? null);
  if (!cols.includes("name")) return null; // not a recognizable header row

  const idx = (key: string) => cols.indexOf(key);
  const iName = idx("name");
  const rows: PriceRow[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = splitLine(lines[r], delim);
    const get = (key: string) => {
      const i = idx(key);
      return i >= 0 ? (cells[i] ?? "").trim() : "";
    };
    const name = (cells[iName] ?? "").trim();
    if (!name) continue;
    rows.push({
      name,
      category: mapCategory(get("category")),
      unit: get("unit") || "sqft",
      sku: get("sku") || null,
      material_rate: toNum(get("material_rate")),
      labor_rate: toNum(get("labor_rate")),
      manufacturer: get("manufacturer") || null,
      style: get("style") || null,
      color: get("color") || null,
      notes: get("notes") || null,
    });
  }
  return rows.length ? rows : null;
}
