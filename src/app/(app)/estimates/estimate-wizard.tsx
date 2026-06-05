"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import {
  lineTotal,
  optionTotals,
  num,
  type WizardSubmit,
} from "@/lib/estimate-calc";
import {
  PRODUCT_CATEGORY_LABELS,
  type EstimatePresentation,
  type MeasureUnit,
  type Product,
  type WizardQuestion,
} from "@/lib/types";
import { createEstimateFromWizard } from "./actions";

interface RoomState {
  key: string;
  name: string;
  sqft: string;
  len_ft: string;
  len_in: string;
  wid_ft: string;
  wid_in: string;
  measure_unit: MeasureUnit;
  product_id: string;
  description: string;
  line_type: "mat_labor" | "installed";
  material_rate: string;
  labor_rate: string;
  installed_rate: string;
}

function dimsToSqft(
  lenFt: string,
  lenIn: string,
  widFt: string,
  widIn: string,
): number | null {
  const L = num(lenFt) * 12 + num(lenIn);
  const W = num(widFt) * 12 + num(widIn);
  return L > 0 && W > 0 ? (L / 12) * (W / 12) : null;
}

const inputSm =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
    sqft: "",
    len_ft: "",
    len_in: "",
    wid_ft: "",
    wid_in: "",
    measure_unit: "sqft",
    product_id: "",
    description: "",
    line_type: "mat_labor",
    material_rate: "",
    labor_rate: "",
    installed_rate: "",
  });

  const [title, setTitle] = useState(`${customerName} — Flooring`);
  const [taxRate, setTaxRate] = useState("8");
  const [presentation, setPresentation] =
    useState<EstimatePresentation>("detailed");
  const [rooms, setRooms] = useState<RoomState[]>([emptyRoom()]);

  const detailQs = questions.filter((q) => q.kind === "detail");
  const addonQs = questions.filter((q) => q.kind === "addon");

  const [detailValues, setDetailValues] = useState<Record<string, string>>({});
  const [addon, setAddon] = useState<
    Record<string, { included: boolean; amount: string }>
  >(() => {
    const init: Record<string, { included: boolean; amount: string }> = {};
    for (const q of addonQs) {
      init[q.id] = {
        included: false,
        amount: q.default_amount != null ? String(q.default_amount) : "",
      };
    }
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
    setRooms((prev) =>
      prev.map((r, j) =>
        j === i
          ? p
            ? {
                ...r,
                product_id: p.id,
                material_rate: String(p.material_rate),
                labor_rate: String(p.labor_rate),
                line_type: "mat_labor",
                description: r.description || p.name,
              }
            : { ...r, product_id: "" }
          : r,
      ),
    );
  };

  const calcLines = [
    ...rooms.map((r) => ({
      line_type: r.line_type,
      sqft: r.sqft,
      measure_unit: r.measure_unit,
      material_rate: r.material_rate,
      labor_rate: r.labor_rate,
      installed_rate: r.installed_rate,
    })),
    ...addonQs
      .filter((q) => addon[q.id]?.included)
      .map((q) => ({
        line_type: "flat" as const,
        flat_amount: addon[q.id]?.amount ?? 0,
      })),
  ];
  const totals = optionTotals(calcLines, taxRate);

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
                amount: addon[q.id]?.amount ?? null,
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

  return (
    <div className="mx-auto max-w-4xl pb-24">
      {/* Basics */}
      <Card className="mb-6">
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="title">Estimate title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="presentation">Show customer</Label>
            <select
              id="presentation"
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
            <Label htmlFor="tax">Tax rate %</Label>
            <Input
              id="tax"
              type="number"
              step="0.01"
              min="0"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Rooms */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Rooms (one line each)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {rooms.map((r, i) => (
            <div key={r.key} className="rounded-md border p-3">
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
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Length (ft / in)
                  </label>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      min="0"
                      value={r.len_ft}
                      onChange={(e) =>
                        updateRoomDim(i, { len_ft: e.target.value })
                      }
                      placeholder="ft"
                      className={cn(inputSm, "w-14")}
                    />
                    <input
                      type="number"
                      min="0"
                      value={r.len_in}
                      onChange={(e) =>
                        updateRoomDim(i, { len_in: e.target.value })
                      }
                      placeholder="in"
                      className={cn(inputSm, "w-12")}
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Width (ft / in)
                  </label>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      min="0"
                      value={r.wid_ft}
                      onChange={(e) =>
                        updateRoomDim(i, { wid_ft: e.target.value })
                      }
                      placeholder="ft"
                      className={cn(inputSm, "w-14")}
                    />
                    <input
                      type="number"
                      min="0"
                      value={r.wid_in}
                      onChange={(e) =>
                        updateRoomDim(i, { wid_in: e.target.value })
                      }
                      placeholder="in"
                      className={cn(inputSm, "w-12")}
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Sq ft
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    value={r.sqft}
                    onChange={(e) => updateRoom(i, { sqft: e.target.value })}
                    className={cn(inputSm, "w-20")}
                  />
                </div>
                <div className="pb-2 text-xs text-muted-foreground">
                  {(num(r.sqft) / 9).toFixed(1)} sq yd
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
                      className={cn(inputSm, "w-44")}
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
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Pricing
                  </label>
                  <select
                    value={r.line_type}
                    onChange={(e) =>
                      updateRoom(i, {
                        line_type: e.target.value as "mat_labor" | "installed",
                      })
                    }
                    className={cn(inputSm, "w-36")}
                  >
                    <option value="mat_labor">Material + Labor</option>
                    <option value="installed">Installed / sq ft</option>
                  </select>
                </div>
                {r.line_type === "mat_labor" ? (
                  <>
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">
                        Material /{r.measure_unit === "sqyd" ? "sq yd" : "sqft"}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={r.material_rate}
                        onChange={(e) =>
                          updateRoom(i, { material_rate: e.target.value })
                        }
                        className={cn(inputSm, "w-24")}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">
                        Labor /{r.measure_unit === "sqyd" ? "sq yd" : "sqft"}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={r.labor_rate}
                        onChange={(e) =>
                          updateRoom(i, { labor_rate: e.target.value })
                        }
                        className={cn(inputSm, "w-24")}
                      />
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">
                      Installed /{r.measure_unit === "sqyd" ? "sq yd" : "sqft"}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={r.installed_rate}
                      onChange={(e) =>
                        updateRoom(i, { installed_rate: e.target.value })
                      }
                      className={cn(inputSm, "w-24")}
                    />
                  </div>
                )}
                <div className="ml-auto text-right">
                  <div className="text-xs text-muted-foreground">Line total</div>
                  <div className="font-semibold">
                    {formatMoney(
                      lineTotal({
                        line_type: r.line_type,
                        sqft: r.sqft,
                        measure_unit: r.measure_unit,
                        material_rate: r.material_rate,
                        labor_rate: r.labor_rate,
                        installed_rate: r.installed_rate,
                      }),
                    )}
                  </div>
                </div>
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
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addRoom}>
            <Plus className="size-3.5" /> Add room
          </Button>
        </CardContent>
      </Card>

      {/* Detail questions */}
      {detailQs.length ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Job details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {detailQs.map((q) => (
              <div key={q.id} className="space-y-1.5">
                <Label htmlFor={`q-${q.id}`}>{q.label}</Label>
                {q.input === "yesno" ? (
                  <select
                    id={`q-${q.id}`}
                    value={detailValues[q.id] ?? ""}
                    onChange={(e) =>
                      setDetailValues((p) => ({ ...p, [q.id]: e.target.value }))
                    }
                    className={cn(inputSm, "w-full")}
                  >
                    <option value="">—</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                ) : (
                  <Input
                    id={`q-${q.id}`}
                    type={q.input === "number" ? "number" : "text"}
                    value={detailValues[q.id] ?? ""}
                    onChange={(e) =>
                      setDetailValues((p) => ({ ...p, [q.id]: e.target.value }))
                    }
                  />
                )}
                {q.help ? (
                  <p className="text-xs text-muted-foreground">{q.help}</p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Add-on questions */}
      {addonQs.length ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Add-ons</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {addonQs.map((q) => {
              const state = addon[q.id] ?? { included: false, amount: "" };
              return (
                <div
                  key={q.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border p-3"
                >
                  <label className="flex flex-1 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={state.included}
                      onChange={(e) =>
                        setAddon((p) => ({
                          ...p,
                          [q.id]: { ...state, included: e.target.checked },
                        }))
                      }
                      className="size-4 rounded border-input"
                    />
                    <span>
                      {q.label}
                      {q.help ? (
                        <span className="block text-xs text-muted-foreground">
                          {q.help}
                        </span>
                      ) : null}
                    </span>
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={state.amount}
                      onChange={(e) =>
                        setAddon((p) => ({
                          ...p,
                          [q.id]: { ...state, amount: e.target.value },
                        }))
                      }
                      disabled={!state.included}
                      placeholder="0.00"
                      className={cn(inputSm, "w-28 pl-5 disabled:opacity-50")}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {/* Totals */}
      <Card>
        <CardContent className="pt-6">
          <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>{formatMoney(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Tax ({taxRate || 0}%)</span>
              <span>{formatMoney(totals.tax)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <span>Total</span>
              <span>{formatMoney(totals.total)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sticky create bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 backdrop-blur md:pl-64">
        <div className="mx-auto flex max-w-4xl items-center justify-end gap-2 px-1">
          <Button type="button" disabled={isPending} onClick={create}>
            <Sparkles className="size-4" />
            {isPending ? "Creating…" : "Create estimate"}
          </Button>
        </div>
      </div>
    </div>
  );
}
