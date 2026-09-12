/**
 * Read-only 0179 production verification. No DML on business tables.
 * Usage: node --env-file=.env.local scripts/verify-0179-production.mjs
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

function clip(s, n = 240) {
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
        console.log(`SQL ${ep} → ${res.status}: ${text.slice(0, 160)}`);
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

function rowOf(bundle) {
  if (!bundle?.ok) return null;
  const d = bundle.data;
  if (Array.isArray(d)) return d[0] ?? null;
  if (d && typeof d === "object") {
    if (Array.isArray(d.data)) return d.data[0] ?? null;
    return d;
  }
  return null;
}

async function main() {
  console.log("=== 0179 production verification (read-only) ===\n");

  const openRes = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const openBody = await openRes.text();
  console.log("OpenAPI status:", openRes.status, "bytes:", openBody.length);
  console.log(
    "env keys:",
    Object.keys(process.env)
      .filter((k) =>
        /SUPABASE|DATABASE|POSTGRES|ACCESS_TOKEN|DB_URL|DIRECT_URL/i.test(k),
      )
      .sort(),
  );
  console.log(
    "OpenAPI has F7/0178+0179 comment:",
    openBody.includes("F7/0178+0179"),
  );
  console.log(
    "OpenAPI has allow_portal_approval_mutation:",
    openBody.includes("allow_portal_approval_mutation"),
  );
  console.log(
    "OpenAPI has PORTAL_ESTIMATE_FORBIDDEN:",
    openBody.includes("PORTAL_ESTIMATE_FORBIDDEN"),
  );

  const hasProtectOpenApi = openBody.includes("estimates_protect_portal_columns");
  const hasApprovalOpenApi = openBody.includes("record_estimate_approval_safe");
  const hasCrewHelper = openBody.includes("installer_linked_crew_ids");
  const approvalWindow = hasApprovalOpenApi
    ? openBody.slice(
        Math.max(0, openBody.indexOf("record_estimate_approval_safe") - 80),
        openBody.indexOf("record_estimate_approval_safe") + 500,
      )
    : "";
  console.log("OpenAPI estimates_protect_portal_columns:", hasProtectOpenApi);
  console.log("OpenAPI record_estimate_approval_safe:", hasApprovalOpenApi);
  console.log("OpenAPI installer_linked_crew_ids (0180):", hasCrewHelper);
  console.log(
    "OpenAPI approval has p_payload:",
    approvalWindow.includes("p_payload"),
  );
  console.log("OpenAPI approval params snippet:", clip(approvalWindow, 360));

  const { error: t179Err } = await svc.rpc("estimates_protect_portal_columns");
  const t179 = {
    code: t179Err?.code ?? null,
    message: t179Err?.message ?? null,
    missing:
      !!t179Err &&
      (t179Err.code === "PGRST202" ||
        /does not exist|could not find the function/i.test(
          t179Err.message ?? "",
        )),
  };
  console.log("svc.rpc estimates_protect_portal_columns:", t179);

  const { error: t179Anon } = await anon.rpc("estimates_protect_portal_columns");
  console.log("anon.rpc estimates_protect_portal_columns:", {
    code: t179Anon?.code ?? null,
    message: clip(t179Anon?.message),
  });

  const { data: portalDeny, error: portalErr } = await svc.rpc(
    "record_estimate_approval_safe",
    {
      p_estimate_id: "00000000-0000-0000-0000-000000000001",
      p_accepted_option_id: null,
      p_approval_source: "portal",
      p_approved_by_customer_id: "00000000-0000-0000-0000-000000000002",
    },
  );
  console.log("svc portal approval probe:", portalDeny ?? portalErr?.message);

  const { data: staffNoActor } = await svc.rpc("record_estimate_approval_safe", {
    p_estimate_id: "00000000-0000-0000-0000-000000000001",
    p_accepted_option_id: null,
    p_approval_source: "staff",
    p_approved_by_user_id: null,
  });
  console.log("svc staff no-actor probe:", staffNoActor);

  const { error: anonApproval } = await anon.rpc(
    "record_estimate_approval_safe",
    {
      p_estimate_id: "00000000-0000-0000-0000-000000000099",
      p_approval_source: "staff",
    },
  );
  console.log("anon record_estimate_approval_safe:", {
    code: anonApproval?.code ?? null,
    message: clip(anonApproval?.message),
  });

  const { data: crewIds, error: crewErr } = await svc.rpc(
    "installer_linked_crew_ids",
  );
  const crewMissing =
    !!crewErr &&
    (crewErr.code === "PGRST202" ||
      /does not exist|could not find the function/i.test(crewErr.message ?? ""));
  console.log("0180 installer_linked_crew_ids:", {
    missing: crewMissing,
    error: clip(crewErr?.message),
    rows: Array.isArray(crewIds) ? crewIds.length : crewIds,
  });

  const { data: settings, error: sErr } = await svc
    .from("accounting_settings")
    .select(
      "posting_enabled,inventory_posting_enabled,ap_posting_enabled,installer_posting_enabled,books_of_record,opening_balances_entered,accountant_validated,cutover_date,backup_pitr_confirmed_at",
    )
    .eq("id", 1)
    .maybeSingle();
  if (sErr) console.log("settings error:", sErr.message);
  else console.log("accounting_settings:", JSON.stringify(settings));

  const sql = await trySql(`
select jsonb_build_object(
  'protect_fn', (
    select jsonb_build_object(
      'exists', true,
      'prosecdef', p.prosecdef,
      'proconfig', p.proconfig,
      'anon_exec', has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated_exec', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'public_exec', has_function_privilege('public', p.oid, 'EXECUTE'),
      'service_role_exec', has_function_privilege('service_role', p.oid, 'EXECUTE'),
      'def_has_forbidden', pg_get_functiondef(p.oid) like '%PORTAL_ESTIMATE_FORBIDDEN%',
      'def_has_jsonb_strip', pg_get_functiondef(p.oid) like '%to_jsonb(new)%' and pg_get_functiondef(p.oid) like '%customer_response_note%',
      'def_has_guc_skip', pg_get_functiondef(p.oid) like '%app.allow_portal_approval_mutation%',
      'def_has_customer_id_block', pg_get_functiondef(p.oid) like '%cannot reassign this estimate%',
      'def_has_status_allowlist', pg_get_functiondef(p.oid) like '%changes_requested%' and pg_get_functiondef(p.oid) like '%declined%',
      'def_skips_non_customer', pg_get_functiondef(p.oid) like '%is distinct from ''customer''%',
      'search_path_public', coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=public%'
    )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'estimates_protect_portal_columns'
    limit 1
  ),
  'approval_fn', (
    select jsonb_build_object(
      'exists', true,
      'prosecdef', p.prosecdef,
      'proconfig', p.proconfig,
      'anon_exec', has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated_exec', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'public_exec', has_function_privilege('public', p.oid, 'EXECUTE'),
      'service_role_exec', has_function_privilege('service_role', p.oid, 'EXECUTE'),
      'has_guc', pg_get_functiondef(p.oid) like '%app.allow_portal_approval_mutation%',
      'has_ownership', pg_get_functiondef(p.oid) like '%APPROVAL_OWNERSHIP%' and pg_get_functiondef(p.oid) like '%my_customer_id%',
      'has_portal_svc_deny', pg_get_functiondef(p.oid) like '%APPROVAL_PORTAL_SERVICE_ROLE%',
      'has_option_check', pg_get_functiondef(p.oid) like '%APPROVAL_BAD_OPTION%',
      'no_p_payload', pg_get_functiondef(p.oid) not like '%p_payload%',
      'search_path_public', coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=public%'
    )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_estimate_approval_safe'
    limit 1
  ),
  'crew_helper', (
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'installer_linked_crew_ids'
  ),
  'protect_trigger', (
    select jsonb_build_object(
      'exists', true,
      'tgname', t.tgname,
      'enabled', t.tgenabled,
      'timing', case when (t.tgtype & 2) = 2 then 'BEFORE' else 'OTHER' end,
      'events', case when (t.tgtype & 16) = 16 then 'UPDATE' else 'OTHER' end,
      'def', pg_get_triggerdef(t.oid)
    )
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'estimates'
      and not t.tgisinternal
      and t.tgname = 'estimates_protect_portal_columns'
    limit 1
  ),
  'js_read', (
    select jsonb_build_object(
      'policyname', pol.policyname,
      'cmd', pol.cmd,
      'qual', pol.qual,
      'uses_true', pol.qual = 'true' or pol.qual = '(true)',
      'has_staff', pol.qual like '%sales_manager%' and pol.qual like '%scheduler%',
      'has_salesman', pol.qual like '%salesman%',
      'has_assigned', pol.qual like '%assigned_to%',
      'has_customer', pol.qual like '%my_customer_id%'
    )
    from pg_policies pol
    where pol.schemaname = 'public'
      and pol.tablename = 'job_satisfaction'
      and pol.policyname = 'js_read'
    limit 1
  ),
  'documents_storage_rw', (
    select jsonb_build_object(
      'policyname', pol.policyname,
      'schemaname', pol.schemaname,
      'tablename', pol.tablename,
      'cmd', pol.cmd,
      'qual', pol.qual,
      'with_check', pol.with_check,
      'old_non_customer', coalesce(pol.qual, '') like '%<> ''customer''%',
      'role_allowlist', coalesce(pol.qual, '') like '%sales_manager%' and coalesce(pol.qual, '') like '%salesman%' and coalesce(pol.qual, '') like '%scheduler%'
    )
    from pg_policies pol
    where pol.policyname = 'documents_storage_rw'
    limit 1
  ),
  'estimate_policies', (
    select coalesce(jsonb_agg(pol.policyname order by pol.policyname), '[]'::jsonb)
    from pg_policies pol
    where pol.schemaname = 'public' and pol.tablename = 'estimates'
  )
) as v
`);

  if (sql.ok) {
    const row = rowOf(sql);
    const v = row?.v ?? row;
    console.log("\n--- SQL catalog ---");
    console.log("endpoint:", sql.endpoint);
    console.log(JSON.stringify(v, null, 2));
  } else {
    console.log(
      "\nSQL catalog UNAVAILABLE — grant/trigger/policy details INFERRED where needed.",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
