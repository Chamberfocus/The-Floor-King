"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import {
  PRODUCT_CATEGORY_LABELS,
  PRODUCT_CATEGORY_ORDER,
  type Product,
} from "@/lib/types";
import { createProductInline } from "../catalog/actions";

const inputSm =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function productLabel(p: Product): string {
  return [p.manufacturer, p.name, p.color].filter(Boolean).join(" ");
}

/**
 * Searchable catalog picker for an estimate line. Type to find a product by
 * name / manufacturer / style / color / SKU, or add a brand-new one that's
 * saved to the catalog and linked here.
 */
export function ProductPicker({
  products,
  value,
  onPick,
  onCreated,
}: {
  products: Product[];
  value: string;
  onPick: (product: Product | null) => void;
  onCreated: (product: Product) => void;
}) {
  const selected = products.find((p) => p.id === value) ?? null;

  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState(selected ? productLabel(selected) : "");
  const boxRef = useRef<HTMLDivElement>(null);

  // Keep the input text in sync when the line's product changes elsewhere
  // (e.g. picking a product, duplicating a line, or adding one inline).
  useEffect(() => {
    setQ(selected ? productLabel(selected) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
        // Restore the selected product's label if they didn't pick anything.
        setQ(selected ? productLabel(selected) : "");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, selected]);

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    const selLabel = selected ? productLabel(selected).toLowerCase() : "";
    // No query yet (or just the current selection showing) → browse the catalog.
    if (!term || term === selLabel) return products.slice(0, 40);
    return products
      .filter((p) =>
        [
          p.name,
          p.manufacturer ?? "",
          p.style ?? "",
          p.color ?? "",
          p.sku ?? "",
          PRODUCT_CATEGORY_LABELS[p.category],
        ]
          .join(" ")
          .toLowerCase()
          .includes(term),
      )
      .slice(0, 50);
  }, [products, q, selected]);

  return (
    <div ref={boxRef} className="relative">
      <label className="mb-1 block text-xs text-muted-foreground">
        Material (from catalog)
      </label>
      <div className="relative w-72">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setAdding(false);
          }}
          onFocus={(e) => {
            setOpen(true);
            e.currentTarget.select();
          }}
          placeholder="Type a product name…"
          className={cn(inputSm, "w-72 pl-8 pr-7")}
        />
        {selected ? (
          <button
            type="button"
            onClick={() => {
              onPick(null);
              setQ("");
              setOpen(false);
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear product"
          >
            <X className="size-4" />
          </button>
        ) : (
          <ChevronDown
            className="pointer-events-none absolute right-1.5 top-1/2 size-4 -translate-y-1/2 opacity-50"
          />
        )}
      </div>

      {open ? (
        <div className="absolute z-30 mt-1 w-96 rounded-md border bg-popover shadow-lg">
          {adding ? (
            <AddProductForm
              initialName={q}
              onCancel={() => setAdding(false)}
              onCreated={(p) => {
                onCreated(p);
                setOpen(false);
                setAdding(false);
              }}
            />
          ) : (
            <>
              <div className="max-h-64 overflow-y-auto py-1">
                {matches.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-muted-foreground">
                    No match in the catalog.
                  </p>
                ) : (
                  matches.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        onPick(p);
                        setOpen(false);
                      }}
                      className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/60"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1 font-medium">
                          {p.id === value ? (
                            <Check className="size-3.5 shrink-0 text-primary" />
                          ) : null}
                          <span className="truncate">{productLabel(p)}</span>
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[
                            PRODUCT_CATEGORY_LABELS[p.category],
                            p.style,
                            p.sku ? `#${p.sku}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-medium tabular-nums">
                          {formatMoney(p.material_rate + p.labor_rate)}
                          <span className="font-normal text-muted-foreground">
                            /{p.unit}
                          </span>
                        </span>
                        <span className="block text-[11px] tabular-nums text-muted-foreground">
                          mat {formatMoney(p.material_rate)} · lab{" "}
                          {formatMoney(p.labor_rate)}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
              <div className="border-t p-1">
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="flex w-full items-center gap-2 rounded px-2 py-2 text-sm font-medium text-primary hover:bg-primary/5"
                >
                  <Plus className="size-4" />
                  Add{q.trim() ? ` “${q.trim()}”` : " a new product"} to catalog
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function AddProductForm({
  initialName,
  onCancel,
  onCreated,
}: {
  initialName: string;
  onCancel: () => void;
  onCreated: (p: Product) => void;
}) {
  const [saving, startSave] = useTransition();
  const [f, setF] = useState({
    name: initialName,
    manufacturer: "",
    style: "",
    color: "",
    category: "lvp",
    unit: "sqft",
    sku: "",
    material_rate: "",
    labor_rate: "",
  });
  const set = (patch: Partial<typeof f>) => setF((p) => ({ ...p, ...patch }));

  const save = () =>
    startSave(async () => {
      if (!f.name.trim()) {
        toast.error("Give the product a name.");
        return;
      }
      const res = await createProductInline(f);
      if (res.error || !res.product) {
        toast.error(res.error ?? "Couldn't add product.");
        return;
      }
      toast.success("Added to catalog");
      onCreated(res.product);
    });

  return (
    <div className="space-y-2 p-3">
      <p className="text-sm font-medium">New catalog product</p>
      <Input
        autoFocus
        value={f.name}
        onChange={(e) => set({ name: e.target.value })}
        placeholder="Product name *"
        className="h-9"
      />
      <div className="grid grid-cols-2 gap-2">
        <Input
          value={f.manufacturer}
          onChange={(e) => set({ manufacturer: e.target.value })}
          placeholder="Manufacturer"
          className="h-9"
        />
        <Input
          value={f.style}
          onChange={(e) => set({ style: e.target.value })}
          placeholder="Style"
          className="h-9"
        />
        <Input
          value={f.color}
          onChange={(e) => set({ color: e.target.value })}
          placeholder="Color"
          className="h-9"
        />
        <Input
          value={f.sku}
          onChange={(e) => set({ sku: e.target.value })}
          placeholder="SKU / item #"
          className="h-9"
        />
        <select
          value={f.category}
          onChange={(e) => set({ category: e.target.value })}
          className={cn(inputSm, "w-full")}
        >
          {PRODUCT_CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {PRODUCT_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <Input
          value={f.unit}
          onChange={(e) => set({ unit: e.target.value })}
          placeholder="Unit (sqft)"
          className="h-9"
        />
        <Input
          type="number"
          step="0.01"
          min="0"
          value={f.material_rate}
          onChange={(e) => set({ material_rate: e.target.value })}
          placeholder="Material $/unit"
          className="h-9"
        />
        <Input
          type="number"
          step="0.01"
          min="0"
          value={f.labor_rate}
          onChange={(e) => set({ labor_rate: e.target.value })}
          placeholder="Labor $/unit"
          className="h-9"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={saving}>
          {saving ? "Adding…" : "Add & use"}
        </Button>
      </div>
    </div>
  );
}
