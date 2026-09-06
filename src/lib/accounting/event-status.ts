/**
 * F4 accounting event status + failure codes (pure).
 */
export type AccountingPostStatus =
  | "not_applicable"
  | "disabled"
  | "pending"
  | "posted"
  | "failed"
  | "reversed"
  | "legacy_pre_cutover"
  | "review_required"
  | "skipped";

export type AccountingEventKind =
  | "invoice_issue"
  | "invoice_void"
  | "payment"
  | "payment_void"
  | "credit_memo_issue"
  | "credit_application"
  | "credit_application_void"
  | "credit_void"
  | "refund"
  | "refund_void"
  | "vendor_bill"
  | "vendor_bill_void"
  | "bill_payment"
  | "bill_payment_void"
  | "direct_expense"
  | "installer_bill"
  | "installer_bill_void"
  | "customer_deposit"
  | "customer_deposit_void"
  | "deposit_apply"
  | "deposit_apply_void"
  | "invoice_write_off"
  | "invoice_write_off_void"
  | "opening_balance"
  | "manual";

/**
 * fully_atomic — operational mutation AND journal in ONE DB transaction (verified).
 * outbox_guaranteed — source mutation AND durable outbox row in ONE DB transaction.
 * not_yet_guaranteed — separate app/API calls; do NOT pilot-activate.
 * unsupported_ambiguous — must not auto-post.
 */
export type AtomicityClass =
  | "fully_atomic"
  | "outbox_guaranteed"
  | "not_yet_guaranteed"
  | "unsupported_ambiguous";

export const ACCOUNTING_FAILURE = {
  MISSING_ACCOUNT_MAPPING: "missing_account_mapping",
  MISSING_PAYMENT_METHOD_MAPPING: "missing_payment_method_mapping",
  CLOSED_PERIOD: "closed_period",
  LOCKED_PERIOD: "locked_period",
  PRE_CUTOVER: "pre_cutover",
  DUPLICATE_SOURCE: "duplicate_source",
  TAX_REVIEW_REQUIRED: "tax_review_required",
  DEPOSIT_UNCLASSIFIED: "deposit_unclassified",
  AP_CATEGORY_MISSING: "ap_category_missing",
  EXPENSE_MAPPING_REVIEW: "expense_mapping_review",
  OUTBOX_RETRY_EXHAUSTED: "outbox_retry_exhausted",
  SOURCE_MISSING: "source_missing",
  REVERSAL_MISMATCH: "reversal_mismatch",
  POSTING_DISABLED: "posting_disabled",
  EVENT_FLAG_DISABLED: "event_flag_disabled",
  NOT_YET_GUARANTEED: "not_yet_guaranteed",
} as const;

export type AccountingFailureCode =
  (typeof ACCOUNTING_FAILURE)[keyof typeof ACCOUNTING_FAILURE];

export interface EventFlagSettings {
  posting_enabled: boolean;
  invoice_posting_enabled: boolean;
  payment_posting_enabled: boolean;
  credit_posting_enabled: boolean;
  ap_posting_enabled: boolean;
  expense_posting_enabled: boolean;
  deposit_posting_enabled: boolean;
  installer_posting_enabled: boolean;
  inventory_posting_enabled: boolean;
  cutover_date: string | null;
}

export function eventFlagForKind(
  kind: AccountingEventKind,
  flags: EventFlagSettings,
): boolean {
  if (!flags.posting_enabled) return false;
  switch (kind) {
    case "payment":
    case "payment_void":
      return flags.payment_posting_enabled;
    case "credit_memo_issue":
    case "credit_application":
    case "credit_application_void":
    case "credit_void":
    case "refund":
    case "refund_void":
      return flags.credit_posting_enabled;
    case "vendor_bill":
    case "vendor_bill_void":
    case "bill_payment":
    case "bill_payment_void":
      return flags.ap_posting_enabled;
    case "direct_expense":
      return flags.expense_posting_enabled;
    case "customer_deposit":
    case "customer_deposit_void":
    case "deposit_apply":
    case "deposit_apply_void":
      return flags.deposit_posting_enabled;
    case "invoice_issue":
    case "invoice_void":
    case "invoice_write_off":
    case "invoice_write_off_void":
      return flags.invoice_posting_enabled;
    case "installer_bill":
    case "installer_bill_void":
      return flags.installer_posting_enabled;
    case "opening_balance":
    case "manual":
      return true;
    default:
      return false;
  }
}

export function classifyAtomicity(kind: AccountingEventKind): AtomicityClass {
  switch (kind) {
    case "opening_balance":
    case "manual":
      return "fully_atomic";
    // F4 + F5: same-TX RPC enqueue with immutable snapshot (0163–0167).
    case "payment":
    case "payment_void":
    case "credit_application":
    case "credit_application_void":
    case "refund":
    case "refund_void":
    case "invoice_issue":
    case "invoice_void":
    case "invoice_write_off":
    case "invoice_write_off_void":
    case "credit_memo_issue":
    case "credit_void":
    case "vendor_bill":
    case "vendor_bill_void":
    case "bill_payment":
    case "bill_payment_void":
    case "direct_expense":
    case "customer_deposit":
    case "customer_deposit_void":
    case "deposit_apply":
    case "deposit_apply_void":
    case "installer_bill":
    case "installer_bill_void":
      return "outbox_guaranteed";
    default:
      return "unsupported_ambiguous";
  }
}

/** Human-readable rebuild mode for docs/tests. */
export function rebuildModeForKind(
  kind: AccountingEventKind,
): "SOURCE_RELOAD" | "IMMUTABLE_OUTBOX_SNAPSHOT" | "N_A" {
  switch (kind) {
    case "opening_balance":
    case "manual":
      return "N_A";
    default:
      return "IMMUTABLE_OUTBOX_SNAPSHOT";
  }
}

export function assessAccountingGate(args: {
  kind: AccountingEventKind;
  flags: EventFlagSettings;
  entryDate: string;
}):
  | { ok: true; status: "proceed" }
  | {
      ok: false;
      status: AccountingPostStatus;
      code: AccountingFailureCode;
      message: string;
    } {
  if (!args.flags.posting_enabled) {
    return {
      ok: false,
      status: "disabled",
      code: ACCOUNTING_FAILURE.POSTING_DISABLED,
      message: "Automatic accounting posting is disabled.",
    };
  }
  if (!eventFlagForKind(args.kind, args.flags)) {
    return {
      ok: false,
      status: "disabled",
      code: ACCOUNTING_FAILURE.EVENT_FLAG_DISABLED,
      message: `Posting for ${args.kind} is disabled.`,
    };
  }
  if (
    args.flags.cutover_date &&
    args.entryDate < args.flags.cutover_date &&
    args.kind !== "opening_balance"
  ) {
    return {
      ok: false,
      status: "legacy_pre_cutover",
      code: ACCOUNTING_FAILURE.PRE_CUTOVER,
      message: "Event date is before accounting cutover.",
    };
  }
  return { ok: true, status: "proceed" };
}

/** Derive display status from journal + outbox rows. */
export function resolveSourceAccountingStatus(args: {
  postingEnabled: boolean;
  cutoverDate: string | null;
  entryDate: string | null;
  journalPosted: boolean;
  journalReversed: boolean;
  outboxStatus: string | null;
  reviewRequired?: boolean;
}): AccountingPostStatus {
  if (args.journalReversed) return "reversed";
  if (args.journalPosted) return "posted";
  if (args.reviewRequired) return "review_required";
  if (args.outboxStatus === "pending" || args.outboxStatus === "processing") {
    return "pending";
  }
  if (
    args.outboxStatus === "failed" ||
    args.outboxStatus === "error" ||
    args.outboxStatus === "review_required"
  ) {
    return args.outboxStatus === "review_required" ? "review_required" : "failed";
  }
  if (!args.postingEnabled) return "disabled";
  if (
    args.cutoverDate &&
    args.entryDate &&
    args.entryDate < args.cutoverDate
  ) {
    return "legacy_pre_cutover";
  }
  if (args.outboxStatus === "skipped") return "skipped";
  return "not_applicable";
}
