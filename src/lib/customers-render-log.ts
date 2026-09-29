/**
 * Server diagnostics for the Customers route.
 * Messages may include a Postgres/PostgREST code and a redacted message.
 * They must not include customer names, phones, addresses, emails, or secrets.
 */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]*)\d{3}[-.\s]?\d{4}\b/g;

function rawErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

export function redactCustomerText(value: unknown, max = 400): string {
  return rawErrorMessage(value)
    .replace(EMAIL, "[redacted-email]")
    .replace(PHONE, "[redacted-phone]")
    .slice(0, max);
}

export function logCustomersServerFailure(
  operation: string,
  error: unknown,
  route = "/customers",
) {
  const err = error as {
    code?: unknown;
    digest?: unknown;
    stack?: unknown;
    name?: unknown;
  };
  const code =
    typeof err?.code === "string"
      ? err.code
      : typeof err?.name === "string"
        ? err.name
        : "Error";
  const stack = typeof err?.stack === "string" ? redactCustomerText(err.stack, 2000) : "";
  console.error(
    "[customers]",
    JSON.stringify({
      route,
      operation,
      code,
      digest: typeof err?.digest === "string" ? err.digest : undefined,
      message: redactCustomerText(error),
      stack,
    }),
  );
}
