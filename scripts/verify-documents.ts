// Verifies the customer-facing document model against the REAL shipping code:
//   buildCustomerScope (what the estimate/invoice show the customer)
//   buildJobScope + lineSpec (what the internal work order keeps)
//   optionTotalsWithDiscount (the lump sum)
// A 2-room hard-surface job. No DB writes — the functions are pure.
import { buildCustomerScope } from "@/lib/customer-scope";
import { buildJobScope, lineSpec } from "@/lib/job-scope";
import { optionTotalsWithDiscount } from "@/lib/estimate-calc";
import { formatMoney } from "@/lib/format";
import type { EstimateLineItem } from "@/lib/types";

// A realistic hard-surface estimate: 2 rooms, flooring + underlayment + trim +
// all the work, one whole-job haul-away, and a money-only discount line that must
// NOT appear in the customer scope.
const L = (o: Partial<EstimateLineItem>): EstimateLineItem =>
  ({
    id: Math.random().toString(36).slice(2),
    room: null,
    description: null,
    category: "other",
    line_type: "mat_labor",
    sqft: null,
    length_in: null,
    width_in: null,
    measure_unit: "sqft",
    quantity: null,
    unit: null,
    material_rate: 0,
    labor_rate: 0,
    installed_rate: 0,
    flat_amount: 0,
    material_cost: 0,
    labor_cost: 0,
    waste_pct: 0,
    manufacturer: null,
    style: null,
    color: null,
    item_no: null,
    from_stock: false,
    ...o,
  }) as EstimateLineItem;

const lines: EstimateLineItem[] = [
  // Living room
  L({ room: "Living Room", category: "lvp", description: "Rigid core LVP", manufacturer: "Shaw", style: "Coretec Plus", color: "Gunstock Oak", sqft: 320, quantity: 320, unit: "sqft", material_rate: 3.2, labor_rate: 1.5 }),
  L({ room: "Living Room", category: "underlayment", description: "Premium acoustic underlayment", sqft: 320, quantity: 320, unit: "sqft", material_rate: 0.4 }),
  L({ room: "Living Room", category: "trim", description: "Coordinating T-mold & quarter round", quantity: 6, unit: "each", material_rate: 27.87 }),
  L({ room: "Living Room", category: "labor", description: "Tear out & haul away existing carpet", quantity: 320, unit: "sqft", labor_rate: 0.75 }),
  L({ room: "Living Room", category: "labor", description: "Skim-coat & level subfloor", quantity: 320, unit: "sqft", labor_rate: 0.6 }),
  // Kitchen
  L({ room: "Kitchen", category: "tile", description: "Porcelain tile", manufacturer: "Daltile", style: "Marazzi", color: "Slate Gray", sqft: 180, quantity: 180, unit: "sqft", material_rate: 4.1, labor_rate: 3.0 }),
  L({ room: "Kitchen", category: "labor", description: "Demo existing vinyl & haul away", quantity: 180, unit: "sqft", labor_rate: 0.9 }),
  L({ room: "Kitchen", category: "labor", description: "Shave doors for clearance", quantity: 3, unit: "each", labor_rate: 25 }),
  // Whole-job
  L({ room: null, category: "labor", description: "Move & replace furniture", quantity: 1, unit: "each", labor_rate: 150 }),
  // Money-only discount — must be EXCLUDED from the customer scope
  L({ room: null, category: "other", line_type: "flat", description: "Repeat-customer discount", flat_amount: -100 }),
];

const notes = [
  "Job conditions:",
  "• Moisture test required before tile install",
  "• Confirm subfloor is structurally sound",
  "",
  "Per-room prep:",
  "• Kitchen — remove & reset toilet",
  "",
  "Please keep pets secured on install day.",
].join("\n");

let pass = 0,
  fail = 0;
const ok = (c: boolean, m: string, d = "") => {
  if (c) { pass++; console.log(`  ✓ ${m}${d ? "  " + d : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${m}${d ? "  " + d : ""}`); }
};

// ---- CUSTOMER SIDE ----
const scope = buildCustomerScope(lines, notes);
const total = optionTotalsWithDiscount(lines, 8, "amount", 0).total;

// Every string the customer view will render, gathered for scanning.
const emitted: string[] = [];
for (const r of scope.rooms) {
  emitted.push(r.name);
  for (const f of [...r.flooring, ...r.included]) emitted.push(f.title, f.detail ?? "");
}
for (const f of [...scope.whole.flooring, ...scope.whole.included]) emitted.push(f.title, f.detail ?? "");
emitted.push(...scope.conditions, scope.notes);

const BANNED = /\b\d[\d,.]*\s*(sq\s?\.?\s?(ft|yd|feet|foot|yard)|sqft|sqyd|square|lin(ear)?\s?\.?\s?ft|ln\s?ft|lnft|cartons?|pieces?|rolls?)\b|\$/i;
const offenders = emitted.filter((s) => BANNED.test(s));

console.log("\n═══ WHAT THE CUSTOMER SEES (estimate / invoice) ═══\n");
console.log("Company header:  The Floor King · address · phone · email · website");
console.log(`Document:        ESTIMATE  ·  # · date · prepared-for · estimator\n`);
for (const r of scope.rooms) {
  console.log(`  ${r.name}`);
  for (const f of r.flooring) console.log(`     Flooring: ${f.title}${f.detail ? " — " + f.detail : ""}`);
  for (const f of r.included) console.log(`     Includes: ${f.title}${f.detail ? " — " + f.detail : ""}`);
}
if (scope.whole.included.length) {
  console.log("  Throughout your home");
  for (const f of scope.whole.included) console.log(`     Includes: ${f.title}`);
}
if (scope.conditions.length) {
  console.log("  Site preparation");
  for (const c of scope.conditions) console.log(`     • ${c}`);
}
console.log(`\n  PROJECT TOTAL:  ${formatMoney(total)}   (single lump sum, tax included)\n`);

console.log("─── assertions ───");
ok(scope.rooms.length === 2, "exactly 2 rooms shown", `(${scope.rooms.map((r) => r.name).join(", ")})`);
ok(scope.rooms[0].flooring.some((f) => f.title.includes("Shaw") && f.title.includes("Gunstock Oak")), "Living Room shows Shaw Coretec Plus — Gunstock Oak");
ok(scope.rooms[1].flooring.some((f) => f.title.includes("Daltile") && f.title.includes("Slate Gray")), "Kitchen shows Daltile Marazzi — Slate Gray");
ok(scope.rooms[0].included.some((f) => /tear out & haul away/i.test(f.title)), "tear-out & haul-away described");
ok(scope.rooms[0].included.some((f) => /level subfloor/i.test(f.title)), "subfloor prep described");
ok(scope.rooms[0].included.some((f) => /T-mold|quarter round/i.test(f.title)), "transitions & molding described");
ok(scope.rooms[0].included.some((f) => /underlayment/i.test(f.title)), "underlayment described");
ok(scope.rooms[1].included.some((f) => /shave doors/i.test(f.title)), "door shaving described");
ok(scope.whole.included.some((f) => /furniture/i.test(f.title)), "furniture moving described (whole-job)");
ok(scope.conditions.length === 2, "2 site-prep conditions shown", `(${scope.conditions.length})`);
ok(scope.rooms[1].included.some((f) => /reset toilet/i.test(f.title)), "kitchen per-room prep shown");
ok(!emitted.some((s) => /discount/i.test(s)), "money-only discount line is NOT in the customer scope");
ok(offenders.length === 0, "NO square footage / linear footage / quantity / $ anywhere in the customer scope", offenders.length ? `LEAKS: ${JSON.stringify(offenders)}` : "");
ok(total > 0, "lump-sum total is present and positive", formatMoney(total));

// ---- INTERNAL SIDE (work order keeps everything) ----
console.log("\n═══ WHAT THE CREW SEES (internal work order — SAME job) ═══\n");
const job = buildJobScope(lines, notes);
const woQtys: string[] = [];
for (const r of job.rooms) {
  console.log(`  ${r.name}  —  ${r.sqft ? Math.round(r.sqft) + " sq ft" : ""}`);
  for (const p of r.products) {
    const spec = lineSpec(p);
    if (spec.qty) woQtys.push(spec.qty);
    console.log(`     ${[p.manufacturer, p.style, p.color].filter(Boolean).join(" ") || p.description}  →  ${spec.qty}${spec.cut ? " · cut " + spec.cut : ""}`);
  }
  for (const l of r.labor) console.log(`     (labor) ${l.description}  →  ${lineSpec(l).qty}`);
}

console.log("\n─── assertions ───");
ok(job.rooms.length === 2, "work order has the same 2 rooms");
// buildJobScope sums every product's sqft in the room (flooring 320 +
// underlayment 320 = 640) — pre-existing work-order behavior, unchanged here.
ok(job.rooms[0].sqft === 640, "Living Room keeps its material square footage", `(${job.rooms[0].sqft} = 320 floor + 320 underlayment)`);
ok(job.rooms[1].sqft === 180, "Kitchen keeps its 180 sq ft", `(${job.rooms[1].sqft})`);
ok(woQtys.some((q) => /sq\s?ft/i.test(q)), "work order line quantities include square footage", `(e.g. "${woQtys.find((q) => /sq\s?ft/i.test(q))}")`);
ok(woQtys.length > 0, "work order keeps per-line quantities the customer never saw", `(${woQtys.length} qty lines)`);

console.log(`\n${"═".repeat(56)}\n  ${pass} passed, ${fail} failed\n${"═".repeat(56)}`);
if (fail) process.exit(1);
