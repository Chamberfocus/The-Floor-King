"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Sparkles,
  Upload,
  Trash2,
  FileUp,
  X,
  Rocket,
  Download,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  PRODUCT_CATEGORY_LABELS,
  PRODUCT_CATEGORY_ORDER,
} from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { pdfToText, spreadsheetToText, chunkText } from "@/lib/pdf-client";
import { buildCatalogTemplate, parseStructuredRows } from "@/lib/catalog-csv";
import type { PriceRow } from "@/lib/extract";
import {
  parsePriceList,
  importProducts,
  startPriceListImport,
} from "./import-actions";

const inputSm =
  "h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PriceListImporter() {
  const router = useRouter();
  const [rows, setRows] = useState<PriceRow[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [reading, startReading] = useTransition();
  const [importing, startImport] = useTransition();
  const [queueing, startQueue] = useTransition();
  const [instant, setInstant] = useState<{ count: number; label: string } | null>(
    null,
  );
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    const blob = new Blob([buildCatalogTemplate()], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "floor-king-catalog-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetForm = () => {
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
    if (textRef.current) textRef.current.value = "";
    setStatus(null);
  };

  // Parse text: instant if it has recognizable columns, else AI in chunks.
  const parseTextSmart = async (text: string): Promise<PriceRow[]> => {
    const structured = parseStructuredRows(text);
    if (structured) {
      setStatus(
        `Recognized ${structured.length} rows from the column headers — no AI needed.`,
      );
      return structured;
    }
    return parseTextChunks(text);
  };

  // Extract a file/paste to plain text in the browser, or (for images/scanned
  // docs) upload it to storage and return a path the server worker can read.
  const toTextOrStorage = async (): Promise<{
    label: string;
    text?: string;
    storagePath?: string;
    storageMime?: string;
  } | null> => {
    const f = file;
    const pasted = textRef.current?.value ?? "";
    const name = (f?.name ?? "").toLowerCase();
    const type = f?.type ?? "";
    const isPdf = type === "application/pdf" || name.endsWith(".pdf");
    const isExcel =
      name.endsWith(".xlsx") ||
      name.endsWith(".xls") ||
      type.includes("spreadsheet") ||
      type.includes("excel");
    const isCsvTxt =
      name.endsWith(".csv") ||
      name.endsWith(".txt") ||
      type === "text/csv" ||
      type === "text/plain";
    const isImage = type.startsWith("image/");

    if (f && isPdf) {
      setStatus("Reading the PDF in your browser…");
      let text = "";
      try {
        text = (await pdfToText(f)).text;
      } catch {
        /* fall through to image mode */
      }
      if (text.trim().length >= 20) return { label: f.name, text };
      // Scanned PDF — upload so the server can read it as an image.
      const path = await uploadToStorage(f);
      return path ? { label: f.name, storagePath: path, storageMime: f.type } : null;
    }
    if (f && isExcel) {
      setStatus("Reading the spreadsheet in your browser…");
      return { label: f.name, text: await spreadsheetToText(f) };
    }
    if (f && isCsvTxt) {
      return { label: f.name, text: await f.text() };
    }
    if (f && isImage) {
      const path = await uploadToStorage(f);
      return path ? { label: f.name, storagePath: path, storageMime: f.type } : null;
    }
    if (f) {
      const text = await f.text().catch(() => "");
      if (text.trim().length >= 20) return { label: f.name, text };
      const path = await uploadToStorage(f);
      return path ? { label: f.name, storagePath: path, storageMime: f.type } : null;
    }
    if (pasted.trim()) return { label: "Pasted price list", text: pasted };
    return null;
  };

  const uploadToStorage = async (f: File): Promise<string | null> => {
    const supabase = createClient();
    const path = `imports/${crypto.randomUUID()}-${f.name}`;
    const { error: upErr } = await supabase.storage
      .from("documents")
      .upload(path, f, { contentType: f.type || undefined });
    if (upErr) {
      toast.error(`Upload failed: ${upErr.message}`);
      return null;
    }
    return path;
  };

  const importInBackground = () =>
    startQueue(async () => {
      setStatus(null);
      try {
        const payload = await toTextOrStorage();
        if (!payload) {
          toast.error("Choose a file or paste a price list first.");
          return;
        }

        // Already structured (our template / a clean export)? Import instantly,
        // no AI and no background job needed.
        if (payload.text) {
          const structured = parseStructuredRows(payload.text);
          if (structured) {
            setStatus(
              `Recognized ${structured.length} rows — importing instantly…`,
            );
            const imp = await importProducts(structured);
            if (imp.error) {
              toast.error(imp.error);
              return;
            }
            resetForm();
            setInstant({ count: imp.count ?? 0, label: payload.label });
            router.refresh();
            return;
          }
        }

        const res = await startPriceListImport(payload);
        if (res.error) {
          toast.error(res.error);
          return;
        }
        toast.success(
          "Importing in the background — you can keep working. We'll let you know when it's done.",
        );
        resetForm();
        router.push("/catalog");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't start the import.");
      }
    });

  const parseTextChunks = async (text: string): Promise<PriceRow[]> => {
    const chunks = chunkText(text);
    const out: PriceRow[] = [];
    let failed = 0;
    for (let i = 0; i < chunks.length; i++) {
      setStatus(
        `Reading part ${i + 1} of ${chunks.length}… (${out.length} products so far)`,
      );
      try {
        const fd = new FormData();
        fd.set("text", chunks[i]);
        const res = await parsePriceList(fd);
        if (res.rows?.length) out.push(...res.rows);
        else if (res.error && chunks.length === 1) toast.error(res.error);
      } catch {
        failed += 1; // one bad part won't kill the whole import
      }
    }
    if (failed)
      toast.error(`${failed} section(s) couldn't be read — the rest came through.`);
    return out;
  };

  const parseViaStorage = async (f: File): Promise<PriceRow[]> => {
    const supabase = createClient();
    const path = `imports/${crypto.randomUUID()}-${f.name}`;
    const { error: upErr } = await supabase.storage
      .from("documents")
      .upload(path, f, { contentType: f.type || undefined });
    if (upErr) {
      toast.error(`Upload failed: ${upErr.message}`);
      return [];
    }
    const fd = new FormData();
    fd.set("storage_path", path);
    fd.set("storage_mime", f.type ?? "");
    const res = await parsePriceList(fd);
    if (res.error && !res.rows?.length) toast.error(res.error);
    return res.rows ?? [];
  };

  const read = () =>
    startReading(async () => {
      setStatus(null);
      try {
        const f = file;
        const pasted = textRef.current?.value ?? "";
        const name = (f?.name ?? "").toLowerCase();
        const type = f?.type ?? "";
        const isPdf = type === "application/pdf" || name.endsWith(".pdf");
        const isExcel =
          name.endsWith(".xlsx") ||
          name.endsWith(".xls") ||
          type.includes("spreadsheet") ||
          type.includes("excel");
        const isCsvTxt =
          name.endsWith(".csv") ||
          name.endsWith(".txt") ||
          type === "text/csv" ||
          type === "text/plain";
        const isImage = type.startsWith("image/");
        let rows: PriceRow[] = [];

        if (f && isPdf) {
          setStatus("Reading the PDF in your browser…");
          let text = "";
          let pages = 0;
          try {
            const r = await pdfToText(f);
            text = r.text;
            pages = r.pages;
          } catch (err) {
            toast.error(
              `Couldn't read the PDF locally (${err instanceof Error ? err.message : "error"}). Trying image mode…`,
            );
          }
          if (text.trim().length >= 20) {
            setStatus(`Extracted ${text.length.toLocaleString()} characters from ${pages} page(s). Parsing…`);
            rows = await parseTextSmart(text);
          } else {
            setStatus(
              "No selectable text found (scanned PDF) — reading it as an image…",
            );
            rows = await parseViaStorage(f);
          }
        } else if (f && isExcel) {
          setStatus("Reading the spreadsheet in your browser…");
          const text = await spreadsheetToText(f);
          setStatus(`Extracted ${text.length.toLocaleString()} characters. Parsing…`);
          rows = await parseTextSmart(text);
        } else if (f && isCsvTxt) {
          setStatus("Reading the file…");
          const text = await f.text();
          setStatus(`Extracted ${text.length.toLocaleString()} characters. Parsing…`);
          rows = await parseTextSmart(text);
        } else if (f && isImage) {
          setStatus("Reading the image…");
          rows = await parseViaStorage(f);
        } else if (f) {
          // Unknown type — try as text, fall back to image.
          setStatus("Reading the file…");
          const text = await f.text().catch(() => "");
          if (text.trim().length >= 20) rows = await parseTextSmart(text);
          else rows = await parseViaStorage(f);
        } else if (pasted.trim()) {
          setStatus("Parsing pasted text…");
          rows = await parseTextSmart(pasted);
        } else {
          toast.error("Paste a price list or choose a file.");
          return;
        }

        setRows(rows);
        setStatus(null);
        if (rows.length)
          toast.success(`Found ${rows.length} products — review & import`);
        else toast.error("No products found — try pasting the rows as text.");
      } catch (e) {
        setStatus(null);
        toast.error(
          e instanceof Error ? e.message : "Something went wrong reading that.",
        );
      }
    });

  const update = (i: number, patch: Partial<PriceRow>) =>
    setRows((prev) =>
      prev ? prev.map((r, j) => (j === i ? { ...r, ...patch } : r)) : prev,
    );
  const remove = (i: number) =>
    setRows((prev) => (prev ? prev.filter((_, j) => j !== i) : prev));

  const doImport = () =>
    startImport(async () => {
      if (!rows?.length) return;
      try {
        const res = await importProducts(rows);
        if (res.error) {
          toast.error(res.error);
          return;
        }
        toast.success(`Imported ${res.count} products`);
        router.push("/catalog");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Import failed.");
      }
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3">
        <div className="text-sm">
          <p className="font-medium">Fastest way: use the catalog template</p>
          <p className="text-muted-foreground">
            Fill it in (or paste your prices into it) and import — it skips the
            AI and loads instantly, even for thousands of rows.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={downloadTemplate}>
          <Download className="size-4" /> Download template
        </Button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">
            Paste a price list
          </label>
          <textarea
            ref={textRef}
            rows={8}
            placeholder={
              "Paste rows from a vendor sheet, email, or spreadsheet — any format.\nExample:\nShaw Anso Caress carpet  SKU 1234  $3.85/sf\nMohawk RevWood laminate  $2.10 sqft"
            }
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) setFile(dropped);
          }}
          onClick={() => fileRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
            dragOver
              ? "border-primary bg-primary/5"
              : "border-input hover:border-primary/50 hover:bg-muted/40",
          )}
        >
          <FileUp className="size-6 text-muted-foreground" />
          {file ? (
            <span className="flex items-center gap-2 text-sm font-medium">
              {file.name}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Remove file"
              >
                <X className="size-4" />
              </button>
            </span>
          ) : (
            <>
              <span className="text-sm font-medium">
                Drag &amp; drop a file here, or click to choose
              </span>
              <span className="text-xs text-muted-foreground">
                Excel (.xlsx, .xls), CSV, PDF, or an image
              </span>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.xlsx,.xls,.csv,.txt,image/*"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={importInBackground}
            disabled={queueing || reading}
          >
            {queueing ? (
              <>
                <Sparkles className="size-4 animate-pulse" /> Starting…
              </>
            ) : (
              <>
                <Rocket className="size-4" /> Import in background
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={read}
            disabled={reading || queueing}
          >
            {reading ? (
              <>
                <Sparkles className="size-4 animate-pulse" /> Reading…
              </>
            ) : (
              <>
                <Upload className="size-4" /> Read &amp; review first
              </>
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          <strong>Import in background</strong> parses and adds everything for
          you while you keep working — best for big lists.{" "}
          <strong>Read &amp; review first</strong> lets you check and edit each
          product before saving.
        </p>
        {status ? (
          <p className="text-xs text-muted-foreground">{status}</p>
        ) : null}
      </div>

      {rows ? (
        rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No products parsed — try pasting the rows as plain text.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 p-3">
              <p className="text-sm font-medium">
                Step 2 — review {rows.length} product
                {rows.length === 1 ? "" : "s"}, then click Import to save.
              </p>
              <Button type="button" onClick={doImport} disabled={importing}>
                {importing ? "Importing…" : `Import ${rows.length} products`}
              </Button>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left">Name</th>
                    <th className="px-2 py-2 text-left">Category</th>
                    <th className="px-2 py-2 text-left">Unit</th>
                    <th className="px-2 py-2 text-left">SKU</th>
                    <th className="px-2 py-2 text-right">Material</th>
                    <th className="px-2 py-2 text-right">Labor</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1">
                        <input
                          value={r.name}
                          onChange={(e) => update(i, { name: e.target.value })}
                          className={cn(inputSm, "min-w-44")}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <select
                          value={
                            PRODUCT_CATEGORY_ORDER.includes(
                              r.category as never,
                            )
                              ? r.category
                              : "other"
                          }
                          onChange={(e) => update(i, { category: e.target.value })}
                          className={inputSm}
                        >
                          {PRODUCT_CATEGORY_ORDER.map((c) => (
                            <option key={c} value={c}>
                              {PRODUCT_CATEGORY_LABELS[c]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <input
                          value={r.unit}
                          onChange={(e) => update(i, { unit: e.target.value })}
                          className={cn(inputSm, "w-16")}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          value={r.sku ?? ""}
                          onChange={(e) => update(i, { sku: e.target.value })}
                          className={cn(inputSm, "w-24")}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          step="0.01"
                          value={r.material_rate ?? ""}
                          onChange={(e) =>
                            update(i, {
                              material_rate: e.target.value
                                ? Number(e.target.value)
                                : null,
                            })
                          }
                          className={cn(inputSm, "w-20 text-right")}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          step="0.01"
                          value={r.labor_rate ?? ""}
                          onChange={(e) =>
                            update(i, {
                              labor_rate: e.target.value
                                ? Number(e.target.value)
                                : null,
                            })
                          }
                          className={cn(inputSm, "w-20 text-right")}
                        />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Remove"
                          onClick={() => remove(i)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {rows.length} product{rows.length === 1 ? "" : "s"} ready. Edit
                anything, then import.
              </p>
              <Button type="button" onClick={doImport} disabled={importing}>
                {importing ? "Importing…" : `Import ${rows.length} products`}
              </Button>
            </div>
          </div>
        )
      ) : null}

      <Dialog open={!!instant} onOpenChange={(o) => !o && setInstant(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-1 flex items-center gap-2">
              <CheckCircle2 className="size-6 text-primary" />
              <DialogTitle>Import complete</DialogTitle>
            </div>
            <DialogDescription>
              Added{" "}
              <strong className="text-foreground">
                {instant?.count} product{instant?.count === 1 ? "" : "s"}
              </strong>{" "}
              to your catalog from{" "}
              <strong className="text-foreground">{instant?.label}</strong>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInstant(null)}>
              Import another
            </Button>
            <Link
              href="/catalog"
              onClick={() => setInstant(null)}
              className={buttonVariants()}
            >
              View catalog
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
