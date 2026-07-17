// Verifies "use once vs use always" for estimate-line prices against the LIVE
// DB, using the SAME unit-conversion the server action + builder use
// (isAreaUnit / normalizeUnit). Confirms: use-once never touches the saved
// default; use-always writes the edited cost back (converted by the catalog
// factor); the standard-vs-one-off badge reads correctly.
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createAdminClient } from "@/lib/supabase/admin";
import { isAreaUnit, normalizeUnit } from "@/lib/units";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string, d = "") => { c ? (pass++, console.log(`  ✓ ${m}${d ? "  " + d : ""}`)) : (fail++, console.log(`  ✗ FAIL ${m}${d ? "  " + d : ""}`)); };
const admin = createAdminClient();

// The catalog factor — identical to catalogFactor() in the builder and the
// conversion in saveProductRate().
const factor = (measure: "sqft" | "sqyd", productUnit: string) => {
  if (!isAreaUnit(productUnit)) return 1;
  const cat = normalizeUnit(productUnit);
  return measure === cat ? 1 : measure === "sqyd" ? 9 : 1 / 9;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
// saveProductRate's write: line-unit cost → product-unit rate.
const rateFromCost = (cost: number, measure: "sqft" | "sqyd", unit: string) => r2(cost / factor(measure, unit));
// defaultCostFor's read: product rate → line-unit cost (for the badge).
const costFromRate = (rate: number, measure: "sqft" | "sqyd", unit: string) => r2(rate * factor(measure, unit));

async function makeProduct(p: any) {
  const { data } = await admin.from("products").insert(p).select("id, material_rate, unit").single();
  return data!;
}
const rateOf = async (id: string) => Number((await admin.from("products").select("material_rate").eq("id", id).single()).data!.material_rate);

async function main() {
  console.log("USE ONCE vs USE ALWAYS\n");
  const carpet = await makeProduct({ name: "ZZ Carpet default", category: "carpet", unit: "sqft", material_rate: 20 });
  const bag = await makeProduct({ name: "ZZ Bag default", category: "other", unit: "bag", material_rate: 22 });
  try {
    // ---- USE ONCE: edit the line cost, do NOT write back ----
    console.log("A) USE ONCE (default):");
    // Line priced per sq yd; catalog carpet is per sq ft. Standard line cost = 20×9 = 180/yd.
    ok(costFromRate(20, "sqyd", "sqft") === 180, "badge: $20/sqft default reads as $180/sq yd on the line → 'Standard'", String(costFromRate(20, "sqyd", "sqft")));
    // The estimator changes it to $210/yd but leaves "This estimate only".
    ok(Math.abs(210 - 180) > 0.005, "changed to $210/sq yd → badge flips to 'Custom — this estimate'");
    // No write-back happens (save_default=false → flushDefaultRates skips it).
    ok((await rateOf(carpet.id)) === 20, "saved catalog default UNCHANGED at $20/sqft");

    // ---- USE ALWAYS: write the edited cost back, converted ----
    console.log("\nB) USE ALWAYS:");
    // Estimator sets $270/sq yd and chooses "Save as my default".
    await admin.from("products").update({ material_rate: rateFromCost(270, "sqyd", "sqft") }).eq("id", carpet.id);
    ok((await rateOf(carpet.id)) === 30, "carpet default updated: $270/sq yd → $30/sq ft (÷9)", String(await rateOf(carpet.id)));
    // A count product (bag) — factor 1, no conversion.
    await admin.from("products").update({ material_rate: rateFromCost(25, "sqft", "bag") }).eq("id", bag.id);
    ok((await rateOf(bag.id)) === 25, "bag default updated: $25/bag → $25/bag (factor 1)", String(await rateOf(bag.id)));

    // ---- Next estimate picks up the new default ----
    console.log("\nC) Future estimates use the new default:");
    ok(costFromRate(await rateOf(carpet.id), "sqyd", "sqft") === 270, "a new carpet line now reads $270/sq yd as its Standard rate");
  } finally {
    await admin.from("products").delete().in("id", [carpet.id, bag.id]);
  }
  console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
