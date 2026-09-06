"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getAccountMappings,
  postAccountingEvent,
  reverseJournalEntry,
} from "@/lib/data/accounting";
import { buildOpeningBalanceJournal } from "@/lib/accounting/builders";
import { assessJournalBalance } from "@/lib/accounting/journal";
import { assessBooksOfRecordEnable } from "@/lib/accounting/integrity";
import { assessPitrAttestation } from "@/lib/accounting/pitr-attestation";

export async function updateAccountingSettingsAction(formData: FormData) {
  await assertRole(["admin"]);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const posting_enabled = formData.get("posting_enabled") === "on";
  const inventory_posting_enabled =
    formData.get("inventory_posting_enabled") === "on";
  const invoice_posting_enabled =
    formData.get("invoice_posting_enabled") === "on";
  const payment_posting_enabled =
    formData.get("payment_posting_enabled") === "on";
  const credit_posting_enabled =
    formData.get("credit_posting_enabled") === "on";
  const ap_posting_enabled = formData.get("ap_posting_enabled") === "on";
  const expense_posting_enabled =
    formData.get("expense_posting_enabled") === "on";
  const deposit_posting_enabled =
    formData.get("deposit_posting_enabled") === "on";
  const installer_posting_enabled =
    formData.get("installer_posting_enabled") === "on";
  const books_of_record = formData.get("books_of_record") === "on";
  const cutover_date = String(formData.get("cutover_date") || "").trim() || null;
  const default_cash_method =
    String(formData.get("default_cash_method") || "undeposited") === "cash"
      ? "cash"
      : "undeposited";

  // Checkbox alone cannot flip books_of_record; openings + accountant validation required.
  const booksGate = assessBooksOfRecordEnable({
    requested: books_of_record,
    postingEnabled: posting_enabled,
    cutoverDate: cutover_date,
    openingBalancesEntered: false,
    accountantValidated: false,
  });
  const safeBooks = booksGate.ok ? booksGate.booksOfRecord : false;

  const { error } = await supabase
    .from("accounting_settings")
    .update({
      posting_enabled,
      inventory_posting_enabled,
      invoice_posting_enabled,
      payment_posting_enabled,
      credit_posting_enabled,
      ap_posting_enabled,
      expense_posting_enabled,
      deposit_posting_enabled,
      installer_posting_enabled,
      books_of_record: safeBooks,
      cutover_date,
      default_cash_method,
      updated_at: new Date().toISOString(),
      updated_by: user?.id ?? null,
    })
    .eq("id", 1);

  if (error) throw new Error(error.message);
  revalidatePath("/accounting");
}

function periodActionIdempotencyKey(
  formData: FormData,
  prefix: string,
  periodId: string,
): string {
  const fromForm = String(formData.get("idempotency_key") || "").trim();
  if (fromForm) return fromForm;
  return `${prefix}:${periodId}:${crypto.randomUUID()}`;
}

function periodRpcErrorMessage(
  error: { message: string } | null,
  data: unknown,
): string | null {
  if (error) {
    const msg = error.message.toLowerCase();
    if (
      error.message.includes("PGRST202") ||
      msg.includes("could not find the function") ||
      (msg.includes("does not exist") && msg.includes("function"))
    ) {
      return "Period control RPCs require migration 0177. Apply OWNER ACTION migration first.";
    }
    return error.message;
  }
  const result = data as { ok?: boolean; error?: string } | null;
  if (result && result.ok === false) {
    return result.error ?? "Period action failed.";
  }
  return null;
}

/** Close an open period via acct_period_close_safe (reason + idempotency required). */
export async function closeAccountingPeriodAction(formData: FormData) {
  const profile = await assertRole(["admin"]);
  const id = String(formData.get("period_id") || "");
  const reason = String(formData.get("reason") || "").trim();
  if (!id) throw new Error("Period is required.");
  if (!reason) throw new Error("Close reason is required.");
  const supabase = await createClient();
  const key = periodActionIdempotencyKey(formData, "period_close", id);
  const { data, error } = await supabase.rpc("acct_period_close_safe", {
    p_period_id: id,
    p_reason: reason,
    p_idempotency_key: key,
    p_created_by: profile.id,
  });
  const err = periodRpcErrorMessage(error, data);
  if (err) throw new Error(err);
  revalidatePath("/accounting");
}

/** Reopen a closed (not locked) period via acct_period_reopen_safe. */
export async function reopenAccountingPeriodAction(formData: FormData) {
  const profile = await assertRole(["admin"]);
  const id = String(formData.get("period_id") || "");
  const reason = String(formData.get("reason") || "").trim();
  if (!id) throw new Error("Period is required.");
  if (!reason) throw new Error("Reopen reason is required.");
  const supabase = await createClient();
  const key = periodActionIdempotencyKey(formData, "period_reopen", id);
  const { data, error } = await supabase.rpc("acct_period_reopen_safe", {
    p_period_id: id,
    p_reason: reason,
    p_idempotency_key: key,
    p_created_by: profile.id,
  });
  const err = periodRpcErrorMessage(error, data);
  if (err) throw new Error(err);
  revalidatePath("/accounting");
}

/** Lock a period via acct_period_lock_safe (reason + idempotency required). */
export async function lockAccountingPeriodAction(formData: FormData) {
  const profile = await assertRole(["admin"]);
  const id = String(formData.get("period_id") || "");
  const reason = String(formData.get("reason") || "").trim() || "Period lock";
  if (!id) throw new Error("Period is required.");
  const supabase = await createClient();
  const key = periodActionIdempotencyKey(formData, "period_lock", id);
  const { data, error } = await supabase.rpc("acct_period_lock_safe", {
    p_period_id: id,
    p_reason: reason,
    p_idempotency_key: key,
    p_created_by: profile.id,
  });
  const err = periodRpcErrorMessage(error, data);
  if (err) throw new Error(err);
  revalidatePath("/accounting");
}

/** Deactivate a non-system GL account via gl_account_deactivate_safe when available. */
export async function deactivateGlAccountAction(formData: FormData) {
  const profile = await assertRole(["admin"]);
  const accountId = String(formData.get("account_id") || "");
  const reason = String(formData.get("reason") || "").trim();
  if (!accountId) throw new Error("Account is required.");
  if (!reason) throw new Error("Deactivate reason is required.");
  const supabase = await createClient();
  const key =
    String(formData.get("idempotency_key") || "").trim() ||
    `gl_deactivate:${accountId}:${crypto.randomUUID()}`;
  const { data, error } = await supabase.rpc("gl_account_deactivate_safe", {
    p_account_id: accountId,
    p_reason: reason,
    p_idempotency_key: key,
    p_created_by: profile.id,
  });
  const err = periodRpcErrorMessage(error, data);
  if (err) throw new Error(err);
  revalidatePath("/accounting");
  revalidatePath("/accounting/chart-of-accounts");
}

export async function postManualJournalAction(formData: FormData): Promise<{
  error?: string;
  ok?: boolean;
}> {
  const profile = await assertRole(["admin"]);
  const entryDate = String(formData.get("entry_date") || "");
  const description = String(formData.get("description") || "Manual journal");
  const raw = String(formData.get("lines_json") || "[]");
  let parsed: {
    accountId: string;
    debit?: number;
    credit?: number;
    memo?: string;
  }[];
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "Invalid journal lines JSON." };
  }
  const gate = assessJournalBalance(
    parsed.map((l) => ({
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      memo: l.memo,
    })),
  );
  if (!gate.ok) return { error: gate.error };

  const key = `manual:${profile.id}:${entryDate}:${description}:${gate.debits}`;
  const result = await postAccountingEvent(
    {
      entryDate,
      description,
      sourceType: "manual",
      sourceId: null,
      entryKind: "manual",
      idempotencyKey: key,
      lines: parsed.map((l) => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        memo: l.memo,
      })),
    },
    { forceManual: true, userId: profile.id },
  );
  if (!result.ok) return { error: result.error };
  revalidatePath("/accounting");
  return { ok: true };
}

export async function postOpeningBalancesAction(formData: FormData): Promise<{
  error?: string;
  ok?: boolean;
}> {
  const profile = await assertRole(["admin"]);
  const entryDate = String(formData.get("entry_date") || "");
  const raw = String(formData.get("lines_json") || "[]");
  let parsed: {
    accountId: string;
    debit?: number;
    credit?: number;
    memo?: string;
  }[];
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "Invalid opening balance lines JSON." };
  }
  const mappings = await getAccountMappings();
  let built;
  try {
    built = buildOpeningBalanceJournal({
      entryDate,
      lines: parsed,
      mappings,
      openingId: entryDate,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Opening balance failed." };
  }
  const result = await postAccountingEvent(built, {
    forceManual: true,
    userId: profile.id,
  });
  if (!result.ok) return { error: result.error };
  revalidatePath("/accounting");
  return { ok: true };
}

export async function reverseJournalAction(formData: FormData): Promise<{
  error?: string;
  ok?: boolean;
}> {
  const profile = await assertRole(["admin"]);
  const journalEntryId = String(formData.get("journal_entry_id") || "");
  const reason = String(formData.get("reason") || "").trim();
  if (!reason) return { error: "Reversal reason is required." };
  const entryDate =
    String(formData.get("entry_date") || "") ||
    new Date().toISOString().slice(0, 10);
  const result = await reverseJournalEntry({
    journalEntryId,
    reason,
    userId: profile.id,
    entryDate,
  });
  if (!result.ok) return { error: result.error };
  revalidatePath("/accounting");
  return { ok: true };
}

export type BackupPitrFormState = { error?: string; ok?: boolean };

export async function confirmBackupPitrFormAction(
  _prev: BackupPitrFormState | null,
  formData: FormData,
): Promise<BackupPitrFormState> {
  return confirmBackupPitrAction(formData);
}

/** Admin-only external Backup/PITR attestation (does not enable posting). */
export async function confirmBackupPitrAction(formData: FormData): Promise<{
  error?: string;
  ok?: boolean;
}> {
  const profile = await assertRole(["admin"]);
  const evidence = String(formData.get("attestation_evidence") || "");
  const gate = assessPitrAttestation(evidence);
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_backup_pitr_safe", {
    p_confirmed_by: profile.id,
    p_attestation_evidence: gate.normalized,
  });
  if (error) return { error: error.message };

  const result = data as { ok?: boolean; error?: string; code?: string } | null;
  if (!result?.ok) {
    return { error: result?.error ?? "Backup/PITR attestation failed." };
  }

  revalidatePath("/accounting");
  return { ok: true };
}
