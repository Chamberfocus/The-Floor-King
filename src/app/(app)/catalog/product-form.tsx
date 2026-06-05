"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PRODUCT_CATEGORY_LABELS,
  PRODUCT_CATEGORY_ORDER,
  type Product,
} from "@/lib/types";
import {
  createProduct,
  updateProduct,
  type ProductFormState,
} from "./actions";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const initialState: ProductFormState = { error: null };

export function ProductForm({ product }: { product?: Product }) {
  const isEdit = Boolean(product);
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
          <Label htmlFor="category">Category</Label>
          <select
            id="category"
            name="category"
            defaultValue={product?.category ?? "lvp"}
            className={selectClass}
          >
            {PRODUCT_CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>
                {PRODUCT_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
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
          <Label htmlFor="material_rate">Material rate ($ / unit)</Label>
          <Input
            id="material_rate"
            name="material_rate"
            type="number"
            step="0.01"
            min="0"
            defaultValue={product?.material_rate ?? ""}
            placeholder="3.50"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="labor_rate">Labor rate ($ / unit)</Label>
          <Input
            id="labor_rate"
            name="labor_rate"
            type="number"
            step="0.01"
            min="0"
            defaultValue={product?.labor_rate ?? ""}
            placeholder="2.00"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="sku">SKU / item # (optional)</Label>
          <Input id="sku" name="sku" defaultValue={product?.sku ?? ""} />
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
