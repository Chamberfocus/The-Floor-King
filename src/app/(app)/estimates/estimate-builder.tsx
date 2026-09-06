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
  marginPct,
  lineCost,
  optionCostTotals,
  num,
  type SaveEstimateInput,
} from "@/lib/estimate-calc";
import { jobProfit, marginShortfall } from "@/lib/job-profit";
import { ratesFromTargetMargin, landedMaterialForTarget } from "@/lib/estimate-pricing";
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
import { SendToClient } from "@/components/send-to-client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  LineMeasurements,
  newMeasureRow,
  rowsSqft,
  type MeasureRow,
} from "./line-measurements";

interface LineState {
  /** React list key — ephemeral, not the database id. */
  key: string;
  /** Persisted `estimate_line_items.id` when loaded from DB; unset for new builder lines. */
  id?: string;
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
  measurements: MeasureRow[]; // first-class measured pieces (areas / carpet cuts)
}

/** Total inches from a feet+inches pair (measure rows / cut fields). */
const ftInToIn = (ft: string, inch: string): number =>
  Math.round((num(ft) * 12 + num(inch)) * 100) / 100;

/** A measured-piece row → the persisted {label,length_in,width_in,op} shape. */
const rowToMeasurement = (m: MeasureRow) => ({
  label: m.label.trim() || null,
  length_in: ftInToIn(m.len_ft, m.len_in),
  width_in: ftInToIn(m.wid_ft, m.wid_in),
  op: m.op,
});
const rowHasDims = (m: MeasureRow): boolean =>
  ftInToIn(m.len_ft, m.len_in) > 0 && ftInToIn(m.wid_ft, m.wid_in) > 0;

const round2s = (n: number) => String(Math.round(n * 100) / 100);
/** A line's effective margin — its own override, else the estimate overall. */
function effMargin(l: LineState, overall: number): number {
  return l.margin_pct.trim() !== "" ? num(l.margin_pct) : overall;
}
/**
 * Recompute sell rates from cost at margin m — material freight is in the cost
 * basis (landed material), labor is not. `material_cost` stays bare so
 * jobProfit still applies freight once on the cost side.
 */
function ratesFromMargin(
  l: LineState,
  m: number,
  freightMarkupPct: number | string | null | undefined,
): Partial<LineState> {
  const rates = ratesFromTargetMargin({
    lineType: l.line_type,
    laborOnly: isLaborLine(l),
    materialCost: l.material_cost,
    laborCost: l.labor_cost,
    targetMarginPct: m,
    freightMarkupPct,
  });
  const patch: Partial<LineState> = {};
  if (rates.flat_amount != null) patch.flat_amount = round2s(rates.flat_amount);
  if (rates.installed_rate != null)
    patch.installed_rate = round2s(rates.installed_rate);
  if (rates.material_rate != null)
    patch.material_rate = round2s(rates.material_rate);
  if (rates.labor_rate != null) patch.labor_rate = round2s(rates.labor_rate);
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
/** Our cost for a line (material × waste + labor), matching lineTotal's qty. */
function lineOurCost(l: LineState): number {
  // Delegates to the shared cost so the builder can't drift from the estimate,
  // the invoice, or job costing. It used to return 0 for a FLAT line (making
  // flat-priced work look like pure profit) and to charge a stray material cost
  // sitting on a LABOR line — the shared one gets both right.
  return lineCost({
    line_type: l.line_type,
    sqft: l.sqft,
    measure_unit: l.measure_unit,
    material_rate: l.material_rate,
    labor_rate: l.labor_rate,
    installed_rate: l.installed_rate,
    flat_amount: l.flat_amount,
    waste_pct: l.waste_pct,
    material_cost: l.material_cost,
    labor_cost: l.labor_cost,
    quantity: l.quantity,
    unit: l.unit,
    category: l.category,
  });
}

interface OptionState {
  key: string;
  name: string;
  notes: string;
  lines: LineState[];
}

// h-11 on a phone (44px — a thumb's worth), h-9 from sm: up where there's a
// mouse and vertical space is worth more than tap accuracy.
const inputSm =
  "h-11 sm:h-9 rounded-md border border-input bg-transparent px-2 text-base sm:text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
  fuelFee = 0,
  carAllowance = 0,
  commissionPct = 0,
  autoPrint = false,
  colorSuggestions = [],
  manufacturerSuggestions = [],
  addonCatalog = [],
  productUnits = {},
  productDefaults = {},
  builderDraft = null,
  siteAddress = "",
}: {
  estimate: Estimate;
  customerName: string;
  customer?: Customer | null;
  /** The property the work is at, already formatted. Printed on the customer's
   *  copy so a landlord's five identical-looking estimates can be told apart. */
  siteAddress?: string;
  org?: OrgSettings;
  /** Flat per-job fuel + car allowance + commission % of sale — internal, folded
   *  into the owner's true profit, NEVER shown to the customer. */
  fuelFee?: number;
  carAllowance?: number;
  commissionPct?: number;
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
    // no id — new line until first successful save inserts it
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
    measurements: [],
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
    // Preserve database line ids from the draft when present; otherwise recover by
    // option/line position from the saved estimate so an old draft cannot strip ids.
    if (draft?.options?.length) {
      return draft.options.map((o, oi) => ({
        ...o,
        key: newKey(),
        lines: (o.lines ?? []).map((l, li) => ({
          ...l,
          key: newKey(),
          id:
            (typeof l.id === "string" && l.id.trim() ? l.id : undefined) ??
            estimate.options?.[oi]?.line_items?.[li]?.id,
        })),
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
        // First-class measured pieces. Use the saved list when present; else, for
        // a flooring line that already has a single cut, seed one row from it so
        // it appears in the new measurement list (and a save writes it back).
        const savedMeasures = Array.isArray(l.measurements) ? l.measurements : [];
        const isFlooring =
          isRollGoodCategory(l.category) || isHardSurfaceCategory(l.category);
        const measurements: MeasureRow[] = savedMeasures.length
          ? savedMeasures.map((m) => ({
              ...newMeasureRow(),
              label: m.label ?? "",
              len_ft: inToFt(m.length_in),
              len_in: inToIn(m.length_in),
              wid_ft: inToFt(m.width_in),
              wid_in: inToIn(m.width_in),
              op: m.op === "subtract" ? "subtract" : "add",
            }))
          : isFlooring && lenIn && widIn
            ? [{
                ...newMeasureRow(l.room ?? ""),
                len_ft: inToFt(lenIn),
                len_in: inToIn(lenIn),
                wid_ft: inToFt(widIn),
                wid_in: inToIn(widIn),
              }]
            : [];
        const sqftStr = measurements.length
          ? String(rowsSqft(measurements))
          : l.sqft?.toString() ?? "";
        return {
        key: newKey(),
        id: l.id,
        room: l.room ?? "",
        description: desc,
        note: l.note ?? "",
        line_type: l.line_type,
        sqft: sqftStr,
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
        measurements,
        };
      }),
    }));
    return initial.length
      ? initial
      : [{ key: newKey(), name: "Option 1", notes: "", lines: [emptyLine()] }];
  });

  const updateOption = (oi: number, patch: Partial<OptionState>) =>
    setOptions((prev) => prev.map((o, i) => (i === oi ? { ...o, ...patch } : o)));

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
  // Which line's edit panel is open — one at a time, so you edit a single line
  // in a focused box instead of the whole page at once.
  const [activeLine, setActiveLine] = useState<string | null>(null);
  // "Sold it for a round number" tool — type the pre-tax total and it back-solves
  // the overall margin so this option's subtotal lands there.
  const [targetPrice, setTargetPrice] = useState("");
  const toggleLine = (key: string) =>
    setActiveLine((cur) => (cur === key ? null : key));

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
        // New commercial lines — must not reuse source DB ids.
        lines: src.lines.map((l) => ({ ...l, key: newKey(), id: undefined })),
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
          id: undefined,
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
    setActiveLine(line.key); // open the new line for editing
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
    setActiveLine(line.key);
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
    setActiveLine(line.key);
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
        lines.splice(li + 1, 0, { ...o.lines[li], key: newKey(), id: undefined });
        return { ...o, lines };
      }),
    );

  /** Add a FILL piece for the same area/material right below the line — same
   *  product & pricing, blank cut size, flagged as fill so it lists under its
   *  area on every doc and its yardage rolls into the order. */
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
          // Carry the waste. We charge for the square footage we SELL — waste
          // included — and that applies to the labor as well as the material.
          // Without this the labor line was priced on the bare measured area
          // while the material beside it billed the waste-inclusive footage.
          waste_pct: src.waste_pct,
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
    setActiveLine(key);
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
        const laborLine = (
          key: string,
          desc: string,
          // Install follows the material you lay, so it bills the sold
          // (waste-inclusive) footage. TEAR-OUT does not: you rip up the floor
          // that's actually there, and there is no waste on demolition.
          carryWaste: boolean,
        ): LineState => ({
          ...emptyLine(),
          key,
          category: "labor",
          room: src.room,
          description: desc,
          unit: src.unit,
          measure_unit: src.measure_unit,
          quantity: src.quantity,
          sqft: src.sqft,
          waste_pct: carryWaste ? src.waste_pct : "",
          margin_pct: src.margin_pct,
        });
        const lines = [...o.lines];
        lines.splice(li, 0, laborLine(removeK, src.description ? `Remove existing ${src.description}` : "Remove existing", false));
        // material shifted to li+1; install goes after it.
        lines.splice(li + 2, 0, laborLine(installK, src.description ? `Install ${src.description}` : "Install new", true));
        return { ...o, lines };
      }),
    );
    setActiveLine(installK);
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
        const priced = { ...laborLine, ...ratesFromMargin(laborLine, num(overallMargin), org?.freight_markup_pct ?? 0) };
        const lines = o.lines.map((l, j) => (j === li ? { ...l, prep_key: prepKey } : l));
        lines.splice(li + 1, 0, priced);
        return { ...o, lines };
      }),
    );
    setActiveLine(laborKey);
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
        lines: o.lines.map((l) => (l.margin_pct.trim() !== "" ? l : { ...l, ...ratesFromMargin(l, m, org?.freight_markup_pct ?? 0) })),
      })),
    );
  };

  /** Un-pin every line so they all follow the overall margin again. */
  const releaseAllMargins = () => {
    const m = num(overallMargin);
    if (m <= 0 || m >= 100) return;
    setOptions((prev) =>
      prev.map((o) => ({
        ...o,
        lines: o.lines.map((l) =>
          l.margin_pct.trim() === ""
            ? l
            : { ...l, margin_pct: "", ...ratesFromMargin(l, m, org?.freight_markup_pct ?? 0) },
        ),
      })),
    );
    toast.success(`All lines back on ${m}%.`);
  };

  // Price this option to an exact PRE-TAX total. We scale every line's sell
  // proportionally so the subtotal lands on the number exactly — this works no
  // matter how the lines are costed (a margin-only approach breaks on a line
  // that has a price but no cost, e.g. a material you priced in the builder). We
  // then set the margin field to the TRUE overall margin = (total − cost) / total
  // so it reflects the real numbers.
  const solveMarginForTarget = () => {
    const target = num(targetPrice);
    const opt = options[safeActive];
    if (!opt) return;
    if (target <= 0) {
      toast.error("Enter the total you sold it for (before tax).");
      return;
    }
    const currentSub = opt.lines.reduce((s, l) => s + lineTotal(toCalc(l)), 0);
    if (currentSub <= 0) {
      toast.error("Give the lines a starting price first, then set the total.");
      return;
    }
    // A material/flooring line with no price would stay $0 (scaling can't lift $0)
    // — catch it by name so a free line never slips onto the estimate.
    const unpriced = opt.lines.filter(
      (l) =>
        l.description.trim() &&
        !isLaborLine(l) &&
        l.line_type !== "flat" &&
        lineTotal(toCalc(l)) <= 0,
    );
    if (unpriced.length) {
      const names = unpriced
        .map((l) => [l.room, l.description].filter((x) => x && x.trim()).join(" — ") || "a material")
        .slice(0, 4);
      toast.error(
        `Price ${unpriced.length === 1 ? "this line" : "these lines"} first — ${unpriced.length === 1 ? "it has" : "they have"} no price and would be free: ${names.join(", ")}${unpriced.length > 4 ? ", …" : ""}`,
        { duration: 8000 },
      );
      return;
    }
    // Judge the target against the SAME cost the rest of the app uses: freight
    // on material, plus fuel, car allowance and commission. The old guard
    // compared against raw line cost alone, so a price that cleared material
    // and labor but not the overheads sailed straight through — $14,500
    // against $14,000 of line cost passed as "3% margin" while actually losing
    // $967.50 once freight, gas, car and commission were counted.
    //
    // Commission scales with revenue, so the all-in cost is a function of the
    // TARGET, not of the current prices.
    const ct = optionCostTotals(opt.lines.map(toCalc));
    const freightMult = 1 + num(org?.freight_markup_pct ?? 0) / 100;
    const lineCostAllIn = ct.material * freightMult + ct.labor;
    const costAtTarget = (revenue: number) =>
      lineCostAllIn + fuelFee + carAllowance + (num(commissionPct) / 100) * revenue;
    const trueCostAtTarget = costAtTarget(target);
    if (target < trueCostAtTarget) {
      toast.error(
        `That total is below your all-in cost (${formatMoney(trueCostAtTarget)} once freight, gas, car allowance and commission are counted). It would be a loss.`,
        { duration: 8000 },
      );
      return;
    }
    const k = target / currentSub;
    // 6 decimals keeps rate fields sane while the subtotal lands on target. The
    // DB stores rates at 6dp too (migration 0133), so the solved price survives
    // the save — without that, rates truncated to cents and the total drifted
    // (a $1,971.42 quote saved as $1,971.19).
    const r6 = (n: number) => String(Math.round(n * 1e6) / 1e6);
    const scale = (v: string) => {
      const n = num(v);
      return n !== 0 ? r6(n * k) : v;
    };
    const scaled = opt.lines.map((l) => ({
      ...l,
      material_rate: scale(l.material_rate),
      labor_rate: scale(l.labor_rate),
      installed_rate: scale(l.installed_rate),
      flat_amount: scale(l.flat_amount),
      // Prices are now explicit; drop stale per-line margin overrides.
      margin_pct: "",
    }));
    // Scaling + rounding can leave a fractional-cent residual. Absorb it fully
    // into the biggest line so the subtotal equals the typed total to the penny.
    const residual = target - scaled.reduce((s, l) => s + lineTotal(toCalc(l)), 0);
    if (Math.abs(residual) >= 5e-7) {
      let bi = -1;
      let bt = -Infinity;
      scaled.forEach((l, i) => {
        const t = Math.abs(lineTotal(toCalc(l)));
        if (t > bt) {
          bt = t;
          bi = i;
        }
      });
      const l = bi >= 0 ? scaled[bi] : null;
      if (l && l.line_type === "flat") {
        l.flat_amount = r6(num(l.flat_amount) + residual);
      } else if (l) {
        const qty = lineQty(toCalc(l));
        if (qty > 0) {
          const waste = 1 + (num(l.waste_pct) || 0) / 100;
          if (l.line_type === "installed") {
            l.installed_rate = r6(num(l.installed_rate) + residual / (qty * waste));
          } else if (l.category !== "labor" && num(l.material_rate) > 0) {
            l.material_rate = r6(num(l.material_rate) + residual / (qty * waste));
          } else {
            l.labor_rate = r6(num(l.labor_rate) + residual / qty);
          }
        }
      }
    }
    setOptions((prev) =>
      prev.map((o, oi) => (oi !== safeActive ? o : { ...o, lines: scaled })),
    );
    // The real margin at this price — all-in, not just line cost. Reporting
    // "44%" when the honest number was 36.7% overstated by $1,835 on the very
    // screen where the price gets decided.
    const trueMargin = target > 0 ? (1 - trueCostAtTarget / target) * 100 : 0;
    setOverallMargin(round2s(Math.max(trueMargin, 0)));
    setTargetPrice("");
    toast.success(
      `Priced to ${formatMoney(target)} — ${Math.round(trueMargin)}% margin.`,
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
                return { ...l, margin_pct: v, ...ratesFromMargin(l, m, org?.freight_markup_pct ?? 0) };
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
                return { ...merged, ...ratesFromMargin(merged, effMargin(merged, num(overallMargin)), org?.freight_markup_pct ?? 0) };
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
                const cost =
                  field === "material_rate"
                    ? landedMaterialForTarget(
                        merged.material_cost,
                        org?.freight_markup_pct ?? 0,
                      )
                    : num(merged.labor_cost);
                const sell = num(v);
                return cost > 0 && sell > 0
                  ? { ...merged, margin_pct: round2s(marginPct(sell, cost)) }
                  : merged;
              }),
            }
          : o,
      ),
    );

  // Persist a flooring line's measured pieces and derive its square footage from
  // them (the list is the source of truth). The primary cut (first add-piece) is
  // mirrored onto len/wid so the single-cut readers stay in sync.
  const setLineMeasurements = (oi: number, li: number, rows: MeasureRow[]) => {
    const patch: Partial<LineState> = { measurements: rows };
    if (rows.length) {
      patch.sqft = String(rowsSqft(rows));
      patch.quantity = ""; // area drives the line again
      const first = rows.find((r) => r.op === "add" && rowHasDims(r)) ?? rows[0];
      if (first) {
        patch.len_ft = first.len_ft;
        patch.len_in = first.len_in;
        patch.wid_ft = first.wid_ft;
        patch.wid_in = first.wid_in;
      }
    }
    updateLine(oi, li, patch);
  };

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
                  /**
                   * Picking a product REPLACES what was on the line.
                   *
                   * These used to fall back to the previous product's values, so
                   * swapping to something with no style or colour on file left
                   * the old one's behind and the line became a mix of two
                   * products — on the customer's estimate and on the PO.
                   */
                  manufacturer: p.manufacturer ?? "",
                  style: p.style ?? "",
                  color: p.color ?? "",
                  item_no: p.sku ?? "",
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
                  /**
                   * The line is now THIS product, and says so.
                   *
                   * This read `l.description || p.name` — the product's name was
                   * only used when the line had no description at all. Every line
                   * out of the questionnaire already has one, so changing the
                   * product swapped the cost, the brand and the SKU underneath
                   * while the line went on reading the OLD product's name. On
                   * screen, on the customer's copy, and on the purchase order.
                   * That is "the product is not changing".
                   *
                   * A room prefix the estimator typed is kept — "Living room —
                   * Dreamweaver" becomes "Living room — <new product>" — because
                   * that part is about the space, not the product.
                   */
                  description: (() => {
                    const prev = l.description?.trim() ?? "";
                    if (!prev) return p.name;
                    const sep = prev.indexOf(" — ");
                    return sep > 0 ? `${prev.slice(0, sep)} — ${p.name}` : p.name;
                  })(),
                };
                return { ...base, ...ratesFromMargin(base, effMargin(base, num(overallMargin)), org?.freight_markup_pct ?? 0) };
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
                return { ...base, ...ratesFromMargin(base, effMargin(base, num(overallMargin)), org?.freight_markup_pct ?? 0) };
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
        id: l.id || null,
        room: l.room,
        description: l.description,
        note: l.note,
        line_type: l.line_type,
        // The measurement list is the source of truth for a flooring line's area.
        sqft: l.measurements.some(rowHasDims)
          ? String(rowsSqft(l.measurements))
          : l.sqft || null,
        length_in: num(l.len_ft) * 12 + num(l.len_in) || null,
        width_in: num(l.wid_ft) * 12 + num(l.wid_in) || null,
        measurements: l.measurements.filter(rowHasDims).length
          ? l.measurements.filter(rowHasDims).map(rowToMeasurement)
          : null,
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
      if (res.reapprovalRequired) {
        toast.success(
          "Saved. Commercial changes need customer reapproval — previous approval kept. Job / POs / invoices were not changed.",
        );
      } else {
        toast.success("Estimate saved");
      }
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
      if (res.reapprovalRequired) {
        toast.success(
          "Saved for reapproval. Previous customer approval kept. Job / POs / invoices unchanged.",
        );
      }
      window.print();
    });

  // Finish the build and send it to the customer in one step: save, then mark
  // it sent + email the customer their portal link (advances the pipeline). If
  // there's no email on file, don't silently mark it sent — save and open the
  // estimate so an email can be added first.
  const saveAndSend = (sendEmail = true) =>
    startTransition(async () => {
      const res = await saveEstimate(estimate.id, buildInput());
      if (res.error) {
        toast.error(res.error);
        return;
      }
      await flushDefaultRates();
      void clearEstimateBuilderDraft(estimate.id);
      await sendEstimateById(estimate.id, sendEmail);
      toast.success(
        res.reapprovalRequired
          ? sendEmail
            ? `Revised estimate sent for reapproval to ${customer?.full_name || "the customer"}`
            : "Revised estimate saved & marked sent (needs reapproval; no email)"
          : sendEmail
            ? `Estimate sent to ${customer?.full_name || "the customer"}`
            : "Estimate saved & marked sent (no email)",
      );
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
    // MUST carry the COST. These feed jobProfit, optionCostTotals and the
    // price-to-a-total solver, all of which compute OUR COST from this object —
    // and without these two fields every line costed ZERO. The headline margin
    // then read revenue minus only gas, car allowance and commission: 86% on a
    // $1,628 job that actually runs at 24%. The solver judged a target total
    // against that same phantom cost, so "price it to $X" would happily quote
    // below cost and report a margin that was never real.
    //
    // The per-line "Our cost" box was right the whole time (it goes through
    // lineOurCost, which does pass them) — which is exactly why this hid: the
    // costs were on screen, just not in the total.
    material_cost: l.material_cost,
    labor_cost: l.labor_cost,
  });
  const grand = optionTotalsWithDiscount(
    options.flatMap((o) => o.lines.map(toCalc)),
    taxRate,
    discountKind,
    discountValue,
  );
  // THE margin — same definition the saved estimate, invoice and job costing
  // use. It used to be (subtotal − cost) / subtotal, which ignored the discount,
  // freight on material, sales gas, the car allowance and commission, so the
  // number you priced against was always the optimistic one.
  const grandProfit = jobProfit(
    options.flatMap((o) => o.lines.map(toCalc)),
    {
      discountKind,
      discountValue,
      freightMarkupPct: org?.freight_markup_pct ?? 0,
      fuelFee,
      carAllowance,
      commissionPct,
    },
  );
  const grandMargin = grandProfit.margin;
  // Which lines are keeping the job off its target, and what that costs. A
  // blended margin below target is usually a pinned line, not bad arithmetic —
  // so name it instead of leaving the estimator to wonder.
  const shortfall = marginShortfall(
    options[Math.min(Math.max(activeOption, 0), Math.max(options.length - 1, 0))]?.lines.map(toCalc) ?? [],
    num(overallMargin),
    org?.freight_markup_pct ?? 0,
  );
  const pinnedCount = options.flatMap((o) => o.lines).filter((l) => l.margin_pct.trim() !== "").length;
  // Active option, clamped so removing an option never points off the end.
  const safeActive = Math.min(Math.max(activeOption, 0), Math.max(options.length - 1, 0));

  // Live "what the customer sees" — convert the builder's form lines to the
  // shape the customer scope + option cards read, so Preview matches the sent
  // estimate exactly (scope in words + lump sum, no numbers). Reuses the engine.
  const toEstimateLine = (l: LineState, i: number): EstimateLineItem => ({
    id: l.id ?? `${l.key}`,
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

            {/* What you actually get. The box above is what you ASKED for; a
                pinned line or a line with no cost can stop the job reaching it,
                and showing only the target is how the number stopped being
                trustworthy. */}
            <div className="w-full border-t border-primary/20 pt-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  Actual margin on this job
                </span>
                <span
                  className={`text-lg font-semibold tabular-nums ${
                    Math.abs(grandMargin - num(overallMargin)) < 0.05
                      ? "text-emerald-600"
                      : "text-amber-600"
                  }`}
                >
                  {grandMargin.toFixed(2)}%
                </span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {formatMoney(grandProfit.revenue)} revenue −{" "}
                {formatMoney(grandProfit.cost)} cost
                {grandProfit.discount > 0
                  ? ` (after ${formatMoney(grandProfit.discount)} discount)`
                  : ""}
                {grandProfit.commission > 0
                  ? ` − ${formatMoney(grandProfit.commission)} commission`
                  : ""}
                {grandProfit.fuelFee + grandProfit.carAllowance > 0
                  ? ` − ${formatMoney(grandProfit.fuelFee + grandProfit.carAllowance)} gas & vehicle`
                  : ""}{" "}
                = {formatMoney(grandProfit.profit)} profit
              </div>

              {shortfall.offTarget.length > 0 ? (
                <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs dark:bg-amber-950/40">
                  <div className="font-medium text-amber-900 dark:text-amber-200">
                    {shortfall.offTarget.length}{" "}
                    {shortfall.offTarget.length === 1 ? "line is" : "lines are"}{" "}
                    below {shortfall.target}% — {formatMoney(shortfall.totalShortfall)}{" "}
                    less than pricing them at target
                  </div>
                  <ul className="mt-1 space-y-0.5 text-amber-900/80 dark:text-amber-200/80">
                    {shortfall.offTarget.slice(0, 4).map((l) => (
                      <li key={l.index} className="flex justify-between gap-3">
                        <span className="truncate">{l.description}</span>
                        <span className="shrink-0 tabular-nums">
                          {l.margin.toFixed(1)}% · {formatMoney(l.shortfall)} short
                        </span>
                      </li>
                    ))}
                  </ul>
                  {pinnedCount > 0 ? (
                    <button
                      type="button"
                      onClick={releaseAllMargins}
                      className="mt-1.5 font-medium underline underline-offset-2"
                    >
                      Put all {pinnedCount} pinned{" "}
                      {pinnedCount === 1 ? "line" : "lines"} back on {overallMargin}%
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {/* Sold it for a price? Type the total (before tax) and it sets the
              margin to hit it exactly. */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 p-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Price it to a total</div>
              <div className="text-xs text-muted-foreground">
                Sold at a set price? Enter the pre-tax total — the lines scale to
                land on it exactly, and the margin shows your real margin at that
                price. (A line with no price stays $0 — give it one first.)
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-muted-foreground">$</span>
              <Input
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    solveMarginForTarget();
                  }
                }}
                placeholder="12,000"
                className="h-11 w-32 text-lg font-semibold"
                aria-label="Target total before tax"
              />
              <Button type="button" onClick={solveMarginForTarget}>
                Set margin
              </Button>
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            // MUST carry category — lineTotal charges a labor line's labor only,
            // and that guard is off when category is undefined. Without it the
            // option card's Total could bill a stray material rate that the
            // section subtotal and the SAVED estimate both correctly ignore.
            category: l.category,
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
          // Same all-in definition as the builder header (jobProfit): freight on
          // material, then gas / car / commission. Never omit freight here.
          const optionProfit = jobProfit(option.lines.map(toCalc), {
            discountKind,
            discountValue,
            freightMarkupPct: org?.freight_markup_pct ?? 0,
            fuelFee,
            carAllowance,
            commissionPct,
          });
          const optionCost = optionProfit.cost;
          const costSplit = {
            mat: optionProfit.material,
            labor: optionProfit.labor,
          };
          const fuel = optionProfit.fuelFee;
          const car = optionProfit.carAllowance;
          const commission = optionProfit.commission;
          const optionMargin = optionProfit.margin;

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
                    // Carry category, or a labor line's per-line price shows a
                    // material rate the option total doesn't charge.
                    category: line.category,
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
                  const isOpen = activeLine === line.key;
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

                      {/* Editor — opens in a focused side panel, one line at a
                          time, so you're never editing the whole page at once. */}
                      <Sheet
                        open={isOpen}
                        onOpenChange={(o) => {
                          if (!o) setActiveLine(null);
                        }}
                      >
                        <SheetContent
                          side="right"
                          className="w-full gap-0 p-0 sm:max-w-2xl"
                        >
                          <SheetHeader className="border-b p-4">
                            <SheetTitle className="truncate pr-8 text-base">
                              {displayName || "New line"}
                            </SheetTitle>
                          </SheetHeader>
                          <div className="space-y-4 p-4">
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
                              className="h-11 sm:h-9 text-base sm:text-sm"
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
                          isRollGoodCategory(line.category) || isHardSurfaceCategory(line.category) ? (
                            /* FLOORING — build the area up from measured pieces.
                               Carpet/vinyl: each add-piece is a cut off the roll
                               (→ staging sheet). Hard surface: pieces sum to SF. */
                            <div className="w-full space-y-2">
                              <LineMeasurements
                                category={line.category}
                                rows={line.measurements}
                                onChange={(rows) => setLineMeasurements(oi, li, rows)}
                                sqftPerBox={line.sqft_per_box}
                                onSqftPerBoxChange={(v) => updateLine(oi, li, { sqft_per_box: v })}
                              />
                              {/* Fallback for lines with no measured pieces yet
                                  (e.g. older estimates) — type the sq ft directly. */}
                              {line.measurements.length === 0 ? (
                                <div className="flex items-end gap-2">
                                  <LabeledNumber
                                    label="Or enter sq ft directly"
                                    width="w-28"
                                    value={line.sqft}
                                    onChange={(v) => updateLine(oi, li, { sqft: v, quantity: "" })}
                                  />
                                  {isRollGoodCategory(line.category) && num(line.sqft) > 0 ? (
                                    <div className="pb-2 text-xs text-muted-foreground">
                                      {(num(line.sqft) / 9).toFixed(1)} sq yd
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                          <div className="flex flex-wrap items-end gap-3">
                            {/* AREA-billed non-flooring lines (general area). Count
                                items are handled by the calculators below. */}
                            {!isCountLine(line) ? (
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
                          )
                        ) : null}

                        {/* 4 · PRICE — cost / margin / sell (or installed / flat). */}
                        {line.line_type === "mat_labor" ? (
                          (() => {
                            const labor = isLaborLine(line);
                            const unitLbl = line.unit || (line.measure_unit === "sqyd" ? "sq yd" : "sq ft");
                            const overriding = line.margin_pct.trim() !== "";
                            return (
                              <div className="w-full space-y-1.5 rounded-lg border bg-card p-3">
                                {/* Stacked on a phone. Three number inputs side
                                    by side is ~100px each on a 375px screen —
                                    the row a rep uses most, and the hardest to
                                    hit. */}
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
                                      className="h-11 sm:h-9 text-base sm:text-sm"
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
                                className="h-11 sm:h-9 text-base sm:text-sm"
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
                                className="h-11 sm:h-9 text-base sm:text-sm"
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
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  <div>
                                    <label className="mb-1 block text-xs text-muted-foreground">Manufacturer</label>
                                    <Input
                                      value={line.manufacturer}
                                      onChange={(e) => updateLine(oi, li, { manufacturer: e.target.value })}
                                      placeholder="e.g. Shaw"
                                      list="estimate-manufacturer-suggestions"
                                      className="h-11 sm:h-9 text-base sm:text-sm"
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
                                        className="h-11 sm:h-9 text-base sm:text-sm"
                                      />
                                    </div>
                                  ) : null}
                                  <div>
                                    <label className="mb-1 block text-xs text-muted-foreground">Style</label>
                                    <Input
                                      value={line.style}
                                      onChange={(e) => updateLine(oi, li, { style: e.target.value })}
                                      placeholder="Style"
                                      className="h-11 sm:h-9 text-base sm:text-sm"
                                    />
                                  </div>
                                  <div>
                                    <label className="mb-1 block text-xs text-muted-foreground">Item #</label>
                                    <Input
                                      value={line.item_no}
                                      onChange={(e) => updateLine(oi, li, { item_no: e.target.value })}
                                      placeholder="Item #"
                                      className="h-11 sm:h-9 text-base sm:text-sm"
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
                                ) : (
                                  <p className="mt-1 text-xs text-muted-foreground">Each cut you add above prints on the warehouse cut sheet.</p>
                                )}
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
                        </SheetContent>
                      </Sheet>
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
                      {fuel > 0 ? (
                        <div className="flex justify-between text-muted-foreground">
                          <span>Salesperson gas</span>
                          <span className="tabular-nums">{formatMoney(fuel)}</span>
                        </div>
                      ) : null}
                      {car > 0 ? (
                        <div className="flex justify-between text-muted-foreground">
                          <span>Car allowance</span>
                          <span className="tabular-nums">{formatMoney(car)}</span>
                        </div>
                      ) : null}
                      {commission > 0 ? (
                        <div className="flex justify-between text-muted-foreground">
                          <span>Commission ({num(commissionPct)}%)</span>
                          <span className="tabular-nums">{formatMoney(commission)}</span>
                        </div>
                      ) : null}
                      <div className="flex justify-between font-medium text-foreground">
                        <span>Profit</span>
                        <span className="tabular-nums">
                          {formatMoney(optionProfit.profit)}
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
          <SendToClient
            clientName={customer?.full_name}
            email={customer?.email}
            title="Send this estimate to the customer?"
            description="We'll save it, mark it sent, and email your branded estimate with a link to review & approve."
            sendLabel="Save & send"
            skipLabel="Save, no email"
            disabled={isPending}
            onChoose={(send) => saveAndSend(send)}
          >
            <Send className="size-4" /> Save &amp; send
          </SendToClient>
          </div>
        </div>
      </div>
    </div>
    {org ? (
      <EstimatePrintDoc
        org={org}
        customer={customer}
        siteAddress={siteAddress}
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
  siteAddress = "",
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
  siteAddress?: string;
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
    // This is the CUSTOMER'S document. Dropping category turned off the
    // labor-line guard in lineTotal, so the printed estimate could bill a stray
    // material rate that the saved estimate, the portal copy and the invoice
    // all correctly ignore — handing the customer a page whose numbers don't
    // match the ones the business is working from.
    category: l.category,
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
          {siteAddress && siteAddress !== addr ? (
            <div className="mt-1 text-xs">
              <span className="uppercase tracking-wide text-gray-500">Job site</span>{" "}
              <span className="font-medium text-gray-800">{siteAddress}</span>
            </div>
          ) : null}
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
