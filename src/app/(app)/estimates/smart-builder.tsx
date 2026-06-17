"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Ruler, Layers, Sparkles } from "lucide-react";
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
} from "@/lib/flooring-profiles";
import type { Product } from "@/lib/types";
import { ProductPicker } from "./product-picker";
import { createSmartEstimate, type SmartLine } from "./smart-actions";

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

interface CompState {
  on: boolean;
  rate: string;
}
interface Room {
  id: string;
  name: string;
  type: string; // category
  length: string;
  width: string;
  productId: string | null;
  productLabel: string;
  manufacturer: string | null;
  style: string | null;
  color: string | null;
  materialRate: string; // sell per unit
  materialCost: string; // our cost per unit
  laborRate: string;
  waste: string;
  comps: Record<string, CompState>;
}

let seq = 0;
const newRoom = (): Room => ({
  id: `r${seq++}`,
  name: "",
  type: "",
  length: "",
  width: "",
  productId: null,
  productLabel: "",
  manufacturer: null,
  style: null,
  color: null,
  materialRate: "",
  materialCost: "",
  laborRate: "",
  waste: "",
  comps: {},
});

/** Build the line items a room produces (main + companions) — preview & save. */
function roomLines(r: Room): SmartLine[] {
  const profile = profileFor(r.type);
  if (!profile) return [];
  const sqft = areaSqft(num(r.length), num(r.width));
  const perimeter = 2 * (num(r.length) + num(r.width));
  const out: SmartLine[] = [];

  // Main material line
  out.push({
    room: r.name || null,
    description: r.productLabel || profile.label,
    category: profile.category,
    measure_unit: profile.unit,
    sqft: sqft > 0 ? sqft : null,
    quantity: null,
    unit: profile.unit === "sqyd" ? "sq yd" : "sq ft",
    material_rate: num(r.materialRate),
    labor_rate: num(r.laborRate),
    material_cost: num(r.materialCost),
    waste_pct: num(r.waste) || profile.waste,
    product_id: r.productId,
    manufacturer: r.manufacturer,
    style: r.style,
    color: r.color,
  });

  // Companion lines (the ones turned on)
  for (const c of profile.companions) {
    const st = r.comps[c.key];
    if (!st?.on) continue;
    const qty = companionQty(c, sqft, perimeter);
    const rate = num(st.rate);
    out.push({
      room: r.name || null,
      description: c.label,
      category: c.category,
      measure_unit: c.unit === "sqyd" ? "sqyd" : "sqft",
      sqft: c.sizeBy === "area" ? (sqft > 0 ? sqft : null) : null,
      quantity: qty > 0 ? qty : null,
      unit: c.unit,
      material_rate: c.labor ? 0 : rate,
      labor_rate: c.labor ? rate : 0,
      material_cost: 0,
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
  const mat = qty * l.material_rate * (1 + l.waste_pct / 100);
  const lab = qty * l.labor_rate;
  return mat + lab;
}
function lineCost(l: SmartLine): number {
  const qty =
    l.quantity && l.quantity > 0
      ? l.quantity
      : l.measure_unit === "sqyd"
        ? (l.sqft ?? 0) / 9
        : (l.sqft ?? 0);
  return qty * l.material_cost * (1 + l.waste_pct / 100);
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
  const [saving, startSave] = useTransition();

  const update = (id: string, patch: Partial<Room>) =>
    setRooms((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const chooseType = (id: string, type: string) => {
    const p = profileFor(type)!;
    const comps: Record<string, CompState> = {};
    for (const c of p.companions) comps[c.key] = { on: c.defaultOn, rate: "" };
    update(id, { type, waste: String(p.waste), comps });
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

  const allLines = useMemo(() => rooms.flatMap(roomLines), [rooms]);
  const grand = allLines.reduce((s, l) => s + lineSell(l), 0);
  const cost = allLines.reduce((s, l) => s + lineCost(l), 0);
  const margin = marginPct(grand, cost);

  const save = () =>
    startSave(async () => {
      const lines = rooms.flatMap(roomLines).filter((l) => l.description.trim());
      if (!lines.length) {
        toast.error("Pick a flooring type and add a room first.");
        return;
      }
      const res = await createSmartEstimate({
        customerId,
        title,
        taxRate: 8,
        lines,
      });
      if (res?.error) toast.error(res.error);
      // success redirects
    });

  return (
    <div className="space-y-5">
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
      </div>

      {rooms.map((r, idx) => {
        const profile = profileFor(r.type);
        const sqft = areaSqft(num(r.length), num(r.width));
        const sqyd = Math.round((sqft / 9) * 100) / 100;
        const lines = roomLines(r);
        const roomTotal = lines.reduce((s, l) => s + lineSell(l), 0);
        return (
          <Card key={r.id} className="border-primary/20">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
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
              {rooms.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setRooms((rs) => rs.filter((x) => x.id !== r.id))}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4">
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
                          "rounded-lg border px-3 py-1.5 text-sm transition-colors",
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
                        className="h-9 w-24"
                      />
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
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <PriceField
                        label={`Our cost /${profile.unit === "sqyd" ? "yd" : "ft"}`}
                        value={r.materialCost}
                        onChange={(v) => update(r.id, { materialCost: v })}
                      />
                      <PriceField
                        label={`Sell /${profile.unit === "sqyd" ? "yd" : "ft"}`}
                        value={r.materialRate}
                        onChange={(v) => update(r.id, { materialRate: v })}
                      />
                      <PriceField
                        label={`Labor /${profile.unit === "sqyd" ? "yd" : "ft"}`}
                        value={r.laborRate}
                        onChange={(v) => update(r.id, { laborRate: v })}
                      />
                      <PriceField
                        label="Waste %"
                        value={r.waste}
                        onChange={(v) => update(r.id, { waste: v })}
                      />
                    </div>
                  </div>

                  {/* Companions */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      This {profile.label.toLowerCase()} job also needs:
                    </label>
                    <div className="space-y-1.5">
                      {profile.companions.map((c) => {
                        const st = r.comps[c.key] ?? { on: false, rate: "" };
                        const qty = companionQty(
                          c,
                          sqft,
                          2 * (num(r.length) + num(r.width)),
                        );
                        return (
                          <div
                            key={c.key}
                            className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                          >
                            <label className="flex flex-1 items-center gap-2">
                              <input
                                type="checkbox"
                                checked={st.on}
                                onChange={(e) =>
                                  update(r.id, {
                                    comps: {
                                      ...r.comps,
                                      [c.key]: { ...st, on: e.target.checked },
                                    },
                                  })
                                }
                                className="size-4 rounded border-input"
                              />
                              <span className={cn(!st.on && "text-muted-foreground")}>
                                {c.label}
                                {st.on ? (
                                  <span className="ml-1 text-xs text-muted-foreground">
                                    {qty} {c.unit}
                                    {c.labor ? " · labor" : ""}
                                  </span>
                                ) : c.hint ? (
                                  <span className="ml-1 text-xs text-muted-foreground">
                                    {c.hint}
                                  </span>
                                ) : null}
                              </span>
                            </label>
                            {st.on ? (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                $
                                <Input
                                  value={st.rate}
                                  onChange={(e) =>
                                    update(r.id, {
                                      comps: {
                                        ...r.comps,
                                        [c.key]: { ...st, rate: e.target.value },
                                      },
                                    })
                                  }
                                  inputMode="decimal"
                                  placeholder="0.00"
                                  className="h-7 w-20"
                                />
                                /{c.unit}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
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
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        placeholder="0"
        className="h-9"
      />
    </div>
  );
}
