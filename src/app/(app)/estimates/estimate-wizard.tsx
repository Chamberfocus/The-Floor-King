"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  Copy,
  Trash2,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import {
  lineTotal,
  lineCost,
  lineQty,
  lineAreaSqft,
  num,
  marginPct,
  markupPct,
  priceFromMargin,
  type CalcLine,
  type WizardSubmit,
} from "@/lib/estimate-calc";
import {
  type EstimatePresentation,
  type MeasureUnit,
  type Product,
  type Supplier,
  type WizardQuestion,
} from "@/lib/types";
import { landedCost, freightPctForManufacturer } from "@/lib/freight";
import { createEstimateFromWizard } from "./actions";
import { ProductPicker } from "./product-picker";
import { SegmentedField } from "@/components/ui/segmented-field";

const inputSm =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface RoomState {
  key: string;
  name: string;
  category: string;
  len_ft: string;
  len_in: string;
  wid_ft: string;
  wid_in: string;
  sqft: string;
  measure_unit: MeasureUnit;
  product_id: string;
  description: string;
  line_type: "mat_labor" | "installed";
  material_rate: string;
  labor_rate: string;
  installed_rate: string;
  material_cost: string;
  labor_cost: string;
  margin: string;
  freight_pct: number;
}

/** Selling price from cost + margin %: price = cost / (1 - margin). */
function sellFromCost(cost: number, marginPctVal: number): string {
  if (!cost) return "";
  const m = marginPctVal / 100;
  const price = m < 1 && m >= 0 ? cost / (1 - m) : cost;
  return (Math.round(price * 100) / 100).toFixed(2);
}

interface AddonState {
  included: boolean;
  quantity: string;
  unit: string;
  unit_price: string;
  material_cost: string;
  labor_cost: string;
}

function dimsToSqft(lenFt: string, lenIn: string, widFt: string, widIn: string) {
  const L = num(lenFt) * 12 + num(lenIn);
  const W = num(widFt) * 12 + num(widIn);
  return L > 0 && W > 0 ? (L / 12) * (W / 12) : null;
}

function roomToCalc(r: RoomState): CalcLine {
  return {
    line_type: r.line_type,
    sqft: r.sqft,
    measure_unit: r.measure_unit,
    material_rate: r.material_rate,
    labor_rate: r.labor_rate,
    installed_rate: r.installed_rate,
    material_cost: r.material_cost,
    labor_cost: r.labor_cost,
  };
}

function addonToCalc(a: AddonState): CalcLine {
  return {
    line_type: "mat_labor",
    quantity: a.quantity || 1,
    material_rate: a.unit_price,
    labor_rate: 0,
    material_cost: a.material_cost,
    labor_cost: a.labor_cost,
  };
}

function MarginReadout({ sell, cost }: { sell: number; cost: number }) {
  const profit = sell - cost;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-muted/60 px-3 py-2 text-xs">
      <span className="text-muted-foreground">
        Cost <span className="font-medium text-foreground">{formatMoney(cost)}</span>
      </span>
      <span className="text-muted-foreground">
        Price <span className="font-medium text-foreground">{formatMoney(sell)}</span>
      </span>
      <span className="text-muted-foreground">
        Margin{" "}
        <span className="font-medium text-foreground">
          {marginPct(sell, cost).toFixed(1)}%
        </span>
      </span>
      <span className="text-muted-foreground">
        Markup{" "}
        <span className="font-medium text-foreground">
          {markupPct(sell, cost).toFixed(1)}%
        </span>
      </span>
      <span
        className={cn(
          "ml-auto font-semibold",
          profit >= 0 ? "text-emerald-600" : "text-destructive",
        )}
      >
        Profit {formatMoney(profit)}
      </span>
    </div>
  );
}

type Step =
  | { kind: "basics" }
  | { kind: "rooms" }
  | { kind: "addons" }
  | { kind: "review" };

export function EstimateWizard({
  customerId,
  customerName,
  questions,
  suppliers = [],
  fuelPct = 0,
}: {
  customerId: string;
  customerName: string;
  questions: WizardQuestion[];
  suppliers?: Supplier[];
  fuelPct?: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const keyCounter = useRef(0);
  const newKey = () => `r${keyCounter.current++}`;
  // The profit margin we commit to (drives selling price from cost).
  const [defaultMargin, setDefaultMargin] = useState(40);

  const emptyRoom = (): RoomState => ({
    key: newKey(),
    name: "",
    category: "",
    len_ft: "",
    len_in: "",
    wid_ft: "",
    wid_in: "",
    sqft: "",
    measure_unit: "sqft",
    product_id: "",
    description: "",
    line_type: "mat_labor",
    material_rate: "",
    labor_rate: "",
    installed_rate: "",
    material_cost: "",
    labor_cost: "",
    margin: String(defaultMargin),
    freight_pct: 0,
  });

  const addonQs = useMemo(
    () => questions.filter((q) => q.kind === "addon"),
    [questions],
  );

  const steps: Step[] = [
    { kind: "basics" },
    { kind: "rooms" },
    { kind: "addons" },
    { kind: "review" },
  ];

  const [open, setOpen] = useState(true);
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState(`${customerName} — Flooring`);
  const [taxRate, setTaxRate] = useState("8");
  const [presentation, setPresentation] =
    useState<EstimatePresentation>("detailed");
  const [addonsSeparate, setAddonsSeparate] = useState(false);
  const [rooms, setRooms] = useState<RoomState[]>([emptyRoom()]);
  const [addon, setAddon] = useState<Record<string, AddonState>>(() => {
    const init: Record<string, AddonState> = {};
    for (const q of addonQs)
      init[q.id] = {
        included: false,
        quantity: "1",
        unit: "each",
        unit_price: q.default_amount != null ? String(q.default_amount) : "",
        material_cost: "",
        labor_cost: "",
      };
    return init;
  });

  const updateRoom = (i: number, patch: Partial<RoomState>) =>
    setRooms((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const updateRoomDim = (i: number, patch: Partial<RoomState>) =>
    setRooms((prev) =>
      prev.map((r, j) => {
        if (j !== i) return r;
        const merged = { ...r, ...patch };
        const s = dimsToSqft(
          merged.len_ft,
          merged.len_in,
          merged.wid_ft,
          merged.wid_in,
        );
        return s !== null
          ? { ...merged, sqft: (Math.round(s * 100) / 100).toString() }
          : merged;
      }),
    );
  const addRoom = () => setRooms((prev) => [...prev, emptyRoom()]);
  /** Repeat a room (same material & pricing) right below it. */
  const duplicateRoom = (i: number) =>
    setRooms((prev) => {
      const next = [...prev];
      next.splice(i + 1, 0, { ...prev[i], key: newKey() });
      return next;
    });
  const removeRoom = (i: number) =>
    setRooms((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));
  // Re-price a room from its cost + margin (price = cost / (1 - margin)).
  const repriced = (r: RoomState): Partial<RoomState> => {
    const m = num(r.margin);
    return {
      material_rate: sellFromCost(num(r.material_cost), m),
      labor_rate: sellFromCost(num(r.labor_cost), m),
    };
  };
  // Update a room's cost/margin fields and recompute the selling price.
  const updateRoomPricing = (i: number, patch: Partial<RoomState>) =>
    setRooms((prev) =>
      prev.map((r, j) => {
        if (j !== i) return r;
        const merged = { ...r, ...patch };
        return { ...merged, ...repriced(merged) };
      }),
    );

  // Pick a catalog product — its rate is YOUR COST. Fills cost, unit, category,
  // converts carpet to sq-yd cost, then computes the selling price from margin.
  const pickRoomProduct = (i: number, p: Product | null) => {
    if (!p) {
      updateRoom(i, { product_id: "" });
      return;
    }
    const catalogUnit: MeasureUnit = (p.unit || "")
      .toLowerCase()
      .includes("yd")
      ? "sqyd"
      : "sqft";
    const measure_unit: MeasureUnit =
      p.category === "carpet" ? "sqyd" : catalogUnit;
    const factor =
      measure_unit === catalogUnit ? 1 : measure_unit === "sqyd" ? 9 : 1 / 9;
    // Material cost = product cost (unit-converted) + freight + fuel surcharge.
    const baseCost = p.material_rate * factor;
    const landed = landedCost(baseCost, p.manufacturer, suppliers, fuelPct);
    const freight_pct = freightPctForManufacturer(p.manufacturer, suppliers);
    setRooms((prev) =>
      prev.map((r, j) => {
        if (j !== i) return r;
        const merged: RoomState = {
          ...r,
          product_id: p.id,
          category: p.category,
          line_type: "mat_labor",
          measure_unit,
          material_cost: String(landed),
          labor_cost: r.labor_cost,
          description: r.description || p.name,
          freight_pct,
        };
        return { ...merged, ...repriced(merged) };
      }),
    );
  };
  const handleRoomProductCreated = (i: number, p: Product) => {
    pickRoomProduct(i, p);
  };
  // Apply one margin to every room and re-price them all.
  const applyMarginToAll = (pct: number) => {
    setDefaultMargin(pct);
    setRooms((prev) =>
      prev.map((r) => {
        const merged = { ...r, margin: String(pct) };
        return { ...merged, ...repriced(merged) };
      }),
    );
  };
  const setAddonField = (id: string, patch: Partial<AddonState>) =>
    setAddon((p) => ({ ...p, [id]: { ...p[id], ...patch } }));

  const totalSqft = rooms.reduce((s, r) => s + lineAreaSqft(roomToCalc(r)), 0);
  const totalSqyd = totalSqft / 9;
  const roomsRevenue = rooms.reduce((s, r) => s + lineTotal(roomToCalc(r)), 0);
  const roomsCost = rooms.reduce((s, r) => s + lineCost(roomToCalc(r)), 0);
  const includedAddons = addonQs.filter((q) => addon[q.id]?.included);
  const addonsRevenue = includedAddons.reduce(
    (s, q) => s + lineTotal(addonToCalc(addon[q.id])),
    0,
  );
  const addonsCost = includedAddons.reduce(
    (s, q) => s + lineCost(addonToCalc(addon[q.id])),
    0,
  );
  const revenue = roomsRevenue + addonsRevenue;
  const cost = roomsCost + addonsCost;
  const profit = revenue - cost;
  const tax = revenue * (num(taxRate) / 100);

  const current = steps[step];
  const back = () => setStep((s) => Math.max(0, s - 1));
  const next = () => setStep((s) => Math.min(steps.length - 1, s + 1));

  const create = () =>
    startTransition(async () => {
      const input: WizardSubmit = {
        title,
        tax_rate: taxRate,
        presentation,
        rooms: rooms.map((r) => ({
          name: r.name,
          sqft: r.sqft || null,
          length_in: num(r.len_ft) * 12 + num(r.len_in) || null,
          width_in: num(r.wid_ft) * 12 + num(r.wid_in) || null,
          measure_unit: r.measure_unit,
          product_id: r.product_id || null,
          description: r.description,
          line_type: r.line_type,
          material_rate: r.material_rate || null,
          labor_rate: r.labor_rate || null,
          installed_rate: r.installed_rate || null,
          material_cost: r.material_cost || null,
          labor_cost: r.labor_cost || null,
          category: r.category || null,
        })),
        answers: addonQs.map((q) => ({
          question_id: q.id,
          label: q.label,
          kind: "addon" as const,
          included: addon[q.id]?.included ?? false,
          value: "",
          amount: null,
          quantity: addon[q.id]?.quantity ?? "1",
          unit: addon[q.id]?.unit ?? "each",
          unit_price: addon[q.id]?.unit_price ?? null,
          material_cost: addon[q.id]?.material_cost ?? null,
          labor_cost: addon[q.id]?.labor_cost ?? null,
        })),
      };
      const res = await createEstimateFromWizard(customerId, input);
      if (res.error || !res.id) {
        toast.error(res.error ?? "Could not create estimate");
        return;
      }
      toast.success("Estimate created");
      router.push(`/estimates/${res.id}/edit`);
    });

  if (!open) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <p className="mb-3 text-sm text-muted-foreground">Quote builder paused.</p>
        <Button onClick={() => setOpen(true)}>
          <Sparkles className="size-4" /> Resume quote builder
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
        <div className="border-b px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">Quote builder</div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                Step {step + 1} of {steps.length}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${((step + 1) / steps.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {current.kind === "basics" ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Set up the quote</h2>
              <div className="space-y-2">
                <Label htmlFor="w-title">Estimate title</Label>
                <Input
                  id="w-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Show the customer</Label>
                  <SegmentedField
                    value={presentation}
                    onChange={(v) =>
                      setPresentation(v as EstimatePresentation)
                    }
                    options={[
                      { value: "detailed", label: "Itemized (line by line)" },
                      { value: "summary", label: "Lump sum (single total)" },
                    ]}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="w-tax">Tax rate %</Label>
                  <Input
                    id="w-tax"
                    type="number"
                    step="0.01"
                    min="0"
                    value={taxRate}
                    onChange={(e) => setTaxRate(e.target.value)}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {current.kind === "rooms" ? (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Rooms & materials</h2>
              <p className="text-sm text-muted-foreground">
                Type the material — your cost auto-fills from the catalog. Set
                the margin you commit to and the selling price calculates
                itself. Carpet prices by sq yd.
              </p>
              <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Profit margin for the job %
                  </label>
                  <input
                    type="number"
                    value={defaultMargin}
                    onChange={(e) =>
                      applyMarginToAll(Number(e.target.value) || 0)
                    }
                    className={cn(inputSm, "w-24")}
                  />
                </div>
                <p className="pb-1 text-xs text-muted-foreground">
                  Applies to every room — override per room below if needed.
                </p>
              </div>
              {rooms.map((r, i) => {
                const cl = roomToCalc(r);
                const sqyd = num(r.sqft) / 9;
                return (
                  <div key={r.key} className="space-y-2 rounded-md border p-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <ProductPicker
                        value={r.product_id}
                        initialLabel={r.description}
                        onPick={(p) => pickRoomProduct(i, p)}
                        onCreated={(p) => handleRoomProductCreated(i, p)}
                      />
                      <Input
                        value={r.name}
                        onChange={(e) => updateRoom(i, { name: e.target.value })}
                        placeholder="Room (e.g. Living Room)"
                        className="w-40"
                      />
                      <Input
                        value={r.description}
                        onChange={(e) =>
                          updateRoom(i, { description: e.target.value })
                        }
                        placeholder="Description"
                        className="min-w-40 flex-1"
                      />
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <DimField
                        label="Length"
                        ft={r.len_ft}
                        inch={r.len_in}
                        onFt={(v) => updateRoomDim(i, { len_ft: v })}
                        onIn={(v) => updateRoomDim(i, { len_in: v })}
                      />
                      <DimField
                        label="Width"
                        ft={r.wid_ft}
                        inch={r.wid_in}
                        onFt={(v) => updateRoomDim(i, { wid_ft: v })}
                        onIn={(v) => updateRoomDim(i, { wid_in: v })}
                      />
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          Sq ft
                        </label>
                        <input
                          type="number"
                          value={r.sqft}
                          onChange={(e) => updateRoom(i, { sqft: e.target.value })}
                          className={cn(inputSm, "w-20")}
                        />
                      </div>
                      <div className="pb-2 text-xs text-muted-foreground">
                        = {num(r.sqft).toFixed(0)} sq ft · {sqyd.toFixed(1)} sq yd
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          Price per
                        </label>
                        <SegmentedField
                          size="sm"
                          value={r.measure_unit}
                          onChange={(v) =>
                            updateRoom(i, { measure_unit: v as MeasureUnit })
                          }
                          options={[
                            { value: "sqft", label: "sq ft" },
                            { value: "sqyd", label: "sq yd" },
                          ]}
                        />
                      </div>
                    </div>
                    {(() => {
                      const unitLabel =
                        r.measure_unit === "sqyd" ? "sq yd" : "sq ft";
                      const qty = lineQty(cl);
                      const total = lineTotal(cl);
                      const sellUnit =
                        num(r.material_rate) + num(r.labor_rate);
                      const costUnit =
                        num(r.material_cost) + num(r.labor_cost);
                      const profit = total - lineCost(cl);
                      const freightPct = r.freight_pct;
                      const hasProduct = !!r.product_id;
                      const uplift = freightPct + fuelPct;
                      return (
                        <>
                          <div className="flex flex-wrap items-end gap-2">
                            <div>
                              <RateField
                                label={`Material cost /${unitLabel}`}
                                value={r.material_cost}
                                onChange={(v) =>
                                  updateRoomPricing(i, { material_cost: v })
                                }
                              />
                              {hasProduct && uplift > 0 ? (
                                <p className="mt-0.5 text-[10px] text-muted-foreground">
                                  incl. {freightPct > 0 ? `${freightPct}% freight` : ""}
                                  {freightPct > 0 && fuelPct > 0 ? " + " : ""}
                                  {fuelPct > 0 ? `${fuelPct}% fuel` : ""}
                                </p>
                              ) : null}
                            </div>
                            <RateField
                              label={`Labor cost /${unitLabel}`}
                              value={r.labor_cost}
                              onChange={(v) =>
                                updateRoomPricing(i, { labor_cost: v })
                              }
                            />
                            <div>
                              <label className="mb-1 block text-xs text-muted-foreground">
                                Margin %
                              </label>
                              <input
                                type="number"
                                value={r.margin}
                                onChange={(e) =>
                                  updateRoomPricing(i, { margin: e.target.value })
                                }
                                className={cn(inputSm, "w-20")}
                              />
                            </div>
                            <div className="pb-1">
                              <div className="text-xs text-muted-foreground">
                                Sell /{unitLabel}
                              </div>
                              <div className="font-medium tabular-nums">
                                {sellUnit > 0 ? formatMoney(sellUnit) : "—"}
                              </div>
                            </div>
                            <div className="ml-auto text-right">
                              <div className="text-xs text-muted-foreground">
                                Room total
                              </div>
                              <div className="text-base font-semibold tabular-nums">
                                {formatMoney(total)}
                              </div>
                              {qty > 0 ? (
                                <div className="text-[11px] tabular-nums text-muted-foreground">
                                  {qty.toFixed(1)} {unitLabel}
                                  {costUnit > 0
                                    ? ` · cost ${formatMoney(costUnit * qty)} · profit ${formatMoney(profit)}`
                                    : ""}
                                </div>
                              ) : null}
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Duplicate room"
                              title="Repeat this material for another area"
                              onClick={() => duplicateRoom(i)}
                            >
                              <Copy className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Remove room"
                              onClick={() => removeRoom(i)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                );
              })}
              <Button type="button" variant="outline" size="sm" onClick={addRoom}>
                <Plus className="size-3.5" /> Add room / material
              </Button>
            </div>
          ) : null}

          {current.kind === "addons" ? (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Add-ons & extras</h2>
              <p className="text-sm text-muted-foreground">
                Toggle what applies, set quantity, your cost, and your price.
              </p>
              {totalSqft > 0 ? (
                <div className="rounded-md bg-muted/60 px-3 py-2 text-xs">
                  Job total:{" "}
                  <span className="font-semibold">
                    {totalSqft.toFixed(0)} sq ft
                  </span>{" "}
                  ·{" "}
                  <span className="font-semibold">
                    {totalSqyd.toFixed(1)} sq yd
                  </span>{" "}
                  — tap a chip on an add-on to use it as the quantity.
                </div>
              ) : null}
              {addonQs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No add-ons configured. Manage them under Wizard Setup.
                </p>
              ) : null}
              {addonQs.map((q) => {
                const a = addon[q.id];
                const cl = addonToCalc(a);
                return (
                  <div key={q.id} className="space-y-2 rounded-md border p-3">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={a.included}
                        onChange={(e) =>
                          setAddonField(q.id, { included: e.target.checked })
                        }
                        className="size-4 rounded border-input"
                      />
                      {q.label}
                    </label>
                    {q.help ? (
                      <p className="pl-6 text-xs text-muted-foreground">{q.help}</p>
                    ) : null}
                    {a.included ? (
                      <>
                        <div className="flex flex-wrap items-end gap-2 pl-6">
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">
                              Qty
                            </label>
                            <input
                              type="number"
                              value={a.quantity}
                              onChange={(e) =>
                                setAddonField(q.id, { quantity: e.target.value })
                              }
                              className={cn(inputSm, "w-16")}
                            />
                            {totalSqft > 0 ? (
                              <div className="mt-1 flex gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setAddonField(q.id, {
                                      quantity: String(Math.round(totalSqft)),
                                      unit: "sqft",
                                    })
                                  }
                                  className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-muted"
                                >
                                  {totalSqft.toFixed(0)} ft²
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setAddonField(q.id, {
                                      quantity: totalSqyd.toFixed(1),
                                      unit: "sqyd",
                                    })
                                  }
                                  className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-muted"
                                >
                                  {totalSqyd.toFixed(1)} yd²
                                </button>
                              </div>
                            ) : null}
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">
                              Unit
                            </label>
                            <input
                              value={a.unit}
                              onChange={(e) =>
                                setAddonField(q.id, { unit: e.target.value })
                              }
                              placeholder="each / lnft"
                              className={cn(inputSm, "w-20")}
                            />
                          </div>
                          <RateField
                            label="Cost / unit (matl)"
                            value={a.material_cost}
                            onChange={(v) =>
                              setAddonField(q.id, { material_cost: v })
                            }
                          />
                          <RateField
                            label="Cost / unit (labor)"
                            value={a.labor_cost}
                            onChange={(v) => setAddonField(q.id, { labor_cost: v })}
                          />
                          <RateField
                            label="Price / unit"
                            value={a.unit_price}
                            onChange={(v) => setAddonField(q.id, { unit_price: v })}
                          />
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">
                              Target margin %
                            </label>
                            <input
                              type="number"
                              placeholder="40"
                              onChange={(e) =>
                                setAddonField(q.id, {
                                  unit_price: priceFromMargin(
                                    num(a.material_cost) + num(a.labor_cost),
                                    e.target.value,
                                  ).toFixed(2),
                                })
                              }
                              className={cn(inputSm, "w-20")}
                            />
                          </div>
                        </div>
                        <div className="pl-6">
                          <MarginReadout sell={lineTotal(cl)} cost={lineCost(cl)} />
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {current.kind === "review" ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Review & create</h2>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={addonsSeparate}
                  onChange={(e) => setAddonsSeparate(e.target.checked)}
                  className="size-4 rounded border-input"
                />
                Show add-ons as a separate total (instead of rolling into one)
              </label>
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-right">Cost</th>
                      <th className="px-3 py-2 text-right">Price</th>
                      <th className="px-3 py-2 text-right">Profit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rooms.map((r) => {
                      const cl = roomToCalc(r);
                      return (
                        <tr key={r.key}>
                          <td className="px-3 py-2">
                            {r.name || r.description || "Room"}
                          </td>
                          <td className="px-3 py-2 text-right">{formatMoney(lineCost(cl))}</td>
                          <td className="px-3 py-2 text-right">{formatMoney(lineTotal(cl))}</td>
                          <td className="px-3 py-2 text-right text-emerald-600">
                            {formatMoney(lineTotal(cl) - lineCost(cl))}
                          </td>
                        </tr>
                      );
                    })}
                    {includedAddons.map((q) => {
                      const cl = addonToCalc(addon[q.id]);
                      return (
                        <tr key={q.id}>
                          <td className="px-3 py-2">{q.label}</td>
                          <td className="px-3 py-2 text-right">{formatMoney(lineCost(cl))}</td>
                          <td className="px-3 py-2 text-right">{formatMoney(lineTotal(cl))}</td>
                          <td className="px-3 py-2 text-right text-emerald-600">
                            {formatMoney(lineTotal(cl) - lineCost(cl))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
                {addonsSeparate ? (
                  <>
                    <Row label="Materials & labor" value={formatMoney(roomsRevenue)} />
                    <Row label="Add-ons" value={formatMoney(addonsRevenue)} />
                  </>
                ) : null}
                <Row label="Revenue" value={formatMoney(revenue)} />
                <Row label="Cost" value={formatMoney(cost)} muted />
                <Row
                  label="Profit"
                  value={`${formatMoney(profit)} (${marginPct(revenue, cost).toFixed(1)}% margin)`}
                  strong
                />
                <Row label={`Tax (${taxRate || 0}%)`} value={formatMoney(tax)} muted />
                <Row label="Total to customer" value={formatMoney(revenue + tax)} strong />
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
          <Button type="button" variant="outline" onClick={back} disabled={step === 0}>
            <ChevronLeft className="size-4" /> Back
          </Button>
          <div className="hidden text-xs text-muted-foreground sm:block">
            {formatMoney(revenue)} price ·{" "}
            <span className="text-emerald-600">{formatMoney(profit)} profit</span>
          </div>
          {current.kind === "review" ? (
            <Button type="button" disabled={isPending} onClick={create}>
              <Sparkles className="size-4" />
              {isPending ? "Creating…" : "Create estimate"}
            </Button>
          ) : (
            <Button type="button" onClick={next}>
              Next <ChevronRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex justify-between",
        muted && "text-muted-foreground",
        strong && "text-base font-semibold",
      )}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function DimField({
  label,
  ft,
  inch,
  onFt,
  onIn,
}: {
  label: string;
  ft: string;
  inch: string;
  onFt: (v: string) => void;
  onIn: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">
        {label} (ft / in)
      </label>
      <div className="flex gap-1">
        <input
          type="number"
          min="0"
          value={ft}
          onChange={(e) => onFt(e.target.value)}
          placeholder="ft"
          className={cn(inputSm, "w-14")}
        />
        <input
          type="number"
          min="0"
          value={inch}
          onChange={(e) => onIn(e.target.value)}
          placeholder="in"
          className={cn(inputSm, "w-12")}
        />
      </div>
    </div>
  );
}

function RateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          $
        </span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputSm, "w-24 pl-5")}
        />
      </div>
    </div>
  );
}
