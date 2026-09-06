// MANUAL / STAGING-LIKE VERIFICATION — NOT PART OF DEFAULT PR CI.
// Requires .env.local + service-role (or equivalent). Do not default to production.
//
// END-TO-END against LIVE Supabase auth, driving the REAL shared helper
// (createLogin / resetLoginPin). Creates a throwaway crew + login, asserts the
// account + profile + link are correct, then deletes everything.
import { readFileSync } from "node:fs";
// Load env into process.env BEFORE anything calls createAdminClient().
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { createLogin, resetLoginPin, normalizePhone } from "@/lib/auth-admin";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
let pass = 0, fail = 0;
const ok = (c: boolean, m: string, d = "") => { if (c) { pass++; console.log(`  ✓ ${m}${d?"  "+d:""}`);} else { fail++; console.log(`  ✗ FAIL: ${m}${d?"  "+d:""}`);} };

// A phone unlikely to collide (555-01xx test range), unique-ish per run digits.
const PHONE = "5550100073";
const NAME = "ZZ Verify Crew";
let userId: string | null = null;
let crewId: string | null = null;

async function cleanup() {
  // remove any leftover from a prior run
  const { data: profs } = await db.from("profiles").select("id").eq("phone", PHONE);
  for (const p of profs ?? []) await db.auth.admin.deleteUser(p.id as string).catch(() => {});
  await db.from("install_crews").delete().eq("name", NAME);
}
await cleanup();

console.log("=== STEP 1 — create a crew row ===");
const { data: crew, error: ce } = await db.from("install_crews")
  .insert({ name: NAME, kind: "employee", phone: PHONE, active: true, skills: ["carpet"] })
  .select("id, profile_id").single();
if (ce) { console.error(ce); process.exit(1); }
crewId = crew.id;
ok(!!crewId && crew.profile_id === null, "crew created with no login yet");

console.log("\n=== STEP 2 — createLogin (the REAL shared helper) ===");
const r = await createLogin({ phone: PHONE, password: "246810", fullName: NAME, role: "crew" });
ok(!r.error, "createLogin returned no error", r.error ?? "");
ok(!!r.userId, "a user id came back");
userId = r.userId;

console.log("\n=== STEP 3 — the profile is a proper crew login ===");
const { data: prof } = await db.from("profiles").select("id, role, full_name, phone").eq("id", userId!).maybeSingle();
ok(!!prof, "profile row exists for the new user");
ok(prof?.role === "crew", "role is 'crew'", `(${prof?.role})`);
ok(normalizePhone(prof?.phone ?? "") === PHONE, "phone stored on the profile", `(${prof?.phone})`);
ok(prof?.full_name === NAME, "full name stored", `(${prof?.full_name})`);
// placeholder email for a phone-only login
const { data: authUser } = await db.auth.admin.getUserById(userId!);
ok(authUser.user?.email === `p${PHONE}@crew.floorking.local`, "phone-only login got a placeholder email", `(${authUser.user?.email})`);

console.log("\n=== STEP 4 — link the login to the crew ===");
await db.from("install_crews").update({ profile_id: userId }).eq("id", crewId!);
const { data: linked } = await db.from("install_crews").select("profile_id").eq("id", crewId!).single();
ok(linked?.profile_id === userId, "crew.profile_id now points at the login");

console.log("\n=== STEP 5 — duplicate phone is rejected ===");
const dup = await createLogin({ phone: PHONE, password: "999999", fullName: "dupe", role: "crew" });
ok(!!dup.error && /already has a login/i.test(dup.error), "second login on the same phone is refused", dup.error ?? "");
ok(dup.userId === null, "no user created for the duplicate");

console.log("\n=== STEP 6 — PIN reset works ===");
const reset = await resetLoginPin(userId!, "135790", PHONE);
ok(!reset.error, "resetLoginPin returned no error", reset.error ?? "");

console.log("\n=== STEP 7 — the crew can now sign in with phone + PIN ===");
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
const signIn = await anon.auth.signInWithPassword({ email: `p${PHONE}@crew.floorking.local`, password: "135790" });
ok(!signIn.error && !!signIn.data.user, "sign in with the placeholder email + new PIN succeeds", signIn.error?.message ?? "");

console.log("\n=== STEP 8 — validation guards ===");
ok((await createLogin({ password: "123456", role: "crew" })).error !== null, "no phone/email → error");
ok((await createLogin({ phone: "5550100999", password: "12", role: "crew" })).error !== null, "PIN under 6 → error");

console.log("\n=== CLEANUP ===");
await db.auth.admin.deleteUser(userId!);
await db.from("install_crews").delete().eq("id", crewId!);
const { data: gone } = await db.from("profiles").select("id").eq("id", userId!).maybeSingle();
ok(!gone, "auth user + profile removed");
const { count } = await db.from("install_crews").select("id", { count: "exact", head: true }).eq("name", NAME);
ok((count ?? 0) === 0, "test crew removed");

console.log(`\n${"═".repeat(52)}\n  ${pass} passed, ${fail} failed\n${"═".repeat(52)}`);
if (fail) process.exit(1);
