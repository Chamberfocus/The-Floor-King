"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Copy, Trash2, ArrowLeft, Save, Eye, Sparkles, Printer, ChevronRight } from "lucide-react";
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
  optionTotalsWithDiscount,
  priceFromMargin,
  marginPct,
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
  type Customer,
  type OrgSettings,
} from "@/lib/types";
import { saveEstimate } from "./actions";
import { writeScopeDescription } from "./ai-actions";
import { ProductPicker } from "./product-picker";
import { SegmentedField } from "@/components/ui/segmented-field";
import { AreaCalculator } from "@/components/area-calculator";

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
  from_stock: boolean; // pulled from stock → excluded from the PO
  margin_pct: string; // per-line margin override (%); "" = follow the overall
  order_as_roll: boolean; // PO shows a roll; work order keeps the cuts
  roll_width_ft: string; // 12 or 15 (broadloom width)
}

const round2s = (n: number) => String(Math.round(n * 100) / 100);
/** A line's effective margin — its own override, else the estimate overall. */
function effMargin(l: LineState, overall: number): number {
  return l.margin_pct.trim() !== "" ? num(l.margin_pct) : overall;
}
/** Recompute sell rates from cost at margin m — only where a cost exists, so a
 *  legacy line with a hand-typed rate but no cost is never zeroed. */
function ratesFromMargin(l: LineState, m: number): Partial<LineState> {
  const patch: Partial<LineState> = {};
  if (num(l.material_cost) > 0) patch.material_rate = round2s(priceFromMargin(num(l.material_cost), m));
  if (num(l.labor_cost) > 0) patch.labor_rate = round2s(priceFromMargin(num(l.labor_cost), m));
  return patch;
}
/** Is this a LABOR line (its own section)? Labor category, or labor-only money. */
function isLaborLine(l: LineState): boolean {
  if (l.category === "labor") return true;
  const laborish = num(l.labor_cost) + num(l.labor_rate);
  const materialish = num(l.material_cost) + num(l.material_rate);
  return laborish > 0 && materialish === 0;
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

/** Our cost for a line, split into material vs labor (matches lineOurCost). */
function lineCostSplit(l: LineState): { mat: number; labor: number } {
  if (l.line_type === "flat") return { mat: 0, labor: 0 };
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
  return {
    mat: qty * num(l.material_cost) * waste,
    labor: qty * num(l.labor_cost),
  };
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
  customer = null,
  org,
  autoPrint = false,
}: {
  estimate: Estimate;
  customerName: string;
  customer?: Customer | null;
  org?: OrgSettings;
  autoPrint?: boolean;
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
    from_stock: false,
    margin_pct: "",
    order_as_roll: false,
    roll_width_ft: "",
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
  // Estimate-wide gross margin. Lines without their own override follow this.
  const [overallMargin, setOverallMargin] = useState(
    estimate.target_margin != null ? String(estimate.target_margin) : "40",
  );

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
        from_stock: !!l.from_stock,
        margin_pct: l.margin_pct != null ? String(l.margin_pct) : "",
        order_as_roll: !!l.order_as_roll,
        roll_width_ft: l.roll_width_ft != null ? String(l.roll_width_ft) : "",
      })),
    }));
    return initial.length
      ? initial
      : [{ key: newKey(), name: "Option 1", notes: "", lines: [emptyLine()] }];
  });

  const updateOption = (oi: number, patch: Partial<OptionState>) =>
    setOptions((prev) => prev.map((o, i) => (i === oi ? { ...o, ...patch } : o)));

  // Which line editors are expanded — visual only (tap a line to edit it).
  const [openLines, setOpenLines] = useState<Set<string>>(new Set());
  const toggleLine = (key: string) =>
    setOpenLines((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

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

  const addLine = (oi: number, asLabor = false) => {
    const line: LineState = asLabor ? { ...emptyLine(), category: "labor" } : emptyLine();
    setOptions((prev) =>
      prev.map((o, i) => (i === oi ? { ...o, lines: [...o.lines, line] } : o)),
    );
    setOpenLines((s) => new Set(s).add(line.key)); // open the new line for editing
  };

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

  // Change the estimate-wide margin → re-price every line that doesn't have its
  // own override. Overridden lines keep their margin.
  const changeOverallMargin = (v: string) => {
    setOverallMargin(v);
    const m = num(v);
    if (m <= 0 || m >= 100) return;
    setOptions((prev) =>
      prev.map((o) => ({
        ...o,
        lines: o.lines.map((l) => (l.margin_pct.trim() !== "" ? l : { ...l, ...ratesFromMargin(l, m) })),
      })),
    );
  };

  // Set/clear a line's margin override → re-price that line. "" = follow overall.
  const changeLineMargin = (oi: number, li: number, v: string) =>
    setOptions((prev) =>
      prev.map((o, i) =>
        i === oi
          ? {
              ...o,
              lines: o.lines.map((l, j) => {
                if (j !== li) return l;
                const m = v.trim() === "" ? num(overallMargin) : num(v);
                return { ...l, margin_pct: v, ...ratesFromMargin(l, m) };
              }),
            }
          : o,
      ),
    );

  // Edit a cost → re-derive that line's sell at its effective margin.
  const changeLineCost = (oi: number, li: number, field: "material_cost" | "labor_cost", v: string) =>
    setOptions((prev) =>
      prev.map((o, i) =>
        i === oi
          ? {
              ...o,
              lines: o.lines.map((l, j) => {
                if (j !== li) return l;
                const merged = { ...l, [field]: v };
                return { ...merged, ...ratesFromMargin(merged, effMargin(merged, num(overallMargin))) };
              }),
            }
          : o,
      ),
    );

  // Type a sell price directly → back-compute (and pin) that line's margin.
  const changeLineSell = (oi: number, li: number, field: "material_rate" | "labor_rate", v: string) =>
    setOptions((prev) =>
      prev.map((o, i) =>
        i === oi
          ? {
              ...o,
              lines: o.lines.map((l, j) => {
                if (j !== li) return l;
                const merged = { ...l, [field]: v };
                const cost = field === "material_rate" ? num(merged.material_cost) : num(merged.labor_cost);
                const sell = num(v);
                return cost > 0 && sell > 0
                  ? { ...merged, margin_pct: round2s(marginPct(sell, cost)) }
                  : merged;
              }),
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
                // Editing dimensions means area drives the line again — drop any
                // frozen quantity (e.g. carried over from a copied estimate) so
                // the total recalculates from the new size.
                return s !== null
                  ? { ...merged, sqft: (Math.round(s * 100) / 100).toString(), quantity: "" }
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
              lines: o.lines.map((l, j) => {
                if (j !== li) return l;
                const base: LineState = {
                  ...l,
                  product_id: p.id,
                  category: p.category ?? l.category,
                  // Catalog rates are OUR cost → set cost; the sell derives from
                  // the effective margin (so a picked product isn't sold at cost).
                  material_cost: round2(p.material_rate * factor),
                  labor_cost: round2(p.labor_rate * factor),
                  manufacturer: p.manufacturer ?? l.manufacturer,
                  style: p.style ?? l.style,
                  color: p.color ?? l.color,
                  item_no: p.sku ?? l.item_no,
                  measure_unit,
                  // Only suggest waste when the quantity is area-driven (no
                  // explicit qty) — avoids double-counting a qty that already
                  // includes waste (e.g. from the questionnaire).
                  waste_pct: l.quantity
                    ? l.waste_pct
                    : l.waste_pct ||
                      (WASTE_BY_CATEGORY[p.category] ? String(WASTE_BY_CATEGORY[p.category]) : ""),
                  description: l.description || p.name,
                };
                return { ...base, ...ratesFromMargin(base, effMargin(base, num(overallMargin))) };
              }),
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
        from_stock: l.from_stock,
        margin_pct: l.margin_pct || null,
        order_as_roll: l.order_as_roll,
        roll_width_ft: l.roll_width_ft || null,
      })),
    })),
    target_margin: num(overallMargin) || null,
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

  // Came from the smart builder's "Create & print" — open the print dialog once.
  useEffect(() => {
    if (autoPrint) {
      const t = setTimeout(() => window.print(), 600);
      return () => clearTimeout(t);
    }
  }, [autoPrint]);

  // Save first so the record matches the printout, then open print.
  const saveThenPrint = () =>
    startTransition(async () => {
      const res = await saveEstimate(estimate.id, buildInput());
      if (res.error) {
        toast.error(res.error);
        return;
      }
      window.print();
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

  // Running grand total — discount-aware (matches the estimate view / invoice)
  // and shown in the always-visible bar, with the true blended margin.
  const toCalc = (l: LineState) => ({
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
  const grand = optionTotalsWithDiscount(
    options.flatMap((o) => o.lines.map(toCalc)),
    taxRate,
    estimate.discount_kind,
    estimate.discount_value,
  );
  const grandCost = options.flatMap((o) => o.lines).reduce((s, l) => s + lineOurCost(l), 0);
  const grandMargin = marginPct(grand.subtotal, grandCost);

  return (
    <>
    <div className="mx-auto max-w-5xl pb-44 md:pb-24 print:hidden">
      <Link
        href={`/customers/${estimate.customer_id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to {customerName}
      </Link>

      {/* Estimate header */}
      <Card className="mb-6">
        <CardContent className="space-y-4 pt-6">
          {/* Overall profit margin — drives every line without its own override */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Overall profit margin</div>
              <div className="text-xs text-muted-foreground">
                Applies to every line without its own margin — change it to re-price them all at once.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.5"
                min="0"
                max="99"
                value={overallMargin}
                onChange={(e) => changeOverallMargin(e.target.value)}
                className="h-11 w-24 text-lg font-semibold"
                aria-label="Overall profit margin percent"
              />
              <span className="text-lg font-semibold">%</span>
            </div>
          </div>

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
          // Material vs labor split — so you can see (and decide) where the cost is.
          const costSplit = option.lines.reduce(
            (a, l) => {
              const s = lineCostSplit(l);
              return { mat: a.mat + s.mat, labor: a.labor + s.labor };
            },
            { mat: 0, labor: 0 },
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
              <CardContent className="space-y-5">
                {(["mat", "labor"] as const).map((section) => {
                  const secLines = option.lines
                    .map((line, li) => ({ line, li }))
                    .filter(({ line }) => (section === "labor") === isLaborLine(line));
                  const secSub = secLines.reduce((s, { line }) => s + lineTotal(toCalc(line)), 0);
                  return (
                    <div key={section} className="space-y-2">
                      <div className="flex items-center justify-between border-b pb-1.5">
                        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                          {section === "labor" ? "Labor" : "Materials"}
                        </h3>
                        <span className="text-sm font-semibold tabular-nums">{formatMoney(secSub)}</span>
                      </div>
                      {secLines.length === 0 ? (
                        <p className="px-1 py-1 text-xs text-muted-foreground">
                          {section === "labor" ? "No labor lines yet." : "No material lines yet."}
                        </p>
                      ) : null}
                      {secLines.map(({ line, li }) => {
                  const summ = {
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
                  const sQty = lineQty(summ);
                  const sUnit = line.unit || (line.measure_unit === "sqyd" ? "sq yd" : "sq ft");
                  const sSell = lineTotal(summ);
                  const sCost = lineOurCost(line);
                  const sMargin = sSell > 0 ? ((sSell - sCost) / sSell) * 100 : 0;
                  const isOpen = openLines.has(line.key);
                  return (
                    <div key={line.key} className="overflow-hidden rounded-xl border bg-card">
                      {/* Summary row — tap to edit */}
                      <button
                        type="button"
                        onClick={() => toggleLine(line.key)}
                        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/40"
                      >
                        <ChevronRight
                          className={cn(
                            "size-4 shrink-0 text-muted-foreground transition-transform",
                            isOpen && "rotate-90",
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-base font-semibold">
                            {line.description || (
                              <span className="font-normal text-muted-foreground">Untitled line — tap to edit</span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            {line.room ? <span>{line.room}</span> : null}
                            {line.line_type !== "flat" && sQty > 0 ? (
                              <span className="tabular-nums">
                                {sQty.toFixed(sQty < 100 ? 1 : 0)} {sUnit}
                              </span>
                            ) : null}
                            {line.category === "labor" ? (
                              <span className="rounded-full bg-muted px-1.5 py-0.5 font-medium">Labor</span>
                            ) : null}
                            {line.from_stock ? (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
                                From stock
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-base font-bold tabular-nums">{formatMoney(sSell)}</div>
                          {sCost > 0 ? (
                            <div className="text-xs tabular-nums text-muted-foreground">{Math.round(sMargin)}% margin</div>
                          ) : null}
                        </div>
                      </button>

                      {/* Editor — only when expanded */}
                      {isOpen ? (
                      <div className="space-y-3 border-t bg-muted/20 p-4">
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

                    <details className="mt-2 rounded-md border bg-card [&_summary]:list-none">
                    <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
                      Catalog details (manufacturer, style, color, item #)
                    </summary>
                    <div className="grid grid-cols-2 gap-2 border-t p-2.5 sm:grid-cols-4">
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
                    </details>

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

                      {line.line_type !== "flat" && line.category !== "labor" ? (
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">
                            Source
                          </label>
                          <div className="inline-flex rounded-md border p-0.5 text-xs">
                            <button
                              type="button"
                              onClick={() => updateLine(oi, li, { from_stock: false })}
                              className={cn(
                                "rounded px-2.5 py-1.5 font-medium",
                                !line.from_stock ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                              )}
                            >
                              Order
                            </button>
                            <button
                              type="button"
                              onClick={() => updateLine(oi, li, { from_stock: true })}
                              className={cn(
                                "rounded px-2.5 py-1.5 font-medium",
                                line.from_stock ? "bg-amber-500 text-white" : "text-muted-foreground",
                              )}
                            >
                              From stock
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {/* Order as roll — PO shows one roll; work order keeps the cuts */}
                      {line.line_type !== "flat" && line.category !== "labor" && !line.from_stock ? (
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">Order as</label>
                          <div className="flex items-center gap-2">
                            <div className="inline-flex rounded-md border p-0.5 text-xs">
                              <button
                                type="button"
                                onClick={() => updateLine(oi, li, { order_as_roll: false })}
                                className={cn("rounded px-2.5 py-1.5 font-medium", !line.order_as_roll ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                              >
                                Cuts
                              </button>
                              <button
                                type="button"
                                onClick={() => updateLine(oi, li, { order_as_roll: true, roll_width_ft: line.roll_width_ft || "12" })}
                                className={cn("rounded px-2.5 py-1.5 font-medium", line.order_as_roll ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                              >
                                Roll
                              </button>
                            </div>
                            {line.order_as_roll ? (
                              <select
                                value={line.roll_width_ft || "12"}
                                onChange={(e) => updateLine(oi, li, { roll_width_ft: e.target.value })}
                                className="h-8 rounded-md border border-input bg-transparent px-1.5 text-xs"
                                aria-label="Roll width"
                              >
                                <option value="12">12 ft wide</option>
                                <option value="15">15 ft wide</option>
                              </select>
                            ) : null}
                          </div>
                          {line.order_as_roll ? (
                            <p className="mt-1 text-xs text-muted-foreground">PO orders one roll; the work order shows the cut sizes.</p>
                          ) : null}
                        </div>
                      ) : null}

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
                          <div className="flex items-end gap-2">
                            <LabeledNumber
                              label="Sq ft"
                              value={line.sqft}
                              onChange={(v) => updateLine(oi, li, { sqft: v, quantity: "" })}
                            />
                            <AreaCalculator
                              triggerLabel="Add up areas"
                              triggerVariant="ghost"
                              triggerClassName="h-9 px-2 text-xs"
                              title={`Square footage${line.room ? ` — ${line.room}` : ""}`}
                              initialLabel={line.room}
                              onApply={(area) => updateLine(oi, li, { sqft: String(area), quantity: "" })}
                            />
                          </div>
                          <div className="pb-2 text-xs text-muted-foreground">
                            {(num(line.sqft) / 9).toFixed(1)} sq yd
                          </div>
                          <LabeledNumber
                            label={`Qty${line.unit ? ` (${line.unit})` : ""}`}
                            value={line.quantity}
                            width="w-20"
                            onChange={(v) => updateLine(oi, li, { quantity: v })}
                          />
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
                        (() => {
                          const labor = isLaborLine(line);
                          const unitLbl = line.unit || (line.measure_unit === "sqyd" ? "sq yd" : "sq ft");
                          const overriding = line.margin_pct.trim() !== "";
                          return (
                            <div className="w-full space-y-1.5 rounded-lg border bg-card p-3">
                              <div className="grid grid-cols-3 gap-2">
                                <LabeledNumber
                                  label={`Our cost /${unitLbl}`}
                                  prefix="$"
                                  width="w-full"
                                  value={labor ? line.labor_cost : line.material_cost}
                                  onChange={(v) => changeLineCost(oi, li, labor ? "labor_cost" : "material_cost", v)}
                                />
                                <div>
                                  <label className="mb-1 block text-xs text-muted-foreground">Margin %</label>
                                  <Input
                                    value={line.margin_pct}
                                    onChange={(e) => changeLineMargin(oi, li, e.target.value)}
                                    placeholder={overallMargin}
                                    inputMode="decimal"
                                    className="h-9"
                                  />
                                </div>
                                <LabeledNumber
                                  label={`Sell /${unitLbl}`}
                                  prefix="$"
                                  width="w-full"
                                  value={labor ? line.labor_rate : line.material_rate}
                                  onChange={(v) => changeLineSell(oi, li, labor ? "labor_rate" : "material_rate", v)}
                                />
                              </div>
                              <div className="text-xs">
                                {overriding ? (
                                  <span className="text-primary">
                                    Custom margin — overrides the overall {overallMargin}%.{" "}
                                    <button type="button" className="underline underline-offset-2" onClick={() => changeLineMargin(oi, li, "")}>
                                      Use overall
                                    </button>
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">Following the overall {overallMargin}% margin.</span>
                                )}
                              </div>
                              {!labor && num(line.labor_cost) > 0 ? (
                                <div className="grid grid-cols-2 gap-2 border-t pt-2">
                                  <LabeledNumber label="Labor cost" prefix="$" width="w-full" value={line.labor_cost} onChange={(v) => changeLineCost(oi, li, "labor_cost", v)} />
                                  <LabeledNumber label="Labor sell" prefix="$" width="w-full" value={line.labor_rate} onChange={(v) => changeLineSell(oi, li, "labor_rate", v)} />
                                </div>
                              ) : null}
                            </div>
                          );
                        })()
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

                      <div className="ml-auto" />
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
                      ) : null}
                    </div>
                  );
                })}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addLine(oi, section === "labor")}
                      >
                        <Plus className="size-3.5" /> Add {section === "labor" ? "labor" : "material"}
                      </Button>
                    </div>
                  );
                })}

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
                      {costSplit.mat > 0 || costSplit.labor > 0 ? (
                        <div className="flex justify-between pl-3 text-xs text-muted-foreground/80">
                          <span>
                            ↳ Material {formatMoney(costSplit.mat)} · Labor{" "}
                            {formatMoney(costSplit.labor)}
                          </span>
                        </div>
                      ) : null}
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
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 border-t bg-background/95 p-3 backdrop-blur md:bottom-0 md:pl-64">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-muted-foreground">Total</span>
            <span className="text-xl font-bold tabular-nums">{formatMoney(grand.total)}</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              (sub {formatMoney(grand.subtotal)} · tax {formatMoney(grand.tax)})
            </span>
          </div>
          <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={saveThenPrint}
          >
            <Printer className="size-4" /> Save &amp; print
          </Button>
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
    </div>
    {org ? (
      <EstimatePrintDoc
        org={org}
        customer={customer}
        title={title}
        presentation={presentation}
        jobDescription={jobDescription}
        notes={notes}
        taxRate={taxRate}
        options={options}
      />
    ) : null}
    </>
  );
}

/** Clean, print-only estimate document (itemized or lump sum, per option). */
function EstimatePrintDoc({
  org,
  customer,
  title,
  presentation,
  jobDescription,
  notes,
  taxRate,
  options,
}: {
  org: OrgSettings;
  customer: Customer | null;
  title: string;
  presentation: EstimatePresentation;
  jobDescription: string;
  notes: string;
  taxRate: string;
  options: OptionState[];
}) {
  const detailed = presentation === "detailed";
  const calc = (l: LineState) => ({
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
  const addr = customer
    ? [customer.street, [customer.city, customer.state].filter(Boolean).join(", "), customer.zip]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <div className="hidden text-black print:block">
      <div className="flex items-start justify-between gap-6 border-b pb-4">
        <div className="text-xl font-bold">{org.company_name}</div>
        <div className="text-right">
          <div className="text-lg font-semibold">ESTIMATE</div>
          {title ? <div className="text-sm">{title}</div> : null}
        </div>
      </div>

      {customer ? (
        <div className="py-4 text-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">Prepared for</div>
          <div className="font-medium">{customer.full_name}</div>
          {addr ? <div className="text-xs text-gray-600">{addr}</div> : null}
        </div>
      ) : null}

      {jobDescription ? (
        <p className="mb-4 whitespace-pre-wrap text-sm">{jobDescription}</p>
      ) : null}

      {options.map((o, oi) => {
        const totals = optionTotals(o.lines.map(calc), taxRate);
        return (
          <div key={oi} className="mb-5">
            {options.length > 1 ? (
              <div className="mb-1 text-sm font-semibold">{o.name}</div>
            ) : null}
            {detailed ? (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="py-1 pr-2 font-medium">Description</th>
                    <th className="py-1 pl-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {o.lines
                    .filter((l) => l.description.trim() || lineTotal(calc(l)) > 0)
                    .map((l, li) => (
                      <tr key={li} className="border-b align-top">
                        <td className="py-1 pr-2">
                          {l.room ? `${l.room} — ` : ""}
                          {l.description}
                        </td>
                        <td className="py-1 pl-2 text-right tabular-nums">
                          {formatMoney(lineTotal(calc(l)))}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : null}
            <div className="ml-auto mt-2 w-64 text-sm">
              {detailed ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Subtotal</span>
                    <span>{formatMoney(totals.subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Tax</span>
                    <span>{formatMoney(totals.tax)}</span>
                  </div>
                </>
              ) : null}
              <div className="flex justify-between border-t pt-1 text-base font-bold">
                <span>{options.length > 1 ? `${o.name} total` : "Total"}</span>
                <span>{formatMoney(totals.total)}</span>
              </div>
            </div>
          </div>
        );
      })}

      {notes ? (
        <div className="mt-4 text-xs text-gray-600">
          <p className="whitespace-pre-wrap">{notes}</p>
        </div>
      ) : null}
    </div>
  );
}
