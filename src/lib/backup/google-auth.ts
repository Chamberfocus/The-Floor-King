import { GOOGLE_DRIVE_SCOPE, googleServiceAccountImpersonationUrl, googleWifAudience } from "./constants";
import { assertProductionBackupOidcClaims, decodeJwtPayload } from "./jwt-claims";

export type ExternalAccountConfig = {
  type: "external_account";
  audience: string;
  subject_token_type: "urn:ietf:params:oauth:token-type:jwt";
  token_url: "https://sts.googleapis.com/v1/token";
  service_account_impersonation_url: string;
  subject_token_supplier: { getSubjectToken: () => Promise<string> };
};

/**
 * Official Vercel→GCP pattern: External Account + subject_token_supplier.
 * Never uses credential_source.file (ADC wizard file path) or a SA private key.
 */
export function buildGoogleExternalAccountConfig(
  getSubjectToken: () => Promise<string>,
): ExternalAccountConfig {
  return {
    type: "external_account",
    audience: googleWifAudience(),
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: googleServiceAccountImpersonationUrl(),
    subject_token_supplier: { getSubjectToken },
  };
}

export function googleAuthUsesPermanentKey(config: object): boolean {
  const rec = config as Record<string, unknown>;
  if (rec.type === "service_account") return true;
  if (typeof rec.private_key === "string") return true;
  const source = rec.credential_source as Record<string, unknown> | undefined;
  if (source && typeof source.file === "string") return true;
  return rec.type !== "external_account";
}

export async function validatedOidcSubjectToken(
  getRawToken: () => Promise<string>,
): Promise<string> {
  const token = await getRawToken();
  if (!token || token.split(".").length !== 3) {
    throw new Error("OIDC_TOKEN_MISSING");
  }
  const claims = decodeJwtPayload(token);
  assertProductionBackupOidcClaims(claims);
  return token;
}

export type StsFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Explicit STS + IAM Credentials impersonation. Used by tests and as a
 * library-free fallback. Does not log tokens.
 */
export async function exchangeVercelOidcForDriveAccessToken(args: {
  oidcToken: string;
  fetchImpl?: StsFetch;
}): Promise<string> {
  const claims = decodeJwtPayload(args.oidcToken);
  assertProductionBackupOidcClaims(claims);
  const fetchImpl = args.fetchImpl ?? (globalThis.fetch as unknown as StsFetch);

  const stsBody = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    audience: googleWifAudience(),
    scope: GOOGLE_DRIVE_SCOPE,
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    subject_token: args.oidcToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
  });

  const stsRes = await fetchImpl("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: stsBody.toString(),
  });
  if (!stsRes.ok) throw new Error("GOOGLE_STS_FAILED");
  const stsJson = (await stsRes.json()) as { access_token?: string };
  if (!stsJson.access_token) throw new Error("GOOGLE_STS_FAILED");

  const impersonateRes = await fetchImpl(googleServiceAccountImpersonationUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stsJson.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      scope: [GOOGLE_DRIVE_SCOPE],
      lifetime: "3600s",
    }),
  });
  if (!impersonateRes.ok) throw new Error("GOOGLE_IMPERSONATION_FAILED");
  const impJson = (await impersonateRes.json()) as { accessToken?: string };
  if (!impJson.accessToken) throw new Error("GOOGLE_IMPERSONATION_FAILED");
  return impJson.accessToken;
}

export function driveTokenResponseHasSecrets(payload: Record<string, unknown>): boolean {
  return (
    "accessToken" in payload ||
    "access_token" in payload ||
    "oidcToken" in payload ||
    "refresh_token" in payload
  );
}
