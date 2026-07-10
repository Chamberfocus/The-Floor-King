"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductPicker } from "@/app/(app)/estimates/product-picker";
import { addStockPOLine } from "../../actions";
import type { Product } from "@/lib/types";

/** Pick a catalog product, set qty/unit/cost, and add it to the stock PO. */
export function AddStockPOLine({ poId }: { poId: string }) {
  const [picked, setPicked] = useState<Product | null>(null);
  return (
    <form
      action={addStockPOLine}
      className="space-y-2 rounded-lg border border-dashed p-3"
      onSubmit={() => setTimeout(() => setPicked(null), 50)}
    >
      <input type="hidden" name="po_id" value={poId} />
      <input type="hidden" name="product_id" value={picked?.id ?? ""} />
      <input type="hidden" name="description" value={picked ? [picked.manufacturer, picked.name, picked.color].filter(Boolean).join(" ") : ""} />
      <ProductPicker
        value={picked?.id ?? ""}
        initialLabel={picked ? [picked.manufacturer, picked.name].filter(Boolean).join(" ") : ""}
        label="Product to restock"
        onPick={(p) => setPicked(p)}
        onCreated={(p) => setPicked(p)}
      />
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Qty</label>
          <Input name="quantity" inputMode="decimal" placeholder="0" className="h-10 w-24 text-base" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Unit</label>
          <select name="unit" defaultValue={picked?.unit || "each"} className="h-10 rounded-md border border-input bg-transparent px-2 text-sm">
            <option value="each">each</option>
            <option value="sqyd">sq yd</option>
            <option value="lnft">ln ft</option>
            <option value="sqft">sq ft</option>
            <option value="box">box</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">$ / unit</label>
          <Input name="unit_cost" inputMode="decimal" placeholder="cost" className="h-10 w-24 text-base" />
        </div>
        <Button type="submit" size="sm" disabled={!picked}>
          <Plus className="size-4" /> Add
        </Button>
      </div>
    </form>
  );
}
