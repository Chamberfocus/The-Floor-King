import { createClient } from "@/lib/supabase/server";

export interface AddonDefault {
  unit: string | null;
  cost: number | null;
  sell: number | null;
  labor: boolean;
}

/**
 * Saved default pricing for estimate add-ons, keyed by label. Resilient: if the
 * table isn't there yet (migration not run), returns {} so the builder still
 * works — it just won't pre-fill.
 */
export async function getAddonDefaults(): Promise<Record<string, AddonDefault>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("addon_defaults")
      .select("label, unit, cost, sell, labor");
    if (error || !data) return {};
    const out: Record<string, AddonDefault> = {};
    for (const r of data) {
      out[r.label as string] = {
        unit: (r.unit as string) ?? null,
        cost: r.cost == null ? null : Number(r.cost),
        sell: r.sell == null ? null : Number(r.sell),
        labor: !!r.labor,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export interface RoomDefault {
  materialCost: number | null;
  materialSell: number | null;
  laborCost: number | null;
  laborSell: number | null;
  waste: number | null;
}

/** Saved default pricing per flooring category. Resilient (returns {} if absent). */
export async function getRoomDefaults(): Promise<Record<string, RoomDefault>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("room_defaults")
      .select("category, material_cost, material_sell, labor_cost, labor_sell, waste");
    if (error || !data) return {};
    const num = (v: unknown) => (v == null ? null : Number(v));
    const out: Record<string, RoomDefault> = {};
    for (const r of data) {
      out[r.category as string] = {
        materialCost: num(r.material_cost),
        materialSell: num(r.material_sell),
        laborCost: num(r.labor_cost),
        laborSell: num(r.labor_sell),
        waste: num(r.waste),
      };
    }
    return out;
  } catch {
    return {};
  }
}

// --- Single add-on catalog (one source of truth) ---------------------------

import { ALL_ADDON_DEFS, type AddonDef } from "@/lib/addons";

export interface AddonCatalogItem extends AddonDef {
  cost: number | null;
  sell: number | null;
  custom: boolean; // true = added in Default pricing (not a built-in def)
}

/**
 * THE add-on catalog the whole app reads: the built-in defs (addons.ts) overlaid
 * with saved pricing, PLUS any custom add-ons created in Settings → Default
 * pricing (extra addon_defaults labels). This is the single source of truth —
 * the old "Quote add-ons" (wizard_questions) list is retired.
 */
export async function listAddonCatalog(): Promise<AddonCatalogItem[]> {
  const defaults = await getAddonDefaults();
  const known = new Set(ALL_ADDON_DEFS.map((d) => d.label));
  const base: AddonCatalogItem[] = ALL_ADDON_DEFS.map((d) => ({
    ...d,
    unit: defaults[d.label]?.unit || d.unit,
    labor: defaults[d.label]?.labor ?? d.labor,
    cost: defaults[d.label]?.cost ?? null,
    sell: defaults[d.label]?.sell ?? null,
    custom: false,
  }));
  const custom: AddonCatalogItem[] = Object.keys(defaults)
    .filter((l) => !known.has(l))
    .sort((a, b) => a.localeCompare(b))
    .map((l) => ({
      label: l,
      unit: defaults[l].unit || "each",
      labor: defaults[l].labor,
      cost: defaults[l].cost ?? null,
      sell: defaults[l].sell ?? null,
      custom: true,
    }));
  return [...base, ...custom];
}
