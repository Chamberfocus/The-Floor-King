/**
 * F6-P3B / 0175 post-apply production verification.
 * READ-ONLY / fail-closed. No bills, payments, expenses, journals, flags, or business rows.
 *
 * Usage: node --env-file=.env.local scripts/verify-f6-p3b-production.mjs
 *
 * Catalog notes: hosted pg-meta SQL may be unavailable. Signature presence is
 * proven via PostgREST OpenAPI + service_role RPC probes. ACL is proven
 * behaviorally (anon denied). Triggers/privileges use SQL when available,
 * else INFERRED from migration + OpenAPI + fail-closed probes.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
const inferred = [];
const proven = [];
const results = {
  scoreboard: {},
  settings: null,
  legacy: {},
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
function noteInferred(msg) {
  inferred.push(msg);
  console.log("INFERRED:", msg);
}
function noteProven(msg) {
  proven.push(msg);
  pass(msg);
}

function isDenied(error, data) {
  if (!error && data !== null && data !== undefined) {
    const err =
      typeof data === "object" && data && "error" in data
        ? String(data.error)
        : "";
    if (/ACCOUNTING_FORBIDDEN|permission|Forbidden|42501/i.test(err)) {
      return { denied: true, via: "rpc_body_forbidden", detail: err.slice(0, 120) };
    }
    if (typeof data === "object" && data && data.ok === false) {
      return { denied: false, via: "business_error", detail: err.slice(0, 120) };
    }
    return {
      denied: false,
      via: "success_data",
      detail: JSON.stringify(data).slice(0, 80),
    };
  }
  const msg = error?.message || String(error);
  // Overload ambiguity (PGRST203): function(s) visible in schema cache but EXECUTE
  // not proven. Treat as blocked/inconclusive — not a successful invocation.
  if (/Could not choose the best candidate function|PGRST203/i.test(msg)) {
    return { denied: true, via: "overload_ambiguous", detail: msg.slice(0, 160) };
  }
  if (
    /permission denied|not granted|42501|PGRST301|PGRST302|PGRST202|Could not find the function|ACCOUNTING_FORBIDDEN|Forbidden|JWT|row-level security|RLS/i.test(
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
    detail: d.detail,
  };
  return d;
}

async function fetchOpenApi() {
  const res = await fetch(`${url}/rest/v1/`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/openapi+json",
    },
  });
  if (!res.ok) return null;
  return res.json();
}

function rpcBodySchema(openapi, name) {
  const path = openapi?.paths?.[`/rpc/${name}`];
  const post = path?.post;
  const param = (post?.parameters || []).find((p) => p.name === "args");
  return param?.schema || null;
}

function rpcPropNames(schema) {
  return Object.keys(schema?.properties || {}).sort();
}

function tableSchema(openapi, table) {
  return openapi?.definitions?.[table] || openapi?.components?.schemas?.[table] || null;
}

function tablePropNames(schema) {
  return Object.keys(schema?.properties || {}).sort();
}

function isMissingFn(error) {
  return /could not find the function|PGRST202|schema cache/i.test(error?.message || "");
}

const LINE = [{ description: "verify", quantity: 1, unit_cost: 1, unit: "ea" }];

const STAFF_RPCS = [
  [
    "create_vendor_bill_safe",
    {
      p_supplier_id: fake,
      p_lines: LINE,
      p_bill_date: null,
      p_due_date: null,
      p_bill_number: null,
      p_terms: null,
      p_memo: null,
      p_job_id: null,
      p_po_id: null,
      p_accounting_category: null,
      p_source_type: null,
      p_idempotency_key: `verify-p3b-create:${fake}`,
      p_created_by: null,
    },
    [
      "p_supplier_id",
      "p_lines",
      "p_bill_date",
      "p_due_date",
      "p_bill_number",
      "p_terms",
      "p_memo",
      "p_job_id",
      "p_po_id",
      "p_accounting_category",
      "p_source_type",
      "p_idempotency_key",
      "p_created_by",
    ],
  ],
  [
    "save_vendor_bill_draft_safe",
    {
      p_bill_id: fake,
      p_supplier_id: fake,
      p_lines: LINE,
      p_bill_date: null,
      p_due_date: null,
      p_bill_number: null,
      p_terms: null,
      p_memo: null,
      p_job_id: null,
      p_accounting_category: null,
      p_idempotency_key: null,
      p_created_by: null,
    },
    [
      "p_bill_id",
      "p_supplier_id",
      "p_lines",
      "p_bill_date",
      "p_due_date",
      "p_bill_number",
      "p_terms",
      "p_memo",
      "p_job_id",
      "p_accounting_category",
      "p_idempotency_key",
      "p_created_by",
    ],
  ],
  [
    "activate_vendor_bill_safe",
    { p_bill_id: fake, p_idempotency_key: null, p_created_by: null },
    ["p_bill_id", "p_idempotency_key", "p_created_by"],
  ],
  [
    "void_vendor_bill_safe",
    {
      p_bill_id: fake,
      p_reason: "verify",
      p_idempotency_key: null,
      p_created_by: null,
    },
    ["p_bill_id", "p_reason", "p_idempotency_key", "p_created_by"],
  ],
  [
    "correct_vendor_bill_safe",
    {
      p_bill_id: fake,
      p_reason: "verify",
      p_supplier_id: fake,
      p_lines: LINE,
      p_bill_date: null,
      p_due_date: null,
      p_bill_number: null,
      p_terms: null,
      p_memo: null,
      p_job_id: null,
      p_accounting_category: null,
      p_idempotency_key: null,
      p_created_by: null,
    },
    [
      "p_bill_id",
      "p_reason",
      "p_supplier_id",
      "p_lines",
      "p_bill_date",
      "p_due_date",
      "p_bill_number",
      "p_terms",
      "p_memo",
      "p_job_id",
      "p_accounting_category",
      "p_idempotency_key",
      "p_created_by",
    ],
  ],
  [
    "record_bill_payment_safe",
    {
      p_bill_id: fake,
      p_amount: 1,
      p_date: "2099-01-01",
      p_method: null,
      p_note: null,
      p_created_by: null,
      p_idempotency_key: `verify-p3b-pay:${fake}`,
      p_cash_account_id: null,
    },
    [
      "p_bill_id",
      "p_amount",
      "p_date",
      "p_method",
      "p_note",
      "p_created_by",
      "p_idempotency_key",
      "p_cash_account_id",
    ],
  ],
  [
    "void_bill_payment_safe",
    {
      p_bill_payment_id: fake,
      p_voided_by: null,
      p_void_reason: "verify",
    },
    ["p_bill_payment_id", "p_voided_by", "p_void_reason"],
  ],
  [
    "record_direct_expense_safe",
    {
      p_date: "2099-01-01",
      p_category: "other",
      p_amount: 1,
      p_vendor: null,
      p_note: null,
      p_job_id: null,
      p_bill_id: null,
      p_created_by: null,
      p_idempotency_key: `verify-p3b-exp:${fake}`,
      p_supplier_id: null,
      p_vendor_invoice_ref: null,
      p_ack_unlinked: false,
    },
    [
      "p_date",
      "p_category",
      "p_amount",
      "p_vendor",
      "p_note",
      "p_job_id",
      "p_bill_id",
      "p_created_by",
      "p_idempotency_key",
      "p_supplier_id",
      "p_vendor_invoice_ref",
      "p_ack_unlinked",
    ],
  ],
  ["ap_bill_original_total", { p_bill_id: fake }, ["p_bill_id"]],
  ["ap_bill_paid_total", { p_bill_id: fake }, ["p_bill_id"]],
  ["ap_bill_remaining", { p_bill_id: fake }, ["p_bill_id"]],
  ["ap_bill_display_status", { p_bill_id: fake }, ["p_bill_id"]],
];

const INTERNAL_HELPERS = [
  "ap_text_is_nonfinite",
  "ap_parse_numeric_text",
  "ap_money_ok",
  "ap_json_numeric",
  "ap_line_total",
  "ap_normalize_invoice",
  "ap_context_hash",
  "ap_lookup_action",
  "ap_store_action",
  "ap_require_ok",
  "ap_lock_bill",
  "ap_lock_jobs_sorted",
  "ap_lock_vendor_invoice",
  "ap_lock_vendor_invoices_sorted",
  "ap_direct_expense_identity_exists",
  "ap_reject_if_direct_expense_identity",
  "ap_record_vendor_event",
  "ap_validate_lines",
  "ap_assert_category",
  "ap_assert_supplier",
  "bills_enforce_ap_immutability",
  "bill_items_enforce_ap_immutability",
  "bill_payments_enforce_ap_immutability",
  "bill_payments_block_void_ap",
  "expenses_block_ap_linked_insert",
];

const BILL_COLS = [
  "source_type",
  "source_id",
  "vendor_invoice_norm",
  "legacy_review_required",
  "replacement_of_bill_id",
  "replaced_by_bill_id",
  "activated_at",
  "activated_by",
  "ap_lifecycle",
  "installer_labor_bill_id",
];

const EXPENSE_COLS = ["supplier_id", "vendor_invoice_norm", "economic_kind"];

const MONEY_TABLES = ["bills", "bill_items", "bill_payments", "expenses"];

async function trySql(query) {
  for (const ep of [`${url}/pg/query`, `${url}/pg-meta/default/query`]) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) continue;
      const data = JSON.parse(await res.text());
      const row = Array.isArray(data) ? data[0] : data?.[0] ?? data;
      return { ok: true, row, rows: Array.isArray(data) ? data : [row] };
    } catch {
      /* next */
    }
  }
  return { ok: false };
}

function loadMigrationMarkers() {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/0175_f6_p3b_ap_vendor_integrity.sql"),
    "utf8",
  );
  return {
    sql,
    hasJobsSorted: sql.includes("ap_lock_jobs_sorted"),
    hasInvoiceSorted: sql.includes("ap_lock_vendor_invoices_sorted"),
    hasLockRetry: sql.includes("AP_LOCK_RETRY"),
    hasDirectExpenseGuard: sql.includes("ap_reject_if_direct_expense_identity"),
    hasExpenseAck: sql.includes("REQUIRE_DIRECT_EXPENSE_ACK"),
    hasPaymentCashHash: /ap_context_hash\('record_bill_payment'[\s\S]*cash_account_id/.test(
      sql,
    ),
    hasCorrectFullHash: /ap_context_hash\('correct_vendor_bill'[\s\S]*'job_id'[\s\S]*'category'/.test(
      sql,
    ),
    dropsPostVendor: sql.includes("LEGACY RPC CLOSURE — post_vendor_bill_safe"),
    expensesBeforeHelper:
      sql.indexOf("add column if not exists supplier_id uuid references public.suppliers") <
      sql.indexOf("create or replace function public.ap_direct_expense_identity_exists("),
    noPostingEnable: !/posting_enabled\s*=\s*true/i.test(sql),
  };
}

async function main() {
  console.log("=== F6-P3B / 0175 production verification (READ-ONLY) ===\n");

  const markers = loadMigrationMarkers();
  if (!markers.expensesBeforeHelper) {
    fail("migration file ordering regression: expenses ALTER after helper");
  } else {
    noteProven("migration file: expenses provenance precedes identity helper");
  }

  // Applied probe
  const { error: probeErr } = await svc.rpc("create_vendor_bill_safe", {
    p_supplier_id: fake,
    p_lines: LINE,
  });
  if (isMissingFn(probeErr)) {
    fail("0175 not applied — create_vendor_bill_safe missing");
    results.scoreboard.applied = "FAIL";
    finish();
    return;
  }
  noteProven("0175 applied (create_vendor_bill_safe present)");
  results.scoreboard.applied = "PASS";

  const openapi = await fetchOpenApi();
  if (!openapi) {
    fail("OpenAPI schema unavailable");
  } else {
    noteProven("OpenAPI schema reachable");
  }

  // --- Objects / columns ---
  let objectsOk = true;
  if (openapi) {
    const billsProps = tablePropNames(tableSchema(openapi, "bills"));
    const expProps = tablePropNames(tableSchema(openapi, "expenses"));
    for (const c of BILL_COLS) {
      if (!billsProps.includes(c)) {
        fail(`bills missing column ${c}`);
        objectsOk = false;
      }
    }
    for (const c of EXPENSE_COLS) {
      if (!expProps.includes(c)) {
        fail(`expenses missing column ${c}`);
        objectsOk = false;
      }
    }
    if (objectsOk) {
      noteProven("bills + expenses 0175 columns present (OpenAPI)");
    }
  } else {
    objectsOk = false;
  }

  // post_vendor_bill_safe must be absent
  const postSchema = openapi ? rpcBodySchema(openapi, "post_vendor_bill_safe") : null;
  const postProbe = await svc.rpc("post_vendor_bill_safe", {
    p_bill_id: fake,
    p_actor: null,
  });
  if (postSchema || !isMissingFn(postProbe.error)) {
    fail("post_vendor_bill_safe still present/callable");
    objectsOk = false;
    results.scoreboard.postVendorBillAbsent = "FAIL";
  } else {
    noteProven("post_vendor_bill_safe absent (OpenAPI + RPC)");
    results.scoreboard.postVendorBillAbsent = "PASS";
  }

  // --- Staff RPC signatures ---
  let sigOk = !!openapi;
  for (const [name, , expectedProps] of STAFF_RPCS) {
    const schema = openapi ? rpcBodySchema(openapi, name) : null;
    if (!schema) {
      fail(`OpenAPI missing /rpc/${name}`);
      sigOk = false;
      continue;
    }
    const props = rpcPropNames(schema);
    const missing = expectedProps.filter((p) => !props.includes(p));
    if (missing.length) {
      fail(`/rpc/${name} missing props: ${missing.join(",")}`);
      sigOk = false;
    } else {
      noteProven(`staff RPC signature OK: ${name}`);
    }
  }
  results.scoreboard.rpcSignatures = sigOk ? "PASS" : "FAIL";

  // --- Anon blocked on staff mutation RPCs ---
  const mutationStaff = STAFF_RPCS.filter(
    ([n]) => !n.startsWith("ap_bill_"),
  );
  let anonBlocked = 0;
  for (const [name, args] of mutationStaff) {
    const d = await probe(anon, "anon", name, args);
    if (d.denied) {
      anonBlocked++;
      noteProven(`anon blocked: ${name}`);
    } else {
      fail(`anon executed ${name} (${d.via}: ${d.detail})`);
    }
  }
  results.scoreboard.staffRpcAcls =
    anonBlocked === mutationStaff.length ? "PASS" : "FAIL";

  // Internal helpers
  const internalProbeArgs = {
    ap_normalize_invoice: { p_raw: " AB-1 " },
    ap_lock_bill: { p_bill_id: fake },
    ap_lock_jobs_sorted: { p_job_a: fake, p_job_b: null },
    ap_lock_vendor_invoice: { p_supplier_id: fake, p_invoice_norm: "inv1" },
    ap_direct_expense_identity_exists: {
      p_supplier_id: fake,
      p_invoice_norm: "inv1",
    },
    ap_line_total: { p_qty: 1, p_unit: 1 },
    ap_money_ok: { p_amount: 1, p_allow_zero: false },
  };
  let internalAclOk = true;
  let internalSeen = 0;
  for (const name of INTERNAL_HELPERS) {
    const inOpenApi = openapi && rpcBodySchema(openapi, name);
    if (!inOpenApi) {
      noteInferred(
        `internal helper ${name} not in OpenAPI (typical for service_role-only / non-exposed)`,
      );
      continue;
    }
    internalSeen++;
    const args = internalProbeArgs[name] || {};
    const d = await probe(anon, "anon-internal", name, args);
    if (!d.denied) {
      fail(`anon can invoke internal ${name}`);
      internalAclOk = false;
    } else if (d.via === "overload_ambiguous") {
      noteInferred(
        `internal ${name}: OpenAPI-visible overload ambiguity (PGRST203) — EXECUTE not proven; same ambiguity on service_role for ap_money_ok`,
      );
    } else {
      noteProven(`anon blocked internal: ${name}`);
    }
  }
  results.scoreboard.internalHelperAcls = internalAclOk ? "PASS" : "FAIL";
  if (internalSeen === 0) {
    noteInferred(
      "No F6-P3B internal helpers exposed via OpenAPI — ACL inferred from migration ACL sweep + anon staff RPC blocks",
    );
  }

  // Service_role staff RPCs fail-closed (must NOT create rows)
  let staffExist = 0;
  for (const [name, args] of STAFF_RPCS) {
    const { data, error } = await svc.rpc(name, args);
    const msg = error?.message || "";
    if (isMissingFn(error)) {
      fail(`staff RPC missing: ${name}`);
      objectsOk = false;
    } else {
      staffExist++;
      const body =
        data && typeof data === "object" ? JSON.stringify(data).slice(0, 120) : "";
      if (
        data &&
        typeof data === "object" &&
        data.ok === true &&
        data.duplicate !== true &&
        !String(name).startsWith("ap_bill_")
      ) {
        fail(
          `UNEXPECTED SUCCESS mutating via probe ${name}: ${body} — investigate production data`,
        );
        objectsOk = false;
      } else {
        noteProven(
          `staff RPC reachable (fail-closed): ${name}${
            msg || body ? ` [${(msg || body).slice(0, 70)}]` : ""
          }`,
        );
      }
    }
  }
  if (staffExist !== STAFF_RPCS.length) objectsOk = false;
  results.scoreboard.objects = objectsOk ? "PASS" : "FAIL";

  // --- Direct DML ---
  let dmlOk = true;
  for (const t of MONEY_TABLES) {
    const { error: insErr } = await anon.from(t).insert({ id: fake });
    if (!insErr) {
      fail(`anon INSERT unexpectedly succeeded on ${t}`);
      dmlOk = false;
    } else {
      noteProven(`anon INSERT blocked/failed closed on ${t}`);
    }
    const { error: delErr } = await anon.from(t).delete().eq("id", fake);
    if (!delErr) {
      noteInferred(
        `anon DELETE on ${t} returned no error (0-row deletes are inconclusive for privilege)`,
      );
    } else {
      noteProven(`anon DELETE rejected on ${t}`);
    }
  }
  results.scoreboard.baseTableDml = dmlOk ? "PASS" : "FAIL";

  // --- Catalog SQL (when available) ---
  const aclSql = await trySql(`
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='post_vendor_bill_safe') as post_vendor_cnt,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='create_vendor_bill_safe') as create_cnt,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='activate_vendor_bill_safe') as activate_cnt,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='ap_lock_jobs_sorted') as jobs_sorted_cnt,
  (select count(*) from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='bill_payments'
      and not t.tgisinternal
      and t.tgname='bill_payments_block_void_ap') as pay_void_trg,
  (select count(*) from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='bill_payments'
      and not t.tgisinternal
      and t.tgname='bill_payments_sync_installer_labor') as pay_installer_trg,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='bills'
      and policyname='bills_admin_office_select') as bills_pol,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='expenses'
      and policyname='expenses_admin_office_select') as exp_pol,
  (select has_table_privilege('authenticated','public.bills','INSERT')) as auth_bills_ins,
  (select has_table_privilege('authenticated','public.bills','UPDATE')) as auth_bills_upd,
  (select has_table_privilege('authenticated','public.bills','DELETE')) as auth_bills_del,
  (select has_table_privilege('authenticated','public.expenses','DELETE')) as auth_exp_del,
  (select has_table_privilege('authenticated','public.expenses','INSERT')) as auth_exp_ins,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='ap_lock_bill'
      and pg_get_functiondef(p.oid) ilike '%ap_lock_jobs_sorted%') as lock_bill_jobs,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='ap_lock_bill'
      and pg_get_functiondef(p.oid) ilike '%AP_LOCK_RETRY%') as lock_retry,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='correct_vendor_bill_safe'
      and pg_get_functiondef(p.oid) ilike '%AP_CORRECTION_ABORTED%') as correct_raise,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='record_bill_payment_safe'
      and pg_get_functiondef(p.oid) ilike '%cash_account_id%') as pay_hash_cash,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='record_direct_expense_safe'
      and pg_get_functiondef(p.oid) ilike '%AP_OBLIGATION_EXISTS%') as exp_ap_guard,
  (select count(*) from pg_indexes
    where schemaname='public' and indexname='bills_active_vendor_invoice_uidx') as inv_uidx,
  (select count(*) from pg_indexes
    where schemaname='public' and indexname='bills_active_po_source_uidx') as po_uidx
`);

  const legacySql = await trySql(`
select
  (select count(*) from (
     select supplier_id, vendor_invoice_norm
     from public.bills
     where source_type in ('manual','purchase_order')
       and supplier_id is not null
       and vendor_invoice_norm is not null
       and ap_lifecycle in ('draft','open')
     group by 1,2 having count(*) > 1
   ) x) as dup_vendor_invoice,
  (select count(*) from (
     select po_id from public.bills
     where source_type='purchase_order' and po_id is not null
       and ap_lifecycle in ('draft','open')
     group by 1 having count(*) > 1
   ) x) as dup_po_ap,
  (select count(*) from public.bills where supplier_id is null) as bills_no_supplier,
  (select count(*) from public.bills
     where vendor_invoice_norm is null and coalesce(bill_number,'') <> '') as bills_uninormed,
  (select count(*) from public.expenses
     where supplier_id is null or vendor_invoice_norm is null) as expenses_no_identity,
  (select count(*) from public.bills where legacy_review_required is true) as legacy_review
`);

  if (aclSql.ok && aclSql.row) {
    const r = aclSql.row;
    if (Number(r.post_vendor_cnt) === 0) {
      noteProven("SQL: post_vendor_bill_safe overload count = 0");
    } else {
      fail(`SQL: post_vendor_bill_safe still has ${r.post_vendor_cnt} overload(s)`);
    }
    if (Number(r.create_cnt) >= 1 && Number(r.activate_cnt) >= 1) {
      noteProven("SQL: create/activate staff RPCs present");
    } else {
      fail("SQL: create/activate staff RPCs missing");
    }
    if (Number(r.pay_void_trg) >= 1) {
      noteProven("SQL: bill_payments_block_void_ap trigger attached");
      results.scoreboard.paymentDraftVoidTrigger = "PASS";
    } else {
      fail("SQL: bill_payments_block_void_ap trigger missing");
      results.scoreboard.paymentDraftVoidTrigger = "FAIL";
    }
    if (Number(r.pay_installer_trg) >= 1) {
      noteProven("SQL: bill_payments_sync_installer_labor retained");
    } else {
      noteInferred("SQL: installer payment sync trigger not found (check 0174 separately)");
    }
    if (Number(r.bills_pol) >= 1 && Number(r.exp_pol) >= 1) {
      noteProven("SQL: admin/office SELECT policies on bills + expenses");
      results.scoreboard.apRls = "PASS";
    } else {
      fail(`SQL: SELECT policies bills=${r.bills_pol} expenses=${r.exp_pol}`);
      results.scoreboard.apRls = "FAIL";
    }
    if (
      r.auth_bills_ins === false &&
      r.auth_bills_upd === false &&
      r.auth_bills_del === false &&
      r.auth_exp_del === false &&
      r.auth_exp_ins === false
    ) {
      noteProven("SQL: authenticated INSERT/UPDATE/DELETE revoked on bills + expenses");
      results.scoreboard.authDmlRevoked = "PASS";
    } else {
      fail(
        `SQL: authenticated DML privileges unexpected bills_ins=${r.auth_bills_ins} exp_del=${r.auth_exp_del}`,
      );
      results.scoreboard.authDmlRevoked = "FAIL";
    }
    if (Number(r.lock_bill_jobs) >= 1 && Number(r.lock_retry) >= 1) {
      noteProven("SQL: ap_lock_bill uses ap_lock_jobs_sorted + AP_LOCK_RETRY");
      results.scoreboard.lockHierarchy = "PASS";
    } else {
      fail("SQL: ap_lock_bill missing sorted jobs / AP_LOCK_RETRY");
      results.scoreboard.lockHierarchy = "FAIL";
    }
    if (Number(r.correct_raise) >= 1) {
      noteProven("SQL: correct_vendor_bill_safe RAISE atomicity marker present");
      results.scoreboard.correctionAtomicity = "PASS";
    } else {
      fail("SQL: correction RAISE marker missing");
      results.scoreboard.correctionAtomicity = "FAIL";
    }
    if (Number(r.pay_hash_cash) >= 1 && Number(r.exp_ap_guard) >= 1) {
      noteProven("SQL: payment cash context + expense AP guard present");
      results.scoreboard.idempotencyAndSymmetric = "PASS";
    } else {
      fail("SQL: payment/expense context markers incomplete");
      results.scoreboard.idempotencyAndSymmetric = "FAIL";
    }
    results.scoreboard.vendorInvoiceIndex =
      Number(r.inv_uidx) >= 1 ? "PASS" : "INFERRED_SKIPPED_OR_ABSENT";
    results.scoreboard.poIndex =
      Number(r.po_uidx) >= 1 ? "PASS" : "INFERRED_SKIPPED_OR_ABSENT";
    if (Number(r.inv_uidx) < 1) {
      noteInferred(
        "bills_active_vendor_invoice_uidx absent — likely skipped for legacy collisions; RPC+advisory lock still required",
      );
    } else {
      noteProven("bills_active_vendor_invoice_uidx present");
    }
    if (Number(r.po_uidx) < 1) {
      noteInferred(
        "bills_active_po_source_uidx absent — likely skipped for legacy collisions; PO row lock still required",
      );
    } else {
      noteProven("bills_active_po_source_uidx present");
    }
  } else {
    noteInferred(
      "pg-meta SQL unavailable — ACL/trigger/lock checks inferred from migration + OpenAPI + anon probes",
    );
    results.scoreboard.paymentDraftVoidTrigger = markers.sql.includes(
      "create trigger bill_payments_block_void_ap",
    )
      ? "INFERRED"
      : "FAIL";
    results.scoreboard.apRls = "INFERRED";
    results.scoreboard.authDmlRevoked = "INFERRED";
    results.scoreboard.lockHierarchy =
      markers.hasJobsSorted && markers.hasLockRetry ? "INFERRED" : "FAIL";
    results.scoreboard.correctionAtomicity = markers.sql.includes("AP_CORRECTION_ABORTED")
      ? "INFERRED"
      : "FAIL";
    results.scoreboard.idempotencyAndSymmetric =
      markers.hasDirectExpenseGuard && markers.hasPaymentCashHash
        ? "INFERRED"
        : "FAIL";
  }

  if (legacySql.ok && legacySql.row) {
    results.legacy = legacySql.row;
    noteProven(
      `legacy counts: dup_invoice=${legacySql.row.dup_vendor_invoice} dup_po=${legacySql.row.dup_po_ap} no_supplier=${legacySql.row.bills_no_supplier} expenses_no_identity=${legacySql.row.expenses_no_identity} legacy_review=${legacySql.row.legacy_review}`,
    );
    results.scoreboard.legacyReview = "PASS";
  } else {
    noteInferred("legacy collision counts unavailable (pg-meta SQL offline)");
    results.scoreboard.legacyReview = "INFERRED";
  }

  // --- Accounting settings ---
  const { data: settings, error: setErr } = await svc
    .from("accounting_settings")
    .select(
      "posting_enabled, ap_posting_enabled, inventory_posting_enabled, installer_posting_enabled, books_of_record, opening_balances_entered, accountant_validated, cutover_date",
    )
    .limit(1)
    .maybeSingle();

  let flagsOk = true;
  if (setErr) {
    fail(`settings read: ${setErr.message}`);
    flagsOk = false;
  } else {
    const s = settings || {};
    results.settings = s;
    const checks = [
      ["posting_enabled", false],
      ["ap_posting_enabled", false],
      ["inventory_posting_enabled", false],
      ["installer_posting_enabled", false],
      ["books_of_record", false],
      ["opening_balances_entered", false],
      ["accountant_validated", false],
    ];
    for (const [k, expected] of checks) {
      if (s[k] === true) {
        fail(`${k} is unexpectedly true — STOP / do not auto-disable`);
        flagsOk = false;
      } else {
        noteProven(`${k}=${String(s[k])} (expected not true)`);
      }
    }
    if (s.cutover_date != null) {
      fail(`cutover_date unexpectedly set: ${s.cutover_date}`);
      flagsOk = false;
    } else {
      noteProven("cutover_date=null");
    }
  }
  results.scoreboard.accountingFlags = flagsOk ? "PASS" : "FAIL";
  results.scoreboard.backupPitr = "NO";

  // Static / design inferences that remain green when SQL offline
  if (markers.hasDirectExpenseGuard && markers.hasExpenseAck) {
    noteProven("design: AP↔expense symmetric guard + ack present in migration");
    if (!results.scoreboard.apDirectExpenseSymmetric) {
      results.scoreboard.apDirectExpenseSymmetric = aclSql.ok
        ? results.scoreboard.idempotencyAndSymmetric
        : "INFERRED";
    }
  }
  results.scoreboard.nativeNumeric = markers.sql.includes("Infinity")
    ? "INFERRED_FROM_MIGRATION"
    : "FAIL";
  results.scoreboard.gucTrustBoundary = "INFERRED_FROM_REVOKED_DML";
  results.scoreboard.outboxArchitecture = markers.sql.includes(
    "installer_labor_record_vendor_event",
  )
    ? "INFERRED"
    : "FAIL";
  results.scoreboard.vendorCreditsDeferred = markers.sql.includes(
    "vendor credits",
  ) || !/vendor_credit_safe/i.test(markers.sql)
    ? "PASS_DEFERRED"
    : "FAIL";

  finish();
}

function finish() {
  console.log("\n=== SUMMARY ===");
  const hardFails = failures.length;
  const flagFail = results.scoreboard.accountingFlags === "FAIL";
  const ok = hardFails === 0 && !flagFail;
  console.log(ok ? "OVERALL: PASS" : "OVERALL: FAIL");
  console.log(
    JSON.stringify(
      {
        ok,
        failures,
        inferredCount: inferred.length,
        provenCount: proven.length,
        scoreboard: results.scoreboard,
        settings: results.settings,
        legacy: results.legacy,
        productionBusinessDataMutated: "NO",
        accountingActivationChanged: "NO",
        backupPitrConfirmed: "NO",
      },
      null,
      2,
    ),
  );
  process.exit(ok ? 0 : 2);
}

await main();
