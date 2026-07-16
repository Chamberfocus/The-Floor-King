"use client";

import { Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import type { Supplier } from "@/lib/types";
import { addSupplier, updateSupplier, deleteSupplier } from "./actions";

const cell =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function SupplierList({ suppliers }: { suppliers: Supplier[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Suppliers & freight</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Mark each vendor as a <strong>Manufacturer</strong> or{" "}
          <strong>Distributor</strong> — purchase orders use this to show where
          materials come from. Freight % (plus the global fuel surcharge) is
          added to your cost automatically when you pick the product.
        </p>

        {suppliers.length > 0 ? (
          <div className="space-y-2">
            {suppliers.map((s) => (
              <form
                key={s.id}
                action={updateSupplier}
                className="flex flex-wrap items-center gap-2"
              >
                <input type="hidden" name="id" value={s.id} />
                <Input
                  name="name"
                  defaultValue={s.name}
                  className="h-9 min-w-40 flex-1"
                  placeholder="Supplier name"
                />
                <select
                  name="kind"
                  defaultValue={s.kind ?? "distributor"}
                  className={cell}
                  aria-label="Supplier type"
                >
                  <option value="manufacturer">Manufacturer</option>
                  <option value="distributor">Distributor</option>
                </select>
                <div className="flex items-center gap-1">
                  <Input
                    name="freight_pct"
                    type="number"
                    step="0.1"
                    min="0"
                    defaultValue={s.freight_pct}
                    className="h-9 w-20"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <Button type="submit" variant="outline" size="sm">
                  Save
                </Button>
                <ConfirmButton
                  variant="ghost"
                  size="icon-sm"
                  formAction={deleteSupplier}
                  aria-label="Delete supplier"
                  title={`Delete ${s.name || "this supplier"}?`}
                  description="Removes the supplier. Products and POs that referenced it keep their copied vendor name. This can't be undone."
                  confirmLabel="Delete supplier"
                  destructive
                >
                  <Trash2 className="size-3.5" />
                </ConfirmButton>
              </form>
            ))}
          </div>
        ) : null}

        <form action={addSupplier} className="flex flex-wrap items-center gap-2 border-t pt-3">
          <input
            name="name"
            className={`${cell} min-w-40 flex-1`}
            placeholder="Add supplier (e.g. Shaw, Mohawk)"
            required
          />
          <select name="kind" defaultValue="distributor" className={cell} aria-label="Supplier type">
            <option value="manufacturer">Manufacturer</option>
            <option value="distributor">Distributor</option>
          </select>
          <div className="flex items-center gap-1">
            <input
              name="freight_pct"
              type="number"
              step="0.1"
              min="0"
              placeholder="0"
              className={`${cell} w-20`}
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
          <Button type="submit" size="sm">
            Add
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
