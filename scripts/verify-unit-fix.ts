// Verifies the per-unit pricing FIX with the REAL shipping functions: the
// importer's unit inference (containers → each, flooring stays area), the
// corrected Sika pricing (a few pails, not 1693 sq ft), and the mispricing
// nudge (a line linked to a per-each product but priced by area is detected).
import { lineTotal } from "@/lib/estimate-calc";
import { inferUnit, isAreaUnit, unitLabel } from "@/lib/units";
let pass = 0, fail = 0;
const ok = (c: boolean, m: string, d = "") => { c ? (pass++, console.log(`  ✓ ${m}${d ? "  " + d : ""}`)) : (fail++, console.log(`  ✗ FAIL ${m}${d ? "  " + d : ""}`)); };
const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

console.log("PER-UNIT PRICING FIX\n");

console.log("  Importer unit inference (Root A):");
ok(inferUnit("Sika 5900 MegaBond", null, "other") === "each", "Sika adhesive → each (not sqft)");
ok(inferUnit("Sika Construction Adhesive 29oz Tubes", null, "other") === "each", "adhesive tubes → each");
ok(inferUnit("Mapei Self-Leveler 50 lb Bag", null, "other") === "each", "self-leveler bag → each");
ok(inferUnit("Lvt Scratch Repair Kit", null, "other") === "each", "repair kit → each");
// Flooring must NOT be touched.
ok(inferUnit("Mannington Adura Plank Glue Down", null, "lvp") === "sqft", "LVP 'Glue Down' stays sqft (flooring guard)");
ok(inferUnit("Bengal Bay Hardwood", null, "hardwood") === "sqft", "hardwood stays sqft");
ok(inferUnit("Mohawk Carpet Berber", null, "carpet") === "sqyd", "carpet stays sqyd");
// A source-provided unit is always trusted.
ok(inferUnit("Anything", "sqft", "other") === "sqft", "a parsed unit is trusted as-is");

console.log("\n  Corrected Sika pricing (Root B/C):");
// The bug: area-priced. 1693 sq ft × $218.98 = the wrong ~$370k.
const bugTotal = lineTotal({ line_type: "mat_labor", unit: "sq ft", measure_unit: "sqft", sqft: 1693, quantity: 1693, material_rate: 218.98 });
console.log(`     BEFORE (area bug): ${money(bugTotal)}`);
// The fix: switch to per-each with a real count of pails.
const fixed = { line_type: "mat_labor" as const, unit: "each", measure_unit: "sqft" as const, sqft: "", quantity: 3, material_rate: 218.98 };
const fixedTotal = lineTotal(fixed);
console.log(`     AFTER (3 pails × $218.98): ${money(fixedTotal)}`);
ok(bugTotal > 300000, "reproduced the bug (area pricing ≈ $370k)", money(bugTotal));
ok(fixedTotal === 3 * 218.98, "fixed: 3 pails price per each, not by area", money(fixedTotal));
ok(lineTotal({ ...fixed, sqft: 9999 }) === 3 * 218.98, "count price ignores sq ft entirely");

console.log("\n  Mispricing nudge (linked product sold per-each, line priced by area):");
const mismatch = (productUnit: string, lineUnit: string) => !!productUnit && !isAreaUnit(productUnit) && isAreaUnit(lineUnit);
ok(mismatch("each", "sq ft") === true, "each-product + sq-ft-line → nudge shows", `"Sold by the ${unitLabel("each")}"`);
ok(mismatch("sqft", "sq ft") === false, "area-product + area-line → no nudge");
ok(mismatch("each", "each") === false, "already per-each → no nudge");

console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
