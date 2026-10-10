import { timingSafeEqual } from "node:crypto";

export type RequestAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; code: string };

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Daily cron. Fail closed: a missing secret or a bad bearer is 401, and any
 * runtime that is not Vercel production is 403. There is no non-production
 * override. Legitimate production cron sends Authorization: Bearer CRON_SECRET.
 */
export function authorizeDailyCronRequest(
  request: { headers: { get(name: string): string | null } },
  env: Record<string, string | undefined> = process.env,
): RequestAuthResult {
  const secret = env.CRON_SECRET;
  if (!secret) return { ok: false, status: 401, code: "CRON_SECRET_MISSING" };
  const header = request.headers.get("authorization") ?? "";
  if (!safeEqual(header, `Bearer ${secret}`)) {
    return { ok: false, status: 401, code: "CRON_UNAUTHORIZED" };
  }
  if (env.VERCEL_ENV !== "production") {
    return { ok: false, status: 403, code: "PRODUCTION_ONLY" };
  }
  return { ok: true };
}

/**
 * Resend delivery webhook. Fail closed: a missing RESEND_WEBHOOK_SECRET or a
 * missing/wrong ?key= is 401. A matching key continues into the existing handler.
 */
export function authorizeResendWebhook(
  key: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): RequestAuthResult {
  const secret = env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return { ok: false, status: 401, code: "RESEND_WEBHOOK_SECRET_MISSING" };
  }
  if (!key || !safeEqual(key, secret)) {
    return { ok: false, status: 401, code: "RESEND_WEBHOOK_UNAUTHORIZED" };
  }
  return { ok: true };
}
