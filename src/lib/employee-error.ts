const INTERNAL_DB_ERROR =
  /sqlstate|postgres|pgrst|syntax error|violates|duplicate key|permission denied|schema cache|could not find the function|jwt_role|accounting_forbidden|42501|23505|23514|stack|supabase/i;

/**
 * Employee- or customer-facing database failure.
 * Short business sentences stay. Transport and constraint text does not.
 */
export function employeeDbError(
  raw: string | null | undefined,
  fallback: string,
): string {
  const msg = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!msg || msg.length > 240 || INTERNAL_DB_ERROR.test(msg)) return fallback;
  return msg;
}
