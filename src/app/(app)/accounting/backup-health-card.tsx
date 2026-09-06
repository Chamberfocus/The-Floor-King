import { loadBackupHealthForAdmin } from "@/lib/backup/health";
import type { UserRole } from "@/lib/types";

export async function BackupHealthCard({ role }: { role: UserRole }) {
  if (role !== "admin") return null;
  const { health, available, reason } = await loadBackupHealthForAdmin(role);
  return (
    <div className="rounded-lg border p-4 text-sm space-y-2">
      <h2 className="font-medium">Offsite backup health</h2>
      <p className="text-xs text-muted-foreground">
        Google Drive copies of the database and Storage. This card does not
        enable accounting and does not expose backup files.
      </p>
      {!available ? (
        <p className="text-xs text-muted-foreground">
          Status unavailable
          {reason === "PRODUCTION_ONLY"
            ? " (production only)."
            : reason === "NO_HEALTH_YET"
              ? " (no completed run yet)."
              : "."}
        </p>
      ) : health ? (
        <ul className="text-xs space-y-1">
          <li>
            Last attempt:{" "}
            <strong>{health.lastAttemptedStatus ?? "none"}</strong>
            {health.lastAttemptedAtUtc ? ` · ${health.lastAttemptedAtUtc}` : ""}
          </li>
          <li>
            Last success:{" "}
            <strong>{health.lastSuccessfulAtUtc ?? "none"}</strong>
            {health.lastSuccessAgeSeconds != null
              ? ` · ${Math.floor(health.lastSuccessAgeSeconds / 3600)}h ago`
              : ""}
          </li>
          <li>
            Database / Storage / Drive / Verify:{" "}
            {health.lastDatabaseResult ?? "—"} / {health.lastStorageResult ?? "—"} /{" "}
            {health.lastDriveUploadResult ?? "—"} /{" "}
            {health.lastVerificationResult ?? "—"}
          </li>
          {health.lastErrorCode ? (
            <li className="text-destructive">Last error: {health.lastErrorCode}</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
