/**
 * Read-only 0182 production verification. No uploads, deletes, or DML.
 * Usage: node --env-file=.env.local scripts/verify-0182-production.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  console.error("Missing Supabase env");
  process.exit(1);
}

const anon = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const svc = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const JOB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function clip(s, n = 220) {
  return String(s ?? "").replace(/\s+/g, " ").slice(0, n);
}

async function trySql(sql) {
  const endpoints = [`${url}/pg/query`, `${url}/pg-meta/default/query`];
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      });
      const text = await res.text();
      if (!res.ok) {
        console.log(`SQL ${ep} → ${res.status}: ${clip(text, 140)}`);
        continue;
      }
      try {
        return { ok: true, endpoint: ep, data: JSON.parse(text) };
      } catch {
        return { ok: true, endpoint: ep, data: text };
      }
    } catch (e) {
      console.log(`SQL ${ep} threw: ${e.message}`);
    }
  }
  return { ok: false };
}

async function rpc(client, name, args, label) {
  const { data, error } = await client.rpc(name, args);
  console.log(
    "RPC",
    label,
    name,
    "data=",
    data === null || data === undefined ? String(data) : JSON.stringify(data),
    "err=",
    error ? `${error.code || ""} ${clip(error.message)}` : "none",
  );
  return { data, error };
}

async function bucket(id) {
  const res = await fetch(`${url}/storage/v1/bucket/${id}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const text = await res.text();
  console.log("BUCKET", id, res.status, clip(text, 400));
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function main() {
  console.log("=== 0182 production verification (read-only) ===\n");

  const openRes = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const openBody = await openRes.text();
  console.log("OpenAPI status:", openRes.status, "bytes:", openBody.length);

  const fingerprints = [
    "job_files_storage_job_id",
    "job_files_job_id_from_name",
    "can_read_job_files_object",
    "can_write_job_files_object",
    "installer_linked_crew_ids",
    "mine_job",
    "is_staff",
  ];
  for (const f of fingerprints) {
    console.log("OpenAPI", f, openBody.includes(f) ? "PRESENT" : "MISSING");
  }

  const catalog = await trySql(`
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname in (
      'job_files_storage_job_id',
      'job_files_job_id_from_name',
      'can_read_job_files_object',
      'can_write_job_files_object'
    )
    order by p.proname
  `);
  console.log("CATALOG_FNS", catalog.ok ? JSON.stringify(catalog.data) : "UNAVAILABLE");

  const policies = await trySql(`
    select policyname, cmd, roles::text, qual, with_check
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
    order by policyname
  `);
  console.log("CATALOG_POLICIES", policies.ok ? JSON.stringify(policies.data) : "UNAVAILABLE");

  const { data: flags, error: flagErr } = await svc
    .from("accounting_settings")
    .select(
      "posting_enabled,inventory_posting_enabled,ap_posting_enabled,installer_posting_enabled,books_of_record,opening_balances_entered,accountant_validated,cutover_date",
    )
    .eq("id", 1)
    .maybeSingle();
  console.log("FLAGS", flagErr?.message || flags);

  await bucket("job-files");
  await bucket("documents");
  await bucket("branding");

  const { data: listed, error: listErr } = await svc.storage
    .from("job-files")
    .list("", { limit: 1000, sortBy: { column: "name", order: "asc" } });
  console.log(
    "JOB_FILES_ROOT_LIST",
    listErr?.message || "ok",
    "n=",
    listed?.length ?? 0,
  );

  const { count: metaCount, error: metaErr } = await svc
    .from("job_files")
    .select("id", { count: "exact", head: true });
  console.log("JOB_FILES_META_COUNT", metaErr?.message || metaCount);

  const { data: jobRow, error: jobErr } = await svc
    .from("jobs")
    .select("id, assigned_to, assigned_crew_id, open_for_claim")
    .limit(1)
    .maybeSingle();
  console.log("SAMPLE_JOB", jobErr?.message || jobRow);

  const { data: claimJob } = await svc
    .from("jobs")
    .select("id, open_for_claim, assigned_to")
    .eq("open_for_claim", true)
    .limit(1)
    .maybeSingle();
  console.log("OPEN_FOR_CLAIM_JOB", claimJob || "none");

  console.log("\n--- path parser (service role) ---");
  await rpc(svc, "job_files_storage_job_id", { object_name: `${JOB_A}/photo.jpg` }, "svc-valid");
  await rpc(svc, "job_files_storage_job_id", { object_name: `${JOB_A}/signature-1.png` }, "svc-sig");
  await rpc(svc, "job_files_storage_job_id", { object_name: "not-a-uuid/photo.jpg" }, "svc-bad-uuid");
  await rpc(svc, "job_files_storage_job_id", { object_name: "/foo.jpg" }, "svc-slash");
  await rpc(svc, "job_files_storage_job_id", { object_name: "" }, "svc-empty");
  await rpc(svc, "job_files_storage_job_id", { object_name: "photo.jpg" }, "svc-no-folder");
  await rpc(svc, "job_files_storage_job_id", { object_name: `${JOB_A}/../x.png` }, "svc-dotdot");
  await rpc(svc, "job_files_job_id_from_name", { object_name: `${JOB_A}/photo.jpg` }, "svc-alias-missing");

  console.log("\n--- can_read / can_write fail-closed (service role, no JWT uid) ---");
  const realJob = jobRow?.id ?? JOB_A;
  await rpc(svc, "can_read_job_files_object", { job_uuid: realJob }, "svc-read-real");
  await rpc(svc, "can_write_job_files_object", { job_uuid: realJob }, "svc-write-real");
  await rpc(svc, "can_read_job_files_object", { job_uuid: JOB_A }, "svc-read-fake");
  await rpc(svc, "can_write_job_files_object", { job_uuid: JOB_A }, "svc-write-fake");
  if (claimJob?.id) {
    await rpc(svc, "can_read_job_files_object", { job_uuid: claimJob.id }, "svc-read-claim");
    await rpc(svc, "can_write_job_files_object", { job_uuid: claimJob.id }, "svc-write-claim");
  }

  console.log("\n--- anon RPCs (must be denied or false) ---");
  await rpc(anon, "job_files_storage_job_id", { object_name: `${JOB_A}/photo.jpg` }, "anon-parse");
  await rpc(anon, "can_read_job_files_object", { job_uuid: realJob }, "anon-read");
  await rpc(anon, "can_write_job_files_object", { job_uuid: realJob }, "anon-write");

  console.log("\n--- anon storage (no upload/delete) ---");
  const { data: anonList, error: aListErr } = await anon.storage
    .from("job-files")
    .list("", { limit: 5 });
  console.log("ANON_LIST", aListErr ? clip(aListErr.message) : "ok", "n=", anonList?.length ?? 0);

  const guess = `${realJob}/signature-does-not-exist.png`;
  const { data: anonDl, error: aDlErr } = await anon.storage
    .from("job-files")
    .download(guess);
  console.log(
    "ANON_DOWNLOAD_GUESS",
    aDlErr ? clip(aDlErr.message) : `unexpected-ok size=${anonDl?.size ?? "n/a"}`,
  );

  const { data: anonSigned, error: aSignErr } = await anon.storage
    .from("job-files")
    .createSignedUrl(guess, 60);
  console.log(
    "ANON_SIGNED",
    aSignErr ? clip(aSignErr.message) : clip(anonSigned?.signedUrl, 80),
  );

  const { data: svcSigned, error: sSignErr } = await svc.storage
    .from("job-files")
    .createSignedUrl(guess, 3600);
  console.log(
    "SVC_SIGNED_MISSING_OBJECT",
    sSignErr ? clip(sSignErr.message) : clip(svcSigned?.signedUrl, 80),
  );

  console.log("\n--- documents/branding fingerprints (0182 must not rewrite) ---");
  console.log("OpenAPI documents table", openBody.includes('"documents"') ? "PRESENT" : "MISSING");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
