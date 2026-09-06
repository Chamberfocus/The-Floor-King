/**
 * F3 accounting integrity helpers — credit lifecycle, labor SoT, books gates.
 * Pure functions for deterministic review tests.
 */
import {
  buildCreditApplicationJournal,
  buildCreditMemoIssueJournal,
  buildInvoiceIssueJournal,
  buildPaymentJournal,
} from "@/lib/accounting/builders";
import { buildReversalLines } from "@/lib/accounting/journal";
import type {
  AccountMappingDict,
  BuiltJournalEntry,
  GlAccountLike,
} from "@/lib/accounting/types";
import {
  accountNaturalBalance,
  type PostedLineForReport,
} from "@/lib/accounting/reports";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export const CREDIT_VOID_CONSUMED_MESSAGE =
  "Cannot void a credit memo that still has active applications. Reverse applications first.";

export const INSTALLER_AUTO_POST_DISABLED_MESSAGE =
  "Installer/labor automatic ledger posting is disabled until a single authoritative source is cut over (installer_bills). job_labor must not also post.";

export const TAX_CREDIT_DECOMPOSITION_NOT_READY =
  "TAX CREDIT DECOMPOSITION NOT YET BOOKS-OF-RECORD READY";

/** Natural balance for one account from posted lines (as-of optional). */
export function ledgerAccountBalance(args: {
  accountId: string;
  accountType: GlAccountLike["account_type"];
  lines: PostedLineForReport[];
  asOfDate?: string;
}): number {
  let debit = 0;
  let credit = 0;
  for (const l of args.lines) {
    if (l.entryStatus !== "posted") continue;
    if (l.accountId !== args.accountId) continue;
    if (args.asOfDate && l.entryDate > args.asOfDate) continue;
    debit = round2(debit + (Number(l.debit) || 0));
    credit = round2(credit + (Number(l.credit) || 0));
  }
  return accountNaturalBalance(args.accountType, debit, credit);
}

export function toPostedLines(
  entries: BuiltJournalEntry[],
): PostedLineForReport[] {
  const out: PostedLineForReport[] = [];
  for (const entry of entries) {
    for (const l of entry.lines) {
      out.push({
        accountId: l.accountId,
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
        entryDate: entry.entryDate,
        entryStatus: "posted",
      });
    }
  }
  return out;
}

/**
 * Unused credit memo void = reverse the issue journal.
 * Consumed credits must reverse applications first.
 */
export function assessCreditMemoVoidAccounting(args: {
  activeApplicationTotal: number;
}): { ok: true } | { ok: false; error: string } {
  if (round2(args.activeApplicationTotal) > 0.005) {
    return { ok: false, error: CREDIT_VOID_CONSUMED_MESSAGE };
  }
  return { ok: true };
}

export function buildCreditMemoVoidJournal(args: {
  issueEntry: BuiltJournalEntry;
  voidDate: string;
  creditMemoId: string;
}): BuiltJournalEntry {
  return {
    entryDate: args.voidDate,
    description: `Void credit memo ${args.creditMemoId}`,
    sourceType: "credit_memo",
    sourceId: args.creditMemoId,
    entryKind: "reversal",
    idempotencyKey: `credit_memo:${args.creditMemoId}:void`,
    lines: buildReversalLines(args.issueEntry.lines),
    reversalReason: "Credit memo voided",
  };
}

export function buildRefundVoidJournal(args: {
  refundEntry: BuiltJournalEntry;
  voidDate: string;
  refundId: string;
}): BuiltJournalEntry {
  return {
    entryDate: args.voidDate,
    description: `Void refund ${args.refundId}`,
    sourceType: "refund",
    sourceId: args.refundId,
    entryKind: "reversal",
    idempotencyKey: `refund:${args.refundId}:void`,
    lines: buildReversalLines(args.refundEntry.lines),
    reversalReason: "Refund voided",
  };
}

/**
 * Authoritative future labor posting source. Auto posting remains OFF;
 * never allow both job_labor and installer_bills.
 */
export type InstallerLaborAccountingSource =
  | "installer_bills"
  | "job_labor"
  | "none";

export function assessInstallerLaborAutoPost(args: {
  enabled: boolean;
  source: InstallerLaborAccountingSource;
  eventSource: "installer_bills" | "job_labor";
}): { ok: true } | { ok: false; error: string; skipped?: boolean } {
  if (!args.enabled || args.source === "none") {
    return {
      ok: false,
      error: INSTALLER_AUTO_POST_DISABLED_MESSAGE,
      skipped: true,
    };
  }
  if (args.eventSource !== args.source) {
    return {
      ok: false,
      error: `Installer labor posting source is ${args.source}; ignoring ${args.eventSource}.`,
      skipped: true,
    };
  }
  return { ok: true };
}

/** Documented tax limitation for tax-inclusive commercial credits. */
export function creditTaxDecompositionStatus(): {
  ready: false;
  flag: typeof TAX_CREDIT_DECOMPOSITION_NOT_READY;
  salesTaxPayableMayBeOverstated: true;
  salesDiscountsIncludesTaxInclusiveAmount: true;
} {
  return {
    ready: false,
    flag: TAX_CREDIT_DECOMPOSITION_NOT_READY,
    salesTaxPayableMayBeOverstated: true,
    salesDiscountsIncludesTaxInclusiveAmount: true,
  };
}

export function assessBooksOfRecordEnable(args: {
  requested: boolean;
  postingEnabled: boolean;
  cutoverDate: string | null | undefined;
  openingBalancesEntered: boolean;
  accountantValidated: boolean;
}):
  | { ok: true; booksOfRecord: boolean }
  | { ok: false; error: string; booksOfRecord: false } {
  if (!args.requested) {
    return { ok: true, booksOfRecord: false };
  }
  if (!args.postingEnabled) {
    return {
      ok: false,
      error: "Cannot enable books_of_record while posting_enabled is false.",
      booksOfRecord: false,
    };
  }
  if (!args.cutoverDate) {
    return {
      ok: false,
      error: "Cannot enable books_of_record without an explicit cutover date.",
      booksOfRecord: false,
    };
  }
  if (!args.openingBalancesEntered) {
    return {
      ok: false,
      error: "Cannot enable books_of_record before opening balances are entered.",
      booksOfRecord: false,
    };
  }
  if (!args.accountantValidated) {
    return {
      ok: false,
      error: "Cannot enable books_of_record before accountant/owner validation.",
      booksOfRecord: false,
    };
  }
  return { ok: true, booksOfRecord: true };
}

/** Convenience: partial-pay + credit-applied lifecycle for tests. */
export function buildPartialPayCreditLifecycle(args: {
  mappings: AccountMappingDict;
  invoiceId?: string;
  taxRate?: number;
}) {
  const invoiceId = args.invoiceId ?? "inv-partial";
  const taxRate = args.taxRate ?? 0;
  const issue = buildInvoiceIssueJournal({
    invoiceId,
    entryDate: "2026-08-01",
    items: [{ quantity: 1, rate: 10000 }],
    taxRate,
    mappings: args.mappings,
  });
  const pay = buildPaymentJournal({
    paymentId: `pay-${invoiceId}`,
    invoiceId,
    amount: 6000,
    entryDate: "2026-08-02",
    mappings: args.mappings,
    cashPreference: "cash",
  });
  const credit = buildCreditMemoIssueJournal({
    creditMemoId: `cm-${invoiceId}`,
    amount: 1500,
    entryDate: "2026-08-03",
    mappings: args.mappings,
  });
  const apply = buildCreditApplicationJournal({
    applicationId: `ca-${invoiceId}`,
    amount: 1500,
    entryDate: "2026-08-03",
    invoiceId,
    mappings: args.mappings,
  });
  return { issue, pay, credit, apply };
}

export function buildFullyPaidCreditLifecycle(args: {
  mappings: AccountMappingDict;
  invoiceId?: string;
}) {
  const invoiceId = args.invoiceId ?? "inv-full";
  const issue = buildInvoiceIssueJournal({
    invoiceId,
    entryDate: "2026-08-01",
    items: [{ quantity: 1, rate: 10000 }],
    taxRate: 0,
    mappings: args.mappings,
  });
  const pay = buildPaymentJournal({
    paymentId: `pay-${invoiceId}`,
    invoiceId,
    amount: 10000,
    entryDate: "2026-08-02",
    mappings: args.mappings,
    cashPreference: "cash",
  });
  const credit = buildCreditMemoIssueJournal({
    creditMemoId: `cm-${invoiceId}`,
    amount: 1500,
    entryDate: "2026-08-03",
    mappings: args.mappings,
  });
  return { issue, pay, credit };
}
