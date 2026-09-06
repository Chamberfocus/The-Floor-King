import { LOCK_FILE_NAME, LOCK_TTL_MS, MARKER_SYSTEM } from "./constants";
import type { DriveClient } from "./drive-client";

export type BackupLock = {
  backupId: string;
  startedAtUtc: string;
  expiresAtUtc: string;
  implementation: typeof MARKER_SYSTEM;
};

export async function acquireBackupLock(args: {
  drive: DriveClient;
  logsFolderId: string;
  backupId: string;
  now: Date;
}): Promise<{ ok: true } | { ok: false; code: "BACKUP_IN_PROGRESS" }> {
  const kids = await args.drive.listChildren(args.logsFolderId);
  const locks = kids.filter((k) => k.name === LOCK_FILE_NAME || k.name.startsWith("lock-"));
  const nowMs = args.now.getTime();
  for (const lockFile of locks) {
    try {
      const raw = await args.drive.readBytes(lockFile.id);
      const parsed = JSON.parse(Buffer.from(raw).toString("utf8")) as BackupLock;
      const exp = Date.parse(parsed.expiresAtUtc);
      if (Number.isFinite(exp) && exp > nowMs && parsed.backupId !== args.backupId) {
        return { ok: false, code: "BACKUP_IN_PROGRESS" };
      }
    } catch {
      /* unreadable lock treated as stale */
    }
  }
  const lock: BackupLock = {
    backupId: args.backupId,
    startedAtUtc: args.now.toISOString(),
    expiresAtUtc: new Date(nowMs + LOCK_TTL_MS).toISOString(),
    implementation: MARKER_SYSTEM,
  };
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      await args.drive.uploadBytes(
        args.logsFolderId,
        LOCK_FILE_NAME,
        Buffer.from(JSON.stringify(lock)),
        "application/json",
      );
      last = null;
      break;
    } catch (err) {
      last = err;
    }
  }
  if (last) throw last instanceof Error ? last : new Error("DRIVE_UPLOAD_FAILED");
  return { ok: true };
}

export async function releaseBackupLock(args: {
  drive: DriveClient;
  logsFolderId: string;
  backupId: string;
}): Promise<void> {
  const kids = await args.drive.listChildren(args.logsFolderId);
  for (const lockFile of kids.filter((k) => k.name === LOCK_FILE_NAME || k.name.startsWith("lock-"))) {
    try {
      const raw = await args.drive.readBytes(lockFile.id);
      const parsed = JSON.parse(Buffer.from(raw).toString("utf8")) as BackupLock;
      if (parsed.backupId === args.backupId) {
        await args.drive.deleteDescendant(lockFile.id);
      }
    } catch {
      /* ignore */
    }
  }
}
