import { createClient } from "@/lib/supabase/server";
import { listJobs } from "@/lib/data/jobs";
import {
  lineTotal,
  lineCost,
  lineQty,
  marginPct,
  type CalcLine,
} from "@/lib/estimate-calc";
import { daysIdle } from "@/lib/data/inventory";
import type { Product } from "@/lib/types";

export interface ProductPerf {
  productId: string;
  name: string;
  manufacturer: string | null;
  category: string | null;
  jobs: number; // how many jobs used it
  units: number; // total quantity sold (sqft/sqyd/each)
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
}

interface PerfLine extends CalcLine {
  product_id: string | null;
}

/**
 * Aggregate every product that has appeared on a SOLD job (an estimate option
 * that became a job), so we can see what actually sells and what earns.
 */
export async function getProductPerformance(): Promise<ProductPerf[]> {
  const supabase = await createClient();
  const jobs = (await listJobs()).filter((j) => j.option_id);
  if (!jobs.length) return [];

  const optionIds = [...new Set(jobs.map((j) => j.option_id))] as string[];
  // How many distinct jobs map to each option (to count product usage by job).
  const jobsPerOption = new Map<string, number>();
  for (const j of jobs) {
    if (j.option_id)
      jobsPerOption.set(j.option_id, (jobsPerOption.get(j.option_id) ?? 0) + 1);
  }

  const { data } = await supabase
    .from("estimate_line_items")
    .select(
      "option_id, product_id, line_type, sqft, length_in, width_in, measure_unit, material_rate, labor_rate, installed_rate, flat_amount, waste_pct, material_cost, labor_cost, quantity, unit",
    )
    .in("option_id", optionIds)
    .not("product_id", "is", null);
  const rows = (data ?? []) as (PerfLine & { option_id: string })[];
  if (!rows.length) return [];

  const ids = [...new Set(rows.map((r) => r.product_id))].filter(
    Boolean,
  ) as string[];
  const { data: prods } = await supabase
    .from("products")
    .select("id, name, manufacturer, category")
    .in("id", ids);
  const meta = new Map<
    string,
    { name: string; manufacturer: string | null; category: string | null }
  >();
  for (const p of prods ?? []) {
    meta.set(p.id as string, {
      name: (p.name as string) ?? "Product",
      manufacturer: (p.manufacturer as string) ?? null,
      category: (p.category as string) ?? null,
    });
  }

  const agg = new Map<string, ProductPerf>();
  for (const r of rows) {
    const pid = r.product_id;
    if (!pid) continue;
    const m = meta.get(pid);
    const cur =
      agg.get(pid) ??
      ({
        productId: pid,
        name: m?.name ?? "Product",
        manufacturer: m?.manufacturer ?? null,
        category: m?.category ?? null,
        jobs: 0,
        units: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
        margin: 0,
      } satisfies ProductPerf);
    cur.units += lineQty(r);
    cur.revenue += lineTotal(r);
    cur.cost += lineCost(r);
    cur.jobs += jobsPerOption.get(r.option_id) ?? 1;
    agg.set(pid, cur);
  }

  const out = [...agg.values()].map((p) => ({
    ...p,
    profit: p.revenue - p.cost,
    margin: marginPct(p.revenue, p.cost),
  }));
  // Default sort: most revenue first.
  return out.sort((a, b) => b.revenue - a.revenue);
}

export interface DeadStockItem {
  product: Product;
  idleDays: number;
  value: number; // on_hand × cost
}

/**
 * Stock that's sitting: tracked, on hand, idle past the aged threshold and/or
 * never sold. Sorted by tied-up cash, worst first.
 */
export async function getDeadStock(minDays = 90): Promise<DeadStockItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("*")
    .eq("track_stock", true)
    .gt("on_hand", 0);
  const items = (data ?? []) as Product[];
  return items
    .map((p) => ({
      product: p,
      idleDays: daysIdle(p),
      value: p.on_hand * (p.material_rate || 0),
    }))
    .filter((d) => d.idleDays >= minDays)
    .sort((a, b) => b.value - a.value);
}
