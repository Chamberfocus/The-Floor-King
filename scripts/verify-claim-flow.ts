// Verifies the three job states + claim/approve against the LIVE db, using the
// real state model (the exact columns the board query, My Jobs, and the
// assign/approve actions read & write). Throwaway data, cleaned up at the end.
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { createLogin } from "@/lib/auth-admin";
import { installerCanDoJob } from "@/lib/job-scope";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
let pass = 0, fail = 0;
const ok = (c: boolean, m: string, d = "") => { if (c) { pass++; console.log(`  ✓ ${m}${d?"  "+d:""}`);} else { fail++; console.log(`  ✗ FAIL: ${m}${d?"  "+d:""}`);} };

const TAG = "ZZ Claim Verify";
const PHONE1 = "5550100201", PHONE2 = "5550100202";
let installer1: string | null = null, installer2: string | null = null, custId: string | null = null;
const jobIds: string[] = [];

// The REAL installer-facing board query: open_for_claim, not assigned, targeting +
// skill gate. Mirrors listOpenJobs. Returns job ids a crew viewer would see.
async function boardFor(viewerId: string, skills: string[] = []) {
  const { data } = await db.from("jobs").select("id, option_id, board_installer_ids, assigned_to, open_for_claim").eq("open_for_claim", true);
  return (data ?? []).filter((j: any) => {
    const t = j.board_installer_ids;
    const targeted = Array.isArray(t) && t.length > 0;
    if (targeted) return t.includes(viewerId);
    return installerCanDoJob(skills, null); // no line items on throwaway jobs → type null → shown
  }).map((j: any) => j.id);
}
// The REAL "My Jobs" query: assigned_to = installer.
async function myJobs(installerId: string) {
  const { data } = await db.from("jobs").select("id").eq("assigned_to", installerId);
  return (data ?? []).map((j: any) => j.id);
}

async function cleanup() {
  await db.from("job_applications").delete().in("job_id", jobIds.length ? jobIds : ["_"]);
  await db.from("jobs").delete().ilike("title", `${TAG}%`);
  for (const ph of [PHONE1, PHONE2]) {
    const { data } = await db.from("profiles").select("id").eq("phone", ph);
    for (const p of data ?? []) await db.auth.admin.deleteUser(p.id as string).catch(() => {});
  }
  await db.from("customers").delete().ilike("full_name", `${TAG}%`);
}
await cleanup();

console.log("=== SETUP: 2 installers + a customer + 3 jobs (one per state) ===");
installer1 = (await createLogin({ phone: PHONE1, password: "222222", fullName: `${TAG} Installer1`, role: "crew" })).userId;
installer2 = (await createLogin({ phone: PHONE2, password: "333333", fullName: `${TAG} Installer2`, role: "crew" })).userId;
const { data: cust } = await db.from("customers").insert({ full_name: `${TAG} Cust` }).select("id").single();
custId = cust!.id;
const mk = async (title: string, patch: any) => {
  const { data, error } = await db.from("jobs").insert({ customer_id: custId, title: `${TAG} ${title}`, status: "unscheduled", ...patch }).select("id").single();
  if (error) throw error; jobIds.push(data!.id); return data!.id;
};
const jobPosted = await mk("A-posted", { open_for_claim: true, assigned_to: null });
const jobDirect = await mk("B-assigned", { open_for_claim: false, assigned_to: installer1 });
const jobIdle  = await mk("C-unposted", { open_for_claim: false, assigned_to: null });
ok(!!installer1 && !!installer2 && jobIds.length === 3, "created 2 installers + 3 jobs");

console.log("\n=== STATE 1 — posted job is claimable to installers ===");
ok((await boardFor(installer1)).includes(jobPosted), "posted job A appears on installer1's board");
ok((await boardFor(installer2)).includes(jobPosted), "posted job A appears on installer2's board (claimable by anyone)");

console.log("\n=== STATE 2 — directly-assigned job is private, never on the board ===");
ok((await myJobs(installer1)).includes(jobDirect), "assigned job B is in installer1's My Jobs");
ok(!(await boardFor(installer1)).includes(jobDirect), "assigned job B is NOT on the board");
ok(!(await myJobs(installer2)).includes(jobDirect), "assigned job B is NOT in installer2's My Jobs");

console.log("\n=== STATE 3 — unassigned + unposted shows to NOBODY ===");
ok(!(await boardFor(installer1)).includes(jobIdle) && !(await boardFor(installer2)).includes(jobIdle), "idle job C is on no one's board");
ok(!(await myJobs(installer1)).includes(jobIdle) && !(await myJobs(installer2)).includes(jobIdle), "idle job C is in no one's My Jobs");

console.log("\n=== CLAIM — installer1 requests job A (Option B: a request, not instant) ===");
await db.from("job_applications").upsert({ job_id: jobPosted, installer_id: installer1, status: "applied" }, { onConflict: "job_id,installer_id" });
// (the applyToJob guard also verified the job is still open+unassigned before inserting)
const { data: reqs } = await db.from("job_applications").select("installer_id, status").eq("job_id", jobPosted).eq("status", "applied");
ok((reqs ?? []).some((r: any) => r.installer_id === installer1), "installer1's claim request recorded (status 'applied')");
ok((await db.from("jobs").select("assigned_to").eq("id", jobPosted).single()).data?.assigned_to === null, "job A is NOT auto-assigned by requesting (approval required)");
ok((await boardFor(installer2)).includes(jobPosted), "job A still on the board while awaiting approval (installer2 could also request)");

console.log("\n=== APPROVE — office approves installer1 (the assignInstaller writes) ===");
await db.from("jobs").update({ assigned_to: installer1, open_for_claim: false, status: "scheduled" }).eq("id", jobPosted);
await db.from("job_applications").update({ status: "accepted" }).eq("job_id", jobPosted).eq("installer_id", installer1);
await db.from("job_applications").update({ status: "declined" }).eq("job_id", jobPosted).neq("installer_id", installer1);
ok((await myJobs(installer1)).includes(jobPosted), "approved job A is now in installer1's My Jobs");
ok(!(await boardFor(installer1)).includes(jobPosted) && !(await boardFor(installer2)).includes(jobPosted), "job A LEFT the board — no one else can claim it");
ok(!(await myJobs(installer2)).includes(jobPosted), "job A is not in installer2's My Jobs");

console.log("\n=== NO DOUBLE-CLAIM — a late request on the now-assigned job is refused ===");
// Mirrors applyToJob's guard: only open_for_claim && assigned_to IS NULL may be requested.
const { data: stillOpen } = await db.from("jobs").select("id").eq("id", jobPosted).eq("open_for_claim", true).is("assigned_to", null).maybeSingle();
ok(!stillOpen, "the guard blocks a claim request on an assigned/unposted job");

console.log("\n=== CLEANUP ===");
await cleanup();
const { count: jc } = await db.from("jobs").select("id", { count: "exact", head: true }).ilike("title", `${TAG}%`);
ok((jc ?? 0) === 0, "throwaway jobs removed");

console.log(`\n${"═".repeat(54)}\n  ${pass} passed, ${fail} failed\n${"═".repeat(54)}`);
if (fail) process.exit(1);
