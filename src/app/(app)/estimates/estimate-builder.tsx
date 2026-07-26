"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Copy, Trash2, ArrowLeft, Save, Eye, Send, Sparkles, Printer, ChevronRight, Star, Layers } from "lucide-react";
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
import { parseCutsFromText } from "@/lib/job-scope";
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
  DEFAULT_LABOR_PER_BAG,
} from "@/lib/floor-prep";
import { saveEstimate, saveEstimateBuilderDraft, clearEstimateBuilderDraft, sendEstimateById } from "./actions";
import { saveProductRate, createProductInline } from "../catalog/actions";
import { writeScopeDescription } from "./ai-actions";
import { ProductPicker, type CustomProductInput } from "./product-picker";
import type { AddonCatalogItem } from "@/lib/data/addon-defaults";
import { SegmentedField } from "@/components/ui/segmented-field";
import { AreaCalculator } from "@/components/area-calculator";

interface LineState {
  key: string;
  room: string;
  description: string;
  note: string; // plain-language "what we're doing" note — customer scope + WO
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
  save_default: boolean; // "use always" — write this cost back to the catalog default on save (UI-only, never persisted on the line)
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
  // Keep fractional inches (e.g. 6.5") instead of rounding to a whole inch, so
  // re-opening a saved line doesn't silently change its measurement.
  return String(Math.round((total % 12) * 100) / 100);
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
    unit: l.unit, // count units price by quantity, not area
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
    unit: l.unit, // count units price by quantity, not area
  });
  const waste = 1 + (num(l.waste_pct) || 0) / 100;
  // A labor line has no material cost, even if a stray rate is on it.
  return {
    mat: l.category === "labor" ? 0 : qty * num(l.material_cost) * waste,
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
  productDefaults = {},
  builderDraft = null,
}: {
  estimate: Estimate;
  customerName: string;
  customer?: Customer | null;
  org?: OrgSettings;
  autoPrint?: boolean;
  /** Unsaved in-progress edits (auto-saved as you type), restored on return. */
  builderDraft?: unknown;
  /** Colors already used (estimates + catalog) — autocomplete the Color field. */
  colorSuggestions?: string[];
  /** Manufacturers already used — autocomplete the Manufacturer field. */
  manufacturerSuggestions?: string[];
  /** The single add-on catalog (built-in + custom), pre-priced from defaults. */
  addonCatalog?: AddonCatalogItem[];
  /** Catalog unit of each linked product id — flags area-priced lines whose
   *  product is really sold by the each/bag (the sq-ft-on-a-pail bug). */
  productUnits?: Record<string, string>;
  /** Saved catalog default rate + unit per linked product id — powers the
   *  "standard vs one-off" badge and the "use always" write-back. */
  productDefaults?: Record<string, { material_rate: number; labor_rate: number; unit: string }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const keyCounter = useRef(0);
  const newKey = () => `k${keyCounter.current++}`;

  // In-progress edits auto-saved as you type (survives navigate-away / logout).
  // We restore CONTENT here and regenerate every option/line key on the way in,
  // so resumed rows never collide with fresh keys (the input-glitch we fixed).
  const draft = (builderDraft ?? null) as {
    title?: string;
    taxRate?: string;
    presentation?: EstimatePresentation;
    jobDescription?: string;
    notes?: string;
    overallMargin?: string;
    discountKind?: "amount" | "percent";
    discountValue?: string;
    activeOption?: number;
    options?: OptionState[];
  } | null;

  const emptyLine = (): LineState => ({
    key: newKey(),
    room: "",
    description: "",
    note: "",
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
    save_default: false,
  });

  const [title, setTitle] = useState(draft?.title ?? estimate.title ?? "");
  const [taxRate, setTaxRate] = useState(draft?.taxRate ?? String(estimate.tax_rate ?? 0));
  const [presentation, setPresentation] = useState<EstimatePresentation>(
    draft?.presentation ?? estimate.presentation ?? "detailed",
  );
  const [jobDescription, setJobDescription] = useState(
    draft?.jobDescription ?? estimate.job_description ?? "",
  );
  const [notes, setNotes] = useState(draft?.notes ?? estimate.notes ?? "");
  // Estimate-wide gross margin. Lines without their own override follow this.
  const [overallMargin, setOverallMargin] = useState(
    draft?.overallMargin ?? (estimate.target_margin != null ? String(estimate.target_margin) : "40"),
  );
  // Whole-job discount (owner-applied). Shows in the owner totals; the customer
  // only ever sees the discounted lump sum.
  const [discountKind, setDiscountKind] = useState<"amount" | "percent">(
    draft?.discountKind ?? (estimate.discount_kind === "percent" ? "percent" : "amount"),
  );
  const [discountValue, setDiscountValue] = useState(
    draft?.discountValue ?? (estimate.discount_value ? String(estimate.discount_value) : ""),
  );

  const [options, setOptions] = useState<OptionState[]>(() => {
    // Resume unsaved edits (fresh keys so nothing collides), else load the saved estimate.
    if (draft?.options?.length) {
      return draft.options.map((o) => ({
        ...o,
        key: newKey(),
        lines: (o.lines ?? []).map((l) => ({ ...l, key: newKey() })),
      }));
    }
    const initial = (estimate.options ?? []).map((o) => ({
      key: newKey(),
      name: o.name,
      notes: o.notes ?? "",
      lines: (o.line_items ?? []).map((l) => {
        // Legacy carpet lines kept the cut size only in the description text
        // ("… — cuts: 25'6\"×15'") with null length_in/width_in. Parse it so the
        // builder shows the cut, and clean the description — a save then writes
        // the cut back as structured data (and drops the leaked size text).
        const legacyCut =
          l.length_in == null && l.width_in == null && isRollGoodCategory(l.category)
            ? parseCutsFromText(l.description, l.roll_width_ft)[0]
            : null;
        const lenIn = l.length_in ?? legacyCut?.lengthIn ?? null;
        const widIn = l.width_in ?? legacyCut?.widthIn ?? null;
        const desc = legacyCut
          ? (l.description ?? "").replace(/\s*[—–-]?\s*cuts?:.*$/i, "").trim()
          : l.description ?? "";
        return {
        key: newKey(),
        room: l.room ?? "",
        description: desc,
        note: l.note ?? "",
        line_type: l.line_type,
        sqft: l.sqft?.toString() ?? "",
        len_ft: inToFt(lenIn),
        len_in: inToIn(lenIn),
        wid_ft: inToFt(widIn),
        wid_in: inToIn(widIn),
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
        save_default: false,
        };
      }),
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

  // --- New-builder UI state -------------------------------------------------
  // One option shown at a time (tabs), and an owner ⇄ customer preview flip.
  const [activeOption, setActiveOption] = useState(draft?.activeOption ?? 0);

  // --- Auto-save (debounced) ------------------------------------------------
  // Reads the current builder state and persists it ~1s after you stop typing.
  // Fire-and-forget: it NEVER writes back into the fields you're editing, so it
  // can't cause the input glitch. A subtle indicator shows it's safe.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(draft ? "saved" : "idle");
  const firstAuto = useRef(true);
  useEffect(() => {
    if (firstAuto.current) {
      firstAuto.current = false;
      return;
    }
    setSaveState("saving");
    const t = setTimeout(() => {
      void saveEstimateBuilderDraft(estimate.id, {
        title,
        taxRate,
        presentation,
        jobDescription,
        notes,
        overallMargin,
        discountKind,
        discountValue,
        activeOption,
        options,
      }).then(() => setSaveState("saved"));
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, taxRate, presentation, jobDescription, notes, overallMargin, discountKind, discountValue, options, activeOption]);
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

  // R&R (remove & replace) for trim — baseboard / quarter round / shoe molding:
  // wrap the material line with a REMOVAL labor line before it and an INSTALL
  // labor line after it (removal labor + new material + install labor), each its
  // own separate line at the item's unit/qty, rate filled in by the user.
  const addRR = (oi: number, li: number) => {
    const removeK = newKey();
    const installK = newKey();
    setOptions((prev) =>
      prev.map((o, i) => {
        if (i !== oi) return o;
        const src = o.lines[li];
        const laborLine = (key: string, desc: string): LineState => ({
          ...emptyLine(),
          key,
          category: "labor",
          room: src.room,
          description: desc,
          unit: src.unit,
          measure_unit: src.measure_unit,
          quantity: src.quantity,
          sqft: src.sqft,
          margin_pct: src.margin_pct,
        });
        const lines = [...o.lines];
        lines.splice(li, 0, laborLine(removeK, src.description ? `Remove existing ${src.description}` : "Remove existing"));
        // material shifted to li+1; install goes after it.
        lines.splice(li + 2, 0, laborLine(installK, src.description ? `Install ${src.description}` : "Install new"));
        return { ...o, lines };
      }),
    );
    setOpenLines((s) => new Set([...s, removeK, installK]));
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
  // shared prep_key. It bills PER BAG by default (labor follows the bag count, not
  // the square footage) — flip the labor line's unit to sq ft to bill by area.
  const addSelfLevelingLabor = (oi: number, li: number) => {
    const laborKey = newKey();
    const prepKey = `pk${keyCounter.current++}`;
    setOptions((prev) =>
      prev.map((o, i) => {
        if (i !== oi) return o;
        const src = o.lines[li];
        // Bag count from the prep material's coverage/thickness (same calc the
        // material line uses), so labor = bags × $/bag.
        const covT = num(src.coverage_thickness_in);
        const scales = covT > 0;
        const t = scales ? num(src.prep_thickness_in) || covT : 0;
        const bags = bagsNeeded(src.sqft, num(src.coverage_sqft), scales ? covT : null, scales ? t : null);
        const laborLine: LineState = {
          ...emptyLine(),
          key: laborKey,
          category: "labor",
          line_type: "mat_labor",
          // Inherit the prep material's room so per-room prep flows to the work
          // order under the same room (no separate room entry needed).
          room: src.room,
          description: src.description ? `${src.description} — labor` : "Self-leveling labor",
          unit: "bag",
          measure_unit: "sqft",
          quantity: bags ? String(bags) : "",
          labor_cost: String(DEFAULT_LABOR_PER_BAG),
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
        note: l.note,
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

  // --- Saved-default write-back ("use once" vs "use always") ----------------
  const catalogFactor = (measure: MeasureUnit, productUnit: string): number => {
    if (!isAreaUnit(productUnit)) return 1; // count units price 1:1
    const catUnit = normalizeUnit(productUnit);
    return measure === catUnit ? 1 : measure === "sqyd" ? 9 : 1 / 9;
  };
  // The catalog default cost expressed in THIS line's billing unit — or null
  // when the line has no linked product/default. Drives the standard-vs-one-off
  // badge (compared against the current cost).
  const defaultCostFor = (l: LineState, labor: boolean): number | null => {
    const d = l.product_id ? productDefaults[l.product_id] : undefined;
    if (!d) return null;
    const rate = labor ? d.labor_rate : d.material_rate;
    return Math.round(rate * catalogFactor(l.measure_unit, d.unit) * 100) / 100;
  };
  // On save, push every "Save as my default" line's cost back to its product's
  // saved rate (one write per product). "Use once" lines never reach here.
  const flushDefaultRates = async () => {
    const seen = new Set<string>();
    for (const o of options)
      for (const l of o.lines) {
        if (!l.save_default || !l.product_id || seen.has(l.product_id)) continue;
        seen.add(l.product_id);
        await saveProductRate({
          productId: l.product_id,
          materialCost: num(l.material_cost),
          laborCost: num(l.labor_cost),
          measureUnit: l.measure_unit,
        });
      }
  };
  // "Save to catalog" for a one-off line (no linked product) → create a reusable
  // product from it and link the line, so it now has a saved default.
  const saveLineToCatalog = (oi: number, li: number) => {
    const l = options[oi]?.lines[li];
    if (!l) return;
    startTransition(async () => {
      const res = await createProductInline({
        name: l.description || "New product",
        category: l.category || "other",
        unit: isCountLine(l) ? l.unit || "each" : l.measure_unit,
        material_rate: num(l.material_cost),
        labor_rate: num(l.labor_cost),
        manufacturer: l.manufacturer || undefined,
        style: l.style || undefined,
        color: l.color || undefined,
        sku: l.item_no || undefined,
        coverage_sqft: l.coverage_sqft || null,
        coverage_thickness_in: l.coverage_thickness_in || null,
      });
      if (res.error || !res.product) {
        toast.error(res.error ?? "Couldn't save to catalog.");
        return;
      }
      updateLine(oi, li, { product_id: res.product.id });
      toast.success("Saved to your catalog — future estimates can reuse it.");
    });
  };

  const save = (thenView: boolean) =>
    startTransition(async () => {
      const res = await saveEstimate(estimate.id, buildInput());
      if (res.error) {
        toast.error(res.error);
        return;
      }
      await flushDefaultRates();
      // Committed for real — the in-progress draft is no longer needed.
      void clearEstimateBuilderDraft(estimate.id);
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
      await flushDefaultRates();
      void clearEstimateBuilderDraft(estimate.id);
      window.print();
    });

  // Finish the build and send it to the customer in one step: save, then mark
  // it sent + email the customer their portal link (advances the pipeline). If
  // there's no email on file, don't silently mark it sent — save and open the
  // estimate so an email can be added first.
  const saveAndSend = () =>
    startTransition(async () => {
      const res = await saveEstimate(estimate.id, buildInput());
      if (res.error) {
        toast.error(res.error);
        return;
      }
      await flushDefaultRates();
      void clearEstimateBuilderDraft(estimate.id);
      if (!customer?.email) {
        toast.error("Add the customer's email to send. Saved — opening the estimate.");
        router.push(`/estimates/${estimate.id}`);
        return;
      }
      await sendEstimateById(estimate.id);
      toast.success(`Estimate sent to ${customer.full_name || "the customer"}`);
      router.push(`/estimates/${estimate.id}`);
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
    // A labor line charges labor only — carry the category so the shared calc
    // ignores any stray material rate on it.
    category: l.category,
    // MUST carry the unit: lineQty prices count units (bag/each/lnft…) by their
    // quantity and area units by area. Dropping it made bag lines fall back to
    // area (self-leveler ×800 sq ft instead of ×16 bags).
    unit: l.unit,
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
    note: l.note || null,
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
                step="any"
                min="0"
                max="99"
                inputMode="decimal"
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

      {/* One origin for materials/labor/accessories: the guided questionnaire.
          The builder ADJUSTS what it produced + one "＋ Add item" to add a
          forgotten line (removed the redundant AI paste-to-lines path). */}

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
            unit: l.unit,
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
                    unit: line.unit,
                  };
                  const sQty = lineQty(summ);
                  const sUnit = line.unit || (line.measure_unit === "sqyd" ? "sq yd" : "sq ft");
                  const sSell = lineTotal(summ);
                  const sCost = lineOurCost(line);
                  const sMargin = sSell > 0 ? ((sSell - sCost) / sSell) * 100 : 0;
                  const isOpen = openLines.has(line.key);
                  // Flooring (roll goods / hard surface) — color is part of its
                  // at-a-glance identity, so it stays an essential for these.
                  const isFlooring =
                    isRollGoodCategory(line.category) || isHardSurfaceCategory(line.category);
                  // Header name: the description, else the product's identity, else
                  // the category — so a real product line never reads "Untitled".
                  const displayName =
                    line.description.trim() ||
                    [line.manufacturer, line.style, line.color]
                      .map((s) => (s || "").trim())
                      .filter(Boolean)
                      .join(" ") ||
                    (line.category && line.category !== "labor"
                      ? line.category.charAt(0).toUpperCase() + line.category.slice(1)
                      : "");
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
                            {displayName || (
                              <span className="font-normal text-muted-foreground">New line — tap to pick a product</span>
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
                      <div className="space-y-4 border-t bg-muted/20 p-4">
                        {/* 1 · PRODUCT — the single per-line search. Shows the
                            picked product and lets you swap it; the section-top
                            box is the only place that ADDS a new line. */}
                        {line.line_type !== "flat" ? (
                          <ProductPicker
                            value={line.product_id}
                            initialLabel={line.description}
                            fullWidth
                            label={
                              line.product_id
                                ? "Product"
                                : "Product — search the catalog (name, color, mfr, SKU) or add new"
                            }
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

                        {/* 2 · IDENTITY — Color for flooring only (color IDs flooring
                            at a glance). The Room is INHERITED from the Room/Area the
                            material was added under — shown in the line header, and
                            editable (to move it) under More options. It is never
                            re-asked here. The product name isn't re-entered either;
                            the picker above shows what's selected. */}
                        {isFlooring ? (
                          <div className="max-w-xs">
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
                        ) : null}

                        {/* DESCRIPTION — your plain-language note for this line. Shows
                            on the customer estimate (words only) and the work order.
                            Separate from the product name; blank by default. */}
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">
                            Description <span className="font-normal">(what we&apos;re doing on this line — shows to the customer &amp; crew)</span>
                          </label>
                          <textarea
                            value={line.note}
                            onChange={(e) => updateLine(oi, li, { note: e.target.value })}
                            rows={2}
                            placeholder={
                              isLaborLine(line)
                                ? "e.g. Remove & haul away old carpet and pad"
                                : "e.g. Install throughout main floor & hallway"
                            }
                            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        </div>

                        {/* 3 · MEASUREMENT — matched to the material's unit type. */}
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
                              onChange={(e) => updateLine(oi, li, { quantity: e.target.value })}
                              placeholder="sheets"
                              className={cn(inputSm, "w-20")}
                            />
                          </div>
                        ) : null}

                        {line.line_type !== "flat" && !isSubfloor(line) ? (
                          <div className="flex flex-wrap items-end gap-3">
                            {/* Roll goods — cut dimensions (carpet / sheet vinyl).
                                Hard surface is measured in square feet. */}
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
                                      onChange={(e) => updateDim(oi, li, { len_ft: e.target.value })}
                                      placeholder="ft"
                                      className={cn(inputSm, "w-14")}
                                    />
                                    <input
                                      type="number"
                                      step="any"
                                      inputMode="decimal"
                                      min="0"
                                      value={line.len_in}
                                      onChange={(e) => updateDim(oi, li, { len_in: e.target.value })}
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
                                      onChange={(e) => updateDim(oi, li, { wid_ft: e.target.value })}
                                      placeholder="ft"
                                      className={cn(inputSm, "w-14")}
                                    />
                                    <input
                                      type="number"
                                      step="any"
                                      inputMode="decimal"
                                      min="0"
                                      value={line.wid_in}
                                      onChange={(e) => updateDim(oi, li, { wid_in: e.target.value })}
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
                          </div>
                        ) : null}

                        {/* 4 · PRICE — cost / margin / sell (or installed / flat). */}
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
                                {/* Save scope — one-off by default so tweaking a
                                    price never touches your saved rate; opt in to
                                    "Save as my default" to update the catalog. */}
                                {(() => {
                                  const def = defaultCostFor(line, labor);
                                  const cur = num(labor ? line.labor_cost : line.material_cost);
                                  const isStandard = def != null && Math.abs(cur - def) < 0.005;
                                  return (
                                    <div className="space-y-1.5 border-t pt-2">
                                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                        <span
                                          className={cn(
                                            "inline-flex items-center rounded-full px-2 py-0.5 font-medium",
                                            isStandard
                                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                                              : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
                                          )}
                                        >
                                          {isStandard ? "Standard rate" : def != null ? "Custom — this estimate" : "One-off — not in catalog"}
                                        </span>
                                        {line.product_id ? (
                                          <div className="inline-flex rounded-md border p-0.5 text-xs">
                                            <button
                                              type="button"
                                              onClick={() => updateLine(oi, li, { save_default: false })}
                                              className={cn("rounded px-2 py-1 font-medium", !line.save_default ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                                            >
                                              This estimate only
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => updateLine(oi, li, { save_default: true })}
                                              className={cn("rounded px-2 py-1 font-medium", line.save_default ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                                            >
                                              Save as my default
                                            </button>
                                          </div>
                                        ) : cur > 0 ? (
                                          <button
                                            type="button"
                                            onClick={() => saveLineToCatalog(oi, li)}
                                            className="font-medium text-primary hover:underline"
                                          >
                                            Save to catalog
                                          </button>
                                        ) : null}
                                      </div>
                                      {line.product_id && line.save_default ? (
                                        <p className="text-[11px] text-primary">
                                          Saving the estimate updates your catalog default to this {labor ? "labor " : ""}cost.
                                        </p>
                                      ) : null}
                                    </div>
                                  );
                                })()}
                                {/* Labor stays its OWN line. Any item can have labor
                                    added (baseboard, quarter round, transitions…);
                                    a line that still bundles labor gets a one-tap
                                    split. Both produce a separate labor line with
                                    its own rate + unit. */}
                                {!labor && !isSubfloor(line) ? (
                                  num(line.labor_cost) > 0 ? (
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
                                  ) : (
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2">
                                      <button
                                        type="button"
                                        onClick={() => splitLaborToLine(oi, li)}
                                        className="text-xs font-medium text-primary hover:underline"
                                      >
                                        + Add labor (separate line — its own rate &amp; unit)
                                      </button>
                                      {line.category === "trim" ? (
                                        <button
                                          type="button"
                                          onClick={() => addRR(oi, li)}
                                          className="text-xs font-medium text-primary hover:underline"
                                        >
                                          + R&amp;R (remove existing + install new)
                                        </button>
                                      ) : null}
                                    </div>
                                  )
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
                            onChange={(v) => updateLine(oi, li, { installed_rate: v })}
                          />
                        ) : null}

                        {line.line_type === "flat" ? (
                          <LabeledNumber
                            label="Flat amount"
                            prefix="$"
                            width="w-32"
                            value={line.flat_amount}
                            onChange={(v) => updateLine(oi, li, { flat_amount: v })}
                          />
                        ) : null}

                        {/* MORE OPTIONS — everything advanced/rarely-used, tucked
                            away: pricing mode, catalog details, source, optional,
                            order-as-roll, unit, waste. Every capability preserved. */}
                        <details className="rounded-md border bg-card [&_summary]:list-none">
                          <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
                            <Plus className="size-3.5" />
                            More options — pricing mode, catalog details, source, waste
                          </summary>
                          <div className="space-y-4 border-t p-3">
                            {/* Pricing mode — Material / Installed / Flat. */}
                            <div>
                              <label className="mb-1 block text-xs text-muted-foreground">
                                Pricing mode
                              </label>
                              <SegmentedField
                                size="sm"
                                value={line.line_type}
                                onChange={(v) => updateLine(oi, li, { line_type: v as LineType })}
                                /* Material & labor are separate lines — a material
                                   line reads "Material" (not "Material + Labor"); a
                                   labor line reads "Labor". `mat_labor` is the value. */
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

                            {/* Room / area — INHERITED from the Room/Area this
                                material was added under (also shown in the line
                                header). Editable only to MOVE the material to a
                                different room; never required, never re-asked. */}
                            <div className="max-w-xs">
                              <label className="mb-1 block text-xs text-muted-foreground">
                                Room / area
                              </label>
                              <Input
                                value={line.room}
                                onChange={(e) => updateLine(oi, li, { room: e.target.value })}
                                placeholder="e.g. Living Room"
                                className="h-9"
                              />
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                Inherited from the room you added this under — change only to move it.
                              </p>
                            </div>

                            {/* Custom line name — optional override of the line's
                                NAME (defaults to the product name). This is the
                                identity, NOT the Description note above. */}
                            <div>
                              <label className="mb-1 block text-xs text-muted-foreground">
                                Custom line name (optional)
                              </label>
                              <Input
                                value={line.description}
                                onChange={(e) => updateLine(oi, li, { description: e.target.value })}
                                placeholder={displayName || "Defaults to the product name"}
                                className="h-9"
                              />
                            </div>

                            {/* Catalog details. For a product picked from the
                                catalog these are FACTS, shown read-only ("From the
                                catalog") so the name/style never looks like a box to
                                re-fill. A manual/blank line keeps them editable so
                                you can set them once. */}
                            {!isLaborLine(line) && !isSubfloor(line) ? (
                              line.product_id ? (
                                (() => {
                                  const facts = [
                                    ["Manufacturer", line.manufacturer],
                                    ["Style", line.style],
                                    !isFlooring ? ["Color", line.color] : null,
                                    ["Item #", line.item_no],
                                  ].filter((f): f is [string, string] => !!f && !!f[1] && f[1].trim() !== "");
                                  if (facts.length === 0) return null;
                                  return (
                                    <div>
                                      <div className="mb-1 text-xs text-muted-foreground">From the catalog</div>
                                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border bg-muted/30 p-2.5 text-sm">
                                        {facts.map(([k, v]) => (
                                          <div key={k} className="flex min-w-0 justify-between gap-2">
                                            <dt className="text-muted-foreground">{k}</dt>
                                            <dd className="min-w-0 truncate font-medium">{v}</dd>
                                          </div>
                                        ))}
                                      </dl>
                                    </div>
                                  );
                                })()
                              ) : (
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="mb-1 block text-xs text-muted-foreground">Manufacturer</label>
                                    <Input
                                      value={line.manufacturer}
                                      onChange={(e) => updateLine(oi, li, { manufacturer: e.target.value })}
                                      placeholder="e.g. Shaw"
                                      list="estimate-manufacturer-suggestions"
                                      className="h-9"
                                    />
                                  </div>
                                  {!isFlooring ? (
                                    <div>
                                      <label className="mb-1 block text-xs text-muted-foreground">Color</label>
                                      <Input
                                        value={line.color}
                                        onChange={(e) => updateLine(oi, li, { color: e.target.value })}
                                        placeholder="Color / finish"
                                        list="estimate-color-suggestions"
                                        className="h-9"
                                      />
                                    </div>
                                  ) : null}
                                  <div>
                                    <label className="mb-1 block text-xs text-muted-foreground">Style</label>
                                    <Input
                                      value={line.style}
                                      onChange={(e) => updateLine(oi, li, { style: e.target.value })}
                                      placeholder="Style"
                                      className="h-9"
                                    />
                                  </div>
                                  <div>
                                    <label className="mb-1 block text-xs text-muted-foreground">Item #</label>
                                    <Input
                                      value={line.item_no}
                                      onChange={(e) => updateLine(oi, li, { item_no: e.target.value })}
                                      placeholder="Item #"
                                      className="h-9"
                                    />
                                  </div>
                                </div>
                              )
                            ) : null}

                            {/* Source — order new or pull from stock. */}
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

                            {/* Optional add-on. */}
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

                            {/* Order as roll — PO shows one roll; work order keeps the
                                cuts. Roll goods only (carpet / sheet vinyl). */}
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
                                {/* Fill piece — an extra cut off the same roll for
                                    this area; flagged on every doc, yardage orders. */}
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

                            {/* Pricing unit. Roll goods / hard surface stay locked to
                                area (carpet needs sq yd); everything else gets the
                                full unit picker so bag / each / lnft is one tap. */}
                            {line.line_type !== "flat" && !isSubfloor(line) ? (
                              isRollGoodCategory(line.category) || isHardSurfaceCategory(line.category) ? (
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
                              )
                            ) : null}

                            {/* Manual qty override + waste — area lines only. */}
                            {line.line_type !== "flat" && !isSubfloor(line) && !isCountLine(line) ? (
                              <div className="flex flex-wrap items-end gap-3">
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
                              </div>
                            ) : null}
                          </div>
                        </details>

                        {/* Actions */}
                        <div className="flex items-center gap-2 border-t pt-3">
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
                        {section === "labor" ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => addLine(oi, true)}
                          >
                            <Plus className="size-3.5" /> Add labor line
                          </Button>
                        ) : (
                          // ONE way to add a forgotten item: a blank line (search
                          // the catalog or type your own), a pre-priced add-on, or
                          // subfloor — all in one menu.
                          <details className="relative [&_summary]:list-none">
                            <summary className="inline-flex cursor-pointer items-center gap-1 rounded-md border bg-card px-3 py-1.5 text-sm font-semibold hover:bg-muted">
                              <Plus className="size-3.5" /> Add item
                            </summary>
                            <div className="absolute z-20 mt-1 max-h-80 w-72 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                              <button
                                type="button"
                                onClick={(e) => {
                                  addLine(oi, false);
                                  (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
                                }}
                                className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm font-medium hover:bg-muted"
                              >
                                <Plus className="size-4 text-primary" /> Material line
                                <span className="text-xs font-normal text-muted-foreground">— search the catalog or type your own</span>
                              </button>
                              {addonCatalog.length ? (
                                <>
                                  <div className="mt-1 border-t px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Common add-ons
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
                                </>
                              ) : null}
                              <div className="mt-1 border-t px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                Subfloor (by the sheet)
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
                        )}
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
          <span
            className="mr-1 hidden text-xs text-muted-foreground sm:inline"
            aria-live="polite"
            title="Your work auto-saves as you type"
          >
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "✓ Saved" : ""}
          </span>
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
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => save(false)}
          >
            <Save className="size-4" /> {isPending ? "Saving…" : "Save"}
          </Button>
          <Button type="button" data-tour="estimate-send" disabled={isPending} onClick={saveAndSend}>
            <Send className="size-4" /> Save &amp; send
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
    unit: l.unit,
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
