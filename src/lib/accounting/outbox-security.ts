/**
 * F4 outbox SECURITY DEFINER privilege policy (pure — mirrors 0163 intent).
 * UI hiding is not security. Tests document the required grant matrix.
 */
export type DbRole =
  | "anon"
  | "authenticated"
  | "service_role"
  | "postgres_owner";

export type AppRole = "admin" | "office" | "crew" | "customer" | "sales" | null;

/** Who may EXECUTE enqueue_accounting_outbox_safe via the API. */
export function mayDirectExecuteEnqueue(role: DbRole): boolean {
  // INTERNAL ONLY — nested call from DEFINER ops RPCs; not PostgREST for clients.
  return role === "service_role" || role === "postgres_owner";
}

/** Who may EXECUTE claim_accounting_outbox_item via the API. */
export function mayDirectExecuteClaim(args: {
  dbRole: DbRole;
  appRole: AppRole;
  /** service_role cron has no auth.uid() */
  hasAuthUid: boolean;
}): boolean {
  return args.dbRole === "service_role" || args.dbRole === "postgres_owner";
}

/** Admin retry uses claim + processor — must remain viable. */
export function mayAdminRetryOutbox(appRole: AppRole): boolean {
  return appRole === "admin" || appRole === "office";
}

/** Ops payment RPC may call enqueue nested (same DEFINER owner). */
export function opsRpcMayEnqueueInternally(args: {
  callerIsSecurityDefinerOwner: boolean;
  enqueueGrantedToAuthenticated: boolean;
}): boolean {
  // Nested EXECUTE runs as outer DEFINER owner — client grant not required.
  return args.callerIsSecurityDefinerOwner === true;
}

export const F4_SECURITY_DEFINER_FUNCTIONS = [
  "enqueue_accounting_outbox_safe",
  "claim_accounting_outbox_item",
  "record_invoice_payment_safe",
  "void_invoice_payment_safe",
  "apply_credit_to_invoice_safe",
  "record_refund_safe",
] as const;

/** Expected EXECUTE grants after 0163 (authenticated column). */
export function expectedAuthenticatedExecuteGrant(
  fn: (typeof F4_SECURITY_DEFINER_FUNCTIONS)[number],
): "granted_with_role_check" | "revoked" | "granted_ops" {
  switch (fn) {
    case "enqueue_accounting_outbox_safe":
      return "revoked";
    case "claim_accounting_outbox_item":
      return "revoked";
    case "record_invoice_payment_safe":
    case "void_invoice_payment_safe":
    case "apply_credit_to_invoice_safe":
    case "record_refund_safe":
      return "granted_ops";
  }
}

export function requiresFixedSearchPath(fn: string): boolean {
  return (F4_SECURITY_DEFINER_FUNCTIONS as readonly string[]).includes(fn);
}
