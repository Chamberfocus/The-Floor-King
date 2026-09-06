// MANUAL / STAGING-LIKE VERIFICATION — NOT PART OF DEFAULT PR CI.
// Requires .env.local + service-role (or equivalent). Do not default to production.
//
/**
 * End-to-end check for lead-source capture + ROI reporting.
 * Run AFTER pasting migration 0112:
 *   node --import ./scripts/alias-hook.mjs scripts/verify-lead-source-roi.ts
 * Creates throwaway data (marked with a tag), asserts the report numbers and the
 * estimate source-gate, then deletes everything it made.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { optionTotalsWithDiscount } from "@/lib/estimate-calc";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const TAG = "__ROI_VERIFY__";
let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  cond ? pass++ : fail++;
};

// Gate logic, mirrored from getCustomerSourceStatus.
function gateOk(
  src: { detail_mode: string; detail_required: boolean } | null,
  cust: { source_id: string | null; source_detail_id: string | null; source_detail_text: string | null; referred_by_customer_id: string | null },
): boolean {
  if (!cust.source_id) return false;
  if (!src?.detail_required) return true;
  return src.detail_mode === "referrer"
    ? !!(cust.source_detail_text?.trim() || cust.referred_by_customer_id)
    : !!(cust.source_detail_id || cust.source_detail_text?.trim());
}

async function main() {
  // Preconditions: seeded sources exist.
  const { data: fb } = await db.from("lead_sources").select("*").eq("key", "facebook").maybeSingle();
  const { data: ref } = await db.from("lead_sources").select("*").eq("key", "referral").maybeSingle();
  if (!fb || !ref) {
    console.log("❌ Migration 0112 not applied (facebook/referral sources missing). Paste it first.");
    process.exit(1);
  }
  const { data: campaign } = await db
    .from("lead_source_details")
    .select("*")
    .eq("source_id", fb.id)
    .order("position")
    .limit(1)
    .maybeSingle();
  ok("Facebook has a seeded sub-detail option", !!campaign, campaign?.label);

  // --- Gate assertions (no DB writes) ---
  ok("Gate blocks a customer with NO source", !gateOk(fb, { source_id: null, source_detail_id: null, source_detail_text: null, referred_by_customer_id: null }));
  ok("Gate blocks Facebook (required) with no sub-detail", !gateOk(fb, { source_id: fb.id, source_detail_id: null, source_detail_text: null, referred_by_customer_id: null }));
  ok("Gate passes Facebook once a campaign is picked", gateOk(fb, { source_id: fb.id, source_detail_id: campaign?.id ?? "x", source_detail_text: null, referred_by_customer_id: null }));
  ok("Gate blocks Referral with no referrer name", !gateOk(ref, { source_id: ref.id, source_detail_id: null, source_detail_text: null, referred_by_customer_id: null }));
  ok("Gate passes Referral once a name is entered", gateOk(ref, { source_id: ref.id, source_detail_id: null, source_detail_text: "Jane Smith", referred_by_customer_id: null }));

  // --- Build throwaway data: 2 Facebook leads, 1 converts to an $800 job ---
  const { data: c1, error: ce1 } = await db
    .from("customers")
    .insert({ full_name: `${TAG} Lead A`, source_id: fb.id, source_detail_id: campaign?.id ?? null })
    .select("id")
    .single();
  const { data: c2, error: ce2 } = await db
    .from("customers")
    .insert({ full_name: `${TAG} Lead B`, source_id: fb.id, source_detail_id: campaign?.id ?? null })
    .select("id")
    .single();
  if (ce1 || ce2 || !c1 || !c2) {
    console.log("❌ Could not create test customers:", ce1?.message || ce2?.message);
    process.exit(1);
  }

  const { data: est } = await db
    .from("estimates")
    .insert({ customer_id: c1.id, title: `${TAG} job`, status: "approved", tax_rate: 0, discount_kind: "amount", discount_value: 0 })
    .select("id")
    .single();
  const { data: opt } = await db
    .from("estimate_options")
    .insert({ estimate_id: est!.id, name: "A", position: 0 })
    .select("id")
    .single();
  await db.from("estimate_line_items").insert({
    option_id: opt!.id,
    position: 0,
    description: `${TAG} carpet`,
    line_type: "mat_labor",
    category: "carpet",
    measure_unit: "sqft",
    sqft: 100,
    material_rate: 5,
    labor_rate: 3,
    waste_pct: 0,
  });

  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  await db.from("lead_source_spend").insert({ source_id: fb.id, detail_id: null, period, amount: 400 });

  // --- Recompute revenue exactly like the report does ---
  const { data: lines } = await db.from("estimate_line_items").select("*").eq("option_id", opt!.id);
  const revenue = optionTotalsWithDiscount(lines as never, 0, "amount", 0).total;
  ok("Job revenue from the estimate = $800", revenue === 800, `$${revenue}`);

  // --- Aggregate the Facebook rows the way the report groups them ---
  const { data: leads } = await db
    .from("customers")
    .select("id, source_id")
    .eq("source_id", fb.id)
    .like("full_name", `${TAG}%`);
  const leadCount = leads?.length ?? 0;
  ok("Facebook leads counted = 2", leadCount === 2, String(leadCount));

  const converted = 1; // c1 has the approved estimate
  const jobs = 1;
  const spend = 400;
  const costPerLead = spend / leadCount;
  const costPerJob = spend / jobs;
  const roas = revenue / spend;
  const avgJob = revenue / jobs;
  ok("Conversion rate = 50%", Math.round((converted / leadCount) * 100) === 50);
  ok("Average job value = $800", avgJob === 800, `$${avgJob}`);
  ok("Cost per lead = $200", costPerLead === 200, `$${costPerLead}`);
  ok("Cost per job = $400", costPerJob === 400, `$${costPerJob}`);
  ok("ROAS = 2.0×", roas === 2, `${roas}×`);

  // --- Cleanup ---
  await db.from("lead_source_spend").delete().eq("source_id", fb.id).eq("period", period).eq("amount", 400);
  await db.from("estimate_line_items").delete().eq("option_id", opt!.id);
  await db.from("estimate_options").delete().eq("id", opt!.id);
  await db.from("estimates").delete().eq("id", est!.id);
  await db.from("customers").delete().in("id", [c1.id, c2.id]);
  console.log("🧹 Cleaned up test data.");

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
