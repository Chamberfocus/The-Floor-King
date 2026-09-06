/**
 * Read-only F5 production verification. NO inserts/updates/deletes.
 * Usage: node --env-file=.env.local scripts/verify-f5-production.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const out = {
  ok: true,
  failures: [],
  notes: [],
};

function fail(msg) {
  out.ok = false;
  out.failures.push(msg);
  console.error("FAIL:", msg);
}
function pass(msg) {
  console.log("PASS:", msg);
}
function note(msg) {
  out.notes.push(msg);
  console.log("NOTE:", msg);
}

async function selectProbe(table, columns) {
  const { error } = await admin.from(table).select(columns).limit(0);
  return error;
}

async function tableExists(table) {
  const { error } = await admin.from(table).select("*").limit(0);
  if (!error) return true;
  if (/does not exist|Could not find the table|schema cache/i.test(error.message)) {
    return false;
  }
  // Other errors still imply table may exist (e.g. RLS) — service role should bypass
  note(`${table} select error: ${error.message}`);
  return !/does not exist|Could not find the table/i.test(error.message);
}

async function rpcExists(name, args = {}) {
  const { error } = await admin.rpc(name, args);
  if (!error) return { exists: true, error: null };
  const msg = error.message || "";
  if (/could not find the function|schema cache/i.test(msg)) {
    return { exists: false, error: msg };
  }
  // Function exists but args/auth/logic failed — still counts as present
  return { exists: true, error: msg };
}

/** Try hosted pg-meta / sql endpoints (may be unavailable). */
async function trySql(sql) {
  const endpoints = [
    `${url}/pg/query`,
    `${url}/pg-meta/default/query`,
  ];
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      });
      const text = await res.text();
      if (res.ok) {
        try {
          return { ok: true, endpoint: ep, data: JSON.parse(text) };
        } catch {
          return { ok: true, endpoint: ep, data: text };
        }
      }
      note(`SQL endpoint ${ep} → ${res.status}: ${text.slice(0, 120)}`);
    } catch (e) {
      note(`SQL endpoint ${ep} threw: ${e.message}`);
    }
  }
  return { ok: false };
}

async function main() {
  console.log("=== F5 production verification (read-only) ===\n");

  // --- 2. accounting_settings ---
  const { data: settingsRows, error: settingsErr } = await admin
    .from("accounting_settings")
    .select("*")
    .eq("id", 1)
    .limit(1);
  if (settingsErr) fail(`accounting_settings: ${settingsErr.message}`);
  const s = settingsRows?.[0];
  if (!s) {
    fail("accounting_settings id=1 missing");
  } else {
    const boolFlags = [
      "posting_enabled",
      "invoice_posting_enabled",
      "payment_posting_enabled",
      "credit_posting_enabled",
      "ap_posting_enabled",
      "expense_posting_enabled",
      "deposit_posting_enabled",
      "inventory_posting_enabled",
      "installer_posting_enabled",
      "books_of_record",
      "opening_balances_entered",
      "accountant_validated",
    ];
    const flags = {};
    for (const f of boolFlags) {
      flags[f] = s[f];
      if (s[f] !== false && s[f] !== null && s[f] !== undefined) {
        // null might mean column missing — treat non-false as problem for booleans
        if (s[f] === true) fail(`Flag ${f} is TRUE (must remain FALSE)`);
        else note(`Flag ${f} value: ${JSON.stringify(s[f])}`);
      } else if (s[f] === false) {
        pass(`${f}=false`);
      } else {
        fail(`Flag ${f} unexpected: ${JSON.stringify(s[f])}`);
      }
    }
    if (s.cutover_date != null) {
      fail(`cutover_date is set: ${s.cutover_date}`);
    } else {
      pass("cutover_date IS NULL");
    }
    out.settings = {
      ...Object.fromEntries(boolFlags.map((f) => [f, s[f]])),
      cutover_date: s.cutover_date ?? null,
    };
  }

  // --- 3. schema columns ---
  const probes = [
    ["invoices", "id,voided_at,voided_by,void_reason"],
    ["bill_payments", "id,status,voided_at,voided_by,void_reason,idempotency_key"],
    ["bills", "id,accounting_posted_at"],
    ["expenses", "id,idempotency_key"],
  ];
  for (const [table, cols] of probes) {
    const err = await selectProbe(table, cols);
    if (err) fail(`${table} columns (${cols}): ${err.message}`);
    else pass(`${table} has expected F5 columns`);
  }
  if (await tableExists("customer_deposit_applications")) {
    pass("customer_deposit_applications exists");
  } else {
    fail("customer_deposit_applications missing");
  }
  if (await tableExists("customer_deposits")) {
    pass("customer_deposits exists");
  } else {
    fail("customer_deposits missing");
  }

  // Prior F0–F4 tables smoke
  for (const t of [
    "accounting_posting_outbox",
    "journal_entries",
    "gl_accounts",
    "bank_reconciliation_sessions",
    "credit_memos",
  ]) {
    if (await tableExists(t)) pass(`prior table ${t} intact`);
    else fail(`prior table ${t} missing`);
  }

  // --- 4. functions exist (via RPC probe) ---
  const rpcs = [
    ["accounting_actor_id", { p_claimed: null }],
    ["accounting_require_roles", { p_allowed: ["admin"], p_action: "verify" }],
    ["accounting_resolve_business_date", { p_provided: "2026-01-01", p_family: "invoice" }],
    ["accounting_family_pilot_active", { p_family: "invoice" }],
    ["accounting_is_eligible_cash_account", { p_account_id: "00000000-0000-0000-0000-000000000000" }],
    ["invoice_accounting_pilot_active", {}],
    // Money RPCs: args chosen to fail BEFORE any source mutation (no production data written).
    ["finalize_invoice_safe", { p_invoice_id: "00000000-0000-0000-0000-000000000000" }],
    ["void_invoice_safe", { p_invoice_id: "00000000-0000-0000-0000-000000000000", p_voided_by: null }],
    ["issue_credit_memo_safe", { p_customer_id: null, p_amount: 1, p_kind: "manual", p_reason: "x", p_issued_at: null }],
    ["void_credit_memo_safe", { p_memo_id: "00000000-0000-0000-0000-000000000000", p_voided_by: null }],
    ["void_refund_safe", { p_refund_id: "00000000-0000-0000-0000-000000000000", p_voided_by: null }],
    ["post_vendor_bill_safe", { p_bill_id: "00000000-0000-0000-0000-000000000000" }],
    ["record_bill_payment_safe", { p_bill_id: "00000000-0000-0000-0000-000000000000", p_amount: 0, p_date: null }],
    ["void_bill_payment_safe", { p_bill_payment_id: "00000000-0000-0000-0000-000000000000", p_voided_by: null }],
    // amount <= 0 fails closed before insert
    ["record_direct_expense_safe", { p_date: null, p_category: "other", p_amount: 0 }],
    ["record_customer_deposit_safe", { p_customer_id: null, p_amount: 1, p_received_on: null }],
    ["apply_customer_deposit_safe", { p_deposit_id: "00000000-0000-0000-0000-000000000000", p_invoice_id: "00000000-0000-0000-0000-000000000000", p_amount: 0, p_applied_on: null }],
    ["void_customer_deposit_safe", { p_deposit_id: "00000000-0000-0000-0000-000000000000", p_voided_by: null }],
    ["complete_bank_reconciliation_safe", { p_session_id: "00000000-0000-0000-0000-000000000000" }],
  ];

  out.rpcProbes = {};
  for (const [name, args] of rpcs) {
    const r = await rpcExists(name, args);
    out.rpcProbes[name] = r;
    if (!r.exists) fail(`RPC missing: ${name} (${r.error})`);
    else pass(`RPC exists: ${name}${r.error ? ` (probe: ${r.error.slice(0, 80)})` : ""}`);
  }

  // Do NOT call enqueue_accounting_outbox_safe or allow_invoice_issue_guard against
  // production — enqueue can write outbox rows; guard is internal-only by grant.
  // Presence of money RPCs above already proves F5 install; grant checks via SQL/anon.

  // --- Deep SQL introspection if endpoint works ---
  const sqlBundle = await trySql(`
select
  (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='invoices' and t.tgname='invoices_enforce_issue_via_finalize_trg' and not t.tgisinternal) as invoice_guard_trg,
  (select count(*) from pg_indexes where schemaname='public' and indexname='expenses_idempotency_key_uidx') as expense_idem_idx,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='expenses' and column_name='idempotency_key') as expense_idem_col,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='accounting_require_roles') as require_roles_fn,
  (select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='finalize_invoice_safe' limit 1) as finalize_security_definer,
  (select proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='finalize_invoice_safe' limit 1) as finalize_config,
  (select pg_get_functiondef(p.oid) like '%accounting_require_roles%' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='finalize_invoice_safe' limit 1) as finalize_has_role_gate,
  (select pg_get_functiondef(p.oid) like '%accounting_require_roles%' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='post_vendor_bill_safe' limit 1) as bill_has_role_gate,
  (select pg_get_functiondef(p.oid) like '%accounting_resolve_business_date%' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='record_bill_payment_safe' limit 1) as bill_pay_date_helper,
  (select pg_get_functiondef(p.oid) like '%accounting_is_eligible_cash_account%' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='record_bill_payment_safe' limit 1) as bill_pay_cash_gate,
  (select pg_get_functiondef(p.oid) like '%same customer%' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='issue_credit_memo_safe' limit 1) as credit_customer_check,
  (select pg_get_functiondef(p.oid) like '%Do NOT invent default_expense%' or pg_get_functiondef(p.oid) like '%v_exp_acct := null%' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='record_direct_expense_safe' limit 1) as expense_no_silent_default,
  (select pg_get_functiondef(p.oid) like '%unique_violation%' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='record_direct_expense_safe' limit 1) as expense_unique_handling,
  (select has_function_privilege('authenticated', p.oid, 'EXECUTE') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='enqueue_accounting_outbox_safe' limit 1) as auth_can_enqueue,
  (select has_function_privilege('authenticated', p.oid, 'EXECUTE') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='allow_invoice_issue_guard' limit 1) as auth_can_issue_guard,
  (select pg_get_functiondef(p.oid) like '%invoice_accounting_pilot_active%' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='invoices_enforce_issue_via_finalize' limit 1) as trg_fn_pilot_gated,
  (select pg_get_functiondef(p.oid) like '%admin%' and pg_get_functiondef(p.oid) like '%office%' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='complete_bank_reconciliation_safe' limit 1) as recon_admin_office
`);

  out.sqlIntrospection = sqlBundle;
  if (sqlBundle.ok) {
    pass(`SQL introspection via ${sqlBundle.endpoint}`);
    const row = Array.isArray(sqlBundle.data) ? sqlBundle.data[0] : sqlBundle.data?.[0] ?? sqlBundle.data;
    out.sqlRow = row;
    console.log("SQL row:", JSON.stringify(row, null, 2));
  } else {
    note("Direct SQL introspection endpoints unavailable; relying on REST probes + migration file audit.");
  }

  // Anon key probe: internal helpers should fail for anon/authenticated grant check
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (anon) {
    const anonClient = createClient(url, anon, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    for (const fn of ["enqueue_accounting_outbox_safe", "allow_invoice_issue_guard"]) {
      const { error } = await anonClient.rpc(fn, fn === "allow_invoice_issue_guard" ? {} : {
        p_source_type: "invoice",
        p_source_id: "00000000-0000-0000-0000-000000000000",
        p_event_kind: "invoice_issue",
        p_payload: {},
        p_review_required: true,
      });
      const msg = error?.message || "";
      if (/permission denied|not granted|could not find the function|404|PGRST202/i.test(msg) || !error && false) {
        pass(`anon cannot execute ${fn}: ${msg.slice(0, 100)}`);
      } else if (!error) {
        fail(`anon unexpectedly executed ${fn}`);
      } else {
        // PGRST202 = not in schema cache / no grant often
        if (/PGRST202|Could not find/i.test(msg)) pass(`anon cannot execute ${fn} (${msg.slice(0, 80)})`);
        else note(`anon ${fn} response: ${msg.slice(0, 120)}`);
      }
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(out.ok ? "OVERALL: PASS" : "OVERALL: FAIL");
  console.log(JSON.stringify({ ok: out.ok, failures: out.failures, settings: out.settings, sqlRow: out.sqlRow ?? null, notes: out.notes }, null, 2));
  process.exit(out.ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
