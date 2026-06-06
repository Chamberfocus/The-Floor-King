"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles, Upload, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  PRODUCT_CATEGORY_LABELS,
  PRODUCT_CATEGORY_ORDER,
} from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { pdfToText, chunkText } from "@/lib/pdf-client";
import type { PriceRow } from "@/lib/extract";
import { parsePriceList, importProducts } from "./import-actions";

const inputSm =
  "h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PriceListImporter() {
  const router = useRouter();
  const [rows, setRows] = useState<PriceRow[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [reading, startReading] = useTransition();
  const [importing, startImport] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
        const f = fileRef.current?.files?.[0];
        const pasted = textRef.current?.value ?? "";
        let rows: PriceRow[] = [];

        if (f && f.type === "application/pdf") {
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
            rows = await parseTextChunks(text);
          } else {
            setStatus(
              "No selectable text found (scanned PDF) — reading it as an image…",
            );
            rows = await parseViaStorage(f);
          }
        } else if (f) {
          setStatus("Reading the image…");
          rows = await parseViaStorage(f);
        } else if (pasted.trim()) {
          setStatus("Parsing pasted text…");
          rows = await parseTextChunks(pasted);
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
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-muted-foreground">
            …or upload a file (PDF / image):
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,image/*"
              className="ml-2 text-sm"
            />
          </label>
        </div>
        <Button type="button" onClick={read} disabled={reading}>
          {reading ? (
            <>
              <Sparkles className="size-4 animate-pulse" /> Reading…
            </>
          ) : (
            <>
              <Upload className="size-4" /> Read price list
            </>
          )}
        </Button>
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
    </div>
  );
}
