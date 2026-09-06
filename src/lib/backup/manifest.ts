import { BACKUP_IMPLEMENTATION_VERSION } from "./constants";
import { assertManifestHasNoSecrets } from "./sanitize";

export { assertManifestHasNoSecrets };

export type BackupRunStatus = "IN_PROGRESS" | "SUCCESS" | "FAILED";

export type BackupManifest = {
  implementation: "floor-king-crm-backup";
  implementationVersion: string;
  backupId: string;
  startedAtUtc: string;
  completedAtUtc: string | null;
  environment: "production";
  gitSha: string | null;
  deploymentId: string | null;
  status: BackupRunStatus;
  database: {
    fileName: string;
    bytes: number;
    sha256: string;
    structuralValidation: "pass" | "fail";
    authDump: "included" | "skipped" | "failed";
  } | null;
  storage: {
    buckets: string[];
    objectCount: number;
    totalBytes: number;
    inventoryFile: string;
    integrity: "pass" | "fail";
  } | null;
  drive: {
    rootFolderId: string;
    dailyFolder: string;
    weeklyFolder: string | null;
    successMarker: boolean;
  } | null;
  results: {
    database: "pass" | "fail";
    storage: "pass" | "fail";
    driveUpload: "pass" | "fail";
    verification: "pass" | "fail";
  };
  errorCode: string | null;
};

export function createInProgressManifest(args: {
  backupId: string;
  startedAtUtc: string;
  gitSha: string | null;
  deploymentId: string | null;
}): BackupManifest {
  const manifest: BackupManifest = {
    implementation: "floor-king-crm-backup",
    implementationVersion: BACKUP_IMPLEMENTATION_VERSION,
    backupId: args.backupId,
    startedAtUtc: args.startedAtUtc,
    completedAtUtc: null,
    environment: "production",
    gitSha: args.gitSha,
    deploymentId: args.deploymentId,
    status: "IN_PROGRESS",
    database: null,
    storage: null,
    drive: null,
    results: {
      database: "fail",
      storage: "fail",
      driveUpload: "fail",
      verification: "fail",
    },
    errorCode: null,
  };
  assertManifestHasNoSecrets(manifest);
  return manifest;
}

export function finalizeManifest(
  manifest: BackupManifest,
  patch: Partial<BackupManifest> & { status: BackupRunStatus; completedAtUtc: string },
): BackupManifest {
  const next = { ...manifest, ...patch };
  if (next.status === "SUCCESS") {
    const r = next.results;
    if (
      r.database !== "pass" ||
      r.storage !== "pass" ||
      r.driveUpload !== "pass" ||
      r.verification !== "pass"
    ) {
      throw new Error("SUCCESS_REQUIRES_ALL_PASS");
    }
    if (!next.drive?.successMarker) throw new Error("SUCCESS_REQUIRES_MARKER");
    if (!next.database || next.database.structuralValidation !== "pass") {
      throw new Error("SUCCESS_REQUIRES_DB");
    }
    if (!next.storage || next.storage.integrity !== "pass") {
      throw new Error("SUCCESS_REQUIRES_STORAGE");
    }
  }
  assertManifestHasNoSecrets(next);
  return next;
}

export type BackupHealth = {
  implementation: "floor-king-crm-backup";
  lastAttemptedAtUtc: string | null;
  lastAttemptedBackupId: string | null;
  lastAttemptedStatus: BackupRunStatus | null;
  lastSuccessfulAtUtc: string | null;
  lastSuccessfulBackupId: string | null;
  lastSuccessAgeSeconds: number | null;
  lastDatabaseResult: "pass" | "fail" | null;
  lastStorageResult: "pass" | "fail" | null;
  lastDriveUploadResult: "pass" | "fail" | null;
  lastVerificationResult: "pass" | "fail" | null;
  lastErrorCode: string | null;
};

export function emptyHealth(): BackupHealth {
  return {
    implementation: "floor-king-crm-backup",
    lastAttemptedAtUtc: null,
    lastAttemptedBackupId: null,
    lastAttemptedStatus: null,
    lastSuccessfulAtUtc: null,
    lastSuccessfulBackupId: null,
    lastSuccessAgeSeconds: null,
    lastDatabaseResult: null,
    lastStorageResult: null,
    lastDriveUploadResult: null,
    lastVerificationResult: null,
    lastErrorCode: null,
  };
}

export function applyHealthUpdate(
  previous: BackupHealth,
  args: {
    nowUtc: string;
    backupId: string;
    status: BackupRunStatus;
    results: BackupManifest["results"];
    errorCode: string | null;
  },
): BackupHealth {
  const nowMs = Date.parse(args.nowUtc);
  const lastSuccess =
    args.status === "SUCCESS" ? args.nowUtc : previous.lastSuccessfulAtUtc;
  const lastSuccessMs = lastSuccess ? Date.parse(lastSuccess) : NaN;
  return {
    implementation: "floor-king-crm-backup",
    lastAttemptedAtUtc: args.nowUtc,
    lastAttemptedBackupId: args.backupId,
    lastAttemptedStatus: args.status,
    lastSuccessfulAtUtc: lastSuccess,
    lastSuccessfulBackupId:
      args.status === "SUCCESS" ? args.backupId : previous.lastSuccessfulBackupId,
    lastSuccessAgeSeconds:
      lastSuccess && Number.isFinite(lastSuccessMs)
        ? Math.max(0, Math.floor((nowMs - lastSuccessMs) / 1000))
        : null,
    lastDatabaseResult: args.results.database,
    lastStorageResult: args.results.storage,
    lastDriveUploadResult: args.results.driveUpload,
    lastVerificationResult: args.results.verification,
    lastErrorCode: args.status === "SUCCESS" ? null : args.errorCode,
  };
}
