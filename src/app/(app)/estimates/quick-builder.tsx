"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Copy, Printer, Ruler, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { priceFromMargin, marginPct } from "@/lib/estimate-calc";
import { FLOORING_TYPES, profileFor, areaSqft } from "@/lib/flooring-profiles";
import type { Product } from "@/lib/types";
import { ProductPicker } from "./product-picker";
import { createSmartEstimate, type SmartLine } from "./smart-actions";

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const feet = (ft: string, inch: string) => num(ft) + num(inch) / 12;

interface QRoom {
  id: string;
  name: string;
  type: string;
  lengthFt: string;
  lengthIn: string;
  widthFt: string;
  widthIn: string;
  productId: string | null;
  productLabel: string;
  manufacturer: string | null;
  style: string | null;
  color: string | null;
  matCost: string;
  matSell: string;
  install: boolean;
  instCost: string;
  instSell: string;
  pad: boolean;
  padCost: string;
  padSell: string;
}

let seq = 0;
const newRoom = (): QRoom => ({
  id: `q${seq++}`,
  name: "",
  type: "",
  lengthFt: "",
  lengthIn: "",
  widthFt: "",
  widthIn: "",
  productId: null,
  productLabel: "",
  manufacturer: null,
  style: null,
  color: null,
  matCost: "",
  matSell: "",
  install: true,
  instCost: "",
  instSell: "",
  pad: true,
  padCost: "",
  padSell: "",
});

const roomSqft = (r: QRoom) =>
  areaSqft(feet(r.lengthFt, r.lengthIn), feet(r.widthFt, r.widthIn));

/** Build the estimate lines for one room (material + install + pad). Same
 *  SmartLine shape the full builder saves, so estimates are identical. */
function quickRoomLines(r: QRoom): SmartLine[] {
  const profile = profileFor(r.type);
  if (!profile) return [];
  const sqft = roomSqft(r);
  const isYd = profile.unit === "sqyd";
  const qty = isYd ? r2(sqft / 9) : r2(sqft);
  const unit = isYd ? "sq yd" : "sq ft";
  const lenIn = feet(r.lengthFt, r.lengthIn) * 12;
  const widIn = feet(r.widthFt, r.widthIn) * 12;
  const out: SmartLine[] = [];

  out.push({
    room: r.name || null,
    description: r.productLabel || profile.label,
    category: profile.category,
    measure_unit: profile.unit,
    sqft: sqft > 0 ? sqft : null,
    quantity: null,
    length_in: lenIn > 0 ? Math.round(lenIn) : null,
    width_in: widIn > 0 ? Math.round(widIn) : null,
    unit,
    material_rate: num(r.matSell),
    labor_rate: 0,
    material_cost: num(r.matCost),
    labor_cost: 0,
    waste_pct: profile.waste,
    product_id: r.productId,
    manufacturer: r.manufacturer,
    style: r.style,
    color: r.color,
  });

  if (r.install && (num(r.instCost) > 0 || num(r.instSell) > 0)) {
    out.push({
      room: r.name || null,
      description: `Install — ${profile.label.toLowerCase()}`,
      category: "labor",
      measure_unit: profile.unit,
      sqft: null,
      quantity: qty > 0 ? qty : null,
      length_in: null,
      width_in: null,
      unit,
      material_rate: 0,
      labor_rate: num(r.instSell),
      material_cost: 0,
      labor_cost: num(r.instCost),
      waste_pct: 0,
      product_id: null,
      manufacturer: null,
      style: null,
      color: null,
    });
  }

  if (r.pad && profile.category === "carpet" && (num(r.padCost) > 0 || num(r.padSell) > 0)) {
    const padQty = r2(sqft / 9);
    out.push({
      room: r.name || null,
      description: "Carpet pad",
      category: "underlayment",
      measure_unit: "sqyd",
      sqft: null,
      quantity: padQty > 0 ? padQty : null,
      length_in: null,
      width_in: null,
      unit: "sq yd",
      material_rate: num(r.padSell),
      labor_rate: 0,
      material_cost: num(r.padCost),
      labor_cost: 0,
      waste_pct: 0,
      product_id: null,
      manufacturer: null,
      style: null,
      color: null,
    });
  }
  return out;
}

function lineSell(l: SmartLine): number {
  const qty =
    l.quantity && l.quantity > 0
      ? l.quantity
      : l.measure_unit === "sqyd"
        ? (l.sqft ?? 0) / 9
        : (l.sqft ?? 0);
  return qty * l.material_rate * (1 + l.waste_pct / 100) + qty * l.labor_rate;
}
function lineCost(l: SmartLine): number {
  const qty =
    l.quantity && l.quantity > 0
      ? l.quantity
      : l.measure_unit === "sqyd"
        ? (l.sqft ?? 0) / 9
        : (l.sqft ?? 0);
  return qty * l.material_cost * (1 + l.waste_pct / 100) + qty * l.labor_cost;
}

export function QuickBuilder({
  customerId,
  customerName,
  targetMargin,
}: {
  customerId: string;
  customerName: string;
  targetMargin: number;
}) {
  const [title, setTitle] = useState("");
  const [marginGoal, setMarginGoal] = useState(String(targetMargin));
  const [presentation, setPresentation] = useState<"detailed" | "summary">("detailed");
  const [rooms, setRooms] = useState<QRoom[]>([newRoom()]);
  const [saving, startSave] = useTransition();

  const goal = num(marginGoal);
  const sellAt = (cost: number) => (cost > 0 ? r2(priceFromMargin(cost, goal)) : 0);

  const update = (id: string, patch: Partial<QRoom>) =>
    setRooms((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const pickProduct = (id: string, p: Product | null) => {
    if (!p) {
      update(id, { productId: null, productLabel: "" });
      return;
    }
    const r = rooms.find((x) => x.id === id);
    const profile = r ? profileFor(r.type) : null;
    const prodYd = (p.unit || "").toLowerCase().includes("yd");
    const wantYd = profile?.unit === "sqyd";
    const factor = wantYd === prodYd ? 1 : wantYd ? 9 : 1 / 9;
    const cost = r2((p.material_rate || 0) * factor);
    update(id, {
      productId: p.id,
      productLabel: [p.manufacturer, p.name, p.color].filter(Boolean).join(" ") || p.name,
      manufacturer: p.manufacturer,
      style: p.style,
      color: p.color,
      matCost: String(cost),
      matSell: String(sellAt(cost)),
    });
  };

  const duplicateRoom = (id: string) =>
    setRooms((rs) => {
      const i = rs.findIndex((r) => r.id === id);
      if (i < 0) return rs;
      const copy = { ...rs[i], id: `q${seq++}`, name: rs[i].name ? `${rs[i].name} (copy)` : "" };
      return [...rs.slice(0, i + 1), copy, ...rs.slice(i + 1)];
    });

  const allLines = useMemo(() => rooms.flatMap(quickRoomLines), [rooms]);
  const grand = allLines.reduce((s, l) => s + lineSell(l), 0);
  const cost = allLines.reduce((s, l) => s + lineCost(l), 0);
  const margin = marginPct(grand, cost);

  const save = (opts: { print?: boolean; send?: boolean } = {}) =>
    startSave(async () => {
      const lines = rooms.flatMap(quickRoomLines).filter((l) => l.description.trim());
      if (!lines.length) {
        toast.error("Pick a flooring type and enter a size first.");
        return;
      }
      const res = await createSmartEstimate({
        customerId,
        title,
        taxRate: 8,
        lines,
        presentation,
        print: opts.print,
        send: opts.send,
      });
      if (res?.error) toast.error(res.error);
      // success redirects (editor, or the dashboard after Save & send)
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs text-muted-foreground">Estimate title</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`Flooring for ${customerName}`}
            className="max-w-md"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Target margin %</label>
          <Input
            value={marginGoal}
            onChange={(e) => setMarginGoal(e.target.value)}
            inputMode="decimal"
            className="h-9 w-20"
          />
        </div>
      </div>

      {rooms.map((r, idx) => {
        const profile = profileFor(r.type);
        const sqft = roomSqft(r);
        const sqyd = r2(sqft / 9);
        const lines = quickRoomLines(r);
        const roomTotal = lines.reduce((s, l) => s + lineSell(l), 0);
        const roomCost = lines.reduce((s, l) => s + lineCost(l), 0);
        const m = marginPct(roomTotal, roomCost);
        const unitLabel = profile?.unit === "sqyd" ? "yd" : "ft";
        return (
          <Card key={r.id} className="border-primary/20">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {idx + 1}
                </span>
                <Input
                  value={r.name}
                  onChange={(e) => update(r.id, { name: e.target.value })}
                  placeholder="Room (e.g. Living room)"
                  className="h-9 flex-1"
                />
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Copy room" onClick={() => duplicateRoom(r.id)}>
                  <Copy className="size-4" />
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

              {/* Flooring type chips */}
              <div className="flex flex-wrap gap-1.5">
                {FLOORING_TYPES.map((t) => {
                  const p = profileFor(t)!;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => update(r.id, { type: t })}
                      className={cn(
                        "rounded-md border px-2.5 py-1 text-xs transition-colors",
                        r.type === t ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                      )}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>

              {profile ? (
                <>
                  {/* Size — feet + inches */}
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex items-end gap-1">
                      <FtIn label="Length" ft={r.lengthFt} inch={r.lengthIn}
                        onFt={(v) => update(r.id, { lengthFt: v })} onIn={(v) => update(r.id, { lengthIn: v })} />
                    </div>
                    <span className="pb-2 text-muted-foreground">×</span>
                    <FtIn label="Width" ft={r.widthFt} inch={r.widthIn}
                      onFt={(v) => update(r.id, { widthFt: v })} onIn={(v) => update(r.id, { widthIn: v })} />
                    <div className="pb-1.5 text-sm">
                      <Ruler className="mr-1 inline size-3.5 text-muted-foreground" />
                      <span className="font-medium">{sqft}</span> sq ft
                      {profile.unit === "sqyd" ? <span className="text-muted-foreground"> · {sqyd} sq yd</span> : null}
                    </div>
                  </div>

                  {/* Material */}
                  <ProductPicker
                    value={r.productId ?? ""}
                    initialLabel={r.productLabel}
                    onPick={(p) => pickProduct(r.id, p)}
                    onCreated={(p) => pickProduct(r.id, p)}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <CostSell
                      label={`Material /${unitLabel}`}
                      cost={r.matCost}
                      sell={r.matSell}
                      onCost={(v) => update(r.id, { matCost: v, ...(num(v) > 0 ? { matSell: String(sellAt(num(v))) } : {}) })}
                      onSell={(v) => update(r.id, { matSell: v })}
                    />
                    {/* Install toggle */}
                    <Toggle on={r.install} onToggle={() => update(r.id, { install: !r.install })} label="Install labor">
                      <CostSell
                        compact
                        label={`Install /${unitLabel}`}
                        cost={r.instCost}
                        sell={r.instSell}
                        onCost={(v) => update(r.id, { instCost: v, ...(num(v) > 0 ? { instSell: String(sellAt(num(v))) } : {}) })}
                        onSell={(v) => update(r.id, { instSell: v })}
                      />
                    </Toggle>
                  </div>

                  {/* Pad — carpet only */}
                  {profile.category === "carpet" ? (
                    <Toggle on={r.pad} onToggle={() => update(r.id, { pad: !r.pad })} label="Carpet pad">
                      <CostSell
                        compact
                        label="Pad /yd"
                        cost={r.padCost}
                        sell={r.padSell}
                        onCost={(v) => update(r.id, { padCost: v, ...(num(v) > 0 ? { padSell: String(sellAt(num(v))) } : {}) })}
                        onSell={(v) => update(r.id, { padSell: v })}
                      />
                    </Toggle>
                  ) : null}

                  <div className="flex items-center justify-between border-t pt-2 text-sm">
                    <span className={cn("text-xs", roomCost > 0 && m < goal - 0.5 ? "text-amber-600" : "text-muted-foreground")}>
                      {roomCost > 0 ? `${Math.round(m)}% margin` : ""}
                    </span>
                    <span>
                      Room total: <span className="font-semibold">{formatMoney(roomTotal)}</span>
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Pick a flooring type to set it up.</p>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Button type="button" variant="outline" onClick={() => setRooms((rs) => [...rs, newRoom()])}>
        <Plus className="size-4" /> Add another room
      </Button>

      {/* Sticky summary */}
      <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-lg md:bottom-4">
        <div className="flex items-center gap-6">
          <div>
            <div className="text-xs text-muted-foreground">Estimate total</div>
            <div className="text-xl font-bold">{formatMoney(grand)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Margin</div>
            <div className={cn("text-lg font-semibold", margin < goal - 0.5 && grand > 0 && "text-amber-600")}>
              {Math.round(margin)}%
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Customer sees</div>
            <div className="flex gap-1">
              {([["detailed", "Itemized"], ["summary", "Lump sum"]] as ["detailed" | "summary", string][]).map(([v, lbl]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setPresentation(v)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs",
                    presentation === v ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" size="lg" onClick={() => save({ print: true })} disabled={saving}>
            <Printer className="size-4" /> Print
          </Button>
          <Button type="button" variant="outline" size="lg" onClick={() => save()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button type="button" size="lg" onClick={() => save({ send: true })} disabled={saving}>
            <Send className="size-4" /> Save &amp; send
          </Button>
        </div>
      </div>
    </div>
  );
}

function FtIn({
  label, ft, inch, onFt, onIn,
}: {
  label: string; ft: string; inch: string; onFt: (v: string) => void; onIn: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <div className="flex items-end gap-1">
        <Input value={ft} onChange={(e) => onFt(e.target.value)} inputMode="decimal" placeholder="ft" className="h-9 w-14" />
        <span className="pb-2 text-xs text-muted-foreground">ft</span>
        <Input value={inch} onChange={(e) => onIn(e.target.value)} inputMode="decimal" placeholder="in" className="h-9 w-12" />
        <span className="pb-2 text-xs text-muted-foreground">in</span>
      </div>
    </div>
  );
}

function CostSell({
  label, cost, sell, onCost, onSell, compact,
}: {
  label: string; cost: string; sell: string; onCost: (v: string) => void; onSell: (v: string) => void; compact?: boolean;
}) {
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

function Toggle({
  on, onToggle, label, children,
}: {
  on: boolean; onToggle: () => void; label: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border p-2">
      <label className="flex items-center gap-2 text-xs font-medium">
        <input type="checkbox" checked={on} onChange={onToggle} className="size-4 rounded border-input" />
        {label}
      </label>
      {on ? <div className="mt-1.5">{children}</div> : null}
    </div>
  );
}
