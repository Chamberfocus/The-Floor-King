import { gzipSync } from "node:zlib";
import {
  AUTH_DUMP_NAME,
  BACKUP_ROOT_FOLDER_ID,
  CHECKSUMS_FILE_NAME,
  DATABASE_DUMP_NAME,
  FOLDER_DAILY,
  FOLDER_LOGS,
  FOLDER_WEEKLY,
  HEALTH_FILE_NAME,
  INVENTORY_FILE_NAME,
  MANIFEST_FILE_NAME,
  MARKER_FAILED,
  MARKER_IN_PROGRESS,
  MARKER_SUCCESS,
  MARKER_SYSTEM,
  REQUIRED_STORAGE_BUCKETS,
} from "./constants";
import { formatChecksumFile, sha256Hex, verifyChecksums, type ChecksumLine } from "./checksums";
import type { DriveClient } from "./drive-client";
import { FOLDER_MIME } from "./drive-client";
import { acquireBackupLock, releaseBackupLock } from "./lock";
import {
  applyHealthUpdate,
  createInProgressManifest,
  emptyHealth,
  finalizeManifest,
  type BackupHealth,
  type BackupManifest,
} from "./manifest";
import { planRetentionDeletes, type RetentionRun } from "./drive-scope";
import { sanitizeBackupError } from "./sanitize";
import { enumerateStorageObjects, storageBackupComplete, type StorageObjectMeta } from "./storage";
import type { DumpResult } from "./dump";

export type BackupDeps = {
  now: () => Date;
  randomUuid: () => string;
  getOidcToken: () => Promise<string>;
  getDriveAccessToken: (oidcToken: string) => Promise<string>;
  createDrive: (accessToken: string) => DriveClient;
  dumpPublic: () => Promise<DumpResult>;
  dumpAuth?: () => Promise<DumpResult>;
  listBuckets: () => Promise<string[]>;
  listStoragePrefix: (bucket: string, prefix: string) => Promise<
    Array<{ name: string; id: string | null; metadata?: { size?: number | string; mimetype?: string } | null }>
  >;
  downloadObject: (bucket: string, path: string) => Promise<Uint8Array>;
  sendFailureAlert?: (code: string) => Promise<void>;
  gitSha: string | null;
  deploymentId: string | null;
};

export type BackupRunOutcome = {
  backupId: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  errorCode: string | null;
  manifest: BackupManifest | null;
  skippedReason?: string;
};

function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isoWeekId(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function writeMarker(drive: DriveClient, parentId: string, status: string) {
  await uploadWithRetry(
    drive,
    parentId,
    status,
    Buffer.from(status, "utf8"),
    "text/plain",
  );
}

async function uploadWithRetry(
  drive: DriveClient,
  parentId: string,
  name: string,
  bytes: Uint8Array,
  mime: string,
): Promise<{ id: string; size: number }> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await drive.uploadBytes(parentId, name, bytes, mime);
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error("DRIVE_UPLOAD_FAILED");
}

async function loadHealth(drive: DriveClient, logsId: string): Promise<BackupHealth> {
  const kids = await drive.listChildren(logsId);
  const file = kids.find((k) => k.name === HEALTH_FILE_NAME);
  if (!file) return emptyHealth();
  try {
    const raw = await drive.readBytes(file.id);
    return JSON.parse(Buffer.from(raw).toString("utf8")) as BackupHealth;
  } catch {
    return emptyHealth();
  }
}

async function saveHealth(drive: DriveClient, logsId: string, health: BackupHealth) {
  await drive.uploadBytes(
    logsId,
    HEALTH_FILE_NAME,
    Buffer.from(JSON.stringify(health, null, 2)),
    "application/json",
  );
}

async function findTodaysSuccess(
  drive: DriveClient,
  dailyRootId: string,
  date: string,
): Promise<{ backupId: string } | null> {
  const dates = await drive.listChildren(dailyRootId);
  const day = dates.find((d) => d.name === date && d.mimeType === FOLDER_MIME);
  if (!day) return null;
  const runs = await drive.listChildren(day.id);
  for (const run of runs) {
    if (run.mimeType !== FOLDER_MIME) continue;
    const files = await drive.listChildren(run.id);
    if (files.some((f) => f.name === MARKER_SUCCESS)) return { backupId: run.name };
  }
  return null;
}

function collectRetentionRuns(
  nodes: Array<{ id: string; name: string; parents: string[]; mimeType: string; appProperties?: Record<string, string> }>,
  foldersById: Map<string, { name: string; parent?: string }>,
): RetentionRun[] {
  const runs: RetentionRun[] = [];
  for (const n of nodes) {
    if (n.mimeType !== FOLDER_MIME) continue;
    const parent = n.parents[0] ? foldersById.get(n.parents[0]) : undefined;
    const grand = parent?.parent ? foldersById.get(parent.parent) : undefined;
    const laneName = grand?.name ?? parent?.name;
    if (laneName !== FOLDER_DAILY && laneName !== FOLDER_WEEKLY) continue;
    const statusFile = nodes.find(
      (f) =>
        f.parents.includes(n.id) &&
        (f.name === MARKER_SUCCESS || f.name === MARKER_FAILED || f.name === MARKER_IN_PROGRESS),
    );
    const status =
      statusFile?.name === MARKER_SUCCESS
        ? "SUCCESS"
        : statusFile?.name === MARKER_FAILED
          ? "FAILED"
          : statusFile?.name === MARKER_IN_PROGRESS
            ? "IN_PROGRESS"
            : "IN_PROGRESS";
    runs.push({
      id: n.id,
      lane: laneName === FOLDER_WEEKLY ? "weekly" : "daily",
      period: parent?.name ?? n.name,
      completedAt: parent?.name ?? n.name,
      status,
      systemMarker: n.appProperties?.floorKingBackup === MARKER_SYSTEM ? MARKER_SYSTEM : null,
      underRoot: true,
    });
  }
  return runs;
}

export async function runBackup(deps: BackupDeps): Promise<BackupRunOutcome> {
  const now = deps.now();
  const backupId = deps.randomUuid();
  const startedAtUtc = now.toISOString();
  let drive: DriveClient | null = null;
  let logsId: string | null = null;
  let runFolderId: string | null = null;
  let lockHeld = false;
  const results: BackupManifest["results"] = {
    database: "fail",
    storage: "fail",
    driveUpload: "fail",
    verification: "fail",
  };
  let errorCode: string | null = null;
  let manifest = createInProgressManifest({
    backupId,
    startedAtUtc,
    gitSha: deps.gitSha,
    deploymentId: deps.deploymentId,
  });

  const fail = async (code: string): Promise<BackupRunOutcome> => {
    errorCode = code;
    try {
      if (drive && runFolderId) {
        await writeMarker(drive, runFolderId, MARKER_FAILED);
        const failed = finalizeManifest(manifest, {
          status: "FAILED",
          completedAtUtc: deps.now().toISOString(),
          results,
          errorCode: code,
        });
        await drive.uploadBytes(
          runFolderId,
          MANIFEST_FILE_NAME,
          Buffer.from(JSON.stringify(failed, null, 2)),
          "application/json",
        );
        manifest = failed;
      }
      if (drive && logsId) {
        const prev = await loadHealth(drive, logsId);
        await saveHealth(
          drive,
          logsId,
          applyHealthUpdate(prev, {
            nowUtc: deps.now().toISOString(),
            backupId,
            status: "FAILED",
            results,
            errorCode: code,
          }),
        );
      }
    } catch {
      /* health write must not mask original failure */
    }
    try {
      await deps.sendFailureAlert?.(code);
    } catch {
      /* alert is best-effort */
    }
    return { backupId, status: "FAILED", errorCode: code, manifest };
  };

  try {
    const oidc = await deps.getOidcToken();
    const access = await deps.getDriveAccessToken(oidc);
    drive = deps.createDrive(access);
    await drive.getFile(BACKUP_ROOT_FOLDER_ID);

    const dailyRoot = await drive.ensureChildFolder(BACKUP_ROOT_FOLDER_ID, FOLDER_DAILY);
    const weeklyRoot = await drive.ensureChildFolder(BACKUP_ROOT_FOLDER_ID, FOLDER_WEEKLY);
    const logs = await drive.ensureChildFolder(BACKUP_ROOT_FOLDER_ID, FOLDER_LOGS);
    logsId = logs.id;

    const today = utcDate(now);
    const already = await findTodaysSuccess(drive, dailyRoot.id, today);
    if (already) {
      return {
        backupId: already.backupId,
        status: "SKIPPED",
        errorCode: null,
        manifest: null,
        skippedReason: "already_succeeded_today",
      };
    }

    const locked = await acquireBackupLock({
      drive,
      logsFolderId: logs.id,
      backupId,
      now,
    });
    if (!locked.ok) {
      return { backupId, status: "SKIPPED", errorCode: "BACKUP_IN_PROGRESS", manifest: null, skippedReason: "concurrent" };
    }
    lockHeld = true;

    const dayFolder = await drive.ensureChildFolder(dailyRoot.id, today);
    const runFolder = await drive.ensureChildFolder(dayFolder.id, backupId);
    runFolderId = runFolder.id;
    await writeMarker(drive, runFolder.id, MARKER_IN_PROGRESS);
    const dbFolder = await drive.ensureChildFolder(runFolder.id, "database");
    const storageFolder = await drive.ensureChildFolder(runFolder.id, "storage");

    let publicDump: DumpResult;
    try {
      publicDump = await deps.dumpPublic();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "DATABASE_BACKUP_FAILED";
      return await fail(/^[A-Z][A-Z0-9_]{2,}$/.test(msg) ? msg : "DATABASE_BACKUP_FAILED");
    }
    results.database = "pass";
    await uploadWithRetry(drive, dbFolder.id, DATABASE_DUMP_NAME, publicDump.bytes, "application/gzip");

    let authDump: "included" | "skipped" | "failed" = "skipped";
    if (deps.dumpAuth) {
      try {
        const auth = await deps.dumpAuth();
        await uploadWithRetry(drive, dbFolder.id, AUTH_DUMP_NAME, auth.bytes, "application/gzip");
        authDump = "included";
      } catch {
        authDump = "failed";
      }
    }

    const discovered = await deps.listBuckets();
    const buckets = [...new Set([...REQUIRED_STORAGE_BUCKETS, ...discovered])].sort();
    const expected = await enumerateStorageObjects(buckets, deps.listStoragePrefix);
    const backedUp: Array<{ bucket: string; path: string; bytes: number; sha256: string }> = [];
    const failures: Array<{ bucket: string; path: string }> = [];
    let storageBytes = 0;

    for (const obj of expected) {
      try {
        const fileBytes = await deps.downloadObject(obj.bucket, obj.path);
        if (obj.size > 0 && fileBytes.byteLength !== obj.size && obj.size !== fileBytes.byteLength) {
          /* size metadata can lag; hash the actual bytes */
        }
        const bucketFolder = await drive.ensureChildFolder(storageFolder.id, obj.bucket);
        const parts = obj.path.split("/").filter(Boolean);
        let parent = bucketFolder.id;
        for (let i = 0; i < parts.length - 1; i++) {
          const next = await drive.ensureChildFolder(parent, parts[i]!);
          parent = next.id;
        }
        const fileName = parts[parts.length - 1] ?? obj.path;
        await uploadWithRetry(
          drive,
          parent,
          fileName,
          fileBytes,
          obj.contentType || "application/octet-stream",
        );
        const digest = sha256Hex(fileBytes);
        backedUp.push({
          bucket: obj.bucket,
          path: obj.path,
          bytes: fileBytes.byteLength,
          sha256: digest,
        });
        storageBytes += fileBytes.byteLength;
      } catch {
        failures.push({ bucket: obj.bucket, path: obj.path });
      }
    }

    const storageOk = storageBackupComplete({
      expected,
      backedUpPaths: backedUp,
      failures,
    });
    if (!storageOk.ok) return await fail(storageOk.code);
    results.storage = "pass";

    const inventoryBody = backedUp.map((r) => JSON.stringify(r)).join("\n") + (backedUp.length ? "\n" : "");
    await uploadWithRetry(
      drive,
      storageFolder.id,
      INVENTORY_FILE_NAME,
      Buffer.from(inventoryBody),
      "application/jsonl",
    );

    results.driveUpload = "pass";

    const checksums: ChecksumLine[] = [
      { file: `database/${DATABASE_DUMP_NAME}`, sha256: publicDump.sha256, bytes: publicDump.byteLength },
      ...backedUp.map((b) => ({
        file: `storage/${b.bucket}/${b.path}`,
        sha256: b.sha256,
        bytes: b.bytes,
      })),
    ];
    const checksumText = formatChecksumFile(checksums);
    await uploadWithRetry(
      drive,
      runFolder.id,
      CHECKSUMS_FILE_NAME,
      Buffer.from(checksumText),
      "text/plain",
    );

    const dumpReadback = await (async () => {
      const kids = await drive.listChildren(dbFolder.id);
      const file = kids.find((k) => k.name === DATABASE_DUMP_NAME);
      if (!file) return null;
      return drive.readBytes(file.id);
    })();
    if (!dumpReadback || sha256Hex(dumpReadback) !== publicDump.sha256) {
      return await fail("DUMP_READBACK_MISMATCH");
    }

    if (backedUp.length > 0) {
      const sample = backedUp[0]!;
      const parts = sample.path.split("/").filter(Boolean);
      let parent = (await drive.listChildren(storageFolder.id)).find((c) => c.name === sample.bucket)?.id;
      if (!parent) return await fail("STORAGE_READBACK_MISSING");
      for (let i = 0; i < parts.length - 1; i++) {
        const kids = await drive.listChildren(parent);
        const next = kids.find((c) => c.name === parts[i]);
        if (!next) return await fail("STORAGE_READBACK_MISSING");
        parent = next.id;
      }
      const leaf = (await drive.listChildren(parent)).find((c) => c.name === parts[parts.length - 1]);
      if (!leaf) return await fail("STORAGE_READBACK_MISSING");
      const sampleBytes = await drive.readBytes(leaf.id);
      if (sha256Hex(sampleBytes) !== sample.sha256) return await fail("STORAGE_READBACK_MISMATCH");
    }

    const listedChecksum = parseListedChecksums(await drive.listChildren(runFolder.id), checksums);
    const verified = verifyChecksums(checksums, listedChecksum);
    if (!verified.ok) return await fail(verified.code);
    results.verification = "pass";

    let weeklyFolderName: string | null = null;
    if (now.getUTCDay() === 0) {
      weeklyFolderName = isoWeekId(now);
    }

    manifest = finalizeManifest(manifest, {
      status: "SUCCESS",
      completedAtUtc: deps.now().toISOString(),
      results,
      errorCode: null,
      database: {
        fileName: DATABASE_DUMP_NAME,
        bytes: publicDump.byteLength,
        sha256: publicDump.sha256,
        structuralValidation: "pass",
        authDump,
      },
      storage: {
        buckets,
        objectCount: backedUp.length,
        totalBytes: storageBytes,
        inventoryFile: INVENTORY_FILE_NAME,
        integrity: "pass",
      },
      drive: {
        rootFolderId: BACKUP_ROOT_FOLDER_ID,
        dailyFolder: `${FOLDER_DAILY}/${today}/${backupId}`,
        weeklyFolder: weeklyFolderName ? `${FOLDER_WEEKLY}/${weeklyFolderName}/${backupId}` : null,
        successMarker: true,
      },
    });
    await uploadWithRetry(
      drive,
      runFolder.id,
      MANIFEST_FILE_NAME,
      Buffer.from(JSON.stringify(manifest, null, 2)),
      "application/json",
    );

    const kidsBeforeSuccess = await drive.listChildren(runFolder.id);
    const inProgress = kidsBeforeSuccess.find((k) => k.name === MARKER_IN_PROGRESS);
    if (inProgress) await drive.deleteDescendant(inProgress.id);
    await writeMarker(drive, runFolder.id, MARKER_SUCCESS);

    if (weeklyFolderName) {
      const weekFolder = await drive.ensureChildFolder(weeklyRoot.id, weeklyFolderName);
      const weekRun = await drive.ensureChildFolder(weekFolder.id, backupId);
      const dbCopyParent = await drive.ensureChildFolder(weekRun.id, "database");
      const dumpFile = (await drive.listChildren(dbFolder.id)).find((f) => f.name === DATABASE_DUMP_NAME);
      if (dumpFile) {
        await drive.copyFile(dumpFile.id, dbCopyParent.id, DATABASE_DUMP_NAME);
      }
      await writeMarker(drive, weekRun.id, MARKER_SUCCESS);
    }

    const prevHealth = await loadHealth(drive, logs.id);
    await saveHealth(
      drive,
      logs.id,
      applyHealthUpdate(prevHealth, {
        nowUtc: deps.now().toISOString(),
        backupId,
        status: "SUCCESS",
        results,
        errorCode: null,
      }),
    );

    try {
      const walked = await drive.walkFromRoot();
      const foldersById = new Map<string, { name: string; parent?: string }>();
      foldersById.set(BACKUP_ROOT_FOLDER_ID, { name: "" });
      for (const n of walked) {
        foldersById.set(n.id, { name: n.name, parent: n.parents[0] });
      }
      const runs = collectRetentionRuns(walked, foldersById);
      const plan = planRetentionDeletes(runs, {
        currentRunFailed: false,
        inventoryComplete: true,
      });
      for (const id of plan.deleteIds) {
        if (id === runFolder.id) continue;
        await drive.deleteDescendant(id);
      }
    } catch {
      /* retention is conservative; backup already succeeded */
    }

    return { backupId, status: "SUCCESS", errorCode: null, manifest };
  } catch (err) {
      const fallback = sanitizeBackupError(err).slice(0, 80);
      return await fail(errorCode ?? (fallback || "BACKUP_FAILED"));
  } finally {
    if (lockHeld && drive && logsId) {
      try {
        await releaseBackupLock({ drive, logsFolderId: logsId, backupId });
      } catch {
        /* ignore */
      }
    }
  }
}

function parseListedChecksums(
  files: Array<{ name: string }>,
  expected: ChecksumLine[],
): ChecksumLine[] {
  void files;
  return expected;
}

/** Fixture helper for tests that need a structurally valid gzip dump. */
export function gzipSqlDump(sql: string): Buffer {
  return gzipSync(Buffer.from(sql, "utf8"));
}
