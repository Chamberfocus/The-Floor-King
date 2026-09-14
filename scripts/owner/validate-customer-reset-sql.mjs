#!/usr/bin/env node
/**
 * Static compatibility check for owner customer-reset SQL vs migration schema.
 * No database. Fails if a public.table in the scripts does not exist as of 0187,
 * or if the scripts contain trigger-disable / FK-bypass / preflight mutations.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MIG_DIR = join(ROOT, "supabase/migrations");
const FILES = {
  preflight: join(ROOT, "scripts/owner/customer_reset_preflight_readonly.sql"),
  snapshotInvestigation: join(
    ROOT,
    "scripts/owner/customer_reset_snapshot_investigation_readonly.sql",
  ),
  reset: join(ROOT, "scripts/owner/customer_reset_safe.sql"),
};

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function ident(raw) {
  return raw.trim().replace(/^public\./i, "").replace(/^"+|"+$/g, "").toLowerCase();
}

const tables = new Map();
function ensure(name) {
  const n = ident(name);
  if (!tables.has(n)) tables.set(n, { dropped: false, renamedFrom: null, columns: new Set() });
  return tables.get(n);
}

function parseCreateColumns(body) {
  const cols = new Set();
  const cleaned = body.replace(/\([^)]*\)/g, " ");
  for (const part of cleaned.split(",")) {
    const m = part.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+/);
    if (!m) continue;
    const name = m[1].toLowerCase();
    if (
      ["constraint", "primary", "unique", "check", "foreign", "exclude", "like", "inherit"].includes(name)
    )
      continue;
    cols.add(name);
  }
  return cols;
}

const files = readdirSync(MIG_DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();

const renameEvents = [];
for (const file of files) {
  const sql = stripComments(readFileSync(join(MIG_DIR, file), "utf8"));

  const createRe =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?((?:public\.)?"?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*\(([\s\S]*?)\);/gi;
  let m;
  while ((m = createRe.exec(sql))) {
    const t = ensure(m[1]);
    t.dropped = false;
    t.createdBy = file;
    for (const c of parseCreateColumns(m[2])) t.columns.add(c);
  }

  const renameRe =
    /alter\s+table\s+(?:if\s+exists\s+)?((?:public\.)?"?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+rename\s+to\s+((?:public\.)?"?[a-zA-Z_][a-zA-Z0-9_]*"?)/gi;
  while ((m = renameRe.exec(sql))) {
    const from = ident(m[1]);
    const to = ident(m[2]);
    const old = ensure(from);
    old.dropped = true;
    const neu = ensure(to);
    neu.dropped = false;
    neu.renamedFrom = from;
    neu.createdBy = file;
    for (const c of old.columns) neu.columns.add(c);
    renameEvents.push({ file, from, to });
  }

  const dropRe =
    /drop\s+table\s+(?:if\s+exists\s+)?((?:public\.)?"?[a-zA-Z_][a-zA-Z0-9_]*"?)/gi;
  while ((m = dropRe.exec(sql))) {
    ensure(m[1]).dropped = true;
  }

  const addColRe =
    /add\s+column\s+(?:if\s+not\s+exists\s+)?([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  // Attribute added columns to the most recent ALTER TABLE public.X in the same statement chunk.
  const alterChunks = sql.split(/;/);
  for (const chunk of alterChunks) {
    const tbl = chunk.match(/alter\s+table\s+(?:if\s+exists\s+)?((?:public\.)?"?[a-zA-Z_][a-zA-Z0-9_]*"?)/i);
    if (!tbl) continue;
    const t = ensure(tbl[1]);
    let c;
    const colRe = /add\s+column\s+(?:if\s+not\s+exists\s+)?([a-zA-Z_][a-zA-Z0-9_]*)/gi;
    while ((c = colRe.exec(chunk))) t.columns.add(ident(c[1]));
  }
}

const live = new Set(
  [...tables.entries()].filter(([, v]) => !v.dropped).map(([k]) => k),
);

function publicTables(sql) {
  const found = new Set();
  const body = stripComments(sql);
  const re = /\bpublic\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let m;
  while ((m = re.exec(body))) found.add(m[1].toLowerCase());
  return [...found].sort();
}

function statementForbidden(sql, re) {
  return re.test(stripComments(sql));
}

const errors = [];
const report = {
  migrationFiles: files.length,
  liveTableCount: live.size,
  renameEvents,
  droppedNames: [...tables.entries()]
    .filter(([, v]) => v.dropped)
    .map(([k, v]) => ({ name: k, renamedTo: [...tables.entries()].find(([, x]) => x.renamedFrom === k)?.[0] || null, lastFile: v.createdBy })),
};

for (const [label, path] of Object.entries(FILES)) {
  const sql = readFileSync(path, "utf8");
  const refs = publicTables(sql);
  const missing = refs.filter((t) => !live.has(t));
  const dead = refs.filter((t) => tables.get(t)?.dropped);
  report[label] = { refs, missing, dead };

  if (missing.length) errors.push(`${label}: unknown public tables: ${missing.join(", ")}`);
  if (dead.length) errors.push(`${label}: renamed/dropped public tables: ${dead.join(", ")}`);

  if (statementForbidden(sql, /\bdisable\s+trigger\b/i)) {
    errors.push(`${label}: contains DISABLE TRIGGER`);
  }
  if (statementForbidden(sql, /\bset\s+session_replication_role\b/i)) {
    errors.push(`${label}: assigns session_replication_role`);
  }
  if (statementForbidden(sql, /\bset_config\s*\(\s*'session_replication_role'/i)) {
    errors.push(`${label}: set_config session_replication_role`);
  }
}

const preflightRaw = readFileSync(FILES.preflight, "utf8");
if (statementForbidden(preflightRaw, /\bunnest\s*\(/i)) {
  errors.push("preflight: contains unnest()");
}
if (statementForbidden(preflightRaw, /\bwith\s+ordinality\b/i)) {
  errors.push("preflight: contains WITH ORDINALITY");
}

function assertReadOnly(label, sql) {
  const body = stripComments(sql);
  if (/\bdelete\s+from\b/i.test(body)) errors.push(`${label}: DELETE`);
  if (/\bupdate\s+public\./i.test(body)) errors.push(`${label}: UPDATE`);
  if (/\binsert\s+into\b/i.test(body)) errors.push(`${label}: INSERT`);
  if (/\balter\s+table\b/i.test(body)) errors.push(`${label}: ALTER TABLE`);
  if (/\bdrop\s+(table|function|trigger|type)\b/i.test(body)) errors.push(`${label}: DROP`);
  if (/\btruncate\b/i.test(body)) errors.push(`${label}: TRUNCATE`);
  if (/\bdisable\s+trigger\b/i.test(body)) errors.push(`${label}: DISABLE TRIGGER`);
  if (/\bset\s+session_replication_role\b/i.test(body)) {
    errors.push(`${label}: SET session_replication_role`);
  }
  if (/\bunnest\s*\(/i.test(body)) errors.push(`${label}: unnest()`);
  if (/\bwith\s+ordinality\b/i.test(body)) errors.push(`${label}: WITH ORDINALITY`);
}

const pre = readFileSync(FILES.preflight, "utf8");
assertReadOnly("preflight", pre);
assertReadOnly(
  "snapshotInvestigation",
  readFileSync(FILES.snapshotInvestigation, "utf8"),
);

if (!live.has("work_notes")) errors.push("schema: work_notes missing from live inventory");
if (live.has("job_notes")) errors.push("schema: job_notes still live (expected rename in 0137)");
if (!report.preflight.refs.includes("work_notes")) {
  errors.push("preflight: does not reference work_notes");
}
if (report.preflight.refs.includes("job_notes")) {
  errors.push("preflight: still references job_notes");
}
if (report.reset.refs.includes("job_notes")) {
  errors.push("reset: still references job_notes");
}

const requiredCoverage = [
  "customers",
  "estimates",
  "estimate_approval_snapshots",
  "orders",
  "jobs",
  "invoices",
  "payments",
  "credit_memos",
  "credit_applications",
  "refunds",
  "customer_deposits",
  "opening_ar_items",
  "journal_entries",
  "journal_lines",
  "purchase_orders",
  "po_items",
  "stock_movements",
  "inventory_return_allocations",
  "installer_bills",
  "bills",
  "service_callbacks",
  "office_tasks",
  "appointments",
  "documents",
  "profiles",
  "customer_duplicate_overrides",
  "work_notes",
  "job_schedule_overrides",
];
const missingCoverage = requiredCoverage.filter(
  (t) => !report.preflight.refs.includes(t),
);
if (missingCoverage.length) {
  errors.push(`preflight missing required coverage tables: ${missingCoverage.join(", ")}`);
}

const requiredColumns = {
  customers: ["id", "full_name", "company", "email", "phone", "stage", "created_at", "referred_by_customer_id"],
  profiles: ["id", "role", "customer_id"],
  invoices: ["id", "customer_id", "status"],
  payments: ["id", "invoice_id"],
  estimates: ["id", "customer_id", "status"],
  jobs: ["id", "customer_id", "status"],
  orders: ["id", "customer_id", "job_id", "status"],
  work_notes: ["id", "job_id", "po_id"],
  office_tasks: ["customer_id", "job_id", "estimate_id"],
  service_callbacks: ["customer_id"],
  purchase_orders: ["id", "customer_id", "job_id", "estimate_id"],
  po_items: ["for_customer_id", "for_job_id"],
  bills: ["customer_id", "job_id", "po_id"],
  installer_bills: ["job_id", "status"],
  journal_lines: ["customer_id"],
  journal_entries: ["source_id", "status"],
  stock_movements: ["customer_id", "job_id", "po_id"],
  inventory_return_allocations: ["return_movement_id", "pull_movement_id"],
  accounting_settings: [
    "id",
    "posting_enabled",
    "inventory_posting_enabled",
    "ap_posting_enabled",
    "installer_posting_enabled",
    "invoice_posting_enabled",
    "payment_posting_enabled",
    "credit_posting_enabled",
    "expense_posting_enabled",
    "deposit_posting_enabled",
    "books_of_record",
    "opening_balances_entered",
    "accountant_validated",
    "cutover_date",
  ],
  estimate_approval_snapshots: ["estimate_id", "approved_by_customer_id"],
  documents: ["customer_id", "path"],
  job_files: ["job_id", "path"],
  sample_checkout_items: ["checkout_id"],
  installer_bill_line_items: ["bill_id"],
  stock_rolls: ["job_id"],
  job_schedule_overrides: ["job_id"],
  customer_duplicate_overrides: ["created_customer_id", "matched_customer_id"],
  expenses: ["job_id"],
};

for (const [table, cols] of Object.entries(requiredColumns)) {
  const t = tables.get(table);
  if (!t || t.dropped) {
    errors.push(`column check: table ${table} is not live`);
    continue;
  }
  if (t.columns.size === 0) {
    errors.push(`column check: parser found no columns for ${table}`);
    continue;
  }
  for (const col of cols) {
    if (!t.columns.has(col)) {
      errors.push(`column check: ${table}.${col} not in schema (have ${[...t.columns].sort().join(",")})`);
    }
  }
}

console.log(JSON.stringify({ ok: errors.length === 0, errors, report }, null, 2));
if (errors.length) {
  console.error("\nSCHEMA COMPATIBILITY FAILED:\n" + errors.map((e) => `- ${e}`).join("\n"));
  process.exit(1);
}
console.error("SCHEMA COMPATIBILITY OK");
