/**
 * F6-P1/P2A financial audit log types and action registry.
 * Immutable append-only trail in financial_audit_log (0170+).
 * Complements accounting_posting_outbox for GL evidence.
 */

/** Stable action names written by money RPCs (0170 + 0171). */
export type FinancialAuditAction =
  | "invoice_finalized"
  | "invoice_voided"
  | "invoice_payment_recorded"
  | "payment_voided"
  | "credit_memo_issued"
  | "credit_memo_voided"
  | "credit_applied"
  | "credit_application_voided"
  | "refund_recorded"
  | "refund_voided"
  | "customer_deposit_recorded"
  | "deposit_applied"
  | "deposit_application_voided"
  | "deposit_voided"
  | "vendor_bill_posted"
  | "bill_payment_recorded"
  | "bill_payment_voided"
  | "direct_expense_recorded"
  | "manual_journal_posted"
  | "journal_entry_posted"
  | "opening_balance_batch_created"
  | "opening_balance_validated"
  | "opening_balance_posted"
  | "opening_balance_reversed"
  | "journal_reversal_posted"
  | "bank_reconciliation_completed"
  | "bank_reconciliation_created"
  | "bank_statement_imported"
  | "bank_import_attached"
  | "bank_match_created"
  | "bank_match_removed"
  | "bank_duplicate_resolved"
  | "bank_import_line_excluded"
  | "bank_reconciliation_finalized"
  | "bank_reconciliation_voided"
  | "bank_reconciliation_cancelled"
  | "invoice_write_off"
  | "invoice_write_off_voided"
  | "backup_pitr_confirmed"
  | "bank_import_staged"
  | "installer_labor_created"
  | "installer_labor_cancelled"
  | "installer_labor_approved"
  | "installer_labor_reversed"
  | "installer_labor_corrected"
  | "installer_labor_paid"
  | "installer_labor_ap_linked"
  | "installer_labor_ap_voided"
  | "installer_labor_payroll_ops_recorded"
  | "vendor_bill_created"
  | "vendor_bill_activated"
  | "vendor_bill_voided"
  | "vendor_bill_corrected"
  | "estimate_approved";

/** Human-readable labels for audit actions (read-only UI). */
export const FINANCIAL_AUDIT_ACTION_LABELS: Record<FinancialAuditAction, string> = {
  invoice_finalized: "Invoice finalized",
  invoice_voided: "Invoice voided",
  invoice_payment_recorded: "Payment recorded",
  payment_voided: "Payment voided",
  credit_memo_issued: "Credit memo issued",
  credit_memo_voided: "Credit memo voided",
  credit_applied: "Credit applied",
  credit_application_voided: "Credit application voided",
  refund_recorded: "Refund recorded",
  refund_voided: "Refund voided",
  customer_deposit_recorded: "Customer deposit recorded",
  deposit_applied: "Deposit applied",
  deposit_application_voided: "Deposit application voided",
  deposit_voided: "Deposit voided",
  vendor_bill_posted: "Vendor bill posted",
  bill_payment_recorded: "Bill payment recorded",
  bill_payment_voided: "Bill payment voided",
  direct_expense_recorded: "Direct expense recorded",
  manual_journal_posted: "Manual journal posted",
  journal_entry_posted: "Journal entry posted",
  opening_balance_batch_created: "Opening balance batch created",
  opening_balance_validated: "Opening balance validated",
  opening_balance_posted: "Opening balance posted",
  opening_balance_reversed: "Opening balance reversed",
  journal_reversal_posted: "Journal reversal posted",
  bank_reconciliation_completed: "Bank reconciliation completed",
  bank_reconciliation_created: "Bank reconciliation created",
  bank_statement_imported: "Bank statement imported",
  bank_import_attached: "Bank import attached",
  bank_match_created: "Bank match created",
  bank_match_removed: "Bank match removed",
  bank_duplicate_resolved: "Bank duplicate resolved",
  bank_import_line_excluded: "Bank import line excluded",
  bank_reconciliation_finalized: "Bank reconciliation finalized",
  bank_reconciliation_voided: "Bank reconciliation voided",
  bank_reconciliation_cancelled: "Bank reconciliation cancelled",
  invoice_write_off: "Invoice write-off",
  invoice_write_off_voided: "Invoice write-off voided",
  backup_pitr_confirmed: "Backup/PITR attestation",
  bank_import_staged: "Bank import staged",
  installer_labor_created: "Installer labor created",
  installer_labor_cancelled: "Installer labor cancelled",
  installer_labor_approved: "Installer labor approved",
  installer_labor_reversed: "Installer labor reversed",
  installer_labor_corrected: "Installer labor corrected",
  installer_labor_paid: "Installer labor marked paid",
  installer_labor_ap_linked: "Installer labor linked to vendor AP",
  installer_labor_ap_voided: "Installer labor vendor AP voided",
  installer_labor_payroll_ops_recorded: "Installer payroll ops status recorded",
  vendor_bill_created: "Vendor bill created",
  vendor_bill_activated: "Vendor bill activated",
  vendor_bill_voided: "Vendor bill voided",
  vendor_bill_corrected: "Vendor bill corrected",
  estimate_approved: "Estimate approved",
};

/** All audited actions in stable sort order (for filters). */
export const FINANCIAL_AUDIT_ACTIONS = Object.keys(
  FINANCIAL_AUDIT_ACTION_LABELS,
) as FinancialAuditAction[];

export interface FinancialAuditEntry {
  id: string;
  occurredAt: string;
  actorId: string | null;
  action: FinancialAuditAction | string;
  entityType: string;
  entityId: string | null;
  economicDate: string | null;
  reason: string | null;
  payload: Record<string, unknown>;
  idempotencyKey: string | null;
}

export interface FinancialAuditFilters {
  startDate?: string;
  endDate?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  limit?: number;
}

/** Outbox + journal remain authoritative for GL; audit log covers human actions. */
export const AUDIT_ARCHITECTURE_NOTE =
  "financial_audit_log captures actor/action/reason. accounting_posting_outbox + journal_entries remain immutable GL evidence.";

/** Deterministic audit idempotency key patterns (0171). */
export const AUDIT_IDEMPOTENCY_PATTERNS = {
  payment: (id: string) => `audit:payment:${id}`,
  paymentVoid: (id: string) => `audit:payment_void:${id}`,
  creditApply: (id: string) => `audit:credit_apply:${id}`,
  creditApplicationVoid: (id: string) => `audit:credit_application_void:${id}`,
  refund: (id: string) => `audit:refund:${id}`,
  refundVoid: (id: string) => `audit:refund_void:${id}`,
  deposit: (id: string) => `audit:deposit:${id}`,
  depositApply: (id: string) => `audit:deposit_apply:${id}`,
  depositApplicationVoid: (id: string) => `audit:deposit_application_void:${id}`,
  depositVoid: (id: string) => `audit:deposit_void:${id}`,
  writeOff: (id: string) => `audit:write_off:${id}`,
  writeOffVoid: (id: string) => `audit:write_off_void:${id}`,
  journal: (id: string) => `audit:journal:${id}`,
  invoiceFinalize: (id: string) => `audit:invoice_finalize:${id}`,
  invoiceVoid: (id: string) => `audit:invoice_void:${id}`,
  creditMemo: (id: string) => `audit:credit_memo:${id}`,
  creditMemoVoid: (id: string) => `audit:credit_memo_void:${id}`,
  vendorBill: (id: string) => `audit:vendor_bill:${id}`,
  billPayment: (id: string) => `audit:bill_payment:${id}`,
  billPaymentVoid: (id: string) => `audit:bill_payment_void:${id}`,
  expense: (id: string) => `audit:expense:${id}`,
  bankRecon: (id: string) => `audit:bank_recon:${id}`,
  openingBatchCreate: (id: string) => `audit:opening_batch_create:${id}`,
  openingBatchValidate: (id: string) => `audit:opening_batch_validate:${id}`,
  openingBatchPost: (id: string) => `audit:opening_batch_post:${id}`,
  openingBatchVoid: (id: string) => `audit:opening_batch_void:${id}`,
} as const;
