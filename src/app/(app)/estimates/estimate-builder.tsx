"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Copy, Trash2, ArrowLeft, Save, Eye, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import {
  lineTotal,
  lineQty,
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
import { writeScopeDescription } from "./ai-actions";
import { ProductPicker } from "./product-picker";
import { SegmentedField } from "@/components/ui/segmented-field";

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
  waste_pct: string;
  product_id: string;
  manufacturer: string;
  style: string;
  color: string;
  item_no: string;
  // Our cost + explicit qty/unit + category — preserved so the smart builder's
  // bill of materials, category (drives install scheduling) & margin survive a
  // round-trip through this editor.
  material_cost: string;
  labor_cost: string;
  quantity: string;
  unit: string;
  category: string;
}

// Typical material waste by category (%), used as a smart default on pick.
const WASTE_BY_CATEGORY: Record<string, number> = {
  carpet: 10,
  tile: 10,
  hardwood: 7,
  laminate: 5,
  lvp: 5,
  vinyl: 5,
};

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
/** Our cost for a line (material × waste + labor), matching lineTotal's qty. */
function lineOurCost(l: LineState): number {
  if (l.line_type === "flat") return 0;
  const qty = lineQty({
    line_type: l.line_type,
    sqft: l.sqft,
    measure_unit: l.measure_unit,
    material_rate: l.material_rate,
    labor_rate: l.labor_rate,
    installed_rate: l.installed_rate,
    flat_amount: l.flat_amount,
    waste_pct: l.waste_pct,
    quantity: l.quantity,
  });
  const waste = 1 + (num(l.waste_pct) || 0) / 100;
  return qty * num(l.material_cost) * waste + qty * num(l.labor_cost);
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
  customerName,
}: {
  estimate: Estimate;
  customerName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const keyCounter = useRef(0);
  const newKey = () => `k${keyCounter.current++}`;

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
    waste_pct: "",
    product_id: "",
    manufacturer: "",
    style: "",
    color: "",
    item_no: "",
    material_cost: "",
    labor_cost: "",
    quantity: "",
    unit: "",
    category: "",
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
        waste_pct: l.waste_pct ? l.waste_pct.toString() : "",
        product_id: l.product_id ?? "",
        manufacturer: l.manufacturer ?? "",
        style: l.style ?? "",
        color: l.color ?? "",
        item_no: l.item_no ?? "",
        material_cost: l.material_cost?.toString() ?? "",
        labor_cost: l.labor_cost?.toString() ?? "",
        quantity: l.quantity?.toString() ?? "",
        unit: l.unit ?? "",
        category: l.category ?? "",
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
    // The catalog rate is in the product's own unit. Carpet is quoted by the
    // square yard, so for carpet we switch the line to sq yd and convert the
    // rate (×9 if the catalog price was per sq ft) so the math stays correct.
    const catalogUnit: MeasureUnit = (p.unit || "")
      .toLowerCase()
      .includes("yd")
      ? "sqyd"
      : "sqft";
    const measure_unit: MeasureUnit =
      p.category === "carpet" ? "sqyd" : catalogUnit;
    const factor =
      measure_unit === catalogUnit ? 1 : measure_unit === "sqyd" ? 9 : 1 / 9;
    const round2 = (n: number) => String(Math.round(n * 100) / 100);

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
                      category: p.category ?? l.category,
                      material_rate: round2(p.material_rate * factor),
                      labor_rate: round2(p.labor_rate * factor),
                      manufacturer: p.manufacturer ?? l.manufacturer,
                      style: p.style ?? l.style,
                      color: p.color ?? l.color,
                      item_no: p.sku ?? l.item_no,
                      measure_unit,
                      // Suggest a typical waste % for the category (only if unset).
                      waste_pct:
                        l.waste_pct ||
                        (WASTE_BY_CATEGORY[p.category]
                          ? String(WASTE_BY_CATEGORY[p.category])
                          : ""),
                      description: l.description || p.name,
                    }
                  : l,
              ),
            }
          : o,
      ),
    );
  };

  // A product created inline is returned ready to use; apply it to the line.
  const handleProductCreated = (oi: number, li: number, p: Product) => {
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
        waste_pct: l.waste_pct || null,
        product_id: l.product_id || null,
        manufacturer: l.manufacturer || null,
        style: l.style || null,
        color: l.color || null,
        item_no: l.item_no || null,
        material_cost: l.material_cost || null,
        labor_cost: l.labor_cost || null,
        quantity: l.quantity || null,
        unit: l.unit || null,
        category: l.category || null,
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

  const [aiBusy, setAiBusy] = useState(false);
  const aiDescribe = async () => {
    const lines = options
      .flatMap((o) => o.lines)
      .filter((l) => l.description.trim())
      .map((l) => ({
        room: l.room || null,
        description: l.description,
        quantity: Number(l.quantity) || Number(l.sqft) || null,
        unit: l.unit || (l.measure_unit === "sqyd" ? "sq yd" : "sq ft"),
      }));
    if (!lines.length) {
      toast.error("Add line items first.");
      return;
    }
    setAiBusy(true);
    const res = await writeScopeDescription({ kind: "estimate", lines });
    setAiBusy(false);
    if (res.error) toast.error(res.error);
    else {
      setJobDescription(res.text.trim());
      toast.success("Description written — review & edit as needed");
    }
  };

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
                <Label>Show customer</Label>
                <SegmentedField
                  value={presentation}
                  onChange={(v) => setPresentation(v as EstimatePresentation)}
                  options={[
                    { value: "detailed", label: "Itemized (line by line)" },
                    { value: "summary", label: "Lump sum (single total)" },
                  ]}
                />
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
            <div className="flex items-center justify-between">
              <Label htmlFor="job_description">Job description (shown to customer)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={aiDescribe}
                disabled={aiBusy}
              >
                <Sparkles className="size-3.5" /> {aiBusy ? "Writing…" : "AI describe"}
              </Button>
            </div>
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
          const calcLines = option.lines.map((l) => ({
            line_type: l.line_type,
            sqft: l.sqft,
            measure_unit: l.measure_unit,
            material_rate: l.material_rate,
            labor_rate: l.labor_rate,
            installed_rate: l.installed_rate,
            flat_amount: l.flat_amount,
            waste_pct: l.waste_pct,
            quantity: l.quantity,
          }));
          const totals = optionTotals(calcLines, taxRate);
          // Our cost & margin for this option (internal confirmation).
          const optionCost = option.lines.reduce(
            (s, l) => s + lineOurCost(l),
            0,
          );
          const optionProfit = totals.subtotal - optionCost;
          const optionMargin =
            totals.subtotal > 0 ? (optionProfit / totals.subtotal) * 100 : 0;

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
                        <SegmentedField
                          size="sm"
                          value={line.line_type}
                          onChange={(v) =>
                            updateLine(oi, li, { line_type: v as LineType })
                          }
                          options={(Object.keys(LINE_TYPE_LABELS) as LineType[]).map(
                            (t) => ({ value: t, label: LINE_TYPE_LABELS[t] }),
                          )}
                        />
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
                            <SegmentedField
                              size="sm"
                              value={line.measure_unit}
                              onChange={(v) =>
                                updateLine(oi, li, {
                                  measure_unit: v as MeasureUnit,
                                })
                              }
                              options={[
                                { value: "sqft", label: "sq ft" },
                                { value: "sqyd", label: "sq yd" },
                              ]}
                            />
                          </div>
                          <LabeledNumber
                            label="Waste %"
                            value={line.waste_pct}
                            width="w-20"
                            onChange={(v) =>
                              updateLine(oi, li, { waste_pct: v })
                            }
                          />
                        </>
                      ) : null}

                      {line.line_type !== "flat" ? (
                        <ProductPicker
                          value={line.product_id}
                          initialLabel={line.description}
                          onPick={(p) => pickProduct(oi, li, p)}
                          onCreated={(p) => handleProductCreated(oi, li, p)}
                        />
                      ) : null}

                      {line.line_type === "mat_labor" ? (
                        <>
                          <LabeledNumber
                            label={`Our cost /${line.measure_unit === "sqyd" ? "sq yd" : "sqft"}`}
                            prefix="$"
                            value={line.material_cost}
                            onChange={(v) =>
                              updateLine(oi, li, { material_cost: v })
                            }
                          />
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

                      {(() => {
                        const calc = {
                          line_type: line.line_type,
                          sqft: line.sqft,
                          measure_unit: line.measure_unit,
                          material_rate: line.material_rate,
                          labor_rate: line.labor_rate,
                          installed_rate: line.installed_rate,
                          flat_amount: line.flat_amount,
                          waste_pct: line.waste_pct,
                          quantity: line.quantity,
                        };
                        const qty = lineQty(calc);
                        const unitLabel = line.unit
                          ? line.unit
                          : line.measure_unit === "sqyd"
                            ? "sq yd"
                            : "sq ft";
                        const sell = lineTotal(calc);
                        const ourCost = lineOurCost(line);
                        const m =
                          sell > 0 ? ((sell - ourCost) / sell) * 100 : 0;
                        return (
                          <div className="ml-auto text-right">
                            <div className="text-xs text-muted-foreground">
                              Line total
                            </div>
                            <div className="font-semibold">
                              {formatMoney(sell)}
                            </div>
                            {line.line_type !== "flat" && qty > 0 ? (
                              <div className="text-[11px] tabular-nums text-muted-foreground">
                                {qty.toFixed(qty < 100 ? 1 : 0)} {unitLabel}
                              </div>
                            ) : null}
                            {ourCost > 0 ? (
                              <div className="text-[11px] tabular-nums text-muted-foreground">
                                cost {formatMoney(ourCost)} · {Math.round(m)}%
                              </div>
                            ) : null}
                          </div>
                        );
                      })()}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        title="Make a copy of this line below"
                        onClick={() => duplicateLine(oi, li)}
                      >
                        <Copy className="size-3.5" /> Duplicate
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
                  {optionCost > 0 ? (
                    <div className="mt-1 space-y-1 border-t border-dashed pt-2 text-xs">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Our cost (internal)</span>
                        <span className="tabular-nums">
                          {formatMoney(optionCost)}
                        </span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Profit</span>
                        <span className="tabular-nums">
                          {formatMoney(optionProfit)}
                        </span>
                      </div>
                      <div
                        className={cn(
                          "flex justify-between font-medium",
                          optionMargin < 30 ? "text-amber-600" : "text-emerald-600",
                        )}
                      >
                        <span>Margin</span>
                        <span className="tabular-nums">
                          {Math.round(optionMargin)}%
                        </span>
                      </div>
                    </div>
                  ) : null}
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
