/**
 * F5/0168 request-identity + SECURITY DEFINER role matrix (mirrors SQL).
 * Never treat "null uid" alone as service_role — anon also has null uid.
 */

export type FloorKingRole =
  | "admin"
  | "office"
  | "sales_manager"
  | "salesman"
  | "scheduler"
  | "crew"
  | "warehouse"
  | "customer";

/** PostgREST JWT role claim (not Floor King profile.role). */
export type JwtRequestRole = "anon" | "authenticated" | "service_role" | "";

export type RequestIdentity =
  | { kind: "service_role" }
  | { kind: "authenticated"; appRole: FloorKingRole }
  | { kind: "anon" }
  | { kind: "unknown"; jwtRole?: string; uidPresent?: boolean };

export type F5FinancialRpc =
  | "finalize_invoice_safe"
  | "void_invoice_safe"
  | "issue_credit_memo_safe"
  | "void_credit_memo_safe"
  | "void_refund_safe"
  | "post_vendor_bill_safe"
  | "record_bill_payment_safe"
  | "void_bill_payment_safe"
  | "record_direct_expense_safe"
  | "record_customer_deposit_safe"
  | "apply_customer_deposit_safe"
  | "void_customer_deposit_safe"
  | "complete_bank_reconciliation_safe";

/** F0–F4 legacy money RPCs hardened in 0169. */
export type LegacyMoneyRpc =
  | "record_invoice_payment_safe"
  | "void_invoice_payment_safe"
  | "apply_credit_to_invoice_safe"
  | "record_refund_safe"
  | "post_journal_entry_safe"
  | "claim_accounting_outbox_item";

export type F6P1FinancialRpc =
  | "write_off_invoice_safe"
  | "confirm_backup_pitr_safe"
  | "stage_bank_statement_import_safe";

/** F6-P2A Option A reversal RPCs (0171). */
export type F6P2AFinancialRpc =
  | "void_credit_application_safe"
  | "void_customer_deposit_application_safe"
  | "void_invoice_write_off_safe";

/** F6-P2B opening balance wizard RPCs (0172). */
export type F6P2BFinancialRpc =
  | "create_opening_balance_batch_safe"
  | "save_opening_balance_draft_safe"
  | "validate_opening_balance_batch_safe"
  | "finalize_opening_balances_safe"
  | "void_opening_balance_batch_safe";

export type F6P2CFinancialRpc =
  | "create_bank_reconciliation_safe"
  | "attach_bank_import_to_reconciliation_safe"
  | "create_bank_match_safe"
  | "remove_bank_match_safe"
  | "resolve_bank_import_duplicate_safe"
  | "exclude_bank_import_line_safe"
  | "finalize_bank_reconciliation_safe"
  | "void_bank_reconciliation_safe";

export type F6P2CInternalRpc = "bank_reconciliation_compute_package";

export type F6P3AFinancialRpc =
  | "create_installer_labor_bill_safe"
  | "save_installer_labor_draft_safe"
  | "approve_installer_labor_safe"
  | "reverse_installer_labor_safe"
  | "cancel_installer_labor_draft_safe"
  | "correct_installer_labor_safe"
  | "mark_installer_labor_paid_safe"
  | "installer_labor_active_actual_total"
  | "installer_labor_committed_total"
  | "installer_labor_owed_paid_remaining";

export type F6P3BFinancialRpc =
  | "create_vendor_bill_safe"
  | "save_vendor_bill_draft_safe"
  | "activate_vendor_bill_safe"
  | "void_vendor_bill_safe"
  | "correct_vendor_bill_safe"
  | "ap_bill_original_total"
  | "ap_bill_paid_total"
  | "ap_bill_remaining"
  | "ap_bill_display_status";

export type F6P3BInternalRpc =
  | "ap_text_is_nonfinite"
  | "ap_parse_numeric_text"
  | "ap_money_ok"
  | "ap_json_numeric"
  | "ap_line_total"
  | "ap_normalize_invoice"
  | "ap_context_hash"
  | "ap_lookup_action"
  | "ap_store_action"
  | "ap_require_ok"
  | "ap_lock_bill"
  | "ap_lock_jobs_sorted"
  | "ap_lock_vendor_invoice"
  | "ap_lock_vendor_invoices_sorted"
  | "ap_direct_expense_identity_exists"
  | "ap_reject_if_direct_expense_identity"
  | "ap_record_vendor_event"
  | "ap_validate_lines"
  | "ap_assert_category"
  | "ap_assert_supplier"
  | "bills_enforce_ap_immutability"
  | "bill_items_enforce_ap_immutability"
  | "bill_payments_enforce_ap_immutability"
  | "bill_payments_block_void_ap"
  | "expenses_block_ap_linked_insert";

export type F6P3AInternalRpc =
  | "installer_labor_money_ok"
  | "installer_labor_line_total"
  | "installer_labor_resolve_worker_kind"
  | "installer_labor_classify_worker"
  | "installer_labor_context_hash"
  | "installer_labor_recompute_job_actual"
  | "installer_labor_record_event_status"
  | "installer_labor_lock_job"
  | "installer_labor_lock_for_bill"
  | "installer_labor_lock_ap_bill"
  | "installer_labor_validate_lines"
  | "installer_labor_void_linked_ap"
  | "installer_labor_sync_ap_settlement"
  | "installer_labor_record_vendor_event"
  | "installer_labor_require_ok"
  | "installer_bills_enforce_immutability"
  | "installer_bill_lines_enforce_immutability";

export type F6P2BInternalRpc =
  | "opening_balance_compute_package"
  | "post_opening_balance_journal_from_definer_safe"
  | "opening_balance_validate_draft_payload";

export type F6P1InternalRpc =
  | "log_financial_audit_safe"
  | "accounting_audit_from_definer_safe";

export type StaffMoneyRpc =
  | F5FinancialRpc
  | LegacyMoneyRpc
  | F6P1FinancialRpc
  | F6P2AFinancialRpc
  | F6P2BFinancialRpc
  | F6P2CFinancialRpc
  | F6P3AFinancialRpc
  | F6P3BFinancialRpc;

export type F5InternalRpc =
  | "allow_invoice_issue_guard"
  | "enqueue_accounting_outbox_safe";

const ADMIN_OFFICE: FloorKingRole[] = ["admin", "office"];
const INVOICE_OPS: FloorKingRole[] = [
  "admin",
  "office",
  "sales_manager",
  "salesman",
];

/** Classify JWT + uid the way 0168 SQL does. */
export function classifyRequestIdentity(args: {
  jwtRole: string | null | undefined;
  authUid: string | null | undefined;
  appRole?: FloorKingRole | null;
}): RequestIdentity {
  const jwt = String(args.jwtRole ?? "")
    .trim()
    .toLowerCase();
  if (jwt === "service_role") return { kind: "service_role" };
  if (args.authUid && jwt === "authenticated") {
    return {
      kind: "authenticated",
      appRole: (args.appRole ?? "customer") as FloorKingRole,
    };
  }
  if (jwt === "anon" || (!args.authUid && jwt === "anon")) {
    return { kind: "anon" };
  }
  if (!args.authUid && !jwt) {
    return { kind: "unknown", jwtRole: jwt, uidPresent: false };
  }
  if (jwt === "anon" || (!args.authUid && jwt !== "service_role")) {
    // null uid without service_role claim → untrusted (includes bare anon)
    if (!args.authUid) {
      return jwt === "anon"
        ? { kind: "anon" }
        : { kind: "unknown", jwtRole: jwt, uidPresent: false };
    }
  }
  return {
    kind: "unknown",
    jwtRole: jwt,
    uidPresent: !!args.authUid,
  };
}

/** Null uid alone provides ZERO trust. */
export function nullUidIsTrusted(): boolean {
  return false;
}

export function isExplicitServiceRole(jwtRole: string | null | undefined): boolean {
  return String(jwtRole ?? "").toLowerCase() === "service_role";
}

export function rolesAllowedForF6P1Rpc(rpc: F6P1FinancialRpc): FloorKingRole[] | "admin_only" {
  switch (rpc) {
    case "write_off_invoice_safe":
    case "stage_bank_statement_import_safe":
      return ADMIN_OFFICE;
    case "confirm_backup_pitr_safe":
      return "admin_only";
  }
}

export function mayInvokeF6P1InternalRpc(args: {
  rpc: F6P1InternalRpc;
  identity: RequestIdentity;
}): { allowed: boolean; reason: string } {
  if (args.identity.kind === "service_role") {
    return { allowed: true, reason: "explicit_service_role" };
  }
  return {
    allowed: false,
    reason: `ACCOUNTING_FORBIDDEN: ${args.rpc} is internal-only`,
  };
}

export function mayInvokeF6P1Rpc(args: {
  rpc: F6P1FinancialRpc;
  identity: RequestIdentity;
}): { allowed: boolean; reason: string } {
  if (args.identity.kind === "service_role") {
    return { allowed: true, reason: "explicit_service_role" };
  }
  if (args.identity.kind === "authenticated") {
    const policy = rolesAllowedForF6P1Rpc(args.rpc);
    const allowed =
      policy === "admin_only" ? (["admin"] as FloorKingRole[]) : policy;
    if (allowed.includes(args.identity.appRole)) {
      return { allowed: true, reason: "role_permitted" };
    }
    return {
      allowed: false,
      reason: `ACCOUNTING_FORBIDDEN: ${args.identity.appRole} cannot invoke ${args.rpc}`,
    };
  }
  return {
    allowed: false,
    reason: `ACCOUNTING_FORBIDDEN: ${args.identity.kind} cannot invoke ${args.rpc}`,
  };
}

export function rolesAllowedForF6P2ARpc(
  rpc: F6P2AFinancialRpc,
): FloorKingRole[] {
  switch (rpc) {
    case "void_credit_application_safe":
    case "void_customer_deposit_application_safe":
    case "void_invoice_write_off_safe":
      return ADMIN_OFFICE;
  }
}

export function mayInvokeF6P2ARpc(args: {
  rpc: F6P2AFinancialRpc;
  identity: RequestIdentity;
}): { allowed: boolean; reason: string } {
  if (args.identity.kind === "service_role") {
    return { allowed: true, reason: "explicit_service_role" };
  }
  if (args.identity.kind === "authenticated") {
    if (rolesAllowedForF6P2ARpc(args.rpc).includes(args.identity.appRole)) {
      return { allowed: true, reason: "role_permitted" };
    }
    return {
      allowed: false,
      reason: `ACCOUNTING_FORBIDDEN: ${args.identity.appRole} cannot invoke ${args.rpc}`,
    };
  }
  return {
    allowed: false,
    reason: `ACCOUNTING_FORBIDDEN: ${args.identity.kind} cannot invoke ${args.rpc}`,
  };
}

/** Opening-balance wizard mutations are admin-only (mirrors 0172 SQL). */
export function rolesAllowedForF6P2BRpc(
  _rpc: F6P2BFinancialRpc,
): "admin_only" {
  return "admin_only";
}

export function mayInvokeF6P2BRpc(args: {
  rpc: F6P2BFinancialRpc;
  identity: RequestIdentity;
}): { allowed: boolean; reason: string } {
  if (args.identity.kind === "service_role") {
    return { allowed: true, reason: "explicit_service_role" };
  }
  if (args.identity.kind === "authenticated") {
    if (args.identity.appRole === "admin") {
      return { allowed: true, reason: "role_permitted" };
    }
    return {
      allowed: false,
      reason: `ACCOUNTING_FORBIDDEN: ${args.identity.appRole} cannot invoke ${args.rpc}`,
    };
  }
  return {
    allowed: false,
    reason: `ACCOUNTING_FORBIDDEN: ${args.identity.kind} cannot invoke ${args.rpc}`,
  };
}

export function mayInvokeF6P2BInternalRpc(args: {
  rpc: F6P2BInternalRpc;
  identity: RequestIdentity;
}): { allowed: boolean; reason: string } {
  if (args.identity.kind === "service_role") {
    return { allowed: true, reason: "explicit_service_role" };
  }
  return {
    allowed: false,
    reason: `ACCOUNTING_FORBIDDEN: ${args.rpc} is internal-only`,
  };
}

/** Bank reconciliation RPCs — admin/office (void is admin-only in SQL). */
export function rolesAllowedForF6P2CRpc(
  rpc: F6P2CFinancialRpc,
): FloorKingRole[] | "admin_only" {
  if (rpc === "void_bank_reconciliation_safe") return "admin_only";
  return ADMIN_OFFICE;
}

export function mayInvokeF6P2CRpc(args: {
  rpc: F6P2CFinancialRpc;
  identity: RequestIdentity;
}): { allowed: boolean; reason: string } {
  if (args.identity.kind === "service_role") {
    return { allowed: true, reason: "explicit_service_role" };
  }
  if (args.identity.kind === "authenticated") {
    const policy = rolesAllowedForF6P2CRpc(args.rpc);
    const allowed =
      policy === "admin_only" ? (["admin"] as FloorKingRole[]) : policy;
    if (allowed.includes(args.identity.appRole)) {
      return { allowed: true, reason: "role_permitted" };
    }
    return {
      allowed: false,
      reason: `ACCOUNTING_FORBIDDEN: ${args.identity.appRole} cannot invoke ${args.rpc}`,
    };
  }
  return {
    allowed: false,
    reason: `ACCOUNTING_FORBIDDEN: ${args.identity.kind} cannot invoke ${args.rpc}`,
  };
}

export function mayInvokeF6P2CInternalRpc(args: {
  rpc: F6P2CInternalRpc;
  identity: RequestIdentity;
}): { allowed: boolean; reason: string } {
  if (args.identity.kind === "service_role") {
    return { allowed: true, reason: "explicit_service_role" };
  }
  return {
    allowed: false,
    reason: `ACCOUNTING_FORBIDDEN: ${args.rpc} is internal-only`,
  };
}

export function rolesAllowedForF6P3ARpc(
  rpc: F6P3AFinancialRpc,
): FloorKingRole[] {
  void rpc;
  return ADMIN_OFFICE;
}

export function mayInvokeF6P3ARpc(args: {
  rpc: F6P3AFinancialRpc;
  identity: RequestIdentity;
}): { allowed: boolean; reason: string } {
  if (args.identity.kind === "service_role") {
    return { allowed: true, reason: "explicit_service_role" };
  }
  if (args.identity.kind === "authenticated") {
    if (args.identity.appRole === "crew") {
      return {
        allowed: false,
        reason: "ACCOUNTING_FORBIDDEN: crew cannot invoke installer labor RPCs",
      };
    }
    if (rolesAllowedForF6P3ARpc(args.rpc).includes(args.identity.appRole)) {
      return { allowed: true, reason: "role_permitted" };
    }
    return {
      allowed: false,
      reason: `ACCOUNTING_FORBIDDEN: ${args.identity.appRole} cannot invoke ${args.rpc}`,
    };
  }
  return {
    allowed: false,
    reason: `ACCOUNTING_FORBIDDEN: ${args.identity.kind} cannot invoke ${args.rpc}`,
  };
}

export function mayInvokeF6P3AInternalRpc(args: {
  rpc: F6P3AInternalRpc;
  identity: RequestIdentity;
}): { allowed: boolean; reason: string } {
  if (args.identity.kind === "service_role") {
    return { allowed: true, reason: "explicit_service_role" };
  }
  return {
    allowed: false,
    reason: `ACCOUNTING_FORBIDDEN: ${args.rpc} is internal-only`,
  };
}

export function rolesAllowedForF5Rpc(rpc: F5FinancialRpc): FloorKingRole[] {
  switch (rpc) {
    case "finalize_invoice_safe":
    case "void_invoice_safe":
    case "record_customer_deposit_safe":
      return INVOICE_OPS;
    case "issue_credit_memo_safe":
    case "void_credit_memo_safe":
    case "void_refund_safe":
    case "post_vendor_bill_safe":
    case "record_bill_payment_safe":
    case "void_bill_payment_safe":
    case "record_direct_expense_safe":
    case "apply_customer_deposit_safe":
    case "void_customer_deposit_safe":
    case "complete_bank_reconciliation_safe":
      return ADMIN_OFFICE;
  }
}

export function rolesAllowedForLegacyMoneyRpc(
  rpc: LegacyMoneyRpc,
): FloorKingRole[] | "service_role_only" | "admin_only" {
  switch (rpc) {
    case "record_invoice_payment_safe":
      return INVOICE_OPS;
    case "void_invoice_payment_safe":
    case "apply_credit_to_invoice_safe":
    case "record_refund_safe":
      return ADMIN_OFFICE;
    case "post_journal_entry_safe":
      return "admin_only";
    case "claim_accounting_outbox_item":
      return "service_role_only";
  }
}

export function mayInvokeLegacyMoneyRpc(args: {
  rpc: LegacyMoneyRpc;
  identity: RequestIdentity;
}): { allowed: boolean; reason: string } {
  const policy = rolesAllowedForLegacyMoneyRpc(args.rpc);
  if (policy === "service_role_only") {
    if (args.identity.kind === "service_role") {
      return { allowed: true, reason: "service_role_worker" };
    }
    return {
      allowed: false,
      reason: `ACCOUNTING_FORBIDDEN: ${args.rpc} is service_role only`,
    };
  }
  if (args.identity.kind === "service_role") {
    return { allowed: true, reason: "explicit_service_role" };
  }
  if (args.identity.kind === "authenticated") {
    const allowed =
      policy === "admin_only"
        ? (["admin"] as FloorKingRole[])
        : policy;
    if (allowed.includes(args.identity.appRole)) {
      return { allowed: true, reason: "role_permitted" };
    }
    return {
      allowed: false,
      reason: `ACCOUNTING_FORBIDDEN: ${args.identity.appRole} cannot invoke ${args.rpc}`,
    };
  }
  return {
    allowed: false,
    reason: `ACCOUNTING_FORBIDDEN: ${args.identity.kind} cannot invoke ${args.rpc}`,
  };
}

export function mayInvokeF5Rpc(args: {
  rpc: F5FinancialRpc;
  identity: RequestIdentity;
}): { allowed: boolean; reason: string } {
  if (args.identity.kind === "service_role") {
    return { allowed: true, reason: "explicit_service_role" };
  }
  if (args.identity.kind === "authenticated") {
    const allowed = rolesAllowedForF5Rpc(args.rpc);
    if (allowed.includes(args.identity.appRole)) {
      return { allowed: true, reason: "role_permitted" };
    }
    return {
      allowed: false,
      reason: `ACCOUNTING_FORBIDDEN: ${args.identity.appRole} cannot invoke ${args.rpc}`,
    };
  }
  return {
    allowed: false,
    reason: `ACCOUNTING_FORBIDDEN: ${args.identity.kind} cannot invoke ${args.rpc}`,
  };
}

/** Internal helpers: never anon/authenticated PostgREST. */
export function mayDirectExecuteInternalRpc(args: {
  rpc: F5InternalRpc;
  identity: RequestIdentity;
}): { allowed: boolean; reason: string } {
  if (args.identity.kind === "service_role") {
    return { allowed: true, reason: "service_role_or_nested_owner" };
  }
  return {
    allowed: false,
    reason: `${args.rpc} is internal-only; ${args.identity.kind} denied`,
  };
}

/**
 * Actor resolution mirrors accounting_actor_id after 0168.
 * Returns null when SQL would raise (untrusted).
 */
export function resolveAccountingActorId(args: {
  identity: RequestIdentity;
  claimed: string | null;
}): { ok: true; actorId: string | null } | { ok: false; reason: string } {
  if (args.identity.kind === "authenticated") {
    // auth.uid wins — callers pass uid via identity; claimed ignored
    return { ok: true, actorId: "auth.uid" };
  }
  if (args.identity.kind === "service_role") {
    return { ok: true, actorId: args.claimed };
  }
  return {
    ok: false,
    reason: "ACCOUNTING_FORBIDDEN: untrusted identity cannot resolve actor",
  };
}

export function expectedExecuteGrantAfter0171(
  fn: StaffMoneyRpc | F5InternalRpc | F6P1InternalRpc | "accounting_require_roles",
): "authenticated+service_role" | "service_role_only" {
  if (
    fn === "allow_invoice_issue_guard" ||
    fn === "enqueue_accounting_outbox_safe" ||
    fn === "claim_accounting_outbox_item" ||
    fn === "log_financial_audit_safe" ||
    fn === "accounting_audit_from_definer_safe"
  ) {
    return "service_role_only";
  }
  return "authenticated+service_role";
}

export function expectedExecuteGrantAfter0172(
  fn:
    | StaffMoneyRpc
    | F5InternalRpc
    | F6P1InternalRpc
    | F6P2BInternalRpc
    | "accounting_require_roles"
    | "opening_balance_account_allowed",
): "authenticated+service_role" | "service_role_only" {
  if (
    fn === "opening_balance_compute_package" ||
    fn === "post_opening_balance_journal_from_definer_safe" ||
    fn === "opening_balance_validate_draft_payload"
  ) {
    return "service_role_only";
  }
  if (fn === "opening_balance_account_allowed") {
    return "authenticated+service_role";
  }
  return expectedExecuteGrantAfter0171(fn);
}

export function expectedExecuteGrantAfter0173(
  fn:
    | StaffMoneyRpc
    | F5InternalRpc
    | F6P1InternalRpc
    | F6P2BInternalRpc
    | F6P2CInternalRpc
    | "accounting_require_roles"
    | "opening_balance_account_allowed",
): "authenticated+service_role" | "service_role_only" {
  if (fn === "bank_reconciliation_compute_package") {
    return "service_role_only";
  }
  return expectedExecuteGrantAfter0172(fn);
}

export function rolesAllowedForF6P3BRpc(
  rpc: F6P3BFinancialRpc,
): FloorKingRole[] {
  void rpc;
  return ADMIN_OFFICE;
}

export function mayInvokeF6P3BRpc(args: {
  rpc: F6P3BFinancialRpc;
  identity: RequestIdentity;
}): { allowed: boolean; reason: string } {
  if (args.identity.kind === "service_role") {
    return { allowed: true, reason: "explicit_service_role" };
  }
  if (args.identity.kind === "authenticated") {
    if (rolesAllowedForF6P3BRpc(args.rpc).includes(args.identity.appRole)) {
      return { allowed: true, reason: "role_permitted" };
    }
    return {
      allowed: false,
      reason: `ACCOUNTING_FORBIDDEN: ${args.identity.appRole} cannot invoke ${args.rpc}`,
    };
  }
  return {
    allowed: false,
    reason: `ACCOUNTING_FORBIDDEN: ${args.identity.kind} cannot invoke ${args.rpc}`,
  };
}

export function mayInvokeF6P3BInternalRpc(args: {
  rpc: F6P3BInternalRpc;
  identity: RequestIdentity;
}): { allowed: boolean; reason: string } {
  if (args.identity.kind === "service_role") {
    return { allowed: true, reason: "explicit_service_role" };
  }
  return {
    allowed: false,
    reason: `ACCOUNTING_FORBIDDEN: ${args.rpc} is internal-only`,
  };
}

export function expectedExecuteGrantAfter0175(
  fn:
    | StaffMoneyRpc
    | F5InternalRpc
    | F6P1InternalRpc
    | F6P2BInternalRpc
    | F6P2CInternalRpc
    | F6P3AFinancialRpc
    | F6P3AInternalRpc
    | F6P3BFinancialRpc
    | F6P3BInternalRpc
    | "accounting_require_roles"
    | "opening_balance_account_allowed",
): "authenticated+service_role" | "service_role_only" | "dropped" {
  // Legacy F5 snapshot post — catalog-dropped in 0175; not grantable.
  if (fn === "post_vendor_bill_safe") {
    return "dropped";
  }
  const internal: F6P3BInternalRpc[] = [
    "ap_text_is_nonfinite",
    "ap_parse_numeric_text",
    "ap_money_ok",
    "ap_json_numeric",
    "ap_line_total",
    "ap_normalize_invoice",
    "ap_context_hash",
    "ap_lookup_action",
    "ap_store_action",
    "ap_require_ok",
    "ap_lock_bill",
    "ap_lock_jobs_sorted",
    "ap_lock_vendor_invoice",
    "ap_lock_vendor_invoices_sorted",
    "ap_direct_expense_identity_exists",
    "ap_reject_if_direct_expense_identity",
    "ap_record_vendor_event",
    "ap_validate_lines",
    "ap_assert_category",
    "ap_assert_supplier",
    "bills_enforce_ap_immutability",
    "bill_items_enforce_ap_immutability",
    "bill_payments_enforce_ap_immutability",
    "bill_payments_block_void_ap",
    "expenses_block_ap_linked_insert",
  ];
  if ((internal as string[]).includes(fn)) return "service_role_only";
  return expectedExecuteGrantAfter0174(fn as Parameters<typeof expectedExecuteGrantAfter0174>[0]);
}

export function expectedExecuteGrantAfter0174(
  fn:
    | StaffMoneyRpc
    | F5InternalRpc
    | F6P1InternalRpc
    | F6P2BInternalRpc
    | F6P2CInternalRpc
    | F6P3AFinancialRpc
    | F6P3AInternalRpc
    | "accounting_require_roles"
    | "opening_balance_account_allowed",
): "authenticated+service_role" | "service_role_only" {
  const internal: F6P3AInternalRpc[] = [
    "installer_labor_money_ok",
    "installer_labor_line_total",
    "installer_labor_resolve_worker_kind",
    "installer_labor_classify_worker",
    "installer_labor_context_hash",
    "installer_labor_recompute_job_actual",
    "installer_labor_record_event_status",
    "installer_labor_lock_job",
    "installer_labor_lock_for_bill",
    "installer_labor_lock_ap_bill",
    "installer_labor_validate_lines",
    "installer_labor_void_linked_ap",
    "installer_labor_sync_ap_settlement",
    "installer_labor_record_vendor_event",
    "installer_labor_require_ok",
    "installer_bills_enforce_immutability",
    "installer_bill_lines_enforce_immutability",
  ];
  if ((internal as string[]).includes(fn)) return "service_role_only";
  return expectedExecuteGrantAfter0173(fn as Parameters<typeof expectedExecuteGrantAfter0173>[0]);
}

export function expectedExecuteGrantAfter0169(
  fn: StaffMoneyRpc | F5InternalRpc | "accounting_require_roles",
): "authenticated+service_role" | "service_role_only" {
  if (
    fn === "allow_invoice_issue_guard" ||
    fn === "enqueue_accounting_outbox_safe" ||
    fn === "claim_accounting_outbox_item"
  ) {
    return "service_role_only";
  }
  return "authenticated+service_role";
}

/** @deprecated use expectedExecuteGrantAfter0169 */
export function expectedExecuteGrantAfter0168(
  fn: F5FinancialRpc | F5InternalRpc | "accounting_require_roles",
): "authenticated+service_role" | "service_role_only" {
  return expectedExecuteGrantAfter0169(fn);
}

export function isStaffEquivalentToAdminOffice(): boolean {
  return true;
}

export function isEligibleCashAccountSubtype(subtype: string | null): boolean {
  return ["cash", "cash_clearing", "bank"].includes(subtype ?? "");
}
