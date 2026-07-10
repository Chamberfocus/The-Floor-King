import { createClient } from "@/lib/supabase/server";
import type { StockRoll } from "@/lib/types";

type Db = Awaited<ReturnType<typeof createClient>>;

const round = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Rolls + remnants for a product (available first, then depleted/scrapped). */
export async function listRolls(
  productId: string,
  dbArg?: Db,
): Promise<StockRoll[]> {
  try {
    const db = dbArg ?? (await createClient());
    const { data } = await db
      .from("stock_rolls")
      .select("*")
      .eq("product_id", productId)
      .order("status", { ascending: true })
      .order("created_at", { ascending: false });
    return (data ?? []) as StockRoll[];
  } catch {
    return [];
  }
}

export interface RemnantWithProduct extends StockRoll {
  product_name: string | null;
}

async function withNames(db: Db, rolls: StockRoll[]): Promise<RemnantWithProduct[]> {
  const ids = [...new Set(rolls.map((r) => r.product_id))];
  const name = new Map<string, string>();
  if (ids.length) {
    const { data } = await db.from("products").select("id, name, manufacturer, color").in("id", ids);
    for (const p of data ?? [])
      name.set(
        p.id as string,
        [p.manufacturer, p.name, p.color].filter(Boolean).join(" ") || (p.name as string),
      );
  }
  return rolls.map((r) => ({ ...r, product_name: name.get(r.product_id) ?? null }));
}

/** Newly-cut remnants awaiting a location + a reusability call (the banner). */
export async function newRemnants(dbArg?: Db): Promise<RemnantWithProduct[]> {
  try {
    const db = dbArg ?? (await createClient());
    const { data } = await db
      .from("stock_rolls")
      .select("*")
      .eq("needs_shelving", true)
      .eq("status", "available")
      .order("created_at", { ascending: false });
    return withNames(db, (data ?? []) as StockRoll[]);
  } catch {
    return [];
  }
}

/** All live remnants (available), for the remnants list. */
export async function listRemnants(dbArg?: Db): Promise<RemnantWithProduct[]> {
  try {
    const db = dbArg ?? (await createClient());
    const { data } = await db
      .from("stock_rolls")
      .select("*")
      .eq("kind", "remnant")
      .eq("status", "available")
      .order("created_at", { ascending: false })
      .limit(200);
    return withNames(db, (data ?? []) as StockRoll[]);
  } catch {
    return [];
  }
}

/** Find rolls/remnants by location text OR product name — the location search. */
export async function searchStock(query: string, dbArg?: Db): Promise<RemnantWithProduct[]> {
  const term = query.trim();
  if (!term) return [];
  try {
    const db = dbArg ?? (await createClient());
    // Products whose name matches (so a product search also returns its rolls).
    const { data: prods } = await db
      .from("products")
      .select("id")
      .or([`name.ilike.%${term}%`, `manufacturer.ilike.%${term}%`, `sku.ilike.%${term}%`].join(","))
      .limit(30);
    const pids = (prods ?? []).map((p) => p.id as string);
    const orParts = [`location.ilike.%${term}%`];
    let rolls: StockRoll[] = [];
    const { data: byLoc } = await db
      .from("stock_rolls")
      .select("*")
      .eq("status", "available")
      .or(orParts.join(","))
      .limit(100);
    rolls = (byLoc ?? []) as StockRoll[];
    if (pids.length) {
      const { data: byProd } = await db
        .from("stock_rolls")
        .select("*")
        .eq("status", "available")
        .in("product_id", pids)
        .limit(100);
      const seen = new Set(rolls.map((r) => r.id));
      for (const r of (byProd ?? []) as StockRoll[]) if (!seen.has(r.id)) rolls.push(r);
    }
    return withNames(db, rolls);
  } catch {
    return [];
  }
}

/** Available rolled yardage for a product = Σ remaining of available rolls+usable remnants. */
export async function availableRolled(productId: string, dbArg?: Db): Promise<number> {
  try {
    const db = dbArg ?? (await createClient());
    const { data } = await db
      .from("stock_rolls")
      .select("kind, remaining_qty, usable, status")
      .eq("product_id", productId)
      .eq("status", "available");
    let sum = 0;
    for (const r of data ?? []) {
      // Rolls always count; remnants count unless explicitly marked not-usable.
      if (r.kind === "remnant" && r.usable === false) continue;
      sum += Number(r.remaining_qty) || 0;
    }
    return round(sum);
  } catch {
    return 0;
  }
}

export interface ReorderAlert {
  productId: string;
  count: number;
  totalQty: number;
  unit: string;
  items: { qty: number; unit: string; location: string | null; kind: string }[];
}

/**
 * The reorder alert payload: usable remnants + leftover rolls we already have of a
 * product, so ordering can warn "you already have X in [location]". NOTIFY-ONLY —
 * no quantity math. Matched strictly by product_id.
 */
export async function reorderAlertFor(
  productId: string,
  dbArg?: Db,
): Promise<ReorderAlert | null> {
  if (!productId) return null;
  try {
    const db = dbArg ?? (await createClient());
    const { data } = await db
      .from("stock_rolls")
      .select("kind, unit, remaining_qty, usable, location, status")
      .eq("product_id", productId)
      .eq("status", "available")
      .gt("remaining_qty", 0);
    const items = (data ?? [])
      .filter((r) => !(r.kind === "remnant" && r.usable === false))
      .map((r) => ({
        qty: round(Number(r.remaining_qty) || 0),
        unit: (r.unit as string) || "sqyd",
        location: (r.location as string) ?? null,
        kind: r.kind as string,
      }));
    if (!items.length) return null;
    return {
      productId,
      count: items.length,
      totalQty: round(items.reduce((s, i) => s + i.qty, 0)),
      unit: items[0].unit,
      items,
    };
  } catch {
    return null;
  }
}

/** Reorder alerts for many products at once (for a PO with several lines). */
export async function reorderAlertsFor(
  productIds: string[],
  dbArg?: Db,
): Promise<Record<string, ReorderAlert>> {
  const ids = [...new Set(productIds.filter(Boolean))];
  const out: Record<string, ReorderAlert> = {};
  if (!ids.length) return out;
  try {
    const db = dbArg ?? (await createClient());
    const { data } = await db
      .from("stock_rolls")
      .select("product_id, kind, unit, remaining_qty, usable, location, status")
      .in("product_id", ids)
      .eq("status", "available")
      .gt("remaining_qty", 0);
    const byProduct = new Map<string, StockRoll[]>();
    for (const r of (data ?? []) as StockRoll[]) {
      if (r.kind === "remnant" && r.usable === false) continue;
      const a = byProduct.get(r.product_id) ?? [];
      a.push(r);
      byProduct.set(r.product_id, a);
    }
    for (const [pid, rolls] of byProduct) {
      const items = rolls.map((r) => ({
        qty: round(r.remaining_qty),
        unit: r.unit || "sqyd",
        location: r.location ?? null,
        kind: r.kind,
      }));
      out[pid] = {
        productId: pid,
        count: items.length,
        totalQty: round(items.reduce((s, i) => s + i.qty, 0)),
        unit: items[0].unit,
        items,
      };
    }
    return out;
  } catch {
    return out;
  }
}

/**
 * Mirror the sum of a rolled product's available rolls/remnants into
 * products.on_hand, so low-stock and quick displays keep working on one number.
 * (stock_rolls stays the source of truth for rolled goods.)
 */
export async function syncRolledOnHand(productId: string, db: Db): Promise<number> {
  const total = await availableRolled(productId, db);
  await db
    .from("products")
    .update({ on_hand: total, last_movement_at: new Date().toISOString() })
    .eq("id", productId);
  return total;
}
