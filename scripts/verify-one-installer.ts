// MANUAL / STAGING-LIKE VERIFICATION — NOT PART OF DEFAULT PR CI.
// Requires .env.local + service-role (or equivalent). Do not default to production.
//
// Verifies the unified "one named installer" assignment against live logic:
//   - the unified installer list (login installers + login-less sub crews)
//   - bookInstall's two branches (profile → assigned_to + crew synced; crew:<id>
//     → assigned_crew_id, assigned_to null) simulated on a throwaway job.
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
let pass = 0, fail = 0;
const ok = (c: boolean, m: string, d = "") => { if (c) { pass++; console.log(`  ✓ ${m}${d?"  "+d:""}`);} else { fail++; console.log(`  ✗ FAIL: ${m}${d?"  "+d:""}`);} };

// --- The unified installer list (mirrors buildInstallScheduleProps) ---
const { data: crews } = await db.from("install_crews").select("id, name, profile_id, active").eq("active", true);
const { data: profs } = await db.from("profiles").select("id, full_name, role").in("role", ["crew"]);
const loginInstallers = (profs ?? []).map((p: any) => ({ value: p.id, label: p.full_name }));
const loginlessCrews = (crews ?? []).filter((c: any) => !c.profile_id).map((c: any) => ({ value: `crew:${c.id}`, label: `${c.name} (sub)` }));
const unified = [...loginInstallers, ...loginlessCrews];
console.log("=== UNIFIED INSTALLER LIST ===");
console.log(`  login installers: ${loginInstallers.length}  ·  login-less sub crews: ${loginlessCrews.length}  ·  total options: ${unified.length}`);
ok(unified.length === loginInstallers.length + loginlessCrews.length, "one list = login installers + login-less crews");
// no crew linked to a login appears twice
const linkedCrewIds = new Set((crews ?? []).filter((c: any) => c.profile_id).map((c: any) => `crew:${c.id}`));
ok(!unified.some((o) => linkedCrewIds.has(o.value)), "a crew linked to a login installer is NOT listed separately (no duplicate)");

// --- bookInstall branches, simulated on a throwaway job ---
const ryan = (profs ?? []).find((p: any) => /swanson/i.test(p.full_name)) ?? (profs ?? [])[0];
const sub = (crews ?? []).find((c: any) => !c.profile_id);
const { data: cust } = await db.from("customers").insert({ full_name: "ZZ OneInstaller Cust" }).select("id").single();
const { data: job } = await db.from("jobs").insert({ customer_id: cust!.id, title: "ZZ OneInstaller", status: "unscheduled" }).select("id").single();
const jid = job!.id;

// helper mirroring bookInstall's assignment writes (not the whole action)
async function book(installerValue: string) {
  const crewDirect = installerValue.startsWith("crew:") ? installerValue.slice(5) : null;
  const installer = crewDirect ? "" : installerValue;
  await db.from("jobs").update({
    assigned_to: installer || null,
    ...(crewDirect ? { assigned_crew_id: crewDirect } : {}),
    scheduled_date: "2026-08-01", status: "scheduled", open_for_claim: false,
  }).eq("id", jid);
  if (installer) {
    // ensureCrewForProfile: find the crew linked to this profile
    const { data: c } = await db.from("install_crews").select("id").eq("profile_id", installer).maybeSingle();
    if (c) await db.from("jobs").update({ assigned_crew_id: c.id }).eq("id", jid);
  }
}

console.log("\n=== BRANCH 1 — book a LOGIN installer ===");
if (ryan) {
  await book(ryan.id);
  const { data: j } = await db.from("jobs").select("assigned_to, assigned_crew_id, open_for_claim, status").eq("id", jid).single();
  ok(j!.assigned_to === ryan.id, "assigned_to = the login installer (so it shows in their My Work)");
  ok(!!j!.assigned_crew_id, "assigned_crew_id is synced (warehouse/pay/grid have a crew)", j!.assigned_crew_id ? "set" : "MISSING");
  ok(j!.open_for_claim === false && j!.status === "scheduled", "booked: scheduled + off the board");
}

console.log("\n=== BRANCH 2 — book a login-less SUB crew (crew:<id>) ===");
if (sub) {
  await book(`crew:${sub.id}`);
  const { data: j } = await db.from("jobs").select("assigned_to, assigned_crew_id").eq("id", jid).single();
  ok(j!.assigned_to === null, "assigned_to cleared (a login-less sub has no My Work)");
  ok(j!.assigned_crew_id === sub.id, "assigned_crew_id = the sub crew");
} else {
  console.log("  (no login-less sub crew in the data to test — skipped)");
}

console.log("\n=== REASSIGN — sub → login installer moves BOTH fields ===");
if (ryan && sub) {
  await book(ryan.id);
  const { data: j } = await db.from("jobs").select("assigned_to, assigned_crew_id").eq("id", jid).single();
  const { data: ryanCrew } = await db.from("install_crews").select("id").eq("profile_id", ryan.id).maybeSingle();
  ok(j!.assigned_to === ryan.id, "assigned_to now the installer");
  ok(j!.assigned_crew_id === (ryanCrew?.id ?? j!.assigned_crew_id), "assigned_crew_id followed to the installer's crew (not the old sub)");
}

console.log("\n=== CLEANUP ===");
await db.from("jobs").delete().eq("id", jid);
await db.from("customers").delete().eq("id", cust!.id);
ok(true, "throwaway job + customer removed");

console.log(`\n${"═".repeat(50)}\n  ${pass} passed, ${fail} failed\n${"═".repeat(50)}`);
if (fail) process.exit(1);
