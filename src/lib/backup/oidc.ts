import { getVercelOidcToken } from "@vercel/oidc";
import { ExternalAccountClient } from "google-auth-library";
import { buildGoogleExternalAccountConfig, googleAuthUsesPermanentKey, validatedOidcSubjectToken } from "./google-auth";

export async function getProductionBackupOidcToken(): Promise<string> {
  return validatedOidcSubjectToken(() => getVercelOidcToken());
}

export async function getProductionDriveAccessToken(oidcToken: string): Promise<string> {
  const config = buildGoogleExternalAccountConfig(async () => oidcToken);
  if (googleAuthUsesPermanentKey(config)) {
    throw new Error("GOOGLE_PERMANENT_KEY_FORBIDDEN");
  }
  const client = ExternalAccountClient.fromJSON({
    type: config.type,
    audience: config.audience,
    subject_token_type: config.subject_token_type,
    token_url: config.token_url,
    service_account_impersonation_url: config.service_account_impersonation_url,
    subject_token_supplier: config.subject_token_supplier,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  if (!client) throw new Error("GOOGLE_AUTH_CLIENT_FAILED");
  const token = await client.getAccessToken();
  const value = typeof token === "string" ? token : token?.token;
  if (!value) throw new Error("GOOGLE_ACCESS_TOKEN_MISSING");
  return value;
}
