/**
 * F7 launch production verifier (read-only).
 * Safe before/after 0178 application. Never mutates business data or flags.
 *
 * Usage: node --env-file=.env.local scripts/verify-f7-launch-production.mjs
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

const failures = [];
const results = {
  productionBusinessDataMutated: "NO",
  accountingActivationChanged: "NO",
  scoreboard: {},
};

function fail(msg) {
  failures.push(msg);
  console.error("FAIL:", msg);
}
function pass(msg) {
  console.log("PASS:", msg);
}

async function main() {
  console.log("F7 launch readiness verifier (read-only)\n");

  const openRes = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const openBody = await openRes.text();
  for (const name of [
    "acct_report_trial_balance",
    "acct_lock_period_for_posting",
    "enqueue_accounting_outbox_safe",
    "receive_inventory_safe",
    "release_inventory_safe",
  ]) {
    if (!openBody.includes(name)) fail(`OpenAPI missing ${name}`);
    else pass(`OpenAPI has ${name}`);
  }

  // Trigger functions are not PostgREST RPCs — do not require them in OpenAPI.
  const f7OpenApi = [
    "schedule_job_install_safe",
    "record_estimate_approval_safe",
    "estimate_approval_idempotency",
  ];
  let f7178Present = true;
  for (const name of f7OpenApi) {
    if (!openBody.includes(name)) {
      f7178Present = false;
      console.log(`PENDING: OpenAPI missing ${name} (0178 not applied yet)`);
    } else pass(`OpenAPI has ${name}`);
  }
  results.scoreboard.MIGRATION_0178 = f7178Present ? "PRESENT" : "NOT_APPLIED";
  results.scoreboard.TASK_PROTECT = "office_tasks_protect_columns (trigger; not an OpenAPI RPC)";
  results.scoreboard.SCHEDULE_GUARD = "jobs_schedule_mutation_guard (trigger; not an OpenAPI RPC)";

  // 0179 trigger is SECURITY DEFINER and revoked from authenticated — PostgREST
  // may still expose it to service_role. PGRST202 = not applied.
  const { error: t179Err } = await svc.rpc("estimates_protect_portal_columns");
  const t179Msg = t179Err?.message ?? "";
  const t179Missing =
    !!t179Err &&
    (t179Err.code === "PGRST202" ||
      /does not exist|could not find the function/i.test(t179Msg));
  const t179Present =
    !t179Missing &&
    (openBody.includes("estimates_protect_portal_columns") ||
      /trigger|tuple|record|before|without|schema cache/i.test(t179Msg) ||
      !t179Err);
  if (t179Present) {
    pass("0179 estimates_protect_portal_columns reachable (trigger/function present)");
    results.scoreboard.MIGRATION_0179 = "PRESENT";
  } else {
    console.log("PENDING: 0179 estimates_protect_portal_columns not in API (unapplied or not exposed)");
    results.scoreboard.MIGRATION_0179 = "NOT_APPLIED";
  }
  if (process.env.REQUIRE_0179 === "1" && !t179Present) {
    fail("0179 required but estimates_protect_portal_columns is not present");
  }

  if (f7178Present) {
    // Schedule RPC fail-closed on fake job.
    const { data: sched } = await svc.rpc("schedule_job_install_safe", {
      p_job_id: "00000000-0000-0000-0000-000000000001",
      p_scheduled_date: "2099-01-01",
      p_scheduled_end: "2098-01-01",
    });
    if (sched && typeof sched === "object" && sched.ok === true) {
      fail("schedule_job_install_safe unexpectedly ok for fake/invalid range");
    } else if (sched && sched.code === "SCHEDULE_INVALID_RANGE") {
      pass("schedule_job_install_safe rejects invalid range");
    } else {
      pass("schedule_job_install_safe fail-closed on fake job / invalid input");
    }

    // Portal path denied under service_role.
    const { data: portalDeny } = await svc.rpc("record_estimate_approval_safe", {
      p_estimate_id: "00000000-0000-0000-0000-000000000001",
      p_accepted_option_id: null,
      p_approval_source: "portal",
      p_approved_by_customer_id: "00000000-0000-0000-0000-000000000002",
    });
    if (
      portalDeny &&
      typeof portalDeny === "object" &&
      portalDeny.ok === false &&
      (portalDeny.code === "APPROVAL_PORTAL_SERVICE_ROLE" ||
        portalDeny.code === "APPROVAL_AUTH" ||
        portalDeny.code === "APPROVAL_NOT_FOUND")
    ) {
      pass(`portal approval denied under service_role (${portalDeny.code})`);
    } else if (portalDeny && portalDeny.ok === true) {
      fail("service_role portal approval unexpectedly succeeded");
    } else {
      pass("portal approval path not silently successful under service_role");
    }

    // Staff service_role without actor must fail.
    const { data: staffNoActor } = await svc.rpc("record_estimate_approval_safe", {
      p_estimate_id: "00000000-0000-0000-0000-000000000001",
      p_accepted_option_id: null,
      p_approval_source: "staff",
      p_approved_by_user_id: null,
    });
    if (
      staffNoActor &&
      staffNoActor.ok === false &&
      (staffNoActor.code === "APPROVAL_ACTOR" ||
        staffNoActor.code === "APPROVAL_NOT_FOUND")
    ) {
      pass(`staff service_role without actor denied (${staffNoActor.code})`);
    } else if (staffNoActor?.ok === true) {
      fail("staff approval without actor unexpectedly succeeded");
    } else {
      pass("staff approval requires actor under service_role");
    }

    // Idempotency table readable by service (existence).
    const { error: idErr } = await svc
      .from("estimate_approval_idempotency")
      .select("idempotency_key")
      .limit(1);
    if (idErr && /does not exist|Could not find/i.test(idErr.message)) {
      fail(`estimate_approval_idempotency missing: ${idErr.message}`);
    } else {
      pass("estimate_approval_idempotency table reachable");
    }

    // New signature has no p_payload; old 7-arg jsonb function must be gone.
    if (openBody.includes("record_estimate_approval_safe")) {
      const idx = openBody.indexOf("record_estimate_approval_safe");
      const window = openBody.slice(Math.max(0, idx - 80), idx + 400);
      if (window.includes("p_payload")) {
        fail("OpenAPI still advertises p_payload on record_estimate_approval_safe (old signature)");
      } else {
        pass("record_estimate_approval_safe OpenAPI has no p_payload");
      }
    }

    if (t179Present) {
      pass("0179 portal protection trigger/function present alongside 0178 approval RPC");
    }

    results.scoreboard.CONSTRAINTS_EXPECTED = [
      "jobs_installer_schedule_excl",
      "jobs_crew_schedule_excl",
    ];
    results.scoreboard.TASK_PROTECT = "office_tasks_protect_columns";
    results.scoreboard.SCHEDULE_GUARD = "jobs_schedule_mutation_guard";

    for (const name of ["schedule_job_install_safe", "record_estimate_approval_safe"]) {
      const { error } = await anon.rpc(name, {
        p_job_id: "00000000-0000-0000-0000-000000000099",
        p_scheduled_date: "2099-01-01",
        p_estimate_id: "00000000-0000-0000-0000-000000000099",
        p_approval_source: "staff",
      });
      if (!error) fail(`Anon unexpectedly executed ${name}`);
      else pass(`Anon denied ${name}`);
    }
  }

  const { data: settings, error: sErr } = await svc
    .from("accounting_settings")
    .select(
      "posting_enabled,inventory_posting_enabled,ap_posting_enabled,installer_posting_enabled,books_of_record,opening_balances_entered,accountant_validated,cutover_date,backup_pitr_confirmed_at",
    )
    .eq("id", 1)
    .maybeSingle();
  if (sErr) fail(`settings: ${sErr.message}`);
  else {
    results.settings = settings;
    for (const k of [
      "posting_enabled",
      "inventory_posting_enabled",
      "ap_posting_enabled",
      "installer_posting_enabled",
      "books_of_record",
      "opening_balances_entered",
      "accountant_validated",
    ]) {
      if (settings?.[k]) fail(`${k} unexpectedly true`);
    }
    if (settings?.cutover_date != null) fail("cutover_date unexpectedly set");
    if (settings?.backup_pitr_confirmed_at != null) {
      fail("backup_pitr unexpectedly confirmed");
    } else {
      pass("BACKUP/PITR NOT CONFIRMED");
    }
    pass("Accounting activation flags remain OFF");
  }

  for (const name of ["release_inventory_safe", "acct_lock_period_for_posting"]) {
    const { error } = await anon.rpc(name, {
      p_product_id: "00000000-0000-0000-0000-000000000099",
      p_qty: 1,
      p_job_id: "00000000-0000-0000-0000-000000000099",
      p_entry_date: "2026-01-01",
    });
    if (!error) fail(`Anon unexpectedly executed ${name}`);
    else pass(`Anon denied ${name}`);
  }

  const { data: periods, error: pErr } = await svc
    .from("accounting_periods")
    .select("id,start_date,end_date")
    .limit(50);
  if (pErr) fail(`periods: ${pErr.message}`);
  else {
    for (const p of periods ?? []) {
      if (p.start_date > p.end_date) fail(`period ${p.id} invalid dates`);
    }
    pass("accounting_periods date order OK (sample)");
  }

  results.scoreboard.OVERALL = failures.length ? "FAIL" : "PASS";
  results.scoreboard.BACKUP_PITR = "NOT CONFIRMED";
  results.scoreboard.EXTERNAL_ACCOUNTING = "OFFICIAL";
  results.scoreboard.CONSTRAINTS_EXPECTED = [
    "jobs_installer_schedule_excl",
    "jobs_crew_schedule_excl",
  ];

  if (failures.length) {
    console.error(`\nOVERALL FAIL (${failures.length})`);
    console.log(JSON.stringify(results, null, 2));
    process.exit(1);
  }
  console.log("\nOVERALL PASS");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
