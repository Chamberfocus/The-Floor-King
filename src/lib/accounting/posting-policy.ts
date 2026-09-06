/**
 * F3 posting policy — when automatic posting may run.
 */
import {
  POSTING_DISABLED_MESSAGE,
  type JournalEntryKind,
} from "@/lib/accounting/types";

export interface AccountingRuntimeSettings {
  posting_enabled: boolean;
  inventory_posting_enabled: boolean;
  cutover_date: string | null;
  books_of_record: boolean;
  default_cash_method: "cash" | "undeposited";
}

export function assessAutoPostAllowed(args: {
  settings: AccountingRuntimeSettings;
  entryDate: string;
  entryKind: JournalEntryKind;
  sourceType: string;
}): { ok: true } | { ok: false; error: string; skipped: boolean } {
  if (args.settings.books_of_record !== true) {
    // Still allow posting into the foundation ledger when posting_enabled,
    // but never claim books-of-record.
  }

  if (!args.settings.posting_enabled) {
    // Opening-balance kind bypasses the auto-post gate at the app layer, but
    // post_journal_entry_safe (0172) requires trusted definer context.
    if (
      args.entryKind === "opening_balance" ||
      args.sourceType === "opening_balance"
    ) {
      return { ok: true };
    }
    return {
      ok: false,
      error:
        args.entryKind === "manual" || args.sourceType === "manual"
          ? "Manual journal posting is disabled until accounting posting is enabled."
          : POSTING_DISABLED_MESSAGE,
      skipped: true,
    };
  }

  if (
    args.settings.cutover_date &&
    args.entryDate < args.settings.cutover_date &&
    args.entryKind !== "opening_balance"
  ) {
    return {
      ok: false,
      error:
        "Entry date is before accounting cutover. Historical transactions are not auto-backfilled.",
      skipped: true,
    };
  }

  return { ok: true };
}

export function simulateConcurrentIdempotentPost(
  existingKeys: Set<string>,
  keyA: string,
  keyB: string,
): { accepted: string[]; rejected: string[] } {
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const key of [keyA, keyB]) {
    if (existingKeys.has(key)) {
      rejected.push(key);
      continue;
    }
    existingKeys.add(key);
    accepted.push(key);
  }
  return { accepted, rejected };
}
