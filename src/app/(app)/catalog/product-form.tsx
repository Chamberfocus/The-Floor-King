"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PRODUCT_CATEGORY_LABELS,
  PRODUCT_CATEGORY_ORDER,
  type Product,
} from "@/lib/types";
import { SegmentedField } from "@/components/ui/segmented-field";
import { specFieldsFor } from "@/lib/product-fields";
import {
  createProduct,
  updateProduct,
  type ProductFormState,
} from "./actions";

const initialState: ProductFormState = { error: null };

export interface VendorOption {
  id: string;
  name: string;
  kind: string;
}

export function ProductForm({
  product,
  vendors = [],
}: {
  product?: Product;
  vendors?: VendorOption[];
}) {
  const isEdit = Boolean(product);
  /**
   * Labor is not a product.
   *
   * It shares this table for convenience, but nearly every field here describes
   * a physical thing: a SKU, a maker, a style and colour, cartons per box, roll
   * width, bag coverage. None of it means anything for "tear-out" or "stair
   * tread installation" — and leaving the fields on screen invites exactly the
   * mistake already sitting in the catalog: a labor item carrying a MATERIAL
   * rate, which then bills material the job never bought.
   */
  const [category, setCategory] = useState<string>(product?.category ?? "lvp");
  const isLabor = category === "labor";
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

  return (
    <form action={formAction} className="space-y-5">
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Category</Label>
          <SegmentedField
            name="category"
            defaultValue={product?.category ?? "lvp"}
            onChange={setCategory}
            options={PRODUCT_CATEGORY_ORDER.map((c) => ({
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

        {isLabor ? (
          /* Labor has no material cost. Posting 0 explicitly means switching an
             existing item to Labor CLEARS whatever material rate it carried,
             rather than leaving it hidden but live. Two items are in exactly
             that state today. */
          <input type="hidden" name="material_rate" value="0" />
        ) : (
          <div className="space-y-2">
            <Label htmlFor="material_rate">Material cost ($ / unit)</Label>
            <Input
              id="material_rate"
              name="material_rate"
              type="number"
              step="0.01"
              min="0"
              defaultValue={product?.material_rate ?? ""}
              placeholder="3.50"
            />
            <p className="text-xs text-muted-foreground">
              What you pay for it — not what you sell it for.
            </p>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="labor_rate">
            {isLabor ? "Your cost ($ / unit) *" : "Labor rate ($ / unit)"}
          </Label>
          <Input
            id="labor_rate"
            name="labor_rate"
            type="number"
            step="0.01"
            min="0"
            defaultValue={product?.labor_rate ?? ""}
            placeholder={isLabor ? "0.12" : "2.00"}
          />
          {isLabor ? (
            <p className="text-xs text-muted-foreground">
              What this work costs YOU per unit — what you pay the installer, not
              what the customer pays. The sell price comes off your margin.
            </p>
          ) : null}
        </div>

        {/* Attributes of a physical, manufactured item. Labor has none of
            them — and a labor row carrying a SKU would be swept into a supplier
            price feed that matches on exactly that. */}
        {!isLabor ? (
          <>
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
          </>
        ) : null}
        <div className="space-y-2 sm:col-span-2">
          <Label>Vendors (who you buy it from)</Label>
          <VendorRows vendors={vendors} initial={product?.vendors ?? []} />
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
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : isEdit ? "Save changes" : "Add product"}
        </Button>
      </div>
    </form>
  );
}

interface Row {
  vendorId: string;
  cost: string;
  sku: string;
}

/**
 * The product's vendor list. Emits `vendors_json` (a hidden field) so the save
 * action can replace the product_vendors rows. Empty rows are ignored, so a
 * product with no vendor stays valid and the single-vendor case is one row.
 */
function VendorRows({
  vendors,
  initial,
}: {
  vendors: VendorOption[];
  initial: NonNullable<Product["vendors"]>;
}) {
  const [rows, setRows] = useState<Row[]>(
    initial.length
      ? initial.map((v) => ({
          vendorId: v.vendor_id,
          cost: v.cost != null ? String(v.cost) : "",
          sku: v.vendor_sku ?? "",
        }))
      : [{ vendorId: "", cost: "", sku: "" }],
  );
  const set = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
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
            onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))}
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
        onClick={() => setRows((prev) => [...prev, { vendorId: "", cost: "", sku: "" }])}
      >
        <Plus className="size-4" /> Add another vendor
      </Button>
    </div>
  );
}
