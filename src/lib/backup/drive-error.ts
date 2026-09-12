/**
 * Safe Drive API diagnostics. Never include tokens, URLs with userinfo, or raw bodies.
 */

const SAFE_TOKEN = /^[A-Za-z0-9._-]{1,80}$/;

export class DriveApiError extends Error {
  readonly stage: string;
  readonly status: number;
  readonly reason: string;

  constructor(stage: string, status: number, reason: string) {
    const safeStage = SAFE_TOKEN.test(stage) ? stage : "drive";
    const safeReason = SAFE_TOKEN.test(reason) ? reason : "unknown";
    super(`DRIVE_${safeStage.toUpperCase()}:${status}:${safeReason}`);
    this.name = "DriveApiError";
    this.stage = safeStage;
    this.status = status;
    this.reason = safeReason;
  }
}

export function isRetryableDriveStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function extractGoogleErrorReason(body: string): string {
  if (!body) return "unknown";
  try {
    const json = JSON.parse(body) as {
      error?: {
        status?: string;
        errors?: Array<{ reason?: string }>;
        details?: Array<{ reason?: string }>;
      };
    };
    const err = json.error;
    const nested = err?.errors?.[0]?.reason;
    if (typeof nested === "string" && SAFE_TOKEN.test(nested)) return nested;
    const detail = err?.details?.[0]?.reason;
    if (typeof detail === "string" && SAFE_TOKEN.test(detail)) return detail;
    if (typeof err?.status === "string" && SAFE_TOKEN.test(err.status)) return err.status;
  } catch {
    /* non-JSON body */
  }
  return "unknown";
}

export async function throwDriveApiError(stage: string, res: Response): Promise<never> {
  const body = await res.text().catch(() => "");
  throw new DriveApiError(stage, res.status, extractGoogleErrorReason(body));
}

export function isSafeBackupErrorCode(code: string): boolean {
  return /^[A-Z][A-Z0-9_]{2,80}(?::[A-Za-z0-9._-]{1,80}){0,5}$/.test(code);
}
