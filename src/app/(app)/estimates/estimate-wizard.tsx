"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
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
  num,
  marginPct,
  markupPct,
  priceFromMargin,
  type CalcLine,
  type WizardSubmit,
} from "@/lib/estimate-calc";
import {
  PRODUCT_CATEGORY_LABELS,
  wizardSectionRank,
  type EstimatePresentation,
  type MeasureUnit,
  type Product,
  type WizardQuestion,
} from "@/lib/types";
import { createEstimateFromWizard } from "./actions";

const inputSm =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface RoomState {
  key: string;
  name: string;
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

/** Cost / price / margin readout shown under each priced item. */
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
  | { kind: "detail"; q: WizardQuestion }
  | { kind: "rooms" }
  | { kind: "addons" }
  | { kind: "review" };

export function EstimateWizard({
  customerId,
  customerName,
  products,
  questions,
}: {
  customerId: string;
  customerName: string;
  products: Product[];
  questions: WizardQuestion[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const keyCounter = useRef(0);
  const newKey = () => `r${keyCounter.current++}`;

  const emptyRoom = (): RoomState => ({
    key: newKey(),
    name: "",
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
  });

  const detailQs = useMemo(
    () =>
      questions
        .filter((q) => q.kind === "detail")
        .sort(
          (a, b) =>
            wizardSectionRank(a.section) - wizardSectionRank(b.section) ||
            a.position - b.position,
        ),
    [questions],
  );
  const addonQs = useMemo(
    () => questions.filter((q) => q.kind === "addon"),
    [questions],
  );

  const steps: Step[] = useMemo(
    () => [
      { kind: "basics" },
      ...detailQs.map((q) => ({ kind: "detail", q }) as Step),
      { kind: "rooms" },
      { kind: "addons" },
      { kind: "review" },
    ],
    [detailQs],
  );

  const [open, setOpen] = useState(true);
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState(`${customerName} — Flooring`);
  const [taxRate, setTaxRate] = useState("8");
  const [presentation, setPresentation] =
    useState<EstimatePresentation>("detailed");
  const [rooms, setRooms] = useState<RoomState[]>([emptyRoom()]);
  const [detailValues, setDetailValues] = useState<Record<string, string>>({});
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
  const removeRoom = (i: number) =>
    setRooms((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));
  const applyProduct = (i: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    updateRoom(
      i,
      p
        ? {
            product_id: p.id,
            material_rate: String(p.material_rate),
            labor_rate: String(p.labor_rate),
            line_type: "mat_labor",
            description: rooms[i].description || p.name,
          }
        : { product_id: "" },
    );
  };
  /** Set a room's sell rates to hit a target gross margin from its costs. */
  const roomTargetMargin = (i: number, t: string) => {
    const r = rooms[i];
    if (r.line_type === "installed") {
      updateRoom(i, {
        installed_rate: priceFromMargin(
          num(r.material_cost) + num(r.labor_cost),
          t,
        ).toFixed(2),
      });
    } else {
      updateRoom(i, {
        material_rate: priceFromMargin(num(r.material_cost), t).toFixed(2),
        labor_rate: priceFromMargin(num(r.labor_cost), t).toFixed(2),
      });
    }
  };
  const setAddonField = (id: string, patch: Partial<AddonState>) =>
    setAddon((p) => ({ ...p, [id]: { ...p[id], ...patch } }));

  // Live totals across rooms + included add-ons.
  const calcLines: CalcLine[] = [
    ...rooms.map(roomToCalc),
    ...addonQs.filter((q) => addon[q.id]?.included).map((q) => addonToCalc(addon[q.id])),
  ];
  const revenue = calcLines.reduce((s, l) => s + lineTotal(l), 0);
  const cost = calcLines.reduce((s, l) => s + lineCost(l), 0);
  const profit = revenue - cost;
  const tax = revenue * (num(taxRate) / 100);

  const current = steps[step];
  const canNext =
    current.kind !== "detail" ||
    !current.q.required ||
    Boolean(detailValues[current.q.id]?.trim());
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
        })),
        answers: questions.map((q) =>
          q.kind === "detail"
            ? {
                question_id: q.id,
                label: q.label,
                kind: "detail" as const,
                included: false,
                value: detailValues[q.id] ?? "",
                amount: null,
              }
            : {
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
              },
        ),
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
        <p className="mb-3 text-sm text-muted-foreground">
          Guided estimate paused.
        </p>
        <Button onClick={() => setOpen(true)}>
          <Sparkles className="size-4" /> Resume guided estimate
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
        {/* Header + progress */}
        <div className="border-b px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">Guided estimate</div>
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {current.kind === "basics" ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Let&apos;s set up the estimate</h2>
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
                  <Label htmlFor="w-pres">Show the customer</Label>
                  <select
                    id="w-pres"
                    value={presentation}
                    onChange={(e) =>
                      setPresentation(e.target.value as EstimatePresentation)
                    }
                    className={cn(inputSm, "w-full")}
                  >
                    <option value="detailed">Itemized (line by line)</option>
                    <option value="summary">Lump sum (single total)</option>
                  </select>
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

          {current.kind === "detail" ? (
            <div className="space-y-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {current.q.section}
              </div>
              <h2 className="text-lg font-semibold">
                {current.q.required ? (
                  <span className="text-amber-600">★ </span>
                ) : null}
                {current.q.label}
              </h2>
              {current.q.help ? (
                <p className="text-sm text-muted-foreground">{current.q.help}</p>
              ) : null}
              <DetailInput
                q={current.q}
                value={detailValues[current.q.id] ?? ""}
                onChange={(v) =>
                  setDetailValues((p) => ({ ...p, [current.q.id]: v }))
                }
              />
            </div>
          ) : null}

          {current.kind === "rooms" ? (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Rooms & measurements</h2>
              <p className="text-sm text-muted-foreground">
                Enter each area, your cost, and your price — margin updates live.
              </p>
              {rooms.map((r, i) => {
                const cl = roomToCalc(r);
                return (
                  <div key={r.key} className="space-y-2 rounded-md border p-3">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Input
                        value={r.name}
                        onChange={(e) => updateRoom(i, { name: e.target.value })}
                        placeholder="Room (e.g. Living Room)"
                      />
                      <Input
                        value={r.description}
                        onChange={(e) =>
                          updateRoom(i, { description: e.target.value })
                        }
                        placeholder="Material / description"
                        className="sm:col-span-2"
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
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          Price per
                        </label>
                        <select
                          value={r.measure_unit}
                          onChange={(e) =>
                            updateRoom(i, {
                              measure_unit: e.target.value as MeasureUnit,
                            })
                          }
                          className={cn(inputSm, "w-20")}
                        >
                          <option value="sqft">sq ft</option>
                          <option value="sqyd">sq yd</option>
                        </select>
                      </div>
                      {products.length ? (
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">
                            Product
                          </label>
                          <select
                            value={r.product_id}
                            onChange={(e) => applyProduct(i, e.target.value)}
                            className={cn(inputSm, "w-40")}
                          >
                            <option value="">— Manual —</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({PRODUCT_CATEGORY_LABELS[p.category]})
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                    </div>
                    {/* Cost + price */}
                    <div className="flex flex-wrap items-end gap-2">
                      <RateField
                        label="Material cost"
                        value={r.material_cost}
                        onChange={(v) => updateRoom(i, { material_cost: v })}
                      />
                      <RateField
                        label="Labor cost"
                        value={r.labor_cost}
                        onChange={(v) => updateRoom(i, { labor_cost: v })}
                      />
                      {r.line_type === "installed" ? (
                        <RateField
                          label="Installed price"
                          value={r.installed_rate}
                          onChange={(v) => updateRoom(i, { installed_rate: v })}
                        />
                      ) : (
                        <>
                          <RateField
                            label="Material price"
                            value={r.material_rate}
                            onChange={(v) => updateRoom(i, { material_rate: v })}
                          />
                          <RateField
                            label="Labor price"
                            value={r.labor_rate}
                            onChange={(v) => updateRoom(i, { labor_rate: v })}
                          />
                        </>
                      )}
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          Target margin %
                        </label>
                        <input
                          type="number"
                          placeholder="e.g. 40"
                          onChange={(e) => roomTargetMargin(i, e.target.value)}
                          className={cn(inputSm, "w-24")}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove room"
                        onClick={() => removeRoom(i)}
                        className="ml-auto"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                    <MarginReadout sell={lineTotal(cl)} cost={lineCost(cl)} />
                  </div>
                );
              })}
              <Button type="button" variant="outline" size="sm" onClick={addRoom}>
                <Plus className="size-3.5" /> Add room
              </Button>
            </div>
          ) : null}

          {current.kind === "addons" ? (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Add-ons & extras</h2>
              <p className="text-sm text-muted-foreground">
                Toggle what applies, set the quantity, your cost, and your price.
              </p>
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
                            onChange={(v) =>
                              setAddonField(q.id, { labor_cost: v })
                            }
                          />
                          <RateField
                            label="Price / unit"
                            value={a.unit_price}
                            onChange={(v) =>
                              setAddonField(q.id, { unit_price: v })
                            }
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
                          <td className="px-3 py-2">{r.name || r.description || "Room"}</td>
                          <td className="px-3 py-2 text-right">{formatMoney(lineCost(cl))}</td>
                          <td className="px-3 py-2 text-right">{formatMoney(lineTotal(cl))}</td>
                          <td className="px-3 py-2 text-right text-emerald-600">
                            {formatMoney(lineTotal(cl) - lineCost(cl))}
                          </td>
                        </tr>
                      );
                    })}
                    {addonQs
                      .filter((q) => addon[q.id]?.included)
                      .map((q) => {
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

        {/* Footer nav + live profit */}
        <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
          <Button
            type="button"
            variant="outline"
            onClick={back}
            disabled={step === 0}
          >
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
            <Button type="button" onClick={next} disabled={!canNext}>
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

function DetailInput({
  q,
  value,
  onChange,
}: {
  q: WizardQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  if (q.options?.length) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputSm, "w-full")}
        autoFocus
      >
        <option value="">—</option>
        {q.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (q.input === "yesno") {
    return (
      <div className="flex gap-2">
        {["Yes", "No"].map((opt) => (
          <Button
            key={opt}
            type="button"
            variant={value === opt ? "default" : "outline"}
            onClick={() => onChange(opt)}
          >
            {opt}
          </Button>
        ))}
      </div>
    );
  }
  return (
    <Input
      type={q.input === "number" ? "number" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoFocus
    />
  );
}
