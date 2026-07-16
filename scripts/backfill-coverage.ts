// READ-ONLY: scans the catalog for products whose name carries a coverage spec
// ("28 SF @ 1/4\"") and emits an idempotent UPDATE to pre-fill coverage_sqft +
// coverage_thickness_in. Nothing is modified — review the SQL, then run it.
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("="); process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { parseCoverage } from "@/lib/units";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function all(): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("products").select("id, name").range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const products = await all();
const hits = products
  .map((p) => ({ p, cov: parseCoverage(p.name) }))
  .filter((x) => x.cov); // name carries a coverage spec (UPDATE is idempotent)

console.log(`\n=== ${hits.length} products with a parseable coverage spec (not yet set) ===`);
for (const { p, cov } of hits) console.log(`  ${p.name}  → ${cov!.coverage_sqft} SF @ ${cov!.coverage_thickness_in}"`);

if (hits.length) {
  console.log("\n--- BACKFILL SQL (review, then run) ---");
  for (const { p, cov } of hits) {
    console.log(`update public.products set coverage_sqft = ${cov!.coverage_sqft}, coverage_thickness_in = ${cov!.coverage_thickness_in} where id = '${p.id}';`);
  }
}
console.log("");
process.exit(0);
