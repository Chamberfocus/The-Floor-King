import { createPublicKey, verify as verifySignature, type JsonWebKey } from "node:crypto";

/** Header the production backup route accepts from GitHub Actions. */
export const GITHUB_BACKUP_OIDC_HEADER = "x-floor-king-github-oidc";

export const GITHUB_BACKUP_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const GITHUB_BACKUP_OIDC_AUDIENCE = "https://floorking-crm.vercel.app/api/cron/backup";
export const GITHUB_BACKUP_JWKS_URL = "https://token.actions.githubusercontent.com/.well-known/jwks";
export const GITHUB_BACKUP_REPOSITORY = "Chamberfocus/The-Floor-King";
export const GITHUB_BACKUP_REPOSITORY_ID = "1257230738";
export const GITHUB_BACKUP_REPOSITORY_OWNER = "Chamberfocus";
export const GITHUB_BACKUP_REF = "refs/heads/main";
export const GITHUB_BACKUP_SUBJECT = "repo:Chamberfocus/The-Floor-King:ref:refs/heads/main";
export const GITHUB_BACKUP_WORKFLOW_NAME = "Production backup";
export const GITHUB_BACKUP_WORKFLOW_FILE = ".github/workflows/production-backup.yml";
export const GITHUB_BACKUP_WORKFLOW_REF =
  "Chamberfocus/The-Floor-King/.github/workflows/production-backup.yml@refs/heads/main";

const ALLOWED_EVENTS = new Set(["schedule", "workflow_dispatch"]);
const MAX_TOKEN_CHARS = 12_000;
const CLOCK_SKEW_SECONDS = 15;
/** GitHub's sample token is valid for 5 minutes after iat and 15 minutes after nbf. */
const MAX_IAT_TO_EXP_SECONDS = 10 * 60;
const MAX_NBF_TO_EXP_SECONDS = 20 * 60;
const JWKS_CACHE_MS = 10 * 60 * 1000;

type RsaJwk = JsonWebKey & { kid?: string; use?: string; alg?: string };

export type GitHubOidcResult = { ok: true } | { ok: false; code: string };

export type GitHubBackupOidcDeps = {
  now?: Date;
  fetchJwks?: (args: { refresh: boolean }) => Promise<{ keys: RsaJwk[] }>;
};

let jwksCache: { keys: RsaJwk[]; expiresAt: number } | null = null;

export function clearGitHubJwksCache(): void {
  jwksCache = null;
}

export async function fetchGitHubBackupJwks(options?: {
  refresh?: boolean;
  nowMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ keys: RsaJwk[] }> {
  const nowMs = options?.nowMs ?? Date.now();
  if (!options?.refresh && jwksCache && jwksCache.expiresAt > nowMs) {
    return { keys: jwksCache.keys };
  }
  const fetchImpl = options?.fetchImpl ?? fetch;
  const response = await fetchImpl(GITHUB_BACKUP_JWKS_URL, {
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("GITHUB_JWKS_UNAVAILABLE");
  const body = (await response.json()) as { keys?: unknown };
  if (!Array.isArray(body.keys) || body.keys.length === 0) throw new Error("GITHUB_JWKS_UNAVAILABLE");
  const keys = body.keys.filter(isRsaJwk);
  if (keys.length === 0) throw new Error("GITHUB_JWKS_UNAVAILABLE");
  jwksCache = { keys, expiresAt: nowMs + JWKS_CACHE_MS };
  return { keys };
}

function isRsaJwk(value: unknown): value is RsaJwk {
  if (!value || typeof value !== "object") return false;
  const key = value as RsaJwk;
  return key.kty === "RSA" && typeof key.n === "string" && typeof key.e === "string";
}

function decodeJson(part: string): unknown {
  const json = Buffer.from(part, "base64url").toString("utf8");
  return JSON.parse(json);
}

function numberClaim(payload: Record<string, unknown>, name: string): number | null {
  const value = payload[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringClaim(payload: Record<string, unknown>, name: string): string | null {
  const value = payload[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function audienceMatches(payload: Record<string, unknown>): boolean {
  const aud = payload.aud;
  if (typeof aud === "string") return aud === GITHUB_BACKUP_OIDC_AUDIENCE;
  if (!Array.isArray(aud) || aud.length !== 1) return false;
  return aud[0] === GITHUB_BACKUP_OIDC_AUDIENCE;
}

function idMatches(payload: Record<string, unknown>, name: string, expected: string): boolean {
  const value = payload[name];
  return value === expected || value === Number(expected);
}

function claimError(payload: Record<string, unknown>, nowSeconds: number): string | null {
  const exp = numberClaim(payload, "exp");
  const nbf = numberClaim(payload, "nbf");
  const iat = numberClaim(payload, "iat");
  if (exp == null || nbf == null || iat == null) return "GITHUB_OIDC_MALFORMED";
  if (exp + CLOCK_SKEW_SECONDS <= nowSeconds) return "GITHUB_OIDC_EXPIRED";
  if (nbf - CLOCK_SKEW_SECONDS > nowSeconds || iat - CLOCK_SKEW_SECONDS > nowSeconds) {
    return "GITHUB_OIDC_NOT_YET_VALID";
  }
  if (exp <= iat || exp - iat > MAX_IAT_TO_EXP_SECONDS || exp <= nbf || exp - nbf > MAX_NBF_TO_EXP_SECONDS) {
    return "GITHUB_OIDC_LIFETIME";
  }
  if (nbf > iat) return "GITHUB_OIDC_LIFETIME";
  if (stringClaim(payload, "iss") !== GITHUB_BACKUP_OIDC_ISSUER) return "GITHUB_OIDC_WRONG_ISSUER";
  if (!audienceMatches(payload)) return "GITHUB_OIDC_WRONG_AUDIENCE";
  if (
    stringClaim(payload, "repository") !== GITHUB_BACKUP_REPOSITORY ||
    stringClaim(payload, "repository_owner") !== GITHUB_BACKUP_REPOSITORY_OWNER ||
    !idMatches(payload, "repository_id", GITHUB_BACKUP_REPOSITORY_ID)
  ) {
    return "GITHUB_OIDC_WRONG_REPOSITORY";
  }
  if (stringClaim(payload, "sub") !== GITHUB_BACKUP_SUBJECT) return "GITHUB_OIDC_WRONG_SUBJECT";
  if (stringClaim(payload, "ref") !== GITHUB_BACKUP_REF || stringClaim(payload, "ref_type") !== "branch") {
    return "GITHUB_OIDC_WRONG_REF";
  }
  const sha = stringClaim(payload, "sha");
  const workflowSha = stringClaim(payload, "workflow_sha");
  const jobWorkflowSha = stringClaim(payload, "job_workflow_sha");
  const shaOk = (value: string | null) => value != null && /^[0-9a-f]{40}$/.test(value);
  if (
    stringClaim(payload, "workflow") !== GITHUB_BACKUP_WORKFLOW_NAME ||
    stringClaim(payload, "workflow_ref") !== GITHUB_BACKUP_WORKFLOW_REF ||
    stringClaim(payload, "job_workflow_ref") !== GITHUB_BACKUP_WORKFLOW_REF ||
    !shaOk(sha) ||
    !shaOk(workflowSha) ||
    !shaOk(jobWorkflowSha)
  ) {
    return "GITHUB_OIDC_WRONG_WORKFLOW";
  }
  const eventName = stringClaim(payload, "event_name");
  if (!eventName || !ALLOWED_EVENTS.has(eventName)) return "GITHUB_OIDC_WRONG_EVENT";
  if (stringClaim(payload, "runner_environment") !== "github-hosted") return "GITHUB_OIDC_WRONG_WORKFLOW";
  return null;
}

function publicKeyForKid(keys: RsaJwk[], kid: string) {
  const matches = keys.filter((key) => {
    if (key.kid !== kid) return false;
    if (key.use && key.use !== "sig") return false;
    if (key.alg && key.alg !== "RS256") return false;
    return true;
  });
  if (matches.length !== 1) return null;
  return createPublicKey({ key: matches[0], format: "jwk" });
}

export async function verifyGitHubBackupOidc(
  token: string,
  options: GitHubBackupOidcDeps = {},
): Promise<GitHubOidcResult> {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_CHARS) {
    return { ok: false, code: "GITHUB_OIDC_MALFORMED" };
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    return { ok: false, code: "GITHUB_OIDC_MALFORMED" };
  }
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    const decodedHeader = decodeJson(parts[0]);
    const decodedPayload = decodeJson(parts[1]);
    if (!decodedHeader || typeof decodedHeader !== "object" || Array.isArray(decodedHeader)) {
      return { ok: false, code: "GITHUB_OIDC_MALFORMED" };
    }
    if (!decodedPayload || typeof decodedPayload !== "object" || Array.isArray(decodedPayload)) {
      return { ok: false, code: "GITHUB_OIDC_MALFORMED" };
    }
    header = decodedHeader as Record<string, unknown>;
    payload = decodedPayload as Record<string, unknown>;
  } catch {
    return { ok: false, code: "GITHUB_OIDC_MALFORMED" };
  }
  if (header.alg !== "RS256" || header.jku || header.jwk || header.x5u || header.crit) {
    return { ok: false, code: "GITHUB_OIDC_UNSUPPORTED" };
  }
  if (header.typ != null && header.typ !== "JWT") return { ok: false, code: "GITHUB_OIDC_UNSUPPORTED" };
  const kid = header.kid;
  if (typeof kid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(kid)) {
    return { ok: false, code: "GITHUB_OIDC_MALFORMED" };
  }

  const fetchJwks = options.fetchJwks ?? ((args) => fetchGitHubBackupJwks({ refresh: args.refresh }));
  let keys: RsaJwk[];
  try {
    keys = (await fetchJwks({ refresh: false })).keys;
  } catch {
    return { ok: false, code: "GITHUB_OIDC_REJECTED" };
  }
  let key = publicKeyForKid(keys, kid);
  if (!key) {
    try {
      keys = (await fetchJwks({ refresh: true })).keys;
    } catch {
      return { ok: false, code: "GITHUB_OIDC_REJECTED" };
    }
    key = publicKeyForKid(keys, kid);
  }
  if (!key || key.asymmetricKeyType !== "rsa") return { ok: false, code: "GITHUB_OIDC_BAD_SIGNATURE" };

  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  let signature: Buffer;
  try {
    signature = Buffer.from(parts[2], "base64url");
  } catch {
    return { ok: false, code: "GITHUB_OIDC_MALFORMED" };
  }
  const signatureOk = verifySignature("RSA-SHA256", signed, key, signature);
  if (!signatureOk) return { ok: false, code: "GITHUB_OIDC_BAD_SIGNATURE" };

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const code = claimError(payload, nowSeconds);
  if (code) return { ok: false, code };
  return { ok: true };
}
