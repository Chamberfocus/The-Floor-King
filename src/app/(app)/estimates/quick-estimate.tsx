"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Printer, Send, Ruler, RotateCcw, Camera } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { priceFromMargin, marginPct } from "@/lib/estimate-calc";
import { FLOORING_TYPES, profileFor } from "@/lib/flooring-profiles";
import { createClient } from "@/lib/supabase/client";
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
function lineCost(l: SmartLine, fMult = 1): number {
  const q = l.quantity && l.quantity > 0 ? l.quantity : 0;
  // Freight & fees markup lands on material only, never labor.
  return q * l.material_cost * fMult + q * l.labor_cost;
}

/**
 * Quick estimate — one screen for a fast quote. Drop in the flooring (type +
 * area + material/install) and any priced add-ons from the price list, and it
 * builds a clean estimate (material, labor, pad never combined) that flows on to
 * invoice / PO / job exactly like the wizard. For when you don't need the full
 * room-by-room walkthrough.
 */
export function QuickEstimate({
  customerId, customerName, targetMargin, freightPct, serviceAddressId,
}: {
  customerId: string; customerName: string; targetMargin: number; freightPct: number; serviceAddressId: string;
}) {
  const [title, setTitle] = useState("");
  const [marginGoal, setMarginGoal] = useState(String(targetMargin));
  const [taxRate, setTaxRate] = useState("8");
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
  const [analyzing, startAnalyze] = useTransition();
  const drawingRef = useRef<HTMLInputElement>(null);

  // Guard the margin so a blank / 0 / ≥100 entry can't break price-from-margin
  // (it divides by 1 − margin). Falls back to the shop's target margin.
  const goalRaw = num(marginGoal);
  const goal = goalRaw > 0 && goalRaw < 100 ? goalRaw : targetMargin;
  const sellAt = (c: number) => (c > 0 ? r2(priceFromMargin(c, goal)) : 0);
  const profile = profileFor(type);

  const setLine = (id: string, patch: Partial<QLine>) =>
    setLines((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const addPriced = (it: PriceItem) =>
    setLines((xs) => [
      ...xs,
      mkLine({ label: it.label, unit: it.unit, labor: it.labor, cost: String(it.cost), sell: String(sellAt(it.cost)) }),
    ]);

  // Read a drawing / measure sheet → fill the single flooring block. Quick has
  // ONE flooring type, so we pick the dominant type by area, sum its area, and
  // pull material cost from it. Any other types + add-ons drop into extra lines
  // so nothing's lost — and we tell you to use the guided builder if the sheet
  // is genuinely multi-type.
  const drawingArea = (d: DrawingFindings["rooms"][number]) => {
    if (d.sqft && d.sqft > 0) return d.sqft;
    const L = (d.lengthFt || 0) + (d.lengthIn || 0) / 12;
    const W = (d.widthFt || 0) + (d.widthIn || 0) / 12;
    return L > 0 && W > 0 ? r2(L * W) : 0;
  };
  const applyDrawing = (f: DrawingFindings) => {
    if (!f.rooms.length) {
      toast.error("Couldn't read any rooms from that drawing.");
      return;
    }
    // Sum area per flooring type.
    const byType = new Map<string, { area: number; matCost: number; install: boolean; pad: boolean }>();
    for (const d of f.rooms) {
      const a = drawingArea(d);
      if (a <= 0) continue;
      const cur = byType.get(d.type) ?? { area: 0, matCost: 0, install: false, pad: false };
      cur.area += a;
      if (!cur.matCost && d.materialCost && d.materialCost > 0) cur.matCost = d.materialCost;
      cur.install = cur.install || d.install;
      cur.pad = cur.pad || d.pad;
      byType.set(d.type, cur);
    }
    if (!byType.size) {
      toast.error("The drawing had rooms but no usable sizes — enter the area by hand.");
      return;
    }
    // Dominant type = most area.
    const dominant = [...byType.entries()].sort((a, b) => b[1].area - a[1].area)[0];
    const [domType, dom] = dominant;
    const domProfile = profileFor(domType);
    setType(domType);
    setArea(String(r2(dom.area)));
    if (dom.matCost > 0) {
      setMatCost(String(dom.matCost));
      setMatSell(String(sellAt(dom.matCost)));
    }
    if (dom.pad && domProfile?.category === "carpet") setPad(true);

    // Any OTHER flooring types → drop as extra lines (area × placeholder) so
    // they're visible; the salesperson prices them.
    const others = [...byType.entries()].filter(([t]) => t !== domType);
    const extraLines: QLine[] = others.map(([t, v]) => {
      const p = profileFor(t);
      return mkLine({
        label: `${p?.label ?? t} — ${r2(v.area)} sq ft (price me)`,
        unit: "sqft",
      });
    });
    // Drawing add-ons → extra lines too.
    for (const a of f.addons ?? []) {
      extraLines.push(mkLine({ label: a.label, labor: a.labor }));
    }
    if (extraLines.length) setLines((xs) => [...xs, ...extraLines]);

    const parts = [
      `Read ${f.rooms.length} room${f.rooms.length === 1 ? "" : "s"} → ${domProfile?.label ?? domType} at ${r2(dom.area)} sq ft`,
    ];
    if (others.length)
      parts.push(
        `${others.length} other floor type${others.length === 1 ? "" : "s"} added as line${others.length === 1 ? "" : "s"} to price — use the guided builder for a full multi-room job`,
      );
    if (f.totalNote) parts.push(`sheet total: ${f.totalNote}`);
    toast.success(parts.join(" · "));
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
      applyDrawing(f);
    });

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
  const fMult = 1 + (freightPct || 0) / 100;
  const grand = allLines.reduce((s, l) => s + lineSell(l), 0);
  const cost = allLines.reduce((s, l) => s + lineCost(l, fMult), 0);
  const margin = marginPct(grand, cost);
  const taxAmt = r2(grand * (num(taxRate) / 100));
  const grandWithTax = r2(grand + taxAmt);

  const startOver = () => {
    if (!window.confirm("Clear this quick estimate and start over?")) return;
    setTitle(""); setMarginGoal(String(targetMargin)); setTaxRate("8"); setPresentation("detailed");
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
        customerId, title, taxRate: num(taxRate), lines: built, presentation,
        jobDescription: notes.trim() || undefined,
        serviceAddressId: serviceAddressId || null,
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

      {/* Start from a photo of the measure sheet / drawing */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
        <Camera className="size-4 text-primary" />
        <span className="text-sm font-medium">Start from your drawing</span>
        <span className="text-xs text-muted-foreground">
          Snap the measure sheet — we&apos;ll fill in the flooring type, area &amp; material cost.
        </span>
        <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => drawingRef.current?.click()} disabled={analyzing}>
          <Camera className="size-4" /> {analyzing ? "Reading…" : "Photo or upload"}
        </Button>
        <input
          ref={drawingRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onDrawing(f);
          }}
        />
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
              <div key={l.id} className="space-y-1.5 rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Input value={l.label} onChange={(e) => setLine(l.id, { label: e.target.value })} placeholder="Item name" className="h-8 flex-1" />
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove line" onClick={() => setLines((xs) => xs.filter((x) => x.id !== l.id))}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Input value={l.qty} onChange={(e) => setLine(l.id, { qty: e.target.value })} inputMode="decimal" placeholder="qty" className="h-8 w-16" />
                  <select value={l.unit} onChange={(e) => setLine(l.id, { unit: e.target.value })} className="h-8 rounded-md border border-input bg-transparent px-1.5 text-xs">
                    <option value="sqft">sq ft</option>
                    <option value="sqyd">sq yd</option>
                    <option value="lnft">ln ft</option>
                    <option value="each">each</option>
                    <option value="step">step</option>
                  </select>
                  $<Input value={l.cost} onChange={(e) => setLine(l.id, { cost: e.target.value, ...(num(e.target.value) > 0 ? { sell: String(sellAt(num(e.target.value))) } : {}) })} inputMode="decimal" placeholder="cost" className="h-8 w-16" />
                  →$<Input value={l.sell} onChange={(e) => setLine(l.id, { sell: e.target.value })} inputMode="decimal" placeholder="sell" className="h-8 w-16" />
                  <label className="flex items-center gap-1.5 pl-1"><input type="checkbox" checked={l.labor} onChange={(e) => setLine(l.id, { labor: e.target.checked })} className="size-4 rounded border-input" />labor</label>
                </div>
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

      {margin < 0 && grand > 0 ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-2 text-sm font-semibold text-destructive">
          ⚠ This estimate is priced below cost — you&apos;d lose {formatMoney(cost - grand)} on this job. Raise the sell prices or your margin.
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-6">
          <div>
            <div className="text-xs text-muted-foreground">Subtotal</div>
            <div className="text-lg font-semibold">{formatMoney(grand)}</div>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Tax %</div>
            <Input value={taxRate} onChange={(e) => setTaxRate(e.target.value)} inputMode="decimal" className="h-8 w-16" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Total{num(taxRate) > 0 ? " w/ tax" : ""}</div>
            <div className="text-xl font-bold">{formatMoney(grandWithTax)}</div>
          </div>
          <div><div className="text-xs text-muted-foreground">Margin</div><div className={cn("text-lg font-semibold", margin < 0 && grand > 0 ? "text-destructive" : margin < goal - 0.5 && grand > 0 && "text-amber-600")}>{Math.round(margin)}%</div></div>
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
