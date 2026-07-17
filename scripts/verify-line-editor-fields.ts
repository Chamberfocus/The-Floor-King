// Verifies the material line editor shows the RIGHT essential fields per unit
// type — using the REAL exported predicates the builder gates on
// (isRollGoodCategory / isHardSurfaceCategory / isAreaUnit / hasCoverage). The
// two local builder helpers (isCountLine / isSubfloor / isFlooring) are
// reproduced here EXACTLY as the component defines them, then we assert which
// essential blocks render for a carpet line vs a per-bag prep line.
import { isRollGoodCategory, isHardSurfaceCategory } from "@/lib/types";
import { isAreaUnit } from "@/lib/units";
import { hasCoverage } from "@/lib/floor-prep";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ FAIL ${m}`)); };

type L = { category: string; unit: string; coverage_sqft?: string };
// Mirror of the builder's local predicates (estimate-builder.tsx).
const isSubfloor = (l: L) => l.category === "underlayment" && l.unit === "sheet";
const isCountLine = (l: L) => {
  if (isRollGoodCategory(l.category) || isHardSurfaceCategory(l.category)) return false;
  if (isSubfloor(l)) return false;
  return !isAreaUnit(l.unit);
};
const isFlooring = (l: L) => isRollGoodCategory(l.category) || isHardSurfaceCategory(l.category);

// What the editor renders by default, per the JSX conditionals we just built.
function essentials(l: L) {
  return {
    color: isFlooring(l),                                   // color visible for flooring only
    cutDims: isRollGoodCategory(l.category),                // L×W cuts (roll goods)
    areaSqft: !isCountLine(l) && !isSubfloor(l),            // Sq ft + Add up areas
    bagCalculator: isCountLine(l) && hasCoverage(l.coverage_sqft),
    howManyCount: isCountLine(l) && !hasCoverage(l.coverage_sqft),
    sheets: isSubfloor(l),
    // advanced-only (must NOT be in essentials):
    wasteInEssentials: false,
  };
}
// Waste % / manual qty live in "More options" and only for area lines.
const wasteShownInAdvanced = (l: L) => !isSubfloor(l) && !isCountLine(l);

console.log("MATERIAL LINE EDITOR — field relevance by unit type\n");

// ---- Carpet line (roll goods, area-billed) ----
console.log("A) Carpet line (category=carpet, unit=sq yd):");
const carpet: L = { category: "carpet", unit: "sq yd" };
const ec = essentials(carpet);
ok(ec.color, "Color is an ESSENTIAL (visible) — flooring identity");
ok(ec.cutDims, "Cut Length × Width shown (roll goods)");
ok(ec.areaSqft, "Sq ft + Add up areas shown (area-billed)");
ok(!ec.bagCalculator && !ec.howManyCount, "No bag calculator / no 'how many' count field");
ok(!ec.sheets, "No # sheets field");
ok(wasteShownInAdvanced(carpet), "Waste % lives under More options (area line)");

// ---- Per-bag prep line (self-leveler with coverage) ----
console.log("\nB) Per-bag prep line (category=other, unit=bag, coverage=55 SF):");
const prep: L = { category: "other", unit: "bag", coverage_sqft: "55" };
const ep = essentials(prep);
ok(!ep.color, "Color HIDDEN — meaningless for prep");
ok(!ep.cutDims, "No cut dimensions");
ok(!ep.areaSqft, "No Sq-ft-billing / Add-up-areas (not area-billed)");
ok(ep.bagCalculator, "Bag calculator shown (coverage → bags)");
ok(!ep.howManyCount, "Plain 'how many' hidden (bag calculator takes over)");
ok(!wasteShownInAdvanced(prep), "Waste % NOT shown even under More options (count line)");

// ---- Plain count line (each, no coverage) ----
console.log("\nC) Plain count line (category=other, unit=each):");
const each: L = { category: "other", unit: "each" };
const ee = essentials(each);
ok(!ee.color && !ee.cutDims && !ee.areaSqft && !ee.bagCalculator, "No color / cuts / area / bag calc");
ok(ee.howManyCount, "Shows 'How many each?' count field");
ok(!wasteShownInAdvanced(each), "No waste % (count line)");

console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
