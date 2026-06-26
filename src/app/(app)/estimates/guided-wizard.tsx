"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Plus, Trash2, ArrowLeft, ArrowRight, Check, Printer, Send, Ruler, RotateCcw, Camera,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { priceFromMargin, marginPct } from "@/lib/estimate-calc";
import { FLOORING_TYPES, profileFor, areaSqft } from "@/lib/flooring-profiles";
import { STANDARD_ADDONS } from "@/lib/addons";
import type { Product } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { ProductPicker } from "./product-picker";
import { AreaCalculator } from "@/components/area-calculator";
import { PriceBookPicker } from "@/components/price-book-picker";
import type { PriceItem } from "@/lib/price-book";
import { createSmartEstimate, type SmartLine } from "./smart-actions";
import { analyzeJobDrawing, type DrawingFindings } from "./ai-actions";

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const feet = (ft: string, inch: string) => num(ft) + num(inch) / 12;

/** A per-room add-on (underlayment, quarter round, baseboard, custom…). */
interface WExtra {
  id: string;
  label: string;
  unit: string;
  labor: boolean;
  qty: string;
  cost: string;
  sell: string;
}
let exid = 0;
const mkExtra = (label = "", unit = "sqft", labor = false, cost = ""): WExtra => ({
  id: `e${exid++}`, label, unit, labor, qty: "", cost, sell: "",
});
// Quick-add per-room add-ons by flooring type.
const HARD_EXTRAS: { label: string; unit: string; labor: boolean }[] = [
  { label: "Underlayment / moisture barrier", unit: "sqft", labor: false },
  { label: "Quarter round / shoe molding", unit: "lnft", labor: false },
  { label: "Baseboard remove & reinstall", unit: "lnft", labor: true },
  { label: "Reducer / T-mold", unit: "each", labor: false },
  { label: "Stair nosing", unit: "step", labor: true },
  { label: "Pull & reset toilet", unit: "each", labor: true },
];
const CARPET_EXTRAS: { label: string; unit: string; labor: boolean }[] = [
  { label: "Tackstrip", unit: "lnft", labor: true },
  { label: "Cover / carpet stairs", unit: "step", labor: true },
];

interface WRoom {
  id: string;
  name: string;
  type: string;
  lengthFt: string; lengthIn: string;
  widthFt: string; widthIn: string;
  areaOverride: string; // total sq ft from the multi-area calculator (wins over L×W)
  waste: string; // per-room waste % (blank = the flooring type's default)
  boxSqft: string; // sq ft per carton (hard surface) — drives the carton count
  productId: string | null; productLabel: string;
  manufacturer: string | null; style: string | null; color: string | null;
  matCost: string; matSell: string;
  install: boolean; instCost: string; instSell: string;
  pad: boolean; padCost: string; padSell: string;
  demo: boolean; demoCost: string; demoSell: string; demoNote: string;
  prep: boolean; prepCost: string; prepSell: string; prepNote: string;
  trans: boolean; transQty: string; transCost: string; transSell: string; transNote: string;
  extras: WExtra[];
}
let seq = 0;
const newRoom = (): WRoom => ({
  id: `w${seq++}`, name: "", type: "",
  lengthFt: "", lengthIn: "", widthFt: "", widthIn: "", areaOverride: "",
  waste: "", boxSqft: "",
  productId: null, productLabel: "", manufacturer: null, style: null, color: null,
  matCost: "", matSell: "", install: true, instCost: "", instSell: "",
  pad: true, padCost: "", padSell: "",
  demo: false, demoCost: "", demoSell: "", demoNote: "",
  prep: false, prepCost: "", prepSell: "", prepNote: "",
  trans: false, transQty: "", transCost: "", transSell: "", transNote: "",
  extras: [],
});
const roomWaste = (r: WRoom, fallback: number) => (num(r.waste) > 0 ? num(r.waste) : fallback);
const roomSqft = (r: WRoom) =>
  num(r.areaOverride) > 0
    ? num(r.areaOverride)
    : areaSqft(feet(r.lengthFt, r.lengthIn), feet(r.widthFt, r.widthIn));

interface WAddon {
  label: string; unit: string; labor: boolean; on: boolean;
  qty: string; cost: string; sell: string;
}

/** Material + pad for a room — never any labor on these (order quantity, waste rolled in). */
function roomMatPad(r: WRoom): SmartLine[] {
  const profile = profileFor(r.type);
  if (!profile) return [];
  const sqft = roomSqft(r);
  const isYd = profile.unit === "sqyd";
  const unit = isYd ? "sq yd" : "sq ft";
  // A calculator total has no single cut size; only carry L×W when used directly.
  const usingCalc = num(r.areaOverride) > 0;
  const lenIn = usingCalc ? 0 : feet(r.lengthFt, r.lengthIn) * 12;
  const widIn = usingCalc ? 0 : feet(r.widthFt, r.widthIn) * 12;
  const area = isYd ? sqft / 9 : sqft;
  const waste = roomWaste(r, profile.waste);
  const needed = area * (1 + waste / 100);
  // Hard surface sold by the box: order whole cartons, and note how many.
  const boxSqft = num(r.boxSqft);
  let matQty: number;
  let cartonNote = "";
  if (!isYd && boxSqft > 0 && sqft > 0) {
    const cartons = Math.ceil(needed / boxSqft);
    matQty = Math.round(cartons * boxSqft);
    cartonNote = ` (${cartons} cartons @ ${r2(boxSqft)} sf/box)`;
  } else {
    matQty = Math.ceil(needed);
  }
  const out: SmartLine[] = [];
  out.push({
    room: r.name || null, description: (r.productLabel || profile.label) + cartonNote,
    category: profile.category, measure_unit: profile.unit,
    sqft: null, quantity: matQty > 0 ? matQty : null,
    length_in: lenIn > 0 ? Math.round(lenIn) : null,
    width_in: widIn > 0 ? Math.round(widIn) : null,
    unit, material_rate: num(r.matSell), labor_rate: 0,
    material_cost: num(r.matCost), labor_cost: 0, waste_pct: 0,
    product_id: r.productId, manufacturer: r.manufacturer, style: r.style, color: r.color,
  });
  if (r.pad && profile.category === "carpet" && (num(r.padCost) > 0 || num(r.padSell) > 0)) {
    const padYd = Math.ceil(sqft / 9);
    out.push({
      room: r.name || null, description: "Carpet pad", category: "underlayment",
      measure_unit: "sqyd", sqft: null, quantity: padYd > 0 ? padYd : null,
      length_in: null, width_in: null, unit: "sq yd",
      material_rate: num(r.padSell), labor_rate: 0, material_cost: num(r.padCost),
      labor_cost: 0, waste_pct: 0,
      product_id: null, manufacturer: null, style: null, color: null,
    });
  }
  return out;
}

/** A bundled line (whole job) totaling a per-room item. */
function bundledLine(
  description: string,
  isLabor: boolean,
  category: string,
  unit: string,
  qty: number,
  costSum: number,
  sellSum: number,
): SmartLine {
  const unitCost = qty > 0 ? r2(costSum / qty) : 0;
  const unitSell = qty > 0 ? r2(sellSum / qty) : 0;
  return {
    room: null, description, category, measure_unit: "sqft",
    sqft: null, quantity: r2(qty), length_in: null, width_in: null, unit,
    material_rate: isLabor ? 0 : unitSell, labor_rate: isLabor ? unitSell : 0,
    material_cost: isLabor ? 0 : unitCost, labor_cost: isLabor ? unitCost : 0,
    waste_pct: 0, product_id: null, manufacturer: null, style: null, color: null,
  };
}

/** All estimate lines: materials/pad per room + bundled labor / demo / prep /
 *  transitions (one line each, totals across rooms) + add-ons. */
function jobLines(rooms: WRoom[], addons: WAddon[]): SmartLine[] {
  const out: SmartLine[] = [];
  const laborByCat = new Map<
    string,
    { label: string; unit: string; measureUnit: "sqft" | "sqyd"; area: number; costSum: number; sellSum: number }
  >();
  let demoSqft = 0, demoCost = 0, demoSell = 0;
  let prepSqft = 0, prepCost = 0, prepSell = 0;
  let transQty = 0, transCost = 0, transSell = 0;
  const demoNotes = new Set<string>(), prepNotes = new Set<string>(), transNotes = new Set<string>();
  // Per-room add-ons, bundled by their label (so "Underlayment" across rooms = 1 line).
  const extraBy = new Map<
    string,
    { label: string; unit: string; labor: boolean; qty: number; costSum: number; sellSum: number }
  >();

  for (const r of rooms) {
    out.push(...roomMatPad(r));
    const profile = profileFor(r.type);
    if (!profile) continue;
    const sqft = roomSqft(r);
    const isYd = profile.unit === "sqyd";
    const areaQty = isYd ? sqft / 9 : sqft;

    // Per-room add-ons → bundle by label across rooms.
    for (const x of r.extras) {
      if (!x.label.trim() || num(x.qty) <= 0) continue;
      const q = num(x.qty);
      const key = `${x.label}|${x.unit}|${x.labor}`;
      const e = extraBy.get(key) ?? { label: x.label, unit: x.unit, labor: x.labor, qty: 0, costSum: 0, sellSum: 0 };
      e.qty += q; e.costSum += q * num(x.cost); e.sellSum += q * num(x.sell);
      extraBy.set(key, e);
    }

    // Install — bundled per flooring type.
    if (r.install && (num(r.instCost) > 0 || num(r.instSell) > 0) && areaQty > 0) {
      const e =
        laborByCat.get(profile.category) ?? {
          label: profile.label, unit: isYd ? "sq yd" : "sq ft",
          measureUnit: profile.unit, area: 0, costSum: 0, sellSum: 0,
        };
      e.area += areaQty;
      e.costSum += areaQty * num(r.instCost);
      e.sellSum += areaQty * num(r.instSell);
      laborByCat.set(profile.category, e);
    }
    // Demo (tear-out) & prep — by square foot, bundled across rooms.
    if (r.demo && (num(r.demoCost) > 0 || num(r.demoSell) > 0) && sqft > 0) {
      demoSqft += sqft; demoCost += sqft * num(r.demoCost); demoSell += sqft * num(r.demoSell);
      if (r.demoNote.trim()) demoNotes.add(r.demoNote.trim());
    }
    if (r.prep && (num(r.prepCost) > 0 || num(r.prepSell) > 0) && sqft > 0) {
      prepSqft += sqft; prepCost += sqft * num(r.prepCost); prepSell += sqft * num(r.prepSell);
      if (r.prepNote.trim()) prepNotes.add(r.prepNote.trim());
    }
    // Transitions — by the each, bundled.
    if (r.trans && num(r.transQty) > 0) {
      const q = num(r.transQty);
      transQty += q; transCost += q * num(r.transCost); transSell += q * num(r.transSell);
      if (r.transNote.trim()) transNotes.add(r.transNote.trim());
    }
  }

  for (const e of laborByCat.values()) {
    if (e.area <= 0) continue;
    out.push(bundledLine(`Installation — ${e.label.toLowerCase()}`, true, "labor", e.unit, e.area, e.costSum, e.sellSum));
  }
  const withNote = (base: string, notes: Set<string>) =>
    notes.size ? `${base} — ${[...notes].join(", ")}` : base;
  if (demoSqft > 0) out.push(bundledLine(withNote("Tear-out & haul-away", demoNotes), true, "labor", "sq ft", demoSqft, demoCost, demoSell));
  if (prepSqft > 0) out.push(bundledLine(withNote("Floor prep / leveling", prepNotes), true, "labor", "sq ft", prepSqft, prepCost, prepSell));
  if (transQty > 0) out.push(bundledLine(withNote("Transitions", transNotes), false, "trim", "each", transQty, transCost, transSell));
  for (const e of extraBy.values()) {
    if (e.qty <= 0) continue;
    out.push(bundledLine(e.label, e.labor, e.labor ? "labor" : "other", e.unit, e.qty, e.costSum, e.sellSum));
  }

  out.push(...addonLines(addons));
  return out;
}
function addonLines(addons: WAddon[]): SmartLine[] {
  return addons
    .filter((a) => a.on && a.label.trim())
    .map((a) => ({
      room: null, description: a.label, category: a.labor ? "labor" : "other",
      measure_unit: "sqft", sqft: null, quantity: num(a.qty) > 0 ? num(a.qty) : 1,
      length_in: null, width_in: null, unit: a.unit || "each",
      material_rate: a.labor ? 0 : num(a.sell), labor_rate: a.labor ? num(a.sell) : 0,
      material_cost: a.labor ? 0 : num(a.cost), labor_cost: a.labor ? num(a.cost) : 0,
      waste_pct: 0, product_id: null, manufacturer: null, style: null, color: null,
    }));
}
function lineSell(l: SmartLine): number {
  const q = l.quantity && l.quantity > 0 ? l.quantity : l.measure_unit === "sqyd" ? (l.sqft ?? 0) / 9 : (l.sqft ?? 0);
  return q * l.material_rate * (1 + l.waste_pct / 100) + q * l.labor_rate;
}
function lineCost(l: SmartLine): number {
  const q = l.quantity && l.quantity > 0 ? l.quantity : l.measure_unit === "sqyd" ? (l.sqft ?? 0) / 9 : (l.sqft ?? 0);
  return q * l.material_cost * (1 + l.waste_pct / 100) + q * l.labor_cost;
}

const STEPS = ["Rooms", "Pricing", "Add-ons", "Review"] as const;

export function GuidedWizard({
  customerId, customerName, targetMargin,
}: {
  customerId: string; customerName: string; targetMargin: number;
}) {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [marginGoal, setMarginGoal] = useState(String(targetMargin));
  const [presentation, setPresentation] = useState<"detailed" | "summary">("detailed");
  const [notes, setNotes] = useState("");
  const [rooms, setRooms] = useState<WRoom[]>([newRoom()]);
  const [addons, setAddons] = useState<WAddon[]>(() =>
    STANDARD_ADDONS.map((d) => ({ label: d.label, unit: d.unit, labor: d.labor, on: false, qty: "", cost: "", sell: "" })),
  );
  const [saving, startSave] = useTransition();
  const [findings, setFindings] = useState<DrawingFindings | null>(null);
  const [analyzing, startAnalyze] = useTransition();
  const drawingRef = useRef<HTMLInputElement>(null);

  const goal = num(marginGoal);
  const sellAt = (c: number) => (c > 0 ? r2(priceFromMargin(c, goal)) : 0);

  // Read a job drawing/measure sheet → prefill the rooms + keep findings for the
  // "did you forget?" cross-check.
  const applyFindings = (f: DrawingFindings) => {
    setFindings(f);
    if (f.rooms.length) {
      setRooms(
        f.rooms.map((d) => {
          const room = newRoom();
          room.name = d.name || "";
          room.type = d.type;
          if (d.sqft && d.sqft > 0 && !(d.lengthFt || d.widthFt)) {
            room.areaOverride = String(d.sqft);
          } else {
            room.lengthFt = d.lengthFt ? String(d.lengthFt) : "";
            room.lengthIn = d.lengthIn ? String(d.lengthIn) : "";
            room.widthFt = d.widthFt ? String(d.widthFt) : "";
            room.widthIn = d.widthIn ? String(d.widthIn) : "";
          }
          if (d.materialCost && d.materialCost > 0) {
            room.matCost = String(d.materialCost);
            room.matSell = String(sellAt(d.materialCost));
          }
          room.install = d.install;
          room.pad = d.pad;
          return room;
        }),
      );
    }
    toast.success(`Read ${f.rooms.length} room${f.rooms.length === 1 ? "" : "s"} from the drawing — review them`);
  };

  const onDrawing = (file: File) =>
    startAnalyze(async () => {
      if (file.size > 20 * 1024 * 1024) {
        toast.error("That photo is too large (max 20 MB).");
        return;
      }
      const supabase = createClient();
      const path = `notes/${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage
        .from("documents")
        .upload(path, file, { contentType: file.type || "image/jpeg" });
      if (error) {
        toast.error(`Upload failed: ${error.message}`);
        return;
      }
      const f = await analyzeJobDrawing({ storagePath: path, mime: file.type || "image/jpeg" });
      if (f.error) {
        toast.error(f.error);
        return;
      }
      applyFindings(f);
    });
  const up = (id: string, patch: Partial<WRoom>) =>
    setRooms((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addExtra = (roomId: string, preset?: { label: string; unit: string; labor: boolean; cost?: number }) =>
    setRooms((rs) =>
      rs.map((r) => {
        if (r.id !== roomId) return r;
        const ex = preset ? mkExtra(preset.label, preset.unit, preset.labor) : mkExtra();
        // A price-book item brings its cost — mark it up to the job's margin.
        if (preset?.cost && preset.cost > 0) {
          ex.cost = String(preset.cost);
          ex.sell = String(sellAt(preset.cost));
        }
        // Area add-ons cover the room — prefill the quantity with its area.
        if (ex.unit === "sqft" && roomSqft(r) > 0) ex.qty = String(r2(roomSqft(r)));
        else if (ex.unit === "sqyd" && roomSqft(r) > 0) ex.qty = String(r2(roomSqft(r) / 9));
        return { ...r, extras: [...r.extras, ex] };
      }),
    );
  const updExtra = (roomId: string, exId: string, patch: Partial<WExtra>) =>
    setRooms((rs) =>
      rs.map((r) =>
        r.id === roomId ? { ...r, extras: r.extras.map((x) => (x.id === exId ? { ...x, ...patch } : x)) } : r,
      ),
    );
  const delExtra = (roomId: string, exId: string) =>
    setRooms((rs) =>
      rs.map((r) => (r.id === roomId ? { ...r, extras: r.extras.filter((x) => x.id !== exId) } : r)),
    );
  const setAddon = (i: number, patch: Partial<WAddon>) =>
    setAddons((xs) => xs.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  // Drop a price-book item onto the job-level add-on list, on & priced.
  const addPricedAddon = (it: PriceItem) =>
    setAddons((xs) => {
      const i = xs.findIndex((a) => a.label === it.label);
      if (i >= 0) {
        return xs.map((a, j) =>
          j === i ? { ...a, on: true, unit: it.unit, labor: it.labor, cost: String(it.cost), sell: String(sellAt(it.cost)) } : a,
        );
      }
      return [
        ...xs,
        { label: it.label, unit: it.unit, labor: it.labor, on: true, qty: "", cost: String(it.cost), sell: String(sellAt(it.cost)) },
      ];
    });

  const pickProduct = (id: string, p: Product | null) => {
    if (!p) return up(id, { productId: null, productLabel: "" });
    const r = rooms.find((x) => x.id === id);
    const profile = r ? profileFor(r.type) : null;
    const prodYd = (p.unit || "").toLowerCase().includes("yd");
    const wantYd = profile?.unit === "sqyd";
    const factor = wantYd === prodYd ? 1 : wantYd ? 9 : 1 / 9;
    const cost = r2((p.material_rate || 0) * factor);
    up(id, {
      productId: p.id,
      productLabel: [p.manufacturer, p.name, p.color].filter(Boolean).join(" ") || p.name,
      manufacturer: p.manufacturer, style: p.style, color: p.color,
      matCost: String(cost), matSell: String(sellAt(cost)),
      instSell: p.labor_rate ? String(sellAt(Number(p.labor_rate) || 0)) : "",
      instCost: p.labor_rate ? String(p.labor_rate) : "",
    });
  };

  const allLines = useMemo(() => jobLines(rooms, addons), [rooms, addons]);
  const grand = allLines.reduce((s, l) => s + lineSell(l), 0);
  const cost = allLines.reduce((s, l) => s + lineCost(l), 0);
  const margin = marginPct(grand, cost);

  const readyRooms = rooms.filter((r) => profileFor(r.type) && roomSqft(r) > 0);
  const canNext =
    step === 0 ? readyRooms.length > 0 : true;

  // Smart "don't miss anything" checks — flag the things estimators forget,
  // based on the actual job. Nudges only; the estimator decides.
  const reminders: string[] = (() => {
    const out: string[] = [];
    if (!readyRooms.length) return out;
    const hasCarpet = readyRooms.some((r) => profileFor(r.type)?.category === "carpet");
    const has = (re: RegExp) => allLines.some((l) => re.test(l.description));
    const onAddon = (re: RegExp) => addons.some((a) => a.on && re.test(a.label));
    const covered = (re: RegExp) => has(re) || onAddon(re);
    if (hasCarpet && !has(/pad/i)) out.push("No carpet pad on a carpet job — add it or confirm none is needed.");
    if (!has(/install/i)) out.push("No installation labor — did you add the install price?");
    if (!covered(/tear\s?out|haul|demo/i)) out.push("No tear-out / demo — is the old floor staying?");
    if (!covered(/prep|level|subfloor/i)) out.push("No floor prep / subfloor work — checked the subfloor?");
    if (readyRooms.length > 1 && !covered(/transition|t-?mold|reducer|threshold|metal/i))
      out.push("No transitions/thresholds between rooms.");
    if (hasCarpet && !onAddon(/stair/i)) out.push("Any stairs? No stair labor added.");
    if (!onAddon(/furniture|appliance/i)) out.push("Furniture or appliances to move?");
    if (!onAddon(/baseboard|quarter|shoe/i)) out.push("Baseboard / quarter round?");

    // Cross-check the DRAWING: anything it mentioned that isn't in the estimate.
    for (const a of findings?.addons ?? []) {
      const words = a.label.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
      if (!words.length) continue;
      const inLines = allLines.some((l) =>
        words.some((w) => l.description.toLowerCase().includes(w)),
      );
      const inAddons = addons.some(
        (ad) => ad.on && words.some((w) => ad.label.toLowerCase().includes(w)),
      );
      if (!inLines && !inAddons) out.push(`The drawing shows "${a.label}" — did you add it?`);
    }
    return out;
  })();

  const startOver = () => {
    if (!window.confirm("Clear this estimate and start over?")) return;
    setTitle("");
    setMarginGoal(String(targetMargin));
    setPresentation("detailed");
    setNotes("");
    setFindings(null);
    setRooms([newRoom()]);
    setAddons(
      STANDARD_ADDONS.map((d) => ({
        label: d.label, unit: d.unit, labor: d.labor, on: false, qty: "", cost: "", sell: "",
      })),
    );
    setStep(0);
    toast.success("Cleared — fresh estimate");
  };

  const save = (opts: { print?: boolean; send?: boolean } = {}) =>
    startSave(async () => {
      const lines = jobLines(rooms, addons).filter((l) => l.description.trim());
      if (!lines.length) {
        toast.error("Add at least one room with a size first.");
        return;
      }
      const res = await createSmartEstimate({
        customerId, title, taxRate: 8, lines, presentation,
        jobDescription: notes.trim() || undefined,
        print: opts.print, send: opts.send,
      });
      if (res?.error) toast.error(res.error);
    });

  return (
    <div className="space-y-4">
      {/* Stepper */}
      <div className="flex items-center gap-1.5 text-xs">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => i < step && setStep(i)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
              i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-primary/10 text-primary" : "text-muted-foreground",
            )}
          >
            <span className="flex size-4 items-center justify-center rounded-full border text-[10px]">
              {i < step ? <Check className="size-3" /> : i + 1}
            </span>
            {s}
          </button>
        ))}
      </div>

      {/* STEP 1 — Rooms */}
      {step === 0 ? (
        <div className="space-y-3">
          {/* Start from a photo of the measure sheet / drawing */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="min-w-0 text-sm">
              <div className="flex items-center gap-1.5 font-medium">
                <Camera className="size-4 text-primary" /> Start from your drawing
              </div>
              <div className="text-xs text-muted-foreground">
                Snap your measure sheet — it reads the rooms &amp; sizes, then flags
                anything on the drawing you might miss.
              </div>
            </div>
            <Button type="button" variant="outline" onClick={() => drawingRef.current?.click()} disabled={analyzing}>
              <Camera className="size-4" /> {analyzing ? "Reading…" : "Upload drawing"}
            </Button>
            <input
              ref={drawingRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onDrawing(f);
                e.target.value = "";
              }}
            />
          </div>

          <p className="text-sm text-muted-foreground">
            Add each room and its size — we&apos;ll price them next.
          </p>
          {rooms.map((r, idx) => {
            const profile = profileFor(r.type);
            const sqft = roomSqft(r);
            return (
              <Card key={r.id} className="border-primary/20">
                <CardContent className="space-y-2.5 p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{idx + 1}</span>
                    <Input value={r.name} onChange={(e) => up(r.id, { name: e.target.value })} placeholder="Room (e.g. Living room)" className="h-8 flex-1" />
                    {rooms.length > 1 ? (
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setRooms((rs) => rs.filter((x) => x.id !== r.id))}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {FLOORING_TYPES.map((t) => {
                      const p = profileFor(t)!;
                      return (
                        <button key={t} type="button" onClick={() => up(r.id, { type: t })}
                          className={cn("rounded-md border px-2.5 py-1 text-xs", r.type === t ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                  {profile ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <FtIn label="Length" ft={r.lengthFt} inch={r.lengthIn} onFt={(v) => up(r.id, { lengthFt: v })} onIn={(v) => up(r.id, { lengthIn: v })} disabled={num(r.areaOverride) > 0} />
                      <span className="pb-2 text-muted-foreground">×</span>
                      <FtIn label="Width" ft={r.widthFt} inch={r.widthIn} onFt={(v) => up(r.id, { widthFt: v })} onIn={(v) => up(r.id, { widthIn: v })} disabled={num(r.areaOverride) > 0} />
                      <div className="pb-1 flex items-center gap-2">
                        <AreaCalculator
                          triggerLabel={num(r.areaOverride) > 0 ? "Edit areas" : "Add up areas"}
                          title={`Square footage — ${r.name || "this room"}`}
                          initialLabel={r.name}
                          onApply={(area) => up(r.id, { areaOverride: String(area) })}
                        />
                        {num(r.areaOverride) > 0 ? (
                          <button type="button" onClick={() => up(r.id, { areaOverride: "" })} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                            use L×W
                          </button>
                        ) : null}
                      </div>
                      <span className="pb-1.5 text-sm">
                        <Ruler className="mr-1 inline size-3.5 text-muted-foreground" />
                        <span className="font-medium">{sqft}</span> sq ft
                        {num(r.areaOverride) > 0 ? <span className="ml-1 text-xs text-primary">· added up</span> : null}
                      </span>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
          <Button type="button" variant="outline" onClick={() => setRooms((rs) => [...rs, newRoom()])}>
            <Plus className="size-4" /> Add another room
          </Button>
        </div>
      ) : null}

      {/* STEP 2 — Pricing per room */}
      {step === 1 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Set the cost — the sell price fills in at your margin.</p>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">Margin</span>
              <Input value={marginGoal} onChange={(e) => setMarginGoal(e.target.value)} inputMode="decimal" className="h-8 w-16" />%
            </div>
          </div>
          {readyRooms.map((r) => {
            const profile = profileFor(r.type)!;
            const unitLabel = profile.unit === "sqyd" ? "yd" : "ft";
            return (
              <Card key={r.id} className="border-primary/20">
                <CardContent className="space-y-2 p-3">
                  <div className="text-sm font-medium">{r.name || profile.label} · {roomSqft(r)} sf</div>
                  <ProductPicker value={r.productId ?? ""} initialLabel={r.productLabel} onPick={(p) => pickProduct(r.id, p)} onCreated={(p) => pickProduct(r.id, p)} />
                  <CostSell label={`Material /${unitLabel}`} cost={r.matCost} sell={r.matSell}
                    onCost={(v) => up(r.id, { matCost: v, ...(num(v) > 0 ? { matSell: String(sellAt(num(v))) } : {}) })}
                    onSell={(v) => up(r.id, { matSell: v })} />
                  {/* Waste % and (hard surface) cartons from sq ft per box */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>Waste</span>
                    <Input value={r.waste} onChange={(e) => up(r.id, { waste: e.target.value })} inputMode="decimal" placeholder={String(profile.waste)} className="h-7 w-14" />%
                    {profile.unit !== "sqyd" ? (
                      <>
                        <span>· Sq ft / box</span>
                        <Input value={r.boxSqft} onChange={(e) => up(r.id, { boxSqft: e.target.value })} inputMode="decimal" placeholder="e.g. 23.8" className="h-7 w-16" />
                        {num(r.boxSqft) > 0 && roomSqft(r) > 0 ? (
                          <span className="font-semibold text-primary">
                            = {Math.ceil((roomSqft(r) * (1 + roomWaste(r, profile.waste) / 100)) / num(r.boxSqft))} cartons
                          </span>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                  <Toggle on={r.install} onToggle={() => up(r.id, { install: !r.install })} label="Install labor">
                    <CostSell compact label="Install" cost={r.instCost} sell={r.instSell}
                      onCost={(v) => up(r.id, { instCost: v, ...(num(v) > 0 ? { instSell: String(sellAt(num(v))) } : {}) })}
                      onSell={(v) => up(r.id, { instSell: v })} />
                  </Toggle>
                  {profile.category === "carpet" ? (
                    <Toggle on={r.pad} onToggle={() => up(r.id, { pad: !r.pad })} label="Carpet pad">
                      <CostSell compact label="Pad" cost={r.padCost} sell={r.padSell}
                        onCost={(v) => up(r.id, { padCost: v, ...(num(v) > 0 ? { padSell: String(sellAt(num(v))) } : {}) })}
                        onSell={(v) => up(r.id, { padSell: v })} />
                    </Toggle>
                  ) : null}

                  {/* Per-room prompts so nothing's missed for THIS room */}
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    This room also
                  </div>
                  <Toggle on={r.demo} onToggle={() => up(r.id, { demo: !r.demo })} label="Tear out / demo (existing floor)">
                    <CostSell compact label="Demo /sf" cost={r.demoCost} sell={r.demoSell}
                      onCost={(v) => up(r.id, { demoCost: v, ...(num(v) > 0 ? { demoSell: String(sellAt(num(v))) } : {}) })}
                      onSell={(v) => up(r.id, { demoSell: v })} />
                    <Input value={r.demoNote} onChange={(e) => up(r.id, { demoNote: e.target.value })}
                      placeholder="Type of demo (e.g. glue-down VCT, carpet & pad) — shows on the work order" className="mt-1 h-7 text-xs" />
                  </Toggle>
                  <Toggle on={r.prep} onToggle={() => up(r.id, { prep: !r.prep })} label="Floor prep / leveling">
                    <CostSell compact label="Prep /sf" cost={r.prepCost} sell={r.prepSell}
                      onCost={(v) => up(r.id, { prepCost: v, ...(num(v) > 0 ? { prepSell: String(sellAt(num(v))) } : {}) })}
                      onSell={(v) => up(r.id, { prepSell: v })} />
                    <Input value={r.prepNote} onChange={(e) => up(r.id, { prepNote: e.target.value })}
                      placeholder="Prep notes (e.g. skim coat, patch low spots) — shows on the work order" className="mt-1 h-7 text-xs" />
                  </Toggle>
                  <Toggle on={r.trans} onToggle={() => up(r.id, { trans: !r.trans })} label="Transitions / thresholds">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Input value={r.transQty} onChange={(e) => up(r.id, { transQty: e.target.value })} inputMode="decimal" placeholder="qty" className="h-7 w-14" />
                      <span>each</span>
                      $<Input value={r.transCost} onChange={(e) => up(r.id, { transCost: e.target.value, ...(num(e.target.value) > 0 ? { transSell: String(sellAt(num(e.target.value))) } : {}) })} inputMode="decimal" placeholder="cost" className="h-7 w-16" />
                      →$<Input value={r.transSell} onChange={(e) => up(r.id, { transSell: e.target.value })} inputMode="decimal" placeholder="sell" className="h-7 w-16" />
                    </div>
                    <Input value={r.transNote} onChange={(e) => up(r.id, { transNote: e.target.value })}
                      placeholder="Type (e.g. carpet→tile T-mold, flush threshold) — shows on the work order" className="mt-1 h-7 text-xs" />
                  </Toggle>

                  {/* Any other add-on for THIS room — quick-add the common ones */}
                  <div className="rounded-md border p-2">
                    <div className="flex flex-wrap items-center gap-1 text-[11px]">
                      <span className="font-medium uppercase tracking-wide text-muted-foreground">Add-ons</span>
                      {(profile.category === "carpet" ? CARPET_EXTRAS : HARD_EXTRAS).map((p) => (
                        <button key={p.label} type="button" onClick={() => addExtra(r.id, p)}
                          className="rounded-full border px-2 py-0.5 hover:bg-muted">
                          + {p.label.split(" / ")[0]}
                        </button>
                      ))}
                      <button type="button" onClick={() => addExtra(r.id)} className="rounded-full border px-2 py-0.5 hover:bg-muted">+ Custom</button>
                      <PriceBookPicker triggerSize="sm" triggerVariant="ghost" triggerClassName="h-6 px-2 text-[11px]" onPick={(it) => addExtra(r.id, it)} />
                    </div>
                    {r.extras.map((x) => (
                      <div key={x.id} className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        <Input value={x.label} onChange={(e) => updExtra(r.id, x.id, { label: e.target.value })} placeholder="Add-on name" className="h-7 min-w-32 flex-1" />
                        <Input value={x.qty} onChange={(e) => updExtra(r.id, x.id, { qty: e.target.value })} inputMode="decimal" placeholder="qty" className="h-7 w-14" />
                        <select value={x.unit} onChange={(e) => updExtra(r.id, x.id, { unit: e.target.value })} className="h-7 rounded-md border border-input bg-transparent px-1 text-xs">
                          <option value="sqft">sq ft</option>
                          <option value="sqyd">sq yd</option>
                          <option value="lnft">ln ft</option>
                          <option value="each">each</option>
                          <option value="step">step</option>
                        </select>
                        $<Input value={x.cost} onChange={(e) => updExtra(r.id, x.id, { cost: e.target.value, ...(num(e.target.value) > 0 ? { sell: String(sellAt(num(e.target.value))) } : {}) })} inputMode="decimal" placeholder="cost" className="h-7 w-14" />
                        →$<Input value={x.sell} onChange={(e) => updExtra(r.id, x.id, { sell: e.target.value })} inputMode="decimal" placeholder="sell" className="h-7 w-14" />
                        <label className="flex items-center gap-1"><input type="checkbox" checked={x.labor} onChange={(e) => updExtra(r.id, x.id, { labor: e.target.checked })} className="size-3.5 rounded border-input" />labor</label>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove add-on" onClick={() => delExtra(r.id, x.id)}>
                          <Trash2 className="size-3.5 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      {/* STEP 3 — Add-ons checklist */}
      {step === 2 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Check everything this job needs so nothing&apos;s missed — tear-out, prep, stairs, transitions, metals…
            </p>
            <PriceBookPicker triggerLabel="Add from price list" onPick={addPricedAddon} />
          </div>
          {(["labor", "material"] as const).map((kind) => (
            <div key={kind}>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {kind === "labor" ? "Labor" : "Materials & metals"}
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {addons.map((a, i) => (a.labor === (kind === "labor") ? (
                  <div key={a.label} className="rounded-md border px-2 py-1.5 text-sm">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={a.on} onChange={(e) => setAddon(i, { on: e.target.checked })} className="size-4 rounded border-input" />
                      <span className={cn(!a.on && "text-muted-foreground")}>{a.label}</span>
                    </label>
                    {a.on ? (
                      <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Input value={a.qty} onChange={(e) => setAddon(i, { qty: e.target.value })} inputMode="decimal" placeholder="qty" className="h-7 w-14" />
                        <span>{a.unit}</span>
                        $<Input value={a.cost} onChange={(e) => setAddon(i, { cost: e.target.value, ...(num(e.target.value) > 0 ? { sell: String(sellAt(num(e.target.value))) } : {}) })} inputMode="decimal" placeholder="cost" className="h-7 w-16" />
                        →$<Input value={a.sell} onChange={(e) => setAddon(i, { sell: e.target.value })} inputMode="decimal" placeholder="sell" className="h-7 w-16" />
                      </div>
                    ) : null}
                  </div>
                ) : null))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* STEP 4 — Review */}
      {step === 3 ? (
        <div className="space-y-3">
          {/* Don't-miss checklist — smart nudges from the actual job */}
          {reminders.length ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <div className="mb-1 text-sm font-semibold text-amber-700">
                Before you finish — did you cover these?
              </div>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-800">
                {reminders.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="mt-2 text-xs font-medium text-amber-700 underline-offset-2 hover:underline"
              >
                ← Back to add-ons to handle these
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2 text-sm font-medium text-emerald-700">
              ✓ Looks complete — pad, install, tear-out, prep and transitions are accounted for.
            </div>
          )}

          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Flooring for ${customerName}`} className="max-w-md" />

          {/* Job conditions / notes — goes on the work order so nothing's lost */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Job notes / conditions (shown on the work order)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="e.g. existing floor is glue-down VCT · 2 steps to front door · pets (dog) · move fridge & stove · customer prefers weekday start · parking in rear"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <Card>
            <CardContent className="divide-y p-0 text-sm">
              {allLines.map((l, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-1.5">
                  <span className="min-w-0 truncate">{l.room ? `${l.room} — ` : ""}{l.description}</span>
                  <span className="shrink-0 font-medium">{formatMoney(lineSell(l))}</span>
                </div>
              ))}
              {!allLines.length ? <div className="px-3 py-4 text-muted-foreground">Nothing added yet.</div> : null}
            </CardContent>
          </Card>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
            <div className="flex items-center gap-6">
              <div><div className="text-xs text-muted-foreground">Total</div><div className="text-xl font-bold">{formatMoney(grand)}</div></div>
              <div><div className="text-xs text-muted-foreground">Margin</div><div className={cn("text-lg font-semibold", margin < goal - 0.5 && grand > 0 && "text-amber-600")}>{Math.round(margin)}%</div></div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Customer sees</div>
                <div className="flex gap-1">
                  {([["detailed", "Itemized"], ["summary", "Lump sum"]] as ["detailed" | "summary", string][]).map(([v, lbl]) => (
                    <button key={v} type="button" onClick={() => setPresentation(v)}
                      className={cn("rounded-md border px-2.5 py-1 text-xs", presentation === v ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{lbl}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" onClick={() => save({ print: true })} disabled={saving}><Printer className="size-4" /> Print</Button>
              <Button type="button" variant="outline" onClick={() => save()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
              <Button type="button" onClick={() => save({ send: true })} disabled={saving}><Send className="size-4" /> Save &amp; send</Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Nav */}
      <div className="flex items-center justify-between border-t pt-3">
        <Button type="button" variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={startOver} className="text-muted-foreground">
            <RotateCcw className="size-4" /> Start over
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
              Next: {STEPS[step + 1]} <ArrowRight className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FtIn({ label, ft, inch, onFt, onIn, disabled }: { label: string; ft: string; inch: string; onFt: (v: string) => void; onIn: (v: string) => void; disabled?: boolean }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <div className="flex items-end gap-1">
        <Input value={ft} onChange={(e) => onFt(e.target.value)} inputMode="decimal" placeholder="ft" disabled={disabled} className="h-9 w-14" /><span className="pb-2 text-xs text-muted-foreground">ft</span>
        <Input value={inch} onChange={(e) => onIn(e.target.value)} inputMode="decimal" placeholder="in" disabled={disabled} className="h-9 w-12" /><span className="pb-2 text-xs text-muted-foreground">in</span>
      </div>
    </div>
  );
}
function CostSell({ label, cost, sell, onCost, onSell, compact }: { label: string; cost: string; sell: string; onCost: (v: string) => void; onSell: (v: string) => void; compact?: boolean }) {
  return (
    <div className={compact ? "" : "space-y-1"}>
      {!compact ? <label className="block text-[11px] text-muted-foreground">{label}</label> : null}
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">$</span>
        <Input value={cost} onChange={(e) => onCost(e.target.value)} inputMode="decimal" placeholder="cost" className="h-8" />
        <span className="text-xs text-muted-foreground">→ $</span>
        <Input value={sell} onChange={(e) => onSell(e.target.value)} inputMode="decimal" placeholder="sell" className="h-8" />
      </div>
    </div>
  );
}
function Toggle({ on, onToggle, label, children }: { on: boolean; onToggle: () => void; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border p-2">
      <label className="flex items-center gap-2 text-xs font-medium">
        <input type="checkbox" checked={on} onChange={onToggle} className="size-4 rounded border-input" />{label}
      </label>
      {on ? <div className="mt-1.5">{children}</div> : null}
    </div>
  );
}
