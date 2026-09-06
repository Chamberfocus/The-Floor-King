import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { PG_DUMP_LINUX_AMD64 } from "./constants";
import { validatePostgresDump } from "./dump-validate";
import { sha256Hex } from "./checksums";

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

export async function resolvePgDumpBinary(opts?: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  destDir?: string;
}): Promise<string> {
  const env = opts?.env ?? process.env;
  if (env.BACKUP_PG_DUMP_PATH) return env.BACKUP_PG_DUMP_PATH;
  const platform = opts?.platform ?? process.platform;
  const localVendor = join(process.cwd(), "vendor/pg_dump/linux-amd64/pg_dump");
  const { access } = await import("node:fs/promises");
  try {
    await access(localVendor);
    return localVendor;
  } catch {
    /* continue */
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
  connection: ReturnType<typeof parseDirectPostgresUrl>;
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
  child.stderr?.on("data", (c: Buffer) => {
    stderr += c.toString("utf8").slice(0, 2000);
  });

  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
  }, args.timeoutMs);

  try {
    if (!child.stdout) throw new Error("PG_DUMP_FAILED");
    await pipeline(child.stdout, gzip, out);
  } catch {
    child.kill("SIGTERM");
    throw new Error("PG_DUMP_FAILED");
  } finally {
    clearTimeout(timeout);
  }

  const exit = await new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
  });
  if (exit !== 0) {
    void stderr;
    try {
      await unlink(tmp);
    } catch {
      /* ignore */
    }
    throw new Error(args.schema === "auth" ? "AUTH_DUMP_FAILED" : "PG_DUMP_FAILED");
  }
  const bytes = await readFile(tmp);
  try {
    await unlink(tmp);
  } catch {
    /* ignore */
  }
  return bytes;
}

export async function dumpPostgresSchema(args: {
  databaseUrl: string;
  schema: "public" | "auth";
  binary?: string;
  timeoutMs?: number;
}): Promise<DumpResult> {
  const connection = assertDumpConnectionUrl(args.databaseUrl);
  const binary = args.binary ?? (await resolvePgDumpBinary());
  const bytes = await runPgDump({
    binary,
    connection,
    schema: args.schema,
    timeoutMs: args.timeoutMs ?? 180_000,
  });
  const check = validatePostgresDump(bytes);
  if (!check.ok) throw new Error(check.code);
  return {
    fileName: args.schema === "auth" ? "auth.sql.gz" : "public.sql.gz",
    bytes,
    sha256: sha256Hex(bytes),
    byteLength: bytes.length,
    schema: args.schema,
  };
}
