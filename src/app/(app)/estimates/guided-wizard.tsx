"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Plus, Trash2, ArrowLeft, ArrowRight, Check, Printer, Send, Ruler, RotateCcw,
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
import { ProductPicker } from "./product-picker";
import { createSmartEstimate, type SmartLine } from "./smart-actions";

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const feet = (ft: string, inch: string) => num(ft) + num(inch) / 12;

interface WRoom {
  id: string;
  name: string;
  type: string;
  lengthFt: string; lengthIn: string;
  widthFt: string; widthIn: string;
  productId: string | null; productLabel: string;
  manufacturer: string | null; style: string | null; color: string | null;
  matCost: string; matSell: string;
  install: boolean; instCost: string; instSell: string;
  pad: boolean; padCost: string; padSell: string;
}
let seq = 0;
const newRoom = (): WRoom => ({
  id: `w${seq++}`, name: "", type: "",
  lengthFt: "", lengthIn: "", widthFt: "", widthIn: "",
  productId: null, productLabel: "", manufacturer: null, style: null, color: null,
  matCost: "", matSell: "", install: true, instCost: "", instSell: "",
  pad: true, padCost: "", padSell: "",
});
const roomSqft = (r: WRoom) =>
  areaSqft(feet(r.lengthFt, r.lengthIn), feet(r.widthFt, r.widthIn));

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
  const lenIn = feet(r.lengthFt, r.lengthIn) * 12;
  const widIn = feet(r.widthFt, r.widthIn) * 12;
  const area = isYd ? sqft / 9 : sqft;
  const matQty = Math.ceil(area * (1 + profile.waste / 100));
  const out: SmartLine[] = [];
  out.push({
    room: r.name || null, description: r.productLabel || profile.label,
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

/** All estimate lines: materials/pad per room + ONE labor line per flooring type + add-ons. */
function jobLines(rooms: WRoom[], addons: WAddon[]): SmartLine[] {
  const out: SmartLine[] = [];
  const laborByCat = new Map<
    string,
    { label: string; unit: string; measureUnit: "sqft" | "sqyd"; area: number; costSum: number; sellSum: number }
  >();
  for (const r of rooms) {
    out.push(...roomMatPad(r));
    const profile = profileFor(r.type);
    if (!profile || !r.install) continue;
    if (num(r.instCost) <= 0 && num(r.instSell) <= 0) continue;
    const isYd = profile.unit === "sqyd";
    const qty = isYd ? roomSqft(r) / 9 : roomSqft(r);
    if (qty <= 0) continue;
    const e =
      laborByCat.get(profile.category) ?? {
        label: profile.label, unit: isYd ? "sq yd" : "sq ft",
        measureUnit: profile.unit, area: 0, costSum: 0, sellSum: 0,
      };
    e.area += qty;
    e.costSum += qty * num(r.instCost);
    e.sellSum += qty * num(r.instSell);
    laborByCat.set(profile.category, e);
  }
  // One installation/labor line per flooring type.
  for (const e of laborByCat.values()) {
    const area = r2(e.area);
    if (area <= 0) continue;
    out.push({
      room: null, description: `Installation — ${e.label.toLowerCase()}`,
      category: "labor", measure_unit: e.measureUnit, sqft: null, quantity: area,
      length_in: null, width_in: null, unit: e.unit,
      material_rate: 0, labor_rate: r2(e.sellSum / e.area),
      material_cost: 0, labor_cost: r2(e.costSum / e.area), waste_pct: 0,
      product_id: null, manufacturer: null, style: null, color: null,
    });
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
  const [rooms, setRooms] = useState<WRoom[]>([newRoom()]);
  const [addons, setAddons] = useState<WAddon[]>(() =>
    STANDARD_ADDONS.map((d) => ({ label: d.label, unit: d.unit, labor: d.labor, on: false, qty: "", cost: "", sell: "" })),
  );
  const [saving, startSave] = useTransition();

  const goal = num(marginGoal);
  const sellAt = (c: number) => (c > 0 ? r2(priceFromMargin(c, goal)) : 0);
  const up = (id: string, patch: Partial<WRoom>) =>
    setRooms((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const setAddon = (i: number, patch: Partial<WAddon>) =>
    setAddons((xs) => xs.map((a, j) => (j === i ? { ...a, ...patch } : a)));

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

  const startOver = () => {
    if (!window.confirm("Clear this estimate and start over?")) return;
    setTitle("");
    setMarginGoal(String(targetMargin));
    setPresentation("detailed");
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
                      <FtIn label="Length" ft={r.lengthFt} inch={r.lengthIn} onFt={(v) => up(r.id, { lengthFt: v })} onIn={(v) => up(r.id, { lengthIn: v })} />
                      <span className="pb-2 text-muted-foreground">×</span>
                      <FtIn label="Width" ft={r.widthFt} inch={r.widthIn} onFt={(v) => up(r.id, { widthFt: v })} onIn={(v) => up(r.id, { widthIn: v })} />
                      <span className="pb-1.5 text-sm"><Ruler className="mr-1 inline size-3.5 text-muted-foreground" /><span className="font-medium">{sqft}</span> sq ft</span>
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
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      {/* STEP 3 — Add-ons checklist */}
      {step === 2 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Check everything this job needs so nothing&apos;s missed — tear-out, prep, stairs, transitions, metals…
          </p>
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
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Flooring for ${customerName}`} className="max-w-md" />
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

function FtIn({ label, ft, inch, onFt, onIn }: { label: string; ft: string; inch: string; onFt: (v: string) => void; onIn: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <div className="flex items-end gap-1">
        <Input value={ft} onChange={(e) => onFt(e.target.value)} inputMode="decimal" placeholder="ft" className="h-9 w-14" /><span className="pb-2 text-xs text-muted-foreground">ft</span>
        <Input value={inch} onChange={(e) => onIn(e.target.value)} inputMode="decimal" placeholder="in" className="h-9 w-12" /><span className="pb-2 text-xs text-muted-foreground">in</span>
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
