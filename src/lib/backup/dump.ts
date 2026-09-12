import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { setDefaultResultOrder } from "node:dns";
import { lookup } from "node:dns/promises";
import { PG_DUMP_LINUX_AMD64 } from "./constants";
import { validatePostgresDump } from "./dump-validate";
import { sha256Hex } from "./checksums";
import {
  dumpPoolerRegionCandidates,
  isRetryablePoolerFailure,
  sessionPoolerHost,
  sessionPoolerUser,
  supabaseProjectRefFromPublicUrl,
} from "./dump-target";

export type DumpResult = {
  fileName: string;
  bytes: Buffer;
  sha256: string;
  byteLength: number;
  schema: "public" | "auth";
};

function parseDirectPostgresUrl(url: string): {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  sslmode: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DB_URL_INVALID");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DB_URL_INVALID");
  }
  const port = parsed.port || "5432";
  if (port === "6543") {
    throw new Error("DB_URL_TRANSACTION_POOLER");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "") || "postgres");
  return {
    host: parsed.hostname,
    port,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    sslmode: parsed.searchParams.get("sslmode") || "require",
  };
}

export function assertDumpConnectionUrl(url: string): ReturnType<typeof parseDirectPostgresUrl> {
  return parseDirectPostgresUrl(url);
}

const PG_DUMP_CANDIDATES = [
  join(process.cwd(), "vendor/pg_dump/linux-amd64/pg_dump"),
  join("/var/task", "vendor/pg_dump/linux-amd64/pg_dump"),
];

export function classifyPgDumpFailure(
  stderr: string,
  spawnCode?: string,
  signal?: string | null,
  exitCode?: number | null,
): string {
  if (spawnCode === "ENOENT") return "PG_DUMP:missing_binary";
  if (signal && /^[A-Z][A-Z0-9_]{1,20}$/.test(signal)) return `PG_DUMP:${signal}`;
  if (spawnCode && /^[A-Za-z0-9_]{2,40}$/.test(spawnCode)) {
    return `PG_DUMP:${spawnCode}`;
  }
  if (exitCode === 126) return "PG_DUMP:not_executable";
  if (exitCode === 127) return "PG_DUMP:missing_binary";
  const s = stderr.toLowerCase();
  if (/exec format/.test(s)) return "PG_DUMP:exec_format";
  if (
    /could not connect|connection refused|connection timed out|no route to host|name or service not known|network is unreachable|could not translate host name|is the server running/.test(
      s,
    )
  ) {
    return "PG_DUMP:connection";
  }
  if (/timeout expired|canceling statement/.test(s)) return "PG_DUMP:timeout";
  if (/tenant or user not found/.test(s)) return "PG_DUMP:pooler_tenant";
  if (/password authentication|authentication failed|no password supplied/.test(s)) {
    return "PG_DUMP:auth";
  }
  if (/server version mismatch|aborting because of server version/.test(s)) {
    return "PG_DUMP:version_mismatch";
  }
  if (/\bssl\b|certificate/.test(s)) return "PG_DUMP:ssl";
  if (/too many connections|remaining connection slots/.test(s)) return "PG_DUMP:too_many_connections";
  if (/database ["'].*["'] does not exist/.test(s)) return "PG_DUMP:database_missing";
  if (typeof exitCode === "number" && exitCode !== 0) return `PG_DUMP:exit_${exitCode}:e${Math.min(stderr.length, 999)}`;
  return "PG_DUMP_FAILED";
}

export async function resolvePgDumpBinary(opts?: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  destDir?: string;
}): Promise<string> {
  const env = opts?.env ?? process.env;
  if (env.BACKUP_PG_DUMP_PATH) return env.BACKUP_PG_DUMP_PATH;
  const platform = opts?.platform ?? process.platform;
  const { access } = await import("node:fs/promises");
  for (const localVendor of PG_DUMP_CANDIDATES) {
    try {
      await access(localVendor);
      return localVendor;
    } catch {
      /* continue */
    }
  }
  if (platform !== "linux") {
    return "pg_dump";
  }
  const destDir = opts?.destDir ?? join(tmpdir(), "floor-king-backup");
  const dest = join(destDir, "pg_dump");
  try {
    const existing = await readFile(dest);
    if (sha256Hex(existing) === PG_DUMP_LINUX_AMD64.sha256) return dest;
  } catch {
    /* download */
  }
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const res = await fetchImpl(PG_DUMP_LINUX_AMD64.url);
  if (!res.ok) throw new Error("PG_DUMP_DOWNLOAD_FAILED");
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256Hex(buf) !== PG_DUMP_LINUX_AMD64.sha256) {
    throw new Error("PG_DUMP_HASH_MISMATCH");
  }
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf, { mode: 0o755 });
  await chmod(dest, 0o755);
  return dest;
}

async function runPgDump(args: {
  binary: string;
  connection: ReturnType<typeof parseDirectPostgresUrl> & { hostAddr: string };
  schema: "public" | "auth";
  timeoutMs: number;
}): Promise<Buffer> {
  const tmp = join(tmpdir(), `fk-dump-${args.schema}-${Date.now()}.sql.gz`);
  const gzip = createGzip({ level: 9 });
  const out = createWriteStream(tmp);

  const child = spawn(
    args.binary,
    [
      "--format=plain",
      "--no-owner",
      "--encoding=UTF8",
      `--schema=${args.schema}`,
      "--no-password",
    ],
    {
      env: {
        ...process.env,
        PGHOST: args.connection.host,
        PGHOSTADDR: args.connection.hostAddr,
        PGPORT: args.connection.port,
        PGUSER: args.connection.user,
        PGPASSWORD: args.connection.password,
        PGDATABASE: args.connection.database,
        PGSSLMODE: args.connection.sslmode,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stderr = "";
  let spawnCode: string | undefined;
  let weKilled = false;
  child.stderr?.on("data", (c: Buffer) => {
    stderr += c.toString("utf8").slice(0, 2000);
  });
  child.on("error", (err: NodeJS.ErrnoException) => {
    spawnCode = err.code;
  });

  const timeout = setTimeout(() => {
    weKilled = true;
    child.kill("SIGTERM");
  }, args.timeoutMs);

  try {
    if (!child.stdout) throw new Error("PG_DUMP_FAILED");
    await pipeline(child.stdout, gzip, out);
  } catch {
    if (child.exitCode == null && child.signalCode == null) {
      weKilled = true;
      child.kill("SIGTERM");
    }
  } finally {
    clearTimeout(timeout);
  }

  const closed = await new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal: signal ?? null }));
  });
  if (closed.code !== 0 || spawnCode) {
    try {
      await unlink(tmp);
    } catch {
      /* ignore */
    }
    if (args.schema === "auth") throw new Error("AUTH_DUMP_FAILED");
    throw new Error(
      classifyPgDumpFailure(
        stderr,
        spawnCode,
        weKilled ? null : closed.signal,
        closed.code,
      ),
    );
  }
  const bytes = await readFile(tmp);
  try {
    await unlink(tmp);
  } catch {
    /* ignore */
  }
  return bytes;
}

export async function resolveDumpHostIpv4(host: string): Promise<string> {
  setDefaultResultOrder("ipv4first");
  try {
    const result = await lookup(host, { family: 4, all: false });
    if (!result?.address) throw new Error("PG_DUMP:ipv4_required");
    return result.address;
  } catch (err) {
    if (err instanceof Error && err.message === "PG_DUMP:ipv4_required") throw err;
    throw new Error("PG_DUMP:ipv4_required");
  }
}

export async function dumpPostgresSchema(args: {
  databaseUrl: string;
  schema: "public" | "auth";
  binary?: string;
  timeoutMs?: number;
  publicSupabaseUrl?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<DumpResult> {
  const connection = assertDumpConnectionUrl(args.databaseUrl);
  const binary = args.binary ?? (await resolvePgDumpBinary({ env: args.env }));
  const timeoutMs = args.timeoutMs ?? 180_000;
  const env = args.env ?? process.env;

  const tryDump = async (
    conn: ReturnType<typeof parseDirectPostgresUrl> & { hostAddr: string },
  ): Promise<Buffer> =>
    runPgDump({
      binary,
      connection: conn,
      schema: args.schema,
      timeoutMs,
    });

  try {
    const hostAddr = await resolveDumpHostIpv4(connection.host);
    const bytes = await tryDump({ ...connection, hostAddr });
    return finishDump(args.schema, bytes);
  } catch (err) {
    const code = err instanceof Error ? err.message : "PG_DUMP_FAILED";
    if (code !== "PG_DUMP:ipv4_required") throw err;
  }

  const projectRef = supabaseProjectRefFromPublicUrl(
    args.publicSupabaseUrl ?? env.NEXT_PUBLIC_SUPABASE_URL,
  );
  if (!projectRef) throw new Error("PG_DUMP:ipv4_required");

  const user = sessionPoolerUser(connection.user, projectRef);
  let last: unknown = new Error("PG_DUMP:ipv4_required");
  for (const region of dumpPoolerRegionCandidates(env)) {
    let host: string;
    try {
      host = sessionPoolerHost(region);
    } catch (e) {
      last = e;
      continue;
    }
    let hostAddr: string;
    try {
      hostAddr = await resolveDumpHostIpv4(host);
    } catch (e) {
      last = e;
      continue;
    }
    try {
      const bytes = await tryDump({
        ...connection,
        host,
        hostAddr,
        user,
        port: "5432",
      });
      return finishDump(args.schema, bytes);
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : "";
      if (isRetryablePoolerFailure(msg)) continue;
      throw e;
    }
  }
  throw last instanceof Error ? last : new Error("PG_DUMP:ipv4_required");
}

function finishDump(schema: "public" | "auth", bytes: Buffer): DumpResult {
  const check = validatePostgresDump(bytes);
  if (!check.ok) throw new Error(check.code);
  return {
    fileName: schema === "auth" ? "auth.sql.gz" : "public.sql.gz",
    bytes,
    sha256: sha256Hex(bytes),
    byteLength: bytes.length,
    schema,
  };
}
