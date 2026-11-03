"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CATALOG_PRODUCT_CATEGORIES,
  isCatalogProductCategory,
  PRODUCT_CATEGORY_LABELS,
  type Product,
} from "@/lib/types";
import { SegmentedField } from "@/components/ui/segmented-field";
import { specFieldsFor } from "@/lib/product-fields";
import {
  createProduct,
  updateProduct,
  type ProductFormState,
} from "./actions";
import { formatMoney } from "@/lib/format";
import {
  PRICE_NEEDED,
  catalogSellPrice,
  catalogUnitCost,
  formatCatalogPrice,
} from "@/lib/catalog-pricing";

const initialState: ProductFormState = { error: null };

interface Row {
  vendorId: string;
  cost: string;
  sku: string;
}

export interface VendorOption {
  id: string;
  name: string;
  kind: string;
}

export function ProductForm({
  product,
  vendors = [],
  targetMarginPct = 40,
  freightMarkupPct = 0,
}: {
  product?: Product;
  vendors?: VendorOption[];
  targetMarginPct?: number;
  freightMarkupPct?: number;
}) {
  const isEdit = Boolean(product);
  /** A leftover labor row has to become a material before it can be saved. */
  const storedAsLabor = product?.category === "labor";
  const [category, setCategory] = useState<string>(
    storedAsLabor ? "" : (product?.category ?? "lvp"),
  );
  const [materialRate, setMaterialRate] = useState(
    product?.material_rate != null && product.material_rate !== 0
      ? String(product.material_rate)
      : "",
  );
  const [laborRate, setLaborRate] = useState(
    product?.labor_rate != null && product.labor_rate !== 0
      ? String(product.labor_rate)
      : "",
  );
  const [vendorRows, setVendorRows] = useState<Row[]>(
    product?.vendors?.length
      ? product.vendors.map((v) => ({
          vendorId: v.vendor_id,
          cost: v.cost != null ? String(v.cost) : "",
          sku: v.vendor_sku ?? "",
        }))
      : [{ vendorId: "", cost: "", sku: "" }],
  );
  /** What this KIND of product is described by — src/lib/product-fields.ts. */
  const specFields = specFieldsFor(category);
  /** Bagged goods sized from area and thickness: patch, self-leveller, primer. */
  const isPrepGood = category === "other";
  const [state, formAction, pending] = useActionState(
    isEdit ? updateProduct : createProduct,
    initialState,
  );

  useEffect(() => {
    if (state.ok) toast.success("Saved");
  }, [state]);

  const chooseCategory = (next: string) => {
    if (!isCatalogProductCategory(next)) return;
    setCategory(next);
    if (!storedAsLabor) return;
    // The old labor row kept its price in labor_rate and hid material cost.
    // Moving it onto material cost is what makes the row a product.
    setMaterialRate((cur) => {
      const n = parseFloat(cur);
      if (Number.isFinite(n) && n > 0) return cur;
      return laborRate;
    });
    setLaborRate("");
  };

  return (
    <form
      action={formAction}
      className="space-y-5"
      onSubmit={(e) => {
        if (!isCatalogProductCategory(category)) e.preventDefault();
      }}
    >
      {isEdit ? <input type="hidden" name="id" value={product!.id} /> : null}

      <div className="space-y-2">
        <Label htmlFor="name">Product name *</Label>
        <Input
          id="name"
          name="name"
          defaultValue={product?.name ?? ""}
          placeholder='e.g. Shaw "Coretec" LVP — Oak'
          required
          autoFocus
        />
      </div>

      {storedAsLabor && !isCatalogProductCategory(category) ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          This was saved as labor. Labor is not a product. Pick the material it
          actually is, or delete the row. The cost moves onto material cost when
          you pick a category.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Category</Label>
          <SegmentedField
            name="category"
            value={category}
            onChange={chooseCategory}
            options={CATALOG_PRODUCT_CATEGORIES.map((c) => ({
              value: c,
              label: PRODUCT_CATEGORY_LABELS[c],
            }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="unit">Unit</Label>
          <Input
            id="unit"
            name="unit"
            defaultValue={product?.unit ?? "sqft"}
            placeholder="sqft"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="material_rate">Material cost ($ / unit)</Label>
          <Input
            id="material_rate"
            name="material_rate"
            type="number"
            step="0.01"
            min="0"
            value={materialRate}
            onChange={(e) => setMaterialRate(e.target.value)}
            placeholder="3.50"
          />
          <p className="text-xs text-muted-foreground">
            What you pay for it — not what you sell it for. A vendor cost below
            wins when recorded.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="labor_rate">Install rate ($ / unit)</Label>
          <Input
            id="labor_rate"
            name="labor_rate"
            type="number"
            step="0.01"
            min="0"
            value={laborRate}
            onChange={(e) => setLaborRate(e.target.value)}
            placeholder="2.00"
          />
          <p className="text-xs text-muted-foreground">
            Optional install rate that rides with this material. It is not a
            separate product.
          </p>
        </div>

        <SellPreview
          category={category}
          materialRate={materialRate}
          laborRate={laborRate}
          vendorRows={vendorRows}
          targetMarginPct={targetMarginPct}
          freightMarkupPct={freightMarkupPct}
        />

        {/* ── The specs that pertain to THIS kind of product ─────────────────
            Every product was asked all of these at once, so choosing Carpet
            still showed "Sq ft / box (hard surface)" and "Coverage — SF / bag
            (prep goods)". All the information on screen, most of it about
            something else.

            specFieldsFor() decides, and it's the same function the estimate
            builder's inline "Add to catalog" uses — so the two add-product
            forms can't drift into asking different things about one product. */}
        {specFields.length ? (
          <div className="space-y-2 sm:col-span-2">
            <Label>
              {PRODUCT_CATEGORY_LABELS[category as keyof typeof PRODUCT_CATEGORY_LABELS] ??
                "Product"}{" "}
              specs
            </Label>
            <div className="grid gap-4 sm:grid-cols-2">
              {specFields.map((sf) => {
                const existing = (product as Record<string, unknown> | undefined)?.[sf.key];
                const initial = existing != null ? String(existing) : "";
                return (
                  <div key={sf.key} className="space-y-2">
                    <Label htmlFor={sf.key}>{sf.label}</Label>
                    {sf.kind === "choice" ? (
                      <select
                        id={sf.key}
                        name={sf.key}
                        defaultValue={initial}
                        className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                      >
                        <option value="">—</option>
                        {(sf.options ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        id={sf.key}
                        name={sf.key}
                        type={sf.kind === "number" ? "number" : "text"}
                        step="0.01"
                        min="0"
                        defaultValue={initial}
                      />
                    )}
                    {sf.hint ? (
                      <p className="text-xs text-muted-foreground">{sf.hint}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Bagged goods only — patch, self-leveller, primer. A carpet has no
            coverage per bag, so it isn't asked for one. */}
        {isPrepGood ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="coverage_sqft">Coverage — SF / bag</Label>
              <Input
                id="coverage_sqft"
                name="coverage_sqft"
                type="number"
                step="0.01"
                min="0"
                defaultValue={product?.coverage_sqft ?? ""}
                placeholder="e.g. 28"
              />
              <p className="text-xs text-muted-foreground">
                Self-leveler / patch: SF a bag covers — the estimate calculator
                sizes bags from area &amp; thickness.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="coverage_thickness_in">…at thickness (in)</Label>
              <Input
                id="coverage_thickness_in"
                name="coverage_thickness_in"
                type="number"
                step="0.0001"
                min="0"
                defaultValue={product?.coverage_thickness_in ?? ""}
                placeholder='e.g. 0.25 for 1/4"'
              />
              <p className="text-xs text-muted-foreground">
                The thickness that coverage is stated at. Leave blank for flat
                coverage (primers / adhesives) that doesn&apos;t scale with
                thickness.
              </p>
            </div>
          </>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="sku">SKU / item # (optional)</Label>
          <Input id="sku" name="sku" defaultValue={product?.sku ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="manufacturer">Manufacturer (who makes it)</Label>
          <Input
            id="manufacturer"
            name="manufacturer"
            defaultValue={product?.manufacturer ?? ""}
            placeholder="e.g. Mohawk, Shaw"
          />
          <p className="text-xs text-muted-foreground">
            The maker of the product — an attribute of the product, not who you buy it from.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="style">Style</Label>
          <Input
            id="style"
            name="style"
            defaultValue={product?.style ?? ""}
            placeholder="e.g. RevWood"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="color">Color</Label>
          <Input
            id="color"
            name="color"
            defaultValue={product?.color ?? ""}
            placeholder="e.g. Honey Oak"
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>Vendors (who you buy it from)</Label>
          <VendorRows vendors={vendors} rows={vendorRows} onChange={setVendorRows} />
          <p className="text-xs text-muted-foreground">
            One vendor is the normal case. Add more only if you buy this same product from more
            than one place — the first is the default, and each carries its own cost.
          </p>
        </div>
        {isEdit ? (
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="active"
                defaultChecked={product?.active ?? true}
                className="size-4 rounded border-input"
              />
              Active (show in estimate builder)
            </label>
          </div>
        ) : null}

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <textarea
            id="notes"
            name="notes"
            defaultValue={product?.notes ?? ""}
            rows={2}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !isCatalogProductCategory(category)}>
          {pending ? "Saving…" : isEdit ? "Save changes" : "Add product"}
        </Button>
      </div>
    </form>
  );
}

function SellPreview({
  category,
  materialRate,
  laborRate,
  vendorRows,
  targetMarginPct,
  freightMarkupPct,
}: {
  category: string;
  materialRate: string;
  laborRate: string;
  vendorRows: Row[];
  targetMarginPct: number;
  freightMarkupPct: number;
}) {
  const cost = catalogUnitCost({
    material_rate: materialRate,
    vendors: vendorRows
      .filter((r) => r.vendorId)
      .map((r, i) => ({
        id: String(i),
        product_id: "",
        vendor_id: r.vendorId,
        cost: r.cost === "" ? null : Number(r.cost),
        vendor_sku: r.sku || null,
        position: i,
      })),
  });
  const sell = catalogSellPrice({
    material_rate: materialRate,
    labor_rate: laborRate,
    vendors: vendorRows
      .filter((r) => r.vendorId)
      .map((r, i) => ({
        id: String(i),
        product_id: "",
        vendor_id: r.vendorId,
        cost: r.cost === "" ? null : Number(r.cost),
        vendor_sku: r.sku || null,
        position: i,
      })),
    category,
    targetMarginPct,
    freightMarkupPct,
  });
  return (
    <div className="space-y-1 rounded-md border bg-muted/30 px-3 py-2 sm:col-span-2">
      <div className="text-xs font-medium text-muted-foreground">
        Customer sell at {targetMarginPct}% target margin
        {freightMarkupPct > 0 ? ` (incl. ${freightMarkupPct}% freight)` : ""}
      </div>
      <div
        className={
          sell.missing
            ? "text-sm font-semibold text-amber-700"
            : "text-sm font-semibold tabular-nums"
        }
      >
        {formatCatalogPrice(sell, formatMoney)}
        {sell.missing
          ? ` — enter a cost (or vendor cost) so estimates can populate a price.`
          : cost.amount != null
            ? ` · cost ${formatMoney(cost.amount)}`
            : ""}
      </div>
      {sell.kind === "zero" ? (
        <p className="text-xs text-muted-foreground">
          Explicit $0 cost (vendor) — a legitimate free good, not {PRICE_NEEDED}.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The product's vendor list. Emits `vendors_json` (a hidden field) so the save
 * action can replace the product_vendors rows. Empty rows are ignored, so a
 * product with no vendor stays valid and the single-vendor case is one row.
 */
function VendorRows({
  vendors,
  rows,
  onChange,
}: {
  vendors: VendorOption[];
  rows: Row[];
  onChange: (rows: Row[]) => void;
}) {
  const set = (i: number, patch: Partial<Row>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const payload = rows.filter((r) => r.vendorId);

  const mfrs = vendors.filter((v) => v.kind === "manufacturer");
  const dists = vendors.filter((v) => v.kind !== "manufacturer");

  return (
    <div className="space-y-2">
      <input type="hidden" name="vendors_json" value={JSON.stringify(payload)} />
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <select
            value={r.vendorId}
            onChange={(e) => set(i, { vendorId: e.target.value })}
            className="h-9 min-w-40 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
            aria-label="Vendor"
          >
            <option value="">— Choose a vendor —</option>
            {mfrs.length ? (
              <optgroup label="Manufacturers (direct)">
                {mfrs.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {dists.length ? (
              <optgroup label="Distributors">
                {dists.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground">$</span>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={r.cost}
              onChange={(e) => set(i, { cost: e.target.value })}
              placeholder="cost"
              className="w-24"
              aria-label="Cost from this vendor"
            />
          </div>
          <Input
            value={r.sku}
            onChange={(e) => set(i, { sku: e.target.value })}
            placeholder="Vendor SKU"
            className="w-28"
            aria-label="Vendor SKU"
          />
          {i === 0 ? (
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Default
            </span>
          ) : null}
          <button
            type="button"
            onClick={() =>
              onChange(rows.length > 1 ? rows.filter((_, j) => j !== i) : rows)
            }
            className="text-muted-foreground hover:text-destructive"
            aria-label="Remove vendor"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...rows, { vendorId: "", cost: "", sku: "" }])}
      >
        <Plus className="size-4" /> Add another vendor
      </Button>
    </div>
  );
}
