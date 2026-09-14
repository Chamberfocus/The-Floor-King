#!/usr/bin/env node
/**
 * Parser + disposable PostgreSQL full run for customer_reset_final.sql.
 * Does NOT touch production. Does NOT print secrets.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RESET = join(ROOT, "scripts/owner/customer_reset_final.sql");
const MIG = join(
  ROOT,
  "supabase/migrations/0188_estimate_approval_snapshot_operational_detach.sql",
);
const FIXTURE = join(
  ROOT,
  "scripts/owner/disposable/customer_reset_final_fixture.sql",
);
const DB = "fk_reset_final";
const errors = [];

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function fail(msg) {
  errors.push(msg);
  console.error(`✗ ${msg}`);
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

function runPython(code, extraEnv = {}) {
  const r = spawnSync("python3", ["-c", code], {
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
  return r;
}

function parseWithPglast(label, sql, pythonPath) {
  const tmp = join(tmpdir(), `fk-parse-${label}-${Date.now()}.sql`);
  writeFileSync(tmp, sql);
  const env = pythonPath ? { PYTHONPATH: pythonPath } : {};
  const r = runPython(
    `
import sys
from pglast import parse_sql
sql = open(${JSON.stringify(tmp)}, encoding="utf-8").read()
parse_sql(sql)
print("ok", len(sql.splitlines()))
`,
    env,
  );
  if (r.status !== 0) {
    fail(`${label} pglast parse failed: ${(r.stderr || r.stdout || "").slice(0, 800)}`);
    return false;
  }
  ok(`${label} pglast parse: ${(r.stdout || "").trim()}`);
  return true;
}

const resetSql = readFileSync(RESET, "utf8");
const migSql = readFileSync(MIG, "utf8");
const body = stripComments(resetSql);
if (/\bdisable\s+trigger\b/i.test(body)) fail("reset contains DISABLE TRIGGER");
if (/\bset\s+session_replication_role\b/i.test(body)) fail("reset assigns session_replication_role");
if (/\bunnest\s*\(/i.test(body)) fail("reset contains unnest()");
if (/\bwith\s+ordinality\b/i.test(body)) fail("reset contains WITH ORDINALITY");
if (/\bjob_notes\b/i.test(body)) fail("reset references job_notes");
if (!/\bwork_notes\b/i.test(body)) fail("reset missing work_notes");
if (/sk[_-]?live|service_role|eyJ/.test(resetSql)) fail("reset looks like it contains a secret");
if (!existsSync(FIXTURE)) fail(`missing fixture ${FIXTURE}`);

parseWithPglast("reset-default", resetSql);
parseWithPglast("0188-default", migSql);
if (existsSync("/tmp/pglast15")) {
  parseWithPglast("reset-pg15", resetSql, "/tmp/pglast15");
  parseWithPglast("0188-pg15", migSql, "/tmp/pglast15");
}

function psqlBase() {
  for (const port of ["5432", "55432"]) {
    const r = spawnSync(
      "sudo",
      ["-u", "postgres", "psql", "-p", port, "-d", "postgres", "-Atqc", "select 1"],
      { encoding: "utf8" },
    );
    if (r.status === 0 && (r.stdout || "").trim() === "1") {
      return ["-u", "postgres", "psql", "-p", port, "-v", "ON_ERROR_STOP=1"];
    }
  }
  throw new Error("No local postgres on 5432 or 55432");
}

const base = psqlBase();
function psql(args, input) {
  const r = spawnSync("sudo", [...base, ...args], {
    encoding: "utf8",
    input: input ?? undefined,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(
      `psql failed (${args.join(" ")}): ${(r.stderr || r.stdout || "").slice(0, 2000)}`,
    );
  }
  return (r.stdout || "").trim();
}

psql(["-d", "postgres", "-c", `DROP DATABASE IF EXISTS ${DB}`]);
psql(["-d", "postgres", "-c", `CREATE DATABASE ${DB}`]);
ok(`created disposable database ${DB}`);

psql(["-d", DB, "-f", FIXTURE]);
const before = psql([
  "-d",
  DB,
  "-Atc",
  "select json_build_object('customers', (select count(*) from public.customers), 'snapshots', (select count(*) from public.estimate_approval_snapshots), 'products', (select count(*) from public.products), 'staff', (select count(*) from public.profiles where role is distinct from 'customer'))",
]);
const beforeJ = JSON.parse(before);
console.log("seed", beforeJ);
if (beforeJ.customers !== 11) fail(`seed customers ${beforeJ.customers} != 11`);
if (beforeJ.snapshots !== 2) fail(`seed snapshots ${beforeJ.snapshots} != 2`);
ok("seeded 11 customers / 2 snapshots");

psql(["-d", DB, "-f", MIG]);
ok("applied 0188");

const detachReady = psql([
  "-d",
  DB,
  "-Atc",
  "select attnotnull::text from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relname='estimate_approval_snapshots' and a.attname='estimate_id'",
]);
if (detachReady !== "false") fail(`estimate_id attnotnull=${detachReady}`);
ok("0188 made estimate_id nullable");

psql(["-d", DB, "-f", RESET]);
ok("ran customer_reset_final.sql");

const after = JSON.parse(
  psql([
    "-d",
    DB,
    "-Atc",
    "select json_build_object('customers', (select count(*) from public.customers), 'snapshots', (select count(*) from public.estimate_approval_snapshots), 'attached', (select count(*) from public.estimate_approval_snapshots where estimate_id is not null or approved_by_customer_id is not null), 'jobs', (select count(*) from public.jobs), 'estimates', (select count(*) from public.estimates), 'products', (select count(*) from public.products), 'suppliers', (select count(*) from public.suppliers), 'staff', (select count(*) from public.profiles where role is distinct from 'customer'), 'portal_unlinked', (select count(*) from public.profiles where role='customer' and customer_id is null), 'warehouse_pos', (select count(*) from public.purchase_orders where customer_id is null and job_id is null and estimate_id is null), 'shop_notes', (select count(*) from public.work_notes where job_id is null and po_id is null), 'blocks', (select count(*) from public.appointments where customer_id is null), 'audit', (select count(*) from public.financial_audit_log), 'posting', (select posting_enabled from public.accounting_settings where id=1), 'trig', (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='estimate_approval_snapshots' and t.tgname='estimate_approval_snapshots_no_delete' and t.tgenabled in ('O','A')))",
  ]),
);
console.log("after first run", after);
if (after.customers !== 0) fail(`customers after ${after.customers} != 0`);
if (after.snapshots !== 2) fail(`snapshots after ${after.snapshots} != 2`);
if (after.attached !== 0) fail(`snapshots still attached ${after.attached}`);
if (after.jobs !== 0) fail(`jobs after ${after.jobs} != 0`);
if (after.estimates !== 0) fail(`estimates after ${after.estimates} != 0`);
if (after.products !== beforeJ.products) fail("products changed");
if (after.staff !== beforeJ.staff) fail("staff changed");
if (after.posting !== false) fail("accounting posting enabled");
if (after.trig < 1) fail("no-delete trigger not enabled");
if (after.warehouse_pos < 1) fail("warehouse PO missing");
if (after.shop_notes < 1) fail("shop-wide work_note missing");
if (after.blocks < 1) fail("calendar block appointment missing");
if (after.audit < 1) fail("financial_audit_log missing");
ok("first run: customers 11 → 0, snapshots preserved and detached");

const del = spawnSync(
  "sudo",
  [
    ...base,
    "-d",
    DB,
    "-c",
    "delete from public.estimate_approval_snapshots",
  ],
  { encoding: "utf8" },
);
if (del.status === 0) fail("snapshot DELETE succeeded (append-only broken)");
else ok("snapshot DELETE still rejected");

const payload = psql([
  "-d",
  DB,
  "-Atc",
  "select payload->>'customer_id' from public.estimate_approval_snapshots order by version limit 1",
]);
if (payload !== "a1000000-0000-4000-8000-000000000001") {
  fail(`payload customer_id not preserved: ${payload}`);
} else {
  ok("immutable payload still carries historical customer_id");
}

psql(["-d", DB, "-f", RESET]);
const after2 = JSON.parse(
  psql([
    "-d",
    DB,
    "-Atc",
    "select json_build_object('customers', (select count(*) from public.customers), 'snapshots', (select count(*) from public.estimate_approval_snapshots), 'products', (select count(*) from public.products))",
  ]),
);
if (after2.customers !== 0) fail("second run customers != 0");
if (after2.snapshots !== 2) fail("second run destroyed snapshots");
if (after2.products !== beforeJ.products) fail("second run changed products");
ok("second run ALREADY_CLEAN / no-op");

psql([
  "-d",
  DB,
  "-c",
  "insert into public.customers (full_name) values ('First New Customer'); insert into public.estimates (customer_id) select id from public.customers where full_name='First New Customer'",
]);
const newbie = JSON.parse(
  psql([
    "-d",
    DB,
    "-Atc",
    "select json_build_object('customers', (select count(*) from public.customers), 'estimates', (select count(*) from public.estimates))",
  ]),
);
if (newbie.customers !== 1 || newbie.estimates !== 1) {
  fail(`first new customer/estimate failed: ${JSON.stringify(newbie)}`);
} else {
  ok("first new customer + estimate after reset");
}

const fk = psql([
  "-d",
  DB,
  "-Atc",
  "select count(*) from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and c.contype='f' and not c.convalidated",
]);
if (fk !== "0") fail(`unvalidated FKs: ${fk}`);
else ok("FK constraints validated");

console.log(
  JSON.stringify(
    {
      resetSha256: sha256(RESET),
      migSha256: sha256(MIG),
      resetLines: resetSql.split(/\r?\n/).length,
      migLines: migSql.split(/\r?\n/).length,
      before: beforeJ,
      after,
      after2,
      newbie,
      errors,
    },
    null,
    2,
  ),
);

if (errors.length) {
  console.error("\nDISPOSABLE VALIDATION FAILED");
  process.exit(1);
}
console.error("\nDISPOSABLE VALIDATION PASSED");
