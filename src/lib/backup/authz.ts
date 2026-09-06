import { timingSafeEqual } from "node:crypto";
import type { UserRole } from "@/lib/types";

export const BACKUP_ALLOWED_INVOKE_ROLES: UserRole[] = ["admin"];

export function isProductionRuntime(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.VERCEL_ENV === "production";
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; code: string };

/**
 * Fail closed: missing secret, wrong bearer, non-production, and ordinary
 * CRM sessions are all rejected. Vercel Cron sends Authorization: Bearer CRON_SECRET.
 */
export function authorizeBackupCronRequest(
  request: { headers: { get(name: string): string | null } },
  env: Record<string, string | undefined> = process.env,
): CronAuthResult {
  const secret = env.CRON_SECRET;
  if (!secret) return { ok: false, status: 401, code: "CRON_SECRET_MISSING" };
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!safeEqual(header, expected)) {
    return { ok: false, status: 401, code: "CRON_UNAUTHORIZED" };
  }
  if (!isProductionRuntime(env) && env.BACKUP_ALLOW_NON_PRODUCTION !== "1") {
    return { ok: false, status: 403, code: "PRODUCTION_ONLY" };
  }
  return { ok: true };
}

export function roleMayInvokeBackup(role: UserRole | null | undefined): boolean {
  return role === "admin";
}

export function roleMayViewBackupHealth(role: UserRole | null | undefined): boolean {
  return role === "admin";
}

export function roleMayAccessBackupArtifacts(role: UserRole | null | undefined): boolean {
  void role;
  return false;
}
