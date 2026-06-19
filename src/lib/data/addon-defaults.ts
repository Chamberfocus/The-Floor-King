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
