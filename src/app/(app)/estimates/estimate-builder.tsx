"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Copy, Trash2, ArrowLeft, Save, Eye, Sparkles, Printer, ChevronRight, Star, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import {
  lineTotal,
  lineQty,
  optionTotalsWithDiscount,
  priceFromMargin,
  marginPct,
  num,
  type SaveEstimateInput,
} from "@/lib/estimate-calc";
import {
  type Estimate,
  type EstimateLineItem,
  type EstimatePresentation,
  type LineType,
  type MeasureUnit,
  type Product,
  type Customer,
  type OrgSettings,
  isRollGoodCategory,
  isHardSurfaceCategory,
} from "@/lib/types";
import { EstimateOptionCards } from "@/components/estimate-option-cards";
import {
  isAreaUnit,
  normalizeUnit,
  unitLabel,
  UNIT_OPTIONS,
} from "@/lib/units";
import {
  bagsNeeded,
  coverageAt,
  hasCoverage,
  thicknessLabel,
  THICKNESS_OPTIONS,
  DEFAULT_LABOR_PER_SQFT,
} from "@/lib/floor-prep";
import { saveEstimate } from "./actions";
import { writeScopeDescription, draftLinesFromText } from "./ai-actions";
import type { SmartLine } from "./smart-actions";
import { ProductPicker, type CustomProductInput } from "./product-picker";
import type { AddonCatalogItem } from "@/lib/data/addon-defaults";
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
  sqft_per_box: string; // hard surface: coverage per carton → box count
  is_fill: boolean; // carpet: a fill / seam piece cut for an area
  is_optional: boolean; // an optional add-on within its option (owner marker)
  coverage_sqft: string; // prep: SF a bag covers at the reference thickness
  coverage_thickness_in: string; // prep: reference thickness ("" = flat coverage)
  prep_thickness_in: string; // prep: the pour thickness the bag calc used
  prep_key: string; // links a prep material line to its auto-populated labor line
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

/** Subfloor / underlayment sheet goods — priced by the sheet, valid under carpet
 *  or hard surface. "Confirm on site" leaves the count/price to fill in later. */
const SUBFLOOR_OPTIONS = [
  '1/4" Plywood',
  '3/8" Plywood',
  '1/2" Plywood',
  '3/4" Plywood',
  "Custom",
  "Confirm on job site",
] as const;
/** A subfloor line is underlayment priced by the sheet. */
function isSubfloor(l: LineState): boolean {
  return l.category === "underlayment" && l.unit === "sheet";
}

/** A COUNT-priced line: billed by the each / bag / linear ft… (an explicit
 *  quantity × per-unit price), NOT by measured area. Roll goods and hard surface
 *  are always area-billed regardless of a stray unit string. */
function isCountLine(l: LineState): boolean {
  if (isRollGoodCategory(l.category) || isHardSurfaceCategory(l.category)) return false;
  if (isSubfloor(l)) return false;
  return !isAreaUnit(l.unit);
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
  colorSuggestions = [],
  manufacturerSuggestions = [],
  addonCatalog = [],
  productUnits = {},
}: {
  estimate: Estimate;
  customerName: string;
  customer?: Customer | null;
  org?: OrgSettings;
  autoPrint?: boolean;
  /** Colors already used (estimates + catalog) — autocomplete the Color field. */
  colorSuggestions?: string[];
  /** Manufacturers already used — autocomplete the Manufacturer field. */
  manufacturerSuggestions?: string[];
  /** The single add-on catalog (built-in + custom), pre-priced from defaults. */
  addonCatalog?: AddonCatalogItem[];
  /** Catalog unit of each linked product id — flags area-priced lines whose
   *  product is really sold by the each/bag (the sq-ft-on-a-pail bug). */
  productUnits?: Record<string, string>;
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
    sqft_per_box: "",
    is_fill: false,
    is_optional: false,
    coverage_sqft: "",
    coverage_thickness_in: "",
    prep_thickness_in: "",
    prep_key: "",
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
  // Whole-job discount (owner-applied). Shows in the owner totals; the customer
  // only ever sees the discounted lump sum.
  const [discountKind, setDiscountKind] = useState<"amount" | "percent">(
    estimate.discount_kind === "percent" ? "percent" : "amount",
  );
  const [discountValue, setDiscountValue] = useState(
    estimate.discount_value ? String(estimate.discount_value) : "",
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
        sqft_per_box: l.sqft_per_box != null ? String(l.sqft_per_box) : "",
        is_fill: !!l.is_fill,
        is_optional: !!l.is_optional,
        coverage_sqft: l.coverage_sqft != null ? String(l.coverage_sqft) : "",
        coverage_thickness_in: l.coverage_thickness_in != null ? String(l.coverage_thickness_in) : "",
        prep_thickness_in: l.prep_thickness_in != null ? String(l.prep_thickness_in) : "",
        prep_key: l.prep_key ?? "",
      })),
    }));
    return initial.length
      ? initial
      : [{ key: newKey(), name: "Option 1", notes: "", lines: [emptyLine()] }];
  });

  const updateOption = (oi: number, patch: Partial<OptionState>) =>
    setOptions((prev) => prev.map((o, i) => (i === oi ? { ...o, ...patch } : o)));

  // Rooms & areas — the measurement backbone (seeded from existing line rooms).
  // Measure a room once, then drop a flooring material into it (area auto-fills).
  const [rooms, setRooms] = useState<{ key: string; name: string; sqft: string }[]>(() => {
    const seen = new Map<string, string>();
    for (const o of estimate.options ?? [])
      for (const l of o.line_items ?? [])
        if (l.room && !seen.has(l.room))
          seen.set(l.room, l.sqft != null ? String(l.sqft) : "");
    return [...seen].map(([name, sqft]) => ({ key: newKey(), name, sqft }));
  });
  const addRoom = () => setRooms((r) => [...r, { key: newKey(), name: "", sqft: "" }]);
  const updateRoom = (i: number, patch: Partial<{ name: string; sqft: string }>) =>
    setRooms((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const removeRoom = (i: number) => setRooms((r) => r.filter((_, j) => j !== i));
  // Start a flooring material for a room: add a material line pre-set to the
  // room + its area, open it, so you just search the product.
  const addFlooringForRoom = (oi: number, room: { name: string; sqft: string }) => {
    const li = options[oi]?.lines.length ?? 0;
    addLine(oi, false);
    updateLine(oi, li, { room: room.name, sqft: room.sqft });
  };
  // Drop a PREP line tagged to a room (moisture, skim coat, subfloor prep…),
  // priced by the room's area — so per-room prep flows to the work order under
  // that room. It's a labor line by default; add the material (e.g. a bag of
  // self-leveler) via the material search when it's a bag good.
  const addPrepForRoom = (oi: number, room: { name: string; sqft: string }) => {
    const li = options[oi]?.lines.length ?? 0;
    addLine(oi, true);
    updateLine(oi, li, {
      room: room.name,
      description: "Floor prep",
      unit: "sq ft",
      measure_unit: "sqft",
      sqft: room.sqft,
      quantity: "",
    });
  };

  // --- New-builder UI state -------------------------------------------------
  // One option shown at a time (tabs), and an owner ⇄ customer preview flip.
  const [activeOption, setActiveOption] = useState(0);
  const [previewCustomer, setPreviewCustomer] = useState(false);

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
    setOptions((prev) => {
      if (prev.length <= 1) return prev;
      const removed = prev[oi];
      if (removed && removed.key === recommendedKey) setRecommendedKey(null);
      return prev.filter((_, i) => i !== oi);
    });

  // Which option the owner recommends (tracked by client key so it survives
  // reordering/duplication). Maps the loaded recommended option to its key once.
  const [recommendedKey, setRecommendedKey] = useState<string | null>(null);
  useEffect(() => {
    const recIdx = (estimate.options ?? []).findIndex(
      (o) => o.id === estimate.recommended_option_id,
    );
    if (recIdx >= 0) setRecommendedKey(options[recIdx]?.key ?? null);
    // Run once on mount to align the persisted recommended option to its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggleRecommended = (key: string) =>
    setRecommendedKey((cur) => (cur === key ? null : key));

  // Spawn a sibling option WITHOUT the lines marked optional — the one-tap
  // "with / without" so a good/better pair doesn't need manual re-entry.
  const optionWithoutOptionals = (oi: number) =>
    setOptions((prev) => {
      const src = prev[oi];
      const kept = src.lines.filter((l) => !l.is_optional);
      const copy: OptionState = {
        key: newKey(),
        name: `${src.name} — without add-ons`,
        notes: src.notes,
        lines: (kept.length ? kept : src.lines).map((l) => ({
          ...l,
          key: newKey(),
          is_optional: false,
        })),
      };
      const next = [...prev];
      next.splice(oi + 1, 0, copy);
      return next;
    });

  const addLine = (oi: number, asLabor = false) => {
    // Carry the manufacturer forward from the last material line so multiple cuts
    // of the same carpet don't need it retyped (the catalog fills it when picked).
    let manufacturer = "";
    if (!asLabor) {
      const prevMat = [...(options[oi]?.lines ?? [])]
        .reverse()
        .find((l) => !isLaborLine(l) && l.manufacturer.trim());
      manufacturer = prevMat?.manufacturer ?? "";
    }
    const line: LineState = asLabor
      ? { ...emptyLine(), category: "labor" }
      : { ...emptyLine(), manufacturer };
    setOptions((prev) =>
      prev.map((o, i) => (i === oi ? { ...o, lines: [...o.lines, line] } : o)),
    );
    setOpenLines((s) => new Set(s).add(line.key)); // open the new line for editing
  };

  // Add a catalog add-on as a pre-priced line — configured in Settings →
  // Default pricing (the single add-on source of truth). The user fills the qty.
  const addAddon = (oi: number, a: AddonCatalogItem) => {
    const isLabor = a.labor;
    const sell = a.sell != null ? String(a.sell) : "";
    const cost = a.cost != null ? String(a.cost) : "";
    const category = isLabor
      ? "labor"
      : /transition|reducer|t-?mold|threshold|nose|molding|trim|quarter|shoe|base/i.test(a.label)
        ? "trim"
        : "other";
    const line: LineState = {
      ...emptyLine(),
      description: a.label,
      line_type: "mat_labor",
      category,
      unit: a.unit || "each",
      material_rate: isLabor ? "" : sell,
      labor_rate: isLabor ? sell : "",
      material_cost: isLabor ? "" : cost,
      labor_cost: isLabor ? cost : "",
    };
    setOptions((prev) =>
      prev.map((o, i) => (i === oi ? { ...o, lines: [...o.lines, line] } : o)),
    );
    setOpenLines((s) => new Set(s).add(line.key));
  };

  /** Add a subfloor line (underlayment, priced by the sheet). */
  const addSubfloor = (oi: number, label: string) => {
    const confirm = label === "Confirm on job site";
    const line: LineState = {
      ...emptyLine(),
      category: "underlayment",
      unit: "sheet",
      line_type: "installed",
      description: confirm ? "Subfloor — confirm thickness & sheets on site" : `Subfloor — ${label}`,
      quantity: confirm ? "" : "1",
    };
    setOptions((prev) =>
      prev.map((o, i) => (i === oi ? { ...o, lines: [...o.lines, line] } : o)),
    );
    setOpenLines((s) => new Set(s).add(line.key));
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

  /** Add a FILL piece for the same area/material right below the line — same
   *  product & pricing, blank cut size, flagged as fill so it lists under its
   *  area on every doc and its yardage rolls into the order. */
  const addFillPiece = (oi: number, li: number) => {
    const key = newKey();
    setOptions((prev) =>
      prev.map((o, i) => {
        if (i !== oi) return o;
        const src = o.lines[li];
        const fill: LineState = {
          ...src,
          key,
          is_fill: true,
          // Fresh, empty cut — the user measures the fill piece.
          sqft: "",
          quantity: "",
          len_ft: "",
          len_in: "",
          wid_ft: "",
          wid_in: "",
        };
        const lines = [...o.lines];
        lines.splice(li + 1, 0, fill);
        return { ...o, lines };
      }),
    );
    setOpenLines((s) => new Set(s).add(key)); // open the new fill line for editing
  };

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

  // Switch a line's pricing unit. Area units (sq ft / sq yd) keep the area math;
  // a count unit (each / bag / lnft…) flips the line to price by quantity × the
  // per-unit rate, seeds a qty of 1, and drops any area waste %.
  const setLineUnit = (oi: number, li: number, unitValue: string) =>
    setOptions((prev) =>
      prev.map((o, i) =>
        i === oi
          ? {
              ...o,
              lines: o.lines.map((l, j) => {
                if (j !== li) return l;
                if (isAreaUnit(unitValue)) {
                  // → area: let the measured area drive the quantity again.
                  return {
                    ...l,
                    measure_unit: (unitValue === "sqyd" ? "sqyd" : "sqft") as MeasureUnit,
                    unit: unitValue === "sqyd" ? "sq yd" : "sq ft",
                    quantity: "",
                  };
                }
                // → count: a FRESH count of 1 — never carry over the old square
                // footage (that's the "1693 each" bug), and drop area waste + dims.
                // A PREP line keeps its area (sqft) — the bag calculator uses it.
                const prepLine = !!l.coverage_sqft;
                return {
                  ...l,
                  unit: unitValue,
                  quantity: prepLine ? l.quantity : "1",
                  sqft: prepLine ? l.sqft : "",
                  len_ft: "",
                  len_in: "",
                  wid_ft: "",
                  wid_in: "",
                  waste_pct: "",
                };
              }),
            }
          : o,
      ),
    );

  // Move the labor bundled on a material line onto its OWN labor line, so
  // material and labor stay separate (each with its own cost / qty / margin).
  const splitLaborToLine = (oi: number, li: number) => {
    const key = newKey();
    setOptions((prev) =>
      prev.map((o, i) => {
        if (i !== oi) return o;
        const src = o.lines[li];
        const laborLine: LineState = {
          ...emptyLine(),
          key,
          category: "labor",
          room: src.room,
          description: src.description ? `${src.description} — labor` : "Labor",
          unit: src.unit,
          measure_unit: src.measure_unit,
          quantity: src.quantity,
          sqft: src.sqft,
          labor_cost: src.labor_cost,
          labor_rate: src.labor_rate,
          margin_pct: src.margin_pct,
        };
        const lines = o.lines.map((l, j) =>
          j === li ? { ...l, labor_cost: "0", labor_rate: "0" } : l,
        );
        lines.splice(li + 1, 0, laborLine);
        return { ...o, lines };
      }),
    );
    setOpenLines((s) => new Set(s).add(key));
  };

  // Recompute a prep line's bag count from area/thickness, and keep any linked
  // self-leveling labor line's quantity in sync (area for a per-sq-ft labor line,
  // bags for a per-bag one). A `quantity` in the patch is treated as an override.
  const recalcPrep = (oi: number, li: number, patch: Partial<LineState>) =>
    setOptions((prev) =>
      prev.map((o, i) => {
        if (i !== oi) return o;
        const src = { ...o.lines[li], ...patch };
        const cov = num(src.coverage_sqft);
        const covT = num(src.coverage_thickness_in);
        const scales = covT > 0;
        const t = scales ? num(src.prep_thickness_in) || covT : 0;
        const bags = bagsNeeded(src.sqft, cov, scales ? covT : null, scales ? t : null);
        const mat = patch.quantity !== undefined ? src : { ...src, quantity: String(bags) };
        const area = num(mat.sqft);
        const finalBags = num(mat.quantity);
        const pk = mat.prep_key;
        const lines = o.lines.map((l, j) => {
          if (j === li) return mat;
          if (pk && l.prep_key === pk && l.category === "labor") {
            const perBag = !isAreaUnit(l.unit); // labor line billed by the bag
            return { ...l, quantity: String(perBag ? finalBags : area) };
          }
          return l;
        });
        return { ...o, lines };
      }),
    );

  // Add a SEPARATE self-leveling labor line, linked to the prep material by a
  // shared prep_key, with its quantity auto-populated from the calculator
  // (per sq ft by default; flip the labor line's unit to bill per bag).
  const addSelfLevelingLabor = (oi: number, li: number) => {
    const laborKey = newKey();
    const prepKey = `pk${keyCounter.current++}`;
    setOptions((prev) =>
      prev.map((o, i) => {
        if (i !== oi) return o;
        const src = o.lines[li];
        const area = num(src.sqft);
        const laborLine: LineState = {
          ...emptyLine(),
          key: laborKey,
          category: "labor",
          line_type: "mat_labor",
          // Inherit the prep material's room so per-room prep flows to the work
          // order under the same room (no separate room entry needed).
          room: src.room,
          description: src.description ? `${src.description} — labor` : "Self-leveling labor",
          unit: "sq ft",
          measure_unit: "sqft",
          quantity: area ? String(area) : "",
          labor_cost: String(DEFAULT_LABOR_PER_SQFT),
          prep_key: prepKey,
        };
        const priced = { ...laborLine, ...ratesFromMargin(laborLine, num(overallMargin)) };
        const lines = o.lines.map((l, j) => (j === li ? { ...l, prep_key: prepKey } : l));
        lines.splice(li + 1, 0, priced);
        return { ...o, lines };
      }),
    );
    setOpenLines((s) => new Set(s).add(laborKey));
  };

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
    // Respect the product's OWN unit. Count units (each / bag / linear ft…) price
    // by quantity in that unit — no area, no ×9 conversion, no waste. Area units
    // (sq ft / sq yd) keep the area math; carpet is quoted by the square yard, so
    // its catalog rate converts ×9 if the catalog priced it per sq ft.
    const catUnit = normalizeUnit(p.unit); // "sqft" | "sqyd" | "bag" | …
    const count = !isAreaUnit(p.unit);
    const measure_unit: MeasureUnit = isRollGoodCategory(p.category)
      ? "sqyd"
      : catUnit === "sqyd"
        ? "sqyd"
        : "sqft";
    // Convert the catalog rate into the line's area billing unit (area only).
    const factor = count
      ? 1
      : measure_unit === (catUnit || "sqft")
        ? 1
        : measure_unit === "sqyd"
          ? 9
          : 1 / 9;
    // Count lines display in the product's own unit; area lines in sq ft / sq yd.
    const lineUnit = count
      ? p.unit || "each"
      : measure_unit === "sqyd"
        ? "sq yd"
        : "sq ft";
    const round2 = (n: number) => String(Math.round(n * 100) / 100);
    // Prep goods (self-leveler / patch) carry coverage → the bag calculator
    // sizes the quantity from area + thickness instead of a plain count.
    const prep = count && hasCoverage(p.coverage_sqft);

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
                  // MATERIAL ONLY — labor is priced on its own separate line, so
                  // a material line never bundles labor into a combined price.
                  material_cost: round2(p.material_rate * factor),
                  labor_cost: "0",
                  labor_rate: "0",
                  manufacturer: p.manufacturer ?? l.manufacturer,
                  style: p.style ?? l.style,
                  color: p.color ?? l.color,
                  item_no: p.sku ?? l.item_no,
                  measure_unit,
                  unit: lineUnit,
                  // Snapshot the product's coverage so the estimate's bag math is
                  // stable; seed the pour thickness to the reference thickness.
                  coverage_sqft: prep ? String(p.coverage_sqft) : "",
                  coverage_thickness_in:
                    prep && p.coverage_thickness_in != null ? String(p.coverage_thickness_in) : "",
                  prep_thickness_in:
                    prep && p.coverage_thickness_in != null ? String(p.coverage_thickness_in) : "",
                  // Prep lines get their quantity from the calculator (area drives
                  // bags); plain count items default to 1 so they price at once.
                  quantity: prep ? l.quantity : count ? l.quantity || "1" : l.quantity,
                  // Only suggest waste when the quantity is area-driven (no
                  // explicit qty) — avoids double-counting a qty that already
                  // includes waste (e.g. from the questionnaire). Never on count.
                  waste_pct: count
                    ? ""
                    : l.quantity
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

  // "Use once": a trim / product typed in the picker that isn't in the catalog,
  // dropped onto THIS estimate line only (no product_id, nothing saved).
  const useOnceProduct = (oi: number, li: number, input: CustomProductInput) => {
    const catUnit = normalizeUnit(input.unit);
    const count = !isAreaUnit(input.unit);
    const measure_unit: MeasureUnit = catUnit === "sqyd" ? "sqyd" : "sqft";
    const round2 = (n: number) => String(Math.round(n * 100) / 100);
    const prep = count && hasCoverage(input.coverage_sqft);
    setOptions((prev) =>
      prev.map((o, i) =>
        i === oi
          ? {
              ...o,
              lines: o.lines.map((l, j) => {
                if (j !== li) return l;
                const base: LineState = {
                  ...l,
                  product_id: "",
                  category: input.category || l.category,
                  material_cost: input.material_rate ? round2(num(input.material_rate)) : l.material_cost,
                  labor_cost: input.labor_rate ? round2(num(input.labor_rate)) : l.labor_cost,
                  manufacturer: input.manufacturer || l.manufacturer,
                  style: input.style || l.style,
                  color: input.color || l.color,
                  item_no: input.sku || l.item_no,
                  unit: input.unit || l.unit,
                  measure_unit,
                  coverage_sqft: prep ? String(num(input.coverage_sqft)) : "",
                  coverage_thickness_in: prep && input.coverage_thickness_in ? String(num(input.coverage_thickness_in)) : "",
                  prep_thickness_in: prep && input.coverage_thickness_in ? String(num(input.coverage_thickness_in)) : "",
                  // Count items price by quantity — default to 1, no area waste.
                  // Prep lines get their quantity from the bag calculator (area).
                  quantity: prep ? l.quantity : count ? l.quantity || "1" : l.quantity,
                  waste_pct: count ? "" : l.waste_pct,
                  description: input.name || l.description,
                };
                return { ...base, ...ratesFromMargin(base, effMargin(base, num(overallMargin))) };
              }),
            }
          : o,
      ),
    );
  };

  // Search-first add: append a material line, then apply the picked/created/
  // use-once product to it. Functional setState updates apply in order, so the
  // new line (at index `li`) is patched right after it's appended.
  const addMaterialFromPick = (oi: number, p: Product | null) => {
    if (!p) return;
    const li = options[oi]?.lines.length ?? 0;
    addLine(oi, false);
    pickProduct(oi, li, p);
  };
  const addMaterialUseOnce = (oi: number, input: CustomProductInput) => {
    const li = options[oi]?.lines.length ?? 0;
    addLine(oi, false);
    useOnceProduct(oi, li, input);
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
        sqft_per_box: l.sqft_per_box || null,
        is_fill: l.is_fill,
        is_optional: l.is_optional,
        coverage_sqft: l.coverage_sqft || null,
        coverage_thickness_in: l.coverage_thickness_in || null,
        prep_thickness_in: l.prep_thickness_in || null,
        prep_key: l.prep_key || null,
      })),
    })),
    target_margin: num(overallMargin) || null,
    discount_kind: discountKind,
    discount_value: num(discountValue) || 0,
    recommended_index: options.findIndex((o) => o.key === recommendedKey),
  });

  const save = (thenView: boolean) =>
    startTransition(async () => {
      const res = await saveEstimate(estimate.id, buildInput());
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Estimate saved");
      // "Save & view" opens the estimate; a plain "Save" returns to the
      // customer's dashboard (the job's spine) — only ever on a successful save.
      if (thenView) router.push(`/estimates/${estimate.id}`);
      else router.push(`/customers/${estimate.customer_id}`);
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

  // AI "pre-fill from a description" — describe the job in plain English and the
  // same engine the guided flow used generates lines, merged into the active
  // option's LIVE state (nothing saved until you Save). Review & adjust after.
  const [aiText, setAiText] = useState("");
  const [aiPrefillBusy, setAiPrefillBusy] = useState(false);
  const smartLineToState = (s: SmartLine): LineState => ({
    ...emptyLine(),
    room: s.room ?? "",
    description: s.description ?? "",
    line_type: "mat_labor",
    sqft: s.sqft ? String(s.sqft) : "",
    len_ft: inToFt(s.length_in),
    len_in: inToIn(s.length_in),
    wid_ft: inToFt(s.width_in),
    wid_in: inToIn(s.width_in),
    measure_unit: s.measure_unit,
    material_rate: s.material_rate ? String(s.material_rate) : "",
    labor_rate: s.labor_rate ? String(s.labor_rate) : "",
    material_cost: s.material_cost ? String(s.material_cost) : "",
    labor_cost: s.labor_cost ? String(s.labor_cost) : "",
    quantity: s.quantity ? String(s.quantity) : "",
    unit: s.unit ?? "",
    category: s.category ?? "",
    waste_pct: s.waste_pct ? String(s.waste_pct) : "",
    product_id: s.product_id ?? "",
    manufacturer: s.manufacturer ?? "",
    style: s.style ?? "",
    color: s.color ?? "",
    from_stock: !!s.from_stock,
    sqft_per_box: s.sqft_per_box ? String(s.sqft_per_box) : "",
    is_fill: !!s.is_fill,
  });
  const prefillFromText = async () => {
    if (!aiText.trim()) return;
    setAiPrefillBusy(true);
    const res = await draftLinesFromText(aiText);
    setAiPrefillBusy(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    const newLines = res.lines.map(smartLineToState);
    setOptions((prev) =>
      prev.map((o, i) => {
        if (i !== safeActive) return o;
        // Drop a lone empty starter line; otherwise append.
        const kept = o.lines.filter(
          (l) => l.description.trim() || num(l.sqft) || num(l.quantity) || l.product_id,
        );
        return { ...o, lines: [...kept, ...newLines] };
      }),
    );
    setAiText("");
    toast.success(`Added ${newLines.length} line${newLines.length === 1 ? "" : "s"} — review & adjust`);
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
    discountKind,
    discountValue,
  );
  const grandCost = options.flatMap((o) => o.lines).reduce((s, l) => s + lineOurCost(l), 0);
  const grandMargin = marginPct(grand.subtotal, grandCost);
  // Active option, clamped so removing an option never points off the end.
  const safeActive = Math.min(Math.max(activeOption, 0), Math.max(options.length - 1, 0));

  // Live "what the customer sees" — convert the builder's form lines to the
  // shape the customer scope + option cards read, so Preview matches the sent
  // estimate exactly (scope in words + lump sum, no numbers). Reuses the engine.
  const toEstimateLine = (l: LineState, i: number): EstimateLineItem => ({
    id: `${l.key}`,
    option_id: "",
    position: i,
    room: l.room || null,
    description: l.description || "",
    line_type: l.line_type,
    sqft: num(l.sqft) || null,
    length_in: num(l.len_ft) * 12 + num(l.len_in) || null,
    width_in: num(l.wid_ft) * 12 + num(l.wid_in) || null,
    measure_unit: l.measure_unit,
    material_rate: num(l.material_rate) || null,
    labor_rate: num(l.labor_rate) || null,
    installed_rate: num(l.installed_rate) || null,
    flat_amount: num(l.flat_amount) || null,
    waste_pct: num(l.waste_pct) || null,
    product_id: l.product_id || null,
    manufacturer: l.manufacturer || null,
    style: l.style || null,
    color: l.color || null,
    item_no: l.item_no || null,
    material_cost: num(l.material_cost) || null,
    labor_cost: num(l.labor_cost) || null,
    quantity: num(l.quantity) || null,
    unit: l.unit || null,
    category: (l.category || null) as EstimateLineItem["category"],
    from_stock: l.from_stock,
    is_fill: l.is_fill,
    is_optional: l.is_optional,
  });
  const previewEstimate: Estimate = {
    ...estimate,
    presentation,
    tax_rate: num(taxRate),
    discount_kind: discountKind,
    discount_value: num(discountValue),
    job_description: jobDescription || null,
    notes: notes || null,
    recommended_option_id:
      options.find((o) => o.key === recommendedKey) ? "REC" : null,
    options: options.map((o) => ({
      id: o.key === recommendedKey ? "REC" : o.key,
      estimate_id: estimate.id,
      name: o.name,
      position: 0,
      notes: null,
      created_at: estimate.created_at,
      line_items: o.lines.map(toEstimateLine),
    })),
  };

  return (
    <>
    {/* Autocomplete sources for the Color / Manufacturer fields — colors and
        brands you've already used (carpet colors rarely live in the catalog). */}
    <datalist id="estimate-color-suggestions">
      {colorSuggestions.map((c) => (
        <option key={c} value={c} />
      ))}
    </datalist>
    <datalist id="estimate-manufacturer-suggestions">
      {manufacturerSuggestions.map((m) => (
        <option key={m} value={m} />
      ))}
    </datalist>
    <div className="mx-auto max-w-5xl pb-44 md:pb-24 print:hidden">
      <Link
        href={`/customers/${estimate.customer_id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to {customerName}
      </Link>

      {/* Owner ⇄ customer preview toggle */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="inline-flex rounded-md border p-0.5 text-sm">
          <button
            type="button"
            onClick={() => setPreviewCustomer(false)}
            className={cn("rounded px-3 py-1.5 font-medium", !previewCustomer ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
          >
            Build
          </button>
          <button
            type="button"
            onClick={() => setPreviewCustomer(true)}
            className={cn("rounded px-3 py-1.5 font-medium", previewCustomer ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
          >
            <Eye className="mr-1 inline size-3.5" /> Preview as customer
          </button>
        </div>
      </div>

      {/* CUSTOMER PREVIEW — exactly what they'll see (scope in words + lump sum). */}
      {previewCustomer ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This is the customer&apos;s view — full scope in words, one price per
            option, no quantities or costs.
          </p>
          {jobDescription ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{jobDescription}</p>
          ) : null}
          <EstimateOptionCards estimate={previewEstimate} />
        </div>
      ) : null}

      {/* Owner build surface */}
      <div className={cn(previewCustomer && "hidden")}>
      {/* Progress spine — jump between sections */}
      <div className="sticky top-0 z-20 -mx-1 mb-4 flex flex-wrap gap-1 border-b bg-background/95 px-1 py-2 backdrop-blur">
        {[
          ["sec-setup", "Setup"],
          ["sec-rooms", "Rooms"],
          ["sec-materials", "Materials"],
          ["sec-labor", "Labor"],
          ["sec-review", "Review"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {label}
          </button>
        ))}
      </div>

      {/* Estimate header */}
      <Card className="mb-6 scroll-mt-16" id="sec-setup">
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

      {/* AI pre-fill — describe the job in plain English; lines drop into the
          active option for you to review & adjust (nothing saved yet). */}
      <details className="mb-4 rounded-lg border bg-card [&_summary]:list-none">
        <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium">
          <Sparkles className="size-4 text-primary" /> Pre-fill from a description
          <span className="font-normal text-muted-foreground">— optional</span>
        </summary>
        <div className="space-y-2 border-t p-3">
          <textarea
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            rows={3}
            placeholder="e.g. 12x15 living room and 10x12 bedroom in Mohawk carpet, hall in LVP, tear out old carpet, self-level the kitchen ~200 sq ft…"
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Generates rooms, materials &amp; labor into <span className="font-medium">{options[safeActive]?.name || "this option"}</span> — matched to your catalog. Review after.
            </p>
            <Button type="button" size="sm" onClick={prefillFromText} disabled={aiPrefillBusy || !aiText.trim()}>
              <Sparkles className="size-3.5" /> {aiPrefillBusy ? "Building…" : "Generate lines"}
            </Button>
          </div>
        </div>
      </details>

      {/* Option tabs — build one option at a time (good / better / best) */}
      {options.length > 1 || recommendedKey ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {options.map((o, i) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setActiveOption(i)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-medium",
                i === safeActive
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-muted",
              )}
            >
              {o.key === recommendedKey ? <Star className="size-3 fill-current" /> : null}
              {o.name || `Option ${i + 1}`}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { addOption(); setActiveOption(options.length); }}
            className="inline-flex items-center gap-1 rounded-full border border-dashed px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            <Plus className="size-3.5" /> Add option
          </button>
        </div>
      ) : null}

      {/* Options */}
      <div className="space-y-6">
        {options.map((option, oi) => {
          if (oi !== safeActive) return null;
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
          const totals = optionTotalsWithDiscount(
            calcLines,
            taxRate,
            discountKind,
            discountValue,
          );
          // Revenue after the discount (pre-tax) drives the true profit + margin.
          const netRevenue = totals.subtotal - totals.discount;
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
          const optionProfit = netRevenue - optionCost;
          const optionMargin =
            netRevenue > 0 ? (optionProfit / netRevenue) * 100 : 0;

          const isRecommended = option.key === recommendedKey;
          const hasOptional = option.lines.some((l) => l.is_optional);
          return (
            <Card key={option.key} className={cn(isRecommended && "ring-1 ring-primary")}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <div className="flex items-center gap-1.5">
                  <Input
                    value={option.name}
                    onChange={(e) => updateOption(oi, { name: e.target.value })}
                    className="max-w-xs font-semibold"
                  />
                  {isRecommended ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      <Star className="size-3 fill-primary" /> Recommended
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {options.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleRecommended(option.key)}
                      title="Highlight this option to the customer as your recommendation"
                    >
                      <Star className={cn("size-3.5", isRecommended && "fill-primary text-primary")} />
                      {isRecommended ? "Recommended" : "Recommend"}
                    </Button>
                  ) : null}
                  {hasOptional ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => optionWithoutOptionals(oi)}
                      title="Create a sibling option without the lines marked optional"
                    >
                      <Layers className="size-3.5" /> Version without add-ons
                    </Button>
                  ) : null}
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
                {/* ROOMS & AREAS — measure once; drop flooring in (area auto-fills) */}
                <div className="space-y-2 scroll-mt-16" id="sec-rooms">
                  <div className="flex items-center justify-between border-b pb-1.5">
                    <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                      Rooms &amp; areas
                    </h3>
                    <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                      {Math.round(rooms.reduce((s, r) => s + num(r.sqft), 0))} sq ft
                    </span>
                  </div>
                  {rooms.length === 0 ? (
                    <p className="px-1 text-xs text-muted-foreground">
                      Add rooms and their square footage — then drop a flooring
                      material into each; its area fills in automatically.
                    </p>
                  ) : null}
                  {rooms.map((room, ri) => (
                    <div key={room.key} className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5">
                      <Input
                        value={room.name}
                        onChange={(e) => updateRoom(ri, { name: e.target.value })}
                        placeholder="Room (e.g. Living Room)"
                        className="h-9 min-w-40 flex-1"
                      />
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          inputMode="decimal"
                          value={room.sqft}
                          onChange={(e) => updateRoom(ri, { sqft: e.target.value })}
                          placeholder="sq ft"
                          className={cn(inputSm, "w-20")}
                        />
                        <AreaCalculator
                          triggerLabel="Calc"
                          triggerVariant="ghost"
                          triggerClassName="h-9 px-2 text-xs"
                          title={`Square footage${room.name ? ` — ${room.name}` : ""}`}
                          initialLabel={room.name}
                          onApply={(area) => updateRoom(ri, { sqft: String(area) })}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9"
                        onClick={() => addFlooringForRoom(oi, room)}
                        title="Add a flooring material for this room (area pre-filled)"
                      >
                        <Plus className="size-3.5" /> Flooring
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9"
                        onClick={() => addPrepForRoom(oi, room)}
                        title="Add a prep line for this room (moisture, skim coat…) — flows to the work order under this room"
                      >
                        <Plus className="size-3.5" /> Prep
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove room"
                        onClick={() => removeRoom(ri)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={addRoom}>
                    <Plus className="size-3.5" /> Add room
                  </Button>
                </div>

                {(["mat", "labor"] as const).map((section) => {
                  const secLines = option.lines
                    .map((line, li) => ({ line, li }))
                    .filter(({ line }) => (section === "labor") === isLaborLine(line));
                  const secSub = secLines.reduce((s, { line }) => s + lineTotal(toCalc(line)), 0);
                  return (
                    <div
                      key={section}
                      className="space-y-2 scroll-mt-16"
                      id={section === "labor" ? "sec-labor" : "sec-materials"}
                    >
                      <div className="flex items-center justify-between border-b pb-1.5">
                        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                          {section === "labor" ? "Labor" : "Materials"}
                        </h3>
                        <span className="text-sm font-semibold tabular-nums">{formatMoney(secSub)}</span>
                      </div>
                      {/* Search-first add — find any product (or add on the fly) and
                          it drops in as a type-aware line. Materials only. */}
                      {section !== "labor" ? (
                        <div className="rounded-lg border bg-muted/20 p-2">
                          <ProductPicker
                            value=""
                            label="Add a material — search catalog (name, color, mfr, SKU) or add new"
                            fullWidth
                            onPick={(p) => addMaterialFromPick(oi, p)}
                            onCreated={(p) => addMaterialFromPick(oi, p)}
                            onUseOnce={(input) => addMaterialUseOnce(oi, input)}
                          />
                        </div>
                      ) : null}
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
                            {line.is_fill ? (
                              <span className="rounded-full bg-blue-100 px-1.5 py-0.5 font-medium text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                                Fill piece
                              </span>
                            ) : null}
                            {line.is_optional ? (
                              <span className="rounded-full bg-violet-100 px-1.5 py-0.5 font-medium text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
                                Optional
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

                    {/* Manufacturer + Color visible for material lines (color
                        matters for carpet). Manufacturer auto-fills from the
                        catalog on pick and carries to new cuts. */}
                    {!isLaborLine(line) && !isSubfloor(line) ? (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">
                            Manufacturer
                          </label>
                          <Input
                            value={line.manufacturer}
                            onChange={(e) =>
                              updateLine(oi, li, { manufacturer: e.target.value })
                            }
                            placeholder="e.g. Shaw"
                            list="estimate-manufacturer-suggestions"
                            className="h-9"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">
                            Color
                          </label>
                          <Input
                            value={line.color}
                            onChange={(e) => updateLine(oi, li, { color: e.target.value })}
                            placeholder={line.category === "carpet" ? "e.g. Seagull" : "Color / finish"}
                            list="estimate-color-suggestions"
                            className="h-9"
                          />
                        </div>
                      </div>
                    ) : null}

                    {!isSubfloor(line) ? (
                      <details className="mt-2 rounded-md border bg-card [&_summary]:list-none">
                        <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
                          More catalog details (style, item #)
                        </summary>
                        <div className="grid grid-cols-2 gap-2 border-t p-2.5">
                          <Input
                            value={line.style}
                            onChange={(e) => updateLine(oi, li, { style: e.target.value })}
                            placeholder="Style"
                            className="h-9"
                          />
                          <Input
                            value={line.item_no}
                            onChange={(e) => updateLine(oi, li, { item_no: e.target.value })}
                            placeholder="Item #"
                            className="h-9"
                          />
                        </div>
                      </details>
                    ) : null}

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
                          /* Material & labor are separate lines — a material line
                             reads "Material" (not "Material + Labor"); a labor line
                             reads "Labor". `mat_labor` stays the underlying value. */
                          options={
                            isLaborLine(line)
                              ? [
                                  { value: "mat_labor", label: "Labor" },
                                  { value: "flat", label: "Flat amount" },
                                ]
                              : [
                                  { value: "mat_labor", label: "Material" },
                                  { value: "installed", label: "Installed / sq ft" },
                                  { value: "flat", label: "Flat amount" },
                                ]
                          }
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

                      {/* Optional add-on — an item that may or may not be needed.
                          Marks it in this view; use "Version without add-ons" on the
                          option header to spin off a without-it option in one tap. */}
                      {line.line_type !== "flat" ? (
                        <label className="flex cursor-pointer items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={line.is_optional}
                            onChange={(e) => updateLine(oi, li, { is_optional: e.target.checked })}
                            className="size-4 rounded border-input"
                          />
                          <span>
                            <span className="font-medium">Optional add-on</span> — may or
                            may not be necessary
                          </span>
                        </label>
                      ) : null}

                      {/* Order as roll — PO shows one roll; work order keeps the cuts.
                          Roll goods only (carpet / sheet vinyl); hard surface has no cuts. */}
                      {line.line_type !== "flat" && line.category !== "labor" && !line.from_stock && isRollGoodCategory(line.category) ? (
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
                          {/* Fill piece — an extra cut off the same roll for this
                              area; flagged on every doc, its yardage still orders. */}
                          <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={line.is_fill}
                              onChange={(e) => updateLine(oi, li, { is_fill: e.target.checked })}
                              className="size-4 rounded border-input"
                            />
                            <span>This is a <span className="font-medium">fill / seam piece</span> for the area</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => addFillPiece(oi, li)}
                            className="mt-1 text-xs font-medium text-primary hover:underline"
                          >
                            + Add fill piece for this area
                          </button>
                        </div>
                      ) : null}

                      {/* Subfloor: priced by the sheet — # sheets replaces L×W. */}
                      {isSubfloor(line) ? (
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">
                            # Sheets
                          </label>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            inputMode="decimal"
                            value={line.quantity}
                            onChange={(e) =>
                              updateLine(oi, li, { quantity: e.target.value })
                            }
                            placeholder="sheets"
                            className={cn(inputSm, "w-20")}
                          />
                        </div>
                      ) : null}

                      {line.line_type !== "flat" && !isSubfloor(line) ? (
                        <>
                          {/* L×W cut dimensions — roll goods only (carpet / sheet
                              vinyl). Hard surface is measured in square feet. */}
                          {isRollGoodCategory(line.category) ? (
                          <>
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">
                              Length (ft / in)
                            </label>
                            <div className="flex gap-1">
                              <input
                                type="number"
                                step="any"
                                inputMode="decimal"
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
                                step="any"
                                inputMode="decimal"
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
                                step="any"
                                inputMode="decimal"
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
                                step="any"
                                inputMode="decimal"
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
                          </>
                          ) : null}
                          {/* AREA-billed inputs — carpet / hard surface / general
                              area lines. Hidden entirely for count items. */}
                          {!isCountLine(line) ? (
                            <>
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
                              {isRollGoodCategory(line.category) ? (
                                <div className="pb-2 text-xs text-muted-foreground">
                                  {(num(line.sqft) / 9).toFixed(1)} sq yd
                                </div>
                              ) : null}
                              {isHardSurfaceCategory(line.category) ? (
                                <div className="flex items-end gap-2">
                                  <LabeledNumber
                                    label="Sq ft / box"
                                    width="w-24"
                                    value={line.sqft_per_box}
                                    onChange={(v) => updateLine(oi, li, { sqft_per_box: v })}
                                  />
                                  {num(line.sqft_per_box) > 0 && num(line.sqft) > 0 ? (
                                    <div className="pb-2 text-xs font-medium text-muted-foreground">
                                      = {Math.ceil(num(line.sqft) / num(line.sqft_per_box))} cartons
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </>
                          ) : null}

                          {/* PREP BAG CALCULATOR — a bag/unit item with coverage:
                              enter area + thickness → bags = ceil(area ÷ coverage),
                              coverage scaling with thickness. Editable override. */}
                          {isCountLine(line) && hasCoverage(line.coverage_sqft) ? (
                            (() => {
                              const cov = num(line.coverage_sqft);
                              const covT = num(line.coverage_thickness_in); // 0 = flat
                              const scales = covT > 0;
                              const t = scales ? num(line.prep_thickness_in) || covT : 0;
                              const per = coverageAt(cov, scales ? covT : null, scales ? t : null);
                              const perR = Math.round(per * 10) / 10;
                              const u = unitLabel(line.unit) || "bag";
                              const calcBags = bagsNeeded(line.sqft, cov, scales ? covT : null, scales ? t : null);
                              const setArea = (v: string) => recalcPrep(oi, li, { sqft: v });
                              const setThick = (v: string) => recalcPrep(oi, li, { prep_thickness_in: v });
                              const hasLabor = option.lines.some(
                                (l) => l.category === "labor" && !!l.prep_key && l.prep_key === line.prep_key,
                              );
                              return (
                                <div className="w-full space-y-2 rounded-lg border bg-card p-3">
                                  <div className="text-xs font-semibold text-muted-foreground">
                                    Bag calculator — {cov} SF/{u}
                                    {scales ? ` @ ${thicknessLabel(covT)}` : " (flat coverage)"}
                                  </div>
                                  <div className="flex flex-wrap items-end gap-2">
                                    <LabeledNumber
                                      label="Area (sq ft)"
                                      value={line.sqft}
                                      onChange={setArea}
                                    />
                                    {scales ? (
                                      <div>
                                        <label className="mb-1 block text-xs text-muted-foreground">
                                          Pour thickness
                                        </label>
                                        <select
                                          value={String(t)}
                                          onChange={(e) => setThick(e.target.value)}
                                          className={cn(inputSm, "w-28")}
                                          aria-label="Pour thickness"
                                        >
                                          {THICKNESS_OPTIONS.map((o) => (
                                            <option key={o.value} value={o.value}>{o.label}</option>
                                          ))}
                                        </select>
                                      </div>
                                    ) : null}
                                    <div>
                                      <label className="mb-1 block text-xs text-muted-foreground">
                                        {u.charAt(0).toUpperCase() + u.slice(1)}s (override ok)
                                      </label>
                                      <input
                                        type="number"
                                        step="any"
                                        min="0"
                                        inputMode="decimal"
                                        value={line.quantity}
                                        onChange={(e) => recalcPrep(oi, li, { quantity: e.target.value })}
                                        placeholder={String(calcBags)}
                                        className={cn(inputSm, "w-24 font-semibold")}
                                      />
                                    </div>
                                  </div>
                                  {num(line.sqft) > 0 && per > 0 ? (
                                    <div className="text-xs text-muted-foreground">
                                      {Math.round(num(line.sqft))} sq ft
                                      {scales ? ` at ${thicknessLabel(t)}` : ""} ÷ {perR} SF/{u} ={" "}
                                      <span className="font-semibold text-foreground">{calcBags} {u}{calcBags === 1 ? "" : "s"}</span>
                                      {num(line.quantity) !== calcBags && num(line.quantity) > 0 ? (
                                        <span className="text-primary"> · using {num(line.quantity)} (override)</span>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  {!hasLabor ? (
                                    <button
                                      type="button"
                                      onClick={() => addSelfLevelingLabor(oi, li)}
                                      className="text-xs font-medium text-primary hover:underline"
                                    >
                                      + Add self-leveling labor (separate line, auto-filled)
                                    </button>
                                  ) : (
                                    <div className="text-[11px] text-muted-foreground">
                                      Labor line linked — its quantity follows this calculator.
                                    </div>
                                  )}
                                </div>
                              );
                            })()
                          ) : isCountLine(line) ? (
                            <div>
                              <label className="mb-1 block text-xs text-muted-foreground">
                                How many {unitLabel(line.unit) || "units"}?
                              </label>
                              <input
                                type="number"
                                step="any"
                                min="0"
                                inputMode="decimal"
                                value={line.quantity}
                                onChange={(e) => updateLine(oi, li, { quantity: e.target.value })}
                                placeholder={unitLabel(line.unit) || "qty"}
                                className={cn(inputSm, "w-28")}
                              />
                            </div>
                          ) : null}

                          {/* Pricing basis. Roll goods / hard surface stay locked
                              to area (carpet needs sq yd); everything else gets the
                              full unit picker so bag / each / lnft is one tap. */}
                          {isRollGoodCategory(line.category) || isHardSurfaceCategory(line.category) ? (
                            <div>
                              <label className="mb-1 block text-xs text-muted-foreground">
                                Price per
                              </label>
                              <SegmentedField
                                size="sm"
                                value={line.measure_unit}
                                onChange={(v) => updateLine(oi, li, { measure_unit: v as MeasureUnit })}
                                options={[
                                  { value: "sqft", label: "sq ft" },
                                  { value: "sqyd", label: "sq yd" },
                                ]}
                              />
                            </div>
                          ) : (
                            <div>
                              <label className="mb-1 block text-xs text-muted-foreground">
                                Priced by
                              </label>
                              <select
                                value={isCountLine(line) ? normalizeUnit(line.unit) : line.measure_unit}
                                onChange={(e) => setLineUnit(oi, li, e.target.value)}
                                className={cn(inputSm, "w-32")}
                                aria-label="Pricing unit"
                              >
                                <optgroup label="By area">
                                  {UNIT_OPTIONS.filter((u) => u.kind === "area").map((u) => (
                                    <option key={u.value} value={u.value}>{u.label}</option>
                                  ))}
                                </optgroup>
                                <optgroup label="By the item">
                                  {UNIT_OPTIONS.filter((u) => u.kind === "count").map((u) => (
                                    <option key={u.value} value={u.value}>{u.label}</option>
                                  ))}
                                </optgroup>
                              </select>
                            </div>
                          )}

                          {/* Manual qty override + waste — area lines only. */}
                          {!isCountLine(line) ? (
                            <>
                              <LabeledNumber
                                label={`Qty${line.unit ? ` (${line.unit})` : ""}`}
                                value={line.quantity}
                                width="w-20"
                                onChange={(v) => updateLine(oi, li, { quantity: v })}
                              />
                              <LabeledNumber
                                label="Waste %"
                                value={line.waste_pct}
                                width="w-20"
                                onChange={(v) => updateLine(oi, li, { waste_pct: v })}
                              />
                            </>
                          ) : null}
                        </>
                      ) : null}

                      {line.line_type !== "flat" ? (
                        <ProductPicker
                          value={line.product_id}
                          initialLabel={line.description}
                          onPick={(p) => pickProduct(oi, li, p)}
                          onCreated={(p) => handleProductCreated(oi, li, p)}
                          onUseOnce={(input) => useOnceProduct(oi, li, input)}
                        />
                      ) : null}

                      {/* Mispricing guard: this line is priced by area, but its
                          catalog product is really sold by the each/bag. One tap
                          switches it to the right unit (never auto-changes). */}
                      {(() => {
                        const realUnit = line.product_id ? productUnits[line.product_id] : "";
                        const mismatch =
                          !!realUnit && !isAreaUnit(realUnit) && !isCountLine(line);
                        if (!mismatch) return null;
                        return (
                          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-400 bg-amber-50 px-2.5 py-2 text-xs dark:border-amber-500/40 dark:bg-amber-950/30">
                            <span className="text-amber-800 dark:text-amber-300">
                              ⚠ This item is sold by the{" "}
                              <span className="font-semibold">{unitLabel(realUnit)}</span> — it&apos;s
                              currently priced by area.
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7"
                              onClick={() => setLineUnit(oi, li, normalizeUnit(realUnit))}
                            >
                              Fix — price per {unitLabel(realUnit)}
                            </Button>
                          </div>
                        );
                      })()}

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
                              {/* Material lines are material-only. A saved line
                                  that still bundles labor gets a one-tap split so
                                  material & labor become separate line items. */}
                              {!labor && num(line.labor_cost) > 0 ? (
                                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs">
                                  <span className="text-muted-foreground">
                                    Bundles {formatMoney(num(line.labor_rate))}/{unitLbl} labor —
                                    keep material &amp; labor separate.
                                  </span>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7"
                                    onClick={() => splitLaborToLine(oi, li)}
                                  >
                                    Split into a labor line
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })()
                      ) : null}

                      {line.line_type === "installed" ? (
                        <LabeledNumber
                          label={
                            isSubfloor(line)
                              ? "$ / sheet (installed)"
                              : `Installed /${line.measure_unit === "sqyd" ? "sq yd" : "sqft"}`
                          }
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
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => addLine(oi, section === "labor")}
                        >
                          <Plus className="size-3.5" /> Add {section === "labor" ? "labor" : "material"}
                        </Button>
                        {section !== "labor" ? (
                          <details className="relative [&_summary]:list-none">
                            <summary className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1.5 text-sm font-medium hover:bg-muted">
                              <Plus className="size-3.5" /> Add subfloor
                            </summary>
                            <div className="absolute z-20 mt-1 w-56 rounded-md border bg-popover p-1 shadow-md">
                              <div className="px-2 py-1 text-xs text-muted-foreground">
                                Plywood, priced by the sheet
                              </div>
                              {SUBFLOOR_OPTIONS.map((opt) => (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={(e) => {
                                    addSubfloor(oi, opt);
                                    (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
                                  }}
                                  className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          </details>
                        ) : null}
                        {section !== "labor" && addonCatalog.length ? (
                          <details className="relative [&_summary]:list-none">
                            <summary className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1.5 text-sm font-medium hover:bg-muted">
                              <Plus className="size-3.5" /> Add-on
                            </summary>
                            <div className="absolute z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                              <div className="px-2 py-1 text-xs text-muted-foreground">
                                Priced from Settings → Default pricing
                              </div>
                              {addonCatalog.map((a) => (
                                <button
                                  key={a.label}
                                  type="button"
                                  onClick={(e) => {
                                    addAddon(oi, a);
                                    (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
                                  }}
                                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                                >
                                  <span className="min-w-0 truncate">
                                    {a.label}
                                    {a.custom ? (
                                      <span className="ml-1 text-[10px] text-violet-600 dark:text-violet-400">custom</span>
                                    ) : null}
                                  </span>
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    {a.sell != null ? `${formatMoney(a.sell)}/${a.unit}` : a.labor ? "labor" : ""}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                {/* Option totals */}
                <div className="ml-auto w-full max-w-xs space-y-1 border-t pt-3 text-sm scroll-mt-16" id="sec-review">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Retail (subtotal)</span>
                    <span>{formatMoney(totals.subtotal)}</span>
                  </div>
                  {/* Whole-job discount — owner only; the customer just sees the
                      discounted total. Editing here applies to the estimate. */}
                  {oi === 0 ? (
                    <div className="flex items-center justify-between gap-2 py-0.5">
                      <span className="text-muted-foreground">Discount</span>
                      <div className="flex items-center gap-1">
                        <div className="inline-flex overflow-hidden rounded-md border text-xs">
                          <button
                            type="button"
                            onClick={() => setDiscountKind("amount")}
                            className={cn("px-1.5 py-1", discountKind === "amount" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                          >
                            $
                          </button>
                          <button
                            type="button"
                            onClick={() => setDiscountKind("percent")}
                            className={cn("px-1.5 py-1", discountKind === "percent" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                          >
                            %
                          </button>
                        </div>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          inputMode="decimal"
                          value={discountValue}
                          onChange={(e) => setDiscountValue(e.target.value)}
                          placeholder="0"
                          className={cn(inputSm, "w-16 text-right")}
                          aria-label="Discount value"
                        />
                      </div>
                    </div>
                  ) : null}
                  {totals.discount > 0 ? (
                    <div className="flex justify-between text-emerald-600">
                      <span>
                        Discount{discountKind === "percent" ? ` (${num(discountValue)}%)` : ""}
                      </span>
                      <span>−{formatMoney(totals.discount)}</span>
                    </div>
                  ) : null}
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

      </div>
      {/* /Owner build surface */}

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
        discountKind={discountKind}
        discountValue={discountValue}
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
  discountKind,
  discountValue,
  options,
}: {
  org: OrgSettings;
  customer: Customer | null;
  title: string;
  presentation: EstimatePresentation;
  jobDescription: string;
  notes: string;
  taxRate: string;
  discountKind: "amount" | "percent";
  discountValue: string;
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
        const totals = optionTotalsWithDiscount(
          o.lines.map(calc),
          taxRate,
          discountKind,
          discountValue,
        );
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
                  {totals.discount > 0 ? (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Discount</span>
                      <span>−{formatMoney(totals.discount)}</span>
                    </div>
                  ) : null}
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
