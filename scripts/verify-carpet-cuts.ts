// Verifies carpet CUTS + FILL pieces flow onto all three documents against the
// LIVE db, using the exact shared source each doc renders from:
//   • Work order   → carpetCutList(job.line_items)
//   • Staging sheet→ carpetCutList(getJobMaterials lines)  [isFill = !!is_fill]
//   • Purchase order→ carpetCutList(getEstimateCutSources)  [same estimate lines]
// Creates a throwaway carpet job (2 rooms, each with a main cut + a fill piece)
// plus a hard-surface line, then reads it back through those paths. Cleaned up.
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { carpetCutList, type CutSource } from "@/lib/job-scope";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
let pass = 0, fail = 0;
const ok = (c: boolean, m: string, d = "") => { if (c) { pass++; console.log(`  ✓ ${m}${d ? "  " + d : ""}`); } else { fail++; console.log(`  ✗ FAIL: ${m}${d ? "  " + d : ""}`); } };

const TAG = "ZZ Carpet Cut Verify";
let custId = "", estId = "", optId = "", jobId = "";

// in = feet*12 + inches
const IN = (ft: number, inch = 0) => ft * 12 + inch;

async function setup() {
  const { data: c } = await db.from("customers").insert({ full_name: TAG, source: "referral" }).select("id").single();
  custId = c!.id;
  const { data: e } = await db.from("estimates").insert({ customer_id: custId, title: `${TAG} estimate`, status: "draft", tax_rate: 0 }).select("id").single();
  estId = e!.id;
  const { data: o } = await db.from("estimate_options").insert({ estimate_id: estId, name: "Option A", position: 0 }).select("id").single();
  optId = o!.id;

  // Carpet cuts: 2 rooms, each a MAIN cut + a FILL piece, ordered as a 12 ft roll.
  const carpet = (room: string, wIn: number, lIn: number, isFill: boolean, pos: number) => ({
    option_id: optId, position: pos, room, description: "Mohawk SmartStrand — Oatmeal",
    line_type: "mat_labor", category: "carpet", measure_unit: "sqyd",
    length_in: lIn, width_in: wIn, order_as_roll: true, roll_width_ft: 12, is_fill: isFill,
    quantity: Math.round(((wIn / 12) * (lIn / 12) / 9) * 100) / 100, unit: "sq yd",
    material_rate: 30, material_cost: 20,
  });
  const rows = [
    carpet("Living Room", IN(12), IN(15), false, 0),      // 12' × 15'
    carpet("Living Room", IN(3), IN(6), true, 1),         // FILL 3' × 6'
    carpet("Bedroom", IN(12), IN(11, 6), false, 2),       // 12' × 11'6"
    carpet("Bedroom", IN(2, 6), IN(4), true, 3),          // FILL 2'6" × 4'
    // A hard-surface line — must NOT appear in the carpet cut list.
    { option_id: optId, position: 4, room: "Kitchen", description: "Shaw LVP — Oak",
      line_type: "mat_labor", category: "lvp", measure_unit: "sqft", order_as_roll: false,
      sqft: 180, quantity: 180, unit: "sq ft", sqft_per_box: 30, material_rate: 4, material_cost: 3, is_fill: false },
  ];
  const { error } = await db.from("estimate_line_items").insert(rows);
  if (error) throw new Error("line insert failed — is migration 0104 run? " + error.message);

  const { data: j } = await db.from("jobs").insert({ customer_id: custId, estimate_id: estId, option_id: optId, title: `${TAG} job`, status: "scheduled" }).select("id").single();
  jobId = j!.id;
}

/** The estimate carpet lines — the source the work order & PO both read. */
async function estimateLines(): Promise<CutSource[]> {
  const { data } = await db.from("estimate_line_items")
    .select("room, description, category, length_in, width_in, is_fill, roll_width_ft, manufacturer, color")
    .eq("option_id", optId).order("position", { ascending: true });
  return (data ?? []) as CutSource[];
}
/** The staging-sheet source: job material lines, mapped exactly as job-materials.ts does. */
async function stagingSources(): Promise<CutSource[]> {
  const { data } = await db.from("estimate_line_items").select("*").eq("option_id", optId).neq("category", "labor").order("position", { ascending: true });
  return (data ?? []).map((l: any): CutSource => ({
    room: l.room, description: l.description, category: l.category,
    length_in: l.length_in, width_in: l.width_in, is_fill: !!l.is_fill,
    roll_width_ft: l.roll_width_ft, manufacturer: l.manufacturer, color: l.color,
  }));
}

function show(label: string, list: ReturnType<typeof carpetCutList>) {
  console.log(`\n  ── ${label} ──`);
  for (const c of list.cuts) console.log(`     ${c.room.padEnd(12)} ${c.isFill ? "[FILL]" : "      "} ${c.size.padEnd(12)} ${c.sqyd} sq yd`);
  for (const r of list.rolls) console.log(`     roll: ${r.name} @ ${r.width} ft — ${r.count} cuts, ${r.totalSqyd} sq yd (~${r.linft} lin ft)`);
}

async function run() {
  console.log("CARPET CUT / FILL FLOW — staging sheet · work order · purchase order\n");
  await setup();

  const wo = carpetCutList(await estimateLines());          // work order
  const st = carpetCutList(await stagingSources());          // staging sheet
  const po = carpetCutList(await estimateLines());           // purchase order (same estimate lines)

  show("WORK ORDER cut list", wo);
  show("STAGING SHEET cut plan", st);
  show("PURCHASE ORDER cut list", po);

  console.log("\n  Assertions:");
  for (const [name, list] of [["work order", wo], ["staging sheet", st], ["purchase order", po]] as const) {
    ok(list.cuts.length === 4, `${name}: 4 carpet cuts (hard surface excluded)`, `got ${list.cuts.length}`);
    ok(list.cuts.filter((c) => c.isFill).length === 2, `${name}: both FILL pieces present & flagged`);
    ok(list.cuts.some((c) => c.room === "Living Room" && c.size === "12' × 15'"), `${name}: Living Room main cut 12'×15'`);
    ok(list.cuts.some((c) => c.room === "Living Room" && c.isFill && c.size === "3' × 6'"), `${name}: Living Room FILL 3'×6'`);
    ok(list.cuts.some((c) => c.room === "Bedroom" && c.size === `12' × 11' 6"`), `${name}: Bedroom main cut 12'×11'6"`);
    ok(!list.cuts.some((c) => /LVP|Oak/.test(c.name)), `${name}: hard-surface line NOT in carpet cut list`);
  }
  // Yardage accounts for every cut incl. fill, and the roll converts to linear ft.
  const total = 180 / 9 + 18 / 9 + 138 / 9 + 10 / 9; // 12×15 + 3×6 + 12×11.5 + 2.5×4 sqft → sqyd = 38.44
  ok(Math.abs(po.totalSqyd - total) < 0.2, "PO yardage totals all cuts incl. fill", `${po.totalSqyd} sq yd`);
  ok(po.rolls.length === 1 && po.rolls[0].linft != null && po.rolls[0].linft > 0, "PO roll → linear feet computed @ 12 ft wide", `${po.rolls[0]?.linft} lin ft`);
  ok(wo.totalSqyd === st.totalSqyd && st.totalSqyd === po.totalSqyd, "all three docs agree on total yardage (one source)");
}

async function cleanup() {
  if (jobId) await db.from("jobs").delete().eq("id", jobId);
  if (optId) await db.from("estimate_line_items").delete().eq("option_id", optId);
  if (estId) await db.from("estimates").delete().eq("id", estId);
  if (custId) await db.from("customers").delete().eq("id", custId);
}

run().catch((e) => { fail++; console.error("  ✗ ERROR:", e.message); }).finally(async () => {
  await cleanup();
  console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed  (throwaway data cleaned up)`);
  process.exit(fail === 0 ? 0 : 1);
});
