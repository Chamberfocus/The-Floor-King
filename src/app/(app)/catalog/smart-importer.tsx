"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  FileUp,
  X,
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
import { fileToGrid, chunkText } from "@/lib/pdf-client";
import {
  parseStructuredRows,
  buildCatalogTemplate,
  mapCategory,
  normUnit,
} from "@/lib/catalog-csv";
import {
  PRODUCT_CATEGORY_LABELS,
  PRODUCT_CATEGORY_ORDER,
} from "@/lib/types";
import type { PriceRow } from "@/lib/extract";
import {
  parsePriceList,
  importProducts,
  extractStoragePdfText,
} from "./import-actions";

const inputSm =
  "h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Spreadsheet column fields, with header synonyms for auto-mapping.
const FIELDS: { key: string; label: string; syn: string[] }[] = [
  { key: "name", label: "Product name", syn: ["name", "productname", "product", "itemname", "description", "itemdescription"] },
  { key: "material_rate", label: "Material / cost", syn: ["unitprice", "price", "cost", "materialrate", "material", "yourcost", "dealerprice", "netprice", "msrp", "unitcost"] },
  { key: "labor_rate", label: "Labor", syn: ["laborrate", "labor", "labour", "install", "installrate"] },
  { key: "sku", label: "SKU / item #", syn: ["sku", "style", "styleno", "stylenumber", "item", "itemno", "itemnumber", "partno", "partnumber", "productcode", "code"] },
  { key: "manufacturer", label: "Manufacturer", syn: ["manufacturer", "mfg", "mfr", "brand", "vendor", "supplier", "mill", "sellingcompanyname"] },
  { key: "style", label: "Style", syn: ["stylename", "pattern", "collection", "series", "design"] },
  { key: "color", label: "Color", syn: ["colorname", "color", "colour", "shade", "finish"] },
  { key: "category", label: "Category", syn: ["category", "prodtype", "producttype", "type", "flooringtype"] },
  { key: "unit", label: "Unit", syn: ["unit", "uom", "unitofmeasure", "priceper"] },
  { key: "notes", label: "Notes", syn: ["notes", "note", "comments", "remarks", "size"] },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const toNum = (v: string): number | null => {
  if (!v) return null;
  const n = parseFloat(v.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

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

export function SmartImporter({ suppliers = [] }: { suppliers?: string[] }) {
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
  const [defCategory, setDefCategory] = useState("other");
  const [defUnit, setDefUnit] = useState("sqft");
  const [defSupplier, setDefSupplier] = useState("");
  const [defManufacturer, setDefManufacturer] = useState("");
  const [rows, setRows] = useState<PriceRow[] | null>(null);
  // Row indices selected for a bulk change (editable / AI-rows path).
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkCat, setBulkCat] = useState("carpet");

  // import
  const [updateMode, setUpdateMode] = useState(false);
  const [importing, startImport] = useTransition();
  const [done, setDone] = useState<number | null>(null);

  const reset = () => {
    setSource(null);
    setGrid(null);
    setMap({});
    setRows(null);
    setSelected(new Set());
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
  const parseTextSmart = async (text: string): Promise<PriceRow[]> => {
    const structured = parseStructuredRows(text);
    if (structured?.length) {
      setStatus(`Recognized ${structured.length} rows from the columns — no AI needed.`);
      return structured;
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
              finishRows(structured, { name: file.name, how: "pdf" });
              return;
            }
            if (text && text.trim().length >= 20) {
              const rows = await parseTextSmart(text); // chunked AI, short calls
              if (rows.length) {
                finishRows(rows, { name: file.name, how: "pdf" });
                return;
              }
            }
            // No usable text → it's a scan. One AI-vision call on the document.
            setStatus("Reading the scanned PDF with AI…");
            const fd = new FormData();
            fd.set("storage_path", path);
            fd.set("storage_mime", "application/pdf");
            const res = await parsePriceList(fd);
            if (res.rows?.length) {
              finishRows(res.rows, { name: file.name, how: "image" });
            } else {
              toast.error(res.error || "Couldn't read that PDF.");
              setStatus(
                res.error ||
                  "Couldn't read that PDF. Try the Excel/CSV, or paste the rows above.",
              );
            }
            return;
          }
          // Photo / image: single AI-vision call.
          if (isImage) {
            setStatus("Reading the photo with AI…");
            const fd = new FormData();
            fd.set("file", file);
            const res = await parsePriceList(fd);
            if (res.rows?.length) {
              finishRows(res.rows, { name: file.name, how: "image" });
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

  const finishRows = (r: PriceRow[], src: Source) => {
    setStatus(null);
    setSource(src);
    setRows(r);
    if (r.length) toast.success(`Found ${r.length} products — review & import`);
    else toast.error("No products found. Try a clearer file, or paste the rows as text.");
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
      out.push({
        name,
        category: catCell ? mapCategory(catCell) : defCategory,
        unit: unitCell ? normUnit(unitCell) : defUnit,
        sku: cell(row, "sku") || null,
        material_rate: toNum(cell(row, "material_rate")),
        labor_rate: toNum(cell(row, "labor_rate")),
        manufacturer: cell(row, "manufacturer") || null,
        style: cell(row, "style") || null,
        color: cell(row, "color") || null,
        notes: cell(row, "notes") || null,
      });
    }
    return out;
  };

  // One manufacturer for the whole download. When set, it OVERRIDES every row —
  // a price list is usually a single brand, so "set it once" means force it on
  // all of them (not just fill the blanks). Clear the field to keep each row's
  // own manufacturer.
  const applyDefaults = (list: PriceRow[]): PriceRow[] => {
    const mfr = defManufacturer.trim();
    if (!mfr) return list;
    return list.map((r) => ({ ...r, manufacturer: mfr }));
  };

  const finalRows = applyDefaults(grid ? buildFromGrid() : (rows ?? []));

  const doImport = () =>
    startImport(async () => {
      const built = applyDefaults(grid ? buildFromGrid() : rows ?? []);
      if (!built.length) {
        toast.error("Nothing to import yet.");
        return;
      }
      const res = await importProducts(built, {
        update: updateMode,
        supplier: defSupplier.trim() || undefined,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setDone(res.count ?? built.length);
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
    if (!selected.size) return;
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
    let changed = 0;
    setRows((prev) =>
      prev
        ? prev.map((r) => {
            const kind = guessKind(r.name);
            if (kind && kind !== r.category) {
              changed++;
              return { ...r, category: kind };
            }
            return r;
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
  return (
    <div className="space-y-5">
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
              {reading ? "Reading…" : "Drop your price list — or click to choose"}
            </span>
            <span className="text-sm text-muted-foreground">
              Excel, CSV, PDF, an image/scan, or anything. We figure out the rest.
            </span>
            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><FileSpreadsheet className="size-3.5" /> Excel/CSV — instant</span>
              <span className="inline-flex items-center gap-1"><FileText className="size-3.5" /> PDF — read automatically</span>
              <span className="inline-flex items-center gap-1"><ImageIcon className="size-3.5" /> Photo/scan — AI</span>
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

          {/* Applies to the whole download — a price list is usually one vendor
              and one brand, so set them once instead of row by row. */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Order from (vendor):
              </span>
              <Input
                value={defSupplier}
                onChange={(e) => setDefSupplier(e.target.value)}
                placeholder="e.g. local distributor"
                list="importer-supplier-options"
                className="h-8 w-48"
              />
              {suppliers.length ? (
                <datalist id="importer-supplier-options">
                  {suppliers.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Manufacturer / brand:
              </span>
              <Input
                value={defManufacturer}
                onChange={(e) => setDefManufacturer(e.target.value)}
                placeholder="e.g. Shaw — sets every row"
                title="Sets this manufacturer on every product in the list. Leave blank to keep each row's own."
                className="h-8 w-56"
              />
            </div>
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
                    onChange={setDefCategory}
                    options={PRODUCT_CATEGORY_ORDER.map((c) => ({ value: c, label: PRODUCT_CATEGORY_LABELS[c] }))}
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
          {!grid && rows && rows.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2 text-sm">
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
                    options={PRODUCT_CATEGORY_ORDER.map((c) => ({
                      value: c,
                      label: PRODUCT_CATEGORY_LABELS[c],
                    }))}
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
                    <th className="px-2 py-2 text-right">Material</th>
                    <th className="px-2 py-2 text-right">Labor</th>
                    {!grid ? <th className="px-2 py-2"></th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(grid ? finalRows.slice(0, 12) : (rows ?? []).slice(0, 60)).map((r, i) => (
                    <tr key={i}>
                      {grid ? (
                        <>
                          <td className="px-2 py-1">{r.name}</td>
                          <td className="px-2 py-1 text-muted-foreground">{r.category}</td>
                          <td className="px-2 py-1 text-muted-foreground">{r.sku ?? "—"}</td>
                          <td className="px-2 py-1 text-muted-foreground">{r.manufacturer ?? "—"}</td>
                          <td className="px-2 py-1 text-right">{r.material_rate ?? "—"}</td>
                          <td className="px-2 py-1 text-right">{r.labor_rate ?? "—"}</td>
                        </>
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
                              value={PRODUCT_CATEGORY_ORDER.includes(r.category as never) ? r.category : "other"}
                              onChange={(v) => updateRow(i, { category: v })}
                              options={PRODUCT_CATEGORY_ORDER.map((c) => ({ value: c, label: PRODUCT_CATEGORY_LABELS[c] }))}
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input value={r.sku ?? ""} onChange={(e) => updateRow(i, { sku: e.target.value })} className={cn(inputSm, "w-24")} />
                          </td>
                          <td className="px-2 py-1">
                            <input value={defManufacturer.trim() ? defManufacturer.trim() : (r.manufacturer ?? "")} onChange={(e) => updateRow(i, { manufacturer: e.target.value })} disabled={!!defManufacturer.trim()} title={defManufacturer.trim() ? "Set by the whole-list manufacturer above — clear it to edit rows individually" : undefined} className={cn(inputSm, "w-24", defManufacturer.trim() && "opacity-70")} />
                          </td>
                          <td className="px-2 py-1">
                            <input type="number" step="0.01" value={r.material_rate ?? ""} onChange={(e) => updateRow(i, { material_rate: e.target.value ? Number(e.target.value) : null })} className={cn(inputSm, "w-20 text-right")} />
                          </td>
                          <td className="px-2 py-1">
                            <input type="number" step="0.01" value={r.labor_rate ?? ""} onChange={(e) => updateRow(i, { labor_rate: e.target.value ? Number(e.target.value) : null })} className={cn(inputSm, "w-20 text-right")} />
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
              {finalRows.length > (grid ? 12 : 60) ? (
                <p className="border-t bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
                  + {finalRows.length - (grid ? 12 : 60)} more will import
                </p>
              ) : null}
            </div>
          )}

          {/* Import bar */}
          {finalRows.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 p-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={updateMode} onChange={(e) => setUpdateMode(e.target.checked)} className="size-4 rounded border-input" />
                Update existing products (match by name) instead of adding duplicates
              </label>
              <Button type="button" onClick={doImport} disabled={importing}>
                {importing ? "Importing…" : updateMode ? `Update / add ${finalRows.length}` : `Import ${finalRows.length} products`}
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
              Added <strong className="text-foreground">{done} product{done === 1 ? "" : "s"}</strong> to your catalog.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDone(null)}>Import another</Button>
            <Link href="/catalog" className={buttonVariants()}>View catalog</Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
      for (let k = cells.length - 1; k >= 1; k--) {
        const n = parseFloat(cells[k].replace(/[^0-9.]/g, ""));
        if (Number.isFinite(n) && /\d/.test(cells[k]) && /[$.\d]/.test(cells[k])) {
          rate = n;
          break;
        }
      }
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
