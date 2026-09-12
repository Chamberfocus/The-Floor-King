import { createAdminClient } from "@/lib/supabase/admin";
import { REQUIRED_STORAGE_BUCKETS } from "./constants";
import { dumpPostgresSchema } from "./dump";
import { GoogleDriveClient } from "./google-drive";
import { getProductionBackupOidcToken, getProductionDriveAccessToken } from "./oidc";
import { runBackup, type BackupDeps, type BackupRunOutcome } from "./run";

function gitSha(): string | null {
  return process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? null;
}

async function listStoragePrefix(bucket: string, prefix: string) {
  const admin = createAdminClient();
  const all: Array<{
    name: string;
    id: string | null;
    metadata?: { size?: number | string; mimetype?: string } | null;
  }> = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, {
      limit: 1000,
      offset,
    });
    if (error) throw new Error("STORAGE_LIST_FAILED");
    const rows = data ?? [];
    for (const row of rows) {
      all.push({
        name: row.name,
        id: row.id ?? null,
        metadata: row.metadata as { size?: number | string; mimetype?: string } | null,
      });
    }
    if (rows.length < 1000) break;
    offset += rows.length;
  }
  return all;
}

export function buildProductionBackupDeps(
  alert?: (code: string) => Promise<void>,
  success?: (info: { backupId: string; dumpBytes: number }) => Promise<void>,
): BackupDeps {
  const databaseUrl = process.env.SUPABASE_DB_URL;
  if (!databaseUrl) throw new Error("SUPABASE_DB_URL_MISSING");
  return {
    now: () => new Date(),
    randomUuid: () => crypto.randomUUID(),
    getOidcToken: getProductionBackupOidcToken,
    getDriveAccessToken: getProductionDriveAccessToken,
    createDrive: (accessToken) => new GoogleDriveClient(accessToken),
    dumpPublic: () =>
      dumpPostgresSchema({
        databaseUrl,
        schema: "public",
        timeoutMs: 120_000,
        publicSupabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      }),
    // Auth dump is best-effort in tests; skip on Vercel hobby (300s cap).
    skipStorageBackup: true,
    skipRetention: true,
    listBuckets: async () => {
      const admin = createAdminClient();
      const { data, error } = await admin.storage.listBuckets();
      if (error) return [...REQUIRED_STORAGE_BUCKETS];
      const names = (data ?? []).map((b) => b.id || b.name).filter(Boolean);
      return [...new Set([...REQUIRED_STORAGE_BUCKETS, ...names])];
    },
    listStoragePrefix,
    downloadObject: async (bucket, path) => {
      const admin = createAdminClient();
      const { data, error } = await admin.storage.from(bucket).download(path);
      if (error || !data) throw new Error("STORAGE_DOWNLOAD_FAILED");
      return new Uint8Array(await data.arrayBuffer());
    },
    sendFailureAlert: alert,
    sendSuccessAlert: success,
    gitSha: gitSha(),
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  };
}

export async function runProductionBackup(
  alert?: (code: string) => Promise<void>,
  success?: (info: { backupId: string; dumpBytes: number }) => Promise<void>,
): Promise<BackupRunOutcome> {
  return runBackup(buildProductionBackupDeps(alert, success));
}
