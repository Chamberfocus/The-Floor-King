"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Copy, Ruler, Layers, Sparkles } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { priceFromMargin, marginPct } from "@/lib/estimate-calc";
import {
  FLOORING_TYPES,
  profileFor,
  areaSqft,
  companionQty,
  type FlooringProfile,
  type Companion,
} from "@/lib/flooring-profiles";
import { PRODUCT_CATEGORY_LABELS, type Product } from "@/lib/types";
import { ProductPicker } from "./product-picker";
import { AreaCalculator } from "@/components/area-calculator";
import { createSmartEstimate, type SmartLine } from "./smart-actions";

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** Convert a catalog product's per-unit rate into the companion's billing unit. */
function compRate(
  productUnit: string | null,
  compUnit: string,
  rate: number,
): number {
  const isYd = (productUnit || "").toLowerCase().includes("yd");
  if (compUnit === "sqyd" && !isYd) return rate * 9; // per sq ft → per sq yd
  if (compUnit === "sqft" && isYd) return rate / 9; // per sq yd → per sq ft
  return rate; // same family, or lnft / each — use as-is
}

interface CompState {
  on: boolean;
  rate: string; // sell per unit
  cost: string; // our cost per unit
  productId: string | null;
  productLabel: string;
  choice: string; // for info companions (e.g. tackstrip subfloor: wood/concrete)
}
interface Room {
  id: string;
  name: string;
  type: string; // category
  length: string;
  width: string;
  // Set by the area calculator (multi-area rooms); overrides L×W when present.
  areaOverride: string;
  perimeterOverride: string;
  productId: string | null;
  productLabel: string;
  manufacturer: string | null;
  style: string | null;
  color: string | null;
  materialRate: string; // sell per unit
  materialCost: string; // our cost per unit
  laborRate: string; // labor sell per unit
  laborCost: string; // our labor cost per unit (what we pay)
  waste: string;
  marginInput: string; // per-room margin % to re-price from cost
  notes: string; // crew/work-order notes for this room
  comps: Record<string, CompState>;
}

let seq = 0;
const newRoom = (): Room => ({
  id: `r${seq++}`,
  name: "",
  type: "",
  length: "",
  width: "",
  areaOverride: "",
  perimeterOverride: "",
  productId: null,
  productLabel: "",
  manufacturer: null,
  style: null,
  color: null,
  materialRate: "",
  materialCost: "",
  laborRate: "",
  laborCost: "",
  waste: "",
  marginInput: "",
  notes: "",
  comps: {},
});

/** A room's square footage — from the area calculator if used, else L×W. */
function roomSqft(r: Room): number {
  return num(r.areaOverride) > 0
    ? num(r.areaOverride)
    : areaSqft(num(r.length), num(r.width));
}
/** A room's perimeter (lnft) — from the calculator if used, else L×W. */
function roomPerimeter(r: Room): number {
  return num(r.perimeterOverride) > 0
    ? num(r.perimeterOverride)
    : 2 * (num(r.length) + num(r.width));
}

/** Build the line items a room produces (main + companions) — preview & save. */
function roomLines(r: Room): SmartLine[] {
  const profile = profileFor(r.type);
  if (!profile) return [];
  const sqft = roomSqft(r);
  const perimeter = roomPerimeter(r);
  const out: SmartLine[] = [];

  const unit = profile.unit === "sqyd" ? "sq yd" : "sq ft";
  // Material line (the carpet/flooring itself) — no labor on it.
  out.push({
    room: r.name || null,
    description: r.productLabel || profile.label,
    category: profile.category,
    measure_unit: profile.unit,
    sqft: sqft > 0 ? sqft : null,
    quantity: null,
    unit,
    material_rate: num(r.materialRate),
    labor_rate: 0,
    material_cost: num(r.materialCost),
    labor_cost: 0,
    waste_pct: num(r.waste) || profile.waste,
    product_id: r.productId,
    manufacturer: r.manufacturer,
    style: r.style,
    color: r.color,
  });

  // Installation labor as its OWN line, separate from the cost of the material.
  if (num(r.laborRate) > 0 || num(r.laborCost) > 0) {
    out.push({
      room: r.name || null,
      description: `${profile.label} installation`,
      category: "labor",
      measure_unit: profile.unit,
      sqft: sqft > 0 ? sqft : null,
      quantity: null,
      unit,
      material_rate: 0,
      labor_rate: num(r.laborRate),
      material_cost: 0,
      labor_cost: num(r.laborCost),
      waste_pct: 0,
      product_id: null,
      manufacturer: null,
      style: null,
      color: null,
    });
  }

  // Companion lines (the ones turned on). Roll goods (carpet pad) are handled
  // at the JOB level — see rollGoodsLines — so the quantity is figured off the
  // whole job's yardage, not rounded up to full rolls room-by-room.
  for (const c of profile.companions) {
    if (c.rollUnits && c.rollUnits > 0) continue;
    const st = r.comps[c.key];
    if (!st?.on) continue;
    const qty = companionQty(c, sqft, perimeter);

    // Info companion (tackstrip): no price — just flags the need + subfloor type
    // for the installers.
    if (c.info) {
      out.push({
        room: r.name || null,
        description: st.choice ? `${c.label} — ${st.choice}` : c.label,
        category: c.category,
        measure_unit: c.unit === "sqyd" ? "sqyd" : "sqft",
        sqft: null,
        quantity: qty > 0 ? qty : null,
        unit: c.unit,
        material_rate: 0,
        labor_rate: 0,
        material_cost: 0,
        labor_cost: 0,
        waste_pct: 0,
        product_id: null,
        manufacturer: null,
        style: null,
        color: null,
      });
      continue;
    }

    const rate = num(st.rate);
    out.push({
      room: r.name || null,
      description: st.productLabel ? `${c.label} — ${st.productLabel}` : c.label,
      category: c.category,
      measure_unit: c.unit === "sqyd" ? "sqyd" : "sqft",
      sqft: c.sizeBy === "area" ? (sqft > 0 ? sqft : null) : null,
      quantity: qty > 0 ? qty : null,
      unit: c.unit,
      material_rate: c.labor ? 0 : rate,
      labor_rate: c.labor ? rate : 0,
      material_cost: c.labor ? 0 : num(st.cost),
      labor_cost: c.labor ? num(st.cost) : 0,
      waste_pct: 0,
      product_id: c.labor ? null : st.productId,
      manufacturer: null,
      style: null,
      color: null,
    });
  }
  return out;
}

/** Roll goods (e.g. carpet pad) — companions that come in full rolls. */
const ROLL_COMPANIONS: Companion[] = (() => {
  const seen = new Set<string>();
  const out: Companion[] = [];
  for (const t of FLOORING_TYPES) {
    const p = profileFor(t);
    if (!p) continue;
    for (const c of p.companions) {
      if (c.rollUnits && c.rollUnits > 0 && !seen.has(c.key)) {
        seen.add(c.key);
        out.push(c);
      }
    }
  }
  return out;
})();

/** Total area (in the companion's unit) across every room whose floor uses it. */
function rollGoodsArea(rooms: Room[], comp: Companion): number {
  let total = 0;
  for (const r of rooms) {
    const p = profileFor(r.type);
    if (!p || !p.companions.some((c) => c.key === comp.key)) continue;
    const sqft = roomSqft(r);
    if (sqft <= 0) continue;
    total += comp.unit === "sqyd" ? sqft / 9 : sqft;
  }
  return Math.round(total * 100) / 100;
}

/** Whole rolls for a roll-goods total (rounds the JOB total up, once). */
function rollGoodsRolls(comp: Companion, total: number): number {
  if (!comp.rollUnits || comp.rollUnits <= 0 || total <= 0) return 0;
  return Math.ceil(total / comp.rollUnits);
}

/**
 * Job-level roll-goods lines (carpet pad): the quantity is the WHOLE job's
 * yardage rounded up to full rolls once — not summed room-by-room.
 */
function rollGoodsLines(
  rooms: Room[],
  rollComps: Record<string, CompState>,
): SmartLine[] {
  const out: SmartLine[] = [];
  for (const c of ROLL_COMPANIONS) {
    const st = rollComps[c.key];
    if (!st?.on) continue;
    const total = rollGoodsArea(rooms, c);
    const rolls = rollGoodsRolls(c, total);
    if (rolls <= 0) continue;
    const qty = rolls * (c.rollUnits ?? 1);
    out.push({
      room: null,
      description: st.productLabel ? `${c.label} — ${st.productLabel}` : c.label,
      category: c.category,
      measure_unit: c.unit === "sqyd" ? "sqyd" : "sqft",
      sqft: null,
      quantity: qty,
      unit: c.unit,
      material_rate: num(st.rate),
      labor_rate: 0,
      material_cost: num(st.cost),
      labor_cost: 0,
      waste_pct: 0,
      product_id: st.productId,
      manufacturer: null,
      style: null,
      color: null,
    });
  }
  return out;
}

/** A job-wide extra you add after the rooms (stairs, prep, furniture, etc.). */
type AddonGroup = "carpet" | "hard" | "custom";
interface Addon {
  id: string;
  label: string;
  unit: string;
  labor: boolean;
  group: AddonGroup;
  on: boolean;
  qty: string;
  cost: string;
  sell: string;
  custom: boolean;
  choices?: string[]; // e.g. metal color
  choice: string;
}
type AddonDef = { label: string; unit: string; labor: boolean; choices?: string[] };
const METAL_COLORS = ["Silver", "Titanium", "Gold"];
// Two run-through checklists so nothing's forgotten — the builder shows whichever
// matches the flooring in the job (both for a mixed job).
const CARPET_ADDONS: AddonDef[] = [
  { label: "Tear out & haul away old carpet & pad", unit: "sqft", labor: true },
  { label: "Tackstrip — wood subfloor", unit: "lnft", labor: true },
  { label: "Tackstrip — concrete (glue / concrete nail)", unit: "lnft", labor: true },
  { label: "Carpet / cover stairs", unit: "step", labor: true },
  { label: "Move furniture", unit: "room", labor: true },
  { label: "Disconnect / move appliances", unit: "each", labor: true },
  { label: "Door shaving", unit: "each", labor: true },
  { label: "Floor prep / leveling", unit: "sqft", labor: true },
  { label: "Subfloor repair / replace", unit: "sqft", labor: true },
  { label: "Flat metal", unit: "each", labor: false, choices: METAL_COLORS },
  { label: "Gripper metal", unit: "each", labor: false, choices: METAL_COLORS },
  { label: "Transition strips (carpet to hard)", unit: "each", labor: false },
  { label: "Place on curb", unit: "each", labor: true },
  { label: "Dumpster / disposal fee", unit: "each", labor: false },
];
const HARD_ADDONS: AddonDef[] = [
  { label: "Tear out & haul away old flooring", unit: "sqft", labor: true },
  { label: "Floor prep / self-leveling / skim coat", unit: "sqft", labor: true },
  { label: "Subfloor repair / replace", unit: "sqft", labor: true },
  { label: "Moisture barrier / underlayment", unit: "sqft", labor: false },
  { label: "Pull & reset toilet", unit: "each", labor: true },
  { label: "Disconnect / move appliances", unit: "each", labor: true },
  { label: "Move furniture", unit: "room", labor: true },
  { label: "Baseboard remove & reinstall", unit: "lnft", labor: true },
  { label: "Quarter round / shoe molding", unit: "lnft", labor: false },
  { label: "Flat metal", unit: "each", labor: false, choices: METAL_COLORS },
  { label: "Gripper metal", unit: "each", labor: false, choices: METAL_COLORS },
  { label: "Transition strips / thresholds", unit: "each", labor: false },
  { label: "Door shaving", unit: "each", labor: true },
  { label: "Stair nosing / cap stairs", unit: "step", labor: true },
  { label: "Grout sealing (tile)", unit: "sqft", labor: true },
  { label: "Place on curb", unit: "each", labor: true },
  { label: "Dumpster / disposal fee", unit: "each", labor: false },
];
let addonSeq = 0;
const mkAddon = (d: AddonDef, group: AddonGroup): Addon => ({
  id: `x${addonSeq++}`,
  label: d.label,
  unit: d.unit,
  labor: d.labor,
  group,
  on: false,
  qty: "",
  cost: "",
  sell: "",
  custom: false,
  choices: d.choices,
  choice: d.choices?.[0] ?? "",
});
const initialAddons = (): Addon[] => [
  ...CARPET_ADDONS.map((d) => mkAddon(d, "carpet")),
  ...HARD_ADDONS.map((d) => mkAddon(d, "hard")),
];
const newCustomAddon = (): Addon => ({
  id: `x${addonSeq++}`,
  label: "",
  unit: "each",
  labor: false,
  group: "custom",
  on: true,
  qty: "",
  cost: "",
  sell: "",
  custom: true,
  choice: "",
});
function addonLines(addons: Addon[]): SmartLine[] {
  const out: SmartLine[] = [];
  for (const a of addons) {
    if (!a.on || !a.label.trim()) continue;
    const qty = num(a.qty) || 1;
    const desc =
      a.choices && a.choice ? `${a.label.trim()} — ${a.choice}` : a.label.trim();
    out.push({
      room: null,
      description: desc,
      category: a.labor ? "labor" : "other",
      measure_unit: "sqft",
      sqft: null,
      quantity: qty,
      unit: a.unit || "each",
      material_rate: a.labor ? 0 : num(a.sell),
      labor_rate: a.labor ? num(a.sell) : 0,
      material_cost: a.labor ? 0 : num(a.cost),
      labor_cost: a.labor ? num(a.cost) : 0,
      waste_pct: 0,
      product_id: null,
      manufacturer: null,
      style: null,
      color: null,
    });
  }
  return out;
}

function lineQty(l: SmartLine): number {
  return l.quantity && l.quantity > 0
    ? l.quantity
    : l.measure_unit === "sqyd"
      ? (l.sqft ?? 0) / 9
      : (l.sqft ?? 0);
}
function lineSell(l: SmartLine): number {
  const qty =
    l.quantity && l.quantity > 0
      ? l.quantity
      : l.measure_unit === "sqyd"
        ? (l.sqft ?? 0) / 9
        : (l.sqft ?? 0);
  const mat = qty * l.material_rate * (1 + l.waste_pct / 100);
  const lab = qty * l.labor_rate;
  return mat + lab;
}
function lineCost(l: SmartLine): number {
  const qty = lineQty(l);
  // Material cost carries waste (you buy extra); labor cost is on actual area.
  return qty * l.material_cost * (1 + l.waste_pct / 100) + qty * l.labor_cost;
}
/** Split a line into its material vs labor cost & sell (for the cost check). */
function lineSplit(l: SmartLine): {
  matCost: number;
  matSell: number;
  labCost: number;
  labSell: number;
} {
  const qty = lineQty(l);
  const w = 1 + l.waste_pct / 100;
  return {
    matCost: qty * l.material_cost * w,
    matSell: qty * l.material_rate * w,
    labCost: qty * l.labor_cost,
    labSell: qty * l.labor_rate,
  };
}

export function SmartBuilder({
  customerId,
  customerName,
  targetMargin,
}: {
  customerId: string;
  customerName: string;
  targetMargin: number;
}) {
  const [title, setTitle] = useState("");
  const [rooms, setRooms] = useState<Room[]>([newRoom()]);
  const [addons, setAddons] = useState<Addon[]>(initialAddons);
  const setAddon = (id: string, patch: Partial<Addon>) =>
    setAddons((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const [marginGoal, setMarginGoal] = useState(String(targetMargin));
  const [saving, startSave] = useTransition();
  // Job-level roll goods (carpet pad): quantity is figured off the whole job.
  const [rollComps, setRollComps] = useState<Record<string, CompState>>(() => {
    const init: Record<string, CompState> = {};
    for (const c of ROLL_COMPANIONS)
      init[c.key] = {
        on: c.defaultOn,
        rate: "",
        cost: "",
        productId: null,
        productLabel: "",
        choice: "",
      };
    return init;
  });

  const setRoll = (key: string, patch: Partial<CompState>) =>
    setRollComps((rc) => ({ ...rc, [key]: { ...rc[key], ...patch } }));

  // Margin helpers: turn a cost into a sell price at margin m.
  const sellAt = (cost: number, m: number) =>
    cost > 0 ? Math.round(priceFromMargin(cost, m) * 100) / 100 : 0;
  const repriceComps = (comps: Record<string, CompState>, m: number) =>
    Object.fromEntries(
      Object.entries(comps).map(([k, c]) => [
        k,
        num(c.cost) > 0 ? { ...c, rate: String(sellAt(num(c.cost), m)) } : c,
      ]),
    );
  // Re-price one room's material + labor + companion sells from their costs.
  const applyRoomMargin = (roomId: string, m: number) =>
    setRooms((rs) =>
      rs.map((r) =>
        r.id === roomId
          ? {
              ...r,
              materialRate: num(r.materialCost) > 0 ? String(sellAt(num(r.materialCost), m)) : r.materialRate,
              laborRate: num(r.laborCost) > 0 ? String(sellAt(num(r.laborCost), m)) : r.laborRate,
              comps: repriceComps(r.comps, m),
            }
          : r,
      ),
    );
  // Re-price the WHOLE estimate (rooms, companions, pad, add-ons) at margin m.
  const applyMarginToAll = (m: number) => {
    setRooms((rs) =>
      rs.map((r) => ({
        ...r,
        materialRate: num(r.materialCost) > 0 ? String(sellAt(num(r.materialCost), m)) : r.materialRate,
        laborRate: num(r.laborCost) > 0 ? String(sellAt(num(r.laborCost), m)) : r.laborRate,
        comps: repriceComps(r.comps, m),
      })),
    );
    setRollComps((rc) => repriceComps(rc, m));
    setAddons((xs) =>
      xs.map((a) =>
        num(a.cost) > 0 ? { ...a, sell: String(sellAt(num(a.cost), m)) } : a,
      ),
    );
  };

  // Pick the catalog product for a job-level roll good (the actual pad).
  const pickRollProduct = (comp: Companion, p: Product | null) => {
    if (!p) {
      setRoll(comp.key, { productId: null, productLabel: "" });
      return;
    }
    const cost =
      Math.round(compRate(p.unit, comp.unit, p.material_rate || 0) * 100) / 100;
    const sell =
      cost > 0 ? Math.round(priceFromMargin(cost, targetMargin) * 100) / 100 : 0;
    setRoll(comp.key, {
      on: true,
      productId: p.id,
      productLabel:
        [p.manufacturer, p.name, p.color].filter(Boolean).join(" ") || p.name,
      cost: String(cost),
      rate: String(sell),
    });
  };

  const update = (id: string, patch: Partial<Room>) =>
    setRooms((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // Copy a room (type, product, prices, waste, companions) into a fresh one
  // right below it — so a multi-room estimate is just "copy, change the size."
  const duplicateRoom = (id: string) =>
    setRooms((rs) => {
      const i = rs.findIndex((r) => r.id === id);
      if (i < 0) return rs;
      const src = rs[i];
      const copy: Room = {
        ...src,
        id: `r${seq++}`,
        name: src.name ? `${src.name} (copy)` : "",
        comps: Object.fromEntries(
          Object.entries(src.comps).map(([k, v]) => [k, { ...v }]),
        ),
      };
      return [...rs.slice(0, i + 1), copy, ...rs.slice(i + 1)];
    });

  const chooseType = (id: string, type: string) => {
    const p = profileFor(type)!;
    const comps: Record<string, CompState> = {};
    for (const c of p.companions)
      comps[c.key] = {
        on: c.defaultOn,
        rate: "",
        cost: "",
        productId: null,
        productLabel: "",
        choice: c.choices?.[0] ?? "",
      };
    update(id, { type, waste: String(p.waste), comps });
  };

  // Pick a real catalog product for a companion (e.g. the actual pad), pulling
  // its cost and computing a sell price from the target margin.
  const pickCompProduct = (
    roomId: string,
    comp: Companion,
    p: Product | null,
  ) => {
    setRooms((rs) =>
      rs.map((r) => {
        if (r.id !== roomId) return r;
        const prev = r.comps[comp.key] ?? {
          on: true,
          rate: "",
          cost: "",
          productId: null,
          productLabel: "",
          choice: "",
        };
        if (!p) {
          return {
            ...r,
            comps: {
              ...r.comps,
              [comp.key]: { ...prev, productId: null, productLabel: "" },
            },
          };
        }
        const cost =
          Math.round(compRate(p.unit, comp.unit, p.material_rate || 0) * 100) /
          100;
        const sell =
          cost > 0 ? Math.round(priceFromMargin(cost, targetMargin) * 100) / 100 : 0;
        return {
          ...r,
          comps: {
            ...r.comps,
            [comp.key]: {
              ...prev,
              on: true,
              productId: p.id,
              productLabel:
                [p.manufacturer, p.name, p.color].filter(Boolean).join(" ") ||
                p.name,
              cost: String(cost),
              rate: String(sell),
            },
          },
        };
      }),
    );
  };

  const pickProduct = (id: string, p: Product | null, profile: FlooringProfile) => {
    if (!p) {
      update(id, { productId: null, productLabel: "" });
      return;
    }
    const catalogUnit = (p.unit || "").toLowerCase().includes("yd") ? "sqyd" : "sqft";
    const factor =
      profile.unit === catalogUnit ? 1 : profile.unit === "sqyd" ? 9 : 1 / 9;
    const cost = Math.round((p.material_rate || 0) * factor * 100) / 100;
    const sell = cost > 0 ? Math.round(priceFromMargin(cost, targetMargin) * 100) / 100 : 0;
    update(id, {
      productId: p.id,
      productLabel: [p.manufacturer, p.name, p.color].filter(Boolean).join(" ") || p.name,
      manufacturer: p.manufacturer,
      style: p.style,
      color: p.color,
      materialCost: String(cost),
      materialRate: String(sell),
      laborRate: p.labor_rate ? String(Math.round((p.labor_rate || 0) * factor * 100) / 100) : "",
    });
  };

  const allLines = useMemo(
    () => [
      ...rooms.flatMap(roomLines),
      ...rollGoodsLines(rooms, rollComps),
      ...addonLines(addons),
    ],
    [rooms, rollComps, addons],
  );
  const grand = allLines.reduce((s, l) => s + lineSell(l), 0);
  const cost = allLines.reduce((s, l) => s + lineCost(l), 0);
  const margin = marginPct(grand, cost);

  // Cost check, summarized by category and split into material vs labor.
  const breakdown = useMemo(() => {
    const mat = new Map<string, { cost: number; sell: number }>();
    const lab = new Map<string, { cost: number; sell: number }>();
    for (const l of allLines) {
      const s = lineSplit(l);
      const cat = l.category || "other";
      if (s.matSell > 0 || s.matCost > 0) {
        const e = mat.get(cat) ?? { cost: 0, sell: 0 };
        e.cost += s.matCost;
        e.sell += s.matSell;
        mat.set(cat, e);
      }
      if (s.labSell > 0 || s.labCost > 0) {
        const e = lab.get(cat) ?? { cost: 0, sell: 0 };
        e.cost += s.labCost;
        e.sell += s.labSell;
        lab.set(cat, e);
      }
    }
    const sum = (m: Map<string, { cost: number; sell: number }>) =>
      [...m.values()].reduce(
        (a, v) => ({ cost: a.cost + v.cost, sell: a.sell + v.sell }),
        { cost: 0, sell: 0 },
      );
    return {
      mat: [...mat.entries()],
      lab: [...lab.entries()],
      matTotal: sum(mat),
      labTotal: sum(lab),
    };
  }, [allLines]);

  const save = () =>
    startSave(async () => {
      const lines = [
        ...rooms.flatMap(roomLines),
        ...rollGoodsLines(rooms, rollComps),
        ...addonLines(addons),
      ].filter((l) => l.description.trim());
      if (!lines.length) {
        toast.error("Pick a flooring type and add a room first.");
        return;
      }
      // Per-room notes → the estimate's job description (shown on the work order).
      const jobDescription = rooms
        .filter((r) => r.notes.trim())
        .map((r) => `${r.name || "Room"}: ${r.notes.trim()}`)
        .join("\n");
      const res = await createSmartEstimate({
        customerId,
        title,
        taxRate: 8,
        lines,
        jobDescription: jobDescription || undefined,
      });
      if (res?.error) toast.error(res.error);
      // success redirects
    });

  // Total job area (so add-on quantities like floor prep are easy to fill in).
  const jobSqft = Math.round(rooms.reduce((s, r) => s + roomSqft(r), 0) * 10) / 10;
  const jobSqyd = Math.round((jobSqft / 9) * 10) / 10;

  // Which add-on checklists to show — the ones matching the flooring in the job.
  const hasCarpet = rooms.some((r) => profileFor(r.type)?.category === "carpet");
  const hasHard = rooms.some((r) => {
    const c = profileFor(r.type)?.category;
    return !!c && c !== "carpet";
  });
  const showCarpet = hasCarpet || (!hasCarpet && !hasHard);
  const showHard = hasHard || (!hasCarpet && !hasHard);

  const renderAddonRow = (a: Addon) => (
    <div key={a.id} className="px-2 py-1.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label className="flex flex-1 items-center gap-2">
          <input
            type="checkbox"
            checked={a.on}
            onChange={(e) => setAddon(a.id, { on: e.target.checked })}
            className="size-4 rounded border-input"
          />
          {a.custom ? (
            <Input
              value={a.label}
              onChange={(e) => setAddon(a.id, { label: e.target.value })}
              placeholder="Custom add-on name"
              className="h-7 max-w-xs"
            />
          ) : (
            <span className={cn(!a.on && "text-muted-foreground")}>{a.label}</span>
          )}
        </label>
        {a.on ? (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {a.choices ? (
              <select
                value={a.choice}
                onChange={(e) => setAddon(a.id, { choice: e.target.value })}
                className="h-7 rounded-md border border-input bg-transparent px-1 text-xs"
                title="Color"
              >
                {a.choices.map((ch) => (
                  <option key={ch} value={ch}>
                    {ch}
                  </option>
                ))}
              </select>
            ) : null}
            <Input
              value={a.qty}
              onChange={(e) => setAddon(a.id, { qty: e.target.value })}
              inputMode="decimal"
              placeholder="qty"
              className="h-7 w-14"
            />
            <select
              value={a.unit}
              onChange={(e) => setAddon(a.id, { unit: e.target.value })}
              className="h-7 rounded-md border border-input bg-transparent px-1 text-xs"
            >
              <option value="each">each</option>
              <option value="sqft">sq ft</option>
              <option value="sqyd">sq yd</option>
              <option value="lnft">ln ft</option>
              <option value="step">step</option>
              <option value="room">room</option>
            </select>
            $
            <Input
              value={a.cost}
              onChange={(e) => setAddon(a.id, { cost: e.target.value })}
              inputMode="decimal"
              placeholder="cost"
              className="h-7 w-16"
            />
            $
            <Input
              value={a.sell}
              onChange={(e) => setAddon(a.id, { sell: e.target.value })}
              inputMode="decimal"
              placeholder="price"
              className="h-7 w-16"
            />
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={a.labor}
                onChange={(e) => setAddon(a.id, { labor: e.target.checked })}
                className="size-3.5 rounded border-input"
              />
              labor
            </label>
          </div>
        ) : null}
        {a.custom ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove add-on"
            onClick={() => setAddons((xs) => xs.filter((x) => x.id !== a.id))}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs text-muted-foreground">
            Estimate title
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`Flooring for ${customerName}`}
            className="max-w-md"
          />
        </div>
        {/* Whole-estimate margin + standalone quick calculator. */}
        <div className="flex items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Target margin %
            </label>
            <Input
              value={marginGoal}
              onChange={(e) => setMarginGoal(e.target.value)}
              inputMode="decimal"
              className="h-9 w-20"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => applyMarginToAll(num(marginGoal))}
            title="Set every sell price from its cost at this margin"
          >
            Price all at {Math.round(num(marginGoal))}%
          </Button>
          <AreaCalculator triggerLabel="Quick calculator" triggerVariant="outline" />
        </div>
      </div>

      {rooms.map((r, idx) => {
        const profile = profileFor(r.type);
        const sqft = roomSqft(r);
        const sqyd = Math.round((sqft / 9) * 100) / 100;
        const usingCalc = num(r.areaOverride) > 0;
        const lines = roomLines(r);
        const roomTotal = lines.reduce((s, l) => s + lineSell(l), 0);
        return (
          <Card key={r.id} className="border-primary/20">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 px-4 py-3">
              <div className="flex flex-1 items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {idx + 1}
                </span>
                <Input
                  value={r.name}
                  onChange={(e) => update(r.id, { name: e.target.value })}
                  placeholder="Room (e.g. Living room)"
                  className="h-9 max-w-xs"
                />
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  title="Copy this room to a new one"
                  onClick={() => duplicateRoom(r.id)}
                >
                  <Copy className="size-3.5" /> Copy
                </Button>
                {rooms.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove room"
                    onClick={() => setRooms((rs) => rs.filter((x) => x.id !== r.id))}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-2.5 px-4 pb-3">
              {/* Flooring type */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  <Layers className="mr-1 inline size-3.5" /> Flooring type
                </label>
                <div className="flex flex-wrap gap-2">
                  {FLOORING_TYPES.map((t) => {
                    const p = profileFor(t)!;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => chooseType(r.id, t)}
                        className={cn(
                          "rounded-md border px-2.5 py-1 text-xs transition-colors",
                          r.type === t
                            ? "border-primary bg-primary text-primary-foreground"
                            : "hover:bg-muted",
                        )}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {profile ? (
                <>
                  <p className="flex items-center gap-1.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
                    <Sparkles className="size-3.5 text-primary" />
                    {profile.measureHint}
                  </p>

                  {/* Measurement */}
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">
                        Length (ft)
                      </label>
                      <Input
                        value={r.length}
                        onChange={(e) => update(r.id, { length: e.target.value })}
                        inputMode="decimal"
                        disabled={usingCalc}
                        className="h-9 w-24"
                      />
                    </div>
                    <span className="pb-2 text-muted-foreground">×</span>
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">
                        Width (ft)
                      </label>
                      <Input
                        value={r.width}
                        onChange={(e) => update(r.id, { width: e.target.value })}
                        inputMode="decimal"
                        disabled={usingCalc}
                        className="h-9 w-24"
                      />
                    </div>
                    <div className="pb-1 flex items-center gap-2">
                      <AreaCalculator
                        triggerLabel={usingCalc ? "Edit areas" : "Calculator"}
                        title={`Square footage — ${r.name || "this room"}`}
                        initialLabel={r.name}
                        onApply={(area, perimeter) =>
                          update(r.id, {
                            areaOverride: String(area),
                            perimeterOverride: String(perimeter),
                          })
                        }
                      />
                      {usingCalc ? (
                        <button
                          type="button"
                          onClick={() =>
                            update(r.id, {
                              areaOverride: "",
                              perimeterOverride: "",
                            })
                          }
                          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                        >
                          use L×W
                        </button>
                      ) : null}
                    </div>
                    <div className="pb-1.5 text-sm">
                      <Ruler className="mr-1 inline size-3.5 text-muted-foreground" />
                      <span className="font-medium">{sqft}</span> sq ft
                      {profile.unit === "sqyd" ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · {sqyd} sq yd
                        </span>
                      ) : null}
                      <span className="text-muted-foreground">
                        {" "}
                        · {r.waste || profile.waste}% waste
                      </span>
                      {usingCalc ? (
                        <span className="ml-1 text-xs text-primary">
                          · from calculator
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* Material */}
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-muted-foreground">
                      Material (search your catalog)
                    </label>
                    <ProductPicker
                      value={r.productId ?? ""}
                      initialLabel={r.productLabel}
                      onPick={(p) => pickProduct(r.id, p, profile)}
                      onCreated={(p) => pickProduct(r.id, p, profile)}
                    />
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                      <PriceField
                        label={`Mat. cost /${profile.unit === "sqyd" ? "yd" : "ft"}`}
                        value={r.materialCost}
                        onChange={(v) => update(r.id, { materialCost: v })}
                      />
                      <PriceField
                        label={`Mat. sell /${profile.unit === "sqyd" ? "yd" : "ft"}`}
                        value={r.materialRate}
                        onChange={(v) => update(r.id, { materialRate: v })}
                      />
                      <PriceField
                        label={`Labor cost /${profile.unit === "sqyd" ? "yd" : "ft"}`}
                        value={r.laborCost}
                        onChange={(v) => update(r.id, { laborCost: v })}
                      />
                      <PriceField
                        label={`Labor sell /${profile.unit === "sqyd" ? "yd" : "ft"}`}
                        value={r.laborRate}
                        onChange={(v) => update(r.id, { laborRate: v })}
                      />
                      <PriceField
                        label="Waste %"
                        value={r.waste}
                        onChange={(v) => update(r.id, { waste: v })}
                      />
                    </div>
                    {/* Per-room margin: set this room's sell prices from cost. */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Set this room&apos;s margin:</span>
                      <Input
                        value={r.marginInput}
                        onChange={(e) => update(r.id, { marginInput: e.target.value })}
                        inputMode="decimal"
                        placeholder={String(Math.round(num(marginGoal)))}
                        className="h-7 w-16"
                      />
                      <span>%</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          applyRoomMargin(r.id, num(r.marginInput) || num(marginGoal))
                        }
                      >
                        Apply
                      </Button>
                    </div>
                  </div>

                  {/* Companions — compact: one row each, details inline */}
                  <div>
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      This {profile.label.toLowerCase()} job also needs
                    </label>
                    <div className="divide-y rounded-md border">
                      {profile.companions
                        .filter((c) => !(c.rollUnits && c.rollUnits > 0))
                        .map((c) => {
                          const st: CompState =
                            r.comps[c.key] ?? {
                              on: false,
                              rate: "",
                              cost: "",
                              productId: null,
                              productLabel: "",
                              choice: c.choices?.[0] ?? "",
                            };
                          const setComp = (patch: Partial<CompState>) =>
                            update(r.id, {
                              comps: { ...r.comps, [c.key]: { ...st, ...patch } },
                            });
                          const qty = companionQty(
                            c,
                            sqft,
                            2 * (num(r.length) + num(r.width)),
                          );
                          return (
                            <div key={c.key} className="px-2 py-1.5 text-sm">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <label className="flex items-center gap-1.5">
                                  <input
                                    type="checkbox"
                                    checked={st.on}
                                    onChange={(e) => setComp({ on: e.target.checked })}
                                    className="size-4 rounded border-input"
                                  />
                                  <span className={cn(!st.on && "text-muted-foreground")}>
                                    {c.label}
                                  </span>
                                </label>
                                {st.on ? (
                                  <span className="text-xs text-muted-foreground">
                                    {qty} {c.unit}
                                    {c.info ? "" : c.labor ? " · labor" : ""}
                                  </span>
                                ) : c.hint ? (
                                  <span className="text-[11px] text-muted-foreground">
                                    {c.hint}
                                  </span>
                                ) : null}

                                {/* Info companion (tackstrip): subfloor chips, no price */}
                                {st.on && c.info && c.choices ? (
                                  <div className="ml-auto flex gap-1">
                                    {c.choices.map((ch) => (
                                      <button
                                        key={ch}
                                        type="button"
                                        onClick={() => setComp({ choice: ch })}
                                        className={cn(
                                          "rounded border px-2 py-0.5 text-xs",
                                          st.choice === ch
                                            ? "border-primary bg-primary text-primary-foreground"
                                            : "hover:bg-muted",
                                        )}
                                      >
                                        {ch}
                                      </button>
                                    ))}
                                  </div>
                                ) : null}

                                {/* Labor companion: cost + sell inline */}
                                {st.on && c.labor ? (
                                  <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                                    $
                                    <Input
                                      value={st.cost}
                                      onChange={(e) => setComp({ cost: e.target.value })}
                                      inputMode="decimal"
                                      placeholder="cost"
                                      className="h-8 w-16"
                                    />
                                    $
                                    <Input
                                      value={st.rate}
                                      onChange={(e) => setComp({ rate: e.target.value })}
                                      inputMode="decimal"
                                      placeholder="sell"
                                      className="h-8 w-16"
                                    />
                                    /{c.unit}
                                  </div>
                                ) : null}
                              </div>

                              {/* Material companion: catalog product + cost/sell */}
                              {st.on && !c.labor && !c.info ? (
                                <div className="mt-1.5 flex flex-wrap items-end gap-2">
                                  <ProductPicker
                                    value={st.productId ?? ""}
                                    initialLabel={st.productLabel}
                                    label={`${c.label} — from catalog`}
                                    defaultCategory={c.category}
                                    onPick={(p) => pickCompProduct(r.id, c, p)}
                                    onCreated={(p) => pickCompProduct(r.id, c, p)}
                                  />
                                  <PriceField
                                    label={`Cost /${c.unit}`}
                                    value={st.cost}
                                    onChange={(v) => setComp({ cost: v })}
                                  />
                                  <PriceField
                                    label={`Sell /${c.unit}`}
                                    value={st.rate}
                                    onChange={(v) => setComp({ rate: v })}
                                  />
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                    </div>
                  </div>

                  {/* Notes for this room (work order / crew) */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Room notes (optional — shown on the work order)
                    </label>
                    <textarea
                      value={r.notes}
                      onChange={(e) => update(r.id, { notes: e.target.value })}
                      rows={2}
                      placeholder="e.g. move couch, tricky transition at the hall, stairs separate"
                      className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>

                  <div className="flex justify-end border-t pt-2 text-sm">
                    Room total:{" "}
                    <span className="ml-1 font-semibold">
                      {formatMoney(roomTotal)}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Pick a flooring type above — the builder sets up the right
                  measurement, waste, and materials for it.
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Button
        type="button"
        variant="outline"
        onClick={() => setRooms((rs) => [...rs, newRoom()])}
      >
        <Plus className="size-4" /> Add another room
      </Button>

      {/* Job-level roll goods (carpet pad): figured off the WHOLE job's yardage,
          rounded up to full rolls once — not room-by-room. */}
      {ROLL_COMPANIONS.map((c) => {
        const total = rollGoodsArea(rooms, c);
        if (total <= 0) return null; // no room uses this roll good yet
        const st = rollComps[c.key];
        const rolls = rollGoodsRolls(c, total);
        const billedQty = rolls * (c.rollUnits ?? 1);
        return (
          <Card key={c.key} className="border-primary/20">
            <CardContent className="space-y-3 pt-5">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={st.on}
                  onChange={(e) => setRoll(c.key, { on: e.target.checked })}
                  className="size-4 rounded border-input"
                />
                <span className="font-semibold">{c.label}</span>
                <span className="text-xs text-muted-foreground">
                  · whole job
                </span>
              </label>

              {st.on ? (
                <>
                  <p className="flex flex-wrap items-center gap-1.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
                    <Sparkles className="size-3.5 text-primary" />
                    {total} {c.unit} of {c.label.toLowerCase()} across the whole
                    job →{" "}
                    <span className="font-medium text-foreground">
                      {rolls} roll{rolls === 1 ? "" : "s"} ({billedQty} {c.unit})
                    </span>{" "}
                    at {c.rollUnits} {c.unit}/roll. No partial rolls.
                  </p>
                  <ProductPicker
                    value={st.productId ?? ""}
                    initialLabel={st.productLabel}
                    label={`${c.label} — from catalog`}
                    defaultCategory={c.category}
                    onPick={(p) => pickRollProduct(c, p)}
                    onCreated={(p) => pickRollProduct(c, p)}
                  />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <PriceField
                      label={`Our cost /${c.unit}`}
                      value={st.cost}
                      onChange={(v) => setRoll(c.key, { cost: v })}
                    />
                    <PriceField
                      label={`Sell /${c.unit}`}
                      value={st.rate}
                      onChange={(v) => setRoll(c.key, { rate: v })}
                    />
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        );
      })}

      {/* Add-ons checklists — two lists, shown to match the job's flooring. */}
      <Card className="border-dashed">
        <CardContent className="space-y-3 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">
              Add-ons checklist{" "}
              <span className="font-normal text-muted-foreground">
                — check what this job needs ({addons.filter((a) => a.on).length}{" "}
                selected)
              </span>
            </div>
            {jobSqft > 0 ? (
              <div className="rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                Job total: {jobSqft} sq ft · {jobSqyd} sq yd
              </div>
            ) : null}
          </div>

          {showCarpet ? (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Carpet
              </div>
              <div className="divide-y rounded-md border">
                {addons.filter((a) => a.group === "carpet").map(renderAddonRow)}
              </div>
            </div>
          ) : null}

          {showHard ? (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Hard surface
              </div>
              <div className="divide-y rounded-md border">
                {addons.filter((a) => a.group === "hard").map(renderAddonRow)}
              </div>
            </div>
          ) : null}

          {/* Custom items (always shown) */}
          {addons.some((a) => a.group === "custom") ? (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Custom
              </div>
              <div className="divide-y rounded-md border">
                {addons.filter((a) => a.group === "custom").map(renderAddonRow)}
              </div>
            </div>
          ) : null}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAddons((xs) => [...xs, newCustomAddon()])}
          >
            <Plus className="size-3.5" /> Add a custom item
          </Button>
        </CardContent>
      </Card>

      {/* Internal cost check — your cost per line, never shown to the customer */}
      {allLines.length > 0 ? (
        <details className="rounded-xl border bg-card" open>
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Cost check{" "}
            <span className="font-normal text-muted-foreground">
              — your cost per line (internal only, not on the customer&apos;s
              quote)
            </span>
          </summary>
          <div className="overflow-x-auto border-t">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                  <th className="px-3 py-2 text-right font-medium">Sell</th>
                  <th className="px-3 py-2 text-right font-medium">Profit</th>
                  <th className="px-4 py-2 text-right font-medium">Margin</th>
                </tr>
              </thead>
              {/* Materials, summarized by category */}
              <tbody>
                <tr className="bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <td className="px-4 py-1.5" colSpan={5}>
                    Materials
                  </td>
                </tr>
                {breakdown.mat.length === 0 ? (
                  <tr>
                    <td className="px-4 py-1.5 text-muted-foreground" colSpan={5}>
                      —
                    </td>
                  </tr>
                ) : (
                  breakdown.mat.map(([cat, v]) => (
                    <CostRow
                      key={`m-${cat}`}
                      label={PRODUCT_CATEGORY_LABELS[cat as never] ?? cat}
                      cost={v.cost}
                      sell={v.sell}
                      target={targetMargin}
                    />
                  ))
                )}
                <CostRow
                  label="Material subtotal"
                  cost={breakdown.matTotal.cost}
                  sell={breakdown.matTotal.sell}
                  target={targetMargin}
                  bold
                />
              </tbody>
              {/* Labor, summarized by category */}
              <tbody>
                <tr className="bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <td className="px-4 py-1.5" colSpan={5}>
                    Labor
                  </td>
                </tr>
                {breakdown.lab.length === 0 ? (
                  <tr>
                    <td className="px-4 py-1.5 text-muted-foreground" colSpan={5}>
                      —
                    </td>
                  </tr>
                ) : (
                  breakdown.lab.map(([cat, v]) => (
                    <CostRow
                      key={`l-${cat}`}
                      label={PRODUCT_CATEGORY_LABELS[cat as never] ?? cat}
                      cost={v.cost}
                      sell={v.sell}
                      target={targetMargin}
                    />
                  ))
                )}
                <CostRow
                  label="Labor subtotal"
                  cost={breakdown.labTotal.cost}
                  sell={breakdown.labTotal.sell}
                  target={targetMargin}
                  bold
                />
              </tbody>
              <tfoot>
                <tr className="border-t-2 text-base font-semibold">
                  <td className="px-4 py-2">Job total</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(cost)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(grand)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(grand - cost)}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-2 text-right tabular-nums",
                      margin < targetMargin && grand > 0 && "text-amber-600",
                    )}
                  >
                    {Math.round(margin)}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </details>
      ) : null}

      {/* Sticky summary */}
      <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-lg">
        <div className="flex items-center gap-6">
          <div>
            <div className="text-xs text-muted-foreground">Estimate total</div>
            <div className="text-xl font-bold">{formatMoney(grand)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Margin</div>
            <div
              className={cn(
                "text-lg font-semibold",
                margin < targetMargin && grand > 0 && "text-amber-600",
              )}
            >
              {Math.round(margin)}%
            </div>
          </div>
        </div>
        <Button type="button" size="lg" onClick={save} disabled={saving}>
          {saving ? "Creating…" : "Create estimate"}
        </Button>
      </div>
    </div>
  );
}

/** One summarized row in the cost check. */
function CostRow({
  label,
  cost,
  sell,
  target,
  bold,
}: {
  label: string;
  cost: number;
  sell: number;
  target: number;
  bold?: boolean;
}) {
  const profit = sell - cost;
  const m = marginPct(sell, cost);
  return (
    <tr className={cn("border-b last:border-0", bold && "font-semibold")}>
      <td className="px-4 py-1.5">{label}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">
        {cost > 0 ? formatMoney(cost) : "—"}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(sell)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(profit)}</td>
      <td
        className={cn(
          "px-4 py-1.5 text-right tabular-nums",
          cost > 0 && m < target && "text-amber-600",
        )}
      >
        {cost > 0 ? `${Math.round(m)}%` : "—"}
      </td>
    </tr>
  );
}

function PriceField({
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
      <label className="mb-0.5 block text-[11px] text-muted-foreground">
        {label}
      </label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        placeholder="0"
        className="h-8"
      />
    </div>
  );
}
