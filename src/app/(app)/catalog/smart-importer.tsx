"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  FileUp,
  Trash2,
  Sparkles,
  Download,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  RotateCcw,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchPicker } from "@/components/ui/search-picker";
import { SegmentedField } from "@/components/ui/segmented-field";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { foldCatalogColor, colorNumberFromText } from "@/lib/catalog-identity";
import { fileToGrid, chunkText } from "@/lib/pdf-client";
import {
  buildCatalogTemplate,
  mapCategory,
  normUnit,
  unitPriceCell,
} from "@/lib/catalog-csv";
import {
  applySheetFacts,
  readPriceText,
} from "@/lib/price-sheet";
import { specFieldsFor } from "@/lib/product-fields";
import { defaultUnitForCategory, unitsForCategory } from "@/lib/units";
import {
  CATALOG_PRODUCT_CATEGORIES,
  isCatalogProductCategory,
  isLaborCategory,
  PRODUCT_CATEGORY_LABELS,
  PRODUCT_CATEGORY_ORDER,
} from "@/lib/types";
import type { PriceRow } from "@/lib/extract";
import {
  parsePriceList,
  importProducts,
  extractStoragePdfText,
} from "./import-actions";

const CATALOG_CATEGORY_OPTIONS = CATALOG_PRODUCT_CATEGORIES.map((c) => ({
  value: c,
  label: PRODUCT_CATEGORY_LABELS[c],
}));

const inputSm =
  "h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Spreadsheet column fields, with header synonyms for auto-mapping.
const FIELDS: { key: string; label: string; syn: string[] }[] = [
  { key: "name", label: "Product name", syn: ["name", "productname", "product", "itemname", "description", "itemdescription"] },
  // Cost-first — auto-map OUR cost, NEVER auto-pick MSRP / list / retail (those
  // must be chosen deliberately). Generic "price"/"unitprice" are last resort.
  { key: "material_rate", label: "Price", syn: ["yourcost", "dealercost", "dealernet", "dealerprice", "netprice", "net", "unitcost", "cost", "materialcost", "materialrate", "material", "unitprice", "price"] },
  { key: "cut_price", label: "Cut price", syn: ["cutprice", "cut", "cutorder", "cutlength", "cutyd", "cutperyd", "priceperyard"] },
  { key: "roll_price", label: "Roll price", syn: ["rollprice", "roll", "fullroll", "rollcost"] },
  { key: "sku", label: "SKU / item #", syn: ["sku", "style", "styleno", "stylenumber", "item", "itemno", "itemnumber", "partno", "partnumber", "productcode", "code"] },
  { key: "manufacturer", label: "Manufacturer", syn: ["manufacturer", "mfg", "mfr", "brand", "vendor", "supplier", "mill", "sellingcompanyname"] },
  { key: "style", label: "Style", syn: ["stylename", "pattern", "collection", "series", "design"] },
  { key: "color", label: "Color", syn: ["colorname", "colourname", "shade", "finish", "color", "colour"] },
  { key: "color_number", label: "Color #", syn: ["colorno", "colornumber", "colornum", "colourno", "colournumber", "colorcode", "colourcode"] },
  { key: "category", label: "Category", syn: ["category", "prodtype", "producttype", "type", "flooringtype"] },
  { key: "unit", label: "Unit", syn: ["unit", "uom", "unitofmeasure", "priceper"] },
  { key: "notes", label: "Notes", syn: ["notes", "note", "comments", "remarks", "size"] },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// The price the store pays. Cut before a generic price, generic before roll.
// Labor is not a price-list column.
const PRICE_COLUMN_ORDER = [
  "yourcost", "yourprice", "dealercost", "dealernet", "dealerprice", "dealer",
  "netprice", "net", "unitcost", "cost", "materialcost", "materialrate", "material",
  "cutprice", "cut", "cutorder", "cutcost",
  "pricesy", "pricepersy", "priceperyd", "pricepersqyd", "costsy", "costpersy", "netsy",
  "unitprice", "price",
  "cartonprice", "carton", "ctn", "boxprice",
  "rollprice", "roll",
  "listprice", "list", "msrp", "retail", "retailprice",
];

export type RowStatus = { level: "ok" | "flag"; reason: string };
/**
 * Loud validation: a row is FLAGGED (and excluded from import) if the price is
 * missing/$0 or if the price × unit is implausible for the category — the exact
 * mislabels that made prices wrong (carpet priced per sq ft, hard surface priced
 * per sq yd, a per-carton lump labeled per sq ft). Nothing wrong imports silently.
 */
export function validateRow(
  r: PriceRow,
  opts: { sheet?: boolean } = {},
): RowStatus {
  if (opts.sheet) {
    if (!r.style?.trim()) return { level: "flag", reason: "no style" };
    if (!r.color?.trim()) return { level: "flag", reason: "no color" };
  }
  if (!r.name?.trim()) return { level: "flag", reason: "no product name" };
  if (isLaborCategory(r.category)) {
    return {
      level: "flag",
      reason: "Labor is not a product — it stays on the estimate",
    };
  }
  if (!isCatalogProductCategory(r.category)) {
    return { level: "flag", reason: "choose what this material is" };
  }
  if (r.material_rate == null)
    return { level: "flag", reason: "price didn't parse — fix it or map a different price column" };
  const p = Number(r.material_rate);
  if (!(p > 0)) return { level: "flag", reason: "price is $0" };
  if (p >= 200)
    return { level: "flag", reason: `$${p} looks like a roll size, not the unit price` };
  if (r.roll_rate != null && r.roll_rate !== undefined) {
    const roll = Number(r.roll_rate);
    if (!(roll > 0)) return { level: "flag", reason: "roll price didn't parse" };
    if (roll > p * 1.02) {
      return {
        level: "flag",
        reason: "roll price is higher than the cut price — those two columns look swapped",
      };
    }
  }
  const u = r.unit;
  if (r.category === "carpet") {
    // Carpet is always sq yd here. A plausible sq ft price was already
    // converted upstream, so anything still arriving as sq ft is a sq yd price
    // wearing the wrong label — the fault that turned $45 carpet into $407.
    if (u === "sqft")
      return {
        level: "flag",
        reason: `$${p}/sq ft is too high for carpet — this looks like a per-sq-yd price mislabelled`,
      };
    if (u === "sqyd" && p < 2)
      return { level: "flag", reason: `$${p}/sq yd is very low — is this a per-sq-ft price?` };
    if (u !== "sqyd")
      return { level: "flag", reason: `carpet unit "${u}" — carpet must be sq yd` };
  }
  if (["lvp", "hardwood", "laminate", "tile"].includes(r.category)) {
    if (u === "sqft" && p > 20)
      return { level: "flag", reason: `$${p}/sq ft looks like a per-carton price` };
    if (u === "sqyd")
      return { level: "flag", reason: "hard surface priced per sq yd — should be sq ft" };
  }
  if (r.category === "trim" && u !== "lnft" && u !== "each")
    return { level: "flag", reason: `trim unit "${u}" — expected linear ft or each` };
  return { level: "ok", reason: "" };
}

// Tell trim/accessory pieces apart from actual flooring, by product name.
const TRIM_RE =
  /(t-?mold|transition|reducer|quarter[\s-]?round|stair[\s-]?nose|stairnose|\bnosing\b|thresh|end[\s-]?cap|bull?nose|base\s?board|baseboard|base\s?shoe|shoe\s?mold|\bmolding\b|\bmoulding\b|\briser\b|cove\s?base|wall\s?base|\btrim\b|edge\s?(strip|guard)|seam\s?bind)/i;
const PAD_RE =
  /(carpet\s?pad|\bcushion\b|underlay(ment)?|moisture\s?barrier|vapor\s?barrier|\bunderpad\b)/i;
/** Guess that a row is a trim/accessory rather than flooring, from its name. */
function guessKind(name: string | null | undefined): "trim" | "underlayment" | null {
  const n = name ?? "";
  if (TRIM_RE.test(n)) return "trim";
  if (PAD_RE.test(n)) return "underlayment";
  return null;
}

type Source = { name: string; how: "spreadsheet" | "pdf" | "image" | "text" };

export function SmartImporter({
  suppliers = [],
}: {
  suppliers?: { name: string; kind: string }[];
}) {
  // input
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // progress
  const [reading, startReading] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  // result: spreadsheet => grid; everything else => rows
  const [source, setSource] = useState<Source | null>(null);
  const [grid, setGrid] = useState<{ headers: string[]; body: string[][] } | null>(null);
  const [map, setMap] = useState<Record<string, number>>({});
  const [defCategory, setDefCategory] = useState("");
  const [defUnit, setDefUnit] = useState("");
  const [unitTouched, setUnitTouched] = useState(false);
  const [defSupplier, setDefSupplier] = useState("");
  const [defManufacturer, setDefManufacturer] = useState("");
  const [defNote, setDefNote] = useState("");
  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<PriceRow[] | null>(null);
  /** This read came from a price sheet: style, color, cut, roll — nothing else. */
  const [sheetRead, setSheetRead] = useState(false);
  const sheetFlag = useRef(false);
  // Row indices selected for a bulk change (editable / AI-rows path).
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkCat, setBulkCat] = useState("carpet");
  // "Change all X → Y" pickers.
  const [fromCat, setFromCat] = useState("lvp");
  const [toCat, setToCat] = useState("laminate");
  // How many rows to render at once (the rest still import — this is just the view).
  const [shown, setShown] = useState(60);

  // import
  const [updateMode, setUpdateMode] = useState(false);
  const [importing, startImport] = useTransition();
  const [done, setDone] = useState<number | null>(null);

  const reset = () => {
    setSource(null);
    setGrid(null);
    setMap({});
    setRows(null);
    setSheetRead(false);
    sheetFlag.current = false;
    setSelected(new Set());
    setShown(60);
    setStatus(null);
    if (fileRef.current) fileRef.current.value = "";
    if (textRef.current) textRef.current.value = "";
  };

  const downloadTemplate = () => {
    const blob = new Blob([buildCatalogTemplate()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "floor-king-catalog-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- AI / structured parse for text (PDF text, pasted) ----
  // Order: column-structured (instant) → AI (best) → local line parser
  // (guaranteed). So extracted text ALWAYS yields rows to review, even with no
  // AI key.
  const parseTextSmart = async (
    text: string,
    shape: "sheet" | "any" = "any",
  ): Promise<PriceRow[]> => {
    const read = readPriceText(text);
    if (read?.rows.length) {
      sheetFlag.current = read.sheet || shape === "sheet";
      setStatus(
        read.sheet
          ? `Found ${read.rows.length} colors — style, color, cut, and roll.`
          : `Recognized ${read.rows.length} rows from the columns — no AI needed.`,
      );
      return read.rows;
    }
    if (shape === "sheet") {
      const chunks = chunkText(text);
      const out: PriceRow[] = [];
      for (let i = 0; i < chunks.length; i++) {
        setStatus(`Reading the price sheet — part ${i + 1} of ${chunks.length}…`);
        const fd = new FormData();
        fd.set("mode", "sheet");
        fd.set("text", chunks[i]);
        const res = await parsePriceList(fd);
        if (res.rows?.length) out.push(...res.rows);
        else if (res.error && chunks.length === 1) setStatus(res.error);
      }
      if (out.length) sheetFlag.current = true;
      return out;
    }
    const chunks = chunkText(text);
    const out: PriceRow[] = [];
    let aiFailed = false;
    for (let i = 0; i < chunks.length; i++) {
      setStatus(`Reading — part ${i + 1} of ${chunks.length}… (${out.length} found)`);
      try {
        const fd = new FormData();
        fd.set("text", chunks[i]);
        const res = await parsePriceList(fd);
        if (res.rows?.length) out.push(...res.rows);
      } catch {
        aiFailed = true;
      }
    }
    if (out.length) return out;
    // Nothing came back — fall back to a local line parse so the user still
    // gets rows they can review and clean up.
    if (aiFailed) setStatus("Reading offline…");
    return localLineParse(text);
  };

  const uploadToStorage = async (file: File): Promise<string | null> => {
    const supabase = createClient();
    const path = `imports/${crypto.randomUUID()}-${file.name}`;
    const { error } = await supabase.storage
      .from("documents")
      .upload(path, file, { contentType: file.type || undefined });
    if (error) {
      toast.error(`Upload failed: ${error.message}`);
      return null;
    }
    return path;
  };

  const setGridFromRows = (g: string[][], src: Source) => {
    const headers = g[0] ?? [];
    const body = g.slice(1).filter((r) => r.some((c) => c.trim()));
    const normHead = headers.map(norm);
    const guess: Record<string, number> = {};
    for (const f of FIELDS) {
      guess[f.key] = -1;
      for (const s of f.syn) {
        const i = normHead.indexOf(norm(s));
        if (i >= 0) {
          guess[f.key] = i;
          break;
        }
      }
    }
    for (const name of PRICE_COLUMN_ORDER) {
      const i = normHead.indexOf(name);
      if (i >= 0) {
        guess.material_rate = i;
        break;
      }
    }
    setSource(src);
    setGrid({ headers, body });
    setMap(guess);
  };

  // ---- Main ingest: auto-detect & route ----
  const ingest = (file: File | null, pasted: string) =>
    startReading(async () => {
      try {
        reset();
        if (file) {
          const name = file.name.toLowerCase();
          const type = file.type || "";
          const isSheet =
            name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv") ||
            type.includes("spreadsheet") || type.includes("excel") || type === "text/csv";
          const isPdf = type === "application/pdf" || name.endsWith(".pdf");
          const isImage = type.startsWith("image/");
          const isText = name.endsWith(".txt") || type === "text/plain";

          if (isSheet) {
            setStatus("Reading the spreadsheet…");
            const g = await fileToGrid(file);
            if (g.length < 2) {
              toast.error("That file has no data rows.");
              setStatus(null);
              return;
            }
            setGridFromRows(g, { name: file.name, how: "spreadsheet" });
            setStatus(null);
            return;
          }
          // PDF: extract the text on the server (fast), then run the AI on it
          // in short chunks from the browser so no single request hits the 60s
          // serverless limit. Scanned PDFs (no text) use one AI-vision call.
          if (isPdf) {
            setStatus("Uploading…");
            const path = await uploadToStorage(file);
            if (!path) {
              setStatus(null);
              return;
            }
            setStatus("Reading the PDF…");
            const { text, structured } = await extractStoragePdfText(path);
            if (structured?.length) {
              finishRows(structured, { name: file.name, how: "pdf" }, { sheet: true });
              return;
            }
            if (text && text.trim().length >= 20) {
              const rows = await parseTextSmart(text, "sheet");
              if (rows.length) {
                finishRows(rows, { name: file.name, how: "pdf" }, { sheet: true });
                return;
              }
            }
            // No usable text → it's a scan. One AI-vision call, still only
            // style, color, cut, and roll.
            setStatus("Reading the scanned PDF…");
            const fd = new FormData();
            fd.set("mode", "sheet");
            fd.set("storage_path", path);
            fd.set("storage_mime", "application/pdf");
            const res = await parsePriceList(fd);
            if (res.rows?.length) {
              finishRows(res.rows, { name: file.name, how: "pdf" }, { sheet: true });
            } else {
              toast.error(res.error || "Couldn't read that PDF.");
              setStatus(
                res.error ||
                  "Couldn't find styles, colors, and prices in that PDF.",
              );
            }
            return;
          }
          // Photo / image: single AI-vision call.
          if (isImage) {
            setStatus("Reading the photo…");
            const fd = new FormData();
            fd.set("mode", "sheet");
            fd.set("file", file);
            const res = await parsePriceList(fd);
            if (res.rows?.length) {
              finishRows(res.rows, { name: file.name, how: "image" }, { sheet: true });
            } else {
              toast.error(res.error || "Couldn't read that photo.");
              setStatus(res.error || "Couldn't read that photo.");
            }
            return;
          }
          if (isText) {
            const text = await file.text();
            // A CSV-ish text file? try grid first.
            const g = csvTextToGrid(text);
            if (g && g.length >= 2) {
              setGridFromRows(g, { name: file.name, how: "spreadsheet" });
              setStatus(null);
              return;
            }
            const r = await parseTextSmart(text);
            finishRows(r, { name: file.name, how: "text" });
            return;
          }
          // Unknown — try as text, else hand the whole file to the AI.
          const text = await file.text().catch(() => "");
          if (text.trim().length >= 20) {
            const r = await parseTextSmart(text);
            finishRows(r, { name: file.name, how: "text" });
          } else {
            const fd = new FormData();
            fd.set("file", file);
            const res = await parsePriceList(fd);
            if (res.rows?.length)
              finishRows(res.rows, { name: file.name, how: "image" });
            else toast.error(res.error || "Couldn't read that file.");
          }
          return;
        }

        if (pasted.trim()) {
          const r = await parseTextSmart(pasted);
          finishRows(r, { name: "Pasted list", how: "text" });
          return;
        }
        toast.error("Drop a file or paste your price list first.");
      } catch (e) {
        setStatus(null);
        toast.error(e instanceof Error ? e.message : "Couldn't read that.");
      }
    });

  const finishRows = (r: PriceRow[], src: Source, opts?: { sheet?: boolean }) => {
    const sheet = Boolean(opts?.sheet || sheetFlag.current);
    setStatus(null);
    setSource(src);
    setRows(r.map((row) => ({ ...row, labor_rate: null })));
    setSheetRead(sheet);
    sheetFlag.current = sheet;
    if (r.length) {
      toast.success(
        sheet
          ? `Found ${r.length} colors — check style, color, cut, and roll.`
          : `Found ${r.length} products — review & import`,
      );
    } else {
      toast.error(
        sheet
          ? "Couldn't find styles, colors, and prices in that PDF."
          : "No products found. Try a clearer file, or paste the rows as text.",
      );
    }
  };

  // ---- Spreadsheet: build rows from current mapping ----
  const buildFromGrid = (): PriceRow[] => {
    if (!grid) return [];
    const cell = (row: string[], key: string) => {
      const i = map[key];
      return i >= 0 ? (row[i] ?? "").trim() : "";
    };
    const out: PriceRow[] = [];
    for (const row of grid.body) {
      let name = cell(row, "name");
      if (!name) name = [cell(row, "style"), cell(row, "color")].filter(Boolean).join(" ").trim();
      if (!name) continue;
      const catCell = cell(row, "category");
      const unitCell = cell(row, "unit");
      const rawCategory = catCell ? mapCategory(catCell) : defCategory;
      const rawUnit = unitCell ? normUnit(unitCell) : defUnit;
      const priceHeader =
        map.material_rate >= 0 ? (grid.headers[map.material_rate] ?? "") : "";
      const cutHeader = map.cut_price >= 0 ? (grid.headers[map.cut_price] ?? "cut") : "cut";
      const rollHeader = map.roll_price >= 0 ? (grid.headers[map.roll_price] ?? "roll") : "roll";
      const cutPrice = unitPriceCell(cell(row, "cut_price"), cutHeader);
      const rawMat = cutPrice ?? unitPriceCell(cell(row, "material_rate"), priceHeader);
      const rawRoll = unitPriceCell(cell(row, "roll_price"), rollHeader);
      // House rule: carpet is ALWAYS quoted per square yard, hard surface per
      // square foot. A supplier sending carpet per sq ft is converted here
      // rather than left to be converted (or not) later — the same money per
      // area, said the way the business says it.
      //
      // Only when the sq ft price is PLAUSIBLE as a sq ft price. Above $8/sq ft
      // a square yard would cost over $72, which no carpet does — that's a sq
      // yard price wearing a sq ft label, and multiplying it again is exactly
      // how $45 carpet became $407. Those still get flagged for a human.
      const yardify =
        rawCategory === "carpet" && rawUnit === "sqft" && rawMat != null && rawMat > 0 && rawMat <= 8;
      const x9 = (v: number | null) =>
        v == null ? v : Math.round(v * 9 * 100) / 100;
      const folded = foldCatalogColor(
        cell(row, "color"),
        cell(row, "color_number"),
        cell(row, "notes") || null,
      );
      out.push({
        name,
        category: rawCategory,
        unit: yardify ? "sqyd" : rawUnit,
        sku: cell(row, "sku") || null,
        material_rate: yardify ? x9(rawMat) : rawMat,
        roll_rate: rawRoll == null ? null : yardify ? x9(rawRoll) : rawRoll,
        labor_rate: null,
        manufacturer: cell(row, "manufacturer") || null,
        style: cell(row, "style") || null,
        color: folded.color,
        notes: folded.notes,
      });
    }
    return out;
  };

  const effectiveUnit = defUnit || defaultUnitForCategory(defCategory);
  const facts = {
    manufacturer: defManufacturer,
    distributor: defSupplier,
    category: defCategory,
    unit: effectiveUnit,
    note: defNote,
  };
  const sheetMode = sheetRead || source?.how === "pdf" || source?.how === "image";
  const factsReady =
    Boolean(defManufacturer.trim()) &&
    Boolean(defSupplier.trim()) &&
    (!sheetMode || isCatalogProductCategory(defCategory));
  // Manufacturer, category, unit, and the note apply to the whole upload.
  // A PDF is one material, so the category replaces whatever the file guessed.
  const applyDefaults = (list: PriceRow[]): PriceRow[] =>
    applySheetFacts(list, facts, { lockCategory: sheetMode });

  const finalRows = applyDefaults(grid ? buildFromGrid() : (rows ?? []));
  // Loud validation: split into what will import vs what's flagged & held back.
  const validated = finalRows.map((r) => ({ r, status: validateRow(r, { sheet: sheetMode }) }));
  const flaggedCount = validated.filter((v) => v.status.level === "flag").length;
  const okCount = validated.length - flaggedCount;

  // Import DIRECTLY and synchronously — one server call, no background worker,
  // no self-fetch, no deployment-protection wall. The reviewed rows go to the
  // server in a single request and land immediately; on error we keep the rows
  // so you can retry. This is the reliable path.
  const doImport = () =>
    startImport(async () => {
      const built = applyDefaults(grid ? buildFromGrid() : rows ?? []);
      if (!built.length) {
        toast.error("Nothing to import yet.");
        return;
      }
      // Only clean rows import. Flagged rows (bad/implausible price×unit) are
      // held back — never written with a wrong or $0 price.
      if (!defManufacturer.trim() || !defSupplier.trim()) {
        toast.error("Enter the manufacturer and the distributor for this price list.");
        return;
      }
      if (sheetMode && !isCatalogProductCategory(defCategory)) {
        toast.error("Choose what this material is — carpet, LVP, hardwood, and so on.");
        return;
      }
      const okOnly = built.filter((r) => validateRow(r, { sheet: sheetMode }).level === "ok");
      const held = built.length - okOnly.length;
      if (!okOnly.length) {
        toast.error(`All ${built.length} rows are flagged — fix the mapping/units first.`);
        return;
      }
      const res = await importProducts(okOnly, {
        update: updateMode,
        supplier: defSupplier.trim() || undefined,
        manufacturer: defManufacturer.trim() || undefined,
        category: isCatalogProductCategory(defCategory) ? defCategory : undefined,
        specs,
      });
      if (res.error) {
        // Keep the reviewed rows on screen so nothing is lost — just retry.
        toast.error(
          res.count
            ? `Imported ${res.count}, then hit an error: ${res.error}`
            : res.error,
        );
        return;
      }
      // Loud, honest tally: new vs updated vs unchanged, then what was held back.
      const writerSkipped = res.skipped ?? 0;
      const heldTotal = held + writerSkipped;
      const parts: string[] = [];
      if (res.inserted != null) parts.push(`${res.inserted} new`);
      if (res.updated != null) parts.push(`${res.updated} updated`);
      if (res.unchanged) parts.push(`${res.unchanged} unchanged`);
      toast.success(
        parts.length
          ? `Imported: ${parts.join(" · ")}.`
          : `Imported ${res.count ?? okOnly.length} product${(res.count ?? okOnly.length) === 1 ? "" : "s"}.`,
      );
      if (heldTotal > 0) {
        toast.warning(
          `${heldTotal} row${heldTotal === 1 ? "" : "s"} held back — not imported.`,
        );
      }
      if (res.warning) toast.warning(res.warning);
      setDone(res.count ?? okOnly.length);
      reset();
    });

  const colOptions = grid
    ? [
        { value: "-1", label: "— Not in file —" },
        ...grid.headers.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` })),
      ]
    : [];

  // editable rows (AI path)
  const updateRow = (i: number, patch: Partial<PriceRow>) =>
    setRows((prev) => (prev ? prev.map((r, j) => (j === i ? { ...r, ...patch } : r)) : prev));
  const removeRow = (i: number) => {
    setRows((prev) => (prev ? prev.filter((_, j) => j !== i) : prev));
    setSelected(new Set());
  };

  // ---- Bulk editing: select rows, then change their flooring type at once ----
  const allRows = rows ?? [];
  // A row's effective category (unknown values count as "other").
  const catOf = (r: PriceRow) =>
    isLaborCategory(r.category) || isCatalogProductCategory(r.category)
      ? r.category
      : "other";
  // How many rows sit in each category right now — drives the "change all" picker.
  const catCounts = new Map<string, number>();
  for (const r of allRows) catCounts.set(catOf(r), (catCounts.get(catOf(r)) ?? 0) + 1);
  const presentCats = PRODUCT_CATEGORY_ORDER.filter((c) => catCounts.has(c));
  // Reclassify EVERY row of one type into another, in a single move.
  const bulkRecategorize = () => {
    const from = catCounts.has(fromCat) ? fromCat : presentCats[0];
    if (!from || from === toCat || !isCatalogProductCategory(toCat)) return;
    const count = allRows.filter((r) => catOf(r) === from).length;
    if (!count) {
      toast.error(`No ${PRODUCT_CATEGORY_LABELS[from as never] ?? from} items to change.`);
      return;
    }
    setRows((prev) =>
      prev ? prev.map((r) => (catOf(r) === from ? { ...r, category: toCat } : r)) : prev,
    );
    setSelected(new Set());
    toast.success(
      `Changed ${count} ${PRODUCT_CATEGORY_LABELS[from as never] ?? from} → ${PRODUCT_CATEGORY_LABELS[toCat as never] ?? toCat}`,
    );
  };
  const toggleRow = (i: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const toggleAll = () =>
    setSelected((s) =>
      s.size >= allRows.length && allRows.length > 0
        ? new Set()
        : new Set(allRows.map((_, i) => i)),
    );
  const bulkSetCategory = (cat: string) => {
    if (!selected.size || !isCatalogProductCategory(cat)) return;
    setRows((prev) =>
      prev ? prev.map((r, j) => (selected.has(j) ? { ...r, category: cat } : r)) : prev,
    );
    setSelected(new Set());
  };
  const bulkDelete = () => {
    if (!selected.size) return;
    setRows((prev) => (prev ? prev.filter((_, j) => !selected.has(j)) : prev));
    setSelected(new Set());
  };
  // One click: re-file every row that looks like trim/pad/accessory (by name).
  const autoSortKinds = () => {
    const changed = allRows.filter((r) => {
      const kind = guessKind(r.name);
      return kind && kind !== catOf(r);
    }).length;
    setRows((prev) =>
      prev
        ? prev.map((r) => {
            const kind = guessKind(r.name);
            return kind && kind !== catOf(r) ? { ...r, category: kind } : r;
          })
        : prev,
    );
    toast.success(
      changed
        ? `Re-filed ${changed} trim/accessory ${changed === 1 ? "item" : "items"}`
        : "No trim or accessory pieces found to re-file",
    );
  };
  // Turn a mapped spreadsheet into the editable table so bulk tools apply to it.
  const editGridRows = () => {
    setRows(buildFromGrid());
    setGrid(null);
    setSelected(new Set());
  };

  const hasResult = Boolean(grid) || (rows && rows.length >= 0 && source);

  // ===================== RENDER =====================
  const manufacturers = suppliers.filter((s) => s.kind === "manufacturer");
  const distributors = [
    ...suppliers.filter((s) => s.kind !== "manufacturer"),
    ...manufacturers,
  ];
  const specList = specFieldsFor(defCategory);

  return (
    <div className="space-y-5">
      <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
        <div>
          <div className="text-sm font-medium">About this price list</div>
          <p className="mt-1 text-sm text-muted-foreground">
            The PDF only has to contain the style, the color, the cut price, and
            the roll price when the sheet has one. You say who makes it and who
            you order it from. That is saved on every color in this upload.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Manufacturer — who makes it *</span>
            <Input
              value={defManufacturer}
              onChange={(e) => setDefManufacturer(e.target.value)}
              placeholder="Shaw, Mohawk, Mannington…"
              list="price-sheet-manufacturers"
              className="h-9"
            />
            <datalist id="price-sheet-manufacturers">
              {manufacturers.map((s) => (
                <option key={s.name} value={s.name} />
              ))}
            </datalist>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Distributor — who you order it from *</span>
            <Input
              value={defSupplier}
              onChange={(e) => setDefSupplier(e.target.value)}
              placeholder="The vendor on the purchase order"
              list="price-sheet-distributors"
              className="h-9"
            />
            <datalist id="price-sheet-distributors">
              {distributors.map((s) => (
                <option key={`${s.kind}-${s.name}`} value={s.name} />
              ))}
            </datalist>
          </label>
        </div>
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            What is this material?{sheetMode ? " *" : ""}
          </div>
          <SegmentedField
            size="sm"
            value={defCategory}
            onChange={(v) => {
              if (!isCatalogProductCategory(v)) return;
              setDefCategory(v);
              if (!unitTouched) setDefUnit(defaultUnitForCategory(v));
            }}
            options={CATALOG_CATEGORY_OPTIONS}
          />
        </div>
        {isCatalogProductCategory(defCategory) ? (
          <div className="flex flex-wrap items-end gap-4">
            <label className="space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">Priced per</span>
              <select
                value={effectiveUnit}
                onChange={(e) => {
                  setUnitTouched(true);
                  setDefUnit(e.target.value);
                }}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              >
                {unitsForCategory(defCategory).map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
            {specList.map((field) => (
              <label key={field.key} className="space-y-1 text-sm">
                <span className="text-xs text-muted-foreground">
                  {field.label}
                  {field.hint ? ` — ${field.hint}` : ""}
                </span>
                {field.kind === "choice" ? (
                  <select
                    value={specs[field.key] ?? ""}
                    onChange={(e) =>
                      setSpecs((cur) => ({ ...cur, [field.key]: e.target.value }))
                    }
                    className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                  >
                    <option value="">—</option>
                    {(field.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    value={specs[field.key] ?? ""}
                    onChange={(e) =>
                      setSpecs((cur) => ({ ...cur, [field.key]: e.target.value }))
                    }
                    className="h-9 w-36"
                  />
                )}
              </label>
            ))}
          </div>
        ) : null}
        <label className="block space-y-1 text-sm">
          <span className="text-xs text-muted-foreground">
            Anything else to save on every color
          </span>
          <Input
            value={defNote}
            onChange={(e) => setDefNote(e.target.value)}
            placeholder="Optional — a note that belongs on each color"
            className="h-9"
          />
        </label>
        {!factsReady ? (
          <p className="text-sm text-amber-800 dark:text-amber-300">
            {sheetMode
              ? "Enter the manufacturer, the distributor, and what this material is. Then the colors can import."
              : "Enter the manufacturer and the distributor. They are saved on every row."}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {defManufacturer.trim()} from {defSupplier.trim()}
            {isCatalogProductCategory(defCategory)
              ? ` · ${PRODUCT_CATEGORY_LABELS[defCategory]}`
              : ""}
            {effectiveUnit ? ` · ${effectiveUnit}` : ""}. Cut price is the cost estimates use.
            Roll price is kept when the sheet has one.
          </p>
        )}
      </div>

      {/* Step 1 — drop / paste (hidden once we have a result) */}
      {!hasResult ? (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) ingest(f, "");
            }}
            onClick={() => fileRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors",
              dragOver ? "border-primary bg-primary/5" : "border-input hover:border-primary/50 hover:bg-muted/40",
            )}
          >
            <FileUp className="size-7 text-primary" />
            <span className="text-base font-medium">
              {reading ? "Reading…" : "Drop the price list — or click to choose"}
            </span>
            <span className="text-sm text-muted-foreground">
              From a PDF we read the style, the color, the cut price, and the roll price.
              You already told us the rest.
            </span>
            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><FileSpreadsheet className="size-3.5" /> Excel/CSV</span>
              <span className="inline-flex items-center gap-1"><FileText className="size-3.5" /> PDF</span>
              <span className="inline-flex items-center gap-1"><ImageIcon className="size-3.5" /> Photo of a sheet</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.xlsx,.xls,.csv,.txt,image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) ingest(f, "");
              }}
            />
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            or paste it
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="space-y-2">
            <textarea
              ref={textRef}
              rows={5}
              placeholder={"Paste rows from a vendor sheet, email, or PDF — any format.\nShaw Anso Caress carpet  SKU 1234  $3.85/sf\nMohawk RevWood laminate  $2.10 sqft"}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={downloadTemplate}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Download className="size-3.5" /> Download a blank template
              </button>
              <Button
                type="button"
                onClick={() => ingest(null, textRef.current?.value ?? "")}
                disabled={reading}
              >
                {reading ? (
                  <><Sparkles className="size-4 animate-pulse" /> Reading…</>
                ) : (
                  <><Sparkles className="size-4" /> Read it</>
                )}
              </Button>
            </div>
          </div>
          {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
        </>
      ) : null}

      {/* Step 2 — review */}
      {hasResult ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <SourceIcon how={source?.how} />
            <span className="font-medium">{source?.name}</span>
            <span className="text-muted-foreground">
              · {finalRows.length} product{finalRows.length === 1 ? "" : "s"} detected
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={reset} className="ml-auto">
              <RotateCcw className="size-4" /> Start over
            </Button>
          </div>

          {/* Spreadsheet column mapping */}
          {grid ? (
            <details className="rounded-lg border bg-muted/30 p-3" open={map.name === undefined || map.name < 0}>
              <summary className="cursor-pointer text-sm font-medium">
                Columns {map.name >= 0 ? "(auto-matched — adjust if needed)" : "— match your columns"}
              </summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {FIELDS.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 text-xs text-muted-foreground">
                      {f.label}{f.key === "name" ? " *" : ""}
                    </span>
                    <SearchPicker
                      className="flex-1"
                      value={String(map[f.key] ?? -1)}
                      onChange={(v) => setMap((m) => ({ ...m, [f.key]: Number(v) }))}
                      options={colOptions}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4 border-t pt-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">If no category column:</span>
                  <SegmentedField
                    size="sm"
                    value={defCategory}
                    onChange={(v) => {
                      if (isCatalogProductCategory(v)) setDefCategory(v);
                    }}
                    options={CATALOG_CATEGORY_OPTIONS}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Default unit:</span>
                  <Input value={defUnit} onChange={(e) => setDefUnit(e.target.value)} className="h-8 w-20" />
                </div>
              </div>
            </details>
          ) : null}

          {/* Bulk tools — change the flooring type for many rows at once, and
              auto-sort trim/pad pieces out of the flooring. */}
          {!grid && !sheetMode && rows && rows.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={autoSortKinds}
                title="Scan names and re-file transitions, molding, pad, etc. as trim/underlayment"
              >
                <Sparkles className="size-3.5" /> Auto-sort trim &amp; pad
              </Button>
              <span className="text-muted-foreground">·</span>
              {selected.size > 0 ? (
                <>
                  <span className="text-xs font-medium">
                    {selected.size} selected →
                  </span>
                  <span className="text-xs text-muted-foreground">set type</span>
                  <SearchPicker
                    className="w-36"
                    value={bulkCat}
                    onChange={setBulkCat}
                    options={CATALOG_CATEGORY_OPTIONS}
                  />
                  <Button type="button" size="sm" onClick={() => bulkSetCategory(bulkCat)}>
                    Apply
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={bulkDelete}
                    className="text-destructive"
                  >
                    <Trash2 className="size-3.5" /> Delete
                  </Button>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Clear
                  </button>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Tip: check rows on the left to change their flooring type all at
                  once.
                </span>
              )}
              </div>
              {/* Change EVERY row of one type into another, in a single move. */}
              {presentCats.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                  <span className="text-xs text-muted-foreground">Change all</span>
                  <SearchPicker
                    className="w-44"
                    value={catCounts.has(fromCat) ? fromCat : presentCats[0]}
                    onChange={setFromCat}
                    options={presentCats.map((c) => ({
                      value: c,
                      label: `${PRODUCT_CATEGORY_LABELS[c]} (${catCounts.get(c)})`,
                    }))}
                  />
                  <span className="text-xs text-muted-foreground">→</span>
                  <SearchPicker
                    className="w-36"
                    value={toCat}
                    onChange={setToCat}
                    options={CATALOG_CATEGORY_OPTIONS}
                  />
                  <Button type="button" size="sm" onClick={bulkRecategorize}>
                    Change all
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          {grid && finalRows.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Button type="button" variant="outline" size="sm" onClick={editGridRows}>
                Edit rows &amp; fix types
              </Button>
              <span>
                — switch to the editable list to bulk-change flooring types or
                auto-sort trim.
              </span>
            </div>
          ) : null}

          {/* Preview table */}
          {finalRows.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No products detected. Try “Start over” with a clearer file, or paste the rows as text.
            </p>
          ) : sheetMode && !grid ? (
            <SheetColorTable
              rows={finalRows}
              shown={shown}
              onShowMore={() => setShown((n) => n + 100)}
              onShowAll={() => setShown(finalRows.length)}
              onPatch={(i, patch) => updateRow(i, patch)}
              onRemove={removeRow}
              priceLabel={defCategory === "carpet" || defCategory === "vinyl" ? "Cut" : "Price"}
            />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    {!grid ? (
                      <th className="px-2 py-2">
                        <input
                          type="checkbox"
                          aria-label="Select all"
                          checked={
                            allRows.length > 0 && selected.size >= allRows.length
                          }
                          onChange={toggleAll}
                          className="size-4 rounded border-input"
                        />
                      </th>
                    ) : null}
                    <th className="px-2 py-2 text-left">Name</th>
                    <th className="px-2 py-2 text-left">Category</th>
                    <th className="px-2 py-2 text-left">SKU</th>
                    <th className="px-2 py-2 text-left">Mfr</th>
                    <th className="px-2 py-2 text-right">Price</th>
                    {!grid ? <th className="px-2 py-2"></th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(grid ? finalRows : (rows ?? [])).slice(0, shown).map((r, i) => (
                    <tr key={i}>
                      {grid ? (
                        (() => {
                          const st = validateRow(r);
                          const flagged = st.level === "flag";
                          return (
                            <>
                              <td className="px-2 py-1">
                                {r.name}
                                {flagged ? (
                                  <span className="ml-1 text-xs font-medium text-destructive" title={st.reason}>
                                    ⚠ {st.reason}
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-2 py-1 text-muted-foreground">{r.category}</td>
                              <td className="px-2 py-1 text-muted-foreground">{r.sku ?? "—"}</td>
                              <td className="px-2 py-1 text-muted-foreground">{r.manufacturer ?? "—"}</td>
                              <td className={cn("px-2 py-1 text-right tabular-nums", flagged && "font-semibold text-destructive")}>
                                {r.material_rate != null ? `$${r.material_rate}` : "—"}
                                <span className="text-xs font-normal text-muted-foreground">/{r.unit}</span>
                              </td>
                            </>
                          );
                        })()
                      ) : (
                        <>
                          <td className="px-2 py-1 align-middle">
                            <input
                              type="checkbox"
                              aria-label={`Select ${r.name || "row"}`}
                              checked={selected.has(i)}
                              onChange={() => toggleRow(i)}
                              className="size-4 rounded border-input"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input value={r.name} onChange={(e) => updateRow(i, { name: e.target.value })} className={cn(inputSm, "min-w-40")} />
                          </td>
                          <td className="px-2 py-1">
                            <SearchPicker
                              className="w-32"
                              value={isCatalogProductCategory(r.category) ? r.category : ""}
                              onChange={(v) => updateRow(i, { category: v })}
                              options={CATALOG_CATEGORY_OPTIONS}
                              placeholder={isLaborCategory(r.category) ? "Pick a material" : "Category"}
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input value={r.sku ?? ""} onChange={(e) => updateRow(i, { sku: e.target.value })} className={cn(inputSm, "w-24")} />
                          </td>
                          <td className="px-2 py-1">
                            <input value={defManufacturer.trim() ? defManufacturer.trim() : (r.manufacturer ?? "")} onChange={(e) => updateRow(i, { manufacturer: e.target.value })} disabled={!!defManufacturer.trim()} title={defManufacturer.trim() ? "Set by the whole-list manufacturer above — clear it to edit rows individually" : undefined} className={cn(inputSm, "w-24", defManufacturer.trim() && "opacity-70")} />
                          </td>
                          <td className="px-2 py-1">
                            <input type="number" step="0.01" aria-label={`Price for ${r.name || "row"}`} value={r.material_rate ?? ""} onChange={(e) => updateRow(i, { material_rate: e.target.value ? Number(e.target.value) : null })} className={cn(inputSm, "w-24 text-right")} />
                          </td>
                          <td className="px-2 py-1 text-right">
                            <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => removeRow(i)}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {finalRows.length > shown ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    Showing {Math.min(shown, finalRows.length)} of{" "}
                    {finalRows.length}.{" "}
                    {grid
                      ? "All will import."
                      : "Use Show all to see, select, and edit every row."}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShown((n) => n + 100)}
                    >
                      Show 100 more
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShown(finalRows.length)}
                    >
                      Show all {finalRows.length}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Loud pre-commit summary — exactly what will and won't be written. */}
          {finalRows.length > 0 ? (
            <div className={cn(
              "rounded-md border p-3 text-sm",
              flaggedCount ? "border-amber-400 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-950/30" : "border-emerald-400 bg-emerald-50 dark:border-emerald-500/50 dark:bg-emerald-950/30",
            )}>
              <span className="font-semibold">{okCount}</span> will import ·{" "}
              <span className={cn("font-semibold", flaggedCount && "text-amber-700 dark:text-amber-400")}>
                {flaggedCount} flagged
              </span>{" "}
              {flaggedCount
                ? "— held back (bad or implausible price/unit). Fix the mapping/unit or correct the rows, then re-import them."
                : "— every row's price and unit checks out."}
            </div>
          ) : null}

          {/* Import bar */}
          {finalRows.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 p-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={updateMode} onChange={(e) => setUpdateMode(e.target.checked)} className="size-4 rounded border-input" />
                Update existing products (match by name) instead of adding duplicates
              </label>
              <Button type="button" onClick={doImport} disabled={importing || okCount === 0 || !factsReady}>
                {importing
                  ? "Importing…"
                  : updateMode
                    ? `Update / add ${okCount}`
                    : sheetMode
                      ? `Import ${okCount} colors`
                      : `Import ${okCount} products`}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Success */}
      <Dialog open={done !== null} onOpenChange={(o) => !o && setDone(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-1 flex items-center gap-2">
              <CheckCircle2 className="size-6 text-primary" />
              <DialogTitle>Import complete</DialogTitle>
            </div>
            <DialogDescription>
              Added{" "}
              <strong className="text-foreground">
                {done} product{done === 1 ? "" : "s"}
              </strong>{" "}
              to your catalog.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDone(null)}>
              Import another
            </Button>
            <Link href="/catalog" className={buttonVariants()}>
              View catalog
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function withoutColorNumber(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const stripped = notes
    .replace(/Color\s*#\s*[A-Za-z0-9][A-Za-z0-9./-]*/gi, "")
    .replace(/\s*·\s*·\s*/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();
  return stripped || null;
}

/** Review for a PDF price sheet: style, color, cut, roll. Nothing else. */
function SheetColorTable({
  rows,
  shown,
  priceLabel,
  onShowMore,
  onShowAll,
  onPatch,
  onRemove,
}: {
  rows: PriceRow[];
  shown: number;
  priceLabel: string;
  onShowMore: () => void;
  onShowAll: () => void;
  onPatch: (index: number, patch: Partial<PriceRow>) => void;
  onRemove: (index: number) => void;
}) {
  const visible = rows.slice(0, shown);
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-xs text-muted-foreground">
          <tr>
            <th className="px-2 py-2 text-left">Style</th>
            <th className="px-2 py-2 text-left">Color</th>
            <th className="px-2 py-2 text-right">{priceLabel}</th>
            <th className="px-2 py-2 text-right">Roll</th>
            <th className="px-2 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {visible.map((r, i) => {
            const status = validateRow(r, { sheet: true });
            const colorNo = colorNumberFromText(r.notes) ?? "";
            return (
              <tr key={i}>
                <td className="px-2 py-1 align-top">
                  <input
                    value={r.style ?? ""}
                    onChange={(e) => onPatch(i, { style: e.target.value })}
                    aria-label="Style"
                    className={cn(inputSm, "min-w-36")}
                  />
                  <input
                    value={r.sku ?? ""}
                    onChange={(e) => onPatch(i, { sku: e.target.value || null })}
                    aria-label="Style number"
                    placeholder="Style #"
                    className={cn(inputSm, "mt-1 w-28 text-xs")}
                  />
                </td>
                <td className="px-2 py-1 align-top">
                  <input
                    value={r.color ?? ""}
                    onChange={(e) => onPatch(i, { color: e.target.value })}
                    aria-label="Color"
                    className={cn(inputSm, "min-w-32")}
                  />
                  <input
                    value={colorNo}
                    onChange={(e) => {
                      const folded = foldCatalogColor(
                        r.color,
                        e.target.value,
                        withoutColorNumber(r.notes),
                      );
                      onPatch(i, { color: folded.color, notes: folded.notes });
                    }}
                    aria-label="Color number"
                    placeholder="Color #"
                    className={cn(inputSm, "mt-1 w-28 text-xs")}
                  />
                  {status.level === "flag" ? (
                    <div className="mt-1 text-xs font-medium text-destructive">{status.reason}</div>
                  ) : null}
                </td>
                <td className="px-2 py-1 align-top">
                  <input
                    type="number"
                    step="0.01"
                    value={r.material_rate ?? ""}
                    onChange={(e) =>
                      onPatch(i, {
                        material_rate: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    aria-label={priceLabel}
                    className={cn(inputSm, "w-24 text-right")}
                  />
                </td>
                <td className="px-2 py-1 align-top">
                  <input
                    type="number"
                    step="0.01"
                    value={r.roll_rate ?? ""}
                    onChange={(e) =>
                      onPatch(i, {
                        roll_rate: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    aria-label="Roll price"
                    placeholder="—"
                    className={cn(inputSm, "w-24 text-right")}
                  />
                </td>
                <td className="px-2 py-1 text-right align-top">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove"
                    onClick={() => onRemove(i)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > shown ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span>
            Showing {Math.min(shown, rows.length)} of {rows.length}.
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onShowMore}>
              Show 100 more
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onShowAll}>
              Show all {rows.length}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SourceIcon({ how }: { how?: Source["how"] }) {
  if (how === "spreadsheet") return <FileSpreadsheet className="size-4 text-emerald-600" />;
  if (how === "pdf") return <FileText className="size-4 text-rose-600" />;
  if (how === "image") return <ImageIcon className="size-4 text-violet-600" />;
  return <FileText className="size-4 text-muted-foreground" />;
}

// Guaranteed offline parser: one product per line. Pulls a price and a SKU out
// of each line and uses the rest as the name. Coarse, but it always returns
// reviewable rows from any extracted text — no AI needed.
function localLineParse(text: string): PriceRow[] {
  const rows: PriceRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length < 3) continue;
    if (!/[a-z]/i.test(line)) continue; // skip pure number/symbol lines
    let name = line;
    let sku: string | null = null;
    let rate: number | null = null;

    const parts = line.includes("\t")
      ? line.split("\t")
      : /\s{2,}/.test(line)
        ? line.split(/\s{2,}/)
        : line.includes(",")
          ? line.split(",")
          : null;

    if (parts && parts.length > 1) {
      const cells = parts.map((p) => p.trim()).filter(Boolean);
      name = cells[0] || line;
      let repaired: number | null = null;
      for (let k = cells.length - 1; k >= 1; k--) {
        const n = unitPriceCell(cells[k], "price");
        if (n == null) continue;
        if (!Number.isInteger(n)) {
          rate = n;
          repaired = null;
          break;
        }
        if (repaired == null) repaired = n;
      }
      if (rate == null) rate = repaired;
      const skuCell = cells
        .slice(1)
        .find((c) => /[a-z]/i.test(c) && /\d/.test(c) && c.length <= 20);
      if (skuCell) sku = skuCell;
    } else {
      const m =
        line.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/) ||
        line.match(/\b([0-9]+\.[0-9]{2})\b/);
      if (m) rate = parseFloat(m[1]);
      const skuM = line.match(/\b(?:sku|item|style)\s*#?\s*([a-z0-9-]{3,})/i);
      if (skuM) sku = skuM[1];
      name =
        line
          .replace(/\$\s*[0-9.]+/g, " ")
          .replace(/\b(?:sku|item|style)\s*#?\s*[a-z0-9-]+/gi, " ")
          .replace(/\s{2,}/g, " ")
          .trim() || line;
    }
    if (name.replace(/[^a-z]/gi, "").length < 2) continue;
    rows.push({
      name,
      category: "other",
      unit: "sqft",
      sku,
      material_rate: rate,
      labor_rate: null,
      manufacturer: null,
      style: null,
      color: null,
      notes: null,
    });
  }
  return rows;
}

// Light CSV/TSV text → grid (for .txt files that are really delimited).
function csvTextToGrid(text: string): string[][] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const delim = lines[0].includes("\t") ? "\t" : lines[0].includes(",") ? "," : null;
  if (!delim) return null;
  return lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, "")));
}
