/**
 * F3 Accounting Foundation — shared types & system mapping keys.
 * Ledger is double-entry. Books-of-record remains OFF until cutover validation.
 */

export type GlAccountType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "expense";

export type AccountingPeriodStatus = "open" | "closed" | "locked";

export type JournalEntryStatus = "draft" | "posted" | "void";

export type JournalEntryKind =
  | "post"
  | "reversal"
  | "opening_balance"
  | "manual"
  | "correction";

/** Stable mapping keys — never hard-code account UUIDs in app logic. */
export const SYSTEM_ACCOUNT_KEYS = [
  "cash_operating",
  "undeposited_funds",
  "accounts_receivable",
  "inventory_asset",
  "accounts_payable",
  "sales_tax_payable",
  "customer_deposits",
  "customer_credit_liability",
  "opening_balance_equity",
  "owner_equity",
  "retained_earnings",
  "default_sales_revenue",
  "sales_discounts",
  "material_cogs",
  "installer_labor_cogs",
  "default_expense",
  "bad_debt_expense",
] as const;

export type SystemAccountKey = (typeof SYSTEM_ACCOUNT_KEYS)[number];

export interface GlAccountLike {
  id: string;
  code: string;
  name: string;
  account_type: GlAccountType;
  subtype?: string | null;
  is_active?: boolean;
  is_system?: boolean;
}

export interface JournalLineInput {
  accountId: string;
  debit?: number;
  credit?: number;
  memo?: string | null;
  customerId?: string | null;
  vendorId?: string | null;
  jobId?: string | null;
  invoiceId?: string | null;
  billId?: string | null;
}

export interface BuiltJournalEntry {
  entryDate: string; // YYYY-MM-DD
  description: string;
  sourceType: string;
  sourceId: string | null;
  entryKind: JournalEntryKind;
  idempotencyKey: string;
  lines: JournalLineInput[];
  reversalOfId?: string | null;
  reversalReason?: string | null;
}

export interface AccountMappingDict {
  [key: string]: string; // mapping_key → account_id
}

export const ACCOUNTING_NOT_BOOKS_MESSAGE =
  "Floor King CRM accounting ledger is a foundation only. External books remain official until cutover validation.";

export const UNBALANCED_JOURNAL_MESSAGE =
  "Journal entry must balance: total debits must equal total credits.";

export const JOURNAL_IMMUTABLE_MESSAGE =
  "Posted journal entries cannot be edited or deleted. Create a reversal.";

export const PERIOD_CLOSED_MESSAGE =
  "Cannot post into a closed accounting period.";

export const PERIOD_LOCKED_MESSAGE =
  "Cannot post into a locked accounting period.";

export const POSTING_DISABLED_MESSAGE =
  "Automatic accounting posting is disabled until cutover validation.";

export const INVENTORY_POSTING_DISABLED_MESSAGE =
  "Inventory perpetual accounting posting is not enabled — operational stock data is not treated as books COGS.";

export const DUPLICATE_SOURCE_POSTING_MESSAGE =
  "This source event already has a posted journal entry.";

export const DOUBLE_REVERSAL_MESSAGE =
  "This journal entry has already been reversed.";
