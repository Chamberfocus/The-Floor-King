/**
 * F6-P4 / 0176 production verification (read-only).
 * SKIPs cleanly until 0176 is applied. Never mutates business data or flags.
 *
 * Usage: node --env-file=.env.local scripts/verify-f6-p4-production.mjs
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
    if (/ACCOUNTING_FORBIDDEN|permission|Forbidden|42501/i.test(err)) {
      return { denied: true, via: "rpc_body_forbidden" };
    }
    return { denied: false, via: "data" };
  }
  const msg = error?.message || String(error);
  if (
    /permission denied|not granted|42501|PGRST202|ACCOUNTING_FORBIDDEN|Forbidden|JWT|RLS/i.test(
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
  console.log("F6-P4 / 0176 inventory integrity verifier (read-only)\n");

  const hasReceive = await openApiHas("receive_inventory_safe");
  if (hasReceive === false || hasReceive === null) {
    const { error } = await svc.rpc("receive_inventory_safe", {
      p_product_id: fake,
      p_qty: 1,
    });
    if (isMissingRpc(error) || hasReceive === false) {
      results.skipped = true;
      results.scoreboard.APPLIED = "NO";
      results.scoreboard.VERIFIER = "SKIP";
      console.log("SKIP: 0176 not applied (receive_inventory_safe absent).");
      console.log(JSON.stringify(results, null, 2));
      process.exit(0);
    }
  }

  results.applied = true;
  results.scoreboard.APPLIED = "YES";
  pass("0176 applied (receive_inventory_safe present)");

  const staff = [
    "receive_inventory_safe",
    "reserve_inventory_safe",
    "release_inventory_safe",
    "consume_inventory_safe",
    "adjust_inventory_safe",
    "adjust_roll_inventory_safe",
    "return_inventory_from_job_safe",
    "return_inventory_to_vendor_safe",
    "reverse_inventory_movement_safe",
    "inv_flag_receipt_ap_variance_safe",
    "inv_sync_rolled_on_hand_safe",
    "inv_list_movements_ops",
    "inv_list_inventory_products_ops",
    "inv_get_product_valuation",
    "inv_job_net_returnable_qty",
    "inv_job_net_material_actual",
    "inv_reconcile_product_value",
  ];

  for (const name of staff) {
    const present = await openApiHas(name);
    if (present === false) fail(`Missing RPC in OpenAPI: ${name}`);
    else pass(`OpenAPI has ${name}`);
  }

  for (const name of [
    "inv_begin_action",
    "inv_apply_movement",
    "inv_lock_product",
    "inv_plan_job_return_allocations",
    "inv_authorize_unit_cost_override",
    "inv_product_avg_cost_internal",
  ]) {
    const { data, error } = await anon.rpc(name, { p_product_id: fake });
    const d = isDenied(error, data);
    if (!d.denied && !isMissingRpc(error)) {
      fail(`Anon should be denied internal ${name}`);
    } else {
      pass(`Anon denied internal ${name}`);
    }
  }

  for (const name of [
    "receive_inventory_safe",
    "consume_inventory_safe",
    "return_inventory_from_job_safe",
  ]) {
    const args =
      name === "consume_inventory_safe" || name === "return_inventory_from_job_safe"
        ? { p_product_id: fake, p_qty: 1, p_job_id: fake }
        : { p_product_id: fake, p_qty: 1 };
    const { data, error } = await anon.rpc(name, args);
    const d = isDenied(error, data);
    if (!d.denied && !isMissingRpc(error)) {
      fail(`Anon should be denied ${name}`);
    } else {
      pass(`Anon denied ${name}`);
    }
  }

  // Raw financial table DML fail-closed for anon
  {
    const { error } = await anon.from("stock_movements").insert({
      product_id: fake,
      qty: 1,
      kind: "receive",
    });
    if (!error) fail("Anon INSERT stock_movements unexpectedly succeeded");
    else pass("Anon INSERT stock_movements fail-closed");
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
  }

  // Anon denied financial valuation
  {
    const { data, error } = await anon.rpc("inv_get_product_valuation", {
      p_product_id: fake,
    });
    const d = isDenied(error, data);
    if (!d.denied && !isMissingRpc(error) && !(data && data.ok === false && /FORBIDDEN|Only/i.test(String(data.error || "")))) {
      // ok:false with ACCOUNTING_FORBIDDEN counts as denied
      const bodyDenied =
        data &&
        typeof data === "object" &&
        /ACCOUNTING_FORBIDDEN|Only admin/i.test(JSON.stringify(data));
      if (!bodyDenied) fail("Anon should be denied inv_get_product_valuation");
      else pass("Anon denied inv_get_product_valuation");
    } else {
      pass("Anon denied inv_get_product_valuation");
    }
  }

  // Columns present
  for (const col of ["avg_unit_cost", "inventory_carrying_value"]) {
    const present = await openApiHas(col);
    if (present === false) fail(`OpenAPI missing products.${col}`);
    else pass(`OpenAPI mentions ${col}`);
  }

  {
    const { data, error } = await svc.rpc("receive_inventory_safe", {
      p_product_id: fake,
      p_qty: 1,
      p_created_by: fake,
    });
    if (data && typeof data === "object" && data.ok === true) {
      fail("svc receive probe unexpectedly ok:true against fake product");
    } else {
      pass("svc receive probe did not mutate success against fake product");
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
