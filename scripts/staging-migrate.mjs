#!/usr/bin/env node
/**
 * Staging migration gate for Floor King RC1.
 *
 * dry-run and check-gates never open a database connection.
 * inventory, apply, and prove refuse every project except
 * lsrapxmkspocxeeakkcx. They do not read .env.local.
 *
 * supabase_migrations.schema_migrations is not the apply history.
 * SQL Editor runs are not the apply history. The only resume record is
 * public.floor_king_migration_inventory, written by `apply`.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const STAGING_REF = "lsrapxmkspocxeeakkcx";
export const PRODUCTION_REF = "ayqcaloqsklvskkudvbs";
const APPLY_FLAG = "--authorize-staging-apply";
const APPLY_ENV = "FLOOR_KING_STAGING_APPLY";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION_DIR = join(ROOT, "supabase", "migrations");
const PROVE_SQL = join(ROOT, "scripts", "staging", "rc1-transaction-tests.sql");

const SENTINELS = [
  "public.profiles",
  "public.customers",
  "public.jobs",
  "public.invoices",
  "public.workflow_stages",
];

export function listMigrationFiles() {
  return readdirSync(MIGRATION_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function analyzeMigration(filename, sql) {
  const ownTransaction = /^\s*begin\s*;/im.test(sql) && /^\s*commit\s*;/im.test(sql);
  const enumAdd = /alter\s+type\s+[\w."]+\s+add\s+value/i.test(sql);
  let execution = "single-transaction";
  if (ownTransaction) execution = "file-managed";
  else if (enumAdd) execution = "autocommit";
  return {
    filename,
    sha256: sha256(sql),
    execution,
    extension: /create\s+extension/i.test(sql),
    enumAdd,
    storageBucket: /insert\s+into\s+storage\.buckets/i.test(sql),
    storagePolicy: /storage\.objects/i.test(sql),
    authUsers: /auth\.users/i.test(sql),
    dataDelete: /\bdelete\s+from\b/i.test(sql) || /\btruncate\b/i.test(sql),
    dropTable: /\bdrop\s+table\b/i.test(sql),
    questionUpdate: /update\s+public\.estimate_questions/i.test(sql),
  };
}

export function loadMigrationPlan() {
  const files = listMigrationFiles();
  const plan = files.map((filename) =>
    analyzeMigration(filename, readFileSync(join(MIGRATION_DIR, filename), "utf8")),
  );
  const prefixes = files.map((name) => Number(name.slice(0, 4)));
  const backwards = [];
  for (let i = 1; i < prefixes.length; i += 1) {
    if (prefixes[i] < prefixes[i - 1]) backwards.push(files[i]);
  }
  const bundle = sha256(plan.map((row) => `${row.filename}:${row.sha256}`).join("\n"));
  return { files, plan, backwards, bundle };
}

export function projectRefFromDatabaseUrl(url) {
  const raw = String(url ?? "");
  if (!raw.trim()) {
    return { ok: false, code: "URL_MISSING", ref: null };
  }
  if (raw.includes(PRODUCTION_REF)) {
    return { ok: false, code: "PRODUCTION_REF", ref: PRODUCTION_REF };
  }
  const found = new Set();
  const patterns = [
    /postgres\.([a-z0-9]{20})(?::|@)/i,
    /db\.([a-z0-9]{20})\.supabase\.co/i,
    /https?:\/\/([a-z0-9]{20})\.supabase\.co/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) found.add(match[1].toLowerCase());
  }
  if (found.size !== 1) {
    return { ok: false, code: "REF_UNRESOLVED", ref: null };
  }
  const ref = [...found][0];
  if (ref !== STAGING_REF) {
    return { ok: false, code: "WRONG_PROJECT", ref };
  }
  return { ok: true, code: "STAGING", ref };
}

export function applyAuthorization(env, argv) {
  const flagged = argv.includes(APPLY_FLAG);
  const confirmed = env[APPLY_ENV] === STAGING_REF;
  return flagged && confirmed;
}

function countWhere(plan, key) {
  return plan.filter((row) => row[key]).length;
}

function modeCounts(plan) {
  const counts = {};
  for (const row of plan) counts[row.execution] = (counts[row.execution] ?? 0) + 1;
  return counts;
}

export function dryRunReport() {
  const { files, plan, backwards, bundle } = loadMigrationPlan();
  const modes = modeCounts(plan);
  const lines = [
    "Floor King RC1 staging dry-run",
    "Database contacted: no",
    `Required project ref: ${STAGING_REF}`,
    `Blocked project ref: ${PRODUCTION_REF}`,
    `Migration files: ${files.length}`,
    `First file: ${files[0]}`,
    `Last file: ${files[files.length - 1]}`,
    `Filename order backwards: ${backwards.length}`,
    `Bundle sha256: ${bundle}`,
    "Would apply on an empty staging database:",
    ...files.map((name, index) => `  ${String(index + 1).padStart(3, "0")} ${name}`),
    "Execution modes:",
    ...Object.entries(modes).map(([mode, count]) => `  ${mode}: ${count}`),
    `Extensions named in SQL: ${countWhere(plan, "extension")} files (pg_trgm, btree_gist)`,
    `Enum ADD VALUE files: ${plan.filter((row) => row.enumAdd).map((row) => row.filename).join(", ")}`,
    `Storage bucket inserts: ${plan.filter((row) => row.storageBucket).map((row) => row.filename).join(", ")}`,
    `Storage object policies: ${countWhere(plan, "storagePolicy")} files`,
    `auth.users references: ${countWhere(plan, "authUsers")} files`,
    `Files containing DELETE or TRUNCATE: ${countWhere(plan, "dataDelete")}`,
    `Files containing DROP TABLE: ${countWhere(plan, "dropTable")}`,
    `Estimate-question updates (no-op when those ids are absent): ${countWhere(plan, "questionUpdate")} files`,
    "Apply is not authorized by this command.",
  ];
  return lines.join("\n");
}

function databaseUrl(env) {
  return env.STAGING_DATABASE_URL || env.SUPABASE_DB_URL || "";
}

function refuse(message) {
  console.error(message);
  process.exit(2);
}

function requireStagingUrl(env) {
  const verdict = projectRefFromDatabaseUrl(databaseUrl(env));
  if (!verdict.ok) {
    refuse(
      `Refusing to connect (${verdict.code}). STAGING_DATABASE_URL must identify ${STAGING_REF} and must not contain ${PRODUCTION_REF}.`,
    );
  }
  return verdict.ref;
}

function psql(args, url) {
  const result = spawnSync("psql", [...args], {
    env: { ...process.env, PGDATABASE: undefined },
    encoding: "utf8",
  });
  if (result.error) {
    refuse(`psql could not be started: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr || "");
    process.stdout.write(result.stdout || "");
    process.exit(result.status || 1);
  }
  return result.stdout || "";
}

function psqlQuery(url, sql) {
  return psql(["-d", url, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql], url);
}

const INVENTORY_TABLE = `
create table if not exists public.floor_king_migration_inventory (
  filename text primary key,
  sha256 text not null,
  applied_at timestamptz not null default now()
);
comment on table public.floor_king_migration_inventory is
  'Applied by scripts/staging-migrate.mjs. This is not supabase_migrations.schema_migrations.';
`;

function classifyDatabase(url) {
  const sentinelSql = SENTINELS.map(
    (name) => `to_regclass('${name}') is not null as ${name.split(".")[1]}`,
  ).join(", ");
  const raw = psqlQuery(
    url,
    `select ${sentinelSql}, to_regclass('public.floor_king_migration_inventory') is not null as inventory, to_regclass('supabase_migrations.schema_migrations') is not null as cli_history;`,
  ).trim();
  const parts = raw.split("|");
  const present = {};
  SENTINELS.forEach((name, index) => {
    present[name] = parts[index] === "t";
  });
  const inventory = parts[SENTINELS.length] === "t";
  const cliHistory = parts[SENTINELS.length + 1] === "t";
  const anySentinel = Object.values(present).some(Boolean);
  let state = "partial-untracked";
  if (!anySentinel && !inventory) state = "empty";
  else if (inventory) state = "inventory";
  return { state, present, inventory, cliHistory };
}

function recordedMigrations(url) {
  const raw = psqlQuery(
    url,
    "select filename || ' ' || sha256 from public.floor_king_migration_inventory order by filename;",
  );
  const rows = new Map();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const space = trimmed.indexOf(" ");
    rows.set(trimmed.slice(0, space), trimmed.slice(space + 1));
  }
  return rows;
}

function applyFile(url, row) {
  const path = join(MIGRATION_DIR, row.filename);
  const wrap = row.execution === "single-transaction" ? ["-1"] : [];
  psql(["-d", url, "-v", "ON_ERROR_STOP=1", ...wrap, "-f", path], url);
  const escapedName = row.filename.replaceAll("'", "''");
  const escapedHash = row.sha256.replaceAll("'", "''");
  psqlQuery(
    url,
    `insert into public.floor_king_migration_inventory (filename, sha256) values ('${escapedName}', '${escapedHash}');`,
  );
}

function commandApply(env, argv) {
  const ref = requireStagingUrl(env);
  if (!applyAuthorization(env, argv)) {
    refuse(
      `Refusing to apply. Pass ${APPLY_FLAG} and set ${APPLY_ENV}=${STAGING_REF}. Project ref ${ref} was recognized, and no file was executed.`,
    );
  }
  const { plan } = loadMigrationPlan();
  const classified = classifyDatabase(databaseUrl(env));
  console.log(`Project ref: ${ref}`);
  console.log(`Database state: ${classified.state}`);
  console.log(`CLI migration table present (ignored): ${classified.cliHistory}`);
  if (classified.state === "partial-untracked") {
    refuse(
      "Refusing to apply. Schema objects exist and floor_king_migration_inventory does not. SQL Editor history cannot be reconstructed. Use a new empty staging database.",
    );
  }
  if (classified.state === "empty") {
    psql(["-d", databaseUrl(env), "-v", "ON_ERROR_STOP=1", "-c", INVENTORY_TABLE], databaseUrl(env));
  }
  const recorded = recordedMigrations(databaseUrl(env));
  const recordedNames = new Set(recorded.keys());
  for (let index = 0; index < plan.length; index += 1) {
    const row = plan[index];
    const seen = recorded.get(row.filename);
    if (seen && seen !== row.sha256) {
      refuse(`Refusing to apply. ${row.filename} was recorded with a different sha256.`);
    }
    if (!seen) {
      const laterRecorded = plan.slice(index + 1).some((next) => recordedNames.has(next.filename));
      if (laterRecorded) {
        refuse(`Refusing to apply. ${row.filename} is missing while a later file is already recorded.`);
      }
    }
  }
  let applied = 0;
  let skipped = 0;
  for (const row of plan) {
    if (recorded.get(row.filename) === row.sha256) {
      skipped += 1;
      continue;
    }
    console.log(`Applying ${row.filename} (${row.execution})`);
    applyFile(databaseUrl(env), row);
    applied += 1;
  }
  console.log(`Applied: ${applied}`);
  console.log(`Skipped unchanged: ${skipped}`);
}

function commandInventory(env) {
  const ref = requireStagingUrl(env);
  const classified = classifyDatabase(databaseUrl(env));
  console.log(`Project ref: ${ref}`);
  console.log(`Database state: ${classified.state}`);
  console.log(`CLI migration table present (ignored): ${classified.cliHistory}`);
  for (const [name, yes] of Object.entries(classified.present)) {
    console.log(`${name}: ${yes ? "present" : "absent"}`);
  }
  if (classified.inventory) {
    const recorded = recordedMigrations(databaseUrl(env));
    console.log(`Inventory rows: ${recorded.size}`);
  } else {
    console.log("Inventory rows: 0");
  }
  console.log("No migration file was executed.");
}

function commandProve(env, argv) {
  const ref = requireStagingUrl(env);
  if (!applyAuthorization(env, argv)) {
    refuse(
      `Refusing to run database tests. Pass ${APPLY_FLAG} and set ${APPLY_ENV}=${STAGING_REF}.`,
    );
  }
  const sql = readFileSync(PROVE_SQL, "utf8");
  if (!/rollback\s*;\s*$/i.test(sql.trim())) {
    refuse("Refusing to run database tests. The test file must end with ROLLBACK.");
  }
  console.log(`Project ref: ${ref}`);
  console.log("Running RC1 transaction tests. The script ends with ROLLBACK.");
  psql(
    ["-d", databaseUrl(env), "-v", "ON_ERROR_STOP=1", "-f", PROVE_SQL],
    databaseUrl(env),
  );
}

function commandCheckGates(env, argv) {
  const verdict = projectRefFromDatabaseUrl(databaseUrl(env));
  const authorized = verdict.ok && applyAuthorization(env, argv);
  console.log(`ref: ${verdict.ref ?? "none"}`);
  console.log(`gate: ${verdict.code}`);
  console.log(`apply_authorized: ${authorized ? "yes" : "no"}`);
  console.log("connect: no");
  if (!verdict.ok || (argv.includes("apply") && !authorized)) process.exitCode = 2;
}

const command = process.argv[2] || "dry-run";
const argv = process.argv.slice(3);
function invokedAsCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

const invokedDirectly = invokedAsCli();

if (invokedDirectly) {
  if (command === "dry-run") {
    console.log(dryRunReport());
  } else if (command === "check-gates") {
    commandCheckGates(process.env, argv);
  } else if (command === "inventory") {
    commandInventory(process.env);
  } else if (command === "apply") {
    commandApply(process.env, argv);
  } else if (command === "prove") {
    commandProve(process.env, argv);
  } else {
    refuse(
      "Usage: node scripts/staging-migrate.mjs <dry-run|check-gates|inventory|apply|prove>",
    );
  }
}
