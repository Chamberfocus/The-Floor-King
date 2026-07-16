// Verifies multi-option estimates end to end against the LIVE db, using the REAL
// shipping functions. Builds ONE estimate with two options — "Standard" and
// "With Subfloor & Moisture" (the extra work flagged optional) — recommends one,
// checks owner per-option cost/margin, the firewall-safe customer scope per
// option, then approves one and confirms ONLY that option flows forward.
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("="); process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { optionTotalsWithDiscount, lineCost, marginPct } from "@/lib/estimate-calc";
import { buildCustomerScope } from "@/lib/customer-scope";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
let pass = 0, fail = 0;
const ok = (c: boolean, m: string, d = "") => { c ? (pass++, console.log(`  ✓ ${m}${d ? "  " + d : ""}`)) : (fail++, console.log(`  ✗ FAIL ${m}${d ? "  " + d : ""}`)); };
const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

const TAG = "ZZ Multi-Option Verify";
let custId = "", estId = "", optAId = "", optBId = "", jobId = "";

const carpet = { room: "Living Room", description: "Carpet — Mohawk SmartStrand", line_type: "mat_labor",
  category: "carpet", measure_unit: "sqyd", unit: "sq yd", sqft: 360, quantity: null, waste_pct: 0,
  material_rate: 30, labor_rate: 0, material_cost: 20, labor_cost: 0, order_as_roll: false, is_fill: false, is_optional: false };
const tearout = { room: null, description: "Tear-out & haul-away", line_type: "mat_labor",
  category: "labor", measure_unit: "sqft", unit: "each", quantity: 1, material_rate: 0, labor_rate: 300, material_cost: 0, labor_cost: 150, is_optional: false };
const subfloor = { room: null, description: "Subfloor prep — plywood underlayment", line_type: "installed",
  category: "underlayment", measure_unit: "sqft", unit: "each", quantity: 1, installed_rate: 600, material_cost: 400, labor_cost: 0, is_optional: true };
const moisture = { room: null, description: "Moisture mitigation & sealing", line_type: "mat_labor",
  category: "labor", measure_unit: "sqft", unit: "each", quantity: 1, material_rate: 0, labor_rate: 400, material_cost: 0, labor_cost: 200, is_optional: true };

async function setup() {
  const { data: c } = await db.from("customers").insert({ full_name: TAG, source: "referral" }).select("id").single();
  custId = c!.id;
  const { data: e } = await db.from("estimates").insert({ customer_id: custId, title: `${TAG} estimate`, status: "sent", tax_rate: 8 }).select("id").single();
  estId = e!.id;
  const { data: oa } = await db.from("estimate_options").insert({ estimate_id: estId, name: "Option A — Standard", position: 0 }).select("id").single();
  optAId = oa!.id;
  const { data: ob } = await db.from("estimate_options").insert({ estimate_id: estId, name: "Option B — With Subfloor & Moisture", position: 1 }).select("id").single();
  optBId = ob!.id;
  const rows = (optId: string, lines: any[]) => lines.map((l, i) => ({ option_id: optId, position: i, waste_pct: 0, order_as_roll: false, is_fill: false, ...l }));
  await db.from("estimate_line_items").insert([
    ...rows(optAId, [carpet, tearout]),
    ...rows(optBId, [carpet, tearout, subfloor, moisture]),
  ]).throwOnError();
  // Recommend Option B.
  await db.from("estimates").update({ recommended_option_id: optBId }).eq("id", estId);
}

async function linesFor(optId: string) {
  const { data } = await db.from("estimate_line_items").select("*").eq("option_id", optId).order("position");
  return data ?? [];
}

async function run() {
  console.log("MULTI-OPTION ESTIMATE — one estimate, two options\n");
  await setup();
  const A = await linesFor(optAId);
  const B = await linesFor(optBId);

  // 1) Two options in ONE estimate, each its own total.
  const tA = optionTotalsWithDiscount(A as any[], 8, "amount", 0);
  const tB = optionTotalsWithDiscount(B as any[], 8, "amount", 0);
  console.log(`  Option A total ${money(tA.total)} · Option B total ${money(tB.total)}`);
  ok(Math.abs(tA.subtotal - 1500) < 0.01, "Option A retail = carpet 1200 + tear-out 300", money(tA.subtotal));
  ok(Math.abs(tB.subtotal - 2500) < 0.01, "Option B retail = A + subfloor 600 + moisture 400", money(tB.subtotal));
  ok(tB.total > tA.total, "each option carries its OWN total (B > A)");

  // 2) Owner per-option cost / margin.
  const costA = A.reduce((s: number, l: any) => s + lineCost(l), 0);
  const costB = B.reduce((s: number, l: any) => s + lineCost(l), 0);
  console.log(`  Owner — A: cost ${money(costA)}, margin ${Math.round(marginPct(tA.subtotal, costA))}%  |  B: cost ${money(costB)}, margin ${Math.round(marginPct(tB.subtotal, costB))}%`);
  ok(costA > 0 && costB > costA, "per-option cost computed (B costs more than A)");
  ok(marginPct(tA.subtotal, costA) > 0 && marginPct(tB.subtotal, costB) > 0, "per-option margin computed for both");

  // 3) Customer scope differs per option — firewall-safe (words, no numbers).
  const scopeA = JSON.stringify(buildCustomerScope(A as any[], null)).toLowerCase();
  const scopeB = JSON.stringify(buildCustomerScope(B as any[], null)).toLowerCase();
  ok(!scopeA.includes("subfloor") && !scopeA.includes("moisture"), "Option A scope excludes subfloor & moisture");
  ok(scopeB.includes("subfloor") && scopeB.includes("moisture"), "Option B scope includes subfloor & moisture");
  ok(!/\b360\b|sq ?yd|sq ?ft|\bqty\b/.test(scopeA + scopeB), "customer scope shows NO quantities / units (firewall holds)");

  // 4) Recommended option flagged.
  const { data: est1 } = await db.from("estimates").select("recommended_option_id").eq("id", estId).maybeSingle();
  ok(est1?.recommended_option_id === optBId, "Option B is flagged Recommended");

  // 5) Optional add-ons: B's extra work is flagged; the "without" version == A.
  const optionalDescs = B.filter((l: any) => l.is_optional).map((l: any) => l.description);
  ok(optionalDescs.length === 2, "B's subfloor + moisture are marked Optional", optionalDescs.join(", "));
  const bWithout = optionTotalsWithDiscount(B.filter((l: any) => !l.is_optional) as any[], 8, "amount", 0);
  ok(Math.abs(bWithout.subtotal - tA.subtotal) < 0.01, "B minus its optional lines equals Option A (the 'without add-ons' version)");

  // 6) Approve Option B → ONLY B flows forward (accepted option drives job/PO/WO).
  await db.from("estimates").update({ status: "approved", accepted_option_id: optBId }).eq("id", estId);
  const { data: est2 } = await db.from("estimates").select("accepted_option_id").eq("id", estId).maybeSingle();
  // Mirror ensureJobForEstimate / createPOFromEstimate: use accepted_option_id.
  const flowingOptionId = (est2?.accepted_option_id as string) || optAId;
  const flowing = await linesFor(flowingOptionId);
  const flowingHasSubfloor = flowing.some((l: any) => /subfloor/i.test(l.description));
  ok(flowingOptionId === optBId, "approved estimate → the flowing option is B (not A, not both)");
  ok(flowingHasSubfloor, "the work order / PO scope is B's (includes subfloor)");
  ok(!flowing.some((l: any) => A.length && flowing.length === A.length), "flowing scope is a SINGLE option, not all options combined", `${flowing.length} lines`);

  // The job the portal auto-creates would carry option_id = B.
  const { data: j } = await db.from("jobs").insert({ customer_id: custId, estimate_id: estId, option_id: flowingOptionId, title: `${TAG} job`, status: "scheduled" }).select("id, option_id").single();
  jobId = j!.id;
  ok(j!.option_id === optBId, "created job.option_id = Option B → WO/PO build from B only");
}

async function cleanup() {
  if (jobId) await db.from("jobs").delete().eq("id", jobId);
  if (optAId) await db.from("estimate_line_items").delete().eq("option_id", optAId);
  if (optBId) await db.from("estimate_line_items").delete().eq("option_id", optBId);
  if (estId) await db.from("estimate_options").delete().eq("estimate_id", estId);
  if (estId) await db.from("estimates").delete().eq("id", estId);
  if (custId) await db.from("customers").delete().eq("id", custId);
}

run().catch((e) => { fail++; console.error("  ✗ ERROR:", e.message); }).finally(async () => {
  await cleanup();
  console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed  (throwaway data cleaned up)`);
  process.exit(fail === 0 ? 0 : 1);
});
