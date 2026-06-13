"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { FileUp, X, Zap } from "lucide-react";
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
import { fileToGrid } from "@/lib/pdf-client";
import { mapCategory, normUnit } from "@/lib/catalog-csv";
import {
  PRODUCT_CATEGORY_LABELS,
  PRODUCT_CATEGORY_ORDER,
} from "@/lib/types";
import type { PriceRow } from "@/lib/extract";
import { importProducts } from "./import-actions";

// Catalog fields we can fill, with header synonyms to auto-guess the column.
const FIELDS: { key: string; label: string; syn: string[] }[] = [
  { key: "name", label: "Product name", syn: ["name", "productname", "product", "itemname", "description", "itemdescription"] },
  { key: "material_rate", label: "Material price / cost", syn: ["unitprice", "price", "cost", "materialrate", "material", "yourcost", "dealerprice", "netprice", "msrp", "unitcost"] },
  { key: "labor_rate", label: "Labor price", syn: ["laborrate", "labor", "labour", "install", "installrate"] },
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

export function MappingImporter() {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<string, number>>({});
  const [defCategory, setDefCategory] = useState("other");
  const [defUnit, setDefUnit] = useState("sqft");
  const [updateMode, setUpdateMode] = useState(false);
  const [parsing, startParse] = useTransition();
  const [importing, startImport] = useTransition();
  const [done, setDone] = useState<number | null>(null);

  const load = (f: File) =>
    startParse(async () => {
      try {
        const grid = await fileToGrid(f);
        if (grid.length < 2) {
          toast.error("That file has no data rows.");
          return;
        }
        const head = grid[0];
        const data = grid.slice(1).filter((r) => r.some((c) => c.trim()));
        // Auto-guess each field's column from the header names.
        const guess: Record<string, number> = {};
        const normHead = head.map(norm);
        for (const fld of FIELDS) {
          guess[fld.key] = -1;
          for (const s of fld.syn) {
            const i = normHead.indexOf(norm(s));
            if (i >= 0) {
              guess[fld.key] = i;
              break;
            }
          }
        }
        setFile(f);
        setHeaders(head);
        setRows(data);
        setMap(guess);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't read that file.");
      }
    });

  const reset = () => {
    setFile(null);
    setHeaders([]);
    setRows([]);
    setMap({});
  };

  const colOptions = [
    { value: "-1", label: "— Not in file —" },
    ...headers.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` })),
  ];

  const buildRows = (): PriceRow[] => {
    const cell = (r: string[], key: string) => {
      const i = map[key];
      return i >= 0 ? (r[i] ?? "").trim() : "";
    };
    const out: PriceRow[] = [];
    for (const r of rows) {
      let name = cell(r, "name");
      if (!name) {
        // Build a name from style + color when there's no name column.
        name = [cell(r, "style"), cell(r, "color")].filter(Boolean).join(" ").trim();
      }
      if (!name) continue;
      const catCell = cell(r, "category");
      const unitCell = cell(r, "unit");
      out.push({
        name,
        category: catCell ? mapCategory(catCell) : defCategory,
        unit: unitCell ? normUnit(unitCell) : defUnit,
        sku: cell(r, "sku") || null,
        material_rate: toNum(cell(r, "material_rate")),
        labor_rate: toNum(cell(r, "labor_rate")),
        manufacturer: cell(r, "manufacturer") || null,
        style: cell(r, "style") || null,
        color: cell(r, "color") || null,
        notes: cell(r, "notes") || null,
      });
    }
    return out;
  };

  const preview = buildRows();

  const doImport = () =>
    startImport(async () => {
      const built = buildRows();
      if (!built.length) {
        toast.error("Map at least the Product name column.");
        return;
      }
      const res = await importProducts(built, { update: updateMode });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setDone(res.count ?? built.length);
      reset();
    });

  // ---- File not chosen yet: dropzone ----
  if (!file) {
    return (
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
            if (f) load(f);
          }}
          onClick={() => document.getElementById("map-file")?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
            dragOver ? "border-primary bg-primary/5" : "border-input hover:border-primary/50 hover:bg-muted/40",
          )}
        >
          <Zap className="size-6 text-primary" />
          <span className="text-sm font-medium">
            {parsing ? "Reading…" : "Drop an Excel or CSV price list — or click to choose"}
          </span>
          <span className="text-xs text-muted-foreground">
            Instant import, no AI. .xlsx, .xls, or .csv
          </span>
          <input
            id="map-file"
            type="file"
            accept=".xlsx,.xls,.csv,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) load(f);
            }}
          />
        </div>
        <ConfirmDialog done={done} onClose={() => setDone(null)} />
      </>
    );
  }

  // ---- File loaded: mapping + preview ----
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <FileUp className="size-4 text-muted-foreground" />
        <span className="font-medium">{file.name}</span>
        <span className="text-muted-foreground">· {rows.length} rows</span>
        <button
          type="button"
          onClick={reset}
          className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" /> Choose a different file
        </button>
      </div>

      <div className="rounded-lg border bg-muted/30 p-3">
        <p className="mb-2 text-sm font-medium">Match your columns</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className="flex items-center gap-2">
              <span className="w-32 shrink-0 text-xs text-muted-foreground">
                {f.label}
                {f.key === "name" ? " *" : ""}
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
              options={PRODUCT_CATEGORY_ORDER.map((c) => ({
                value: c,
                label: PRODUCT_CATEGORY_LABELS[c],
              }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Default unit:</span>
            <Input
              value={defUnit}
              onChange={(e) => setDefUnit(e.target.value)}
              className="h-8 w-20"
            />
          </div>
        </div>
      </div>

      {/* Preview */}
      <div>
        <p className="mb-1 text-xs text-muted-foreground">
          Preview — {preview.length} products will import
        </p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left">Name</th>
                <th className="px-2 py-1.5 text-left">Category</th>
                <th className="px-2 py-1.5 text-left">SKU</th>
                <th className="px-2 py-1.5 text-right">Material</th>
                <th className="px-2 py-1.5 text-right">Labor</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {preview.slice(0, 6).map((p, i) => (
                <tr key={i}>
                  <td className="px-2 py-1">{p.name}</td>
                  <td className="px-2 py-1 text-muted-foreground">{p.category}</td>
                  <td className="px-2 py-1 text-muted-foreground">{p.sku ?? "—"}</td>
                  <td className="px-2 py-1 text-right">{p.material_rate ?? "—"}</td>
                  <td className="px-2 py-1 text-right">{p.labor_rate ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={updateMode}
            onChange={(e) => setUpdateMode(e.target.checked)}
            className="size-4 rounded border-input"
          />
          Update existing products (match by name) instead of adding duplicates
        </label>
        <Button type="button" onClick={doImport} disabled={importing || !preview.length}>
          {importing
            ? "Importing…"
            : updateMode
              ? `Update / add ${preview.length}`
              : `Import ${preview.length} products`}
        </Button>
      </div>

      <ConfirmDialog done={done} onClose={() => setDone(null)} />
    </div>
  );
}

function ConfirmDialog({
  done,
  onClose,
}: {
  done: number | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={done !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import complete</DialogTitle>
          <DialogDescription>
            Added <strong className="text-foreground">{done} products</strong> to
            your catalog.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Import another
          </Button>
          <Link href="/catalog" onClick={onClose} className={buttonVariants()}>
            View catalog
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
