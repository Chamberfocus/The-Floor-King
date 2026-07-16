"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import {
  PRODUCT_CATEGORY_LABELS,
  PRODUCT_CATEGORY_ORDER,
  type Product,
} from "@/lib/types";
import { createProductInline, searchCatalogProducts } from "../catalog/actions";
import { SegmentedField } from "@/components/ui/segmented-field";
import { UNIT_OPTIONS, defaultUnitForCategory, unitLabel } from "@/lib/units";

const inputSm =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function productLabel(p: Product): string {
  return [p.manufacturer, p.name, p.color].filter(Boolean).join(" ");
}

/**
 * Searchable catalog picker for an estimate line. Searches the catalog
 * server-side (so it stays fast with thousands of products) by name /
 * manufacturer / style / color / SKU, or adds a brand-new product.
 */
export interface CustomProductInput {
  name: string;
  category: string;
  unit: string;
  material_rate: string;
  labor_rate: string;
  manufacturer: string;
  style: string;
  color: string;
  sku: string;
}

export function ProductPicker({
  value,
  initialLabel = "",
  label = "Material (from catalog)",
  defaultCategory,
  fullWidth = false,
  onPick,
  onCreated,
  onUseOnce,
}: {
  value: string;
  initialLabel?: string;
  label?: string;
  defaultCategory?: string;
  /** Make the search field + results span the full container (roomier typing). */
  fullWidth?: boolean;
  onPick: (product: Product | null) => void;
  onCreated: (product: Product) => void;
  /** Add a one-off product to this estimate only, without saving to the catalog. */
  onUseOnce?: (input: CustomProductInput) => void;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState(initialLabel);
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the field in sync when the line's product changes elsewhere.
  useEffect(() => {
    setQ(initialLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, initialLabel]);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
        setQ(initialLabel);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, initialLabel]);

  // Debounced server-side search while the dropdown is open.
  useEffect(() => {
    if (!open || adding) return;
    setLoading(true);
    const term = q.trim() === initialLabel.trim() ? "" : q;
    const t = setTimeout(async () => {
      try {
        setResults(await searchCatalogProducts(term));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, open, adding, initialLabel]);

  const matches = results;

  // Reset the highlight when the list changes; keep it in range.
  useEffect(() => {
    setActiveIndex(0);
  }, [q, open]);

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    if (!open || adding) return;
    const el = listRef.current?.children[activeIndex] as
      | HTMLElement
      | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, adding]);

  // total = number of product rows; index === total is the "Add to catalog" row.
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((i) => Math.min(i + 1, matches.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (!open || adding) return;
      e.preventDefault();
      if (activeIndex < matches.length) {
        const p = matches[activeIndex];
        if (p) {
          onPick(p);
          setOpen(false);
        }
      } else {
        setAdding(true); // highlighted the "Add to catalog" row
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setAdding(false);
      setQ(initialLabel);
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <label className="mb-1 block text-xs text-muted-foreground">
        {label}
      </label>
      <div className={cn("relative w-full", fullWidth ? "" : "sm:w-72")}>
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
          onKeyDown={onKeyDown}
          placeholder="Type a product name…"
          className={cn(inputSm, "w-full pl-8 pr-7", fullWidth && "h-11 text-base")}
        />
        {value ? (
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
        <div
          className={cn(
            "absolute z-30 mt-1 max-h-[min(70vh,32rem)] overflow-y-auto overscroll-contain rounded-md border bg-popover shadow-lg",
            fullWidth ? "w-full" : "w-[min(32rem,calc(100vw-2rem))]",
          )}
        >
          {
            <>
              <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
                {matches.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-muted-foreground">
                    {loading ? "Searching…" : "No match in the catalog."}
                  </p>
                ) : (
                  matches.map((p, i) => {
                    const installed = p.material_rate + p.labor_rate;
                    const isCarpet = p.category === "carpet";
                    const perSqyd = (p.unit || "").toLowerCase().includes("yd")
                      ? installed
                      : installed * 9;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onMouseEnter={() => setActiveIndex(i)}
                        onClick={() => {
                          onPick(p);
                          setOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm",
                          i === activeIndex ? "bg-muted/70" : "hover:bg-muted/60",
                        )}
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
                          <span className="mt-0.5 flex flex-wrap gap-1">
                            {p.clearance && p.clearance_price != null ? (
                              <span className="inline-block rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                                🔖 Clearance {formatMoney(p.clearance_price)}/
                                {p.unit}
                              </span>
                            ) : null}
                            {p.track_stock ? (
                              <span
                                className={cn(
                                  "inline-block rounded px-1.5 py-0.5 text-xs font-medium",
                                  p.on_hand > 0
                                    ? "bg-emerald-100 text-emerald-700"
                                    : "bg-amber-100 text-amber-700",
                                )}
                              >
                                {p.on_hand > 0
                                  ? `In stock: ${p.on_hand} ${p.unit}`
                                  : "Out of stock — order"}
                              </span>
                            ) : null}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block font-medium tabular-nums">
                            {formatMoney(installed)}
                            <span className="font-normal text-muted-foreground">
                              /{p.unit}
                            </span>
                          </span>
                          {isCarpet ? (
                            <span className="block text-xs font-medium tabular-nums text-primary">
                              {formatMoney(perSqyd)}/sq yd
                            </span>
                          ) : null}
                          <span className="block text-xs tabular-nums text-muted-foreground">
                            mat {formatMoney(p.material_rate)} · lab{" "}
                            {formatMoney(p.labor_rate)}
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              <div className="border-t p-1">
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(matches.length)}
                  onClick={() => {
                    setAdding(true);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-2 text-sm font-medium text-primary",
                    activeIndex === matches.length
                      ? "bg-primary/10"
                      : "hover:bg-primary/5",
                  )}
                >
                  <Plus className="size-4" />
                  Add{q.trim() ? ` “${q.trim()}”` : " a new product"} to catalog
                </button>
              </div>
            </>
          }
        </div>
      ) : null}

      {/* Add a product — roomy modal so every field (unit, cost, price) is clear. */}
      <Dialog
        open={adding}
        onOpenChange={(o) => {
          setAdding(o);
          if (!o) setOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add a product</DialogTitle>
            <DialogDescription>
              Saved to your catalog so it&apos;s reusable — with its own unit,
              cost, and price. Pick the unit carefully: it drives the pricing math.
            </DialogDescription>
          </DialogHeader>
          <AddProductForm
            initialName={q}
            initialCategory={defaultCategory}
            onCancel={() => {
              setAdding(false);
              setOpen(false);
            }}
            onCreated={(p) => {
              onCreated(p);
              setOpen(false);
              setAdding(false);
            }}
            onUseOnce={
              onUseOnce
                ? (input) => {
                    onUseOnce(input);
                    setOpen(false);
                    setAdding(false);
                  }
                : undefined
            }
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddProductForm({
  initialName,
  initialCategory,
  onCancel,
  onCreated,
  onUseOnce,
}: {
  initialName: string;
  initialCategory?: string;
  onCancel: () => void;
  onCreated: (p: Product) => void;
  onUseOnce?: (input: CustomProductInput) => void;
}) {
  const [saving, startSave] = useTransition();
  const [unitTouched, setUnitTouched] = useState(false);
  const [f, setF] = useState({
    name: initialName,
    manufacturer: "",
    style: "",
    color: "",
    category: initialCategory || "lvp",
    unit: defaultUnitForCategory(initialCategory || "lvp"),
    sku: "",
    material_rate: "",
    labor_rate: "",
  });
  const set = (patch: Partial<typeof f>) => setF((p) => ({ ...p, ...patch }));
  // Changing the category re-suggests the unit — until the user picks one
  // themselves, at which point their choice sticks.
  const setCategory = (category: string) =>
    setF((p) => ({
      ...p,
      category,
      unit: unitTouched ? p.unit : defaultUnitForCategory(category),
    }));
  const pickUnit = (unit: string) => {
    setUnitTouched(true);
    set({ unit });
  };

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

  const useOnce = () => {
    if (!f.name.trim()) {
      toast.error("Give the product a name.");
      return;
    }
    onUseOnce?.(f);
  };

  const rateLbl = `$ / ${unitLabel(f.unit) || "unit"}`;

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Product name *
        </label>
        <Input
          autoFocus
          value={f.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="e.g. Mapei self-leveler"
          className="h-10"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Input
          value={f.manufacturer}
          onChange={(e) => set({ manufacturer: e.target.value })}
          placeholder="Manufacturer"
          className="h-10"
        />
        <Input
          value={f.style}
          onChange={(e) => set({ style: e.target.value })}
          placeholder="Style"
          className="h-10"
        />
        <Input
          value={f.color}
          onChange={(e) => set({ color: e.target.value })}
          placeholder="Color"
          className="h-10"
        />
        <Input
          value={f.sku}
          onChange={(e) => set({ sku: e.target.value })}
          placeholder="SKU / item #"
          className="h-10"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Category
        </label>
        <SegmentedField
          size="sm"
          value={f.category}
          onChange={setCategory}
          options={PRODUCT_CATEGORY_ORDER.map((c) => ({
            value: c,
            label: PRODUCT_CATEGORY_LABELS[c],
          }))}
        />
      </div>

      {/* Unit — the one thing you can't get wrong. Prominent, tap to choose. */}
      <div className="rounded-lg border bg-muted/30 p-2.5">
        <label className="mb-1.5 block text-xs font-semibold">
          Sold by <span className="text-destructive">*</span>
          <span className="ml-1 font-normal text-muted-foreground">
            — how this item is priced
          </span>
        </label>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-14 shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
              Area
            </span>
            {UNIT_OPTIONS.filter((u) => u.kind === "area").map((u) => (
              <UnitChip key={u.value} label={u.label} active={f.unit === u.value} onClick={() => pickUnit(u.value)} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-14 shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
              By item
            </span>
            {UNIT_OPTIONS.filter((u) => u.kind === "count").map((u) => (
              <UnitChip key={u.value} label={u.label} active={f.unit === u.value} onClick={() => pickUnit(u.value)} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Our cost ({rateLbl})
          </label>
          <Input
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={f.material_rate}
            onChange={(e) => set({ material_rate: e.target.value })}
            placeholder="cost"
            className="h-10"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Labor ({rateLbl}) — optional
          </label>
          <Input
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={f.labor_rate}
            onChange={(e) => set({ labor_rate: e.target.value })}
            placeholder="labor"
            className="h-10"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {onUseOnce ? (
          <Button type="button" variant="outline" onClick={useOnce} disabled={saving}>
            Use once
          </Button>
        ) : null}
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? "Adding…" : "Add to catalog"}
        </Button>
      </div>
      {onUseOnce ? (
        <p className="text-[11px] text-muted-foreground">
          <strong>Use once</strong> puts it on this estimate only.{" "}
          <strong>Add to catalog</strong> also saves it for next time (name, unit,
          cost & price) so it&apos;s reusable.
        </p>
      ) : null}
    </div>
  );
}

function UnitChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-2.5 py-1 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}
