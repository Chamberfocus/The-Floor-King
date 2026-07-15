// Proves an installer can NEVER read another installer's assigned job — at the
// DATABASE level (real RLS), using genuine authenticated sessions. Plus the
// explicit /jobs query scope. Throwaway data, cleaned up.
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { createLogin } from "@/lib/auth-admin";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const svc = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!); // owner / service role
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let pass = 0, fail = 0;
const ok = (c: boolean, m: string, d = "") => { if (c) { pass++; console.log(`  ✓ ${m}${d?"  "+d:""}`);} else { fail++; console.log(`  ✗ FAIL: ${m}${d?"  "+d:""}`);} };

const TAG = "ZZ Privacy";
const PA = "5550100301", PB = "5550100302", PIN = "445566";
const jobIds: string[] = [];
let custId: string | null = null;

async function cleanup() {
  await svc.from("job_applications").delete().in("job_id", jobIds.length ? jobIds : ["_"]);
  await svc.from("jobs").delete().ilike("title", `${TAG}%`);
  for (const ph of [PA, PB]) {
    const { data } = await svc.from("profiles").select("id").eq("phone", ph);
    for (const p of data ?? []) await svc.auth.admin.deleteUser(p.id as string).catch(() => {});
  }
  await svc.from("customers").delete().ilike("full_name", `${TAG}%`);
}
await cleanup();

console.log("=== SETUP ===");
const A = (await createLogin({ phone: PA, password: PIN, fullName: `${TAG} A`, role: "crew" })).userId!;
const B = (await createLogin({ phone: PB, password: PIN, fullName: `${TAG} B`, role: "crew" })).userId!;
const { data: cust } = await svc.from("customers").insert({ full_name: `${TAG} Cust` }).select("id").single();
custId = cust!.id;
const mk = async (title: string, patch: any) => {
  const { data } = await svc.from("jobs").insert({ customer_id: custId, title: `${TAG} ${title}`, status: "unscheduled", ...patch }).select("id").single();
  jobIds.push(data!.id); return data!.id;
};
const jobA = await mk("A-owned", { assigned_to: A, open_for_claim: false });
const jobB = await mk("B-owned", { assigned_to: B, open_for_claim: false });
const jobOpen = await mk("open", { assigned_to: null, open_for_claim: true });
ok(!!A && !!B && jobIds.length === 3, "2 installers + 3 jobs (A's, B's, open)");

// Authenticate AS installer A (real RLS session via phone-PIN placeholder email).
const asA = createClient(URL, ANON);
const signInA = await asA.auth.signInWithPassword({ email: `p${PA}@crew.floorking.local`, password: PIN });
ok(!signInA.error, "signed in as installer A", signInA.error?.message ?? "");

console.log("\n=== THE CORE PRIVACY CHECK — A cannot read B's assigned job ===");
const bById = await asA.from("jobs").select("id,title").eq("id", jobB).maybeSingle();
ok(!bById.data, "A reading B's job by id → nothing (RLS blocks it at the DB)", bById.data ? "LEAK!" : "");
const aVisible = await asA.from("jobs").select("id").in("id", [jobA, jobB, jobOpen]);
const visibleIds = new Set((aVisible.data ?? []).map((j: any) => j.id));
ok(!visibleIds.has(jobB), "B's job is NOT in A's full jobs read");
ok(visibleIds.has(jobA), "A CAN see their own assigned job");
ok(visibleIds.has(jobOpen), "A CAN see the open board job");
ok(visibleIds.size === 2, "A sees exactly their own + the open board job (2)", `saw ${visibleIds.size}`);

console.log("\n=== /jobs explicit scope — listJobs({assignedTo:A}) returns only A's own ===");
const scoped = await asA.from("jobs").select("id").eq("assigned_to", A);
const scopedIds = (scoped.data ?? []).map((j: any) => j.id);
ok(scopedIds.length === 1 && scopedIds[0] === jobA, "crew /jobs query returns only A's own job (not the open one, not B's)", `[${scopedIds.length}]`);

console.log("\n=== OWNER (service role) still sees everything ===");
const ownerAll = await svc.from("jobs").select("id").in("id", [jobA, jobB, jobOpen]);
ok((ownerAll.data ?? []).length === 3, "owner sees all 3 jobs (unrestricted)");

console.log("\n=== CLAIM — after a board job is claimed, it leaves the OTHER installer's board ===");
// A claims the open job; owner approves (assigns to A, closes the board).
await svc.from("job_applications").upsert({ job_id: jobOpen, installer_id: A, status: "applied" }, { onConflict: "job_id,installer_id" });
await svc.from("jobs").update({ assigned_to: A, open_for_claim: false }).eq("id", jobOpen);
const asB = createClient(URL, ANON);
await asB.auth.signInWithPassword({ email: `p${PB}@crew.floorking.local`, password: PIN });
const bSeesClaimed = await asB.from("jobs").select("id").eq("id", jobOpen).maybeSingle();
ok(!bSeesClaimed.data, "once claimed & assigned to A, B can no longer see that job (left B's board)");
const aOwnsClaimed = await asA.from("jobs").select("assigned_to").eq("id", jobOpen).maybeSingle();
ok(aOwnsClaimed.data?.assigned_to === A, "the claimed job is now A's");

console.log("\n=== CLEANUP ===");
await asA.auth.signOut(); await asB.auth.signOut();
await cleanup();
const { count } = await svc.from("jobs").select("id", { count: "exact", head: true }).ilike("title", `${TAG}%`);
ok((count ?? 0) === 0, "throwaway data removed");

console.log(`\n${"═".repeat(56)}\n  ${pass} passed, ${fail} failed\n${"═".repeat(56)}`);
if (fail) process.exit(1);
