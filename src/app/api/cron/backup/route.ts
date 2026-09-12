import { NextResponse, type NextRequest } from "next/server";
import { authorizeBackupCronRequest } from "@/lib/backup/authz";
import { isSafeBackupErrorCode } from "@/lib/backup/drive-error";
import { driveTokenResponseHasSecrets } from "@/lib/backup/google-auth";
import { runProductionBackup } from "@/lib/backup/production";
import { sanitizeBackupError } from "@/lib/backup/sanitize";
import { ownerEmail, sendEmail, emailLayout } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

function safeCodeForEmail(code: string): string {
  const trimmed = code.replace(/[<>&]/g, "").slice(0, 120);
  return isSafeBackupErrorCode(trimmed) ? trimmed : "BACKUP_FAILED";
}

async function alertFailure(code: string) {
  const safe = safeCodeForEmail(code);
  await sendEmail({
    to: ownerEmail(),
    subject: `Floor King backup FAILED (${safe})`,
    html: emailLayout(
      "Offsite backup failed",
      `<p>The automated Floor King CRM backup did not complete.</p>
       <p>Error code: <strong>${safe}</strong></p>
       <p>No customer data is included in this message. Check Google Drive → Floor King CRM Backups → Logs/health.json and the latest Daily folder.</p>`,
    ),
  });
}

async function alertSuccess(info: { backupId: string; dumpBytes: number }) {
  const id = /^[0-9a-f-]{36}$/i.test(info.backupId) ? info.backupId : "unknown";
  const bytes = Number.isFinite(info.dumpBytes) ? String(Math.max(0, Math.floor(info.dumpBytes))) : "unknown";
  await sendEmail({
    to: ownerEmail(),
    subject: "Floor King backup SUCCESS",
    html: emailLayout(
      "Offsite backup completed",
      `<p>The automated Floor King CRM backup completed.</p>
       <p>Backup id: <strong>${id}</strong></p>
       <p>Database dump size: <strong>${bytes}</strong> bytes.</p>
       <p>No customer data is included in this message.</p>`,
    ),
  });
}

export async function GET(request: NextRequest) {
  const auth = authorizeBackupCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.code }, { status: auth.status });
  }

  try {
    const result = await runProductionBackup(alertFailure, alertSuccess);
    const body: Record<string, unknown> = {
      ok: result.status === "SUCCESS" || result.status === "SKIPPED",
      status: result.status,
      backupId: result.backupId,
      errorCode: result.errorCode,
      dumpBytes: result.dumpBytes ?? null,
      skippedReason: result.skippedReason ?? null,
      runtime: { platform: process.platform, arch: process.arch },
    };
    if (driveTokenResponseHasSecrets(body)) {
      return NextResponse.json({ ok: false, error: "RESPONSE_SANITIZED" }, { status: 500 });
    }
    return NextResponse.json(body);
  } catch (err) {
    const code = sanitizeBackupError(err);
    try {
      await alertFailure(isSafeBackupErrorCode(code) ? code : "BACKUP_FAILED");
    } catch {
      /* ignore */
    }
    return NextResponse.json({ ok: false, error: "BACKUP_FAILED" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
