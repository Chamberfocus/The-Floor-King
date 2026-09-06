import { NextResponse, type NextRequest } from "next/server";
import { authorizeBackupCronRequest } from "@/lib/backup/authz";
import { driveTokenResponseHasSecrets } from "@/lib/backup/google-auth";
import { runProductionBackup } from "@/lib/backup/production";
import { sanitizeBackupError } from "@/lib/backup/sanitize";
import { ownerEmail, sendEmail, emailLayout } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function alertFailure(code: string) {
  await sendEmail({
    to: ownerEmail(),
    subject: `Floor King backup FAILED (${code})`,
    html: emailLayout(
      "Offsite backup failed",
      `<p>The automated Floor King CRM backup did not complete.</p>
       <p>Error code: <strong>${code.replace(/[<>&]/g, "")}</strong></p>
       <p>No customer data is included in this message. Check Google Drive → Floor King CRM Backups → Logs/health.json and the latest Daily folder.</p>`,
    ),
  });
}

export async function GET(request: NextRequest) {
  const auth = authorizeBackupCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.code }, { status: auth.status });
  }

  try {
    const result = await runProductionBackup(alertFailure);
    const body: Record<string, unknown> = {
      ok: result.status === "SUCCESS" || result.status === "SKIPPED",
      status: result.status,
      backupId: result.backupId,
      errorCode: result.errorCode,
      skippedReason: result.skippedReason ?? null,
    };
    if (driveTokenResponseHasSecrets(body)) {
      return NextResponse.json({ ok: false, error: "RESPONSE_SANITIZED" }, { status: 500 });
    }
    return NextResponse.json(body);
  } catch (err) {
    const code = sanitizeBackupError(err);
    try {
      await alertFailure(/^[A-Z0-9_]+$/.test(code) ? code : "BACKUP_FAILED");
    } catch {
      /* ignore */
    }
    return NextResponse.json({ ok: false, error: "BACKUP_FAILED" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
