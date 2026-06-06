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
import type { PriceRow } from "@/lib/extract";
import { parsePriceList, importProducts } from "./import-actions";

const inputSm =
  "h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PriceListImporter() {
  const router = useRouter();
  const [rows, setRows] = useState<PriceRow[] | null>(null);
  const [reading, startReading] = useTransition();
  const [importing, startImport] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const read = () =>
    startReading(async () => {
      try {
        const fd = new FormData();
        fd.set("text", textRef.current?.value ?? "");
        const f = fileRef.current?.files?.[0];
        if (f) fd.set("file", f);
        const res = await parsePriceList(fd);
        if (res.error) {
          toast.error(res.error);
          if (!res.rows?.length) return;
        }
        setRows(res.rows ?? []);
        if (res.rows?.length)
          toast.success(`Found ${res.rows.length} products — review & import`);
      } catch (e) {
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
      </div>

      {rows ? (
        rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No products parsed — try pasting the rows as plain text.
          </p>
        ) : (
          <div className="space-y-3">
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
