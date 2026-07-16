// READ-ONLY report + corrective SQL for the "per-container item priced by area"
// bug. (1) Catalog products whose unit is sq ft/yd but that read as per-container
// (adhesive / gallon / pail…) — emits an idempotent UPDATE to fix them. (2) The
// estimates that currently have such an item priced by area, for manual review.
// Nothing is modified.
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("="); process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { isAreaUnit, inferUnit, normalizeUnit } from "@/lib/units";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function all(table: string, cols: string): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const products = await all("products", "id, name, unit, category, material_rate");
// A product is MISLABELED when its stored unit bills by area but the name reads
// as a container and its inferred unit is per-item.
const mislabeled = products.filter((p) => {
  if (!isAreaUnit(p.unit)) return false;
  const want = inferUnit(p.name, null, p.category);
  return !isAreaUnit(want);
});
console.log(`\n=== CATALOG: ${mislabeled.length} products mislabeled as area (should be per-item) ===`);
const targetOf = (p: any) => normalizeUnit(inferUnit(p.name, null, p.category));
for (const p of mislabeled) console.log(`  ${p.name}  [${p.category}]  unit='${p.unit}' → '${targetOf(p)}'  ($${p.material_rate})`);

if (mislabeled.length) {
  // Group by the CORRECT inferred unit (adhesives → each, trim → lnft) so each
  // product lands on the right unit, not a blanket value.
  const byUnit = new Map<string, string[]>();
  for (const p of mislabeled) {
    const u = targetOf(p);
    (byUnit.get(u) ?? byUnit.set(u, []).get(u)!).push(p.id);
  }
  console.log(`\n--- CORRECTIVE SQL (review, then run) ---`);
  for (const [u, ids] of byUnit) {
    console.log(`update public.products set unit = '${u}'\nwhere id in (\n  ${ids.map((i) => `'${i}'`).join(",\n  ")}\n);\n`);
  }
}

// Real per-item unit for a product id (current, or inferred if still mislabeled).
const realUnit = new Map<string, string>();
for (const p of products) {
  const u = !isAreaUnit(p.unit) ? normalizeUnit(p.unit) : normalizeUnit(inferUnit(p.name, null, p.category));
  realUnit.set(p.id, u);
}
const nameById = new Map(products.map((p) => [p.id, p.name]));

const lines = await all("estimate_line_items", "id, option_id, description, unit, quantity, sqft, product_id, material_rate");
const bad = lines.filter((l) => {
  if (!l.product_id) return false;
  const real = realUnit.get(l.product_id);
  if (!real || isAreaUnit(real)) return false; // product is per-item…
  if (!isAreaUnit(l.unit)) return false; // …but the line is priced by area
  return Number(l.quantity) > 20 || Number(l.sqft) > 20; // an area was used
});

// Map option → estimate → customer.
const optIds = [...new Set(bad.map((l) => l.option_id))];
const opts = optIds.length ? await all("estimate_options", "id, estimate_id") : [];
const estOfOpt = new Map(opts.map((o) => [o.id, o.estimate_id]));
const estIds = [...new Set(bad.map((l) => estOfOpt.get(l.option_id)).filter(Boolean))];
const ests = estIds.length ? (await all("estimates", "id, title, status, customer_id")).filter((e) => estIds.includes(e.id)) : [];
const custs = ests.length ? await all("customers", "id, full_name") : [];
const custName = new Map(custs.map((c) => [c.id, c.full_name]));

console.log(`\n=== ESTIMATES with a per-item material priced by AREA: ${estIds.length} ===`);
for (const e of ests) {
  console.log(`\n  • "${e.title}"  [${e.status}]  — ${custName.get(e.customer_id) ?? "?"}   (estimate ${e.id})`);
  for (const l of bad.filter((b) => estOfOpt.get(b.option_id) === e.id)) {
    const wrong = Math.round(Number(l.quantity || l.sqft) * Number(l.material_rate));
    console.log(`      "${l.description}"  ${l.quantity ?? l.sqft} ${l.unit} × $${l.material_rate} ≈ $${wrong.toLocaleString()}  (product sold by the ${realUnit.get(l.product_id)})`);
  }
}
console.log("");
process.exit(0);
