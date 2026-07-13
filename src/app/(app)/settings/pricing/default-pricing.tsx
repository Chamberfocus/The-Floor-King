"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
        <CardContent className="space-y-2">
          {FLOORING_TYPES.map((t) => (
            <RoomRow
              key={t}
              category={t}
              label={profileFor(t)?.label ?? t}
              def={roomDefaults[t]}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add-ons &amp; pad</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <NewAddon />
          {addonRows.map((d) => (
            <AddonRow key={d.label} def={d} saved={addonDefaults[d.label]} custom={extra.some((e) => e.label === d.label)} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** Create a brand-new custom add-on — it becomes part of the single add-on
 *  catalog (this page + the estimate builder's Add-on menu), pre-priced. */
function NewAddon() {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [unit, setUnit] = useState("each");
  const [labor, setLabor] = useState(false);
  const [cost, setCost] = useState("");
  const [sell, setSell] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!label.trim()) {
      toast.error("Name the add-on.");
      return;
    }
    setBusy(true);
    const res = await saveAddonDefault({
      label: label.trim(),
      unit,
      cost: n(cost),
      sell: n(sell),
      labor,
    });
    setBusy(false);
    if (res?.error) {
      toast.error(res.error);
      return;
    }
    toast.success(`Added ${label.trim()}`);
    setLabel("");
    setCost("");
    setSell("");
    router.refresh();
  };
  return (
    <div className="rounded-lg border border-dashed p-3">
      <div className="mb-2 text-sm font-medium">Add a custom add-on</div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <div className="mb-0.5 text-xs text-muted-foreground">Name</div>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Radiant heat mat"
            className="h-9"
          />
        </div>
        <div>
          <div className="mb-0.5 text-xs text-muted-foreground">Unit</div>
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <LabeledCell label="Cost" value={cost} onChange={setCost} w="w-20" />
        <LabeledCell label="Sell" value={sell} onChange={setSell} w="w-20" />
        <label className="flex items-center gap-1.5 pb-2 text-sm">
          <input
            type="checkbox"
            checked={labor}
            onChange={(e) => setLabor(e.target.checked)}
          />
          Labor
        </label>
        <Button type="button" size="sm" onClick={create} disabled={busy}>
          {busy ? "Adding…" : "Add add-on"}
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Custom add-ons show up in the estimate builder&apos;s Add-on menu, pre-priced.
      </p>
    </div>
  );
}

/** A labeled numeric field — label sits above the input so it reads on a phone. */
function LabeledCell({
  label,
  value,
  onChange,
  w = "w-24",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  w?: string;
}) {
  return (
    <div>
      <div className="mb-0.5 text-xs text-muted-foreground">{label}</div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        placeholder="—"
        className={`h-9 ${w}`}
      />
    </div>
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
  const [w, setW] = useState(s(def?.waste ?? null));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const res = await saveRoomDefault({
      category,
      materialCost: n(mc),
      materialSell: n(ms),
      laborCost: 0,
      laborSell: 0,
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
    setW("");
    toast.success("Cleared");
  };

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 font-medium">{label}</div>
      <div className="flex flex-wrap items-end gap-3">
        <LabeledCell label="Mat. cost" value={mc} onChange={setMc} />
        <LabeledCell label="Mat. sell" value={ms} onChange={setMs} />
        <LabeledCell label="Waste %" value={w} onChange={setW} w="w-20" />
        <div className="flex gap-1">
          <Button type="button" size="sm" onClick={save} disabled={busy}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={clear}>
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddonRow({
  def,
  saved,
  custom = false,
}: {
  def: AddonDef;
  saved?: AddonDefault;
  custom?: boolean;
}) {
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
    <div className="rounded-lg border p-3">
      <div className="mb-2 font-medium">
        {def.label}
        {custom ? (
          <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-300">
            custom
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="mb-0.5 text-xs text-muted-foreground">Unit</div>
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <LabeledCell label="Cost" value={cost} onChange={setCost} w="w-20" />
        <LabeledCell label="Sell" value={sell} onChange={setSell} w="w-20" />
        <label className="flex items-center gap-1.5 pb-2 text-sm">
          <input
            type="checkbox"
            checked={labor}
            onChange={(e) => setLabor(e.target.checked)}
            className="size-4 rounded border-input"
          />
          Labor
        </label>
        <div className="flex gap-1">
          <Button type="button" size="sm" onClick={save} disabled={busy}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={clear}>
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}
