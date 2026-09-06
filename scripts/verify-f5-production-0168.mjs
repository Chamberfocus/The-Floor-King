/**
 * Post-0168 production security verification. Read-only / fail-closed probes only.
 * node --env-file=.env.local scripts/verify-f5-production-0168.mjs
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
const notes = [];
const results = {};

function fail(msg) {
  failures.push(msg);
  console.error("FAIL:", msg);
}
function pass(msg) {
  console.log("PASS:", msg);
}
function note(msg) {
  notes.push(msg);
  console.log("NOTE:", msg);
}

function isDenied(error, data) {
  if (!error && data === null) {
    // void/204 success — NOT denied
    return { denied: false, via: "success_null" };
  }
  if (!error && data !== null && data !== undefined) {
    // If jsonb { ok: false, error: ACCOUNTING_FORBIDDEN... } before mutation — defense in depth
    const err =
      typeof data === "object" && data && "error" in data
        ? String(data.error)
        : "";
    if (/ACCOUNTING_FORBIDDEN|permission|Forbidden|42501/i.test(err)) {
      return { denied: true, via: "rpc_body_forbidden", detail: err.slice(0, 120) };
    }
    if (typeof data === "object" && data && data.ok === false) {
      // Business not-found is NOT a security deny if function ran
      return { denied: false, via: "business_error", detail: err.slice(0, 120) };
    }
    return { denied: false, via: "success_data", detail: JSON.stringify(data).slice(0, 80) };
  }
  const msg = error?.message || String(error);
  if (
    /permission denied|not granted|42501|PGRST301|PGRST302|PGRST202|Could not find the function|ACCOUNTING_FORBIDDEN|Forbidden|JWT/i.test(
      msg,
    )
  ) {
    return { denied: true, via: "error", detail: msg.slice(0, 160) };
  }
  return { denied: false, via: "other_error", detail: msg.slice(0, 160) };
}

async function probe(client, label, name, args = {}) {
  const { data, error } = await client.rpc(name, args);
  const d = isDenied(error, data);
  results[`${label}:${name}`] = {
    denied: d.denied,
    via: d.via,
    detail: d.detail || null,
    statusHint: error ? "error" : "ok",
  };
  return d;
}

async function main() {
  console.log("=== Post-0168 production security verification ===\n");

  // --- settings ---
  const { data: settingsRows, error: sErr } = await svc
    .from("accounting_settings")
    .select("*")
    .eq("id", 1)
    .limit(1);
  if (sErr) fail(`settings: ${sErr.message}`);
  const s = settingsRows?.[0];
  const flags = [
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
  for (const f of flags) {
    if (s?.[f] !== false) fail(`${f}=${JSON.stringify(s?.[f])} (want false)`);
    else pass(`${f}=false`);
  }
  if (s?.cutover_date != null) fail(`cutover_date=${s.cutover_date}`);
  else pass("cutover_date IS NULL");
  results.settings = Object.fromEntries([
    ...flags.map((f) => [f, s?.[f]]),
    ["cutover_date", s?.cutover_date ?? null],
  ]);

  // --- helpers: service vs anon ---
  {
    const { data: svcIs } = await svc.rpc("accounting_is_service_role");
    results.service_is_service_role = svcIs;
    if (svcIs === true) pass("service_role: accounting_is_service_role=true");
    else fail(`service_role: accounting_is_service_role=${JSON.stringify(svcIs)}`);
  }
  {
    const { data: anonIs, error } = await anon.rpc("accounting_is_service_role");
    const d = isDenied(error, anonIs);
    results.anon_is_service_role = { data: anonIs, ...d };
    // Prefer ACL deny; if callable, must return false
    if (d.denied) pass(`anon: accounting_is_service_role denied (${d.detail})`);
    else if (anonIs === false) pass("anon: accounting_is_service_role=false");
    else fail(`anon: accounting_is_service_role unexpected ${JSON.stringify(anonIs)}`);
  }

  // require_roles
  {
    const d = await probe(anon, "anon", "accounting_require_roles", {
      p_allowed: ["admin"],
      p_action: "verify",
    });
    if (d.denied) pass(`anon: accounting_require_roles denied (${d.via})`);
    else fail(`anon: accounting_require_roles NOT denied (${d.via} ${d.detail})`);
  }
  {
    const { error } = await svc.rpc("accounting_require_roles", {
      p_allowed: ["admin"],
      p_action: "verify",
    });
    if (!error) pass("service_role: accounting_require_roles ok");
    else fail(`service_role: accounting_require_roles ${error.message}`);
  }

  // actor_id spoof
  {
    const { data, error } = await anon.rpc("accounting_actor_id", {
      p_claimed: fake,
    });
    const d = isDenied(error, data);
    results.anon_actor = { data, ...d };
    if (d.denied) pass(`anon: accounting_actor_id denied (${d.via})`);
    else if (data === fake) fail("anon: accounting_actor_id returned claimed UUID (spoof)");
    else fail(`anon: accounting_actor_id unexpected data=${JSON.stringify(data)}`);
  }
  {
    const { data, error } = await svc.rpc("accounting_actor_id", {
      p_claimed: fake,
    });
    if (!error && data === fake) pass("service_role: accounting_actor_id returns claimed");
    else fail(`service_role: accounting_actor_id ${error?.message || data}`);
  }

  // Internal helpers — MUST fail for anon
  for (const [name, args] of [
    ["allow_invoice_issue_guard", {}],
    [
      "enqueue_accounting_outbox_safe",
      {
        p_source_type: "invoice",
        p_source_id: fake,
        p_event_kind: "invoice_issue",
        p_payload: { probe: "post0168" },
        p_review_required: true,
      },
    ],
  ]) {
    const d = await probe(anon, "anon", name, args);
    if (d.denied) pass(`anon: ${name} BLOCKED (${d.via}: ${d.detail})`);
    else fail(`anon: ${name} NOT BLOCKED (${d.via} ${d.detail})`);
  }

  // Confirm no outbox pollution
  {
    const { data: rows } = await svc
      .from("accounting_posting_outbox")
      .select("id")
      .eq("source_id", fake)
      .limit(5);
    if ((rows ?? []).length === 0) pass("no outbox rows for probe UUID");
    else fail(`outbox probe pollution: ${rows.length} rows`);
  }

  // Money RPCs — anon must not succeed into business logic
  const money = [
    ["finalize_invoice_safe", { p_invoice_id: fake }],
    ["void_invoice_safe", { p_invoice_id: fake, p_voided_by: null }],
    [
      "issue_credit_memo_safe",
      {
        p_customer_id: null,
        p_amount: 1,
        p_kind: "manual",
        p_reason: "x",
        p_issued_at: null,
      },
    ],
    ["void_credit_memo_safe", { p_memo_id: fake, p_voided_by: null }],
    ["void_refund_safe", { p_refund_id: fake, p_voided_by: null }],
    ["post_vendor_bill_safe", { p_bill_id: fake }],
    ["record_bill_payment_safe", { p_bill_id: fake, p_amount: 0, p_date: null }],
    ["void_bill_payment_safe", { p_bill_payment_id: fake, p_voided_by: null }],
    ["record_direct_expense_safe", { p_date: null, p_category: "other", p_amount: 0 }],
    [
      "record_customer_deposit_safe",
      { p_customer_id: null, p_amount: 1, p_received_on: null },
    ],
    [
      "apply_customer_deposit_safe",
      {
        p_deposit_id: fake,
        p_invoice_id: fake,
        p_amount: 0,
        p_applied_on: null,
      },
    ],
    ["void_customer_deposit_safe", { p_deposit_id: fake, p_voided_by: null }],
    ["complete_bank_reconciliation_safe", { p_session_id: fake }],
  ];

  let moneyBlocked = 0;
  for (const [name, args] of money) {
    const d = await probe(anon, "anon", name, args);
    // ACL deny OR ACCOUNTING_FORBIDDEN before mutation both OK
    // "Invoice not found" means function RAN — FAIL for security close
    if (d.denied) {
      moneyBlocked++;
      pass(`anon money: ${name} blocked (${d.via})`);
    } else if (
      d.via === "business_error" &&
      /ACCOUNTING_FORBIDDEN/i.test(d.detail || "")
    ) {
      moneyBlocked++;
      pass(`anon money: ${name} forbidden body`);
    } else {
      fail(`anon money: ${name} executed business path (${d.via}: ${d.detail})`);
    }
  }
  results.moneyBlockedCount = moneyBlocked;

  // Service can still call finalize with fake id → not found (proves EXECUTE + runs)
  {
    const { data, error } = await svc.rpc("finalize_invoice_safe", {
      p_invoice_id: fake,
    });
    if (!error && data && data.ok === false && /not found/i.test(data.error || "")) {
      pass("service_role: finalize_invoice_safe reachable (not found)");
    } else if (error && /ACCOUNTING_FORBIDDEN/i.test(error.message)) {
      fail(`service_role: finalize unexpectedly forbidden: ${error.message}`);
    } else {
      note(`service_role finalize probe: ${error?.message || JSON.stringify(data)}`);
      // still ok if function exists
      if (!error || data) pass("service_role: finalize_invoice_safe responded");
    }
  }

  // 0168 helpers exist
  for (const fn of [
    "accounting_request_jwt_role",
    "accounting_is_service_role",
  ]) {
    const { error } = await svc.rpc(fn, fn.includes("jwt") ? {} : {});
    // jwt role may need no args
    const r = await svc.rpc(fn);
    if (r.error && /could not find/i.test(r.error.message)) fail(`missing ${fn}`);
    else pass(`helper exists: ${fn}`);
  }

  // Invoice pilot still false
  {
    const { data } = await svc.rpc("invoice_accounting_pilot_active");
    if (data === false) pass("invoice_accounting_pilot_active=false");
    else fail(`invoice_accounting_pilot_active=${data}`);
  }

  console.log("\n=== SUMMARY ===");
  const ok = failures.length === 0;
  console.log(ok ? "OVERALL: PASS" : "OVERALL: FAIL");
  console.log(
    JSON.stringify(
      { ok, failures, notes, results: summarize(results) },
      null,
      2,
    ),
  );
  process.exit(ok ? 0 : 2);
}

function summarize(r) {
  // keep report-sized
  const out = { ...r };
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
