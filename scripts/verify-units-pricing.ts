// MANUAL / STAGING-LIKE VERIFICATION — NOT PART OF DEFAULT PR CI.
// Requires .env.local + SUPABASE_SERVICE_ROLE_KEY. Do not default to production.
//
// Verifies material entry + estimate pricing math against a live DB, using the
// REAL shipping functions (estimate-calc + units). Exercises an AREA material
// (carpet, sq yd), a per-BAG material (self-leveler), a per-EACH material
// (adhesive), and a per-LINEAR-FT material (trim) — each must price in its OWN
// unit — plus an estimate-level discount, and a brand-new catalog item (round-
// trips the unit). Throwaway data, cleaned up.
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("="); process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { lineTotal, lineCost, optionTotalsWithDiscount, marginPct } from "@/lib/estimate-calc";
import { jobProfit } from "@/lib/job-profit";
import { isAreaUnit, unitKind, normalizeUnit, defaultUnitForCategory } from "@/lib/units";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
let pass = 0, fail = 0;
const ok = (c: boolean, m: string, d = "") => { c ? (pass++, console.log(`  ✓ ${m}${d ? "  " + d : ""}`)) : (fail++, console.log(`  ✗ FAIL ${m}${d ? "  " + d : ""}`)); };
const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

const TAG = "ZZ Units Pricing Verify";
let custId = "", estId = "", optId = "", prodId = "";

// The four lines, exactly as the builder now produces them per unit.
const LINES = [
  { label: "Carpet (area, sq yd)", line_type: "mat_labor", category: "carpet",
    measure_unit: "sqyd", unit: "sq yd", sqft: 360, quantity: null, waste_pct: 10,
    material_rate: 30, labor_rate: 0, material_cost: 20, labor_cost: 0 },
  { label: "Self-leveler (per BAG)", line_type: "mat_labor", category: "other",
    measure_unit: "sqft", unit: "bag", sqft: null, quantity: 5, waste_pct: 0,
    material_rate: 32, labor_rate: 0, material_cost: 24, labor_cost: 0 },
  { label: "Adhesive (per EACH)", line_type: "mat_labor", category: "other",
    measure_unit: "sqft", unit: "each", sqft: null, quantity: 3, waste_pct: 0,
    material_rate: 18, labor_rate: 0, material_cost: 12, labor_cost: 0 },
  { label: "Transition (per LINEAR FT)", line_type: "mat_labor", category: "trim",
    measure_unit: "sqft", unit: "lnft", sqft: null, quantity: 60, waste_pct: 0,
    material_rate: 2.5, labor_rate: 0, material_cost: 1.5, labor_cost: 0 },
];

async function setup() {
  const { data: c } = await db.from("customers").insert({ full_name: TAG, source: "referral" }).select("id").single();
  custId = c!.id;
  const { data: e } = await db.from("estimates").insert({
    customer_id: custId, title: `${TAG} estimate`, status: "draft", tax_rate: 8,
    discount_kind: "percent", discount_value: 10,
  }).select("id").single();
  estId = e!.id;
  const { data: o } = await db.from("estimate_options").insert({ estimate_id: estId, name: "Option A", position: 0 }).select("id").single();
  optId = o!.id;
  const rows = LINES.map((l, i) => ({
    option_id: optId, position: i, description: l.label, line_type: l.line_type,
    category: l.category, measure_unit: l.measure_unit, unit: l.unit,
    sqft: l.sqft, quantity: l.quantity, waste_pct: l.waste_pct,
    material_rate: l.material_rate, labor_rate: l.labor_rate,
    material_cost: l.material_cost, labor_cost: l.labor_cost,
    order_as_roll: false, is_fill: false,
  }));
  const { error } = await db.from("estimate_line_items").insert(rows);
  if (error) throw new Error("line insert failed: " + error.message);
}

async function run() {
  console.log("MATERIAL ENTRY + PRICING — units, discount, catalog round-trip\n");

  // 1) Units helper classifies each material correctly.
  console.log("  Units helper:");
  ok(isAreaUnit("sq yd") && unitKind("sq yd") === "area", "carpet 'sq yd' → area");
  ok(!isAreaUnit("bag") && unitKind("bag") === "count", "'bag' → count (not area)");
  ok(unitKind("each") === "count" && unitKind("lnft") === "count", "'each' & 'lnft' → count");
  ok(normalizeUnit("Bag") === "bag" && normalizeUnit("LF") === "lnft", "normalizes Bag→bag, LF→lnft");
  ok(defaultUnitForCategory("carpet") === "sqyd" && defaultUnitForCategory("trim") === "lnft", "category defaults sensible");

  await setup();

  // 2) Each line prices in its OWN unit — read back from the db and compute.
  const { data: lines } = await db.from("estimate_line_items").select("*").eq("option_id", optId).order("position");
  console.log("\n  Per-line totals (each in its own unit):");
  const expect = [
    { total: 40 * 30 * 1.1, note: "40 sq yd × $30 × 1.10 waste" }, // 1320
    { total: 5 * 32, note: "5 bags × $32 (no area, no waste)" },   // 160
    { total: 3 * 18, note: "3 each × $18" },                       // 54
    { total: 60 * 2.5, note: "60 lnft × $2.50" },                  // 150
  ];
  (lines ?? []).forEach((l: any, i: number) => {
    const t = lineTotal(l);
    console.log(`     ${LINES[i].label.padEnd(28)} = ${money(t)}   (${expect[i].note})`);
    ok(Math.abs(t - expect[i].total) < 0.01, `${LINES[i].label} prices in its own unit`, money(t));
  });
  // The bag line must NOT be area-priced: prove it ignores any sqft.
  const bag = (lines ?? [])[1];
  ok(lineTotal({ ...bag, sqft: 999 }) === 160, "bag total ignores sq ft (quantity-driven, not area)");

  // 3) Discount + totals (owner view) — customer sees only the discounted total.
  const dt = optionTotalsWithDiscount(lines as any[], 8, "percent", 10);
  const cost = (lines ?? []).reduce((s: number, l: any) => s + lineCost(l), 0);
  const net = dt.subtotal - dt.discount;
  // Direct line gross (bare cost, no freight/fees) — NOT the all-in job margin.
  const directMargin = marginPct(net, cost);
  // Canonical all-in job profit (freight + gas/car/commission) — Step 7.
  const allIn = jobProfit((lines ?? []) as any[], {
    discountKind: "percent",
    discountValue: 10,
    freightMarkupPct: 0,
    fuelFee: 0,
    carAllowance: 0,
    commissionPct: 0,
  });
  console.log("\n  Estimate totals (owner):");
  console.log(`     Retail subtotal ${money(dt.subtotal)} · discount −${money(dt.discount)} · tax ${money(dt.tax)} · TOTAL ${money(dt.total)}`);
  console.log(`     Direct line cost ${money(cost)} · direct GM ${Math.round(directMargin)}% (not all-in)`);
  console.log(`     All-in (jobProfit, freight/fees 0 here) profit ${money(allIn.profit)} · margin ${Math.round(allIn.margin)}%`);
  ok(Math.abs(dt.subtotal - 1684) < 0.01, "retail subtotal = 1320+160+54+150", money(dt.subtotal));
  ok(Math.abs(dt.discount - 168.4) < 0.01, "10% discount computed on subtotal", money(dt.discount));
  ok(Math.abs(dt.total - (1684 - 168.4) * 1.08) < 0.01, "total = (subtotal − discount) × 1.08 tax", money(dt.total));
  ok(cost > 0 && net - cost > 0, "owner direct cost + profit present (hidden from customer doc)");
  ok(Math.abs(allIn.revenue - net) < 0.01, "jobProfit revenue matches discounted pre-tax net");
  ok(Math.abs(allIn.cost - cost) < 0.01, "jobProfit cost matches lineCost when freight/fees are 0");

  // 4) Brand-new item added on the fly round-trips with its unit intact.
  const { data: p } = await db.from("products").insert({
    name: `${TAG} self-leveler`, category: "other", unit: "bag", material_rate: 32, labor_rate: 0,
  }).select("id, unit, material_rate").single();
  prodId = p!.id;
  ok(p!.unit === "bag", "new catalog item saved with unit 'bag' (reusable, correct)", `unit=${p!.unit}`);
}

async function cleanup() {
  if (optId) await db.from("estimate_line_items").delete().eq("option_id", optId);
  if (estId) await db.from("estimates").delete().eq("id", estId);
  if (custId) await db.from("customers").delete().eq("id", custId);
  if (prodId) await db.from("products").delete().eq("id", prodId);
}

run().catch((e) => { fail++; console.error("  ✗ ERROR:", e.message); }).finally(async () => {
  await cleanup();
  console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed  (throwaway data cleaned up)`);
  process.exit(fail === 0 ? 0 : 1);
});
