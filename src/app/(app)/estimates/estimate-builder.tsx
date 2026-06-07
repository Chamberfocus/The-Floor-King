"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Copy, Trash2, ArrowLeft, Save, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import {
  lineTotal,
  optionTotals,
  num,
  type SaveEstimateInput,
} from "@/lib/estimate-calc";
import {
  LINE_TYPE_LABELS,
  type Estimate,
  type EstimatePresentation,
  type LineType,
  type MeasureUnit,
  type Product,
} from "@/lib/types";
import { saveEstimate } from "./actions";
import { ProductPicker } from "./product-picker";

interface LineState {
  key: string;
  room: string;
  description: string;
  line_type: LineType;
  sqft: string;
  len_ft: string;
  len_in: string;
  wid_ft: string;
  wid_in: string;
  measure_unit: MeasureUnit;
  material_rate: string;
  labor_rate: string;
  installed_rate: string;
  flat_amount: string;
  product_id: string;
  manufacturer: string;
  style: string;
  color: string;
  item_no: string;
}

function inToFt(total: number | null | undefined): string {
  if (!total) return "";
  return String(Math.floor(total / 12));
}
function inToIn(total: number | null | undefined): string {
  if (!total) return "";
  return String(Math.round(total % 12));
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

interface OptionState {
  key: string;
  name: string;
  notes: string;
  lines: LineState[];
}

const inputSm =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function LabeledNumber({
  label,
  value,
  onChange,
  width = "w-24",
  prefix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  width?: string;
  prefix?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <div className="relative">
        {prefix ? (
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {prefix}
          </span>
        ) : null}
        <input
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputSm, width, prefix && "pl-5")}
        />
      </div>
    </div>
  );
}

export function EstimateBuilder({
  estimate,
  products,
  customerName,
}: {
  estimate: Estimate;
  products: Product[];
  customerName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const keyCounter = useRef(0);
  const newKey = () => `k${keyCounter.current++}`;

  // Catalog held in state so products added inline appear everywhere at once.
  const [catalog, setCatalog] = useState<Product[]>(products);

  const emptyLine = (): LineState => ({
    key: newKey(),
    room: "",
    description: "",
    line_type: "mat_labor",
    sqft: "",
    len_ft: "",
    len_in: "",
    wid_ft: "",
    wid_in: "",
    measure_unit: "sqft",
    material_rate: "",
    labor_rate: "",
    installed_rate: "",
    flat_amount: "",
    product_id: "",
    manufacturer: "",
    style: "",
    color: "",
    item_no: "",
  });

  const [title, setTitle] = useState(estimate.title ?? "");
  const [taxRate, setTaxRate] = useState(String(estimate.tax_rate ?? 0));
  const [presentation, setPresentation] = useState<EstimatePresentation>(
    estimate.presentation ?? "detailed",
  );
  const [jobDescription, setJobDescription] = useState(
    estimate.job_description ?? "",
  );
  const [notes, setNotes] = useState(estimate.notes ?? "");

  const [options, setOptions] = useState<OptionState[]>(() => {
    const initial = (estimate.options ?? []).map((o) => ({
      key: newKey(),
      name: o.name,
      notes: o.notes ?? "",
      lines: (o.line_items ?? []).map((l) => ({
        key: newKey(),
        room: l.room ?? "",
        description: l.description ?? "",
        line_type: l.line_type,
        sqft: l.sqft?.toString() ?? "",
        len_ft: inToFt(l.length_in),
        len_in: inToIn(l.length_in),
        wid_ft: inToFt(l.width_in),
        wid_in: inToIn(l.width_in),
        measure_unit: l.measure_unit ?? "sqft",
        material_rate: l.material_rate?.toString() ?? "",
        labor_rate: l.labor_rate?.toString() ?? "",
        installed_rate: l.installed_rate?.toString() ?? "",
        flat_amount: l.flat_amount?.toString() ?? "",
        product_id: l.product_id ?? "",
        manufacturer: l.manufacturer ?? "",
        style: l.style ?? "",
        color: l.color ?? "",
        item_no: l.item_no ?? "",
      })),
    }));
    return initial.length
      ? initial
      : [{ key: newKey(), name: "Option 1", notes: "", lines: [emptyLine()] }];
  });

  const updateOption = (oi: number, patch: Partial<OptionState>) =>
    setOptions((prev) => prev.map((o, i) => (i === oi ? { ...o, ...patch } : o)));

  const addOption = () =>
    setOptions((prev) => [
      ...prev,
      {
        key: newKey(),
        name: `Option ${prev.length + 1}`,
        notes: "",
        lines: [emptyLine()],
      },
    ]);

  const duplicateOption = (oi: number) =>
    setOptions((prev) => {
      const src = prev[oi];
      const copy: OptionState = {
        key: newKey(),
        name: `Copy of ${src.name}`,
        notes: src.notes,
        lines: src.lines.map((l) => ({ ...l, key: newKey() })),
      };
      const next = [...prev];
      next.splice(oi + 1, 0, copy);
      return next;
    });

  const removeOption = (oi: number) =>
    setOptions((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== oi) : prev));

  const addLine = (oi: number) =>
    setOptions((prev) =>
      prev.map((o, i) => (i === oi ? { ...o, lines: [...o.lines, emptyLine()] } : o)),
    );

  const removeLine = (oi: number, li: number) =>
    setOptions((prev) =>
      prev.map((o, i) =>
        i === oi ? { ...o, lines: o.lines.filter((_, j) => j !== li) } : o,
      ),
    );

  /** Repeat a line (same material & pricing) right below it. */
  const duplicateLine = (oi: number, li: number) =>
    setOptions((prev) =>
      prev.map((o, i) => {
        if (i !== oi) return o;
        const lines = [...o.lines];
        lines.splice(li + 1, 0, { ...o.lines[li], key: newKey() });
        return { ...o, lines };
      }),
    );

  const updateLine = (oi: number, li: number, patch: Partial<LineState>) =>
    setOptions((prev) =>
      prev.map((o, i) =>
        i === oi
          ? {
              ...o,
              lines: o.lines.map((l, j) => (j === li ? { ...l, ...patch } : l)),
            }
          : o,
      ),
    );

  // Update a dimension field and auto-recompute sq ft from L×W.
  const updateDim = (oi: number, li: number, patch: Partial<LineState>) =>
    setOptions((prev) =>
      prev.map((o, i) =>
        i === oi
          ? {
              ...o,
              lines: o.lines.map((l, j) => {
                if (j !== li) return l;
                const merged = { ...l, ...patch };
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
            }
          : o,
      ),
    );

  // Pick a catalog product for a line — fills every field the catalog knows.
  const pickProduct = (oi: number, li: number, p: Product | null) => {
    if (!p) {
      updateLine(oi, li, { product_id: "" });
      return;
    }
    const unit = (p.unit || "").toLowerCase();
    const measure_unit: MeasureUnit = unit.includes("yd") ? "sqyd" : "sqft";
    setOptions((prev) =>
      prev.map((o, i) =>
        i === oi
          ? {
              ...o,
              lines: o.lines.map((l, j) =>
                j === li
                  ? {
                      ...l,
                      product_id: p.id,
                      material_rate: String(p.material_rate),
                      labor_rate: String(p.labor_rate),
                      manufacturer: p.manufacturer ?? l.manufacturer,
                      style: p.style ?? l.style,
                      color: p.color ?? l.color,
                      item_no: p.sku ?? l.item_no,
                      measure_unit,
                      description: l.description || p.name,
                    }
                  : l,
              ),
            }
          : o,
      ),
    );
  };

  // A product created inline: add it to the catalog and apply it to the line.
  const handleProductCreated = (oi: number, li: number, p: Product) => {
    setCatalog((prev) => [p, ...prev.filter((x) => x.id !== p.id)]);
    pickProduct(oi, li, p);
  };

  const buildInput = (): SaveEstimateInput => ({
    title,
    tax_rate: taxRate,
    presentation,
    notes,
    job_description: jobDescription,
    options: options.map((o) => ({
      name: o.name,
      notes: o.notes,
      lines: o.lines.map((l) => ({
        room: l.room,
        description: l.description,
        line_type: l.line_type,
        sqft: l.sqft || null,
        length_in: num(l.len_ft) * 12 + num(l.len_in) || null,
        width_in: num(l.wid_ft) * 12 + num(l.wid_in) || null,
        measure_unit: l.measure_unit,
        material_rate: l.material_rate || null,
        labor_rate: l.labor_rate || null,
        installed_rate: l.installed_rate || null,
        flat_amount: l.flat_amount || null,
        product_id: l.product_id || null,
        manufacturer: l.manufacturer || null,
        style: l.style || null,
        color: l.color || null,
        item_no: l.item_no || null,
      })),
    })),
  });

  const save = (thenView: boolean) =>
    startTransition(async () => {
      const res = await saveEstimate(estimate.id, buildInput());
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Estimate saved");
      if (thenView) router.push(`/estimates/${estimate.id}`);
    });

  return (
    <div className="mx-auto max-w-5xl pb-24">
      <Link
        href={`/customers/${estimate.customer_id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to {customerName}
      </Link>

      {/* Estimate header */}
      <Card className="mb-6">
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="title">Estimate title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Whole-home flooring"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
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
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="job_description">Job description (shown to customer)</Label>
            <textarea
              id="job_description"
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              rows={2}
              placeholder="Plain-English summary of the work: rooms, materials, prep, removal, timeline…"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </CardContent>
      </Card>

      {/* Options */}
      <div className="space-y-6">
        {options.map((option, oi) => {
          const totals = optionTotals(
            option.lines.map((l) => ({
              line_type: l.line_type,
              sqft: l.sqft,
              measure_unit: l.measure_unit,
              material_rate: l.material_rate,
              labor_rate: l.labor_rate,
              installed_rate: l.installed_rate,
              flat_amount: l.flat_amount,
            })),
            taxRate,
          );

          return (
            <Card key={option.key}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <Input
                  value={option.name}
                  onChange={(e) => updateOption(oi, { name: e.target.value })}
                  className="max-w-xs font-semibold"
                />
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => duplicateOption(oi)}
                  >
                    <Copy className="size-3.5" /> Duplicate
                  </Button>
                  {options.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove option"
                      onClick={() => removeOption(oi)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {option.lines.map((line, li) => (
                  <div key={line.key} className="rounded-md border p-3">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Input
                        value={line.room}
                        onChange={(e) =>
                          updateLine(oi, li, { room: e.target.value })
                        }
                        placeholder="Room (e.g. Living Room)"
                      />
                      <Input
                        value={line.description}
                        onChange={(e) =>
                          updateLine(oi, li, { description: e.target.value })
                        }
                        placeholder="Description"
                        className="sm:col-span-2"
                      />
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Input
                        value={line.manufacturer}
                        onChange={(e) =>
                          updateLine(oi, li, { manufacturer: e.target.value })
                        }
                        placeholder="Manufacturer"
                        className="h-9"
                      />
                      <Input
                        value={line.style}
                        onChange={(e) =>
                          updateLine(oi, li, { style: e.target.value })
                        }
                        placeholder="Style"
                        className="h-9"
                      />
                      <Input
                        value={line.color}
                        onChange={(e) =>
                          updateLine(oi, li, { color: e.target.value })
                        }
                        placeholder="Color"
                        className="h-9"
                      />
                      <Input
                        value={line.item_no}
                        onChange={(e) =>
                          updateLine(oi, li, { item_no: e.target.value })
                        }
                        placeholder="Item #"
                        className="h-9"
                      />
                    </div>

                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          Pricing
                        </label>
                        <select
                          value={line.line_type}
                          onChange={(e) =>
                            updateLine(oi, li, {
                              line_type: e.target.value as LineType,
                            })
                          }
                          className={cn(inputSm, "w-40")}
                        >
                          {(Object.keys(LINE_TYPE_LABELS) as LineType[]).map(
                            (t) => (
                              <option key={t} value={t}>
                                {LINE_TYPE_LABELS[t]}
                              </option>
                            ),
                          )}
                        </select>
                      </div>

                      {line.line_type !== "flat" ? (
                        <>
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">
                              Length (ft / in)
                            </label>
                            <div className="flex gap-1">
                              <input
                                type="number"
                                min="0"
                                value={line.len_ft}
                                onChange={(e) =>
                                  updateDim(oi, li, { len_ft: e.target.value })
                                }
                                placeholder="ft"
                                className={cn(inputSm, "w-14")}
                              />
                              <input
                                type="number"
                                min="0"
                                value={line.len_in}
                                onChange={(e) =>
                                  updateDim(oi, li, { len_in: e.target.value })
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
                                value={line.wid_ft}
                                onChange={(e) =>
                                  updateDim(oi, li, { wid_ft: e.target.value })
                                }
                                placeholder="ft"
                                className={cn(inputSm, "w-14")}
                              />
                              <input
                                type="number"
                                min="0"
                                value={line.wid_in}
                                onChange={(e) =>
                                  updateDim(oi, li, { wid_in: e.target.value })
                                }
                                placeholder="in"
                                className={cn(inputSm, "w-12")}
                              />
                            </div>
                          </div>
                          <LabeledNumber
                            label="Sq ft"
                            value={line.sqft}
                            onChange={(v) => updateLine(oi, li, { sqft: v })}
                          />
                          <div className="pb-2 text-xs text-muted-foreground">
                            {(num(line.sqft) / 9).toFixed(1)} sq yd
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">
                              Price per
                            </label>
                            <select
                              value={line.measure_unit}
                              onChange={(e) =>
                                updateLine(oi, li, {
                                  measure_unit: e.target.value as MeasureUnit,
                                })
                              }
                              className={cn(inputSm, "w-20")}
                            >
                              <option value="sqft">sq ft</option>
                              <option value="sqyd">sq yd</option>
                            </select>
                          </div>
                        </>
                      ) : null}

                      {line.line_type !== "flat" ? (
                        <ProductPicker
                          products={catalog}
                          value={line.product_id}
                          onPick={(p) => pickProduct(oi, li, p)}
                          onCreated={(p) => handleProductCreated(oi, li, p)}
                        />
                      ) : null}

                      {line.line_type === "mat_labor" ? (
                        <>
                          <LabeledNumber
                            label={`Material /${line.measure_unit === "sqyd" ? "sq yd" : "sqft"}`}
                            prefix="$"
                            value={line.material_rate}
                            onChange={(v) =>
                              updateLine(oi, li, { material_rate: v })
                            }
                          />
                          <LabeledNumber
                            label={`Labor /${line.measure_unit === "sqyd" ? "sq yd" : "sqft"}`}
                            prefix="$"
                            value={line.labor_rate}
                            onChange={(v) =>
                              updateLine(oi, li, { labor_rate: v })
                            }
                          />
                        </>
                      ) : null}

                      {line.line_type === "installed" ? (
                        <LabeledNumber
                          label={`Installed /${line.measure_unit === "sqyd" ? "sq yd" : "sqft"}`}
                          prefix="$"
                          value={line.installed_rate}
                          onChange={(v) =>
                            updateLine(oi, li, { installed_rate: v })
                          }
                        />
                      ) : null}

                      {line.line_type === "flat" ? (
                        <LabeledNumber
                          label="Flat amount"
                          prefix="$"
                          width="w-32"
                          value={line.flat_amount}
                          onChange={(v) =>
                            updateLine(oi, li, { flat_amount: v })
                          }
                        />
                      ) : null}

                      <div className="ml-auto text-right">
                        <div className="text-xs text-muted-foreground">
                          Line total
                        </div>
                        <div className="font-semibold">
                          {formatMoney(
                            lineTotal({
                              line_type: line.line_type,
                              sqft: line.sqft,
                              measure_unit: line.measure_unit,
                              material_rate: line.material_rate,
                              labor_rate: line.labor_rate,
                              installed_rate: line.installed_rate,
                              flat_amount: line.flat_amount,
                            }),
                          )}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Duplicate line"
                        title="Repeat this material"
                        onClick={() => duplicateLine(oi, li)}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove line"
                        onClick={() => removeLine(oi, li)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addLine(oi)}
                >
                  <Plus className="size-3.5" /> Add line
                </Button>

                {/* Option totals */}
                <div className="ml-auto w-full max-w-xs space-y-1 border-t pt-3 text-sm">
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
          );
        })}
      </div>

      <Button
        type="button"
        variant="outline"
        className="mt-4"
        onClick={addOption}
      >
        <Plus className="size-4" /> Add another option
      </Button>

      {/* Sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 backdrop-blur md:pl-64">
        <div className="mx-auto flex max-w-5xl items-center justify-end gap-2 px-1">
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => save(true)}
          >
            <Eye className="size-4" /> Save &amp; view
          </Button>
          <Button type="button" disabled={isPending} onClick={() => save(false)}>
            <Save className="size-4" /> {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
