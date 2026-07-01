"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Save, Printer, Upload, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedField } from "@/components/ui/segmented-field";
import { SearchPicker } from "@/components/ui/search-picker";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { poItemTotal, poTotal, type SavePoInput } from "@/lib/po-calc";
import {
  PO_SOURCE_BADGE,
  PO_SOURCE_LABELS,
  PO_STATUS_LABELS,
  PO_STATUS_ORDER,
  type PoSourceType,
  type Product,
  type PurchaseOrder,
  type PoStatus,
  type Supplier,
} from "@/lib/types";
import { savePurchaseOrder, extractPoDocument } from "./actions";

const MANUAL = "__manual__";

interface ItemState {
  key: string;
  product_id: string;
  description: string;
  quantity: string;
  unit: string;
  unit_cost: string;
  manufacturer: string;
  style: string;
  color: string;
  item_no: string;
}

const inputSm =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PoBuilder({
  po,
  products,
  suppliers,
}: {
  po: PurchaseOrder;
  products: Product[];
  suppliers: Supplier[];
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
    manufacturer: "",
    style: "",
    color: "",
    item_no: "",
  });

  const [supplier, setSupplier] = useState(po.supplier ?? "");
  const [supplierId, setSupplierId] = useState(po.supplier_id ?? "");
  const [sourceType, setSourceType] = useState<PoSourceType>(
    po.source_type ?? "distributor",
  );
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
      manufacturer: it.manufacturer ?? "",
      style: it.style ?? "",
      color: it.color ?? "",
      item_no: it.item_no ?? "",
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

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!f) return;
    setUploading(true);
    const fd = new FormData();
    fd.set("file", f);
    fd.set("po_id", po.id);
    const res = await extractPoDocument(fd);
    setUploading(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    const d = res.data;
    if (!d) return;
    if (d.vendor && !supplier) setSupplier(d.vendor);
    if (d.eta_date && !etaDate) setEtaDate(d.eta_date);
    const incoming: ItemState[] = d.items.map((it) => ({
      key: newKey(),
      product_id: "",
      description:
        it.description ||
        [it.manufacturer, it.style, it.color].filter(Boolean).join(" "),
      quantity: it.quantity != null ? String(it.quantity) : "",
      unit: it.unit || "sqft",
      unit_cost: it.unit_cost != null ? String(it.unit_cost) : "",
      manufacturer: it.manufacturer ?? "",
      style: it.style ?? "",
      color: it.color ?? "",
      item_no: it.item_no ?? "",
    }));
    setItems((prev) => {
      const kept = prev.filter(
        (p) =>
          p.description ||
          p.quantity ||
          p.unit_cost ||
          p.manufacturer ||
          p.style ||
          p.color ||
          p.item_no,
      );
      return [...kept, ...incoming];
    });
    toast.success(
      `Pulled ${incoming.length} item${incoming.length === 1 ? "" : "s"} from the document`,
    );
  };

  const save = () =>
    startTransition(async () => {
      const input: SavePoInput = {
        supplier,
        supplier_id: supplierId || null,
        source_type: sourceType,
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
          manufacturer: it.manufacturer || null,
          style: it.style || null,
          color: it.color || null,
          item_no: it.item_no || null,
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
    <div className="pb-44 md:pb-24">
      <Card className="mb-6">
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-3">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="supplier">Order from</Label>
            <select
              id="supplier-pick"
              value={supplierId || MANUAL}
              onChange={(e) => {
                const v = e.target.value;
                if (v === MANUAL) {
                  setSupplierId("");
                  return;
                }
                const s = suppliers.find((x) => x.id === v);
                if (s) {
                  setSupplierId(s.id);
                  setSupplier(s.name);
                  setSourceType(s.kind ?? "distributor");
                }
              }}
              className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {suppliers.some((s) => s.kind === "manufacturer") ? (
                <optgroup label="Manufacturers">
                  {suppliers
                    .filter((s) => s.kind === "manufacturer")
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </optgroup>
              ) : null}
              {suppliers.some((s) => s.kind !== "manufacturer") ? (
                <optgroup label="Distributors">
                  {suppliers
                    .filter((s) => s.kind !== "manufacturer")
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </optgroup>
              ) : null}
              <option value={MANUAL}>➕ One-off vendor (type below)…</option>
            </select>
            {supplierId ? (
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                  PO_SOURCE_BADGE[sourceType],
                )}
              >
                {PO_SOURCE_LABELS[sourceType]}
              </span>
            ) : (
              <div className="space-y-2 pt-1">
                <Input
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  placeholder="Vendor name (e.g. local distributor)"
                />
                <SegmentedField
                  value={sourceType}
                  onChange={(v) => setSourceType(v as PoSourceType)}
                  options={(["manufacturer", "distributor", "stock"] as const).map(
                    (s) => ({ value: s, label: PO_SOURCE_LABELS[s] }),
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  Tip: add vendors once under{" "}
                  <span className="font-medium">Settings → Suppliers</span> to
                  pick them here every time.
                </p>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <SegmentedField
              value={status}
              onChange={(v) => setStatus(v as PoStatus)}
              options={PO_STATUS_ORDER.map((s) => ({
                value: s,
                label: PO_STATUS_LABELS[s],
              }))}
            />
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
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Items to order</CardTitle>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,image/*"
              className="hidden"
              onChange={onFile}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <>
                  <Sparkles className="size-3.5 animate-pulse" /> Reading…
                </>
              ) : (
                <>
                  <Upload className="size-3.5" /> Upload order confirmation
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.map((it, i) => (
            <div key={it.key} className="rounded-md border p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {products.length ? (
                  <SearchPicker
                    value={it.product_id}
                    onChange={(v) => applyProduct(i, v)}
                    placeholder="— Manual item —"
                    allowClear
                    options={products.map((p) => ({ value: p.id, label: p.name }))}
                  />
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
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Input
                  value={it.manufacturer}
                  onChange={(e) =>
                    updateItem(i, { manufacturer: e.target.value })
                  }
                  placeholder="Manufacturer"
                  className="h-9"
                />
                <Input
                  value={it.style}
                  onChange={(e) => updateItem(i, { style: e.target.value })}
                  placeholder="Style"
                  className="h-9"
                />
                <Input
                  value={it.color}
                  onChange={(e) => updateItem(i, { color: e.target.value })}
                  placeholder="Color"
                  className="h-9"
                />
                <Input
                  value={it.item_no}
                  onChange={(e) => updateItem(i, { item_no: e.target.value })}
                  placeholder="Item #"
                  className="h-9"
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

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 border-t bg-background/95 p-3 backdrop-blur md:bottom-0 md:pl-64">
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
