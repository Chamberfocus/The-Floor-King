// Verifies per-room prep flows to the WORK ORDER per room, using the REAL
// buildJobScope the work order renders from. Two rooms: Kitchen (self-leveler
// material + its self-leveling labor) and Basement (moisture mitigation labor).
// Each must land in its OWN room block — Kitchen prep in Kitchen, Basement in
// Basement — not bleed across.
import { buildJobScope } from "@/lib/job-scope";
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ FAIL ${m}`)); };

// Lines exactly as the new builder produces them (room tagged, material/labor
// separate, self-leveling labor inheriting the material's room).
const L = (o: any): any => ({
  id: o.id, option_id: "", position: 0, length_in: null, width_in: null,
  measure_unit: "sqft", material_rate: null, labor_rate: null, installed_rate: null,
  flat_amount: null, waste_pct: 0, product_id: null, manufacturer: null, style: null,
  color: null, item_no: null, material_cost: null, labor_cost: null, unit: "sq ft",
  from_stock: false, is_fill: false, is_optional: false, quantity: null, ...o,
});
const lines = [
  L({ id: "carpet", room: "Living Room", description: "Mohawk carpet", category: "carpet", line_type: "mat_labor", sqft: 200, measure_unit: "sqyd" }),
  L({ id: "sl-mat", room: "Kitchen", description: "SikaLevel self-leveler", category: "other", line_type: "mat_labor", unit: "bag", quantity: 8 }),
  L({ id: "sl-lab", room: "Kitchen", description: "SikaLevel self-leveler — labor", category: "labor", line_type: "mat_labor", sqft: 200, prep_key: "pk1" }),
  L({ id: "moist", room: "Basement", description: "Floor prep — moisture mitigation", category: "labor", line_type: "mat_labor", sqft: 600 }),
];

console.log("PER-ROOM PREP → WORK ORDER\n");
const scope = buildJobScope(lines, null);
const room = (n: string) => scope.rooms.find((r) => r.name === n);
const has = (arr: any[], id: string) => arr.some((l) => l.id === id);

const kitchen = room("Kitchen");
const basement = room("Basement");
ok(!!kitchen, "Kitchen room block exists on the work order");
ok(!!basement, "Basement room block exists on the work order");

// Kitchen: self-leveler material (products) + its labor (prep/labor).
ok(!!kitchen && has(kitchen.products, "sl-mat"), "Kitchen block includes the self-leveler MATERIAL");
ok(!!kitchen && has(kitchen.labor, "sl-lab"), "Kitchen block includes the self-leveling LABOR (inherited room)");
// Basement: moisture mitigation labor.
ok(!!basement && has(basement.labor, "moist"), "Basement block includes moisture mitigation prep");

// No cross-contamination.
ok(!!basement && !has(basement.labor, "sl-lab") && !has(basement.products, "sl-mat"), "Kitchen prep does NOT appear in the Basement block");
ok(!!kitchen && !has(kitchen.labor, "moist"), "Basement prep does NOT appear in the Kitchen block");
// Material & labor are SEPARATE entries (not combined).
ok(!!kitchen && kitchen.products.some((l) => l.id === "sl-mat") && kitchen.labor.some((l) => l.id === "sl-lab"), "Kitchen self-leveler material & labor are SEPARATE lines");

console.log(`\n  Work-order layout:`);
for (const r of scope.rooms) {
  console.log(`   ${r.name}: products[${r.products.map((p) => p.description).join(", ")}]  labor[${r.labor.map((p) => p.description).join(", ")}]`);
}

console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
