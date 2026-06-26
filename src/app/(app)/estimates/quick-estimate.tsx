"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Printer, Send, Ruler, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { priceFromMargin, marginPct } from "@/lib/estimate-calc";
import { FLOORING_TYPES, profileFor } from "@/lib/flooring-profiles";
import { AreaCalculator } from "@/components/area-calculator";
import { PriceBookPicker } from "@/components/price-book-picker";
import type { PriceItem } from "@/lib/price-book";
import { createSmartEstimate, type SmartLine } from "./smart-actions";

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** A free-form quick line (add-on, labor, or material). */
interface QLine {
  id: string;
  label: string;
  unit: string;
  labor: boolean;
  qty: string;
  cost: string;
  sell: string;
}
let qid = 0;
const mkLine = (over: Partial<QLine> = {}): QLine => ({
  id: `q${qid++}`, label: "", unit: "each", labor: false, qty: "", cost: "", sell: "", ...over,
});

function lineSell(l: SmartLine): number {
  const q = l.quantity && l.quantity > 0 ? l.quantity : 0;
  return q * l.material_rate + q * l.labor_rate;
}
function lineCost(l: SmartLine): number {
  const q = l.quantity && l.quantity > 0 ? l.quantity : 0;
  return q * l.material_cost + q * l.labor_cost;
}

/**
 * Quick estimate — one screen for a fast quote. Drop in the flooring (type +
 * area + material/install) and any priced add-ons from the price list, and it
 * builds a clean estimate (material, labor, pad never combined) that flows on to
 * invoice / PO / job exactly like the wizard. For when you don't need the full
 * room-by-room walkthrough.
 */
export function QuickEstimate({
  customerId, customerName, targetMargin,
}: {
  customerId: string; customerName: string; targetMargin: number;
}) {
  const [title, setTitle] = useState("");
  const [marginGoal, setMarginGoal] = useState(String(targetMargin));
  const [presentation, setPresentation] = useState<"detailed" | "summary">("detailed");

  // Flooring block (optional)
  const [type, setType] = useState("");
  const [area, setArea] = useState("");
  const [waste, setWaste] = useState("");
  const [matCost, setMatCost] = useState("");
  const [matSell, setMatSell] = useState("");
  const [instCost, setInstCost] = useState("");
  const [instSell, setInstSell] = useState("");
  const [pad, setPad] = useState(false);
  const [padCost, setPadCost] = useState("");
  const [padSell, setPadSell] = useState("");

  const [lines, setLines] = useState<QLine[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, startSave] = useTransition();

  const goal = num(marginGoal);
  const sellAt = (c: number) => (c > 0 ? r2(priceFromMargin(c, goal)) : 0);
  const profile = profileFor(type);

  const setLine = (id: string, patch: Partial<QLine>) =>
    setLines((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const addPriced = (it: PriceItem) =>
    setLines((xs) => [
      ...xs,
      mkLine({ label: it.label, unit: it.unit, labor: it.labor, cost: String(it.cost), sell: String(sellAt(it.cost)) }),
    ]);

  const buildLines = (): SmartLine[] => {
    const out: SmartLine[] = [];
    const sqft = num(area);
    if (profile && sqft > 0) {
      const isYd = profile.unit === "sqyd";
      const unit = isYd ? "sq yd" : "sq ft";
      const w = num(waste) > 0 ? num(waste) : profile.waste;
      const base = isYd ? sqft / 9 : sqft;
      const qty = Math.ceil(base * (1 + w / 100));
      out.push({
        room: null, description: profile.label, category: profile.category,
        measure_unit: profile.unit, sqft: null, quantity: qty > 0 ? qty : null,
        length_in: null, width_in: null, unit,
        material_rate: num(matSell), labor_rate: 0,
        material_cost: num(matCost), labor_cost: 0, waste_pct: 0,
        product_id: null, manufacturer: null, style: null, color: null,
      });
      if (pad && profile.category === "carpet" && (num(padCost) > 0 || num(padSell) > 0)) {
        const padYd = Math.ceil(sqft / 9);
        out.push({
          room: null, description: "Carpet pad", category: "underlayment",
          measure_unit: "sqyd", sqft: null, quantity: padYd > 0 ? padYd : null,
          length_in: null, width_in: null, unit: "sq yd",
          material_rate: num(padSell), labor_rate: 0, material_cost: num(padCost),
          labor_cost: 0, waste_pct: 0, product_id: null, manufacturer: null, style: null, color: null,
        });
      }
      if (num(instCost) > 0 || num(instSell) > 0) {
        const laborQty = isYd ? r2(sqft / 9) : sqft;
        out.push({
          room: null, description: `Installation — ${profile.label.toLowerCase()}`,
          category: "labor", measure_unit: profile.unit, sqft: null,
          quantity: laborQty > 0 ? laborQty : null, length_in: null, width_in: null, unit,
          material_rate: 0, labor_rate: num(instSell),
          material_cost: 0, labor_cost: num(instCost), waste_pct: 0,
          product_id: null, manufacturer: null, style: null, color: null,
        });
      }
    }
    for (const l of lines) {
      if (!l.label.trim()) continue;
      const qty = num(l.qty) > 0 ? num(l.qty) : 1;
      out.push({
        room: null, description: l.label.trim(), category: l.labor ? "labor" : "other",
        measure_unit: "sqft", sqft: null, quantity: qty, length_in: null, width_in: null,
        unit: l.unit || "each",
        material_rate: l.labor ? 0 : num(l.sell), labor_rate: l.labor ? num(l.sell) : 0,
        material_cost: l.labor ? 0 : num(l.cost), labor_cost: l.labor ? num(l.cost) : 0,
        waste_pct: 0, product_id: null, manufacturer: null, style: null, color: null,
      });
    }
    return out;
  };

  const allLines = useMemo(
    buildLines,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type, area, waste, matCost, matSell, instCost, instSell, pad, padCost, padSell, lines],
  );
  const grand = allLines.reduce((s, l) => s + lineSell(l), 0);
  const cost = allLines.reduce((s, l) => s + lineCost(l), 0);
  const margin = marginPct(grand, cost);

  const startOver = () => {
    if (!window.confirm("Clear this quick estimate and start over?")) return;
    setTitle(""); setMarginGoal(String(targetMargin)); setPresentation("detailed");
    setType(""); setArea(""); setWaste("");
    setMatCost(""); setMatSell(""); setInstCost(""); setInstSell("");
    setPad(false); setPadCost(""); setPadSell("");
    setLines([]); setNotes("");
    toast.success("Cleared — fresh quick estimate");
  };

  const save = (opts: { print?: boolean; send?: boolean } = {}) =>
    startSave(async () => {
      const built = buildLines().filter((l) => l.description.trim());
      if (!built.length) {
        toast.error("Add the flooring or at least one line first.");
        return;
      }
      const res = await createSmartEstimate({
        customerId, title, taxRate: 8, lines: built, presentation,
        jobDescription: notes.trim() || undefined,
        print: opts.print, send: opts.send,
      });
      if (res?.error) toast.error(res.error);
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Fast quote — drop in the flooring and any add-ons. Set the cost; the
          sell price fills in at your margin.
        </p>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">Margin</span>
          <Input value={marginGoal} onChange={(e) => setMarginGoal(e.target.value)} inputMode="decimal" className="h-8 w-16" />%
        </div>
      </div>

      {/* Flooring block */}
      <Card className="border-primary/20">
        <CardContent className="space-y-2.5 p-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Flooring</div>
          <div className="flex flex-wrap gap-1.5">
            {FLOORING_TYPES.map((t) => {
              const p = profileFor(t)!;
              return (
                <button key={t} type="button" onClick={() => setType(type === t ? "" : t)}
                  className={cn("rounded-md border px-2.5 py-1 text-xs", type === t ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                  {p.label}
                </button>
              );
            })}
          </div>
          {profile ? (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Total area</label>
                  <div className="flex items-center gap-1">
                    <Input value={area} onChange={(e) => setArea(e.target.value)} inputMode="decimal" placeholder="sq ft" className="h-9 w-24" />
                    <span className="text-xs text-muted-foreground">sq ft</span>
                    <AreaCalculator triggerLabel="Add up areas" onApply={(a) => setArea(String(a))} />
                  </div>
                </div>
                <div className="flex items-center gap-1 pb-1 text-xs text-muted-foreground">
                  <span>Waste</span>
                  <Input value={waste} onChange={(e) => setWaste(e.target.value)} inputMode="decimal" placeholder={String(profile.waste)} className="h-7 w-14" />%
                </div>
                {num(area) > 0 ? (
                  <span className="pb-1.5 text-sm">
                    <Ruler className="mr-1 inline size-3.5 text-muted-foreground" />
                    <span className="font-medium">{r2(num(area))}</span> sq ft
                    {profile.unit === "sqyd" ? <span className="ml-1 text-muted-foreground">· {r2(num(area) / 9)} sq yd</span> : null}
                  </span>
                ) : null}
              </div>
              <QuickCostSell label={`Material /${profile.unit === "sqyd" ? "yd" : "ft"}`} cost={matCost} sell={matSell}
                onCost={(v) => { setMatCost(v); if (num(v) > 0) setMatSell(String(sellAt(num(v)))); }}
                onSell={setMatSell} />
              <QuickCostSell label={`Install /${profile.unit === "sqyd" ? "yd" : "ft"}`} cost={instCost} sell={instSell}
                onCost={(v) => { setInstCost(v); if (num(v) > 0) setInstSell(String(sellAt(num(v)))); }}
                onSell={setInstSell} />
              {profile.category === "carpet" ? (
                <div className="rounded-md border p-2">
                  <label className="flex items-center gap-2 text-xs font-medium">
                    <input type="checkbox" checked={pad} onChange={() => setPad(!pad)} className="size-4 rounded border-input" /> Carpet pad
                  </label>
                  {pad ? (
                    <div className="mt-1.5">
                      <QuickCostSell label="Pad /yd" cost={padCost} sell={padSell}
                        onCost={(v) => { setPadCost(v); if (num(v) > 0) setPadSell(String(sellAt(num(v)))); }}
                        onSell={setPadSell} />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Pick a flooring type, or skip and just add line items below.</p>
          )}
        </CardContent>
      </Card>

      {/* Add-on / extra lines */}
      <Card>
        <CardContent className="space-y-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Add-ons & extras</div>
            <div className="flex gap-1.5">
              <PriceBookPicker triggerLabel="Add from price list" onPick={addPriced} />
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((xs) => [...xs, mkLine()])}>
                <Plus className="size-3.5" /> Custom line
              </Button>
            </div>
          </div>
          {lines.length ? (
            lines.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                <Input value={l.label} onChange={(e) => setLine(l.id, { label: e.target.value })} placeholder="Item name" className="h-8 min-w-32 flex-1" />
                <Input value={l.qty} onChange={(e) => setLine(l.id, { qty: e.target.value })} inputMode="decimal" placeholder="qty" className="h-8 w-14" />
                <select value={l.unit} onChange={(e) => setLine(l.id, { unit: e.target.value })} className="h-8 rounded-md border border-input bg-transparent px-1 text-xs">
                  <option value="sqft">sq ft</option>
                  <option value="sqyd">sq yd</option>
                  <option value="lnft">ln ft</option>
                  <option value="each">each</option>
                  <option value="step">step</option>
                </select>
                $<Input value={l.cost} onChange={(e) => setLine(l.id, { cost: e.target.value, ...(num(e.target.value) > 0 ? { sell: String(sellAt(num(e.target.value))) } : {}) })} inputMode="decimal" placeholder="cost" className="h-8 w-16" />
                →$<Input value={l.sell} onChange={(e) => setLine(l.id, { sell: e.target.value })} inputMode="decimal" placeholder="sell" className="h-8 w-16" />
                <label className="flex items-center gap-1"><input type="checkbox" checked={l.labor} onChange={(e) => setLine(l.id, { labor: e.target.checked })} className="size-3.5 rounded border-input" />labor</label>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove line" onClick={() => setLines((xs) => xs.filter((x) => x.id !== l.id))}>
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">Nothing added yet — use the price list or add a custom line.</p>
          )}
        </CardContent>
      </Card>

      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Flooring for ${customerName}`} className="max-w-md" />
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Job notes (shown on the work order)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          placeholder="e.g. existing floor glue-down VCT · move fridge & stove · parking in rear"
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </div>

      {/* Running total */}
      <Card>
        <CardContent className="divide-y p-0 text-sm">
          {allLines.map((l, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-1.5">
              <span className="min-w-0 truncate">{l.description}</span>
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
          <Button type="button" variant="ghost" onClick={startOver} className="text-muted-foreground"><RotateCcw className="size-4" /> Start over</Button>
          <Button type="button" variant="ghost" onClick={() => save({ print: true })} disabled={saving}><Printer className="size-4" /> Print</Button>
          <Button type="button" variant="outline" onClick={() => save()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          <Button type="button" onClick={() => save({ send: true })} disabled={saving}><Send className="size-4" /> Save &amp; send</Button>
        </div>
      </div>
    </div>
  );
}

function QuickCostSell({ label, cost, sell, onCost, onSell }: { label: string; cost: string; sell: string; onCost: (v: string) => void; onSell: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-24 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className="text-xs text-muted-foreground">$</span>
      <Input value={cost} onChange={(e) => onCost(e.target.value)} inputMode="decimal" placeholder="cost" className="h-8" />
      <span className="text-xs text-muted-foreground">→ $</span>
      <Input value={sell} onChange={(e) => onSell(e.target.value)} inputMode="decimal" placeholder="sell" className="h-8" />
    </div>
  );
}
