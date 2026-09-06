// End-to-end: the guided questionnaire's smart output → a real estimate that
// flows to the WORK ORDER and PURCHASE ORDER. Builds the SmartLine[] with the
// REAL calc lib (carpetYardageFromCuts / stairsCarpet / subfloorSheets /
// bagsNeeded), persists them exactly like createSmartEstimate, then proves:
//  • the estimate lines carry correct units/quantities (carpet sq yd, subfloor
//    sheets, self-leveler bags with coverage), labor separate;
//  • buildJobScope groups them per room (the WORK ORDER);
//  • the PO filter selects the orderable materials (excludes labor / from-stock)
//    using lineOrderQty (waste-in order need — Step 2/4), not bare lineQty.
//
// MANUAL / STAGING-LIKE VERIFICATION — NOT PART OF DEFAULT PR CI.
// Requires .env.local + SUPABASE_SERVICE_ROLE_KEY. Do not run against production
// as a default. Prefer a staging/dev project.
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createAdminClient } from "@/lib/supabase/admin";
import { carpetYardageFromCuts, stairsCarpet, subfloorSheets } from "@/lib/questionnaire-calc";
import { bagsNeeded } from "@/lib/floor-prep";
import { buildJobScope } from "@/lib/job-scope";
import { lineOrderQty } from "@/lib/estimate-calc";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string, d = "") => { c ? (pass++, console.log(`  ✓ ${m}${d ? "  " + d : ""}`)) : (fail++, console.log(`  ✗ FAIL ${m}${d ? "  " + d : ""}`)); };
const admin = createAdminClient();

// createSmartEstimate's exact row mapping (mirrored).
const toRow = (l: any, opt: string, i: number) => ({
  option_id: opt, position: i, room: l.room || null, description: l.description, line_type: "mat_labor",
  category: l.category || "other", measure_unit: l.measure_unit, sqft: l.sqft && l.sqft > 0 ? l.sqft : null,
  quantity: l.quantity && l.quantity > 0 ? l.quantity : null, unit: l.unit,
  material_rate: l.material_rate || 0, labor_rate: l.labor_rate || 0, material_cost: l.material_cost || 0, labor_cost: l.labor_cost || 0,
  waste_pct: 0, product_id: null, manufacturer: null, style: null, color: null, from_stock: !!l.from_stock,
  coverage_sqft: l.coverage_sqft ?? null, coverage_thickness_in: l.coverage_thickness_in ?? null, prep_thickness_in: l.prep_thickness_in ?? null,
  order_as_roll: !!l.order_as_roll, roll_width_ft: l.roll_width_ft ?? null,
});

async function makeEstimate(customerId: string, title: string, lines: any[]) {
  const { data: est } = await admin.from("estimates").insert({ customer_id: customerId, title }).select("id").single();
  const { data: opt } = await admin.from("estimate_options").insert({ estimate_id: est!.id, name: "Option A", position: 0 }).select("id").single();
  await admin.from("estimate_line_items").insert(lines.map((l, i) => toRow(l, opt!.id, i)));
  const { data: read } = await admin.from("estimate_line_items").select("*").eq("option_id", opt!.id).order("position");
  return { estimateId: est!.id as string, lines: read ?? [] };
}

async function main() {
  console.log("GUIDED QUESTIONNAIRE — E2E (estimate → WO → PO)\n");
  const { data: cust } = await admin.from("customers").insert({ full_name: "ZZ Guided E2E", source: "google" }).select("id").single();
  const customerId = cust!.id as string;
  try {
    // ===================== CARPET JOB =====================
    // Different carpet per area + cuts → yardage; stairs → labor + carpet.
    console.log("A) CARPET job (different carpet per area, cuts→yardage, stairs, curb day):");
    const lrY = carpetYardageFromCuts([{ lengthFt: 30, rollWidthFt: 12 }]);       // 40 sqyd
    const brY = carpetYardageFromCuts([{ lengthFt: 15, rollWidthFt: 12 }]);       // 20 sqyd
    const stairCarpet = stairsCarpet(13, "Waterfall", 6);                          // 78 sqft = 8.67 sqyd
    const carpetLines = [
      { room: "Living Room", description: "Shaw A — cuts: 30'×12'", category: "carpet", measure_unit: "sqyd", sqft: lrY.sqft, quantity: Math.ceil(lrY.sqyd), unit: "sq yd", material_rate: 30, labor_rate: 0, material_cost: 20, labor_cost: 0, order_as_roll: true, roll_width_ft: 12 },
      { room: "Bedroom", description: "Mohawk B — cuts: 15'×12'", category: "carpet", measure_unit: "sqyd", sqft: brY.sqft, quantity: Math.ceil(brY.sqyd), unit: "sq yd", material_rate: 28, labor_rate: 0, material_cost: 18, labor_cost: 0, order_as_roll: true, roll_width_ft: 12 },
      { room: null, description: "Carpet steps — Waterfall", category: "labor", measure_unit: "sqft", sqft: null, quantity: 13, unit: "step", material_rate: 0, labor_rate: 27, material_cost: 0, labor_cost: 18 },
      { room: null, description: "Stair carpet — 13 Waterfall steps", category: "carpet", measure_unit: "sqyd", sqft: stairCarpet.sqft, quantity: Math.ceil(stairCarpet.sqyd), unit: "sq yd", material_rate: 30, labor_rate: 0, material_cost: 20, labor_cost: 0 },
    ];
    const carpet = await makeEstimate(customerId, "ZZ Carpet", carpetLines);
    const lr = carpet.lines.find((l) => l.room === "Living Room");
    const br = carpet.lines.find((l) => l.room === "Bedroom");
    ok(lrY.sqyd === 40 && lr?.measure_unit === "sqyd" && Number(lr?.quantity) === 40, "Living Room carpet = 40 sq yd (from 30'×12' cut)", String(lr?.quantity));
    ok(brY.sqyd === 20 && Number(br?.quantity) === 20, "Bedroom carpet = 20 sq yd (different carpet)", String(br?.quantity));
    const stepLabor = carpet.lines.find((l) => l.unit === "step");
    ok(!!stepLabor && stepLabor.category === "labor" && Number(stepLabor.quantity) === 13, "Stair LABOR = 13 steps, separate labor line");
    const stairCar = carpet.lines.find((l) => l.description.includes("Stair carpet"));
    ok(!!stairCar && Number(stairCar.quantity) === 9, "Stair CARPET = 9 sq yd (13 × 6 sqft ÷ 9, round up)", String(stairCar?.quantity));
    // WO: rooms group
    const cScope = buildJobScope(carpet.lines as any, "Bulk pickup day: Tuesday");
    ok(cScope.rooms.some((r) => r.name === "Living Room") && cScope.rooms.some((r) => r.name === "Bedroom"), "WORK ORDER groups Living Room + Bedroom");
    // PO: orderable = material, not labor, not from-stock, order qty > 0
    // (lineOrderQty includes waste — purchasing need, not measured lineQty).
    const cPO = carpet.lines.filter(
      (l: any) =>
        l.line_type !== "flat" &&
        l.category !== "labor" &&
        !l.from_stock &&
        lineOrderQty(l) > 0,
    );
    ok(cPO.length === 3 && cPO.every((l) => l.category === "carpet"), "PO pulls 3 carpet material lines (steps LABOR excluded)", `${cPO.length} lines`);

    // ===================== HARD SURFACE JOB =====================
    console.log("\nB) HARD-SURFACE job (2 rooms, different demo+prep, subfloor sheets, self-leveler bags, radiant flag):");
    const kSheets = subfloorSheets(200, 32); // 7
    const bSheets = subfloorSheets(100, 32); // 4
    const bags = bagsNeeded(300, 50, 0.125, 0.25); // coverageAt=25 → 12
    const hsLines = [
      { room: "Kitchen", description: "LVP", category: "lvp", measure_unit: "sqft", sqft: 200, quantity: 200, unit: "sq ft", material_rate: 4, labor_rate: 0, material_cost: 2.5, labor_cost: 0 },
      { room: "Bath", description: "LVP", category: "lvp", measure_unit: "sqft", sqft: 100, quantity: 100, unit: "sq ft", material_rate: 4, labor_rate: 0, material_cost: 2.5, labor_cost: 0 },
      { room: "Kitchen", description: "Tear-out — carpet", category: "labor", measure_unit: "sqft", sqft: 200, quantity: 200, unit: "sq ft", material_rate: 0, labor_rate: 0.75, material_cost: 0, labor_cost: 0.5 },
      { room: "Bath", description: "Tear-out — ceramic w/ mortar bed", category: "labor", measure_unit: "sqft", sqft: 100, quantity: 100, unit: "sq ft", material_rate: 0, labor_rate: 3.75, material_cost: 0, labor_cost: 2.5 },
      { room: "Kitchen", description: 'Subfloor 1/2" — Kitchen', category: "underlayment", measure_unit: "sqft", sqft: 200, quantity: kSheets, unit: "sheet", material_rate: 22, labor_rate: 0, material_cost: 15, labor_cost: 0 },
      { room: "Bath", description: 'Subfloor 1/2" — Bath', category: "underlayment", measure_unit: "sqft", sqft: 100, quantity: bSheets, unit: "sheet", material_rate: 22, labor_rate: 0, material_cost: 15, labor_cost: 0 },
      { room: null, description: "Self-leveler", category: "other", measure_unit: "sqft", sqft: 300, quantity: bags, unit: "bag", material_rate: 33, labor_rate: 0, material_cost: 22, labor_cost: 0, coverage_sqft: 50, coverage_thickness_in: 0.125, prep_thickness_in: 0.25 },
    ];
    const hs = await makeEstimate(customerId, "ZZ Hard surface", hsLines);
    const kSub = hs.lines.find((l) => l.unit === "sheet" && l.room === "Kitchen");
    const bSub = hs.lines.find((l) => l.unit === "sheet" && l.room === "Bath");
    ok(kSheets === 7 && Number(kSub?.quantity) === 7, "Kitchen subfloor = 7 sheets (200 ÷ 32 ↑)", String(kSub?.quantity));
    ok(bSheets === 4 && Number(bSub?.quantity) === 4, "Bath subfloor = 4 sheets (100 ÷ 32 ↑)", String(bSub?.quantity));
    const sl = hs.lines.find((l) => l.unit === "bag");
    ok(bags === 12 && Number(sl?.quantity) === 12, "Self-leveler = 12 bags (300 ÷ 25 SF/bag @ 1/4\")", String(sl?.quantity));
    ok(Number(sl?.coverage_sqft) === 50 && Number(sl?.prep_thickness_in) === 0.25, "Self-leveler line carries coverage → builder bag calculator stays live");
    const hScope = buildJobScope(hs.lines as any, "⚠ Radiant heat present — confirm product rating");
    const kRoom = hScope.rooms.find((r) => r.name === "Kitchen");
    const bRoom = hScope.rooms.find((r) => r.name === "Bath");
    ok(!!kRoom && !!bRoom, "WORK ORDER groups Kitchen + Bath");
    ok(!!bRoom && bRoom.labor.some((l: any) => /mortar bed/i.test(l.description)), "Bath's ceramic-w/-mortar-bed demo lands under Bath on the WO");
    const hPO = hs.lines.filter(
      (l: any) =>
        l.line_type !== "flat" &&
        l.category !== "labor" &&
        !l.from_stock &&
        lineOrderQty(l) > 0,
    );
    ok(hPO.some((l) => l.unit === "sheet") && hPO.some((l) => l.unit === "bag") && hPO.some((l) => l.category === "lvp") && !hPO.some((l) => l.category === "labor"),
      "PO pulls LVP + subfloor sheets + self-leveler bags; tear-out LABOR excluded", `${hPO.length} lines`);
  } finally {
    await admin.from("customers").delete().eq("id", customerId);
  }
  console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
