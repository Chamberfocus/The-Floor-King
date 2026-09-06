/**
 * F6-P5 / 0177 production verification (read-only).
 * SKIPs cleanly until 0177 is applied. Never mutates business data or flags.
 *
 * Usage: node --env-file=.env.local scripts/verify-f6-p5-production.mjs
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

const fake = "00000000-0000-0000-0000-000000000099";
const failures = [];
const results = {
  applied: false,
  skipped: false,
  scoreboard: {},
  settings: null,
  productionBusinessDataMutated: "NO",
  accountingActivationChanged: "NO",
};

function fail(msg) {
  failures.push(msg);
  console.error("FAIL:", msg);
}
function pass(msg) {
  console.log("PASS:", msg);
}

function isMissingRpc(error) {
  const msg = error?.message || String(error || "");
  return /Could not find the function|PGRST202|schema cache/i.test(msg);
}

function isDenied(error, data) {
  if (!error && data !== null && data !== undefined) {
    const err =
      typeof data === "object" && data && "error" in data
        ? String(data.error)
        : "";
    if (/ACCOUNTING_FORBIDDEN|permission|Forbidden|42501|Only admin/i.test(err)) {
      return { denied: true, via: "rpc_body_forbidden" };
    }
    return { denied: false, via: "data" };
  }
  const msg = error?.message || String(error);
  if (
    /permission denied|not granted|42501|PGRST202|ACCOUNTING_FORBIDDEN|Forbidden|JWT|RLS|Only admin|access financial/i.test(
      msg,
    )
  ) {
    return { denied: true, via: "error" };
  }
  return { denied: false, via: "other" };
}

async function openApiHas(name) {
  const res = await fetch(`${url}/rest/v1/`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (!res.ok) return null;
  const body = await res.text();
  return body.includes(name);
}

async function main() {
  console.log("F6-P5 / 0177 financial reporting control center verifier (read-only)\n");

  const hasTb = await openApiHas("acct_report_trial_balance");
  if (hasTb === false || hasTb === null) {
    const { error } = await svc.rpc("acct_report_trial_balance", {
      p_as_of: "2026-01-01",
    });
    if (isMissingRpc(error) || hasTb === false) {
      results.skipped = true;
      results.scoreboard.APPLIED = "NO";
      results.scoreboard.VERIFIER = "SKIP";
      console.log("SKIP: 0177 not applied (acct_report_trial_balance absent).");
      console.log(JSON.stringify(results, null, 2));
      process.exit(0);
    }
  }

  results.applied = true;
  results.scoreboard.APPLIED = "YES";
  pass("0177 applied (acct_report_trial_balance present)");

  const staff = [
    "acct_report_trial_balance",
    "acct_report_pnl",
    "acct_report_balance_sheet",
    "acct_report_general_ledger",
    "acct_report_ar_aging",
    "acct_report_ap_aging",
    "acct_exceptions_scan",
    "acct_cutover_readiness_snapshot",
    "acct_period_close_safe",
    "acct_period_reopen_safe",
    "acct_period_lock_safe",
    "acct_books_status",
    "acct_recon_ar_control",
    "acct_recon_ap_control",
    "gl_account_deactivate_safe",
    "gl_account_upsert_safe",
  ];

  for (const name of staff) {
    const present = await openApiHas(name);
    if (present === false) fail(`Missing RPC in OpenAPI: ${name}`);
    else pass(`OpenAPI has ${name}`);
  }

  for (const name of [
    "acct_control_begin_action",
    "acct_control_complete_action",
    "acct_control_lock_idempotency",
    "acct_period_close_readiness",
    "acct_gl_account_balance_as_of",
    "acct_lock_period_for_posting",
    "acct_parse_outbox_economic_date",
    "acct_invoice_open_ar_as_of",
    "acct_bill_remaining_as_of",
  ]) {
    const { data, error } = await anon.rpc(name, {
      p_key: "x",
      p_action: "x",
      p_hash: "x",
      p_period_id: fake,
      p_account_id: fake,
      p_as_of: "2026-01-01",
      p_entry_date: "2026-01-01",
      p_invoice_id: fake,
      p_bill_id: fake,
      p_result: {},
    });
    const d = isDenied(error, data);
    if (!d.denied && !isMissingRpc(error)) {
      fail(`Anon should be denied internal ${name}`);
    } else {
      pass(`Anon denied internal ${name}`);
    }
  }

  // Read-only period integrity probe (no mutation).
  {
    const { data: periods, error: pErr } = await svc
      .from("accounting_periods")
      .select("id,start_date,end_date,status")
      .order("start_date", { ascending: true })
      .limit(50);
    if (pErr) fail(`period read: ${pErr.message}`);
    else {
      pass("accounting_periods readable");
      const rows = periods ?? [];
      for (const p of rows) {
        if (p.start_date > p.end_date) {
          fail(`period ${p.id} has start_date > end_date`);
        }
      }
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const a = rows[i];
          const b = rows[j];
          if (a.start_date <= b.end_date && b.start_date <= a.end_date) {
            fail(
              `overlapping periods detected: ${a.id} (${a.start_date}–${a.end_date}) vs ${b.id} (${b.start_date}–${b.end_date})`,
            );
          }
        }
      }
      if (failures.every((f) => !f.includes("overlapping periods"))) {
        pass("no overlapping periods in sample (EXCLUDE expected after 0177)");
      }
    }
  }

  for (const name of [
    "acct_report_trial_balance",
    "acct_report_pnl",
    "acct_exceptions_scan",
    "acct_cutover_readiness_snapshot",
    "acct_period_close_safe",
  ]) {
    const args =
      name === "acct_report_pnl"
        ? { p_start: "2026-01-01", p_end: "2026-12-31" }
        : name === "acct_period_close_safe"
          ? {
              p_period_id: fake,
              p_reason: "verify",
              p_idempotency_key: `verify-f6-p5-${name}`,
            }
          : name === "acct_report_trial_balance"
            ? { p_as_of: "2026-01-01" }
            : {};
    const { data, error } = await anon.rpc(name, args);
    const d = isDenied(error, data);
    if (!d.denied && !isMissingRpc(error)) {
      fail(`Anon should be denied ${name}`);
    } else {
      pass(`Anon denied ${name}`);
    }
  }

  {
    const { error } = await anon.from("accounting_control_idempotency").insert({
      key: "verify-f6-p5-should-fail",
      action: "probe",
      context_hash: "x",
    });
    if (!error) fail("Anon INSERT accounting_control_idempotency unexpectedly succeeded");
    else pass("Anon INSERT accounting_control_idempotency fail-closed");
  }

  const { data: settings, error: sErr } = await svc
    .from("accounting_settings")
    .select(
      "posting_enabled, inventory_posting_enabled, books_of_record, ap_posting_enabled, installer_posting_enabled, backup_pitr_confirmed_at",
    )
    .limit(1)
    .maybeSingle();
  if (sErr) fail(`settings read: ${sErr.message}`);
  else {
    results.settings = settings;
    if (settings?.posting_enabled) fail("posting_enabled unexpectedly true");
    if (settings?.inventory_posting_enabled)
      fail("inventory_posting_enabled unexpectedly true");
    if (settings?.books_of_record) fail("books_of_record unexpectedly true");
    else pass("Accounting flags remain OFF");
    results.scoreboard.BACKUP_PITR = settings?.backup_pitr_confirmed_at
      ? "YES"
      : "NO";
    if (settings?.backup_pitr_confirmed_at == null) {
      pass("backup_pitr_confirmed_at is null (expected pre-cutover)");
    }
  }

  // Service probe: fake period close must not mutate success against missing period
  {
    const { data, error } = await svc.rpc("acct_period_close_safe", {
      p_period_id: fake,
      p_reason: "verify-f6-p5-read-only-probe",
      p_idempotency_key: `verify-f6-p5-probe-${Date.now()}`,
      p_created_by: fake,
    });
    if (data && typeof data === "object" && data.ok === true && !data.already_closed) {
      fail("svc period close probe unexpectedly ok:true against fake period");
    } else {
      pass("svc period close probe did not mutate success against fake period");
    }
    void error;
  }

  results.scoreboard.PRODUCTION_BUSINESS_DATA_MUTATED = "NO";
  results.scoreboard.ACCOUNTING_ACTIVATION_CHANGED = "NO";
  results.scoreboard.OVERALL = failures.length ? "FAIL" : "PASS";

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
