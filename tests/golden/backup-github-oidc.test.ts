import { createSign, generateKeyPairSync, type JsonWebKey, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { authorizeBackupCronRequest } from "@/lib/backup/authz";
import {
  clearGitHubJwksCache,
  fetchGitHubBackupJwks,
  GITHUB_BACKUP_JWKS_URL,
  GITHUB_BACKUP_OIDC_AUDIENCE,
  GITHUB_BACKUP_OIDC_HEADER,
  GITHUB_BACKUP_OIDC_ISSUER,
  GITHUB_BACKUP_REPOSITORY,
  GITHUB_BACKUP_REPOSITORY_ID,
  GITHUB_BACKUP_SUBJECT,
  GITHUB_BACKUP_WORKFLOW_FILE,
  GITHUB_BACKUP_WORKFLOW_NAME,
  GITHUB_BACKUP_WORKFLOW_REF,
  verifyGitHubBackupOidc,
} from "@/lib/backup/github-oidc";

const NOW = new Date("2026-10-15T08:15:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const SHA = "a".repeat(40);

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey & { kid?: string; use?: string; alg?: string };
jwk.kid = "test-key";
jwk.use = "sig";
jwk.alg = "RS256";

function sign(
  payload: Record<string, unknown>,
  options?: { alg?: string; kid?: string | null; key?: KeyObject; extraHeader?: Record<string, unknown> },
): string {
  const header: Record<string, unknown> = {
    alg: options?.alg ?? "RS256",
    typ: "JWT",
    ...options?.extraHeader,
  };
  if (options?.kid !== null) header.kid = options?.kid ?? "test-key";
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${encodedHeader}.${encodedPayload}`;
  if (header.alg === "none") return `${data}.`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  const signature = signer.sign(options?.key ?? privateKey).toString("base64url");
  return `${data}.${signature}`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: GITHUB_BACKUP_OIDC_ISSUER,
    aud: GITHUB_BACKUP_OIDC_AUDIENCE,
    sub: GITHUB_BACKUP_SUBJECT,
    repository: GITHUB_BACKUP_REPOSITORY,
    repository_owner: "Chamberfocus",
    repository_id: GITHUB_BACKUP_REPOSITORY_ID,
    ref: "refs/heads/main",
    ref_type: "branch",
    sha: SHA,
    workflow: GITHUB_BACKUP_WORKFLOW_NAME,
    workflow_ref: GITHUB_BACKUP_WORKFLOW_REF,
    workflow_sha: SHA,
    job_workflow_ref: GITHUB_BACKUP_WORKFLOW_REF,
    job_workflow_sha: SHA,
    event_name: "schedule",
    runner_environment: "github-hosted",
    iat: NOW_SECONDS,
    nbf: NOW_SECONDS - 600,
    exp: NOW_SECONDS + 300,
    ...overrides,
  };
}

const fetchJwks = async () => ({ keys: [jwk] });

function headers(values: Record<string, string | null>) {
  return {
    get: (name: string) => values[name.toLowerCase()] ?? null,
  };
}

describe("GitHub backup identity token", () => {
  it("accepts a token for this repository, workflow, issuer, and audience", async () => {
    const result = await verifyGitHubBackupOidc(sign(claims()), { now: NOW, fetchJwks });
    expect(result).toEqual({ ok: true });
    const numericId = await verifyGitHubBackupOidc(
      sign(claims({ repository_id: Number(GITHUB_BACKUP_REPOSITORY_ID), event_name: "workflow_dispatch" })),
      { now: NOW, fetchJwks },
    );
    expect(numericId).toEqual({ ok: true });
  });

  it("rejects expired, early, and long-lived tokens", async () => {
    const expired = await verifyGitHubBackupOidc(
      sign(claims({ iat: NOW_SECONDS - 400, nbf: NOW_SECONDS - 1000, exp: NOW_SECONDS - 60 })),
      { now: NOW, fetchJwks },
    );
    expect(expired).toEqual({ ok: false, code: "GITHUB_OIDC_EXPIRED" });

    const early = await verifyGitHubBackupOidc(
      sign(claims({ iat: NOW_SECONDS + 120, nbf: NOW_SECONDS + 120, exp: NOW_SECONDS + 420 })),
      { now: NOW, fetchJwks },
    );
    expect(early).toEqual({ ok: false, code: "GITHUB_OIDC_NOT_YET_VALID" });

    const longLived = await verifyGitHubBackupOidc(
      sign(claims({ exp: NOW_SECONDS + 601 })),
      { now: NOW, fetchJwks },
    );
    expect(longLived).toEqual({ ok: false, code: "GITHUB_OIDC_LIFETIME" });
  });

  it("rejects the wrong issuer, audience, repository, workflow, ref, and event", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ iss: "https://example.invalid" }, "GITHUB_OIDC_WRONG_ISSUER"],
      [{ aud: "https://github.com/Chamberfocus" }, "GITHUB_OIDC_WRONG_AUDIENCE"],
      [{ aud: [GITHUB_BACKUP_OIDC_AUDIENCE, "https://example.invalid"] }, "GITHUB_OIDC_WRONG_AUDIENCE"],
      [{ repository: "Chamberfocus/other" }, "GITHUB_OIDC_WRONG_REPOSITORY"],
      [{ repository_owner: "someone-else" }, "GITHUB_OIDC_WRONG_REPOSITORY"],
      [{ repository_id: "1" }, "GITHUB_OIDC_WRONG_REPOSITORY"],
      [{ sub: "repo:Chamberfocus/The-Floor-King:pull_request" }, "GITHUB_OIDC_WRONG_SUBJECT"],
      [{ ref: "refs/pull/72/merge" }, "GITHUB_OIDC_WRONG_REF"],
      [{ ref_type: "tag" }, "GITHUB_OIDC_WRONG_REF"],
      [
        { workflow_ref: "Chamberfocus/The-Floor-King/.github/workflows/other.yml@refs/heads/main" },
        "GITHUB_OIDC_WRONG_WORKFLOW",
      ],
      [{ job_workflow_ref: "evil/repo/.github/workflows/production-backup.yml@refs/heads/main" }, "GITHUB_OIDC_WRONG_WORKFLOW"],
      [{ workflow: "Some other workflow" }, "GITHUB_OIDC_WRONG_WORKFLOW"],
      [{ runner_environment: "self-hosted" }, "GITHUB_OIDC_WRONG_WORKFLOW"],
      [{ event_name: "pull_request" }, "GITHUB_OIDC_WRONG_EVENT"],
      [{ event_name: "push" }, "GITHUB_OIDC_WRONG_EVENT"],
    ];
    for (const [override, code] of cases) {
      const result = await verifyGitHubBackupOidc(sign(claims(override)), { now: NOW, fetchJwks });
      expect(result, JSON.stringify(override)).toEqual({ ok: false, code });
    }
  });

  it("rejects unsigned, confused-algorithm, and wrong-key tokens", async () => {
    const unsigned = sign(claims(), { alg: "none" });
    expect(await verifyGitHubBackupOidc(`${unsigned}ignored`, { now: NOW, fetchJwks })).toEqual({
      ok: false,
      code: "GITHUB_OIDC_UNSUPPORTED",
    });
    expect(await verifyGitHubBackupOidc(unsigned, { now: NOW, fetchJwks })).toEqual({
      ok: false,
      code: "GITHUB_OIDC_MALFORMED",
    });
    expect(await verifyGitHubBackupOidc(sign(claims(), { alg: "HS256" }), { now: NOW, fetchJwks })).toEqual({
      ok: false,
      code: "GITHUB_OIDC_UNSUPPORTED",
    });
    expect(
      await verifyGitHubBackupOidc(sign(claims(), { extraHeader: { jku: "https://evil.example/jwks" } }), {
        now: NOW,
        fetchJwks,
      }),
    ).toEqual({ ok: false, code: "GITHUB_OIDC_UNSUPPORTED" });
    expect(await verifyGitHubBackupOidc(sign(claims(), { kid: null }), { now: NOW, fetchJwks })).toEqual({
      ok: false,
      code: "GITHUB_OIDC_MALFORMED",
    });
    expect(await verifyGitHubBackupOidc("not-a-token", { now: NOW, fetchJwks })).toEqual({
      ok: false,
      code: "GITHUB_OIDC_MALFORMED",
    });
    expect(
      await verifyGitHubBackupOidc(sign(claims(), { key: other.privateKey }), { now: NOW, fetchJwks }),
    ).toEqual({ ok: false, code: "GITHUB_OIDC_BAD_SIGNATURE" });
    expect(await verifyGitHubBackupOidc(sign(claims(), { kid: "missing-key" }), { now: NOW, fetchJwks })).toEqual({
      ok: false,
      code: "GITHUB_OIDC_BAD_SIGNATURE",
    });
    let fetches = 0;
    const failing = await verifyGitHubBackupOidc(sign(claims()), {
      now: NOW,
      fetchJwks: async () => {
        fetches += 1;
        throw new Error("network down");
      },
    });
    expect(failing).toEqual({ ok: false, code: "GITHUB_OIDC_REJECTED" });
    if (failing.ok) throw new Error("expected rejection");
    expect(failing.code).not.toContain("network");
    expect(fetches).toBe(1);
  });

  it("asks GitHub's published key endpoint and does not follow a redirect", async () => {
    clearGitHubJwksCache();
    const calls: Array<{ url: string; redirect: string | undefined }> = [];
    const keys = await fetchGitHubBackupJwks({
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), redirect: init?.redirect });
        return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
      },
    });
    expect(keys.keys).toHaveLength(1);
    expect(calls).toEqual([{ url: GITHUB_BACKUP_JWKS_URL, redirect: "error" }]);
    clearGitHubJwksCache();
  });
});

describe("backup route accepts either proof", () => {
  const token = sign(claims());

  it("keeps the existing production cron secret working", async () => {
    expect(
      await authorizeBackupCronRequest(
        { headers: headers({ authorization: "Bearer secret", [GITHUB_BACKUP_OIDC_HEADER]: "a.b.c" }) },
        { CRON_SECRET: "secret", VERCEL_ENV: "production" },
        { now: NOW, fetchJwks },
      ),
    ).toEqual({ ok: true });
  });

  it("accepts the GitHub token in production without the cron secret", async () => {
    expect(
      await authorizeBackupCronRequest(
        { headers: headers({ [GITHUB_BACKUP_OIDC_HEADER]: token }) },
        { VERCEL_ENV: "production" },
        { now: NOW, fetchJwks },
      ),
    ).toEqual({ ok: true });
  });

  it("rejects a GitHub token outside production and a token presented as the cron secret", async () => {
    expect(
      await authorizeBackupCronRequest(
        { headers: headers({ [GITHUB_BACKUP_OIDC_HEADER]: token }) },
        { VERCEL_ENV: "preview" },
        { now: NOW, fetchJwks },
      ),
    ).toEqual({ ok: false, status: 403, code: "PRODUCTION_ONLY" });
    expect(
      await authorizeBackupCronRequest(
        { headers: headers({ authorization: `Bearer ${token}` }) },
        { CRON_SECRET: "secret", VERCEL_ENV: "production" },
        { now: NOW, fetchJwks },
      ),
    ).toEqual({ ok: false, status: 401, code: "CRON_UNAUTHORIZED" });
    expect(
      await authorizeBackupCronRequest(
        { headers: headers({ [GITHUB_BACKUP_OIDC_HEADER]: sign(claims({ event_name: "pull_request" })) }) },
        { CRON_SECRET: "secret", VERCEL_ENV: "production" },
        { now: NOW, fetchJwks },
      ),
    ).toEqual({ ok: false, status: 401, code: "GITHUB_OIDC_WRONG_EVENT" });
  });

  it("pins the workflow to the daily production backup file", () => {
    expect(GITHUB_BACKUP_WORKFLOW_REF).toContain(`${GITHUB_BACKUP_WORKFLOW_FILE}@refs/heads/main`);
    const workflow = readFileSync(GITHUB_BACKUP_WORKFLOW_FILE, "utf8");
    const route = readFileSync("src/app/api/cron/backup/route.ts", "utf8");
    expect(workflow).toContain('cron: "15 8 * * *"');
    expect(workflow).toContain(`AUDIENCE: ${GITHUB_BACKUP_OIDC_AUDIENCE}`);
    expect(workflow).toContain('header = "x-floor-king-github-oidc:');
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("github.repository == 'Chamberfocus/The-Floor-King'");
    expect(workflow).not.toMatch(/CRON_SECRET|BEGIN PRIVATE KEY|supabase/i);
    const authAt = route.indexOf("const auth = await authorizeBackupCronRequest");
    const runAt = route.indexOf("await runProductionBackup");
    expect(authAt).toBeGreaterThan(-1);
    expect(runAt).toBeGreaterThan(authAt);
    const oidc = readFileSync("src/lib/backup/github-oidc.ts", "utf8");
    expect(oidc).not.toMatch(/console\.|posting_enabled|books_of_record/);
  });
});
