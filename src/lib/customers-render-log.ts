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

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A customer id is safe to log only when it is already a UUID. */
export function customerIdForLog(value: unknown): string | undefined {
  return typeof value === "string" && UUID.test(value) ? value : undefined;
}

export function valueTypeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Next's production RSC path returns HTTP 200 with a client digest and does
 * not print that digest. These lines are emitted from the Customers page
 * itself so the function log names the phase.
 */
export function logCustomersPhase(
  phase: string,
  status: "start" | "success" | "failure" | "unexpected",
  fields: Record<string, unknown> = {},
) {
  const safe: Record<string, unknown> = {
    route: "/customers",
    phase,
    status,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === "") continue;
    if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
    else if (typeof value === "boolean") safe[key] = value;
    else if (typeof value === "string") {
      safe[key] = redactCustomerText(value, key === "stack" ? 2000 : 400);
    }
  }
  console.error("[customers-phase]", JSON.stringify(safe));
}

export function logUnexpectedCustomerField(
  field: string,
  value: unknown,
  customerId: unknown,
) {
  logCustomersPhase("customers.transform", "unexpected", {
    field,
    value_type: valueTypeName(value),
    customer_id: customerIdForLog(customerId),
  });
}

/** Redirects and notFound() must keep propagating. */
export function isNavigationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"))) {
    return true;
  }
  return error instanceof Error && error.message.startsWith("redirect:");
}

export function rethrowNavigation(error: unknown): void {
  if (isNavigationError(error)) throw error;
}

function failureFields(error: unknown, started: number): Record<string, unknown> {
  const err = error as { code?: unknown; digest?: unknown; stack?: unknown };
  return {
    duration_ms: Date.now() - started,
    error_type: error instanceof Error ? error.name : valueTypeName(error),
    code: typeof err?.code === "string" ? err.code : "",
    message: redactCustomerText(error),
    stack: typeof err?.stack === "string" ? err.stack : "",
    digest: typeof err?.digest === "string" ? err.digest : "",
  };
}

export async function runCustomersPhase<T>(
  phase: string,
  fn: () => Promise<T>,
  summarize?: (value: T) => Record<string, unknown>,
): Promise<T> {
  const started = Date.now();
  logCustomersPhase(phase, "start");
  try {
    const value = await fn();
    logCustomersPhase(phase, "success", {
      duration_ms: Date.now() - started,
      ...(summarize ? summarize(value) : {}),
    });
    return value;
  } catch (error) {
    rethrowNavigation(error);
    logCustomersPhase(phase, "failure", failureFields(error, started));
    throw error;
  }
}

export function runCustomersPhaseSync<T>(
  phase: string,
  fn: () => T,
  summarize?: (value: T) => Record<string, unknown>,
): T {
  const started = Date.now();
  logCustomersPhase(phase, "start");
  try {
    const value = fn();
    logCustomersPhase(phase, "success", {
      duration_ms: Date.now() - started,
      ...(summarize ? summarize(value) : {}),
    });
    return value;
  } catch (error) {
    rethrowNavigation(error);
    logCustomersPhase(phase, "failure", failureFields(error, started));
    throw error;
  }
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
