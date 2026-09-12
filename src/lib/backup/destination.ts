import { FOLDER_MIME } from "./drive-client";

const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

export type BackupRootMeta = {
  mimeType?: string;
  trashed?: boolean;
  driveId?: string | null;
  canAddChildren?: boolean;
};

export type BackupRootClassification =
  | { ok: true; sharedDrive: true }
  | { ok: false; code: string };

/**
 * Service accounts have no My Drive quota. File creates only succeed on a
 * Shared Drive the backup principal can write. Listing an existing My Drive
 * folder can still succeed, which is why uploads then fail with 403.
 */
export function classifyBackupRoot(meta: BackupRootMeta): BackupRootClassification {
  if (meta.trashed) return { ok: false, code: "DRIVE_ROOT_TRASHED" };
  if (meta.mimeType === SHORTCUT_MIME) return { ok: false, code: "DRIVE_ROOT_IS_SHORTCUT" };
  if (meta.mimeType && meta.mimeType !== FOLDER_MIME) {
    return { ok: false, code: "DRIVE_ROOT_NOT_FOLDER" };
  }
  if (meta.canAddChildren === false) return { ok: false, code: "DRIVE_FOLDER_NOT_WRITABLE" };
  if (!meta.driveId) return { ok: false, code: "DRIVE_SHARED_DRIVE_REQUIRED" };
  return { ok: true, sharedDrive: true };
}
