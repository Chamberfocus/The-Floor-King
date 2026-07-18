"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Save, Printer, Upload, Sparkles, Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedField } from "@/components/ui/segmented-field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ProductPicker } from "@/app/(app)/estimates/product-picker";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { poItemTotal, poTotal, type SavePoInput } from "@/lib/po-calc";
import {
  PO_SOURCE_BADGE,
  PO_SOURCE_LABELS,
  PO_STATUS_LABELS,
  PO_STATUS_ORDER,
  materialClass,
  isHardSurfaceCategory,
  type PoSourceType,
  type Product,
  type PurchaseOrder,
  type PoStatus,
  type Supplier,
} from "@/lib/types";
import { savePurchaseOrder, extractPoDocument } from "./actions";
import { createVendorInline } from "@/app/(app)/settings/suppliers/actions";

const CREATE = "__create__";

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
  for_job_id: string;
  for_customer_id: string;
  note: string;
  category: string;
  sqft_per_box: string;
  roll_width_ft: string;
}

const inputSm =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PoBuilder({
  po,
  products,
  suppliers,
  jobs = [],
  poCustomerName = null,
}: {
  po: PurchaseOrder;
  products: Product[];
  suppliers: Supplier[];
  /** Active jobs to attribute a line to when the order is shared across clients. */
  jobs?: { job_id: string; customer_id: string | null; label: string }[];
  /** The PO's own client — labels the default "belongs to this PO" option. */
  poCustomerName?: string | null;
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
    for_job_id: "",
    for_customer_id: "",
    note: "",
    category: "",
    sqft_per_box: "",
    roll_width_ft: "",
  });

  const [supplier, setSupplier] = useState(po.supplier ?? "");
  const [supplierId, setSupplierId] = useState(po.supplier_id ?? "");
  const [sourceType, setSourceType] = useState<PoSourceType>(
    po.source_type ?? "distributor",
  );
  // Vendors are real records only. A local copy of the list lets an inline
  // "＋ New vendor" appear in the picker immediately without a reload.
  const [vendorList, setVendorList] = useState(suppliers);
  const [creatingVendor, setCreatingVendor] = useState(false);
  const [newVendorName, setNewVendorName] = useState("");
  const [newVendorKind, setNewVendorKind] = useState<"manufacturer" | "distributor">("distributor");
  const [vendorPending, startVendor] = useTransition();
  // When a picked product is carried by >1 vendor, ask which (with costs).
  const [vendorChoice, setVendorChoice] = useState<{ line: number; product: Product } | null>(null);
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
      for_job_id: it.for_job_id ?? "",
      for_customer_id: it.for_customer_id ?? "",
      note: it.note ?? "",
      category: it.category ?? "",
      sqft_per_box: it.sqft_per_box != null ? String(it.sqft_per_box) : "",
      roll_width_ft: it.roll_width_ft != null ? String(it.roll_width_ft) : "",
    }));
    return initial.length ? initial : [emptyItem()];
  });

  const updateItem = (i: number, patch: Partial<ItemState>) =>
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (i: number) =>
    setItems((prev) => prev.filter((_, j) => j !== i));
  // Pick from the catalog → fill the WHOLE line (no retyping), in the VENDOR's
  // ordering unit. Roll goods → sq yd; hard surface → sq ft (the PO prints
  // cartons via sq ft/box); trim → linear ft. Price is converted from the
  // catalog's own unit and the catalog basis is shown on the line for verifying.
  // Convert a catalog-unit cost into the PO's ordering unit (same rules the
  // price used) — shared so a vendor's cost converts identically.
  const convertCost = (p: Product, base: number): { unit: string; unitCost: number } => {
    const cls = materialClass(p.category);
    const catUnit = (p.unit || "").toLowerCase();
    const r2 = (n: number) => Math.round(n * 100) / 100;
    if (cls === "roll") return { unit: "sq yd", unitCost: catUnit.includes("yd") ? base : r2(base * 9) };
    if (cls === "hard") return { unit: "sq ft", unitCost: catUnit.includes("yd") ? r2(base / 9) : base };
    if (cls === "trim") return { unit: p.unit || "lnft", unitCost: base };
    return { unit: p.unit || "sqft", unitCost: base };
  };

  // Point the whole PO at a vendor (a PO is per-vendor) from a product's vendor row.
  const applyHeaderVendor = (v: NonNullable<Product["vendors"]>[number], p: Product) => {
    setSupplierId(v.vendor_id);
    setSupplier(v.vendor_name ?? p.supplier ?? "");
    setSourceType((v.vendor_kind ?? "distributor") as PoSourceType);
  };

  const applyProduct = (i: number, p: Product | null, chosenVendorId?: string) => {
    if (!p) {
      updateItem(i, { product_id: "" });
      return;
    }
    const vs = p.vendors ?? [];
    // Which vendor's cost applies? The chosen one, else the PO's header vendor if
    // it carries this product, else the product's default (primary) vendor.
    let vendorId = chosenVendorId ?? null;
    if (!vendorId) {
      if (supplierId && vs.some((v) => v.vendor_id === supplierId)) vendorId = supplierId;
      else if (vs.length) vendorId = vs[0].vendor_id;
    }
    const vRow = vendorId ? vs.find((v) => v.vendor_id === vendorId) : null;
    const base = vRow?.cost != null ? Number(vRow.cost) : Number(p.material_rate) || 0;
    const { unit, unitCost } = convertCost(p, base);

    updateItem(i, {
      product_id: p.id,
      description: p.name,
      manufacturer: p.manufacturer ?? "",
      style: p.style ?? "",
      color: p.color ?? "",
      item_no: (vRow?.vendor_sku || p.sku) ?? "",
      category: p.category ?? "",
      unit,
      unit_cost: String(unitCost),
      sqft_per_box: p.sqft_per_box != null ? String(p.sqft_per_box) : "",
      roll_width_ft: p.roll_width_ft != null ? String(p.roll_width_ft) : "",
    });

    // Vendor selection for the PO header. One vendor → just use it. More than
    // one (and none chosen/header yet) → ask which, with costs.
    if (chosenVendorId && vRow) {
      applyHeaderVendor(vRow, p);
    } else if (!supplierId) {
      if (vs.length === 1) applyHeaderVendor(vs[0], p);
      else if (vs.length > 1) setVendorChoice({ line: i, product: p });
      else {
        if (p.supplier) setSupplier(p.supplier);
        if (p.supplier_id) setSupplierId(p.supplier_id);
      }
    }
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
      for_job_id: "",
      for_customer_id: "",
      note: "",
      category: "",
      sqft_per_box: "",
      roll_width_ft: "",
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

  const save = (opts: { stash?: boolean } = {}) =>
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
          for_job_id: it.for_job_id || null,
          for_customer_id: it.for_customer_id || null,
          note: it.note || null,
          category: it.category || null,
          sqft_per_box: it.sqft_per_box || null,
          roll_width_ft: it.roll_width_ft || null,
        })),
      };
      const res = await savePurchaseOrder(po.id, input);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(opts.stash ? "Saved for later" : "Purchase order saved");
      if (opts.stash) router.push("/saved");
      else router.refresh();
    });

  return (
    <div className="pb-44 md:pb-24">
      <Card className="mb-6">
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-3">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="supplier-pick">Vendor</Label>
            <select
              id="supplier-pick"
              value={supplierId || ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === CREATE) {
                  setCreatingVendor(true);
                  return;
                }
                const s = vendorList.find((x) => x.id === v);
                if (s) {
                  setSupplierId(s.id);
                  setSupplier(s.name);
                  setSourceType((s.kind ?? "distributor") as PoSourceType);
                } else {
                  setSupplierId("");
                }
              }}
              className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">— Choose a vendor —</option>
              {vendorList.some((s) => s.kind === "manufacturer") ? (
                <optgroup label="Manufacturers">
                  {vendorList
                    .filter((s) => s.kind === "manufacturer")
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </optgroup>
              ) : null}
              {vendorList.some((s) => s.kind !== "manufacturer") ? (
                <optgroup label="Distributors">
                  {vendorList
                    .filter((s) => s.kind !== "manufacturer")
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </optgroup>
              ) : null}
              <option value={CREATE}>＋ New vendor…</option>
            </select>

            {creatingVendor ? (
              <div className="space-y-2 rounded-md border bg-muted/30 p-2.5">
                <Input
                  value={newVendorName}
                  onChange={(e) => setNewVendorName(e.target.value)}
                  placeholder="New vendor name"
                  autoFocus
                />
                <SegmentedField
                  size="sm"
                  value={newVendorKind}
                  onChange={(v) => setNewVendorKind(v as "manufacturer" | "distributor")}
                  options={[
                    { value: "manufacturer", label: "Manufacturer" },
                    { value: "distributor", label: "Distributor" },
                  ]}
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={vendorPending || !newVendorName.trim()}
                    onClick={() =>
                      startVendor(async () => {
                        const res = await createVendorInline(newVendorName, newVendorKind);
                        if (res.error || !res.id) {
                          toast.error(res.error ?? "Couldn't create the vendor.");
                          return;
                        }
                        const created = {
                          id: res.id,
                          name: newVendorName.trim(),
                          kind: newVendorKind,
                        };
                        setVendorList((prev) =>
                          prev.some((v) => v.id === created.id)
                            ? prev
                            : ([...prev, created] as typeof prev),
                        );
                        setSupplierId(created.id);
                        setSupplier(created.name);
                        setSourceType(created.kind as PoSourceType);
                        setCreatingVendor(false);
                        setNewVendorName("");
                        toast.success("Vendor added");
                      })
                    }
                  >
                    {vendorPending ? "Adding…" : "Add & select"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCreatingVendor(false);
                      setNewVendorName("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : supplierId ? (
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                  PO_SOURCE_BADGE[sourceType],
                )}
              >
                {PO_SOURCE_LABELS[sourceType]}
              </span>
            ) : (
              <p className="text-xs text-muted-foreground">
                Pick a vendor record — required to issue this PO. Not listed? Choose{" "}
                <span className="font-medium">＋ New vendor</span>.
              </p>
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
            <DateField
              id="eta"
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
              <ProductPicker
                value={it.product_id}
                initialLabel={it.description}
                label="Find in catalog — name, manufacturer, color, style, SKU, category, or vendor"
                fullWidth
                onPick={(p) => applyProduct(i, p)}
                onCreated={(p) => applyProduct(i, p)}
              />
              <Input
                value={it.description}
                onChange={(e) => updateItem(i, { description: e.target.value })}
                placeholder="Description"
                className="mt-2"
              />
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
                    {isHardSurfaceCategory(it.category)
                      ? "Sq ft"
                      : it.unit === "sq yd"
                        ? "Sq yd"
                        : "Quantity"}
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

              {/* Vendor-unit helper: hard surface → cartons from sq ft/box;
                  reminds you to set sq ft/box if it wasn't in the catalog. */}
              {isHardSurfaceCategory(it.category) ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                  {Number(it.sqft_per_box) > 0 && Number(it.quantity) > 0 ? (
                    <span className="font-semibold text-primary">
                      = {Math.ceil(Number(it.quantity) / Number(it.sqft_per_box))} cartons
                      <span className="font-normal text-muted-foreground">
                        {" "}({it.sqft_per_box} sq ft/box · {formatMoney((Number(it.unit_cost) || 0) * Number(it.sqft_per_box))}/carton)
                      </span>
                    </span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">
                      ⚠ Enter sq ft/box to order in cartons
                    </span>
                  )}
                  <label className="flex items-center gap-1 text-muted-foreground">
                    sq ft/box
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={it.sqft_per_box}
                      onChange={(e) => updateItem(i, { sqft_per_box: e.target.value })}
                      className={cn(inputSm, "h-7 w-20")}
                    />
                  </label>
                </div>
              ) : null}

              {/* Attribution — for a shared order, connect this line to another
                  job/client so it's always trackable. */}
              <div className="mt-2 flex flex-wrap items-end gap-2 border-t pt-2">
                <div className="min-w-[15rem] flex-1">
                  <label className="mb-1 block text-xs text-muted-foreground">
                    For (job / client)
                  </label>
                  <select
                    value={it.for_job_id}
                    onChange={(e) => {
                      const jid = e.target.value;
                      const opt = jobs.find((j) => j.job_id === jid);
                      updateItem(i, {
                        for_job_id: jid,
                        for_customer_id: opt?.customer_id ?? "",
                      });
                    }}
                    className={cn(inputSm, "w-full")}
                  >
                    <option value="">
                      This PO{poCustomerName ? ` — ${poCustomerName}` : ""}
                    </option>
                    {jobs.map((j) => (
                      <option key={j.job_id} value={j.job_id}>
                        {j.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[12rem] flex-1">
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Note (optional)
                  </label>
                  <input
                    value={it.note}
                    onChange={(e) => updateItem(i, { note: e.target.value })}
                    placeholder="e.g. shared roll — cut for both jobs"
                    className={cn(inputSm, "w-full")}
                  />
                </div>
                {it.for_job_id ? (
                  <span className="mb-1.5 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-300">
                    Tracked to another client
                  </span>
                ) : null}
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
          <Button
            type="button"
            variant="ghost"
            disabled={isPending}
            onClick={() => save({ stash: true })}
          >
            <Bookmark className="size-4" /> Save for later
          </Button>
          {status !== po.status &&
          (status === "received" || status === "ordered" || status === "cancelled") ? (
            <ConfirmButton
              disabled={isPending}
              onConfirm={() => save()}
              destructive={status === "cancelled"}
              title={
                status === "received"
                  ? `Mark this PO from ${supplier || "the vendor"} as received?`
                  : status === "ordered"
                    ? "Mark this PO as ordered?"
                    : "Cancel this purchase order?"
              }
              description={
                status === "received"
                  ? "Receiving adds the ordered quantities into on-hand inventory and moves the customer to Materials Received. Only do this once the material is physically in."
                  : status === "ordered"
                    ? "This emails the customer that their materials are on order and posts an update to their portal."
                    : "Cancelling stops this order. Any stock it had received will be reversed."
              }
              confirmLabel={
                status === "received"
                  ? "Mark received"
                  : status === "ordered"
                    ? "Mark ordered"
                    : "Cancel PO"
              }
            >
              <Save className="size-4" /> {isPending ? "Saving…" : "Save PO"}
            </ConfirmButton>
          ) : (
            <Button type="button" disabled={isPending} onClick={() => save()}>
              <Save className="size-4" /> {isPending ? "Saving…" : "Save PO"}
            </Button>
          )}
        </div>
      </div>

      {vendorChoice ? (
        <Dialog open onOpenChange={(o) => !o && setVendorChoice(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Choose a vendor</DialogTitle>
              <DialogDescription>
                {vendorChoice.product.name} is carried by more than one vendor — pick who this
                PO orders from, and its cost fills in.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              {(vendorChoice.product.vendors ?? []).map((v) => {
                const base = v.cost != null ? Number(v.cost) : Number(vendorChoice.product.material_rate) || 0;
                const { unit, unitCost } = convertCost(vendorChoice.product, base);
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      applyProduct(vendorChoice.line, vendorChoice.product, v.vendor_id);
                      setVendorChoice(null);
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left hover:border-primary hover:bg-muted"
                  >
                    <span className="font-medium">
                      {v.vendor_name ?? "Vendor"}
                      <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {v.vendor_kind === "manufacturer" ? "Direct" : "Distributor"}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">
                      {formatMoney(unitCost)}
                      <span className="text-xs font-normal text-muted-foreground">/{unit}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
