/**
 * Read-only 0181 production verification. No DML on business tables.
 * Usage: node --env-file=.env.local scripts/verify-0181-production.mjs
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

function schemaOf(spec, name) {
  const defs = spec.definitions || spec.components?.schemas || {};
  return defs[name] ?? null;
}

function colsOf(schema) {
  return Object.keys(schema?.properties || {}).sort();
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
        console.log(`SQL ${ep} → ${res.status}: ${text.slice(0, 140)}`);
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

async function restSelect(client, table, query) {
  const { data, error } = await client.from(table).select(query).limit(1);
  return {
    table,
    query,
    rows: data?.length ?? 0,
    code: error?.code ?? null,
    message: clip(error?.message),
    hint: clip(error?.hint),
  };
}

async function main() {
  console.log("=== 0181 production verification (read-only) ===\n");

  const openRes = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const openBody = await openRes.text();
  const spec = JSON.parse(openBody);
  console.log("OpenAPI status:", openRes.status, "bytes:", openBody.length);

  const views = [
    "estimates_customer",
    "estimate_options_customer",
    "estimate_line_items_customer",
    "jobs_customer",
    "job_line_items_customer",
    "estimate_approval_snapshots_customer",
    "org_settings_customer",
    "job_costing",
    "products_inventory_ops",
  ];
  for (const v of views) {
    const s = schemaOf(spec, v);
    console.log(
      "SURFACE",
      v,
      s ? `PRESENT cols=${colsOf(s).join(",")}` : "MISSING",
    );
  }

  console.log(
    "OpenAPI 0178/0179 approval comment:",
    openBody.includes("F7/0178+0179") ? "PRESENT" : "MISSING",
  );
  console.log(
    "OpenAPI 0180 installer_linked_crew_ids:",
    openBody.includes("installer_linked_crew_ids") ? "PRESENT" : "MISSING",
  );
  console.log(
    "OpenAPI customer_safe_approval_payload:",
    openBody.includes("customer_safe_approval_payload") ? "PRESENT" : "MISSING",
  );
  console.log(
    "OpenAPI allowlist comment:",
    openBody.includes("ALLOWLIST customer projection") ||
      openBody.includes("Unknown keys fail closed")
      ? "PRESENT"
      : "MISSING",
  );

  const { data: flags, error: flagErr } = await svc
    .from("accounting_settings")
    .select(
      "posting_enabled,inventory_posting_enabled,ap_posting_enabled,installer_posting_enabled,books_of_record,opening_balances_entered,accountant_validated,cutover_date",
    )
    .eq("id", 1)
    .maybeSingle();
  console.log("FLAGS", flagErr?.message || flags);

  const sensitive = {
    estimates_customer: [
      "target_margin",
      "notes",
      "created_by",
      "migrated",
      "approved_by_user_id",
    ],
    estimate_options_customer: ["notes"],
    estimate_line_items_customer: [
      "material_cost",
      "labor_cost",
      "margin_pct",
      "from_stock",
      "product_id",
    ],
    jobs_customer: [
      "estimated_material_cost",
      "actual_material_cost",
      "actual_labor_cost",
      "assigned_to",
      "closeout_notes",
    ],
    job_line_items_customer: ["material_cost", "labor_cost", "margin_pct"],
    org_settings_customer: ["freight_markup_pct", "fuel_surcharge_pct"],
  };
  const required = {
    estimates_customer: [
      "id",
      "title",
      "status",
      "tax_rate",
      "discount_kind",
      "discount_value",
      "job_description",
    ],
    estimate_options_customer: ["id", "estimate_id", "name", "position"],
    estimate_line_items_customer: [
      "material_rate",
      "labor_rate",
      "installed_rate",
      "flat_amount",
      "quantity",
      "description",
    ],
    jobs_customer: ["id", "status", "scheduled_date", "arrival_window"],
    org_settings_customer: ["company_name", "quote_valid_days"],
  };

  for (const [view, bad] of Object.entries(sensitive)) {
    const cols = colsOf(schemaOf(spec, view));
    const leaks = bad.filter((c) => cols.includes(c));
    console.log(
      "VIEW_LEAK",
      view,
      leaks.length ? `LEAK ${leaks.join(",")}` : "NONE",
    );
  }
  for (const [view, need] of Object.entries(required)) {
    const cols = colsOf(schemaOf(spec, view));
    const missing = need.filter((c) => !cols.includes(c));
    console.log(
      "VIEW_NEED",
      view,
      missing.length ? `MISSING ${missing.join(",")}` : "OK",
    );
  }

  const dirty = {
    notes: "internal: 32% margin",
    internal_new_cost_metric: 12.5,
    vendor_rebate: 40,
    commission_basis: 0.08,
    title: "Kitchen",
    tax_rate: 8,
    total: 831.6,
    option: {
      id: "opt-1",
      name: "Good",
      notes: "internal option",
      extra_profit: 9,
      lines: [
        {
          id: "line-1",
          material_rate: 5,
          line_total: 770,
          material_cost: 2.1,
          labor_cost: 0.5,
          margin_pct: 40,
          from_stock: true,
          vendor_rebate: 1,
          internal_new_cost_metric: 99,
        },
      ],
    },
  };

  const rpc = await svc.rpc("customer_safe_approval_payload", { p: dirty });
  console.log(
    "SANITIZE_RPC",
    rpc.error
      ? `ERR ${rpc.error.code} ${clip(rpc.error.message)}`
      : JSON.stringify(rpc.data),
  );

  const rpcAuth = await anon.rpc("customer_safe_approval_payload", { p: dirty });
  console.log(
    "SANITIZE_RPC_ANON",
    rpcAuth.error
      ? `${rpcAuth.error.code} ${clip(rpcAuth.error.message)}`
      : "UNEXPECTED_OK",
  );

  const probes = [];
  for (const [table, query] of [
    ["estimates", "target_margin"],
    ["estimate_options", "*"],
    ["estimate_line_items", "material_cost,labor_cost,margin_pct"],
    ["jobs", "estimated_material_cost,actual_material_cost"],
    ["job_line_items", "material_cost,labor_cost,margin_pct"],
    ["estimate_approval_snapshots", "payload"],
    ["org_settings", "freight_markup_pct,fuel_surcharge_pct"],
    ["job_costing", "*"],
    ["products_inventory_ops", "supplier,supplier_id"],
    ["estimates_customer", "id,title,tax_rate,job_description"],
    ["estimate_options_customer", "id,name"],
    ["estimate_line_items_customer", "material_rate,quantity,description"],
    ["jobs_customer", "id,status,scheduled_date"],
    ["job_line_items_customer", "material_rate,description"],
    ["estimate_approval_snapshots_customer", "id,payload"],
    ["org_settings_customer", "company_name,freight_disclaimer"],
  ]) {
    probes.push(await restSelect(anon, table, query));
    probes.push(await restSelect(svc, table, query));
  }
  for (const p of probes) {
    const who = p === probes.find((x) => x === p) ? "" : "";
    console.log(
      "REST",
      p.table,
      p.query.slice(0, 40),
      `rows=${p.rows}`,
      p.code || "ok",
      p.message,
    );
  }

  // Label probes with client: even indices anon, odd svc from the loop above.
  console.log("\n--- labeled REST ---");
  for (let i = 0; i < probes.length; i++) {
    const p = probes[i];
    const who = i % 2 === 0 ? "anon" : "service";
    console.log(
      who,
      p.table,
      p.query.slice(0, 48),
      `rows=${p.rows}`,
      p.code || "ok",
      p.message,
    );
  }

  const catalog = await trySql(`
    select n.nspname, c.relname, c.relkind,
           obj_description(c.oid) as comment
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'estimates_customer','estimate_options_customer','estimate_line_items_customer',
        'jobs_customer','job_line_items_customer','estimate_approval_snapshots_customer',
        'org_settings_customer','job_costing','products_inventory_ops'
      )
    order by c.relname;
  `);
  console.log("CATALOG_VIEWS", catalog.ok ? JSON.stringify(catalog.data).slice(0, 1200) : "UNAVAILABLE");

  const fnCat = await trySql(`
    select p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('customer_safe_approval_payload','customer_safe_line_json','my_customer_id');
  `);
  console.log("CATALOG_FNS", fnCat.ok ? "OK" : "UNAVAILABLE");
  if (fnCat.ok) {
    const raw = JSON.stringify(fnCat.data);
    console.log("FN_HAS_JSONB_BUILD", raw.includes("jsonb_build_object"));
    console.log("FN_HAS_DENYLIST_MINUS", raw.includes("p - 'notes'") || raw.includes("- 'material_cost'"));
    console.log("FN_HAS_UNKNOWN_FAIL_CLOSED", raw.includes("Unknown keys fail closed") || raw.includes("ALLOWLIST"));
  }

  const pol = await trySql(`
    select tablename, policyname, cmd, qual
    from pg_policies
    where schemaname = 'public'
      and tablename in ('estimates','estimate_options','estimate_line_items','jobs','job_line_items','estimate_approval_snapshots','org_settings')
      and (
        policyname ilike '%customer%'
        or policyname ilike '%portal%'
        or policyname = 'org_settings_read'
        or policyname = 'org_settings_internal_read'
      )
    order by tablename, policyname;
  `);
  console.log("CATALOG_POLICIES", pol.ok ? JSON.stringify(pol.data).slice(0, 2000) : "UNAVAILABLE");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
