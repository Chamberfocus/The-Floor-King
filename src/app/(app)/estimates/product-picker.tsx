"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { productLabel } from "@/lib/product-label";
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
import {
  defaultUnitForCategory,
  unitsForCategory,
  billsBySquareYard,
  unitLabel,
  isAreaUnit,
} from "@/lib/units";

const inputSm =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
  coverage_sqft: string;
  coverage_thickness_in: string;
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
  // When a product is selected, the box shows it as a display (a pill). "Change"
  // flips this on to reveal the search field so you can swap it — you never
  // re-type the name in a second box.
  const [editing, setEditing] = useState(false);
  /**
   * A product chosen but not yet committed.
   *
   * Picking a product silently rewrites the line's cost, unit, category and
   * waste. When the line already HAS a product, that's a swap worth seeing
   * before it happens — especially the unit, since a sq ft rate on a line that
   * bills by the square yard is multiplied by nine.
   */
  const [pending, setPending] = useState<Product | null>(null);
  const [q, setQ] = useState(initialLabel);
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the field in sync when the line's product changes elsewhere. Any change
  // to the selected product (pick / swap / clear) drops back to the display pill.
  useEffect(() => {
    setQ(initialLabel);
    setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, initialLabel]);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
        setEditing(false);
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
          if (value && p.id !== value) {
            setPending(p);
            setOpen(false);
            return;
          }
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
      setEditing(false);
      setQ(initialLabel);
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <label className="mb-1 block text-xs text-muted-foreground">
        {label}
      </label>

      {/* CONFIRM A SWAP — what's actually about to change, before it changes.
          The unit is spelled out because it drives the pricing: a sq ft rate on
          a line that bills per square yard gets multiplied by nine. */}
      {pending ? (
        <div className="mb-2 rounded-lg border border-primary/50 bg-primary/5 p-3">
          <div className="text-sm font-semibold">Change this line&apos;s product?</div>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex items-baseline gap-2">
              <span className="w-10 shrink-0 text-xs text-muted-foreground">from</span>
              <span className="min-w-0 break-words text-muted-foreground line-through">
                {initialLabel || "the current product"}
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="w-10 shrink-0 text-xs text-muted-foreground">to</span>
              <span className="min-w-0 break-words font-medium">
                {productLabel(pending)}
              </span>
            </div>
          </div>
          <p className="mt-2 rounded-md bg-background/60 px-2 py-1.5 text-xs text-muted-foreground">
            Cost becomes{" "}
            <span className="font-semibold text-foreground">
              {formatMoney(pending.material_rate)} per {pending.unit || "unit"}
            </span>
            {pending.category ? (
              <> · {PRODUCT_CATEGORY_LABELS[pending.category]}</>
            ) : null}
            . This replaces the line&apos;s cost, unit and category — anything you
            typed over them is lost.
          </p>
          <div className="mt-2.5 flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onPick(pending);
                setPending(null);
                setEditing(false);
              }}
            >
              <Check className="size-4" /> Use this product
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setPending(null)}
            >
              Keep what I had
            </Button>
          </div>
        </div>
      ) : null}
      {value && !editing ? (
        /* SELECTED — show the product once, as a display. No text box to re-type
           into: "Change" reopens the search to swap it, "×" clears it. */
        <div
          className={cn(
            "flex items-start gap-2 rounded-md border border-input bg-muted/40 px-3 py-2 shadow-sm",
            fullWidth ? "min-h-11 w-full" : "min-h-9 w-full sm:w-80",
          )}
        >
          <Check className="mt-0.5 size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 break-words text-sm font-medium leading-snug">
            {initialLabel || "Selected product"}
          </span>
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setQ("");
              setOpen(true);
            }}
            className="mt-0.5 shrink-0 text-xs font-medium text-primary hover:underline"
          >
            Change
          </button>
          <button
            type="button"
            onClick={() => {
              onPick(null);
              setEditing(false);
              setQ("");
              setOpen(false);
            }}
            className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Clear product"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
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
              // Deliberately does NOT open the list. Landing in this box — or
              // opening a line to edit it — used to throw the whole catalog up
              // over the form before you'd decided you wanted to change
              // anything. Type, press the arrow key, or tap the chevron.
              e.currentTarget.select();
            }}
            onKeyDown={onKeyDown}
            autoFocus={editing}
            placeholder="Type a product name…"
            className={cn(inputSm, "w-full pl-9 pr-9 text-base", fullWidth ? "h-12" : "h-11")}
          />
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Hide the catalog" : "Browse the catalog"}
            aria-expanded={open}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronDown
              className={cn("size-4 transition-transform", open && "rotate-180")}
            />
          </button>
        </div>
      )}

      {open ? (
        <div
          className={cn(
            "absolute z-30 mt-1 overflow-hidden rounded-lg border bg-popover shadow-xl",
            fullWidth ? "w-full" : "w-[min(42rem,calc(100vw-1.5rem))]",
          )}
        >
          {
            <>
              <div ref={listRef} className="max-h-[min(65vh,32rem)] overflow-y-auto overscroll-contain py-1">
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
                          // Replacing an existing product? Stage it and ask.
                          // A first pick on an empty line commits straight away
                          // — there's nothing to lose and nothing to compare.
                          if (value && p.id !== value) {
                            setPending(p);
                            setOpen(false);
                            return;
                          }
                          onPick(p);
                          setOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-start justify-between gap-3 border-b border-border/40 px-3.5 py-3 text-left last:border-b-0",
                          i === activeIndex ? "bg-muted/70" : "hover:bg-muted/60",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start gap-1.5 text-[15px] font-semibold leading-snug">
                            {p.id === value ? (
                              <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                            ) : null}
                            <span className="break-words">{productLabel(p)}</span>
                          </span>
                          <span className="mt-0.5 block break-words text-xs text-muted-foreground">
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
    coverage_sqft: "",
    coverage_thickness_in: "",
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

  const allowedUnits = unitsForCategory(f.category);
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
        {/* Only the units this category is actually sold in. Offering all twelve
            for a carpet is how a roll ends up priced per "each" — see
            unitsForCategory. "Other" still gets the full list. */}
        <div className="space-y-1.5">
          {(["area", "count"] as const).map((kind) => {
            const opts = allowedUnits.filter((u) => u.kind === kind);
            if (!opts.length) return null;
            return (
              <div key={kind} className="flex flex-wrap items-center gap-1.5">
                <span className="w-14 shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {kind === "area" ? "Area" : "By item"}
                </span>
                {opts.map((u) => (
                  <UnitChip
                    key={u.value}
                    label={u.label}
                    active={f.unit === u.value}
                    onClick={() => pickUnit(u.value)}
                  />
                ))}
              </div>
            );
          })}
          {billsBySquareYard(f.category) ? (
            <p className="text-[11px] text-muted-foreground">
              {f.category === "underlayment"
                ? "Carpet pad is sold by the square yard; laminate underlayment usually by the square foot."
                : "Carpet and sheet vinyl are sold by the square yard — enter the price you pay per yard."}
            </p>
          ) : null}
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

      {/* Coverage — prep goods (self-leveler / patch) sold by the bag. Powers the
          estimate bag calculator. Shown for count units only. */}
      {!isAreaUnit(f.unit) ? (
        <div className="rounded-lg border bg-muted/30 p-2.5">
          <label className="mb-1.5 block text-xs font-semibold">
            Coverage — prep goods (optional)
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">SF / bag</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={f.coverage_sqft}
                onChange={(e) => set({ coverage_sqft: e.target.value })}
                placeholder="e.g. 28"
                className="h-10"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">at thickness (in)</label>
              <Input
                type="number"
                step="0.0001"
                min="0"
                inputMode="decimal"
                value={f.coverage_thickness_in}
                onChange={(e) => set({ coverage_thickness_in: e.target.value })}
                placeholder='0.25 for 1/4"'
                className="h-10"
              />
            </div>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Blank thickness = flat coverage (primers/adhesives). Self-levelers
            scale: e.g. 28 SF @ 1/4&quot;.
          </p>
        </div>
      ) : null}

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
