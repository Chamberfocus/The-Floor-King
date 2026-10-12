#!/usr/bin/env node
/**
 * Staging migration gate for Floor King RC1.
 *
 * dry-run and check-gates never open a database connection.
 * inventory, apply, and prove connect only after the URL names the direct
 * staging host or the staging session pooler. They then require the connected
 * server address to match public DNS for the direct staging host and to differ
 * from the production host.
 * They do not read .env.local.
 *
 * supabase_migrations.schema_migrations is not the apply history.
 * SQL Editor runs are not the apply history. The only resume record is
 * public.floor_king_migration_inventory, written by `apply`.
 * A row left in status "applying" blocks resume.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isIP } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const STAGING_REF = "lsrapxmkspocxeeakkcx";
export const PRODUCTION_REF = "ayqcaloqsklvskkudvbs";
export const STAGING_HOST = `db.${STAGING_REF}.supabase.co`;
export const PRODUCTION_HOST = `db.${PRODUCTION_REF}.supabase.co`;
const POOLER_HOST_RE = /^[a-z0-9-]+\.pooler\.supabase\.com$/;
const SSL_ROOT = join(dirname(fileURLToPath(import.meta.url)), "staging", "supabase-root-2021.crt");
const APPLY_FLAG = "--authorize-staging-apply";
const APPLY_ENV = "FLOOR_KING_STAGING_APPLY";
const FILE_RE = /^[0-9]{4}_[a-z0-9_]+\.sql$/;
const HASH_RE = /^[a-f0-9]{64}$/;

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

const PROBE_SQL =
  "select coalesce(inet_server_addr()::text, '') || '|' || coalesce((select system_identifier::text from pg_control_system()), '');";

export function listMigrationFiles() {
  return readdirSync(MIGRATION_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function analyzeMigration(filename, sql) {
  const hasBegin = /^\s*begin\s*;/im.test(sql);
  const hasCommit = /^\s*commit\s*;/im.test(sql);
  const enumAdd = /alter\s+type\s+[\w."]+\s+add\s+value/i.test(sql);
  let execution = "single-transaction";
  if (hasBegin !== hasCommit) execution = "unsafe-transaction";
  else if (hasBegin && hasCommit) execution = "file-managed";
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

export function normalizeIp(value) {
  if (value == null) return null;
  let raw = String(value).trim().replace(/^"(.*)"$/, "$1").replace(/%.*$/, "").replace(/\/\d+$/, "");
  if (raw.startsWith("[") && raw.endsWith("]")) raw = raw.slice(1, -1);
  const mapped = raw.toLowerCase().startsWith("::ffff:") ? raw.slice(7) : null;
  if (mapped && isIP(mapped) === 4) return mapped;
  if (isIP(raw) === 4) return raw;
  if (isIP(raw) !== 6) return null;
  const halves = raw.split("::");
  if (halves.length > 2) return null;
  if (halves.length === 1) {
    const parts = raw.split(":");
    if (parts.length !== 8) return null;
    return parts.map((part) => part.padStart(4, "0").toLowerCase()).join(":");
  }
  const headParts = halves[0] ? halves[0].split(":") : [];
  const tailParts = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0) return null;
  const parts = [...headParts, ...Array(missing).fill("0"), ...tailParts];
  if (parts.length !== 8) return null;
  return parts.map((part) => part.padStart(4, "0").toLowerCase()).join(":");
}

export function parseStagingTarget(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return { ok: false, code: "URL_MISSING", ref: null };
  if (raw.includes(PRODUCTION_REF)) {
    return { ok: false, code: "PRODUCTION_REF", ref: PRODUCTION_REF };
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, code: "URL_UNPARSEABLE", ref: null };
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    return { ok: false, code: "URL_UNPARSEABLE", ref: null };
  }
  const host = parsed.hostname.toLowerCase();
  const port = parsed.port === "" ? "5432" : parsed.port;
  if (port !== "5432") return { ok: false, code: "PORT_NOT_DIRECT", ref: null };
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (database !== "postgres") return { ok: false, code: "DATABASE_NOT_POSTGRES", ref: null };
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  if (POOLER_HOST_RE.test(host)) {
    if (user !== `postgres.${STAGING_REF}`) {
      return { ok: false, code: "POOLER_REFUSED", ref: null };
    }
    return {
      ok: true,
      code: "STAGING",
      ref: STAGING_REF,
      user,
      password,
      host,
      port,
      database,
      via: "pooler",
    };
  }
  if (host !== STAGING_HOST) return { ok: false, code: "WRONG_PROJECT", ref: null };
  if (user !== "postgres" && user !== `postgres.${STAGING_REF}`) {
    return { ok: false, code: "USER_NOT_STAGING", ref: null };
  }
  return {
    ok: true,
    code: "STAGING",
    ref: STAGING_REF,
    user,
    password,
    host: STAGING_HOST,
    port,
    database,
    via: "direct",
  };
}

export function projectRefFromDatabaseUrl(url) {
  const target = parseStagingTarget(url);
  return { ok: target.ok, code: target.code, ref: target.ref };
}

export function dnsSetsAreSafe(stagingAddrs, productionAddrs) {
  const staging = uniqueIps(stagingAddrs);
  const production = uniqueIps(productionAddrs);
  if (staging.length === 0) return { ok: false, code: "STAGING_DNS_EMPTY" };
  if (production.length === 0) return { ok: false, code: "PRODUCTION_DNS_EMPTY" };
  if (staging.some((addr) => production.includes(addr))) {
    return { ok: false, code: "DNS_OVERLAP" };
  }
  return { ok: true, code: "DNS_DISTINCT", staging, production };
}

export function serverIdentityVerdict(serverAddr, stagingAddrs, productionAddrs) {
  const sets = dnsSetsAreSafe(stagingAddrs, productionAddrs);
  if (!sets.ok) return sets;
  const server = normalizeIp(serverAddr);
  if (!server) return { ok: false, code: "SERVER_NOT_STAGING" };
  if (sets.production.includes(server)) return { ok: false, code: "SERVER_IS_PRODUCTION" };
  if (!sets.staging.includes(server)) return { ok: false, code: "SERVER_NOT_STAGING" };
  return { ok: true, code: "SERVER_IS_STAGING", server };
}

function uniqueIps(values) {
  const found = [];
  for (const value of values || []) {
    const ip = normalizeIp(value);
    if (ip && !found.includes(ip)) found.push(ip);
  }
  return found;
}

export function decideResume(recorded, plan) {
  for (const [filename, row] of recorded.entries()) {
    if (row.status === "applying") return { ok: false, code: "INTERRUPTED", filename };
    if (row.status !== "applied") return { ok: false, code: "UNKNOWN_STATUS", filename };
  }
  for (let index = 0; index < plan.length; index += 1) {
    const row = plan[index];
    const seen = recorded.get(row.filename);
    if (seen && seen.sha256 !== row.sha256) {
      return { ok: false, code: "HASH_MISMATCH", filename: row.filename };
    }
    if (!seen) {
      const later = plan.slice(index + 1).some((next) => recorded.has(next.filename));
      if (later) return { ok: false, code: "GAP", filename: row.filename };
    }
  }
  return { ok: true, code: "READY" };
}

export function executeApplyPlan(plan, recorded, hooks) {
  const gate = decideResume(recorded, plan);
  if (!gate.ok) return { ok: false, code: gate.code, filename: gate.filename, actions: [] };
  const actions = [];
  for (const row of plan) {
    if (recorded.get(row.filename)?.status === "applied") {
      actions.push({ type: "skip", filename: row.filename });
      continue;
    }
    hooks.markApplying(row);
    actions.push({ type: "mark-applying", filename: row.filename });
    const result = hooks.runFile(row);
    if (!result.ok) {
      if (row.execution === "single-transaction") {
        hooks.clearApplying(row);
        actions.push({ type: "clear-applying", filename: row.filename });
      }
      actions.push({ type: "stop", filename: row.filename });
      return { ok: false, code: "SQL_FAILED", filename: row.filename, actions };
    }
    hooks.markApplied(row);
    recorded.set(row.filename, { sha256: row.sha256, status: "applied" });
    actions.push({ type: "mark-applied", filename: row.filename });
  }
  return { ok: true, code: "APPLIED", actions };
}

export function inventoryWriteSql(filename, hash, status) {
  if (!FILE_RE.test(filename) || !HASH_RE.test(hash)) {
    throw new Error("REFUSING_SQL_TOKEN");
  }
  if (status === "applying") {
    return `insert into public.floor_king_migration_inventory (filename, sha256, status) values ('${filename}', '${hash}', 'applying');`;
  }
  if (status === "applied") {
    return `with upd as (update public.floor_king_migration_inventory set status = 'applied', applied_at = now() where filename = '${filename}' and sha256 = '${hash}' and status = 'applying' returning filename) select count(*)::text from upd;`;
  }
  throw new Error("REFUSING_SQL_TOKEN");
}

export function inventoryClearSql(filename) {
  if (!FILE_RE.test(filename)) throw new Error("REFUSING_SQL_TOKEN");
  return `delete from public.floor_king_migration_inventory where filename = '${filename}' and status = 'applying';`;
}

export function scrubSecrets(text, secrets) {
  let out = String(text ?? "");
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.split(secret).join("***");
  }
  return out;
}

export function connectionEnv(baseEnv, target, hostAddr) {
  const env = {};
  for (const [key, value] of Object.entries(baseEnv || {})) {
    if (key.startsWith("PG")) continue;
    if (key === "STAGING_DATABASE_URL" || key === "SUPABASE_DB_URL") continue;
    env[key] = value;
  }
  if (target.via === "pooler") {
    env.PGHOST = target.host;
    env.PGSSLROOTCERT = SSL_ROOT;
  } else {
    env.PGHOST = STAGING_HOST;
    env.PGHOSTADDR = hostAddr;
  }
  env.PGPORT = "5432";
  env.PGUSER = target.user;
  env.PGPASSWORD = target.password;
  env.PGDATABASE = "postgres";
  env.PGSSLMODE = "verify-full";
  env.PGOPTIONS = "-c statement_timeout=0";
  env.PGAPPNAME = "floor-king-staging-migrate";
  return env;
}

export function psqlArgv(extraArgs) {
  return ["-X", "-v", "ON_ERROR_STOP=1", ...extraArgs];
}

export function applyAuthorization(env, argv) {
  const flagged = argv.includes(APPLY_FLAG);
  const confirmed = env[APPLY_ENV] === STAGING_REF;
  return flagged && confirmed;
}

export function proveSqlAllowed(sql) {
  const text = String(sql ?? "");
  if (!/rollback\s*;\s*$/i.test(text.trim())) return { ok: false, code: "ROLLBACK_MISSING" };
  if (!text.includes("floor_king_database_identity")) return { ok: false, code: "IDENTITY_GUARD_MISSING" };
  if (!text.includes(STAGING_REF) || !text.includes("refusing tests on the production project")) {
    return { ok: false, code: "PRODUCTION_GUARD_MISSING" };
  }
  if (/\bcommit\s*;/i.test(text)) return { ok: false, code: "COMMIT_PRESENT" };
  return { ok: true, code: "PROVE_SQL_OK" };
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

function requireStagingTarget(env) {
  const target = parseStagingTarget(databaseUrl(env));
  if (!target.ok) {
    refuse(
      `Refusing to connect (${target.code}). The URL must be ${STAGING_HOST} or the staging session pooler on port 5432, and must not contain ${PRODUCTION_REF}.`,
    );
  }
  return target;
}

function dohLookup(name) {
  const addresses = [];
  for (const type of ["A", "AAAA"]) {
    const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "const res = await fetch(process.argv[1], { headers: { accept: 'application/dns-json' } }); if (!res.ok) process.exit(1); process.stdout.write(await res.text());",
        url,
      ],
      { encoding: "utf8" },
    );
    if (result.status !== 0) return { ok: false, addresses: [] };
    try {
      const body = JSON.parse(result.stdout);
      for (const answer of body.Answer || []) {
        if ((answer.type === 1 || answer.type === 28) && answer.data) addresses.push(answer.data);
      }
    } catch {
      return { ok: false, addresses: [] };
    }
  }
  return { ok: addresses.length > 0, addresses };
}

function isConnectFailure(result) {
  if ((result.stdout || "").trim()) return false;
  return /could not translate host name|could not connect to server|Temporary failure in name resolution|Name or service not known|timeout expired/i.test(
    result.stderr || "",
  );
}

function psql(extraArgs, env, secrets, attempt = 0) {
  const result = spawnSync("psql", psqlArgv(extraArgs), {
    env,
    encoding: "utf8",
  });
  const stdout = scrubSecrets(result.stdout || "", secrets);
  const stderr = scrubSecrets(result.stderr || "", secrets);
  const shaped = result.error
    ? { status: 1, stdout, stderr: scrubSecrets(result.error.message, secrets) }
    : { status: result.status === 0 ? 0 : result.status || 1, stdout, stderr };
  if (shaped.status !== 0 && isConnectFailure(shaped) && attempt < 5) {
    spawnSync("sleep", [String(2 ** attempt)]);
    return psql(extraArgs, env, secrets, attempt + 1);
  }
  return shaped;
}

function writeResult(result) {
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.stdout) process.stdout.write(result.stdout);
}

function psqlQuery(session, sql) {
  const result = psql(
    ["-t", "-A", "-c", sql],
    connectionEnv(process.env, session.target, session.hostAddr),
    [session.target.password],
  );
  if (result.status !== 0) {
    writeResult(result);
    process.exit(result.status || 1);
  }
  return result.stdout || "";
}

function openStagingConnection(env) {
  const target = requireStagingTarget(env);
  const stagingDns = dohLookup(STAGING_HOST);
  const productionDns = dohLookup(PRODUCTION_HOST);
  if (!stagingDns.ok || !productionDns.ok) {
    refuse("Refusing to connect (DNS_LOOKUP_FAILED). Public DNS for the staging and production hosts must both resolve. No migration file was executed.");
  }
  const sets = dnsSetsAreSafe(stagingDns.addresses, productionDns.addresses);
  if (!sets.ok) {
    refuse(`Refusing to connect (${sets.code}). Staging and production public addresses must both resolve and must not overlap. No migration file was executed.`);
  }
  if (target.via === "pooler") {
    const proved = proveServer(connectionEnv(process.env, target, null), target, stagingDns, productionDns);
    if (!proved.ok) {
      if (proved.probe) writeResult(proved.probe);
      refuse(
        `Refusing to connect (CONNECT_FAILED). The session pooler did not accept a connection whose server address matches ${STAGING_HOST}. No migration file was executed.`,
      );
    }
    return { target, hostAddr: null, serverAddr: proved.serverAddr, systemId: proved.systemId };
  }
  let last = null;
  for (const hostAddr of sets.staging) {
    const proved = proveServer(connectionEnv(process.env, target, hostAddr), target, stagingDns, productionDns);
    if (!proved.ok) {
      last = proved.probe;
      continue;
    }
    return { target, hostAddr, serverAddr: proved.serverAddr, systemId: proved.systemId };
  }
  if (last) writeResult(last);
  refuse(`Refusing to connect (CONNECT_FAILED). No public address of ${STAGING_HOST} accepted a connection. No migration file was executed.`);
}

function proveServer(envForAddr, target, stagingDns, productionDns) {
  const probe = psql(["-t", "-A", "-c", PROBE_SQL], envForAddr, [target.password]);
  if (probe.status !== 0) return { ok: false, probe };
  const [serverAddr, systemId] = probe.stdout.trim().split("|");
  const verdict = serverIdentityVerdict(serverAddr, stagingDns.addresses, productionDns.addresses);
  if (!verdict.ok) {
    refuse(
      `Refusing to continue (${verdict.code}). The connected server address does not match public DNS for ${STAGING_HOST}. No migration file was executed.`,
    );
  }
  if (!/^\d+$/.test(systemId || "")) {
    refuse("Refusing to continue (SYSTEM_ID_MISSING). No migration file was executed.");
  }
  return { ok: true, serverAddr: verdict.server, systemId };
}

const SEAL_AND_INVENTORY = (systemId, serverAddr) => `
create table public.floor_king_database_identity (
  id int primary key check (id = 1),
  project_ref text not null check (project_ref = '${STAGING_REF}'),
  system_identifier text not null,
  server_addr text not null,
  sealed_at timestamptz not null default now()
);
insert into public.floor_king_database_identity (id, project_ref, system_identifier, server_addr)
values (1, '${STAGING_REF}', '${systemId}', '${serverAddr}');
create or replace function public.floor_king_identity_frozen()
returns trigger language plpgsql as $$
begin
  raise exception 'IDENTITY_FROZEN';
end $$;
create trigger floor_king_database_identity_frozen
  before update or delete on public.floor_king_database_identity
  for each row execute function public.floor_king_identity_frozen();
revoke all on public.floor_king_database_identity from public, anon;
create table public.floor_king_migration_inventory (
  filename text primary key,
  sha256 text not null,
  status text not null check (status in ('applying', 'applied')),
  applied_at timestamptz,
  check (status <> 'applied' or applied_at is not null)
);
comment on table public.floor_king_migration_inventory is
  'Applied by scripts/staging-migrate.mjs. This is not supabase_migrations.schema_migrations. status applying blocks resume.';
revoke all on public.floor_king_migration_inventory from public, anon;
`;

function classifyDatabase(session) {
  const sentinelSql = SENTINELS.map(
    (name) => `to_regclass('${name}') is not null as ${name.split(".")[1]}`,
  ).join(", ");
  const raw = psqlQuery(
    session,
    `select ${sentinelSql}, to_regclass('public.floor_king_migration_inventory') is not null, to_regclass('public.floor_king_database_identity') is not null, to_regclass('supabase_migrations.schema_migrations') is not null;`,
  ).trim();
  const parts = raw.split("|");
  const present = {};
  SENTINELS.forEach((name, index) => {
    present[name] = parts[index] === "t";
  });
  const inventory = parts[SENTINELS.length] === "t";
  const identity = parts[SENTINELS.length + 1] === "t";
  const cliHistory = parts[SENTINELS.length + 2] === "t";
  const anySentinel = Object.values(present).some(Boolean);
  let state = "partial-untracked";
  if (!anySentinel && !inventory && !identity) state = "empty";
  else if (inventory && identity) state = "inventory";
  return { state, present, inventory, identity, cliHistory };
}

function readSeal(session) {
  const raw = psqlQuery(
    session,
    "select project_ref || '|' || system_identifier from public.floor_king_database_identity where id = 1;",
  ).trim();
  const [projectRef, systemId] = raw.split("|");
  return { projectRef, systemId };
}

function assertSeal(session) {
  const seal = readSeal(session);
  if (seal.projectRef !== STAGING_REF || seal.systemId !== session.systemId) {
    refuse("Refusing to continue (IDENTITY_SEAL_MISMATCH). The database identity row does not match this server. No migration file was executed.");
  }
}

function recordedMigrations(session) {
  const raw = psqlQuery(
    session,
    "select filename || ' ' || sha256 || ' ' || status from public.floor_king_migration_inventory order by filename;",
  );
  const rows = new Map();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [filename, hash, status] = trimmed.split(" ");
    if (!FILE_RE.test(filename || "") || !HASH_RE.test(hash || "")) {
      refuse("Refusing to continue (INVENTORY_UNREADABLE). No migration file was executed.");
    }
    rows.set(filename, { sha256: hash, status });
  }
  return rows;
}

function sealEmptyDatabase(session) {
  if (!/^\d+$/.test(session.systemId) || !normalizeIp(session.serverAddr)) {
    refuse("Refusing to seal database identity. No migration file was executed.");
  }
  const result = psql(
    ["-1", "-c", SEAL_AND_INVENTORY(session.systemId, session.serverAddr)],
    connectionEnv(process.env, session.target, session.hostAddr),
    [session.target.password],
  );
  if (result.status !== 0) {
    writeResult(result);
    refuse("Refusing to continue. The identity seal was not created. No migration file was executed.");
  }
}

function commandApply(env, argv) {
  const target = requireStagingTarget(env);
  if (!applyAuthorization(env, argv)) {
    refuse(
      `Refusing to apply. Pass ${APPLY_FLAG} and set ${APPLY_ENV}=${STAGING_REF}. The URL named ${target.ref}, and no file was executed.`,
    );
  }
  const { plan } = loadMigrationPlan();
  if (plan.some((row) => row.execution === "unsafe-transaction")) {
    refuse("Refusing to apply. A migration file has an unmatched BEGIN or COMMIT. No file was executed.");
  }
  const session = openStagingConnection(env);
  const classified = classifyDatabase(session);
  console.log(`Project ref: ${STAGING_REF}`);
  console.log(`Server identity: SERVER_IS_STAGING`);
  console.log(`Database state: ${classified.state}`);
  console.log(`CLI migration table present (ignored): ${classified.cliHistory}`);
  if (classified.state === "partial-untracked") {
    refuse(
      "Refusing to apply. Schema objects exist without both the identity seal and floor_king_migration_inventory. SQL Editor history cannot be reconstructed. Use a new empty staging database.",
    );
  }
  if (classified.state === "empty") sealEmptyDatabase(session);
  else assertSeal(session);
  const recorded = recordedMigrations(session);
  const outcome = executeApplyPlan(plan, recorded, {
    markApplying(row) {
      psqlQuery(session, inventoryWriteSql(row.filename, row.sha256, "applying"));
    },
    runFile(row) {
      const path = join(MIGRATION_DIR, row.filename);
      const wrap = row.execution === "single-transaction" ? ["-1"] : [];
      const result = psql(
        [...wrap, "-f", path],
        connectionEnv(process.env, session.target, session.hostAddr),
        [session.target.password],
      );
      if (result.status !== 0) {
        writeResult(result);
        return { ok: false };
      }
      return { ok: true };
    },
    clearApplying(row) {
      const result = psql(
        ["-c", inventoryClearSql(row.filename)],
        connectionEnv(process.env, session.target, session.hostAddr),
        [session.target.password],
      );
      if (result.status !== 0) writeResult(result);
    },
    markApplied(row) {
      const count = psqlQuery(session, inventoryWriteSql(row.filename, row.sha256, "applied")).trim();
      if (count !== "1") {
        refuse(`Refusing to continue. ${row.filename} was not recorded as applied.`);
      }
    },
  });
  if (!outcome.ok) {
    if (outcome.code === "SQL_FAILED") {
      const kept = outcome.actions.some((action) => action.type === "clear-applying")
        ? "psql -1 rolls a single-transaction file back. The runner attempted to clear its applying row."
        : "The file may have committed its own statements. Its applying mark blocks a later resume.";
      console.error(`Refusing to continue. ${outcome.filename} failed and was not recorded as applied. ${kept}`);
      process.exit(1);
    }
    const reason = {
      INTERRUPTED: `${outcome.filename} is marked applying. A previous run stopped before it was recorded as applied. A file with its own BEGIN and COMMIT may already be partly committed. Use a new empty staging database.`,
      HASH_MISMATCH: `${outcome.filename} was recorded with a different sha256.`,
      GAP: `${outcome.filename} is missing while a later file is already recorded.`,
      UNKNOWN_STATUS: `${outcome.filename} has an inventory status this runner does not resume.`,
    }[outcome.code] || outcome.code;
    refuse(`Refusing to apply. ${reason} No file was executed.`);
  }
  const applied = outcome.actions.filter((action) => action.type === "mark-applied").length;
  const skipped = outcome.actions.filter((action) => action.type === "skip").length;
  console.log(`Applied: ${applied}`);
  console.log(`Skipped unchanged: ${skipped}`);
}

function commandInventory(env) {
  const session = openStagingConnection(env);
  const classified = classifyDatabase(session);
  console.log(`Project ref: ${STAGING_REF}`);
  console.log("Server identity: SERVER_IS_STAGING");
  console.log(`Database state: ${classified.state}`);
  console.log(`CLI migration table present (ignored): ${classified.cliHistory}`);
  for (const [name, yes] of Object.entries(classified.present)) {
    console.log(`${name}: ${yes ? "present" : "absent"}`);
  }
  if (classified.state === "inventory") {
    assertSeal(session);
    const recorded = recordedMigrations(session);
    const applying = [...recorded.entries()].filter(([, row]) => row.status === "applying");
    console.log(`Inventory rows: ${recorded.size}`);
    console.log(`Applying rows: ${applying.length}`);
  } else {
    console.log("Inventory rows: 0");
  }
  console.log("No migration file was executed.");
}

function commandProve(env, argv) {
  const target = requireStagingTarget(env);
  if (!applyAuthorization(env, argv)) {
    refuse(`Refusing to run database tests. Pass ${APPLY_FLAG} and set ${APPLY_ENV}=${STAGING_REF}.`);
  }
  const sql = readFileSync(PROVE_SQL, "utf8");
  const allowed = proveSqlAllowed(sql);
  if (!allowed.ok) {
    refuse(`Refusing to run database tests (${allowed.code}).`);
  }
  const session = openStagingConnection(env);
  const classified = classifyDatabase(session);
  if (classified.state !== "inventory") {
    refuse("Refusing to run database tests. The staging identity seal is not present. No test file was executed.");
  }
  assertSeal(session);
  console.log(`Project ref: ${STAGING_REF}`);
  console.log("Server identity: SERVER_IS_STAGING");
  console.log("Running RC1 transaction tests. The script ends with ROLLBACK.");
  const result = psql(
    ["-f", PROVE_SQL],
    connectionEnv(process.env, session.target, session.hostAddr),
    [target.password],
  );
  writeResult(result);
  if (result.status !== 0) process.exit(result.status || 1);
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

if (invokedAsCli()) {
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
