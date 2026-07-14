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

/**
 * Parse a money/number cell strictly. Strips $ and thousands commas, then
 * requires EXACTLY ONE number — so a blank, "N/A", or a range like "12-15" (two
 * numbers) returns null (to be flagged), never a silently-corrupted value.
 */
export function toNum(v: string): number | null {
  if (!v) return null;
  const cleaned = v.replace(/[$,]/g, "");
  const nums = cleaned.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length !== 1) return null; // blank, junk, or a range → flag
  const n = parseFloat(nums[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Split one extracted PDF/text line into meaningful cells. The PDF text
 * extractor separates columns with tabs; a pasted sheet may use runs of 2+
 * spaces. Blank/placeholder cells (empty, a lone bullet, or whitespace) are
 * dropped so column indexes line up between a header and its data rows.
 */
function matrixCells(line: string): string[] {
  const parts = line.includes("\t") ? line.split("\t") : line.split(/\s{2,}/);
  return parts.map((s) => s.trim()).filter((s) => s && s !== "•");
}

const MATRIX_NOISE =
  /^(terms|effective|rl price|price list|packaging|warranty|accessories|molding|installation|standard delivery|https?:|www\.|\d+ of \d+)\b/i;
/** A cell that's a molding/label word, never a real plank color. */
const MATRIX_LABEL =
  /(stair\s*nose|reducer|t[-\s]?mold|quarter\s*round|end\s*cap|square\s*nose|threshold|price\s*\/?\s*sf|item\s*#|^color$)/i;

/** The category a matrix product family falls into, from its description line. */
function matrixCategory(desc: string): string {
  const d = (desc || "").toLowerCase();
  if (/laminate/.test(d)) return "laminate";
  if (/(engineered|hardwood|solid wood)/.test(d)) return "hardwood";
  if (/(ceramic|porcelain|\btile\b)/.test(d)) return "tile";
  return "lvp"; // waterproof / rigid / vinyl plank goods — the common case
}

/**
 * Parse a VENDOR COLOR-MATRIX price list (e.g. Casabella / All Surfaces RL
 * lists). These aren't simple column tables: each product FAMILY has a
 * "Color | Item # | Price" sub-header, then one row per color where the columns
 * are `color · item# · $price/SF · [molding SKUs…]`. The generic parser reads
 * this as garbage and the AI hallucinates products from the molding headers,
 * packaging, and terms lines — so we detect and parse this shape EXACTLY.
 *
 * The one invariant across every variant of this layout: a data row is
 * `<color> <SKU> <$price-per-SF> <…molding skus…>` — so color=cell0, sku=cell1,
 * price=cell2, and everything after is ignored. Returns null if the text isn't
 * this format, so the caller falls back to the generic parser / AI.
 */
export function parseColorMatrix(text: string): PriceRow[] | null {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\r/g, ""));

  // Signature: at least one header whose first two cells are Color, then Item #.
  const isHeader = (cells: string[]) =>
    cells.length >= 2 && /^color\b/i.test(cells[0]) && /item\s*#?/i.test(cells[1]);
  if (!lines.some((l) => isHeader(matrixCells(l)))) return null;

  // A line that names a product family: has a description (bullets, a plank
  // size, thickness) and a short leading name cell.
  const familyOf = (cells: string[]): { name: string; desc: string } | null => {
    if (cells.length < 2) return null;
    const first = cells[0];
    if (!first || first.length > 44 || MATRIX_NOISE.test(first) || MATRIX_LABEL.test(first)) return null;
    if (/^\$?\d/.test(first)) return null; // starts with a number/price
    const rest = cells.slice(1).join(" ");
    const looksLikeDesc = /(•|plank|\d+(?:\.\d+)?\s*(?:mm|mil)\b|\d+(?:\.\d+)?"\s*x|wear layer|thickness|waterproof)/i.test(rest);
    if (!looksLikeDesc) return null;
    return { name: first, desc: rest };
  };

  const out: PriceRow[] = [];
  let family = "";
  let familyDesc = "";
  let inBlock = false;
  let blockStart = 0; // index in `out` where the current family's rows begin

  const skuLike = (s: string) =>
    /^[A-Za-z0-9][A-Za-z0-9._/-]{2,}$/.test(s) && /[A-Za-z]/.test(s) && /\d/.test(s) && !/\s/.test(s);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const cells = matrixCells(line);

    // New product family → wait for its header before reading colors.
    const fam = familyOf(cells);
    if (fam && !isHeader(cells)) {
      family = fam.name;
      familyDesc = fam.desc;
      inBlock = false;
      continue;
    }

    if (isHeader(cells)) {
      inBlock = true;
      blockStart = out.length;
      continue;
    }

    // Coverage (SF per carton) closes the block; stamp it onto its rows.
    const pkg = line.match(/([\d.]+)\s*SF\s*\/\s*(?:ctn|carton)/i);
    if (pkg) {
      const cov = pkg[1];
      for (let i = blockStart; i < out.length; i++) {
        out[i].notes = out[i].notes ? `${out[i].notes} · ${cov} SF/ctn` : `${cov} SF/ctn`;
      }
      inBlock = false;
      continue;
    }
    if (MATRIX_NOISE.test(line)) {
      inBlock = false;
      continue;
    }

    if (!inBlock || cells.length < 3) continue;

    // Data row: color · item# · $price/SF · [molding skus…]
    const color = cells[0];
    const sku = cells[1];
    const price = toNum(cells[2]);
    if (
      !color ||
      /^\$?\d/.test(color) ||
      MATRIX_LABEL.test(color) ||
      !skuLike(sku) ||
      price == null ||
      !(price > 0) ||
      price > 60 // a per-SF plank price; anything higher is a molding/box lump
    )
      continue;

    out.push({
      name: family ? `${family} ${color}` : color,
      category: matrixCategory(familyDesc),
      unit: "sqft", // Price/SF, sold in full cartons
      sku,
      material_rate: price,
      labor_rate: null,
      manufacturer: null,
      style: family || null,
      color,
      notes: null,
    });
  }

  return out.length ? out : null;
}

/**
 * If `text` looks like a structured spreadsheet (a header row we recognize,
 * including a name column), parse it directly into rows — no AI needed.
 * Returns null if it isn't structured, so the caller can fall back to AI.
 */
export function parseStructuredRows(text: string): PriceRow[] | null {
  // Vendor color-matrix lists (Casabella etc.) look structured but need
  // matrix-aware parsing — try that first.
  const matrix = parseColorMatrix(text);
  if (matrix?.length) return matrix;

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
