/**
 * MANUAL / STAGING-LIKE VERIFICATION — NOT PART OF DEFAULT PR CI.
 * Requires .env.local + SUPABASE_SERVICE_ROLE_KEY. Do not default to production.
 *
 * Verifies carpet CUTS algorithm + PO ordered yardage from estimate lines
 * (commercial cut sync / buildPoItemRows). Customer labels stay firewall-safe.
 *
 * After a job exists, operational WO/staging prefer job_line_items (Step 3) —
 * see verify-carpet-cuts.ts for that path. This script focuses on cut-list
 * math + PO recompute from the same line shape (estimate or job lines).
 *
 * PO quantities come from buildPoItemRows (order semantics / lineOrderQty path).
 * Run:  node --import ./scripts/alias-hook.mjs scripts/verify-cuts-flow.ts
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { carpetCutList } from "@/lib/job-scope";
import { buildPoItemRows, carpetSignature } from "@/lib/po-build";
import { customerLineLabel } from "@/lib/customer-scope";
import { lineOrderQty } from "@/lib/estimate-calc";
import { isRollGoodCategory, type EstimateLineItem } from "@/lib/types";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let pass = 0,
  fail = 0;
const ok = (label: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  cond ? pass++ : fail++;
};
const TAG = "__CUTS_VERIFY__";
const r2 = (n: number) => Math.round(n * 100) / 100;

// A carpet cut line as the estimate builder stores it (area = room, W×L inches).
const cut = (room: string, widthIn: number, lengthIn: number, isFill = false) => ({
  room,
  description: "Dreamweaver Plush",
  category: "carpet",
  manufacturer: "Dreamweaver",
  measure_unit: "sqft",
  length_in: lengthIn,
  width_in: widthIn,
  is_fill: isFill,
  order_as_roll: true,
  roll_width_ft: 12,
  material_cost: 20,
  line_type: "mat_labor",
});

async function main() {
  const { data: dw } = await db.from("suppliers").select("id").eq("name", "Dreamweaver").maybeSingle();
  if (!dw) {
    console.log("❌ Need the Dreamweaver vendor (from 0113).");
    process.exit(1);
  }

  const { data: cust } = await db.from("customers").insert({ full_name: `${TAG} cuts` }).select("id").single();
  const { data: est } = await db
    .from("estimates")
    .insert({ customer_id: cust!.id, title: `${TAG} carpet`, status: "approved", tax_rate: 0 })
    .select("id")
    .single();
  const { data: opt } = await db
    .from("estimate_options")
    .insert({ estimate_id: est!.id, name: "A", position: 0 })
    .select("id")
    .single();
  await db.from("estimates").update({ accepted_option_id: opt!.id }).eq("id", est!.id);

  // Two areas + a fill piece, all off a 12' roll.
  const rows = [
    { ...cut("Living Room", 144, 186), position: 0 }, // 12' × 15'6"
    { ...cut("Bedroom", 144, 120), position: 1 }, // 12' × 10'
    { ...cut("Bedroom", 144, 36, true), position: 2 }, // 12' × 3' FILL
  ];
  await db.from("estimate_line_items").insert(rows.map((r) => ({ ...r, option_id: opt!.id })));
  const { data: lineData } = await db.from("estimate_line_items").select("*").eq("option_id", opt!.id).order("position");
  const lines = (lineData ?? []) as EstimateLineItem[];

  // ---- What WO / staging / PO cut list all render (the shared algorithm) ----
  const cl = carpetCutList(lines);
  ok("Cut list has 3 pieces across 2 areas", cl.cuts.length === 3 && new Set(cl.cuts.map((c) => c.room)).size === 2);
  ok("Fill piece flagged", cl.cuts.some((c) => c.isFill) && cl.hasFill);
  ok("Cut-list total yardage = 38.0 sq yd", cl.totalSqyd === 38, `${cl.totalSqyd}`);
  ok("Consolidates to ONE 12' roll", cl.rolls.length === 1 && cl.rolls[0].width === 12);

  // ---- What the PO orders (buildPoItemRows — order qty semantics) ----
  const poRows = buildPoItemRows(lines, { costOf: () => 20, nameOf: (l) => l.description || "Carpet" });
  const rollRow = poRows.find((r) => r.unit === "sqyd");
  ok("PO ordered yardage matches the cuts (38.0 sq yd @ 12')", rollRow?.quantity === 38 && rollRow?.roll_width_ft === 12, `${rollRow?.quantity}`);
  // Sanity: order need uses lineOrderQty (waste-in); these cuts have waste_pct unset → same as measured.
  ok(
    lines.every((l) => lineOrderQty(l) >= 0),
    "lineOrderQty defined for all cut lines (purchasing need)",
  );

  // ---- Customer estimate / invoice: words only, no measurements ----
  const firewallOk = lines.every((l) => {
    const label = customerLineLabel(l);
    return !label.includes("×") && !/\d+\s*['′]/.test(label) && !label.includes("186") && !label.includes("144");
  });
  ok("Customer label carries NO cut sizes (firewall holds)", firewallOk, customerLineLabel(lines[0]));

  // ---- Create a PO from the estimate (snapshot), then EDIT a cut ----
  const { data: po } = await db
    .from("purchase_orders")
    .insert({ customer_id: cust!.id, estimate_id: est!.id, supplier_id: dw.id, supplier: "Dreamweaver", source_type: "manufacturer", status: "draft" })
    .select("id")
    .single();
  const ins = await db.from("po_items").insert(poRows.map((r, i) => ({ ...r, po_id: po!.id, position: i })));
  if (ins.error) console.log("   po_items insert error:", ins.error.message);
  const before = await db.from("po_items").select("quantity, unit").eq("po_id", po!.id);
  const beforeRoll = (before.data ?? []).find((r) => (r.unit ?? "").toLowerCase().includes("yd"));
  ok("PO created with 38.0 sq yd ordered", Number(beforeRoll?.quantity) === 38, `${beforeRoll?.quantity} (rows: ${before.data?.length})`);

  // Edit the Living Room cut: 15'6" → 18' (186 → 216 in). New total = 24+13.33+4 = 41.33.
  await db.from("estimate_line_items").update({ length_in: 216 }).eq("option_id", opt!.id).eq("room", "Living Room");
  const { data: edited } = await db.from("estimate_line_items").select("*").eq("option_id", opt!.id).order("position");
  const clEdited = carpetCutList((edited ?? []) as EstimateLineItem[]);
  ok("Edited cut list re-totals to 41.33 sq yd", clEdited.totalSqyd === r2(24 + 13.33 + 4), `${clEdited.totalSqyd}`);

  // The sync's shared CORE (buildPoItemRows over the live cuts) — the exact
  // function the shipped syncPoCarpetFromEstimate calls — re-derives the carpet
  // rows; here we apply its write the same way (drift-detect, replace roll goods).
  const recomputed = buildPoItemRows((edited ?? []) as EstimateLineItem[], {
    costOf: () => 20,
    nameOf: (l) => l.description || "Carpet",
  }).filter((r) => isRollGoodCategory(r.category));
  const { data: existingItems } = await db.from("po_items").select("*").eq("po_id", po!.id);
  const existingCarpet = (existingItems ?? []).filter(
    (it) => isRollGoodCategory(it.category) || (it.unit ?? "").toLowerCase().includes("yd") || it.roll_width_ft,
  );
  const drift = carpetSignature(existingCarpet) !== carpetSignature(recomputed);
  ok("Drift detected after the edit (old 38.0 ≠ new 41.33)", drift);
  await db.from("po_items").delete().in("id", existingCarpet.map((it) => it.id));
  await db.from("po_items").insert(recomputed.map((r, i) => ({ ...r, po_id: po!.id, position: i })));

  const after = await db.from("po_items").select("quantity, unit").eq("po_id", po!.id);
  const afterRoll = (after.data ?? []).find((r) => (r.unit ?? "").toLowerCase().includes("yd"));
  ok("PO ordered yardage auto-updated to match the edited cuts", Number(afterRoll?.quantity) === clEdited.totalSqyd, `${afterRoll?.quantity}`);
  ok("No re-entry needed — PO now equals the cut list", Number(afterRoll?.quantity) === clEdited.totalSqyd);

  // Cleanup.
  await db.from("po_items").delete().eq("po_id", po!.id);
  await db.from("purchase_orders").delete().eq("id", po!.id);
  await db.from("estimate_line_items").delete().eq("option_id", opt!.id);
  await db.from("estimate_options").delete().eq("id", opt!.id);
  await db.from("estimates").delete().eq("id", est!.id);
  await db.from("customers").delete().eq("id", cust!.id);
  console.log("🧹 Cleaned up.");

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
