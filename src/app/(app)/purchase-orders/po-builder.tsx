"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Save, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { poItemTotal, poTotal, type SavePoInput } from "@/lib/po-calc";
import {
  PO_STATUS_LABELS,
  PO_STATUS_ORDER,
  type Product,
  type PurchaseOrder,
  type PoStatus,
} from "@/lib/types";
import { savePurchaseOrder } from "./actions";

interface ItemState {
  key: string;
  product_id: string;
  description: string;
  quantity: string;
  unit: string;
  unit_cost: string;
}

const inputSm =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PoBuilder({
  po,
  products,
}: {
  po: PurchaseOrder;
  products: Product[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const keyCounter = useRef(0);
  const newKey = () => `i${keyCounter.current++}`;

  const emptyItem = (): ItemState => ({
    key: newKey(),
    product_id: "",
    description: "",
    quantity: "",
    unit: "sqft",
    unit_cost: "",
  });

  const [supplier, setSupplier] = useState(po.supplier ?? "");
  const [status, setStatus] = useState<PoStatus>(po.status);
  const [notes, setNotes] = useState(po.notes ?? "");
  const [backordered, setBackordered] = useState(po.backordered ?? false);
  const [etaDate, setEtaDate] = useState(po.eta_date ?? "");
  const [items, setItems] = useState<ItemState[]>(() => {
    const initial = (po.items ?? []).map((it) => ({
      key: newKey(),
      product_id: it.product_id ?? "",
      description: it.description ?? "",
      quantity: it.quantity?.toString() ?? "",
      unit: it.unit ?? "sqft",
      unit_cost: it.unit_cost?.toString() ?? "",
    }));
    return initial.length ? initial : [emptyItem()];
  });

  const updateItem = (i: number, patch: Partial<ItemState>) =>
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (i: number) =>
    setItems((prev) => prev.filter((_, j) => j !== i));
  const applyProduct = (i: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    updateItem(
      i,
      p
        ? {
            product_id: p.id,
            description: items[i].description || p.name,
            unit: p.unit || "sqft",
            unit_cost: String(p.material_rate),
          }
        : { product_id: "" },
    );
  };

  const total = poTotal(
    items.map((it) => ({ quantity: it.quantity, unit_cost: it.unit_cost })),
  );

  const save = () =>
    startTransition(async () => {
      const input: SavePoInput = {
        supplier,
        status,
        notes,
        eta_date: etaDate || null,
        backordered,
        items: items.map((it) => ({
          product_id: it.product_id || null,
          description: it.description,
          quantity: it.quantity || null,
          unit: it.unit,
          unit_cost: it.unit_cost || null,
        })),
      };
      const res = await savePurchaseOrder(po.id, input);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Purchase order saved");
      router.refresh();
    });

  return (
    <div className="pb-24">
      <Card className="mb-6">
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-3">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="supplier">Supplier</Label>
            <Input
              id="supplier"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder="e.g. Shaw, Mohawk, local distributor"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as PoStatus)}
              className={cn(inputSm, "w-full")}
            >
              {PO_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {PO_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={backordered}
              onChange={(e) => setBackordered(e.target.checked)}
              className="size-4 rounded border-input"
            />
            Backordered
          </label>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="eta">Expected arrival (ETA)</Label>
            <Input
              id="eta"
              type="date"
              value={etaDate}
              onChange={(e) => setEtaDate(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Items to order</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.map((it, i) => (
            <div key={it.key} className="rounded-md border p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {products.length ? (
                  <select
                    value={it.product_id}
                    onChange={(e) => applyProduct(i, e.target.value)}
                    className={cn(inputSm, "w-full")}
                  >
                    <option value="">— Manual item —</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <Input
                  value={it.description}
                  onChange={(e) =>
                    updateItem(i, { description: e.target.value })
                  }
                  placeholder="Description"
                  className={products.length ? "" : "sm:col-span-2"}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Quantity
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={it.quantity}
                    onChange={(e) => updateItem(i, { quantity: e.target.value })}
                    className={cn(inputSm, "w-24")}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Unit
                  </label>
                  <input
                    value={it.unit}
                    onChange={(e) => updateItem(i, { unit: e.target.value })}
                    className={cn(inputSm, "w-20")}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Unit cost
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={it.unit_cost}
                      onChange={(e) =>
                        updateItem(i, { unit_cost: e.target.value })
                      }
                      className={cn(inputSm, "w-28 pl-5")}
                    />
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-xs text-muted-foreground">Line cost</div>
                  <div className="font-semibold">
                    {formatMoney(
                      poItemTotal({
                        quantity: it.quantity,
                        unit_cost: it.unit_cost,
                      }),
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove item"
                  onClick={() => removeItem(i)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addItem}>
            <Plus className="size-3.5" /> Add item
          </Button>

          <div className="ml-auto w-full max-w-xs border-t pt-3 text-sm">
            <div className="flex justify-between text-base font-semibold">
              <span>Total cost</span>
              <span>{formatMoney(total)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <Label htmlFor="notes">Notes</Label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Delivery date, PO reference, special instructions…"
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 backdrop-blur md:pl-64">
        <div className="mx-auto flex max-w-4xl items-center justify-end gap-2 px-1">
          <Button
            type="button"
            variant="outline"
            onClick={() => window.print()}
          >
            <Printer className="size-4" /> Print
          </Button>
          <Button type="button" disabled={isPending} onClick={save}>
            <Save className="size-4" /> {isPending ? "Saving…" : "Save PO"}
          </Button>
        </div>
      </div>
    </div>
  );
}
