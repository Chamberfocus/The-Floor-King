"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { productLabel } from "@/lib/product-label";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Save, Boxes, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ProductPicker } from "@/app/(app)/estimates/product-picker";
import { formatMoney } from "@/lib/format";
import type { Product } from "@/lib/types";
import { saveStockPO, saveAndPlaceStockPO, getReorderAlerts } from "../../actions";

export interface InitialItem {
  id: string;
  product_id: string;
  label: string;
  description: string;
  quantity: string;
  unit: string;
  unit_cost: string;
}

interface Row extends InitialItem {
  key: string;
}

const UNITS = ["each", "sqyd", "lnft", "sqft", "box", "yd"] as const;
const UNIT_LABELS: Record<string, string> = {
  each: "each",
  sqyd: "sq yd",
  lnft: "ln ft",
  sqft: "sq ft",
  box: "box",
  yd: "yd",
};

/**
 * All-on-one-screen stock-PO builder. Every line is editable in place; adding a
 * line never reloads the page. One "Save" persists the whole grid; "Place order"
 * saves + moves the quantities onto on-order. Shows live notify-only remnant alerts.
 */
export function StockPoEditor({
  poId,
  initialSupplier,
  initialItems,
}: {
  poId: string;
  initialSupplier: string;
  initialItems: InitialItem[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const keyRef = useRef(0);
  const nk = () => `r${keyRef.current++}`;
  const blank = (): Row => ({
    key: nk(),
    id: "",
    product_id: "",
    label: "",
    description: "",
    quantity: "",
    unit: "each",
    unit_cost: "",
  });

  const [supplier, setSupplier] = useState(initialSupplier);
  const [rows, setRows] = useState<Row[]>(() =>
    initialItems.length ? initialItems.map((it) => ({ ...it, key: nk() })) : [blank()],
  );

  const patch = (i: number, p: Partial<Row>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const addRow = () => setRows((prev) => [...prev, blank()]);
  const removeRow = (i: number) =>
    setRows((prev) => (prev.length === 1 ? [blank()] : prev.filter((_, j) => j !== i)));

  const pick = (i: number, p: Product | null) => {
    const cur = rows[i];
    if (!p) {
      patch(i, { product_id: "", label: "" });
      return;
    }
    const label = productLabel(p) || p.name;
    patch(i, {
      product_id: p.id,
      label,
      description: label,
      unit: cur?.unit && cur.unit !== "each" ? cur.unit : p.unit || "each",
      unit_cost: cur?.unit_cost || (p.material_rate ? String(p.material_rate) : ""),
    });
  };

  const lineTotal = (r: Row) => (parseFloat(r.quantity) || 0) * (parseFloat(r.unit_cost) || 0);
  const total = rows.reduce((s, r) => s + lineTotal(r), 0);
  const anyReady = rows.some((r) => r.product_id && (parseFloat(r.quantity) || 0) > 0);

  // Live NOTIFY-ONLY reorder alerts for whatever products are in the grid right now.
  const [alerts, setAlerts] = useState<
    Record<string, { totalQty: number; unit: string; count: number; items: { location?: string | null }[] }>
  >({});
  const pidKey = rows.map((r) => r.product_id).filter(Boolean).sort().join(",");
  useEffect(() => {
    const ids = pidKey ? pidKey.split(",") : [];
    if (!ids.length) {
      setAlerts({});
      return;
    }
    let live = true;
    getReorderAlerts(ids)
      .then((a) => {
        if (live) setAlerts(a || {});
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pidKey]);
  const alertList = Object.values(alerts);

  const payload = () => ({
    supplier,
    items: rows.map((r) => ({
      id: r.id || null,
      product_id: r.product_id || null,
      description: r.description,
      quantity: r.quantity,
      unit: r.unit,
      unit_cost: r.unit_cost,
    })),
  });

  const doSave = () =>
    start(async () => {
      const res = await saveStockPO(poId, payload());
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Saved");
      router.refresh();
    });

  const doPlace = () =>
    start(async () => {
      if (!anyReady) {
        toast.error("Add at least one product with a quantity.");
        return;
      }
      const res = await saveAndPlaceStockPO(poId, payload());
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Order placed — quantities are now on order.");
      router.refresh();
    });

  return (
    <div className="pb-28">
      {/* Supplier */}
      <Card className="mb-4">
        <CardContent className="pt-6">
          <label className="mb-1 block text-xs text-muted-foreground">Order from (supplier)</label>
          <Input
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder="e.g. Shaw, local distributor…"
            className="h-11 max-w-md text-base"
          />
        </CardContent>
      </Card>

      {/* Live remnant heads-up */}
      {alertList.length ? (
        <div className="mb-4 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-950/30">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
            <AlertTriangle className="size-4" /> Already in stock — do you want to use it?
          </div>
          <ul className="space-y-1 text-sm">
            {alertList.map((a, i) => {
              const locs = a.items.filter((x) => x.location).map((x) => x.location);
              return (
                <li key={i} className="text-amber-900 dark:text-amber-200">
                  You already have{" "}
                  <span className="font-semibold tabular-nums">
                    {a.totalQty} {a.unit}
                  </span>{" "}
                  {a.count > 1 ? `across ${a.count} pieces` : "as a remnant/roll"}
                  {locs.length ? (
                    <span className="text-amber-700 dark:text-amber-300/90"> · {locs.join(", ")}</span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-300/90"> · no location set yet</span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-amber-700 dark:text-amber-300/80">
            Heads-up only — your order isn&apos;t changed. Use the remnant or order as planned.
          </p>
        </div>
      ) : null}

      {/* Lines — all visible, all editable */}
      <Card className="mb-4">
        <CardContent className="space-y-3 pt-6">
          {rows.map((r, i) => (
            <div key={r.key} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">Line {i + 1}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove line"
                  onClick={() => removeRow(i)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
              <ProductPicker
                value={r.product_id}
                initialLabel={r.label}
                label="Product to restock"
                fullWidth
                onPick={(p) => pick(i, p)}
                onCreated={(p) => pick(i, p)}
              />
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Qty</label>
                  <Input
                    inputMode="decimal"
                    value={r.quantity}
                    onChange={(e) => patch(i, { quantity: e.target.value })}
                    placeholder="0"
                    className="h-11 w-24 text-base"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Unit</label>
                  <select
                    value={UNITS.includes(r.unit as (typeof UNITS)[number]) ? r.unit : "each"}
                    onChange={(e) => patch(i, { unit: e.target.value })}
                    className="h-11 rounded-md border border-input bg-transparent px-2 text-base"
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {UNIT_LABELS[u]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">$ / unit</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <Input
                      inputMode="decimal"
                      value={r.unit_cost}
                      onChange={(e) => patch(i, { unit_cost: e.target.value })}
                      placeholder="cost"
                      className="h-11 w-28 pl-5 text-base"
                    />
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-xs text-muted-foreground">Line</div>
                  <div className="font-semibold tabular-nums">{formatMoney(lineTotal(r))}</div>
                </div>
              </div>
            </div>
          ))}

          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="size-4" /> Add another product
          </Button>

          <div className="ml-auto w-full max-w-xs border-t pt-3">
            <div className="flex justify-between text-base font-semibold">
              <span>Est. total</span>
              <span className="tabular-nums">{formatMoney(total)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sticky actions */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 border-t bg-background/95 p-3 backdrop-blur md:bottom-0 md:pl-64">
        <div className="mx-auto flex max-w-3xl items-center justify-end gap-2 px-1">
          <Button type="button" variant="outline" disabled={pending} onClick={doSave}>
            <Save className="size-4" /> {pending ? "Saving…" : "Save draft"}
          </Button>
          <Button type="button" disabled={pending || !anyReady} onClick={doPlace}>
            <Boxes className="size-4" /> Place order
          </Button>
        </div>
      </div>
    </div>
  );
}
