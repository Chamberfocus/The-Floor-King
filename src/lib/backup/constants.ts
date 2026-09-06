/**
 * Floor King offsite backup — non-secret configuration.
 * Google Drive access is folder-scoped by IAM sharing, not by these IDs alone.
 */

export const BACKUP_IMPLEMENTATION_VERSION = "1.0.0";

export const BACKUP_ROOT_FOLDER_ID = "1bUgNiTHpXuJaMTAsbpRayJdOT_icUjeD";
export const BACKUP_ROOT_FOLDER_NAME = "Floor King CRM Backups";

export const GOOGLE_CLOUD_PROJECT_ID = "floor-king-crm";
export const GOOGLE_CLOUD_PROJECT_NUMBER = "737192191836";
export const GOOGLE_WIF_POOL_ID = "vercel-floor-king-crm";
/** Display name is "Vercel Floor King CRM"; ID defaults to the pool id. Override with GOOGLE_WIF_PROVIDER_ID. */
export const GOOGLE_WIF_PROVIDER_ID_DEFAULT = "vercel-floor-king-crm";
export const GOOGLE_BACKUP_SERVICE_ACCOUNT =
  "floor-king-crm-backup@floor-king-crm.iam.gserviceaccount.com";

export const VERCEL_OIDC_ISSUER = "https://oidc.vercel.com/the-floor-king";
export const VERCEL_OIDC_AUDIENCE = "https://vercel.com/the-floor-king";
export const VERCEL_OIDC_PRODUCTION_SUBJECT =
  "owner:the-floor-king:project:floorking-crm:environment:production";

export const GOOGLE_STS_TOKEN_URL = "https://sts.googleapis.com/v1/token";
export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

export const RETAIN_DAILY_SUCCESS = 7;
export const RETAIN_WEEKLY_SUCCESS = 4;
export const LOCK_TTL_MS = 12 * 60 * 1000;
export const DRIVE_UPLOAD_ATTEMPTS = 3;

export const FOLDER_DAILY = "Daily";
export const FOLDER_WEEKLY = "Weekly";
export const FOLDER_LOGS = "Logs";
export const MARKER_IN_PROGRESS = "IN_PROGRESS";
export const MARKER_SUCCESS = "SUCCESS";
export const MARKER_FAILED = "FAILED";
export const MARKER_SYSTEM = "floor-king-backup";

export const HEALTH_FILE_NAME = "health.json";
export const LOCK_FILE_NAME = "lock.json";
export const MANIFEST_FILE_NAME = "manifest.json";
export const CHECKSUMS_FILE_NAME = "checksums.sha256";
export const INVENTORY_FILE_NAME = "inventory.jsonl";
export const DATABASE_DUMP_NAME = "public.sql.gz";
export const AUTH_DUMP_NAME = "auth.sql.gz";

export const REQUIRED_STORAGE_BUCKETS = [
  "documents",
  "job-files",
  "branding",
] as const;

export const PG_DUMP_LINUX_AMD64 = {
  url: "https://github.com/whoisnian/static-binaries/releases/download/v20260301.0/pg_dump_v20260301.0_linux_amd64",
  sha256: "1e9eb15e09a0197b4c3547e6a0e44b2fed0ff22bf2b9747e07d55fdcf92302f4",
  fileName: "pg_dump_v20260301.0_linux_amd64",
} as const;

export function googleWifProviderId(): string {
  const fromEnv = process.env.GOOGLE_WIF_PROVIDER_ID?.trim();
  return fromEnv || GOOGLE_WIF_PROVIDER_ID_DEFAULT;
}

export function googleWifAudience(): string {
  return `//iam.googleapis.com/projects/${GOOGLE_CLOUD_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${GOOGLE_WIF_POOL_ID}/providers/${googleWifProviderId()}`;
}

export function googleServiceAccountImpersonationUrl(): string {
  return `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${GOOGLE_BACKUP_SERVICE_ACCOUNT}:generateAccessToken`;
}
