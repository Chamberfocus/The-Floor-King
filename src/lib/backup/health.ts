import { BACKUP_ROOT_FOLDER_ID, FOLDER_LOGS, HEALTH_FILE_NAME } from "./constants";
import { GoogleDriveClient } from "./google-drive";
import { emptyHealth, type BackupHealth } from "./manifest";
import { getProductionBackupOidcToken, getProductionDriveAccessToken } from "./oidc";
import { isProductionRuntime, roleMayViewBackupHealth } from "./authz";
import type { UserRole } from "@/lib/types";

export async function loadBackupHealthForAdmin(
  role: UserRole | null | undefined,
): Promise<{ health: BackupHealth | null; available: boolean; reason: string | null }> {
  if (!roleMayViewBackupHealth(role)) {
    return { health: null, available: false, reason: "ADMIN_ONLY" };
  }
  if (!isProductionRuntime()) {
    return { health: null, available: false, reason: "PRODUCTION_ONLY" };
  }
  try {
    const oidc = await getProductionBackupOidcToken();
    const access = await getProductionDriveAccessToken(oidc);
    const drive = new GoogleDriveClient(access);
    await drive.getFile(BACKUP_ROOT_FOLDER_ID);
    const rootKids = await drive.listChildren(BACKUP_ROOT_FOLDER_ID);
    const logs = rootKids.find((k) => k.name === FOLDER_LOGS);
    if (!logs) return { health: emptyHealth(), available: true, reason: "NO_HEALTH_YET" };
    const kids = await drive.listChildren(logs.id);
    const file = kids.find((k) => k.name === HEALTH_FILE_NAME);
    if (!file) return { health: emptyHealth(), available: true, reason: "NO_HEALTH_YET" };
    const raw = await drive.readBytes(file.id);
    const health = JSON.parse(Buffer.from(raw).toString("utf8")) as BackupHealth;
    return { health, available: true, reason: null };
  } catch {
    return { health: null, available: false, reason: "HEALTH_UNAVAILABLE" };
  }
}
