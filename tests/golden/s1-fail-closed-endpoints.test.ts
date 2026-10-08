/**
 * S1-1 fail-closed daily cron and Resend webhook.
 * Pure authorization plus source order. No admin client, no database, no network.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { authorizeBackupCronRequest } from "@/lib/backup/authz";
import {
  authorizeDailyCronRequest,
  authorizeResendWebhook,
} from "@/lib/request-auth";

const dailyRoute = readFileSync("src/app/api/cron/daily/route.ts", "utf8");
const resendRoute = readFileSync("src/app/api/resend-webhook/route.ts", "utf8");
const requestAuth = readFileSync("src/lib/request-auth.ts", "utf8");
const backupAuth = readFileSync("src/lib/backup/authz.ts", "utf8");
const backupRoute = readFileSync("src/app/api/cron/backup/route.ts", "utf8");

function handler(source: string, name: "GET" | "POST"): string {
  const start = source.indexOf(`export async function ${name}`);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start);
}

const headers = (authorization: string | null) => ({
  get: (name: string) => (name.toLowerCase() === "authorization" ? authorization : null),
});

describe("daily cron authorization", () => {
  it("rejects a missing cron secret before any admin client can be built", () => {
    expect(authorizeDailyCronRequest({ headers: headers("Bearer anything") }, {})).toEqual({
      ok: false,
      status: 401,
      code: "CRON_SECRET_MISSING",
    });
    expect(
      authorizeDailyCronRequest(
        { headers: headers(null) },
        { CRON_SECRET: "" },
      ),
    ).toEqual({ ok: false, status: 401, code: "CRON_SECRET_MISSING" });

    const get = handler(dailyRoute, "GET");
    const guard = get.indexOf("if (!auth.ok)");
    const admin = get.indexOf("createAdminClient()");
    expect(get.indexOf("authorizeDailyCronRequest")).toBeGreaterThanOrEqual(0);
    expect(guard).toBeGreaterThan(-1);
    expect(admin).toBeGreaterThan(guard);
    expect(requestAuth).not.toMatch(/createAdminClient|supabase|from\(/);
  });

  it("rejects an invalid bearer", () => {
    const env = { CRON_SECRET: "secret", VERCEL_ENV: "production" };
    expect(authorizeDailyCronRequest({ headers: headers("Bearer nope") }, env)).toEqual({
      ok: false,
      status: 401,
      code: "CRON_UNAUTHORIZED",
    });
    expect(authorizeDailyCronRequest({ headers: headers(null) }, env)).toEqual({
      ok: false,
      status: 401,
      code: "CRON_UNAUTHORIZED",
    });
    expect(authorizeDailyCronRequest({ headers: headers("secret") }, env)).toEqual({
      ok: false,
      status: 401,
      code: "CRON_UNAUTHORIZED",
    });
    expect(authorizeDailyCronRequest({ headers: headers("Bearer secret ") }, env).ok).toBe(false);
  });

  it("rejects preview and every non-production runtime even with the correct bearer", () => {
    for (const VERCEL_ENV of ["preview", "development", undefined] as const) {
      expect(
        authorizeDailyCronRequest(
          { headers: headers("Bearer secret") },
          { CRON_SECRET: "secret", VERCEL_ENV, BACKUP_ALLOW_NON_PRODUCTION: "1" },
        ),
      ).toEqual({ ok: false, status: 403, code: "PRODUCTION_ONLY" });
    }
    expect(requestAuth).not.toContain("BACKUP_ALLOW_NON_PRODUCTION");
  });

  it("accepts the correct bearer in production", () => {
    expect(
      authorizeDailyCronRequest(
        { headers: headers("Bearer secret") },
        { CRON_SECRET: "secret", VERCEL_ENV: "production" },
      ),
    ).toEqual({ ok: true });
    const get = handler(dailyRoute, "GET");
    expect(get.indexOf("createAdminClient()")).toBeGreaterThan(get.indexOf("if (!auth.ok)"));
    expect(get).toContain("thankyou");
  });
});

describe("Resend webhook authorization", () => {
  it("rejects a missing secret before any database write", () => {
    expect(authorizeResendWebhook("anything", {})).toEqual({
      ok: false,
      status: 401,
      code: "RESEND_WEBHOOK_SECRET_MISSING",
    });
    expect(authorizeResendWebhook(null, { RESEND_WEBHOOK_SECRET: "" })).toEqual({
      ok: false,
      status: 401,
      code: "RESEND_WEBHOOK_SECRET_MISSING",
    });

    const post = handler(resendRoute, "POST");
    const guard = post.indexOf("if (!auth.ok)");
    expect(post.indexOf("authorizeResendWebhook")).toBeGreaterThanOrEqual(0);
    expect(guard).toBeGreaterThan(-1);
    expect(post.indexOf("request.json()")).toBeGreaterThan(guard);
    expect(post.indexOf("createAdminClient()")).toBeGreaterThan(guard);
    expect(post.indexOf("estimate_events")).toBeGreaterThan(guard);
    expect(requestAuth).not.toMatch(/createAdminClient|supabase|\.insert\(|\.update\(/);
  });

  it("rejects an invalid or missing key", () => {
    const env = { RESEND_WEBHOOK_SECRET: "hook-secret" };
    expect(authorizeResendWebhook("wrong", env)).toEqual({
      ok: false,
      status: 401,
      code: "RESEND_WEBHOOK_UNAUTHORIZED",
    });
    expect(authorizeResendWebhook(null, env)).toEqual({
      ok: false,
      status: 401,
      code: "RESEND_WEBHOOK_UNAUTHORIZED",
    });
    expect(authorizeResendWebhook("", env)).toEqual({
      ok: false,
      status: 401,
      code: "RESEND_WEBHOOK_UNAUTHORIZED",
    });
    expect(authorizeResendWebhook("hook-secret-extra", env).ok).toBe(false);
  });

  it("lets the correct key reach the existing delivery handler", () => {
    expect(authorizeResendWebhook("hook-secret", { RESEND_WEBHOOK_SECRET: "hook-secret" })).toEqual({
      ok: true,
    });
    const post = handler(resendRoute, "POST");
    const guard = post.indexOf("if (!auth.ok)");
    const insert = post.indexOf('.from("estimate_events").insert');
    expect(insert).toBeGreaterThan(guard);
    expect(post.slice(guard)).toContain("viewed_at");
    expect(post.slice(guard)).toContain("email_opened");
  });
});

describe("backup authorization stays on its own helper", () => {
  it("still fails closed, still allows the non-production override, and is not wired to daily cron", () => {
    expect(
      authorizeBackupCronRequest({ headers: headers("Bearer x") }, {}),
    ).toEqual({ ok: false, status: 401, code: "CRON_SECRET_MISSING" });
    expect(
      authorizeBackupCronRequest(
        { headers: headers("Bearer secret") },
        { CRON_SECRET: "secret", VERCEL_ENV: "preview", BACKUP_ALLOW_NON_PRODUCTION: "1" },
      ).ok,
    ).toBe(true);
    expect(backupAuth).toContain("BACKUP_ALLOW_NON_PRODUCTION");
    expect(backupRoute).toContain("authorizeBackupCronRequest");
    expect(dailyRoute).not.toContain("authorizeBackupCronRequest");
    expect(resendRoute).not.toContain("authorizeBackupCronRequest");
  });
});
