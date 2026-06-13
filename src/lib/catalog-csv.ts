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

export function normUnit(v: string): string {
  const u = norm(v);
  if (!u) return "sqft";
  if (u.startsWith("sy") || u.includes("yd")) return "sqyd";
  if (u.includes("sf") || u.includes("sq")) return "sqft";
  if (u.includes("lf") || u.includes("lnft") || u.includes("linear")) return "lnft";
  if (u.startsWith("ea") || u === "each" || u === "pc" || u === "piece") return "each";
  return "sqft";
}

export function mapCategory(v: string): string {
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
  const H = splitLine(lines[0], delim).map(norm);

  // Find the column index whose header matches any of these normalized names.
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = H.indexOf(norm(n));
      if (i >= 0) return i;
    }
    return -1;
  };

  const iName = col("name", "productname", "product", "itemname", "itemdescription", "description", "productdescription");
  const iStyleName = col("stylename", "pattern", "collection", "series", "design");
  const iColorName = col("colorname", "colourname", "shade", "finish");
  const iStyleNum = col("style", "styleno", "stylenumber", "stylenum", "sku", "itemno", "itemnumber", "item", "partno", "partnumber", "productcode", "code");
  const iColorNum = col("color", "colour", "colorno", "colornumber", "colorcode");
  const iMfg = col("sellingcompanyname", "manufacturer", "mfg", "mfr", "brand", "vendor", "supplier", "make", "mill");
  const iCat = col("category", "prodtype", "producttype", "type", "flooringtype", "productcategory");
  const iUnit = col("unitofmeasure", "unit", "uom", "priceper", "sellunit");
  const iPrice = col("unitprice", "materialrate", "material", "materialprice", "materialcost", "cost", "price", "yourcost", "msrp", "unitcost", "dealerprice", "netprice");
  const iLabor = col("laborrate", "labor", "labour", "laborprice", "laborcost", "install", "installrate", "installprice");
  const iSize = col("size", "dimensions", "sqftperbox");
  const iNotes = col("notes", "note", "comments", "comment", "remarks");

  // Need a price column AND a way to name the product, else it's not something
  // we can safely parse without the AI.
  const canName = iName >= 0 || iStyleName >= 0 || iStyleNum >= 0;
  if (iPrice < 0 || !canName) return null;

  const rows: PriceRow[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = splitLine(lines[r], delim);
    const get = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");

    const styleName = get(iStyleName);
    const colorName = get(iColorName);
    let name = get(iName);
    if (!name) {
      const sn = styleName || get(iStyleNum);
      const cn = colorName || get(iColorNum);
      name = [sn, cn].filter(Boolean).join(" ").trim();
    }
    if (!name) continue;

    const sizeNote = get(iSize);
    rows.push({
      name,
      category: mapCategory(get(iCat)),
      unit: normUnit(get(iUnit)),
      sku: get(iStyleNum) || null,
      material_rate: toNum(get(iPrice)),
      labor_rate: iLabor >= 0 ? toNum(get(iLabor)) : null,
      manufacturer: get(iMfg) || null,
      style: styleName || null,
      color: colorName || null,
      notes: get(iNotes) || (sizeNote ? `Size: ${sizeNote}` : null),
    });
  }
  return rows.length ? rows : null;
}
