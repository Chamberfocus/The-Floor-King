/**
 * Invoice issue guard policy (mirrors 0165 trigger + finalize path).
 * Pure — used by golden tests; SQL is source of truth in migration.
 */

export type InvoiceStatusForGuard =
  | "draft"
  | "sent"
  | "partial"
  | "paid"
  | "void"
  | string;

/** When posting_enabled AND invoice_posting_enabled. */
export function invoiceAccountingPilotActive(flags: {
  posting_enabled: boolean;
  invoice_posting_enabled: boolean;
}): boolean {
  return !!flags.posting_enabled && !!flags.invoice_posting_enabled;
}

/**
 * Would the DB trigger block this write when pilot is active and session flag unset?
 */
export function invoiceIssueBypassBlocked(args: {
  pilotActive: boolean;
  allowSessionFlag: boolean;
  op: "INSERT" | "UPDATE";
  oldStatus?: InvoiceStatusForGuard | null;
  newStatus: InvoiceStatusForGuard;
}): { blocked: boolean; reason?: string } {
  if (!args.pilotActive) return { blocked: false };
  if (args.allowSessionFlag) return { blocked: false };

  const issued = new Set(["sent", "partial", "paid"]);
  if (args.op === "INSERT" && issued.has(args.newStatus)) {
    return {
      blocked: true,
      reason: "cannot_insert_already_issued",
    };
  }
  if (
    args.op === "UPDATE" &&
    args.oldStatus === "draft" &&
    issued.has(args.newStatus)
  ) {
    return {
      blocked: true,
      reason: "cannot_draft_to_issued_without_finalize",
    };
  }
  if (
    args.op === "UPDATE" &&
    args.oldStatus != null &&
    args.oldStatus !== args.newStatus &&
    issued.has(args.newStatus) &&
    !issued.has(args.oldStatus) &&
    args.oldStatus !== "void"
  ) {
    return {
      blocked: true,
      reason: "cannot_set_issued_without_finalize",
    };
  }
  return { blocked: false };
}

/** Mirrors accounting_actor_id after 0168. */
export function resolveAccountingActor(args: {
  authUid: string | null;
  claimed: string | null;
  jwtRole?: string | null;
}): string | null {
  const jwt = String(args.jwtRole ?? "").toLowerCase();
  if (jwt === "service_role") return args.claimed;
  if (args.authUid && jwt === "authenticated") return args.authUid;
  // Legacy pure-test path: uid present without jwtRole → treat as authenticated.
  if (args.authUid && !jwt) return args.authUid;
  return null;
}
