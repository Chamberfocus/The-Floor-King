import { timingSafeEqual } from "node:crypto";
import type { UserRole } from "@/lib/types";
import {
  GITHUB_BACKUP_OIDC_HEADER,
  verifyGitHubBackupOidc,
  type GitHubBackupOidcDeps,
} from "@/lib/backup/github-oidc";

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

function productionGate(env: Record<string, string | undefined>): CronAuthResult {
  if (!isProductionRuntime(env) && env.BACKUP_ALLOW_NON_PRODUCTION !== "1") {
    return { ok: false, status: 403, code: "PRODUCTION_ONLY" };
  }
  return { ok: true };
}

function looksLikeJwt(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

/**
 * Fail closed: missing secret, wrong bearer, non-production, and ordinary
 * CRM sessions are all rejected. Vercel Cron sends Authorization: Bearer CRON_SECRET.
 * GitHub Actions may instead present a short-lived OIDC token in
 * x-floor-king-github-oidc. Either proof must pass before the backup runs.
 */
export async function authorizeBackupCronRequest(
  request: { headers: { get(name: string): string | null } },
  env: Record<string, string | undefined> = process.env,
  deps?: GitHubBackupOidcDeps,
): Promise<CronAuthResult> {
  const secret = env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  if (secret && safeEqual(authorization, `Bearer ${secret}`)) {
    return productionGate(env);
  }

  const oidc = request.headers.get(GITHUB_BACKUP_OIDC_HEADER);
  if (oidc && looksLikeJwt(oidc.trim())) {
    try {
      const verified = await verifyGitHubBackupOidc(oidc.trim(), {
        now: deps?.now,
        fetchJwks: deps?.fetchJwks,
      });
      if (!verified.ok) return { ok: false, status: 401, code: verified.code };
      return productionGate(env);
    } catch {
      return { ok: false, status: 401, code: "GITHUB_OIDC_REJECTED" };
    }
  }

  if (!secret) return { ok: false, status: 401, code: "CRON_SECRET_MISSING" };
  return { ok: false, status: 401, code: "CRON_UNAUTHORIZED" };
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
