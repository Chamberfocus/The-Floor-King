/**
 * Floor King offsite backup & recovery — golden tests.
 * No production network, no secrets printed, no accounting flag writes.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  BACKUP_ROOT_FOLDER_ID,
  GOOGLE_BACKUP_SERVICE_ACCOUNT,
  MARKER_SYSTEM,
  RETAIN_DAILY_SUCCESS,
  RETAIN_WEEKLY_SUCCESS,
  VERCEL_OIDC_AUDIENCE,
  VERCEL_OIDC_ISSUER,
  VERCEL_OIDC_PRODUCTION_SUBJECT,
  googleWifAudience,
} from "@/lib/backup/constants";
import {
  assertProductionBackupOidcClaims,
  decodeJwtPayload,
  encodeTestJwt,
} from "@/lib/backup/jwt-claims";
import {
  authorizeBackupCronRequest,
  roleMayAccessBackupArtifacts,
  roleMayInvokeBackup,
  roleMayViewBackupHealth,
} from "@/lib/backup/authz";
import {
  buildGoogleExternalAccountConfig,
  driveTokenResponseHasSecrets,
  exchangeVercelOidcForDriveAccessToken,
  googleAuthUsesPermanentKey,
} from "@/lib/backup/google-auth";
import { planRetentionDeletes } from "@/lib/backup/drive-scope";
import { classifyBackupRoot } from "@/lib/backup/destination";
import {
  DriveApiError,
  extractGoogleErrorReason,
  isRetryableDriveStatus,
  isSafeBackupErrorCode,
} from "@/lib/backup/drive-error";
import { GoogleDriveClient } from "@/lib/backup/google-drive";
import { MemoryDrive } from "@/lib/backup/memory-drive";
import { validatePostgresDump } from "@/lib/backup/dump-validate";
import { assertDumpConnectionUrl, classifyPgDumpFailure } from "@/lib/backup/dump";
import {
  dumpPoolerRegionCandidates,
  isRetryablePoolerFailure,
  sessionPoolerHost,
  sessionPoolerUser,
  supabaseProjectRefFromPublicUrl,
} from "@/lib/backup/dump-target";
import { enumerateStorageObjects, storageBackupComplete } from "@/lib/backup/storage";
import { formatChecksumFile, sha256Hex, verifyChecksums } from "@/lib/backup/checksums";
import {
  assertManifestHasNoSecrets,
  createInProgressManifest,
  finalizeManifest,
  applyHealthUpdate,
  emptyHealth,
} from "@/lib/backup/manifest";
import { runBackup, gzipSqlDump, type BackupDeps } from "@/lib/backup/run";
import { validateRestorableBackup, RESTORE_ORDER } from "@/lib/backup/restore";
import { sanitizeBackupError } from "@/lib/backup/sanitize";
import { acquireBackupLock } from "@/lib/backup/lock";
import type { UserRole } from "@/lib/types";

const ROOT = process.cwd();

const VALID_SQL = `-- PostgreSQL database dump
SET statement_timeout = 0;
CREATE TABLE public.customers (
    id uuid NOT NULL,
    full_name text
);
COPY public.customers (id, full_name) FROM stdin;
\\.
-- PostgreSQL database dump complete
`;

function validDumpBytes() {
  return gzipSqlDump(VALID_SQL);
}

function dumpResult() {
  const bytes = validDumpBytes();
  return {
    fileName: "public.sql.gz" as const,
    bytes,
    sha256: sha256Hex(bytes),
    byteLength: bytes.length,
    schema: "public" as const,
  };
}

function prodJwt(over: Record<string, unknown> = {}) {
  return encodeTestJwt({
    iss: VERCEL_OIDC_ISSUER,
    aud: VERCEL_OIDC_AUDIENCE,
    sub: VERCEL_OIDC_PRODUCTION_SUBJECT,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...over,
  });
}

function makeDeps(
  over: Partial<BackupDeps> & {
    drive?: MemoryDrive;
    objects?: Map<string, Uint8Array>;
    clock?: { now: Date };
  } = {},
): {
  deps: BackupDeps;
  drive: MemoryDrive;
} {
  const { drive: driveOpt, objects: objectsOpt, clock: clockOpt, ...depOver } = over;
  const drive = driveOpt ?? new MemoryDrive();
  const objects =
    objectsOpt ??
    new Map<string, Uint8Array>([
      ["documents/customers/a/measure.pdf", Buffer.from("%PDF-1.4 sample")],
      ["documents/nested/path/photo.jpg", Buffer.from("jpeg")],
      ["job-files/wo/same-name.pdf", Buffer.from("job")],
      ["documents/elsewhere/same-name.pdf", Buffer.from("doc")],
      ["branding/logo.png", Buffer.from("png")],
      ["documents/empty.txt", Buffer.alloc(0)],
    ]);
  const clock = clockOpt ?? { now: new Date("2026-01-06T12:00:00.000Z") };
  const deps: BackupDeps = {
    now: () => clock.now,
    randomUuid: () => crypto.randomUUID(),
    getOidcToken: async () => prodJwt(),
    getDriveAccessToken: async () => "ya29.not-a-real-token",
    createDrive: () => drive,
    dumpPublic: async () => dumpResult(),
    listBuckets: async () => ["documents", "job-files", "branding"],
    listStoragePrefix: async (bucket, prefix) => {
      const out: Array<{
        name: string;
        id: string | null;
        metadata?: { size?: number; mimetype?: string } | null;
      }> = [];
      const seen = new Set<string>();
      for (const key of objects.keys()) {
        if (!key.startsWith(`${bucket}/`)) continue;
        const rest = key.slice(bucket.length + 1);
        if (prefix) {
          if (!rest.startsWith(`${prefix}/`)) continue;
        }
        const rel = prefix ? rest.slice(prefix.length + 1) : rest;
        const name = rel.split("/")[0];
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const isFile = rel === name;
        const bytes = objects.get(`${bucket}/${prefix ? `${prefix}/${name}` : name}`);
        out.push({
          name,
          id: isFile ? key : null,
          metadata: isFile ? { size: bytes?.byteLength ?? 0, mimetype: "application/octet-stream" } : null,
        });
      }
      return out;
    },
    downloadObject: async (bucket, path) => {
      const bytes = objects.get(`${bucket}/${path}`);
      if (!bytes) throw new Error("missing");
      return bytes;
    },
    gitSha: "deadbeef",
    deploymentId: "dpl_test",
    ...depOver,
  };
  return { deps, drive };
}

describe("backup OIDC / Google auth", () => {
  it("accepts the production subject and rejects preview/dev/wrong issuer/audience", () => {
    expect(() => assertProductionBackupOidcClaims(decodeJwtPayload(prodJwt()))).not.toThrow();
    expect(() =>
      assertProductionBackupOidcClaims(
        decodeJwtPayload(prodJwt({ sub: "owner:the-floor-king:project:floorking-crm:environment:preview" })),
      ),
    ).toThrow(/OIDC_SUBJECT_REJECTED/);
    expect(() =>
      assertProductionBackupOidcClaims(decodeJwtPayload(prodJwt({ iss: "https://oidc.vercel.com/other-team" }))),
    ).toThrow(/OIDC_ISSUER_REJECTED/);
    expect(() =>
      assertProductionBackupOidcClaims(decodeJwtPayload(prodJwt({ aud: "https://vercel.com/someone-else" }))),
    ).toThrow(/OIDC_AUDIENCE_REJECTED/);
  });

  it("does not require a permanent Google key and does not use an OIDC file path", () => {
    const cfg = buildGoogleExternalAccountConfig(async () => prodJwt());
    expect(cfg.type).toBe("external_account");
    expect(googleAuthUsesPermanentKey(cfg)).toBe(false);
    expect(JSON.stringify(cfg)).not.toMatch(/private_key/);
    expect(JSON.stringify(cfg)).not.toMatch(/credential_source/);
    expect(cfg.audience).toBe(googleWifAudience());
    expect(GOOGLE_BACKUP_SERVICE_ACCOUNT).toContain("@floor-king-crm.iam.gserviceaccount.com");
  });

  it("exchanges OIDC via STS + impersonation without returning tokens in helper metadata", async () => {
    const calls: string[] = [];
    const token = await exchangeVercelOidcForDriveAccessToken({
      oidcToken: prodJwt(),
      fetchImpl: async (url, init) => {
        calls.push(url);
        expect(JSON.stringify(init.headers)).not.toMatch(/eyJ/);
        if (url.includes("sts.googleapis.com")) {
          return { ok: true, status: 200, json: async () => ({ access_token: "sts-token" }) };
        }
        return { ok: true, status: 200, json: async () => ({ accessToken: "drive-token" }) };
      },
    });
    expect(token).toBe("drive-token");
    expect(calls.some((u) => u.includes("sts.googleapis.com"))).toBe(true);
    expect(calls.some((u) => u.includes("iamcredentials.googleapis.com"))).toBe(true);
  });

  it("rejects wrong-environment OIDC before STS", async () => {
    await expect(
      exchangeVercelOidcForDriveAccessToken({
        oidcToken: prodJwt({ sub: "owner:the-floor-king:project:floorking-crm:environment:development" }),
        fetchImpl: async () => {
          throw new Error("STS_SHOULD_NOT_RUN");
        },
      }),
    ).rejects.toThrow(/OIDC_SUBJECT_REJECTED/);
  });
});

describe("backup endpoint authorization", () => {
  it("fails closed without CRON_SECRET and rejects anonymous/wrong bearer", () => {
    expect(
      authorizeBackupCronRequest({ headers: { get: () => "Bearer x" } }, {}),
    ).toEqual({ ok: false, status: 401, code: "CRON_SECRET_MISSING" });
    expect(
      authorizeBackupCronRequest(
        { headers: { get: () => "Bearer nope" } },
        { CRON_SECRET: "secret", VERCEL_ENV: "production" },
      ),
    ).toEqual({ ok: false, status: 401, code: "CRON_UNAUTHORIZED" });
  });

  it("rejects preview/dev even with a valid cron secret", () => {
    expect(
      authorizeBackupCronRequest(
        { headers: { get: () => "Bearer secret" } },
        { CRON_SECRET: "secret", VERCEL_ENV: "preview" },
      ),
    ).toEqual({ ok: false, status: 403, code: "PRODUCTION_ONLY" });
  });

  it("accepts production cron bearer", () => {
    expect(
      authorizeBackupCronRequest(
        { headers: { get: () => "Bearer secret" } },
        { CRON_SECRET: "secret", VERCEL_ENV: "production" },
      ).ok,
    ).toBe(true);
  });

  it("ordinary CRM roles cannot invoke backup or read artifacts", () => {
    const blocked: UserRole[] = [
      "office",
      "sales_manager",
      "salesman",
      "scheduler",
      "crew",
      "warehouse",
      "customer",
    ];
    for (const role of blocked) {
      expect(roleMayInvokeBackup(role)).toBe(false);
      expect(roleMayAccessBackupArtifacts(role)).toBe(false);
    }
    expect(roleMayInvokeBackup("admin")).toBe(true);
    expect(roleMayViewBackupHealth("admin")).toBe(true);
    expect(roleMayViewBackupHealth("office")).toBe(false);
  });
});

describe("Drive root scoping & retention", () => {
  it("never plans deletion outside the backup root or of unrelated files", () => {
    const plan = planRetentionDeletes(
      [
        {
          id: "unrelated",
          lane: "daily",
          period: "2026-01-01",
          completedAt: "2026-01-01",
          status: "SUCCESS",
          systemMarker: null,
          underRoot: true,
        },
        {
          id: "outside",
          lane: "daily",
          period: "2026-01-01",
          completedAt: "2026-01-01",
          status: "SUCCESS",
          systemMarker: MARKER_SYSTEM,
          underRoot: false,
        },
      ],
      { currentRunFailed: false, inventoryComplete: true },
    );
    expect(plan.deleteIds).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(["UNRELATED_FILE", "OUTSIDE_ROOT"]);
  });

  it("keeps 7 daily and 4 weekly successes; protects newest and only-good; skips cleanup on failed current run or incomplete inventory", () => {
    const daily = Array.from({ length: 9 }, (_, i) => ({
      id: `d${i}`,
      lane: "daily" as const,
      period: `2026-01-${String(i + 1).padStart(2, "0")}`,
      completedAt: `2026-01-${String(i + 1).padStart(2, "0")}`,
      status: "SUCCESS" as const,
      systemMarker: MARKER_SYSTEM,
      underRoot: true,
    }));
    const weekly = Array.from({ length: 6 }, (_, i) => ({
      id: `w${i}`,
      lane: "weekly" as const,
      period: `2026-W0${i + 1}`,
      completedAt: `2026-W0${i + 1}`,
      status: "SUCCESS" as const,
      systemMarker: MARKER_SYSTEM,
      underRoot: true,
    }));
    const plan = planRetentionDeletes([...daily, ...weekly], {
      currentRunFailed: false,
      inventoryComplete: true,
    });
    expect(plan.keepIds).toContain("d8");
    expect(plan.deleteIds).toContain("d0");
    expect(plan.deleteIds.filter((id) => id.startsWith("d")).length).toBe(9 - RETAIN_DAILY_SUCCESS);
    expect(plan.deleteIds.filter((id) => id.startsWith("w")).length).toBe(6 - RETAIN_WEEKLY_SUCCESS);

    const only = planRetentionDeletes([daily[0]!], { currentRunFailed: false, inventoryComplete: true });
    expect(only.deleteIds).toEqual([]);
    expect(only.keepIds).toContain("d0");

    const failed = planRetentionDeletes(daily, { currentRunFailed: true, inventoryComplete: true });
    expect(failed.deleteIds).toEqual([]);

    const incomplete = planRetentionDeletes(daily, { currentRunFailed: false, inventoryComplete: false });
    expect(incomplete.deleteIds).toEqual([]);

    const inProgress = planRetentionDeletes(
      [{ ...daily[0]!, id: "ip", status: "IN_PROGRESS" }],
      { currentRunFailed: false, inventoryComplete: true },
    );
    expect(inProgress.deleteIds).toEqual([]);
  });

  it("MemoryDrive refuses to delete the root or unmarked files", async () => {
    const drive = new MemoryDrive();
    await expect(drive.deleteDescendant(BACKUP_ROOT_FOLDER_ID)).rejects.toThrow(/DRIVE_DELETE_ROOT_FORBIDDEN/);
    const outsider = drive.seedUnrelatedFile(BACKUP_ROOT_FOLDER_ID, "tax-returns.pdf");
    await expect(drive.deleteDescendant(outsider)).rejects.toThrow(/DRIVE_DELETE_UNRELATED_FORBIDDEN/);
    await expect(drive.uploadBytes("not-the-root", "x", new Uint8Array([1]), "text/plain")).rejects.toThrow(
      /DRIVE_OUTSIDE_ROOT/,
    );
  });
});

describe("database dump validation", () => {
  it("accepts a restorable gzip SQL dump and rejects empty/malformed dumps", () => {
    expect(validatePostgresDump(validDumpBytes()).ok).toBe(true);
    expect(validatePostgresDump(Buffer.from("nope")).ok).toBe(false);
    expect(validatePostgresDump(gzipSync(Buffer.from("-- PostgreSQL database dump\n-- PostgreSQL database dump complete\n"))).ok).toBe(false);
    expect(() => assertDumpConnectionUrl("postgresql://u:p@db.example.com:5432/postgres")).not.toThrow();
    expect(() => assertDumpConnectionUrl("postgresql://u:p@db.example.com:6543/postgres")).toThrow(
      /DB_URL_TRANSACTION_POOLER/,
    );
    expect(classifyPgDumpFailure("", "ENOENT")).toBe("PG_DUMP:missing_binary");
    expect(classifyPgDumpFailure("", "ENOEXEC")).toBe("PG_DUMP:ENOEXEC");
    expect(classifyPgDumpFailure("", undefined, "SIGSYS")).toBe("PG_DUMP:SIGSYS");
    expect(classifyPgDumpFailure("", undefined, null, 1)).toBe("PG_DUMP:exit_1:e0");
    expect(classifyPgDumpFailure("pg_dump: error: could not connect to server: Connection refused")).toBe(
      "PG_DUMP:connection",
    );
    expect(classifyPgDumpFailure("pg_dump: error: SSL connection has been closed unexpectedly")).toBe(
      "PG_DUMP:ssl",
    );
    expect(classifyPgDumpFailure("password authentication failed for user")).toBe("PG_DUMP:auth");
    expect(classifyPgDumpFailure("FATAL: Tenant or user not found")).toBe("PG_DUMP:pooler_tenant");
    expect(readFileSync(join(ROOT, "src/lib/backup/dump.ts"), "utf8")).toMatch(/ipv4first/);
    expect(readFileSync(join(ROOT, "src/lib/backup/dump.ts"), "utf8")).toMatch(/createGzip\(\{ level: 1 \}\)/);
    expect(supabaseProjectRefFromPublicUrl("https://abc123xyz789.supabase.co")).toBe("abc123xyz789");
    expect(sessionPoolerUser("postgres", "abc123xyz789")).toBe("postgres.abc123xyz789");
    expect(sessionPoolerUser("postgres.abc123xyz789", "abc123xyz789")).toBe("postgres.abc123xyz789");
    expect(sessionPoolerHost("us-east-2")).toBe("aws-0-us-east-2.pooler.supabase.com");
    expect(dumpPoolerRegionCandidates({})).toEqual(["us-east-1", "us-east-2"]);
    expect(isRetryablePoolerFailure("PG_DUMP:stall")).toBe(true);
    expect(isRetryablePoolerFailure("PG_DUMP:auth")).toBe(false);
  });
});

describe("storage enumeration", () => {
  it("walks nested paths, duplicate names, zero-byte files, and empty buckets", async () => {
    const listed = await enumerateStorageObjects(["documents", "empty-bucket"], async (bucket, prefix) => {
      if (bucket === "empty-bucket") return [];
      if (prefix === "") {
        return [
          { name: "a", id: null },
          { name: "zero.dat", id: "1", metadata: { size: 0 } },
        ];
      }
      if (prefix === "a") {
        return [
          { name: "file.pdf", id: "2", metadata: { size: 4, mimetype: "application/pdf" } },
          { name: "file.pdf", id: "2", metadata: { size: 4 } },
        ];
      }
      return [];
    });
    expect(listed.some((o) => o.path === "a/file.pdf")).toBe(true);
    expect(listed.some((o) => o.path === "zero.dat" && o.size === 0)).toBe(true);
    expect(storageBackupComplete({ expected: listed, backedUpPaths: listed, failures: [] }).ok).toBe(true);
    expect(
      storageBackupComplete({
        expected: listed,
        backedUpPaths: listed.slice(1),
        failures: [{ bucket: "documents", path: "a/file.pdf" }],
      }).ok,
    ).toBe(false);
  });
});

describe("atomic backup run", () => {
  it("marks SUCCESS only when database, storage, upload, and verification all pass", async () => {
    const { deps, drive } = makeDeps({});
    const out = await runBackup(deps);
    expect(out.status).toBe("SUCCESS");
    expect(out.manifest?.status).toBe("SUCCESS");
    expect(out.manifest?.results).toEqual({
      database: "pass",
      storage: "pass",
      driveUpload: "pass",
      verification: "pass",
    });
    assertManifestHasNoSecrets(out.manifest);
    const walked = await drive.walkFromRoot();
    expect(walked.some((n) => n.name === "SUCCESS")).toBe(true);
    expect(walked.some((n) => n.name === "manifest.json")).toBe(true);
    expect(walked.some((n) => n.name === "checksums.sha256")).toBe(true);
  });

  it("fails the whole backup if storage is partial even when the dump succeeded", async () => {
    const { deps } = makeDeps({
      downloadObject: async (bucket, path) => {
        if (path.includes("measure")) throw new Error("boom");
        return Buffer.from("x");
      },
    });
    const out = await runBackup(deps);
    expect(out.status).toBe("FAILED");
    expect(out.errorCode).toBe("STORAGE_PARTIAL_FAILURE");
    expect(out.manifest?.status).toBe("FAILED");
  });

  it("fails when the database dump is malformed", async () => {
    const { deps } = makeDeps({
      dumpPublic: async () => {
        throw new Error("DUMP_NO_SCHEMA");
      },
    });
    const out = await runBackup(deps);
    expect(out.status).toBe("FAILED");
    expect(out.errorCode).toBe("DUMP_NO_SCHEMA");
  });

  it("retries Drive uploads then succeeds", async () => {
    const drive = new MemoryDrive();
    drive.setTransientUploadFailures(2);
    const { deps } = makeDeps({ drive });
    const out = await runBackup(deps);
    expect(out.status).toBe("SUCCESS");
    expect(drive.uploadsAttempted).toBeGreaterThan(2);
  });

  it("rejects overlapping runs and skips same-day duplicate success", async () => {
    const drive = new MemoryDrive();
    const logs = await drive.ensureChildFolder(BACKUP_ROOT_FOLDER_ID, "Logs");
    await acquireBackupLock({
      drive,
      logsFolderId: logs.id,
      backupId: "11111111-1111-4111-8111-111111111111",
      now: new Date("2026-01-06T12:00:00.000Z"),
    });
    const { deps } = makeDeps({ drive });
    const blocked = await runBackup(deps);
    expect(blocked.status).toBe("SKIPPED");
    expect(blocked.skippedReason).toBe("concurrent");

    const drive2 = new MemoryDrive();
    const first = await runBackup(makeDeps({ drive: drive2 }).deps);
    expect(first.status).toBe("SUCCESS");
    const second = await runBackup(makeDeps({ drive: drive2 }).deps);
    expect(second.status).toBe("SKIPPED");
    expect(second.skippedReason).toBe("already_succeeded_today");
  });

  it("does not delete the newest or only good backup, and leaves unrelated Drive files", async () => {
    const drive = new MemoryDrive();
    const unrelated = drive.seedUnrelatedFile(BACKUP_ROOT_FOLDER_ID, "owner-personal.doc");
    const clock = { now: new Date("2026-01-05T12:00:00.000Z") };
    for (let i = 0; i < 8; i++) {
      clock.now = new Date(Date.UTC(2026, 0, 5 + i, 12));
      const out = await runBackup(makeDeps({ drive, clock }).deps);
      expect(out.status).toBe("SUCCESS");
    }
    await expect(drive.getFile(unrelated)).resolves.toMatchObject({ name: "owner-personal.doc" });
    const daily = (await drive.listChildren((await drive.listChildren(BACKUP_ROOT_FOLDER_ID)).find((c) => c.name === "Daily")!.id));
    expect(daily.length).toBeGreaterThanOrEqual(7);
  });

  it("never writes SUCCESS when Drive verification fails", async () => {
    const drive = new MemoryDrive();
    const orig = drive.readBytes.bind(drive);
    drive.readBytes = async (id: string) => {
      const node = await drive.getFile(id);
      if (node.name === "public.sql.gz") return Buffer.from("tampered");
      return orig(id);
    };
    const out = await runBackup(makeDeps({ drive }).deps);
    expect(out.status).toBe("FAILED");
    expect(out.errorCode).toBe("DUMP_READBACK_MISMATCH");
  });
});

describe("checksums, manifest, restore validation, sanitization", () => {
  it("round-trips checksums and forbids secrets in manifests", () => {
    const lines = [{ file: "database/public.sql.gz", sha256: sha256Hex("abc"), bytes: 3 }];
    const text = formatChecksumFile(lines);
    expect(verifyChecksums(lines, lines).ok).toBe(true);
    const m = createInProgressManifest({
      backupId: crypto.randomUUID(),
      startedAtUtc: new Date().toISOString(),
      gitSha: "abc",
      deploymentId: "dpl",
    });
    expect(() => assertManifestHasNoSecrets(m)).not.toThrow();
    expect(() => assertManifestHasNoSecrets({ token: "secret" })).toThrow(/MANIFEST_SECRET_KEY/);
    expect(() =>
      finalizeManifest(m, {
        status: "SUCCESS",
        completedAtUtc: new Date().toISOString(),
        results: { database: "pass", storage: "fail", driveUpload: "pass", verification: "pass" },
        drive: {
          rootFolderId: BACKUP_ROOT_FOLDER_ID,
          dailyFolder: "Daily/x",
          weeklyFolder: null,
          successMarker: true,
        },
        database: {
          fileName: "public.sql.gz",
          bytes: 1,
          sha256: "a".repeat(64),
          structuralValidation: "pass",
          authDump: "skipped",
        },
        storage: {
          buckets: ["documents"],
          objectCount: 0,
          totalBytes: 0,
          inventoryFile: "inventory.jsonl",
          integrity: "pass",
        },
      }),
    ).toThrow(/SUCCESS_REQUIRES_ALL_PASS/);
  });

  it("restore validation passes on a consistent dump+checksums+inventory sample", () => {
    const dump = validDumpBytes();
    const checksums = formatChecksumFile([
      { file: "database/public.sql.gz", sha256: sha256Hex(dump), bytes: dump.byteLength },
    ]);
    const result = validateRestorableBackup({
      dumpBytes: dump,
      checksumText: checksums,
      inventoryText: "",
      sampleObject: { bytes: Buffer.from("x"), sha256: sha256Hex("x") },
    });
    expect(result.ok).toBe(true);
    expect(RESTORE_ORDER.length).toBeGreaterThan(3);
  });

  it("sanitizes JWTs, URIs, and secrets from errors and forbids them in HTTP bodies", () => {
    const msg = sanitizeBackupError(
      "postgres://user:hunter2@db/postgres bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4iLCJpYXQiOjE1MTYyMzkwMjJ9.sig",
    );
    expect(msg).not.toMatch(/hunter2/);
    expect(msg).not.toMatch(/eyJhbGci/);
    expect(driveTokenResponseHasSecrets({ ok: true, access_token: "x" })).toBe(true);
    expect(driveTokenResponseHasSecrets({ ok: true, status: "SUCCESS" })).toBe(false);
  });

  it("records last-success health age", () => {
    const h = applyHealthUpdate(emptyHealth(), {
      nowUtc: "2026-01-06T12:00:00.000Z",
      backupId: "b1",
      status: "SUCCESS",
      results: { database: "pass", storage: "pass", driveUpload: "pass", verification: "pass" },
      errorCode: null,
    });
    const later = applyHealthUpdate(h, {
      nowUtc: "2026-01-06T13:00:00.000Z",
      backupId: "b2",
      status: "FAILED",
      results: { database: "fail", storage: "fail", driveUpload: "fail", verification: "fail" },
      errorCode: "DATABASE_BACKUP_FAILED",
    });
    expect(later.lastSuccessfulBackupId).toBe("b1");
    expect(later.lastSuccessAgeSeconds).toBe(3600);
    expect(later.lastErrorCode).toBe("DATABASE_BACKUP_FAILED");
  });
});

describe("backup production safety", () => {
  it("does not add migration 0180 and does not touch accounting flags", () => {
    expect(existsSync(join(ROOT, "supabase/migrations/0180_backup.sql"))).toBe(false);
    const files = readdirSync(join(ROOT, "src/lib/backup"));
    for (const f of files) {
      const src = readFileSync(join(ROOT, "src/lib/backup", f), "utf8");
      expect(src).not.toMatch(/posting_enabled\s*:/);
      expect(src).not.toMatch(/books_of_record\s*=\s*true/);
      expect(src).not.toMatch(/cutover_date/);
      expect(src).not.toMatch(/BEGIN PRIVATE KEY/);
    }
    const route = readFileSync(join(ROOT, "src/app/api/cron/backup/route.ts"), "utf8");
    expect(route).toMatch(/runtime = "nodejs"/);
    expect(route).toMatch(/authorizeBackupCronRequest/);
    expect(route).toMatch(/maxDuration = 300/);
    expect(route).toMatch(/Floor King backup SUCCESS/);
    const authz = readFileSync(join(ROOT, "src/lib/backup/authz.ts"), "utf8");
    expect(authz).toMatch(/CRON_SECRET_MISSING/);
    const vercel = readFileSync(join(ROOT, "vercel.json"), "utf8");
    expect(vercel).toMatch(/\/api\/cron\/backup/);
    expect(vercel).toMatch(/15 8 \* \* \*/);
    const nextCfg = readFileSync(join(ROOT, "next.config.ts"), "utf8");
    expect(nextCfg).toMatch(/"\/api\/cron\/backup"/);
    expect(nextCfg).not.toMatch(/\/src\/app\/api\/cron\/backup/);
  });

  it("cron schedule is production-only in vercel.json + authz", () => {
    expect(readFileSync(join(ROOT, "src/lib/backup/authz.ts"), "utf8")).toMatch(/PRODUCTION_ONLY/);
  });
});

describe("Drive destination and upload diagnostics", () => {
  it("classifies My Drive, trashed, read-only, and shortcut roots", () => {
    expect(classifyBackupRoot({ driveId: "0Axxx", canAddChildren: true }).ok).toBe(true);
    const myDrive = classifyBackupRoot({ canAddChildren: true });
    expect(myDrive.ok).toBe(false);
    if (!myDrive.ok) expect(myDrive.code).toBe("DRIVE_SHARED_DRIVE_REQUIRED");
    const readOnly = classifyBackupRoot({ driveId: "0Axxx", canAddChildren: false });
    expect(readOnly.ok).toBe(false);
    if (!readOnly.ok) expect(readOnly.code).toBe("DRIVE_FOLDER_NOT_WRITABLE");
    const trashed = classifyBackupRoot({ driveId: "0Axxx", trashed: true });
    expect(trashed.ok).toBe(false);
    if (!trashed.ok) expect(trashed.code).toBe("DRIVE_ROOT_TRASHED");
    const shortcut = classifyBackupRoot({
      driveId: "0Axxx",
      mimeType: "application/vnd.google-apps.shortcut",
    });
    expect(shortcut.ok).toBe(false);
    if (!shortcut.ok) expect(shortcut.code).toBe("DRIVE_ROOT_IS_SHORTCUT");
  });

  it("formats Google 403/404 reasons without leaking tokens or keys", () => {
    expect(
      extractGoogleErrorReason(
        JSON.stringify({
          error: {
            code: 403,
            message: "The user's Drive storage quota has been exceeded.",
            errors: [{ reason: "storageQuotaExceeded" }],
            access_token: "ya29.should-not-be-used",
          },
        }),
      ),
    ).toBe("storageQuotaExceeded");
    expect(
      extractGoogleErrorReason(JSON.stringify({ error: { errors: [{ reason: "notFound" }] } })),
    ).toBe("notFound");
    expect(
      extractGoogleErrorReason(JSON.stringify({ error: { status: "PERMISSION_DENIED" } })),
    ).toBe("PERMISSION_DENIED");
    const err = new DriveApiError("upload", 403, "insufficientFilePermissions");
    expect(err.message).toBe("DRIVE_UPLOAD:403:insufficientFilePermissions");
    expect(isSafeBackupErrorCode(err.message)).toBe(true);
    expect(isRetryableDriveStatus(403)).toBe(false);
    expect(isRetryableDriveStatus(429)).toBe(true);
    expect(sanitizeBackupError(err)).not.toMatch(/ya29/);
    expect(sanitizeBackupError(err)).not.toMatch(/BEGIN PRIVATE KEY/);
  });

  it("fails closed on a My Drive root before dump or retention", async () => {
    const drive = new MemoryDrive();
    drive.simulateMyDrive();
    let dumped = false;
    const { deps } = makeDeps({
      drive,
      dumpPublic: async () => {
        dumped = true;
        return dumpResult();
      },
    });
    const out = await runBackup(deps);
    expect(out.status).toBe("FAILED");
    expect(out.errorCode).toBe("DRIVE_SHARED_DRIVE_REQUIRED");
    expect(dumped).toBe(true);
    expect(out.dumpBytes).toBeGreaterThan(0);
    expect(drive.uploadsAttempted).toBe(0);
  });

  it("surfaces Drive upload 403 and does not retry non-retryable errors", async () => {
    let resumableStarts = 0;
    const client = new GoogleDriveClient("ya29.fake-token", async (url, init) => {
      const target = String(url);
      if (init?.method === "POST" && target.includes("uploadType=resumable")) {
        resumableStarts += 1;
        return new Response(
          JSON.stringify({
            error: {
              code: 403,
              errors: [{ reason: "storageQuotaExceeded" }],
            },
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error("UNEXPECTED_DRIVE_CALL");
    });
    await expect(
      client.uploadBytes(BACKUP_ROOT_FOLDER_ID, "lock.json", Buffer.from("{}"), "application/json"),
    ).rejects.toThrow(/DRIVE_UPLOAD:403:storageQuotaExceeded/);
    expect(resumableStarts).toBe(1);
  });

  it("does not delete prior backups when the current upload never starts", async () => {
    const plan = planRetentionDeletes(
      [
        {
          id: "keep-me",
          lane: "daily",
          period: "2026-01-01",
          completedAt: "2026-01-01",
          status: "SUCCESS",
          systemMarker: MARKER_SYSTEM,
          underRoot: true,
        },
      ],
      { currentRunFailed: true, inventoryComplete: true },
    );
    expect(plan.deleteIds).toEqual([]);
    expect(plan.skipped.every((s) => s.reason === "CURRENT_RUN_FAILED")).toBe(true);
  });
});
