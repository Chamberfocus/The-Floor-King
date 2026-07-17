// Verifies the guided-questionnaire smart auto-calcs with the REAL shipping
// functions: carpet yardage from cuts, stairs carpet, subfloor sheets, and the
// self-leveler bag calc (reused from floor-prep).
import { carpetYardageFromCuts, stairsCarpet, subfloorSheets } from "@/lib/questionnaire-calc";
import { bagsNeeded } from "@/lib/floor-prep";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string, d = "") => { c ? (pass++, console.log(`  ✓ ${m}${d ? "  " + d : ""}`)) : (fail++, console.log(`  ✗ FAIL ${m}${d ? "  " + d : ""}`)); };

console.log("QUESTIONNAIRE SMART AUTO-CALCS\n");

// --- Cuts → carpet yardage ---
console.log("Cuts → carpet yardage:");
// One cut: 30 ft off a 12 ft roll = 360 sq ft = 40 sq yd.
let y = carpetYardageFromCuts([{ lengthFt: 30, rollWidthFt: 12 }]);
ok(y.sqft === 360 && y.sqyd === 40, "30ft × 12ft roll = 360 sqft = 40 sqyd", `${y.sqft}/${y.sqyd}`);
// Length with inches: 20'6" off 15 ft = 20.5×15 = 307.5 sqft = 34.17 sqyd.
y = carpetYardageFromCuts([{ lengthFt: 20, lengthIn: 6, rollWidthFt: 15 }]);
ok(y.sqft === 307.5 && Math.abs(y.sqyd - 34.17) < 0.01, "20'6\" × 15ft roll = 307.5 sqft ≈ 34.17 sqyd", `${y.sqft}/${y.sqyd}`);
// Two cuts sum: 30×12 (360) + 12×15 (180) = 540 sqft = 60 sqyd.
y = carpetYardageFromCuts([{ lengthFt: 30, rollWidthFt: 12 }, { lengthFt: 12, rollWidthFt: 15 }]);
ok(y.sqft === 540 && y.sqyd === 60, "two cuts sum: 360 + 180 = 540 sqft = 60 sqyd", `${y.sqft}/${y.sqyd}`);
ok(y.perCut.length === 2 && y.perCut[0].sqyd === 40 && y.perCut[1].sqyd === 20, "per-cut yardage tracked (40 + 20)");

// --- Stairs → carpet ---
console.log("\nStairs → carpet:");
const wf = stairsCarpet(13, "waterfall");
const up = stairsCarpet(13, "upholstered");
ok(wf.sqft === 78, "13 waterfall steps × 6 sqft = 78 sqft", String(wf.sqft));
ok(up.sqft === 104, "13 upholstered steps × 8 sqft = 104 sqft (more than waterfall)", String(up.sqft));
ok(up.sqft > wf.sqft, "upholstered uses MORE carpet than waterfall");
ok(stairsCarpet(10, "waterfall", 7).sqft === 70, "config override: 10 × 7 = 70 sqft");

// --- Subfloor → sheets (round up) ---
console.log("\nSubfloor → sheets (4×8 = 32 sqft, round UP):");
ok(subfloorSheets(200) === 7, "200 sqft ÷ 32 = 6.25 → 7 sheets", String(subfloorSheets(200)));
ok(subfloorSheets(320) === 10, "320 sqft ÷ 32 = 10 sheets (exact)", String(subfloorSheets(320)));
ok(subfloorSheets(1) === 1, "1 sqft → 1 sheet (always round up)", String(subfloorSheets(1)));
ok(subfloorSheets(0) === 0, "0 sqft → 0 sheets");

// --- Self-leveler → bags (reuses floor-prep) ---
console.log("\nSelf-leveler → bags (floor-prep engine):");
ok(bagsNeeded(1200, 55, 0.125, 0.25) === 44, "1200 sqft, 55SF@1/8\" bag, poured 1/4\" = 44 bags", String(bagsNeeded(1200, 55, 0.125, 0.25)));
ok(bagsNeeded(1200, 60, 0.125, 0.125) === 20, "1200 sqft, 60SF@1/8\" bag, poured 1/8\" = 20 bags", String(bagsNeeded(1200, 60, 0.125, 0.125)));

console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
