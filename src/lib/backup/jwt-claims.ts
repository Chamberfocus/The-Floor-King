import {
  VERCEL_OIDC_AUDIENCE,
  VERCEL_OIDC_ISSUER,
  VERCEL_OIDC_PRODUCTION_SUBJECT,
} from "./constants";

export type OidcClaims = {
  iss: string;
  aud: string | string[];
  sub: string;
  exp?: number;
};

export function decodeJwtPayload(token: string): OidcClaims {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new Error("OIDC_TOKEN_MALFORMED");
  }
  const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (padded.length % 4)) % 4);
  let json: string;
  try {
    json = Buffer.from(padded + pad, "base64").toString("utf8");
  } catch {
    throw new Error("OIDC_TOKEN_MALFORMED");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("OIDC_TOKEN_MALFORMED");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("OIDC_TOKEN_MALFORMED");
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.iss !== "string" || typeof rec.sub !== "string") {
    throw new Error("OIDC_CLAIMS_MISSING");
  }
  if (typeof rec.aud !== "string" && !Array.isArray(rec.aud)) {
    throw new Error("OIDC_CLAIMS_MISSING");
  }
  return {
    iss: rec.iss,
    aud: rec.aud as string | string[],
    sub: rec.sub,
    exp: typeof rec.exp === "number" ? rec.exp : undefined,
  };
}

export function audienceValues(aud: string | string[]): string[] {
  return Array.isArray(aud) ? aud.map(String) : [String(aud)];
}

export function assertProductionBackupOidcClaims(claims: OidcClaims): void {
  if (claims.iss !== VERCEL_OIDC_ISSUER) {
    throw new Error("OIDC_ISSUER_REJECTED");
  }
  if (!audienceValues(claims.aud).includes(VERCEL_OIDC_AUDIENCE)) {
    throw new Error("OIDC_AUDIENCE_REJECTED");
  }
  if (claims.sub !== VERCEL_OIDC_PRODUCTION_SUBJECT) {
    throw new Error("OIDC_SUBJECT_REJECTED");
  }
  if (claims.exp != null && claims.exp * 1000 <= Date.now()) {
    throw new Error("OIDC_TOKEN_EXPIRED");
  }
}

export function encodeTestJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.testsig`;
}
