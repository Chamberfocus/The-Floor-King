// READ-ONLY. Runs the REAL shipping parser over a downloaded 832 and reports
// what it got, including how it would land on our catalog. Writes nothing.
// usage: npx tsx scripts/check-832-parse.ts <path to .832>
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("="); process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { parse832 } from "@/lib/fcb2b";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const path = process.argv[2];
if (!path) {
  console.log("usage: npx tsx scripts/check-832-parse.ts <path to .832>");
  process.exit(1);
}

const parsed = parse832(readFileSync(path, "utf8"));
const priced = parsed.rows.filter((r) => r.cost != null);

console.log(`items parsed ....... ${parsed.rows.length}`);
console.log(`with a price ....... ${priced.length}`);
console.log(`catalog date ....... ${parsed.catalogDate ?? "—"}`);
console.log(`units seen ......... ${[...new Set(parsed.rows.map((r) => r.uom).filter(Boolean))].join(", ")}`);
console.log(`qualifiers ......... ${[...new Set(parsed.rows.map((r) => r.priceQualifier).filter(Boolean))].join(", ")}`);
const withRolls = parsed.rows.filter((r) => r.rollWidthFt != null);
console.log(`roll dimensions .... ${withRolls.length}`);
if (parsed.warnings.length) {
  console.log("\nwarnings:");
  for (const w of parsed.warnings.slice(0, 6)) console.log("  - " + w);
}

console.log("\nsample:");
for (const r of priced.slice(0, 6)) {
  const colors = (r.raw.color_count as number) ?? 0;
  console.log(
    `  ${r.supplierSku.padEnd(10)} $${String(r.cost).padEnd(9)} ${String(r.uom).padEnd(6)} ${String(colors).padStart(2)} colours  ${String(r.description ?? "").slice(0, 36)}`,
  );
}
for (const r of withRolls.slice(0, 3)) {
  console.log(`  ROLL  ${r.supplierSku}  ${r.rollWidthFt}ft x ${r.rollLengthFt}ft  ${String(r.description ?? "").slice(0, 30)}`);
}

async function main() {
  // What would actually land on our catalog?
  const { data: sup } = await db.from("suppliers").select("id").ilike("name", "%shaw%").maybeSingle();
  const products: { id: string; sku: string | null; unit: string | null; material_rate: number | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from("products").select("id, sku, unit, material_rate")
      .eq("supplier_id", sup!.id).range(from, from + 999);
    products.push(...((data ?? []) as typeof products));
    if (!data || data.length < 1000) break;
  }
  const bySku = new Map<string, typeof products>();
  for (const p of products) {
    const k = (p.sku ?? "").trim().toUpperCase();
    if (!k) continue;
    if (!bySku.has(k)) bySku.set(k, []);
    bySku.get(k)!.push(p);
  }

  let lines = 0, wouldChange = 0, unitDiff = 0;
  const unitPairs = new Map<string, number>();
  const changes: string[] = [];
  for (const r of priced) {
    const hits = bySku.get(r.supplierSku.trim().toUpperCase()) ?? [];
    lines += hits.length;
    for (const p of hits) {
      const old = p.material_rate == null ? null : Math.round(Number(p.material_rate) * 10000) / 10000;
      if (old !== Math.round(r.cost! * 10000) / 10000) {
        wouldChange++;
        const pct = old ? ` (${(((r.cost! - old) / old) * 100).toFixed(1)}%)` : "";
        changes.push(
          `    ${r.supplierSku.padEnd(9)} $${String(old ?? "—").padEnd(8)} → $${String(r.cost).padEnd(8)}${pct}  ${String(r.description ?? "").slice(0, 32)}`,
        );
      }
      const ours = (p.unit ?? "").trim().toLowerCase();
      if (r.uom && ours && r.uom !== ours) {
        unitDiff++;
        const key = `theirs ${r.uom} / ours ${ours}`;
        unitPairs.set(key, (unitPairs.get(key) ?? 0) + 1);
      }
    }
  }
  console.log(`\nagainst our catalog:`);
  console.log(`  styles matching a product ...... ${priced.filter((r) => bySku.has(r.supplierSku.trim().toUpperCase())).length}`);
  console.log(`  product lines it would create .. ${lines}`);
  console.log(`  of those, cost would change .... ${wouldChange}`);
  for (const c of changes.slice(0, 15)) console.log(c);
  if (changes.length > 15) console.log(`    … and ${changes.length - 15} more`);
  console.log(`  unit differs (held back) ....... ${unitDiff}`);
  for (const [k, n] of [...unitPairs].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`      ${k}: ${n}`);
  }

}
main();
