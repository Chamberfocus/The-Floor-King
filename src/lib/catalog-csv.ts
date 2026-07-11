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
  if (/(underlayment|underlay|underpad|carpetpad|^pad$|cushion|moisturebarrier|vaporbarrier)/.test(n)) return "underlayment";
  if (/(trim|molding|moulding|transition|reducer|tmold|quarterround|stairnose|nosing|threshold|endcap|bullnose|baseboard|baseshoe|shoemold|riser|covebase|wallbase)/.test(n)) return "trim";
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
  // Tier-specific price columns, so we can pick the RIGHT one per product:
  //   carpet → CUT price (not roll); hard surface → CARTON price (not pallet/piece).
  const iCut = col("cutprice", "cut", "cutorder", "cutlength", "cutcost", "cutyd", "cutperyd", "priceperyard", "cutyard");
  const iRoll = col("rollprice", "roll", "fullroll", "rollcost");
  const iCarton = col("cartonprice", "carton", "ctn", "boxprice", "box", "perbox", "percarton", "priceperbox", "pricepercarton", "cartoncost", "boxcost");
  // (pallet / piece / broken-carton columns are deliberately NOT selected —
  //  we never want the pallet or single-piece tier.)
  // Fallback generic price: prefer OUR cost over retail when several exist;
  // a generic "price", "list", or "msrp" is the last resort.
  const iPrice = col(
    "yourcost", "yourprice", "dealerprice", "dealernet", "dealercost", "dealer",
    "netprice", "net", "unitcost", "materialcost", "cost", "materialrate",
    "materialprice", "material", "unitprice", "price", "list", "listprice",
    "msrp", "retail", "retailprice",
  );
  const iLabor = col("laborrate", "labor", "labour", "laborprice", "laborcost", "install", "installrate", "installprice");
  const iSize = col("size", "dimensions", "sqftperbox");
  // Coverage (sf per carton/box) — used to convert a per-carton dollar price to per-sqft.
  const iCoverage = col("sqftperbox", "sqftpercarton", "sfperbox", "sfpercarton", "sfctn", "sfbox", "coverage", "boxcoverage", "cartoncoverage");
  const iNotes = col("notes", "note", "comments", "comment", "remarks");

  const HARD = new Set(["lvp", "hardwood", "laminate", "tile", "vinyl"]);
  // Pick the correct price column + how to interpret it, per row's category.
  const priceFor = (
    category: string,
    get: (i: number) => string,
  ): { rate: number | null; note: string | null } => {
    // Choose the tier column that applies to this product.
    let idx = iPrice;
    let fromCarton = false;
    if (category === "carpet") {
      idx = iCut >= 0 ? iCut : iRoll >= 0 ? iRoll : iPrice;
    } else if (HARD.has(category)) {
      if (iCarton >= 0) {
        idx = iCarton;
        fromCarton = true; // a carton column may be a per-carton total
      } else {
        idx = iPrice; // avoid pallet/piece — never prefer them
      }
    }
    if (idx < 0) idx = iPrice;
    let rate = toNum(get(idx));
    let note: string | null = null;
    // Hard surface priced per carton with a coverage → normalize to per-sqft.
    if (fromCarton && rate != null && iCoverage >= 0) {
      const cov = toNum(get(iCoverage));
      // Only divide when it clearly looks like a per-carton lump (price well
      // above a plausible per-sqft cost). Leave already-per-sqft prices alone.
      if (cov && cov > 1 && rate > cov * 0.5 && rate > 8) {
        rate = Math.round((rate / cov) * 100) / 100;
        note = `${cov} sf/carton`;
      }
    }
    return { rate, note };
  };

  // Need SOME price column AND a way to name the product, else it's not
  // something we can safely parse without the AI.
  const hasPrice = iPrice >= 0 || iCut >= 0 || iRoll >= 0 || iCarton >= 0;
  const canName = iName >= 0 || iStyleName >= 0 || iStyleNum >= 0;
  if (!hasPrice || !canName) return null;

  // Unit for a category when the sheet has no unit column: carpet is per-yard,
  // trim is linear, everything else is per-sqft.
  const unitForCategory = (c: string) =>
    c === "carpet" ? "sqyd" : c === "trim" ? "lnft" : "sqft";

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

    const category = mapCategory(get(iCat));
    const { rate, note: priceNote } = priceFor(category, get);
    const sizeNote = get(iSize);
    const notes =
      get(iNotes) ||
      [priceNote, sizeNote ? `Size: ${sizeNote}` : null].filter(Boolean).join(" · ") ||
      null;
    rows.push({
      name,
      category,
      unit: iUnit >= 0 ? normUnit(get(iUnit)) : unitForCategory(category),
      sku: get(iStyleNum) || null,
      material_rate: rate,
      labor_rate: iLabor >= 0 ? toNum(get(iLabor)) : null,
      manufacturer: get(iMfg) || null,
      style: styleName || null,
      color: colorName || null,
      notes,
    });
  }
  return rows.length ? rows : null;
}
