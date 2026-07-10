"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Plus,
  Trash2,
  Sparkles,
  Ruler,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { priceFromMargin } from "@/lib/estimate-calc";
import { profileFor } from "@/lib/flooring-profiles";
import type { Product, EstimateQuestion, EstimateEmit, CustomerArea } from "@/lib/types";
import { AreaCalculator } from "@/components/area-calculator";
import { ProductPicker, type CustomProductInput } from "./product-picker";
import {
  createSmartEstimate,
  saveEstimateDraft,
  deleteEstimateDraft,
  type SmartLine,
  type EstimateDraft,
} from "./smart-actions";
import { replaceCustomerAreas } from "@/app/(app)/customers/[id]/area-actions";

const numv = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

// Carpet & pad bill per sq yd; everything else per sq ft.
const YD_CATS = new Set(["carpet", "underlayment"]);
function billing(category: string) {
  const wantYd = YD_CATS.has(category);
  return { wantYd, measureUnit: wantYd ? ("sqyd" as const) : ("sqft" as const), unitLabel: wantYd ? "sq yd" : "sq ft" };
}
/** Convert a catalog product's per-unit rate to the line's billing unit. */
function rateFor(rate: number, productUnit: string | null, wantYd: boolean): number {
  const isYd = (productUnit || "").toLowerCase().includes("yd");
  const factor = isYd === wantYd ? 1 : wantYd ? 9 : 1 / 9;
  return r2((rate || 0) * factor);
}
function unitLabel(u: string): string {
  return u === "sqyd" ? "sq yd" : u === "sqft" ? "sq ft" : u === "lnft" ? "ln ft" : u;
}

// --- Answer shapes ---------------------------------------------------------
// A measured area: length × width in feet + inches. `override` (from the
// multi-shape calculator) wins over L×W when set.
interface AreaRow {
  id: string;
  name: string;
  lf: string; li: string; // length feet / inches
  wf: string; wi: string; // width feet / inches
  override: string; // total sq ft from the area calculator (irregular rooms)
  differs: boolean; // this room needs different prep than the job default
}
const feetIn = (ft: string, inch: string) => numv(ft) + numv(inch) / 12;
const rowSqft = (r: AreaRow): number =>
  numv(r.override) > 0 ? numv(r.override) : r2(feetIn(r.lf, r.li) * feetIn(r.wf, r.wi));
interface ProductAns {
  productId: string; label: string; unit: string;
  category: string | null;   // catalog category → per-product billing (yd vs ft)
  materialRate: number; laborRate: number;
  manufacturer: string | null; style: string | null; color: string | null;
  supplierName: string | null;
  source: "order" | "stock"; vendor: string;
  wastePct: number | null;   // null = use the category default waste
  sqftPerBox: number | null; // sq ft per carton → box count (display)
}
/** An extra material for a specific area (e.g. an upgraded pad for the stairs). */
interface ExtraPad { id: string; product: ProductAns | null; sqft: string }
/** One demo type + the area it covers (repeatable "demo" step). */
interface DemoRow { id: string; option: string; sqft: string }
/** One trim/molding line — a quick-picked type with color/size, and an optional
 *  specific catalog product. */
interface TrimRow {
  id: string;
  type: string; // e.g. "Baseboard", "J-channel"
  qty: string;
  unit: string; // lnft | each | pc
  cost: number; // material $/unit (default from the type; overridable)
  color: string;
  size: string;
  sized: boolean; // show the size field (J-channel, stair nose, baseboard…)
  source: "order" | "stock";
  product: ProductAns | null; // set only when you attach a specific catalog item
}

/** The trims you click to add — with sensible default material rates you can
 *  tweak per line. Sizes/colors are typed on the line. */
const TRIM_TYPES: { label: string; unit: string; cost: number; sized?: boolean }[] = [
  { label: "Baseboard", unit: "lnft", cost: 2.6, sized: true },
  { label: "Shoe molding", unit: "lnft", cost: 1.0 },
  { label: "Quarter round", unit: "lnft", cost: 1.0 },
  { label: "Cove base", unit: "lnft", cost: 1.5, sized: true },
  { label: "Stair nose", unit: "each", cost: 45, sized: true },
  { label: "J-channel", unit: "lnft", cost: 1.2, sized: true },
  { label: "T-mold", unit: "each", cost: 25 },
  { label: "Reducer", unit: "each", cost: 28 },
  { label: "End cap", unit: "each", cost: 25 },
  { label: "Threshold", unit: "each", cost: 25 },
];
type Answer =
  | { kind: "areas"; rooms: AreaRow[] }
  | { kind: "floor_map"; byRoom: Record<string, ProductAns | null> }
  | { kind: "product"; product: ProductAns | null; extras: ExtraPad[] }
  | { kind: "trims"; rows: TrimRow[] }
  | { kind: "yesno"; yes: boolean }
  | { kind: "number"; value: string; rateIdx: number | null }
  | { kind: "choice"; selected: string[] }
  | { kind: "choice_areas"; rows: DemoRow[] }
  | { kind: "text"; text: string };

let did = 0;
const newDemoRow = (): DemoRow => ({ id: `d${did++}`, option: "", sqft: "" });
let tid = 0;
const newTrimRow = (t?: { label: string; unit: string; cost: number; sized?: boolean }): TrimRow => ({
  id: `t${tid++}`,
  type: t?.label ?? "",
  qty: "",
  unit: t?.unit ?? "lnft",
  cost: t?.cost ?? 0,
  color: "",
  size: "",
  sized: !!t?.sized,
  source: "order",
  product: null,
});

const productLabel = (p: Product) =>
  [p.manufacturer, p.name, p.color].filter(Boolean).join(" ") || p.name;
/** Stable key for a measured room in the floor-map (survives resume — the row
 *  id is regenerated each session, so key by name, falling back to position). */
const roomKey = (name: string, i: number): string =>
  (name || "").trim().toLowerCase() || `room-${i}`;
/** Build the answer shape for a picked catalog product (defaults to Order). */
function toProductAns(p: Product): ProductAns {
  const supplier = (p as Product & { supplier?: string | null }).supplier ?? null;
  return {
    productId: p.id,
    label: productLabel(p),
    unit: p.unit || "sqft",
    category: p.category ?? null,
    materialRate: Number(p.material_rate) || 0,
    laborRate: Number(p.labor_rate) || 0,
    manufacturer: p.manufacturer,
    style: p.style,
    color: p.color,
    supplierName: supplier,
    source: "order",
    vendor: supplier ?? "",
    wastePct: null,
    sqftPerBox: null,
  };
}
/** A one-off product typed in the picker — used on this estimate only, never
 *  saved to the catalog (no productId). */
function customToProductAns(input: CustomProductInput): ProductAns {
  const numOr0 = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const label =
    [input.manufacturer, input.name, input.color]
      .map((s) => (s || "").trim())
      .filter(Boolean)
      .join(" ") || input.name.trim();
  return {
    productId: "",
    label,
    unit: input.unit.trim() || "sqft",
    category: input.category || null,
    materialRate: numOr0(input.material_rate),
    laborRate: numOr0(input.labor_rate),
    manufacturer: input.manufacturer.trim() || null,
    style: input.style.trim() || null,
    color: input.color.trim() || null,
    supplierName: null,
    source: "order",
    vendor: "",
    wastePct: null,
    sqftPerBox: null,
  };
}
let xpid = 0;
const newExtra = (): ExtraPad => ({ id: `x${xpid++}`, product: null, sqft: "" });

let rid = 0;
const newRow = (name = ""): AreaRow => ({
  id: `a${rid++}`, name, lf: "", li: "", wf: "", wi: "", override: "", differs: false,
});
/** A saved customer area → an editable questionnaire row (prefill). */
const savedToRow = (sa: CustomerArea): AreaRow => {
  const hasLW = !!(sa.length_in && sa.width_in);
  return {
    id: `a${rid++}`,
    name: sa.name || "",
    lf: sa.length_in ? String(Math.floor(sa.length_in / 12)) : "",
    li: sa.length_in ? String(Math.round(sa.length_in % 12)) : "",
    wf: sa.width_in ? String(Math.floor(sa.width_in / 12)) : "",
    wi: sa.width_in ? String(Math.round(sa.width_in % 12)) : "",
    override: !hasLW && sa.sqft ? String(sa.sqft) : "",
    differs: !!sa.differs,
  };
};

export function Questionnaire({
  customerId,
  customerName,
  targetMargin,
  serviceAddressId,
  questions,
  savedAreas = [],
  draft = null,
}: {
  customerId: string;
  customerName: string;
  targetMargin: number;
  serviceAddressId: string;
  questions: EstimateQuestion[];
  savedAreas?: CustomerArea[];
  draft?: EstimateDraft | null;
}) {
  const goalRaw = targetMargin;
  const goal = goalRaw > 0 && goalRaw < 100 ? goalRaw : 40;
  const sellAt = (c: number) => (c > 0 ? r2(priceFromMargin(c, goal)) : 0);

  const buildDefaults = (): Record<string, Answer> => {
    const init: Record<string, Answer> = {};
    for (const q of questions) {
      if (q.kind === "areas")
        init[q.id] = { kind: "areas", rooms: savedAreas.length ? savedAreas.map(savedToRow) : [newRow()] };
      else if (q.kind === "floor_map") init[q.id] = { kind: "floor_map", byRoom: {} };
      else if (q.kind === "product")
        init[q.id] = q.config.trim_list
          ? { kind: "trims", rows: [] }
          : { kind: "product", product: null, extras: [] };
      else if (q.kind === "yesno") init[q.id] = { kind: "yesno", yes: !!q.config.default };
      else if (q.kind === "number") init[q.id] = { kind: "number", value: "", rateIdx: q.config.rate_options?.length ? 0 : null };
      else if (q.kind === "choice")
        init[q.id] = q.config.per_area
          ? { kind: "choice_areas", rows: [] }
          : { kind: "choice", selected: [] };
      else init[q.id] = { kind: "text", text: "" };
    }
    return init;
  };

  const [answers, setAnswers] = useState<Record<string, Answer>>(() => {
    const init = buildDefaults();
    // Resume: overlay a saved draft's answers onto the defaults (only for
    // questions that still exist, so a changed question set can't corrupt it).
    if (draft?.answers) {
      for (const [k, v] of Object.entries(draft.answers)) {
        if (init[k] !== undefined && v) init[k] = v as Answer;
      }
    }
    return init;
  });
  const [step, setStep] = useState(draft?.step ?? 0);
  const [resumed, setResumed] = useState(!!draft);
  const [saving, startSave] = useTransition();

  const set = (id: string, a: Answer) => setAnswers((p) => ({ ...p, [id]: a }));

  // Per-room prep overrides: overrides[roomId][questionId] = that room's answer.
  const [overrides, setOverrides] = useState<Record<string, Record<string, Answer>>>(
    (draft?.overrides as Record<string, Record<string, Answer>>) ?? {},
  );

  // Auto-save progress (debounced) so it can be resumed from any device. The
  // first render is skipped so simply opening the page doesn't overwrite a draft.
  const firstSave = useRef(true);
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    const t = setTimeout(() => {
      void saveEstimateDraft(customerId, { serviceAddressId, answers, overrides, step });
    }, 1200);
    return () => clearTimeout(t);
  }, [customerId, serviceAddressId, answers, overrides, step]);
  const startOver = () => {
    setAnswers(buildDefaults());
    setOverrides({});
    setStep(0);
    setResumed(false);
    void deleteEstimateDraft(customerId);
  };
  const setRoomOverride = (roomId: string, qid: string, a: Answer) =>
    setOverrides((p) => ({ ...p, [roomId]: { ...(p[roomId] ?? {}), [qid]: a } }));

  // Total measured area (sq ft) across every "areas" question — the quantity
  // backbone for carpet, pad, and area-based labor.
  const totalSqft = useMemo(() => {
    let s = 0;
    for (const q of questions) {
      if (q.kind !== "areas") continue;
      const a = answers[q.id];
      if (a?.kind === "areas") s += a.rooms.reduce((t, r) => t + rowSqft(r), 0);
    }
    return r2(s);
  }, [questions, answers]);

  // Conditional visibility: a question shows only when its `show_if` matches the
  // answer to a keyed question. Position-INDEPENDENT — we iterate to a fixed
  // point, so a gate can sit anywhere relative to the questions it reveals (a
  // hidden question's answer never counts toward another condition).
  const visible = useMemo(() => {
    const answerVal = (q: EstimateQuestion): string[] => {
      const a = answers[q.id];
      return a?.kind === "yesno"
        ? [a.yes ? "Yes" : "No"]
        : a?.kind === "choice"
          ? a.selected
          : a?.kind === "text"
            ? [a.text]
            : a?.kind === "product"
              ? a.product
                ? [a.product.label]
                : []
              : [];
    };
    const vis: Record<string, boolean> = {};
    for (const q of questions) vis[q.id] = true; // start optimistic
    for (let iter = 0; iter <= questions.length; iter++) {
      const valByKey: Record<string, string[]> = {};
      for (const q of questions) if (vis[q.id] && q.key) valByKey[q.key] = answerVal(q);
      let changed = false;
      for (const q of questions) {
        const cond = q.config.show_if;
        const show = !cond?.key ? true : (valByKey[cond.key] ?? []).some((v) => cond.in.includes(v));
        if (vis[q.id] !== show) {
          vis[q.id] = show;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return vis;
  }, [questions, answers]);
  const visibleQuestions = useMemo(
    () => questions.filter((q) => visible[q.id]),
    [questions, visible],
  );
  // Prep questions that can vary by room (subfloor, demo, skim/level, moisture…).
  const perRoomQuestions = useMemo(
    () =>
      visibleQuestions.filter(
        (q) => q.config.per_room && (q.kind === "yesno" || q.kind === "choice" || q.kind === "number"),
      ),
    [visibleQuestions],
  );
  // Rooms flagged as needing different prep (across all areas questions).
  const flaggedRooms = useMemo(() => {
    const out: AreaRow[] = [];
    for (const q of questions) {
      if (q.kind !== "areas") continue;
      const a = answers[q.id];
      if (a?.kind === "areas") out.push(...a.rooms.filter((r) => r.differs && rowSqft(r) > 0));
    }
    return out;
  }, [questions, answers]);
  // Every measured room with its size + cut dimensions — so the flooring can be
  // itemized per room and the measurements transfer to the estimate/work order.
  const allRooms = useMemo(() => {
    const out: { name: string; sqft: number; lenIn: number | null; widIn: number | null }[] = [];
    for (const q of questions) {
      if (q.kind !== "areas") continue;
      const a = answers[q.id];
      if (a?.kind !== "areas") continue;
      for (const r of a.rooms) {
        const sf = rowSqft(r);
        if (sf <= 0) continue;
        const usingCalc = numv(r.override) > 0;
        out.push({
          name: r.name || "",
          sqft: sf,
          lenIn: usingCalc ? null : Math.round(feetIn(r.lf, r.li) * 12) || null,
          widIn: usingCalc ? null : Math.round(feetIn(r.wf, r.wi) * 12) || null,
        });
      }
    }
    return out;
  }, [questions, answers]);

  // --- Answer → line items -------------------------------------------------
  // Emit one line billed against a SPECIFIC area; `room` tags per-room prep.
  const emitLineArea = (
    emit: EstimateEmit,
    areaSqft: number,
    room: string | null,
    qtyOverride?: number,
  ): SmartLine | null => {
    const per = emit.per || "flat";
    let qty = 1;
    if (qtyOverride != null) qty = qtyOverride;
    else if (per === "area") qty = emit.unit.includes("yd") ? Math.ceil(areaSqft / 9) : Math.ceil(areaSqft);
    if (qty <= 0) return null;
    const isLabor = emit.role === "labor";
    return {
      room,
      description: room ? `${emit.description} — ${room}` : emit.description,
      category: isLabor ? "labor" : emit.category || "other",
      measure_unit: emit.unit.includes("yd") ? "sqyd" : "sqft",
      sqft: per === "area" ? r2(areaSqft) : null, // area billed → carried for confirmation
      quantity: r2(qty),
      length_in: null,
      width_in: null,
      unit: unitLabel(emit.unit),
      material_rate: isLabor ? 0 : sellAt(emit.cost),
      labor_rate: isLabor ? sellAt(emit.cost) : 0,
      material_cost: isLabor ? 0 : emit.cost,
      labor_cost: isLabor ? emit.cost : 0,
      waste_pct: 0,
      product_id: null,
      manufacturer: null,
      style: null,
      color: null,
      from_stock: false,
    };
  };
  // All lines a yes-no / number / choice answer produces for one area + room.
  const linesForAnswer = (q: EstimateQuestion, a: Answer, areaSqft: number, room: string | null): SmartLine[] => {
    const out: SmartLine[] = [];
    if (q.kind === "yesno" && a.kind === "yesno" && a.yes && q.config.emit) {
      const l = emitLineArea(q.config.emit, areaSqft, room);
      if (l) out.push(l);
    } else if (q.kind === "number" && a.kind === "number" && q.config.emit) {
      const n = numv(a.value);
      if (n > 0) {
        const opts = q.config.rate_options ?? [];
        const opt = a.rateIdx != null ? opts[a.rateIdx] : undefined;
        const emit: EstimateEmit = {
          ...q.config.emit,
          cost: opt ? opt.cost : q.config.emit.cost,
          description: opt ? `${q.config.emit.description} — ${opt.label}` : q.config.emit.description,
        };
        const l = emitLineArea(emit, areaSqft, room, n);
        if (l) out.push(l);
      }
    } else if (q.kind === "choice" && a.kind === "choice") {
      for (const opt of q.config.options ?? []) {
        if (a.selected.includes(opt.label) && opt.emit) {
          const l = emitLineArea(opt.emit, areaSqft, room);
          if (l) out.push(l);
        }
      }
    }
    return out;
  };

  const lines: SmartLine[] = useMemo(() => {
    const out: SmartLine[] = [];
    // If a floor-map assigns products per room, the area that gets CARPET (billed
    // by the yard) drives padding — so a mixed job doesn't buy pad for the LVP.
    let carpetArea = 0;
    let floorMapActive = false;
    for (const q of questions) {
      if (q.kind !== "floor_map" || !visible[q.id]) continue;
      const fa = answers[q.id];
      if (fa?.kind !== "floor_map") continue;
      floorMapActive = true;
      allRooms.forEach((rm, i) => {
        const p = fa.byRoom[roomKey(rm.name, i)];
        if (p && YD_CATS.has(p.category || "")) carpetArea += rm.sqft;
      });
    }
    for (const q of questions) {
      if (!visible[q.id]) continue; // hidden by conditional logic → no line
      const a = answers[q.id];
      if (!a) continue;
      if (q.kind === "floor_map" && a.kind === "floor_map") {
        // Each measured room → its own product, billed in that product's unit.
        // Install labor is bundled per product (one line carrying its total area),
        // priced from a per-type install rate (carpet by the yard, hard surface by
        // the foot) since catalog flooring carries no labor rate of its own.
        const fcfg = q.config as { install_yd?: number; install_ft?: number };
        const instYd = fcfg.install_yd != null ? fcfg.install_yd : 6;
        const instFt = fcfg.install_ft != null ? fcfg.install_ft : 2;
        const byProd = new Map<
          string,
          { p: ProductAns; wantYd: boolean; sqft: number }
        >();
        allRooms.forEach((rm, i) => {
          const p = a.byRoom[roomKey(rm.name, i)];
          if (!p || rm.sqft <= 0) return;
          const cat = p.category || "other";
          const b = billing(cat);
          const defWaste = profileFor(cat)?.waste ?? 0;
          const waste = p.wastePct != null ? p.wastePct : defWaste;
          const adj = rm.sqft * (1 + waste / 100);
          let qty: number;
          if (p.sqftPerBox && p.sqftPerBox > 0) {
            const boxes = Math.ceil(adj / p.sqftPerBox);
            qty = b.wantYd ? r2((boxes * p.sqftPerBox) / 9) : boxes * p.sqftPerBox;
          } else {
            qty = Math.ceil(b.wantYd ? adj / 9 : adj);
          }
          if (qty > 0)
            out.push({
              room: rm.name || null,
              description: p.label || cat,
              category: cat,
              measure_unit: b.measureUnit,
              sqft: rm.sqft,
              quantity: qty,
              length_in: rm.lenIn,
              width_in: rm.widIn,
              unit: b.unitLabel,
              material_rate: sellAt(rateFor(p.materialRate, p.unit, b.wantYd)),
              labor_rate: 0,
              material_cost: rateFor(p.materialRate, p.unit, b.wantYd),
              labor_cost: 0,
              waste_pct: 0,
              product_id: p.productId || null,
              manufacturer:
                p.source === "order" && p.vendor.trim() ? p.vendor.trim() : p.manufacturer,
              style: p.style,
              color: p.color,
              from_stock: p.source === "stock",
            });
          // Accumulate install labor per distinct product.
          const key = `${p.productId || p.label}|${p.laborRate}`;
          const agg = byProd.get(key) ?? { p, wantYd: b.wantYd, sqft: 0 };
          agg.sqft += rm.sqft;
          byProd.set(key, agg);
        });
        for (const { p, wantYd, sqft } of byProd.values()) {
          // Prefer the product's own labor rate if set, else the per-type default.
          const lr = rateFor(p.laborRate, p.unit, wantYd) || (wantYd ? instYd : instFt);
          if (lr <= 0 || sqft <= 0) continue;
          out.push({
            room: null,
            description: `Installation — ${(p.label || "flooring").toLowerCase()}`,
            category: "labor",
            measure_unit: wantYd ? "sqyd" : "sqft",
            sqft: r2(sqft),
            quantity: wantYd ? Math.ceil(sqft / 9) : Math.ceil(sqft),
            length_in: null,
            width_in: null,
            unit: wantYd ? "sq yd" : "sq ft",
            material_rate: 0,
            labor_rate: sellAt(lr),
            material_cost: 0,
            labor_cost: lr,
            waste_pct: 0,
            product_id: null,
            manufacturer: null,
            style: null,
            color: null,
            from_stock: false,
          });
        }
      } else if (q.kind === "product" && a.kind === "product") {
        const cat = q.config.category || "other";
        const b = billing(cat);
        // Editable waste per product (falls back to the category default). Baked
        // into the ordered quantity — waste_pct stays 0 so the price isn't
        // double-charged (pricing multiplies material_rate by waste_pct).
        const defWaste = profileFor(cat)?.waste ?? 0;
        const wasteOf = (p: ProductAns) => (p.wastePct != null ? p.wastePct : defWaste);
        const matLine = (
          p: ProductAns,
          qty: number,
          size?: { room?: string | null; sqft?: number | null; lenIn?: number | null; widIn?: number | null },
        ): SmartLine => ({
          room: size?.room ?? null,
          description: p.label || cat,
          category: cat,
          measure_unit: b.measureUnit,
          sqft: size?.sqft ?? null, // the measurement, carried for confirmation
          quantity: qty,
          length_in: size?.lenIn ?? null,
          width_in: size?.widIn ?? null,
          unit: b.unitLabel,
          material_rate: sellAt(rateFor(p.materialRate, p.unit, b.wantYd)),
          labor_rate: 0,
          material_cost: rateFor(p.materialRate, p.unit, b.wantYd),
          labor_cost: 0,
          waste_pct: 0,
          product_id: p.productId || null,
          // Vendor override rides on manufacturer (the PO's name fallback) only
          // when you explicitly set one; otherwise keep the real manufacturer.
          manufacturer: p.source === "order" && p.vendor.trim() ? p.vendor.trim() : p.manufacturer,
          style: p.style,
          color: p.color,
          from_stock: p.source === "stock",
        });
        // Quantity to order/charge for `sf` sq ft of a product. Waste is baked
        // in; if a box size is set we snap UP to whole cartons so you charge for
        // exactly the material you buy.
        const qtyForProduct = (sf: number, p: ProductAns) => {
          const adj = sf * (1 + wasteOf(p) / 100);
          if (p.sqftPerBox && p.sqftPerBox > 0) {
            const boxes = Math.ceil(adj / p.sqftPerBox);
            const billed = boxes * p.sqftPerBox;
            return b.wantYd ? r2(billed / 9) : billed;
          }
          return Math.ceil(b.wantYd ? adj / 9 : adj);
        };
        if (a.product) {
          const p = a.product;
          const boxed = !!(p.sqftPerBox && p.sqftPerBox > 0);
          // Padding only covers the CARPET rooms once a floor-map is in play, so a
          // mixed job doesn't buy pad for the hard-surface areas.
          const coverSf =
            cat === "underlayment" && floorMapActive && carpetArea > 0 ? carpetArea : totalSqft;
          // Flooring is itemized PER ROOM (name + sq ft + L×W) so the sizes you
          // measured show on the estimate & work order. Boxed goods bill as ONE
          // full-carton line (so the charge = the boxes bought); pad / trim /
          // other stay bundled to one line, but carry the total sq ft.
          const perRoomFloor =
            cat !== "underlayment" && cat !== "trim" && cat !== "other" && allRooms.length > 0 && !boxed;
          if (perRoomFloor) {
            for (const rm of allRooms) {
              const qty = qtyForProduct(rm.sqft, p);
              if (qty > 0) out.push(matLine(p, qty, { room: rm.name || null, sqft: rm.sqft, lenIn: rm.lenIn, widIn: rm.widIn }));
            }
          } else if (coverSf > 0) {
            out.push(matLine(p, qtyForProduct(coverSf, p), { sqft: coverSf }));
          }
          // Install labor — bundled, with the total area recorded.
          const lr = rateFor(p.laborRate, p.unit, b.wantYd);
          if (lr > 0 && coverSf > 0) {
            const laborQty = b.wantYd ? Math.ceil(coverSf / 9) : Math.ceil(coverSf);
            out.push({
              room: null,
              description: `Installation — ${(p.label || cat).toLowerCase()}`,
              category: "labor",
              measure_unit: b.measureUnit,
              sqft: r2(coverSf),
              quantity: laborQty,
              length_in: null,
              width_in: null,
              unit: b.unitLabel,
              material_rate: 0,
              labor_rate: sellAt(lr),
              material_cost: 0,
              labor_cost: lr,
              waste_pct: 0,
              product_id: null,
              manufacturer: null,
              style: null,
              color: null,
              from_stock: false,
            });
          }
        }
        // Additional products for specific areas (e.g. upgraded pad on the
        // stairs) — each its own material line, quantity from its own area.
        for (const ex of a.extras) {
          if (!ex.product || numv(ex.sqft) <= 0) continue;
          const qty = qtyForProduct(numv(ex.sqft), ex.product);
          if (qty > 0) out.push(matLine(ex.product, qty));
        }
      } else if (q.kind === "product" && a.kind === "trims") {
        // Trims / moldings — each row is a quick-picked type (with color/size) or
        // a specific catalog product, billed per its unit (lnft/each), so the
        // exact trim shows on the estimate and can be pulled from stock or ordered.
        for (const row of a.rows) {
          const qty = numv(row.qty);
          if (qty <= 0 || (!row.type && !row.product)) continue;
          const p = row.product;
          const matCost = p ? p.materialRate : row.cost;
          const desc =
            p?.label ||
            [row.type || "Trim", row.size ? `${row.size}"`.replace('""', '"') : "", row.color]
              .filter(Boolean)
              .join(" · ");
          out.push({
            room: null,
            description: desc,
            category: "trim",
            measure_unit: "sqft",
            sqft: null,
            quantity: r2(qty),
            length_in: null,
            width_in: null,
            unit: row.unit || p?.unit || "lnft",
            material_rate: sellAt(matCost),
            labor_rate: p ? sellAt(p.laborRate) : 0,
            material_cost: matCost,
            labor_cost: p ? p.laborRate : 0,
            waste_pct: 0,
            product_id: p?.productId || null,
            manufacturer: p?.source === "order" && p.vendor.trim() ? p.vendor.trim() : p?.manufacturer ?? null,
            style: p?.style ?? null,
            color: row.color || p?.color || null,
            from_stock: row.source === "stock",
          });
        }
      } else if (q.kind === "choice" && a.kind === "choice_areas") {
        // Multiple demo types, each billed against its own area.
        for (const row of a.rows) {
          const area = numv(row.sqft);
          if (!row.option || area <= 0) continue;
          const opt = (q.config.options ?? []).find((o) => o.label === row.option);
          if (opt?.emit) {
            const l = emitLineArea(opt.emit, area, null);
            if (l) out.push(l);
          }
        }
      } else if (q.kind === "yesno" || q.kind === "number" || q.kind === "choice") {
        // Per-room prep: split into a job-default line for the remaining area +
        // one room-scoped line per flagged room (its own answer/area). Otherwise
        // one job-level line at the whole measured area.
        if (q.config.per_room && flaggedRooms.length) {
          const flaggedArea = flaggedRooms.reduce((s, r) => s + rowSqft(r), 0);
          const remaining = r2(Math.max(0, totalSqft - flaggedArea));
          if (remaining > 0) out.push(...linesForAnswer(q, a, remaining, null));
          for (const r of flaggedRooms) {
            const ov = overrides[r.id]?.[q.id] ?? a;
            out.push(...linesForAnswer(q, ov, rowSqft(r), r.name || "Room"));
          }
        } else {
          out.push(...linesForAnswer(q, a, totalSqft, null));
        }
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, answers, totalSqft, goal, visible, flaggedRooms, overrides, allRooms]);

  const notes = useMemo(() => {
    // "Job conditions" — flagged choice / yes-no answers (subfloor, tackless…)
    // that aren't line items but the crew needs on the work order.
    const conditions: string[] = [];
    const freeText: string[] = [];
    // Format one flagged answer as "Label: value" (or "" if unanswered).
    const condValue = (q: EstimateQuestion, a: Answer | undefined): string => {
      if (q.kind === "choice" && a?.kind === "choice" && a.selected.length)
        return a.selected.join(", ");
      if (q.kind === "yesno" && a?.kind === "yesno") return a.yes ? "Yes" : "No";
      return "";
    };
    for (const q of questions) {
      if (!visible[q.id]) continue;
      const a = answers[q.id];
      if (q.kind === "text" && a?.kind === "text" && a.text.trim()) {
        freeText.push(`${q.label} ${a.text.trim()}`);
      } else if (q.config.note) {
        const v = condValue(q, a);
        if (v) conditions.push(`${q.label}: ${v}`);
      }
    }
    // Per-room prep: a flagged room's own answer to a per-room condition, so the
    // work order can show subfloor/moisture/etc. under that specific room.
    const roomPrep = new Map<string, string[]>();
    for (const q of questions) {
      if (!visible[q.id] || !q.config.note || !q.config.per_room) continue;
      for (const r of flaggedRooms) {
        const ov = overrides[r.id]?.[q.id];
        const v = condValue(q, ov);
        if (!v) continue;
        const rn = (r.name || "Room").trim();
        const arr = roomPrep.get(rn) ?? [];
        arr.push(`${q.label}: ${v}`);
        roomPrep.set(rn, arr);
      }
    }
    const blocks: string[] = [];
    if (conditions.length) blocks.push(`Job conditions:\n${conditions.map((c) => `• ${c}`).join("\n")}`);
    if (roomPrep.size)
      blocks.push(
        `Per-room prep:\n${[...roomPrep.entries()]
          .map(([rn, items]) => `• ${rn} — ${items.join("; ")}`)
          .join("\n")}`,
      );
    if (freeText.length) blocks.push(freeText.join("\n"));
    return blocks.join("\n\n");
  }, [questions, answers, visible, flaggedRooms, overrides]);

  const grand = lines.reduce((s, l) => s + (l.quantity ?? 0) * (l.material_rate + l.labor_rate), 0);

  // Steps: the currently-visible questions (conditionals reveal as you answer),
  // plus a final Review step.
  const total = visibleQuestions.length;
  const atReview = step >= total;
  const q = atReview ? null : visibleQuestions[step];
  const answered = (qq: EstimateQuestion): boolean => {
    const a = answers[qq.id];
    if (qq.kind === "areas") return a?.kind === "areas" && a.rooms.some((r) => rowSqft(r) > 0);
    if (qq.kind === "floor_map")
      return a?.kind === "floor_map" && Object.values(a.byRoom).some(Boolean);
    if (qq.kind === "product")
      return (
        (a?.kind === "product" && !!a.product) ||
        (a?.kind === "trims" && a.rows.some((r) => (r.product || r.type) && numv(r.qty) > 0))
      );
    return true; // yesno/number/choice/text are always "answerable"
  };
  const canNext = !q || !q.required || answered(q);

  const save = () =>
    startSave(async () => {
      const built = lines.filter((l) => l.description.trim());
      if (!built.length) {
        toast.error("Answer a few questions first — add areas and a product.");
        return;
      }
      // Save the measured areas to the customer (their dashboard card) first —
      // createSmartEstimate redirects on success.
      const areaRooms: AreaRow[] = [];
      for (const qq of questions) {
        if (qq.kind !== "areas") continue;
        const aa = answers[qq.id];
        if (aa?.kind === "areas") areaRooms.push(...aa.rooms);
      }
      const usable = areaRooms.filter((r) => rowSqft(r) > 0 || r.name.trim());
      if (usable.length) {
        await replaceCustomerAreas(
          customerId,
          usable.map((r) => {
            const usingCalc = numv(r.override) > 0;
            return {
              name: r.name,
              length_in: usingCalc ? null : Math.round(feetIn(r.lf, r.li) * 12) || null,
              width_in: usingCalc ? null : Math.round(feetIn(r.wf, r.wi) * 12) || null,
              sqft: rowSqft(r) || null,
              differs: r.differs,
            };
          }),
        );
      }
      const res = await createSmartEstimate({
        customerId,
        title: `Flooring for ${customerName}`,
        taxRate: 8,
        lines: built,
        presentation: "detailed",
        jobDescription: notes.trim() || undefined,
        serviceAddressId: serviceAddressId || null,
        openEdit: true,
        targetMargin: goal,
      });
      if (res?.error) toast.error(res.error);
    });

  if (!questions.length) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        No estimate questions set up yet. Add them in{" "}
        <span className="font-medium">Settings → Estimate questionnaire</span>.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {resumed ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">↩ Resumed your saved progress.</span>
          <button
            type="button"
            onClick={startOver}
            className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Start over
          </button>
        </div>
      ) : null}
      {/* Progress */}
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${(Math.min(step, total) / total) * 100}%` }} />
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {atReview ? "Review" : `${step + 1} / ${total}`}
        </span>
      </div>

      {q ? (
        <Card className="border-primary/20">
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">{q.section}</div>
              <h2 className="text-lg font-semibold sm:text-xl">
                {q.required ? <span className="text-amber-600">★ </span> : null}
                {q.label}
              </h2>
              {q.help ? <p className="mt-1 text-sm text-muted-foreground">{q.help}</p> : null}
            </div>

            <QuestionBody
              q={q}
              answer={answers[q.id]}
              set={(a) => set(q.id, a)}
              sellAt={sellAt}
              totalSqft={totalSqft}
              perRoom={perRoomQuestions}
              overrides={overrides}
              setRoomOverride={setRoomOverride}
              jobAnswers={answers}
              floorRooms={allRooms}
            />
          </CardContent>
        </Card>
      ) : (
        // Review
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="text-sm font-semibold">Here&apos;s your estimate</div>
            {lines.length ? (
              <div className="divide-y text-sm">
                {lines.map((l, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0">
                      <span className="truncate">{l.description}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {l.quantity} {l.unit}
                        {l.from_stock ? " · from stock" : ""}
                        {l.category === "labor" ? " · labor" : ""}
                      </span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatMoney((l.quantity ?? 0) * (l.material_rate + l.labor_rate))}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No line items yet — go back and add areas and a product.</p>
            )}
            <div className="flex items-center justify-between border-t pt-3 text-base">
              <span className="text-muted-foreground">Subtotal (before tax)</span>
              <span className="font-bold tabular-nums">{formatMoney(grand)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              <Sparkles className="mr-1 inline size-3.5 text-primary" />
              Building opens the full estimate so you can review every line, adjust prices, and send — nothing is finalized yet.
            </p>
            <Button type="button" size="lg" className="w-full" onClick={save} disabled={saving}>
              {saving ? "Building…" : "Build the estimate →"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Nav */}
      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        {atReview ? (
          <span className="text-xs text-muted-foreground">{lines.length} line item{lines.length === 1 ? "" : "s"}</span>
        ) : (
          <Button type="button" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
            {step === total - 1 ? "Review" : "Next"} <ArrowRight className="size-4" />
          </Button>
        )}
      </div>
      {!canNext ? (
        <p className="text-right text-xs text-amber-600">This question is required.</p>
      ) : null}
    </div>
  );
}

// --- One question's input, by kind -----------------------------------------
function QuestionBody({
  q,
  answer,
  set,
  sellAt,
  totalSqft,
  perRoom = [],
  overrides = {},
  setRoomOverride,
  jobAnswers = {},
  floorRooms = [],
}: {
  q: EstimateQuestion;
  answer: Answer | undefined;
  set: (a: Answer) => void;
  sellAt: (c: number) => number;
  totalSqft: number;
  perRoom?: EstimateQuestion[];
  overrides?: Record<string, Record<string, Answer>>;
  setRoomOverride?: (roomId: string, qid: string, a: Answer) => void;
  jobAnswers?: Record<string, Answer>;
  floorRooms?: { name: string; sqft: number; lenIn: number | null; widIn: number | null }[];
}) {
  if (q.kind === "areas" && answer?.kind === "areas") {
    const rooms = answer.rooms;
    const upd = (rs: AreaRow[]) => set({ kind: "areas", rooms: rs });
    const patch = (id: string, p: Partial<AreaRow>) =>
      upd(rooms.map((x) => (x.id === id ? { ...x, ...p } : x)));
    const total = rooms.reduce((t, r) => t + rowSqft(r), 0);
    return (
      <div className="space-y-3">
        {rooms.map((r, i) => {
          const usingCalc = numv(r.override) > 0;
          const sf = rowSqft(r);
          return (
            <div key={r.id} className="space-y-2 rounded-lg border bg-muted/20 p-2.5">
              <div className="flex items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <Input
                  value={r.name}
                  onChange={(e) => patch(r.id, { name: e.target.value })}
                  placeholder={`Area ${i + 1} (e.g. Living room)`}
                  className="h-11 flex-1 text-base md:h-10"
                />
                {rooms.length > 1 ? (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => upd(rooms.filter((x) => x.id !== r.id))}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                ) : null}
              </div>

              <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
                <FtInField label="Length" ft={r.lf} inch={r.li} disabled={usingCalc}
                  onFt={(v) => patch(r.id, { lf: v })} onIn={(v) => patch(r.id, { li: v })} />
                <span className="pb-2.5 text-muted-foreground">×</span>
                <FtInField label="Width" ft={r.wf} inch={r.wi} disabled={usingCalc}
                  onFt={(v) => patch(r.id, { wf: v })} onIn={(v) => patch(r.id, { wi: v })} />
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">or total sq ft</label>
                  <Input
                    value={r.override}
                    onChange={(e) => patch(r.id, { override: e.target.value })}
                    inputMode="decimal"
                    placeholder="sq ft"
                    className="h-11 w-24 text-base md:h-10"
                  />
                </div>
                <div className="flex items-center gap-1 pb-0.5">
                  <AreaCalculator
                    triggerLabel={usingCalc ? "Edit areas" : "Odd shape?"}
                    triggerVariant="ghost"
                    triggerClassName="h-9 px-2 text-xs"
                    title={`Square footage — ${r.name || "area"}`}
                    initialLabel={r.name}
                    onApply={(sqft) => patch(r.id, { override: String(sqft) })}
                  />
                  {usingCalc ? (
                    <button type="button" onClick={() => patch(r.id, { override: "" })} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                      use L×W
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-2 text-sm">
                <span>
                  <Ruler className="mr-1 inline size-3.5 text-muted-foreground" />
                  <span className="font-semibold tabular-nums">{r2(sf)}</span> sq ft
                  <span className="ml-1 text-muted-foreground tabular-nums">· {r2(sf / 9)} sq yd</span>
                  {usingCalc ? <span className="ml-1 text-xs text-primary">· added up</span> : null}
                </span>
                {r.differs ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
                    custom prep
                  </span>
                ) : null}
              </div>

              {/* Per-room prep: flag rooms that differ, override just those. */}
              {perRoom.length ? (
                <div className="border-t pt-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={r.differs}
                      onChange={() => patch(r.id, { differs: !r.differs })}
                      className="size-4"
                    />
                    Different prep in this room
                  </label>
                  {r.differs ? (
                    <div className="mt-2 space-y-3 rounded-md border bg-card p-2.5">
                      <p className="text-xs text-muted-foreground">
                        Overriding the job defaults for {r.name || "this area"} only.
                      </p>
                      {perRoom.map((pq) => (
                        <div key={pq.id} className="space-y-1">
                          <div className="text-xs font-medium">{pq.label}</div>
                          <QuestionBody
                            q={pq}
                            answer={overrides[r.id]?.[pq.id] ?? jobAnswers[pq.id]}
                            set={(a) => setRoomOverride?.(r.id, pq.id, a)}
                            sellAt={sellAt}
                            totalSqft={totalSqft}
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => upd([...rooms, newRow()])}>
            <Plus className="size-4" /> Add area
          </Button>
          <span className="rounded-md bg-primary/10 px-3 py-1.5 text-sm">
            Total <span className="font-bold tabular-nums">{r2(total)}</span> sq ft
            <span className="ml-1 font-semibold text-primary tabular-nums">· {r2(total / 9)} sq yd</span>
          </span>
        </div>
      </div>
    );
  }

  if (q.kind === "floor_map" && answer?.kind === "floor_map") {
    const byRoom = answer.byRoom;
    const setRoom = (key: string, prod: ProductAns | null) =>
      set({ kind: "floor_map", byRoom: { ...byRoom, [key]: prod } });
    const fillEmpty = (prod: ProductAns | null) => {
      if (!prod) return;
      const nb = { ...byRoom };
      floorRooms.forEach((rm, i) => {
        const k = roomKey(rm.name, i);
        if (!nb[k]) nb[k] = prod;
      });
      set({ kind: "floor_map", byRoom: nb });
    };
    if (!floorRooms.length) {
      return (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Add your rooms in the areas step first — then pick what goes in each one.
        </p>
      );
    }
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-dashed p-2.5">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Same product in most rooms? Fill the empty ones
          </div>
          <ProductPicker
            value=""
            label=""
            onPick={(prod) => fillEmpty(prod ? toProductAns(prod) : null)}
            onCreated={(prod) => fillEmpty(toProductAns(prod))}
            onUseOnce={(input) => fillEmpty(customToProductAns(input))}
          />
        </div>
        {floorRooms.map((rm, i) => {
          const key = roomKey(rm.name, i);
          const p = byRoom[key] ?? null;
          const cat = p?.category || "other";
          const b = billing(cat);
          return (
            <div key={key} className="rounded-lg border p-3">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="font-medium">{rm.name || `Room ${i + 1}`}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {Math.round(rm.sqft)} sq ft
                  {p ? (
                    <button
                      type="button"
                      onClick={() => setRoom(key, null)}
                      className="ml-2 text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      clear
                    </button>
                  ) : null}
                </span>
              </div>
              <ProductPicker
                value={p?.productId ?? ""}
                initialLabel={p?.label ?? ""}
                label="Product for this room"
                onPick={(prod) => setRoom(key, prod ? toProductAns(prod) : null)}
                onCreated={(prod) => setRoom(key, toProductAns(prod))}
                onUseOnce={(input) => setRoom(key, customToProductAns(input))}
              />
              {p ? (
                <div className="mt-1.5 text-xs text-muted-foreground">
                  {p.label} · sells{" "}
                  {formatMoney(sellAt(rateFor(p.materialRate, p.unit, b.wantYd)))}/{b.unitLabel}
                  {q.config.ask_source ? (
                    <span className="mt-1.5 block">
                      <SourceToggle p={p} compact onChange={(np) => setRoom(key, np)} />
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  if (q.kind === "product" && q.config.trim_list) {
    const rows = answer?.kind === "trims" ? answer.rows : [];
    const upd = (rs: TrimRow[]) => set({ kind: "trims", rows: rs });
    const patch = (id: string, pp: Partial<TrimRow>) =>
      upd(rows.map((x) => (x.id === id ? { ...x, ...pp } : x)));
    return (
      <div className="space-y-3">
        {/* Quick-add: click the trims you need. */}
        <div className="flex flex-wrap gap-1.5">
          {TRIM_TYPES.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => upd([...rows, newTrimRow(t)])}
              className="rounded-full border px-3 py-1.5 text-sm font-medium hover:border-primary hover:bg-primary/5"
            >
              <Plus className="mr-0.5 inline size-3.5" />
              {t.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => upd([...rows, newTrimRow()])}
            className="rounded-full border border-dashed px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            + Other
          </button>
        </div>

        {rows.map((row) => (
          <div key={row.id} className="space-y-2 rounded-md border bg-muted/20 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <Input
                value={row.type}
                onChange={(e) => patch(row.id, { type: e.target.value })}
                placeholder="Trim name"
                className="h-10 max-w-[16rem] flex-1 text-base font-medium"
              />
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => upd(rows.filter((x) => x.id !== row.id))}>
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Qty</label>
                <Input value={row.qty} onChange={(e) => patch(row.id, { qty: e.target.value })} inputMode="decimal" placeholder="0" className="h-10 w-20 text-base" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Unit</label>
                <select value={row.unit} onChange={(e) => patch(row.id, { unit: e.target.value })} className="h-10 rounded-md border border-input bg-transparent px-2 text-sm">
                  <option value="lnft">linear ft</option>
                  <option value="each">each</option>
                  <option value="pc">pieces</option>
                </select>
              </div>
              {row.sized ? (
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Size</label>
                  <Input value={row.size} onChange={(e) => patch(row.id, { size: e.target.value })} placeholder='e.g. 3¼"' className="h-10 w-24 text-base" />
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Color / finish</label>
                <Input value={row.color} onChange={(e) => patch(row.id, { color: e.target.value })} placeholder="e.g. white" className="h-10 w-28 text-base" />
              </div>
              {!row.product ? (
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">$ / {row.unit}</label>
                  <Input
                    value={row.cost ? String(row.cost) : ""}
                    onChange={(e) => patch(row.id, { cost: numv(e.target.value) })}
                    inputMode="decimal"
                    placeholder="0"
                    className="h-10 w-20 text-base"
                  />
                </div>
              ) : null}
              <div className="inline-flex overflow-hidden rounded-md border">
                <button type="button" onClick={() => patch(row.id, { source: "order" })}
                  className={cn("px-2.5 py-2 text-sm font-medium", row.source === "order" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Order</button>
                <button type="button" onClick={() => patch(row.id, { source: "stock" })}
                  className={cn("px-2.5 py-2 text-sm font-medium", row.source === "stock" ? "bg-amber-500 text-white" : "text-muted-foreground")}>Stock</button>
              </div>
            </div>
            {/* Optional: attach a specific catalog / Versatrim product. */}
            <details className="text-sm">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                {row.product ? `Catalog: ${row.product.label} — change` : "Find a specific product in the catalog"}
              </summary>
              <div className="mt-2">
                <ProductPicker
                  value={row.product?.productId ?? ""}
                  initialLabel={row.product?.label ?? ""}
                  label="Search the catalog (or add a Versatrim / manufacturer item)"
                  defaultCategory="trim"
                  onPick={(prod) => patch(row.id, { product: prod ? toProductAns(prod) : null, unit: prod?.unit || row.unit, type: row.type || (prod ? prod.name : row.type) })}
                  onCreated={(prod) => patch(row.id, { product: toProductAns(prod), unit: prod.unit || row.unit })}
                  onUseOnce={(input) => patch(row.id, { product: customToProductAns(input), unit: input.unit || row.unit })}
                />
              </div>
            </details>
          </div>
        ))}
      </div>
    );
  }

  if (q.kind === "product" && !q.config.trim_list && answer?.kind === "product") {
    const p = answer.product;
    const extras = answer.extras;
    const cat = q.config.category || "other";
    const b = billing(cat);
    const kindLabel = cat === "underlayment" ? "padding" : cat;
    // Waste + carton entry is for the flooring itself (not pad / trim / other).
    const isFlooring = ["carpet", "lvp", "vinyl", "laminate", "hardwood", "tile"].includes(cat);
    const defWasteForCat = profileFor(cat)?.waste ?? 0;
    const setMain = (product: ProductAns | null) => set({ kind: "product", product, extras });
    const setExtras = (xs: ExtraPad[]) => set({ kind: "product", product: p, extras: xs });
    const patchExtra = (id: string, patch: Partial<ExtraPad>) =>
      setExtras(extras.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    return (
      <div className="space-y-3">
        <ProductPicker
          value={p?.productId ?? ""}
          initialLabel={p?.label ?? ""}
          label={`Pick from the catalog (${cat})`}
          defaultCategory={cat}
          onPick={(prod) => setMain(prod ? toProductAns(prod) : null)}
          onCreated={(prod) => setMain(toProductAns(prod))}
          onUseOnce={(input) => setMain(customToProductAns(input))}
        />
        {p ? (
          <>
            <div className="rounded-md border bg-muted/30 p-2.5 text-sm">
              <div className="font-medium">{p.label}</div>
              <div className="text-xs text-muted-foreground">
                {formatMoney(p.materialRate)}/{p.unit} → sells {formatMoney(sellAt(rateFor(p.materialRate, p.unit, b.wantYd)))}/{b.unitLabel}
                {totalSqft > 0 ? ` · covers ${r2(b.wantYd ? totalSqft / 9 : totalSqft)} ${b.unitLabel}` : ""}
              </div>
            </div>
            {q.config.ask_source ? <SourceToggle p={p} onChange={setMain} /> : null}
            {isFlooring ? (
              (() => {
                const effWaste = p.wastePct != null ? p.wastePct : defWasteForCat;
                const adj = totalSqft > 0 ? totalSqft * (1 + effWaste / 100) : 0;
                const boxes =
                  p.sqftPerBox && p.sqftPerBox > 0 ? Math.ceil(adj / p.sqftPerBox) : 0;
                // What you actually order & charge for: full cartons when a box
                // size is set, else the waste-adjusted area.
                const ordered = boxes > 0 ? boxes * (p.sqftPerBox as number) : r2(adj);
                return (
                  <div className="space-y-2 rounded-md border border-dashed p-2.5">
                    <div className="flex flex-wrap items-end gap-3">
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">Waste factor</label>
                        <div className="flex items-center gap-1">
                          <Input
                            value={p.wastePct != null ? String(p.wastePct) : ""}
                            onChange={(e) =>
                              setMain({ ...p, wastePct: e.target.value.trim() === "" ? null : numv(e.target.value) })
                            }
                            inputMode="decimal"
                            placeholder={String(defWasteForCat)}
                            className="h-10 w-20 text-base"
                          />
                          <span className="text-sm text-muted-foreground">%</span>
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">Sq ft per box</label>
                        <Input
                          value={p.sqftPerBox != null ? String(p.sqftPerBox) : ""}
                          onChange={(e) =>
                            setMain({ ...p, sqftPerBox: e.target.value.trim() === "" ? null : numv(e.target.value) })
                          }
                          inputMode="decimal"
                          placeholder="e.g. 20"
                          className="h-10 w-24 text-base"
                        />
                      </div>
                    </div>
                    {totalSqft > 0 ? (
                      <p className="text-sm">
                        Order{" "}
                        <span className="font-semibold tabular-nums">{ordered}</span> sq ft
                        <span className="text-muted-foreground"> (incl. {effWaste}% waste)</span>
                        {boxes > 0 ? (
                          <>
                            {" "}·{" "}
                            <span className="font-semibold tabular-nums text-primary">{boxes}</span>{" "}
                            box{boxes === 1 ? "" : "es"}
                          </>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                );
              })()
            ) : null}
          </>
        ) : null}

        {/* One OR multiple: add another product for a specific area. */}
        {q.config.allow_additional ? (
          <div className="space-y-2 rounded-lg border border-dashed p-2.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Additional {kindLabel} for a specific area
            </div>
            {extras.map((ex) => (
              <div key={ex.id} className="space-y-2 rounded-md border bg-muted/20 p-2">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <ProductPicker
                      value={ex.product?.productId ?? ""}
                      initialLabel={ex.product?.label ?? ""}
                      label={`Product (${cat})`}
                      defaultCategory={cat}
                      onPick={(prod) => patchExtra(ex.id, { product: prod ? toProductAns(prod) : null })}
                      onCreated={(prod) => patchExtra(ex.id, { product: toProductAns(prod) })}
                      onUseOnce={(input) => patchExtra(ex.id, { product: customToProductAns(input) })}
                    />
                  </div>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setExtras(extras.filter((x) => x.id !== ex.id))}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-muted-foreground">Area</label>
                  <Input value={ex.sqft} onChange={(e) => patchExtra(ex.id, { sqft: e.target.value })} inputMode="decimal" placeholder="sq ft" className="h-10 w-28" />
                  {ex.product && numv(ex.sqft) > 0 ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      = {r2(b.wantYd ? numv(ex.sqft) / 9 : numv(ex.sqft))} {b.unitLabel}
                    </span>
                  ) : null}
                  {ex.product && q.config.ask_source ? (
                    <SourceToggle p={ex.product} compact onChange={(np) => patchExtra(ex.id, { product: np })} />
                  ) : null}
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setExtras([...extras, newExtra()])}>
              <Plus className="size-4" /> Add {kindLabel}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (q.kind === "yesno" && answer?.kind === "yesno") {
    return (
      <div className="flex gap-2">
        {[["Yes", true], ["No", false]].map(([lbl, val]) => (
          <button key={lbl as string} type="button" onClick={() => set({ kind: "yesno", yes: val as boolean })}
            className={cn("flex-1 rounded-lg border p-3 text-base font-medium", answer.yes === val ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
            {answer.yes === val ? <Check className="mr-1 inline size-4" /> : null}
            {lbl}
          </button>
        ))}
      </div>
    );
  }

  if (q.kind === "number" && answer?.kind === "number") {
    const opts = q.config.rate_options ?? [];
    return (
      <div className="space-y-3">
        <Input value={answer.value} onChange={(e) => set({ ...answer, value: e.target.value })} inputMode="decimal" placeholder="0" className="h-12 max-w-[10rem] text-lg" />
        {opts.length ? (
          <div className="flex flex-wrap gap-1.5">
            {opts.map((o, i) => (
              <button key={o.label} type="button" onClick={() => set({ ...answer, rateIdx: i })}
                className={cn("rounded-full border px-3 py-1.5 text-sm font-medium", answer.rateIdx === i ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                {o.label} · {formatMoney(o.cost)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (q.kind === "choice" && q.config.per_area) {
    const opts = (q.config.options ?? []).filter((o) => o.emit);
    const rows = answer?.kind === "choice_areas" ? answer.rows : [];
    const upd = (rs: DemoRow[]) => set({ kind: "choice_areas", rows: rs });
    const patch = (id: string, pp: Partial<DemoRow>) =>
      upd(rows.map((x) => (x.id === id ? { ...x, ...pp } : x)));
    return (
      <div className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add each demo type and the area it covers.
          </p>
        ) : null}
        {rows.map((row) => (
          <div key={row.id} className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/20 p-2">
            <div className="min-w-[9rem] flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">Demo type</label>
              <select
                value={row.option}
                onChange={(e) => patch(row.id, { option: e.target.value })}
                className="h-10 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              >
                <option value="">— Choose —</option>
                {opts.map((o) => (
                  <option key={o.label} value={o.label}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Area (sq ft)</label>
              <Input
                value={row.sqft}
                onChange={(e) => patch(row.id, { sqft: e.target.value })}
                inputMode="decimal"
                placeholder="sq ft"
                className="h-10 w-28 text-base"
              />
            </div>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => upd(rows.filter((x) => x.id !== row.id))}>
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => upd([...rows, newDemoRow()])}>
          <Plus className="size-4" /> Add demo area
        </Button>
      </div>
    );
  }

  if (q.kind === "choice" && !q.config.per_area && answer?.kind === "choice") {
    const opts = q.config.options ?? [];
    const multi = q.config.multi;
    const toggle = (label: string) => {
      const on = answer.selected.includes(label);
      if (multi) set({ kind: "choice", selected: on ? answer.selected.filter((x) => x !== label) : [...answer.selected, label] });
      else set({ kind: "choice", selected: on ? [] : [label] });
    };
    return (
      <div className="flex flex-wrap gap-2">
        {opts.map((o) => (
          <button key={o.label} type="button" onClick={() => toggle(o.label)}
            className={cn("rounded-lg border px-4 py-2.5 text-base font-medium", answer.selected.includes(o.label) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
            {answer.selected.includes(o.label) ? <Check className="mr-1 inline size-4" /> : null}
            {o.label}
          </button>
        ))}
        {!opts.length ? <p className="text-sm text-muted-foreground">No options set for this question yet.</p> : null}
      </div>
    );
  }

  if (q.kind === "text" && answer?.kind === "text") {
    return (
      <textarea value={answer.text} onChange={(e) => set({ kind: "text", text: e.target.value })} rows={3}
        placeholder="Type your answer…"
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
    );
  }

  return null;
}

/** Order vs From-stock (+ vendor) for a picked material. Stock → off the PO. */
function SourceToggle({
  p, onChange, compact,
}: {
  p: ProductAns; onChange: (np: ProductAns) => void; compact?: boolean;
}) {
  return (
    <div className={compact ? "flex flex-wrap items-center gap-2" : "space-y-2"}>
      <div className="inline-flex rounded-md border p-0.5">
        <button type="button" onClick={() => onChange({ ...p, source: "order" })}
          className={cn("rounded px-3 py-1.5 text-sm font-medium", p.source === "order" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
          Order
        </button>
        <button type="button" onClick={() => onChange({ ...p, source: "stock" })}
          className={cn("rounded px-3 py-1.5 text-sm font-medium", p.source === "stock" ? "bg-amber-500 text-white" : "text-muted-foreground")}>
          From stock
        </button>
      </div>
      {p.source === "order" ? (
        <div className={compact ? "" : ""}>
          {!compact ? <label className="mb-1 block text-xs text-muted-foreground">Order from (vendor)</label> : null}
          <Input value={p.vendor} onChange={(e) => onChange({ ...p, vendor: e.target.value })}
            placeholder={p.supplierName || "Vendor name"} className="h-10 max-w-xs" />
        </div>
      ) : !compact ? (
        <p className="text-xs text-amber-600">From stock — stays on the estimate &amp; work order, kept off the PO.</p>
      ) : null}
    </div>
  );
}

/** A feet + inches pair for a single dimension (length or width). */
function FtInField({
  label, ft, inch, onFt, onIn, disabled,
}: {
  label: string; ft: string; inch: string;
  onFt: (v: string) => void; onIn: (v: string) => void; disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <div className="flex items-end gap-1">
        <Input value={ft} onChange={(e) => onFt(e.target.value)} inputMode="decimal" placeholder="ft" disabled={disabled}
          className="h-11 w-16 text-base md:h-10 md:w-14" />
        <span className="pb-2.5 text-xs text-muted-foreground">ft</span>
        <Input value={inch} onChange={(e) => onIn(e.target.value)} inputMode="decimal" placeholder="in" disabled={disabled}
          className="h-11 w-14 text-base md:h-10 md:w-12" />
        <span className="pb-2.5 text-xs text-muted-foreground">in</span>
      </div>
    </div>
  );
}
