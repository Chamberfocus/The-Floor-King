"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FLOORING_TYPES, profileFor } from "@/lib/flooring-profiles";
import { ALL_ADDON_DEFS, type AddonDef } from "@/lib/addons";
import {
  saveRoomDefault,
  deleteRoomDefault,
  saveAddonDefault,
  deleteAddonDefault,
} from "@/app/(app)/estimates/smart-actions";
import type { RoomDefault, AddonDefault } from "@/lib/data/addon-defaults";

const n = (v: string) => {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};
const s = (v: number | null) => (v == null ? "" : String(v));

const UNITS = ["each", "sqft", "sqyd", "lnft", "step", "room"];

export function DefaultPricing({
  roomDefaults,
  addonDefaults,
}: {
  roomDefaults: Record<string, RoomDefault>;
  addonDefaults: Record<string, AddonDefault>;
}) {
  const known = new Set(ALL_ADDON_DEFS.map((d) => d.label));
  const extra: AddonDef[] = Object.keys(addonDefaults)
    .filter((l) => !known.has(l))
    .map((l) => ({
      label: l,
      unit: addonDefaults[l].unit || "each",
      labor: addonDefaults[l].labor,
    }));
  const addonRows = [...ALL_ADDON_DEFS, ...extra];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Flooring rates (per type)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-2 py-2 text-left font-medium">Type</th>
                <th className="px-2 py-2 text-left font-medium">Mat. cost</th>
                <th className="px-2 py-2 text-left font-medium">Mat. sell</th>
                <th className="px-2 py-2 text-left font-medium">Labor cost</th>
                <th className="px-2 py-2 text-left font-medium">Labor sell</th>
                <th className="px-2 py-2 text-left font-medium">Waste %</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {FLOORING_TYPES.map((t) => (
                <RoomRow
                  key={t}
                  category={t}
                  label={profileFor(t)?.label ?? t}
                  def={roomDefaults[t]}
                />
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add-ons &amp; pad</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-2 py-2 text-left font-medium">Item</th>
                <th className="px-2 py-2 text-left font-medium">Unit</th>
                <th className="px-2 py-2 text-left font-medium">Cost</th>
                <th className="px-2 py-2 text-left font-medium">Sell</th>
                <th className="px-2 py-2 text-left font-medium">Labor</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {addonRows.map((d) => (
                <AddonRow key={d.label} def={d} saved={addonDefaults[d.label]} />
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function Cell({
  value,
  onChange,
  w = "w-20",
}: {
  value: string;
  onChange: (v: string) => void;
  w?: string;
}) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      inputMode="decimal"
      placeholder="—"
      className={`h-8 ${w}`}
    />
  );
}

function RoomRow({
  category,
  label,
  def,
}: {
  category: string;
  label: string;
  def?: RoomDefault;
}) {
  const [mc, setMc] = useState(s(def?.materialCost ?? null));
  const [ms, setMs] = useState(s(def?.materialSell ?? null));
  const [lc, setLc] = useState(s(def?.laborCost ?? null));
  const [ls, setLs] = useState(s(def?.laborSell ?? null));
  const [w, setW] = useState(s(def?.waste ?? null));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const res = await saveRoomDefault({
      category,
      materialCost: n(mc),
      materialSell: n(ms),
      laborCost: n(lc),
      laborSell: n(ls),
      waste: n(w),
    });
    setBusy(false);
    if (res?.error) toast.error(res.error);
    else toast.success(`Saved ${label} defaults`);
  };
  const clear = async () => {
    await deleteRoomDefault(category);
    setMc("");
    setMs("");
    setLc("");
    setLs("");
    setW("");
    toast.success("Cleared");
  };

  return (
    <tr className="border-b last:border-0">
      <td className="px-2 py-1.5 font-medium">{label}</td>
      <td className="px-2 py-1.5"><Cell value={mc} onChange={setMc} /></td>
      <td className="px-2 py-1.5"><Cell value={ms} onChange={setMs} /></td>
      <td className="px-2 py-1.5"><Cell value={lc} onChange={setLc} /></td>
      <td className="px-2 py-1.5"><Cell value={ls} onChange={setLs} /></td>
      <td className="px-2 py-1.5"><Cell value={w} onChange={setW} w="w-14" /></td>
      <td className="px-2 py-1.5 text-right">
        <div className="flex justify-end gap-1">
          <Button type="button" size="sm" onClick={save} disabled={busy}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={clear}>
            Clear
          </Button>
        </div>
      </td>
    </tr>
  );
}

function AddonRow({ def, saved }: { def: AddonDef; saved?: AddonDefault }) {
  const [unit, setUnit] = useState(saved?.unit || def.unit);
  const [cost, setCost] = useState(s(saved?.cost ?? null));
  const [sell, setSell] = useState(s(saved?.sell ?? null));
  const [labor, setLabor] = useState(saved ? saved.labor : def.labor);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const res = await saveAddonDefault({
      label: def.label,
      unit,
      cost: n(cost),
      sell: n(sell),
      labor,
    });
    setBusy(false);
    if (res?.error) toast.error(res.error);
    else toast.success(`Saved ${def.label}`);
  };
  const clear = async () => {
    await deleteAddonDefault(def.label);
    setCost("");
    setSell("");
    toast.success("Cleared");
  };

  return (
    <tr className="border-b last:border-0">
      <td className="px-2 py-1.5 font-medium">{def.label}</td>
      <td className="px-2 py-1.5">
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          className="h-8 rounded-md border border-input bg-transparent px-1 text-xs"
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5"><Cell value={cost} onChange={setCost} w="w-16" /></td>
      <td className="px-2 py-1.5"><Cell value={sell} onChange={setSell} w="w-16" /></td>
      <td className="px-2 py-1.5">
        <input
          type="checkbox"
          checked={labor}
          onChange={(e) => setLabor(e.target.checked)}
          className="size-4 rounded border-input"
        />
      </td>
      <td className="px-2 py-1.5 text-right">
        <div className="flex justify-end gap-1">
          <Button type="button" size="sm" onClick={save} disabled={busy}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={clear}>
            Clear
          </Button>
        </div>
      </td>
    </tr>
  );
}
