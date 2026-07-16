// Verifies the coverage-based bag calculator with the REAL shipping functions
// (coverageAt / bagsNeeded / parseCoverage). Confirms inverse thickness scaling,
// round-up, flat coverage, and name parsing. Pure — no DB needed.
import { coverageAt, bagsNeeded } from "@/lib/floor-prep";
import { parseCoverage } from "@/lib/units";
let pass = 0, fail = 0;
const ok = (c: boolean, m: string, d = "") => { c ? (pass++, console.log(`  ✓ ${m}${d ? "  " + d : ""}`)) : (fail++, console.log(`  ✗ FAIL ${m}${d ? "  " + d : ""}`)); };

console.log("COVERAGE-BASED BAG CALCULATOR\n");

// Stored 60 SF @ 1/8" — the plan's worked example.
console.log("  60 SF @ 1/8\" self-leveler over 1200 sq ft:");
ok(coverageAt(60, 0.125, 0.25) === 30, "coverage at 1/4\" = 30 SF/bag (halves)", String(coverageAt(60, 0.125, 0.25)));
ok(coverageAt(60, 0.125, 0.125) === 60, "coverage at 1/8\" = 60 SF/bag (reference)");
ok(bagsNeeded(1200, 60, 0.125, 0.25) === 40, "1200 ÷ 30 = 40 bags @ 1/4\"");
ok(bagsNeeded(1200, 60, 0.125, 0.125) === 20, "1200 ÷ 60 = 20 bags @ 1/8\" (≈ half of 1/4\")");

// The user's verify target — 55 SF @ 1/8".
console.log("\n  55 SF @ 1/8\" self-leveler over 1200 sq ft:");
ok(bagsNeeded(1200, 55, 0.125, 0.25) === 44, "1200 ÷ 27.5 = 43.6 → 44 bags @ 1/4\" (round UP)", String(bagsNeeded(1200, 55, 0.125, 0.25)));
ok(bagsNeeded(1200, 55, 0.125, 0.125) === 22, "1200 ÷ 55 = 21.8 → 22 bags @ 1/8\" (≈ doubles to 44)", String(bagsNeeded(1200, 55, 0.125, 0.125)));

// Rounding always up.
console.log("\n  Rounding + flat coverage:");
ok(bagsNeeded(100, 55, 0.125, 0.125) === 2, "100 ÷ 55 = 1.8 → 2 bags (never under-order)");
ok(bagsNeeded(1, 55, 0.125, 0.125) === 1, "1 sq ft → 1 bag (min whole bag)");
// Flat coverage (no reference thickness) ignores thickness.
ok(coverageAt(200, null, 0.25) === 200, "flat coverage ignores thickness");
ok(bagsNeeded(1000, 200, null, 0.5) === 5, "flat: 1000 ÷ 200 = 5 units regardless of thickness");
// Guards.
ok(bagsNeeded(0, 55, 0.125, 0.25) === 0, "no area → 0 bags");
ok(bagsNeeded(1200, 0, 0.125, 0.25) === 0, "no coverage → 0 bags");

// Name parsing (importer pre-fill).
console.log("\n  Coverage parsed from product names:");
ok(JSON.stringify(parseCoverage("SikaLevel 225 — 28 SF @ 1/4\"")) === JSON.stringify({ coverage_sqft: 28, coverage_thickness_in: 0.25 }), "\"28 SF @ 1/4\\\"\" → 28 SF, 0.25 in");
ok(JSON.stringify(parseCoverage("Schonox US 60 sf at 1/8")) === JSON.stringify({ coverage_sqft: 60, coverage_thickness_in: 0.125 }), "\"60 sf at 1/8\" → 60 SF, 0.125 in");
ok(parseCoverage("Mannington ADURA Plank — $2.59 SF") === null, "a per-SF price is NOT parsed as coverage (no false positive)");
ok(parseCoverage("Sika 5900 MegaBond") === null, "an item with no coverage spec → null");

console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
