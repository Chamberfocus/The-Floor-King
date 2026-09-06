/**
 * F3 accounting data access + posting helpers (server).
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  AccountMappingDict,
  BuiltJournalEntry,
} from "@/lib/accounting/types";
import { assessJournalBalance, buildReversalLines } from "@/lib/accounting/journal";
import {
  assessAutoPostAllowed,
  type AccountingRuntimeSettings,
} from "@/lib/accounting/posting-policy";

export async function getAccountingSettings(): Promise<
  AccountingRuntimeSettings & {
    invoice_posting_enabled: boolean;
    payment_posting_enabled: boolean;
    credit_posting_enabled: boolean;
    ap_posting_enabled: boolean;
    expense_posting_enabled: boolean;
    deposit_posting_enabled: boolean;
    installer_posting_enabled: boolean;
    opening_balances_entered: boolean;
    accountant_validated: boolean;
    backup_pitr_confirmed_at: string | null;
    backup_pitr_confirmed_by: string | null;
  }
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("accounting_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  return {
    posting_enabled: Boolean(data?.posting_enabled),
    inventory_posting_enabled: Boolean(data?.inventory_posting_enabled),
    cutover_date: (data?.cutover_date as string | null) ?? null,
    books_of_record: Boolean(data?.books_of_record),
    default_cash_method:
      (data?.default_cash_method as "cash" | "undeposited") ?? "undeposited",
    invoice_posting_enabled: Boolean(data?.invoice_posting_enabled),
    payment_posting_enabled: Boolean(data?.payment_posting_enabled),
    credit_posting_enabled: Boolean(data?.credit_posting_enabled),
    ap_posting_enabled: Boolean(data?.ap_posting_enabled),
    expense_posting_enabled: Boolean(data?.expense_posting_enabled),
    deposit_posting_enabled: Boolean(data?.deposit_posting_enabled),
    installer_posting_enabled: Boolean(data?.installer_posting_enabled),
    opening_balances_entered: Boolean(data?.opening_balances_entered),
    accountant_validated: Boolean(data?.accountant_validated),
    backup_pitr_confirmed_at:
      (data?.backup_pitr_confirmed_at as string | null) ?? null,
    backup_pitr_confirmed_by:
      (data?.backup_pitr_confirmed_by as string | null) ?? null,
  };
}

export async function getAccountMappings(): Promise<AccountMappingDict> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("accounting_account_mappings")
    .select("mapping_key, account_id");
  const map: AccountMappingDict = {};
  for (const row of data ?? []) {
    map[row.mapping_key as string] = row.account_id as string;
  }
  return map;
}

export async function listGlAccounts() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("gl_accounts")
    .select("id, code, name, account_type, subtype, is_active, is_system")
    .order("code");
  return data ?? [];
}

export async function listPostedJournalLines(args?: {
  startDate?: string;
  endDate?: string;
}) {
  const supabase = await createClient();
  let q = supabase
    .from("journal_lines")
    .select(
      "id, account_id, debit, credit, journal_entry:journal_entries!inner(id, entry_date, status, entry_kind, reversal_of_id)",
    );
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const lines = [];
  for (const row of data ?? []) {
    const je = row.journal_entry as unknown as {
      entry_date: string;
      status: string;
      entry_kind: string;
      reversal_of_id: string | null;
    };
    if (je.status !== "posted") continue;
    if (args?.startDate && je.entry_date < args.startDate) continue;
    if (args?.endDate && je.entry_date > args.endDate) continue;
    lines.push({
      accountId: row.account_id as string,
      debit: Number(row.debit) || 0,
      credit: Number(row.credit) || 0,
      entryDate: je.entry_date,
      entryStatus: je.status,
      isReversal: Boolean(je.reversal_of_id),
    });
  }
  return lines;
}

function linesToJson(entry: BuiltJournalEntry) {
  return entry.lines.map((l) => ({
    account_id: l.accountId,
    debit: l.debit ?? 0,
    credit: l.credit ?? 0,
    memo: l.memo ?? null,
    customer_id: l.customerId ?? null,
    vendor_id: l.vendorId ?? null,
    job_id: l.jobId ?? null,
    invoice_id: l.invoiceId ?? null,
    bill_id: l.billId ?? null,
  }));
}

/**
 * Canonical posting entrypoint. Validates locally, then calls DB RPC.
 * Returns skipped when auto-posting is disabled (not an unexplained failure).
 */
export async function postAccountingEvent(
  entry: BuiltJournalEntry,
  opts?: {
    forceManual?: boolean;
    userId?: string | null;
    asServiceProcessor?: boolean;
  },
): Promise<
  | { ok: true; journalEntryId: string; duplicate: boolean }
  | { ok: false; error: string; skipped?: boolean }
> {
  const balance = assessJournalBalance(entry.lines);
  if (!balance.ok) return { ok: false, error: balance.error };

  const settings = await getAccountingSettings();
  const policy = assessAutoPostAllowed({
    settings,
    entryDate: entry.entryDate,
    entryKind: opts?.forceManual ? "manual" : entry.entryKind,
    sourceType: entry.sourceType,
  });
  if (!policy.ok) {
    return { ok: false, error: policy.error, skipped: policy.skipped };
  }

  const supabase = opts?.asServiceProcessor
    ? createAdminClient()
    : await createClient();
  const { data, error } = await supabase.rpc("post_journal_entry_safe", {
    p_entry_date: entry.entryDate,
    p_description: entry.description,
    p_source_type: entry.sourceType,
    p_source_id: entry.sourceId,
    p_entry_kind: entry.entryKind,
    p_idempotency_key: entry.idempotencyKey,
    p_lines: linesToJson(entry),
    p_posted_by: opts?.userId ?? null,
    p_reversal_of_id: entry.reversalOfId ?? null,
    p_reversal_reason: entry.reversalReason ?? null,
  });

  if (error) return { ok: false, error: error.message };
  const result = data as {
    ok?: boolean;
    error?: string;
    journal_entry_id?: string;
    duplicate?: boolean;
    skipped?: boolean;
  };
  if (!result?.ok) {
    return {
      ok: false,
      error: result?.error ?? "Journal posting failed.",
      skipped: Boolean(result?.skipped),
    };
  }
  return {
    ok: true,
    journalEntryId: result.journal_entry_id as string,
    duplicate: Boolean(result.duplicate),
  };
}

export async function reverseJournalEntry(args: {
  journalEntryId: string;
  reason: string;
  userId: string;
  entryDate: string;
}): Promise<
  | { ok: true; journalEntryId: string; duplicate: boolean }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const { data: original, error } = await supabase
    .from("journal_entries")
    .select("id, status, reversed_by_id, source_type, source_id, description")
    .eq("id", args.journalEntryId)
    .maybeSingle();
  if (error || !original) {
    return { ok: false, error: error?.message ?? "Journal not found." };
  }
  if (original.status !== "posted") {
    return { ok: false, error: "Only posted journals can be reversed." };
  }
  if (original.reversed_by_id) {
    return { ok: false, error: "Journal entry already reversed." };
  }

  const { data: lines } = await supabase
    .from("journal_lines")
    .select(
      "account_id, debit, credit, memo, customer_id, vendor_id, job_id, invoice_id, bill_id",
    )
    .eq("journal_entry_id", args.journalEntryId);

  const reversalLines = buildReversalLines(
    (lines ?? []).map((l) => ({
      accountId: l.account_id as string,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      memo: l.memo as string | null,
      customerId: l.customer_id as string | null,
      vendorId: l.vendor_id as string | null,
      jobId: l.job_id as string | null,
      invoiceId: l.invoice_id as string | null,
      billId: l.bill_id as string | null,
    })),
  );

  return postAccountingEvent(
    {
      entryDate: args.entryDate,
      description: `Reversal of ${original.description ?? args.journalEntryId}`,
      sourceType: original.source_type as string,
      sourceId: (original.source_id as string | null) ?? null,
      entryKind: "reversal",
      idempotencyKey: `reversal:${args.journalEntryId}`,
      lines: reversalLines,
      reversalOfId: args.journalEntryId,
      reversalReason: args.reason,
    },
    { forceManual: true, userId: args.userId },
  );
}
