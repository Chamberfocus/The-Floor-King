const SECRET_PATTERN =
  /(service_role|password|passwd|secret|token|bearer|authorization|apikey|api_key|private_key|connection string|postgres(?:ql)?:\/\/)[^\s]*/gi;

const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){1,2}/g;

const URI_USERINFO_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+@)/gi;

export function sanitizeBackupError(input: unknown): string {
  let text = input instanceof Error ? input.message : String(input ?? "unknown_error");
  text = text.replace(JWT_PATTERN, "[redacted-jwt]");
  text = text.replace(URI_USERINFO_PATTERN, "$1[redacted]@");
  text = text.replace(SECRET_PATTERN, "[redacted]");
  if (text.length > 400) text = `${text.slice(0, 400)}…`;
  return text;
}

export const MANIFEST_FORBIDDEN_KEY =
  /password|secret|token|credential|apikey|api_key|private_key|connection|database_url|service_role|bearer|authorization/i;

export function assertManifestHasNoSecrets(value: unknown, path = "manifest"): void {
  if (value == null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertManifestHasNoSecrets(item, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (MANIFEST_FORBIDDEN_KEY.test(key)) {
      throw new Error(`MANIFEST_SECRET_KEY:${path}.${key}`);
    }
    if (typeof child === "string" && (JWT_PATTERN.test(child) || URI_USERINFO_PATTERN.test(child))) {
      JWT_PATTERN.lastIndex = 0;
      URI_USERINFO_PATTERN.lastIndex = 0;
      throw new Error(`MANIFEST_SECRET_VALUE:${path}.${key}`);
    }
    JWT_PATTERN.lastIndex = 0;
    URI_USERINFO_PATTERN.lastIndex = 0;
    assertManifestHasNoSecrets(child, `${path}.${key}`);
  }
}
