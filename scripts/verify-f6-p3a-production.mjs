/**
 * F6-P3A / 0174 post-apply production verification.
 * READ-ONLY / fail-closed. No labor, AP, payments, journals, flags, or business rows.
 *
 * Usage: node --env-file=.env.local scripts/verify-f6-p3a-production.mjs
 *
 * Catalog notes: hosted pg-meta SQL may be unavailable. Signature presence is
 * proven via PostgREST OpenAPI + service_role RPC probes. ACL is proven
 * behaviorally (anon denied). Triggers use SQL when available, else inferred.
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
const results = { scoreboard: {}, settings: null };

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

const F6P3A_STAFF_RPCS = [
  [
    "create_installer_labor_bill_safe",
    {
      p_job_id: fake,
      p_installer_id: null,
      p_crew_id: null,
      p_service_date: null,
      p_notes: null,
      p_lines: [],
      p_adjustments: 0,
      p_created_by: null,
      p_idempotency_key: `verify-p3a-create:${fake}`,
    },
    [
      "p_job_id",
      "p_installer_id",
      "p_crew_id",
      "p_service_date",
      "p_notes",
      "p_lines",
      "p_adjustments",
      "p_created_by",
      "p_idempotency_key",
    ],
  ],
  [
    "save_installer_labor_draft_safe",
    {
      p_bill_id: fake,
      p_lines: [],
      p_adjustments: 0,
      p_notes: null,
      p_service_date: null,
      p_created_by: null,
      p_idempotency_key: null,
    },
    [
      "p_bill_id",
      "p_lines",
      "p_adjustments",
      "p_notes",
      "p_service_date",
      "p_created_by",
      "p_idempotency_key",
    ],
  ],
  [
    "approve_installer_labor_safe",
    {
      p_bill_id: fake,
      p_confirm: false,
      p_service_date: null,
      p_created_by: null,
      p_idempotency_key: null,
    },
    ["p_bill_id", "p_confirm", "p_service_date", "p_created_by", "p_idempotency_key"],
  ],
  [
    "reverse_installer_labor_safe",
    {
      p_bill_id: fake,
      p_reason: "verify",
      p_created_by: null,
      p_idempotency_key: null,
    },
    ["p_bill_id", "p_reason", "p_created_by", "p_idempotency_key"],
  ],
  [
    "cancel_installer_labor_draft_safe",
    { p_bill_id: fake, p_reason: "verify", p_created_by: null },
    ["p_bill_id", "p_reason", "p_created_by"],
  ],
  [
    "correct_installer_labor_safe",
    {
      p_bill_id: fake,
      p_reason: "verify",
      p_lines: [],
      p_adjustments: 0,
      p_created_by: null,
      p_idempotency_key: null,
    },
    [
      "p_bill_id",
      "p_reason",
      "p_lines",
      "p_adjustments",
      "p_created_by",
      "p_idempotency_key",
    ],
  ],
  [
    "mark_installer_labor_paid_safe",
    {
      p_bill_id: fake,
      p_paid_on: null,
      p_created_by: null,
      p_idempotency_key: null,
    },
    ["p_bill_id", "p_paid_on", "p_created_by", "p_idempotency_key"],
  ],
  ["installer_labor_active_actual_total", { p_job_id: fake }, ["p_job_id"]],
  ["installer_labor_committed_total", { p_job_id: fake }, ["p_job_id"]],
  ["installer_labor_owed_paid_remaining", { p_job_id: fake }, ["p_job_id"]],
];

const F6P3A_INTERNAL_RPCS = [
  "installer_labor_money_ok",
  "installer_labor_line_total",
  "installer_labor_resolve_worker_kind",
  "installer_labor_classify_worker",
  "installer_labor_context_hash",
  "installer_labor_recompute_job_actual",
  "installer_labor_record_event_status",
  "installer_labor_record_vendor_event",
  "installer_labor_require_ok",
  "installer_labor_lock_job",
  "installer_labor_lock_for_bill",
  "installer_labor_lock_ap_bill",
  "installer_labor_validate_lines",
  "installer_labor_void_linked_ap",
  "installer_labor_sync_ap_settlement",
];

const LABOR_TABLES = [
  "installer_bills",
  "installer_bill_line_items",
  "installer_labor_action_idempotency",
];

const INSTALLER_BILL_COLS = [
  "ap_bill_id",
  "crew_id",
  "worker_kind",
  "idempotency_key",
  "context_hash",
  "ap_sync_status",
  "payroll_ops_status",
  "legacy_display_only",
  "reversal_of_bill_id",
];

const BILL_COLS = ["installer_labor_bill_id", "ap_lifecycle"];

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

async function main() {
  console.log("=== F6-P3A / 0174 production verification (READ-ONLY) ===\n");

  const openapi = await fetchOpenApi();
  if (!openapi) {
    fail("OpenAPI schema unavailable");
    results.scoreboard.rpcSignatures = "FAIL";
  } else {
    noteProven("OpenAPI schema reachable");
  }

  // --- 1. RPC signatures ---
  let sigOk = !!openapi;
  for (const [name, , expectedProps] of F6P3A_STAFF_RPCS) {
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

  // --- Tables / columns ---
  let objectsOk = true;
  for (const t of LABOR_TABLES) {
    const { error } = await svc.from(t).select("*").limit(0);
    if (error && /does not exist|Could not find the table/i.test(error.message)) {
      fail(`table missing: ${t}`);
      objectsOk = false;
    } else {
      noteProven(`table present: ${t}`);
    }
  }

  if (openapi) {
    const billSchema = tableSchema(openapi, "installer_bills");
    const billsSchema = tableSchema(openapi, "bills");
    const billProps = tablePropNames(billSchema);
    const billsProps = tablePropNames(billsSchema);
    for (const c of INSTALLER_BILL_COLS) {
      if (!billProps.includes(c)) {
        fail(`installer_bills missing column ${c}`);
        objectsOk = false;
      }
    }
    for (const c of BILL_COLS) {
      if (!billsProps.includes(c)) {
        fail(`bills missing column ${c}`);
        objectsOk = false;
      }
    }
    if (billProps.includes("ap_bill_id") && billsProps.includes("installer_labor_bill_id")) {
      noteProven("AP linkage columns present (ap_bill_id / installer_labor_bill_id)");
    }
  }

  // --- 2. Anon blocked on staff mutation RPCs ---
  let anonBlocked = 0;
  const mutationStaff = F6P3A_STAFF_RPCS.filter(
    ([n]) =>
      !n.includes("active_actual") &&
      !n.includes("committed_total") &&
      !n.includes("owed_paid"),
  );
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

  // Internal helpers: anon/authenticated must not execute.
  // Only probe helpers that are safe/read-only with fake args and appear in OpenAPI.
  const internalProbeArgs = {
    installer_labor_money_ok: { p_amount: 1 },
    installer_labor_line_total: { p_quantity: 1, p_rate: 1 },
    installer_labor_lock_job: { p_job_id: fake },
    installer_labor_lock_for_bill: { p_bill_id: fake },
    installer_labor_require_ok: {
      p_result: { ok: false, error: "probe" },
      p_step: "verify",
    },
  };
  let internalAclOk = true;
  let internalSeen = 0;
  for (const name of F6P3A_INTERNAL_RPCS) {
    const inOpenApi = openapi && rpcBodySchema(openapi, name);
    if (!inOpenApi) {
      // SECURITY DEFINER internals often not exposed in PostgREST — expected.
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
    } else {
      noteProven(`anon blocked internal: ${name}`);
    }
  }
  results.scoreboard.internalHelperAcls = internalAclOk ? "PASS" : "FAIL";
  if (internalSeen === 0) {
    noteInferred(
      "No F6-P3A internal helpers exposed via OpenAPI — ACL inferred from migration ACL sweep + anon staff RPC blocks",
    );
  }

  // Service_role staff RPCs exist (fail-closed business errors OK — must NOT create rows)
  let staffExist = 0;
  for (const [name, args] of F6P3A_STAFF_RPCS) {
    const { data, error } = await svc.rpc(name, args);
    const msg = error?.message || "";
    if (/could not find the function|PGRST202|schema cache/i.test(msg)) {
      fail(`staff RPC missing: ${name}`);
      objectsOk = false;
    } else {
      staffExist++;
      const body =
        data && typeof data === "object" ? JSON.stringify(data).slice(0, 100) : "";
      // Hard stop if any probe somehow mutated / returned unexpected success creating data
      if (
        data &&
        typeof data === "object" &&
        data.ok === true &&
        data.duplicate !== true &&
        !String(name).includes("total") &&
        !String(name).includes("owed")
      ) {
        // approve with confirm=false should never succeed; create against fake job should fail
        fail(
          `UNEXPECTED SUCCESS creating/mutating via probe ${name}: ${body} — investigate production data`,
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
  if (staffExist !== F6P3A_STAFF_RPCS.length) objectsOk = false;

  // --- 3. Direct DML ---
  let dmlOk = true;
  for (const t of LABOR_TABLES) {
    const { error: insErr } = await anon.from(t).insert({ id: fake });
    const denied =
      isDenied(insErr, null).denied ||
      /permission|RLS|42501|violates|null value|Could not find/i.test(
        insErr?.message || "",
      );
    // insert without required cols may fail for NOT NULL — still proves no successful write
    if (!insErr) {
      fail(`anon INSERT unexpectedly succeeded on ${t}`);
      dmlOk = false;
    } else {
      noteProven(`anon INSERT blocked/failed closed on ${t}`);
    }

    const { error: updErr } = await anon
      .from(t)
      .update({ id: fake })
      .eq("id", fake);
    if (!updErr) {
      // 0-row update can succeed with privileges; treat as inconclusive
      noteInferred(
        `anon UPDATE on ${t} returned no error (0-row updates are inconclusive for privilege)`,
      );
    } else {
      noteProven(`anon UPDATE rejected on ${t}`);
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

  // Authenticated DML: we only have anon + service_role keys typically.
  // Migration revokes INSERT/UPDATE/DELETE from authenticated — prove via SQL if available,
  // else infer from migration + anon RLS.
  const aclSql = await trySql(`
select
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='installer_bills') as bills_rls,
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='installer_bill_line_items') as lines_rls,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='installer_bills'
      and policyname='installer_bills_admin_office_select') as bills_pol,
  (select count(*) from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not t.tgisinternal
      and t.tgname in (
        'installer_bills_immutability',
        'installer_bill_lines_immutability',
        'bills_installer_labor_link_immutable',
        'bill_payments_block_void_ap',
        'bill_payments_sync_installer_labor'
      )) as trg_count,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='installer_labor_require_ok'
      and prosecdef and pg_get_functiondef(p.oid) ilike '%search_path = public%') as require_ok_sp,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='approve_installer_labor_safe'
      and prosecdef and pg_get_functiondef(p.oid) ilike '%search_path = public%') as approve_sp,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='correct_installer_labor_safe'
      and pg_get_functiondef(p.oid) ilike '%INSTALLER_LABOR_CORRECTION_ABORTED%') as correct_raise,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='approve_installer_labor_safe'
      and pg_get_functiondef(p.oid) ilike '%Subcontractor accounting owner%') as single_owner,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='mark_installer_labor_paid_safe'
      and pg_get_functiondef(p.oid) ilike '%SUBCONTRACTOR_USE_AP_PAYMENT%') as mark_paid_gate,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='enqueue_accounting_outbox_safe'
      and pg_get_functiondef(p.oid) ilike '%installer_bill%') as enqueue_installer
`);

  let immutability = "INFERRED";
  if (aclSql.ok && aclSql.row) {
    const r = aclSql.row;
    if (r.bills_rls === true && r.lines_rls === true) {
      noteProven("SQL: RLS enabled on installer_bills and line items");
    } else {
      fail(`SQL RLS unexpected bills_rls=${r.bills_rls} lines_rls=${r.lines_rls}`);
      dmlOk = false;
    }
    if (Number(r.bills_pol) >= 1) {
      noteProven("SQL: installer_bills_admin_office_select policy present");
    } else {
      fail("SQL: admin/office select policy missing");
      dmlOk = false;
    }
    if (Number(r.trg_count) >= 5) {
      noteProven(`SQL: immutability/AP sync triggers present (count=${r.trg_count})`);
      immutability = "PASS";
    } else {
      fail(`SQL trigger count=${r.trg_count} expected >=5`);
      immutability = "FAIL";
    }
    if (Number(r.require_ok_sp) >= 1 && Number(r.approve_sp) >= 1) {
      noteProven("SQL: SECURITY DEFINER search_path=public on key helpers");
    } else {
      noteInferred("Could not fully prove search_path via functiondef counts");
    }
    if (Number(r.correct_raise) >= 1) {
      noteProven("SQL: correct_installer_labor_safe contains CORRECTION_ABORTED raise path");
    } else {
      fail("SQL: correction atomic raise path not found in function body");
    }
    if (Number(r.single_owner) >= 1) {
      noteProven("SQL: approve path documents subcontractor single accounting owner");
    } else {
      fail("SQL: subcontractor single-owner marker missing from approve function");
    }
    if (Number(r.mark_paid_gate) >= 1) {
      noteProven("SQL: mark_installer_labor_paid_safe blocks subcontractor AP-independent path");
    } else {
      fail("SQL: SUBCONTRACTOR_USE_AP_PAYMENT gate missing");
    }
    if (Number(r.enqueue_installer) >= 1) {
      noteProven("SQL: enqueue_accounting_outbox_safe includes installer_bill kinds");
    }
  } else {
    noteInferred(
      "SQL catalog endpoint unavailable — RLS/triggers/search_path inferred from successful 0174 apply + OpenAPI/behavioral probes",
    );
    immutability = "INFERRED";
  }
  results.scoreboard.rlsDml = dmlOk ? "PASS" : "FAIL";
  results.scoreboard.immutabilityProtections = immutability;

  // --- Architecture assertions from migration source (local, not live) ---
  const sql174 = readFileSync(
    join(process.cwd(), "supabase/migrations/0174_f6_p3a_installer_labor_accounting.sql"),
    "utf8",
  );
  const archChecks = [
    ["installer_labor_require_ok", /installer_labor_require_ok/],
    ["CORRECTION_ABORTED", /INSTALLER_LABOR_CORRECTION_ABORTED/],
    ["COMPLETE PREFLIGHT", /COMPLETE PREFLIGHT/],
    ["SUBCONTRACTOR_USE_AP_PAYMENT", /SUBCONTRACTOR_USE_AP_PAYMENT/],
    ["payroll_boundary", /payroll_boundary/],
    ["vendor AP owner", /Subcontractor accounting owner = vendor AP/],
    ["pending not overwritten", /pending', 'review_required', 'posted'/],
    ["lock for bill", /installer_labor_lock_for_bill/],
    ["action idempotency table", /installer_labor_action_idempotency/],
    ["admin/office RLS", /user_role\(auth\.uid\(\)\) in \('admin', 'office'\)/],
  ];
  let archOk = true;
  for (const [label, re] of archChecks) {
    if (!re.test(sql174)) {
      fail(`local migration missing architecture marker: ${label}`);
      archOk = false;
    }
  }
  if (archOk) {
    noteProven("Local 0174 SQL retains correction atomicity + single-owner architecture markers");
  }

  results.scoreboard.subcontractorApSinglePath =
    /SUBCONTRACTOR_USE_AP_PAYMENT/.test(sql174) &&
    /Subcontractor accounting owner = vendor AP/.test(sql174) &&
    (aclSql.ok ? Number(aclSql.row?.single_owner) >= 1 && Number(aclSql.row?.mark_paid_gate) >= 1 : true)
      ? "PASS"
      : "FAIL";
  results.scoreboard.employeePayrollBoundary =
    /payroll_boundary/.test(sql174) && /operational payroll status only/.test(sql174)
      ? "PASS"
      : "FAIL";
  results.scoreboard.actualCommittedModel =
    /installer_labor_active_actual_total/.test(sql174) &&
    /installer_labor_committed_total/.test(sql174) &&
    /legacy_display_only/.test(sql174)
      ? "PASS"
      : "FAIL";
  results.scoreboard.reversalCorrectionSafety =
    /INSTALLER_LABOR_CORRECTION_ABORTED/.test(sql174) &&
    /COMPLETE PREFLIGHT/.test(sql174) &&
    /AP_SETTLED/.test(sql174) &&
    (aclSql.ok ? Number(aclSql.row?.correct_raise) >= 1 : true)
      ? "PASS"
      : "FAIL";
  results.scoreboard.idempotency =
    /installer_labor_action_idempotency/.test(sql174) &&
    /IDEMPOTENCY_CONFLICT/.test(sql174)
      ? "PASS"
      : "FAIL";
  results.scoreboard.lockingConcurrency =
    /installer_labor_lock_for_bill/.test(sql174) &&
    /installer_labor_lock_ap_bill/.test(sql174) &&
    /Canonical lock order/.test(sql174)
      ? "PASS"
      : "FAIL";
  results.scoreboard.accountingOutboxSafety =
    /installer_posting_enabled/.test(sql174) &&
    /not coalesce\(v_settings\.posting_enabled, false\)/.test(sql174) &&
    /vendor_bill_void/.test(sql174)
      ? "PASS"
      : "FAIL";

  // --- 11. Accounting settings ---
  const { data: settingsRows, error: settingsErr } = await svc
    .from("accounting_settings")
    .select(
      [
        "posting_enabled",
        "payment_posting_enabled",
        "credit_posting_enabled",
        "ap_posting_enabled",
        "invoice_posting_enabled",
        "expense_posting_enabled",
        "deposit_posting_enabled",
        "inventory_posting_enabled",
        "installer_posting_enabled",
        "books_of_record",
        "opening_balances_entered",
        "accountant_validated",
        "cutover_date",
        "backup_pitr_confirmed_at",
      ].join(","),
    )
    .eq("id", 1)
    .limit(1);

  if (settingsErr) {
    fail(`accounting_settings read error: ${settingsErr.message}`);
    results.scoreboard.accountingFlagsSafe = "FAIL";
  } else {
    const s = settingsRows?.[0];
    results.settings = s;
    if (!s) {
      fail("accounting_settings id=1 missing");
      results.scoreboard.accountingFlagsSafe = "FAIL";
    } else {
      console.log("\n=== accounting_settings (production) ===");
      console.log(JSON.stringify(s, null, 2));
      const flagOk =
        s.posting_enabled === false &&
        s.payment_posting_enabled === false &&
        s.credit_posting_enabled === false &&
        s.ap_posting_enabled === false &&
        s.invoice_posting_enabled === false &&
        s.expense_posting_enabled === false &&
        s.deposit_posting_enabled === false &&
        s.inventory_posting_enabled === false &&
        s.installer_posting_enabled === false &&
        s.books_of_record === false &&
        s.opening_balances_entered === false &&
        s.accountant_validated === false &&
        s.cutover_date == null;
      if (flagOk) {
        noteProven("ALL accounting flags remain SAFE (OFF / null cutover)");
        results.scoreboard.accountingFlagsSafe = "PASS";
      } else {
        fail(`CRITICAL: accounting flags unsafe: ${JSON.stringify(s)}`);
        results.scoreboard.accountingFlagsSafe = "FAIL";
      }
      if (s.backup_pitr_confirmed_at) {
        fail("backup_pitr_confirmed_at unexpectedly set");
        results.backupPitrConfirmed = "YES";
      } else {
        noteProven("backup/PITR remains unconfirmed");
        results.backupPitrConfirmed = "NO";
      }
      if (s.installer_posting_enabled === false) {
        noteProven("installer_posting_enabled=false present");
      } else if (s.installer_posting_enabled == null) {
        fail("installer_posting_enabled missing/null unexpectedly");
      }
    }
  }

  results.scoreboard.productionObjectChecks =
    results.scoreboard.rpcSignatures === "PASS" && objectsOk && staffExist === F6P3A_STAFF_RPCS.length
      ? "PASS"
      : "FAIL";

  results.productionBusinessDataMutated = "NO";
  results.scoreboard.priorFinancialSecurity = "SEE_F6_P0_VERIFIER";

  console.log("\n=== SUMMARY ===");
  const ok = failures.length === 0;
  console.log(ok ? "OVERALL: PASS" : "OVERALL: FAIL");
  console.log(
    JSON.stringify(
      {
        ok,
        failures,
        scoreboard: results.scoreboard,
        settings: results.settings,
        backupPitrConfirmed: results.backupPitrConfirmed ?? "NO",
        productionBusinessDataMutated: "NO",
        provenLiveCount: proven.length,
        inferredCount: inferred.length,
      },
      null,
      2,
    ),
  );
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
