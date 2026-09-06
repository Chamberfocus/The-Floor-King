"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function revalidateBankRecon(sessionId?: string) {
  revalidatePath("/accounting");
  revalidatePath("/accounting/bank-reconciliation");
  if (sessionId) {
    revalidatePath(`/accounting/bank-reconciliation/${sessionId}`);
  }
}

export async function createBankReconciliationAction(formData: FormData): Promise<void> {
  const profile = await assertRole(["admin", "office"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_bank_reconciliation_safe", {
    p_account_id: String(formData.get("account_id") || ""),
    p_statement_start: String(formData.get("statement_start") || ""),
    p_statement_end: String(formData.get("statement_end") || ""),
    p_opening_balance: Number(formData.get("opening_balance") || 0),
    p_ending_balance: Number(formData.get("ending_balance") || 0),
    p_notes: String(formData.get("notes") || ""),
    p_actor: profile.id,
    p_idempotency_key: String(formData.get("idempotency_key") || "") || null,
  });
  if (error) throw new Error(error.message);
  const row = data as { ok?: boolean; error?: string; session_id?: string };
  if (!row?.ok) throw new Error(row?.error ?? "Create failed.");
  revalidateBankRecon(row.session_id);
  redirect(`/accounting/bank-reconciliation/${row.session_id}`);
}

export async function stageBankImportAction(formData: FormData) {
  const profile = await assertRole(["admin", "office"]);
  const accountId = String(formData.get("account_id") || "");
  const fileName = String(formData.get("file_name") || "import.csv");
  let rows: unknown[] = [];
  try {
    rows = JSON.parse(String(formData.get("rows_json") || "[]"));
  } catch {
    return { error: "Invalid import rows." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stage_bank_statement_import_safe", {
    p_account_id: accountId,
    p_file_name: fileName,
    p_rows: rows,
    p_created_by: profile.id,
  });
  if (error) return { error: error.message };
  const row = data as {
    ok?: boolean;
    error?: string;
    batch_id?: string;
    source_row_count?: number;
    staged_row_count?: number;
    rejected_row_count?: number;
    exact_reimport_count?: number;
    possible_duplicate_count?: number;
  };
  if (!row?.ok) return { error: row?.error ?? "Import failed." };
  revalidateBankRecon();
  return { ok: true as const, ...row };
}

export async function attachImportToSessionAction(formData: FormData) {
  const profile = await assertRole(["admin", "office"]);
  const sessionId = String(formData.get("session_id") || "");
  const batchId = String(formData.get("batch_id") || "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("attach_bank_import_to_reconciliation_safe", {
    p_session_id: sessionId,
    p_batch_id: batchId,
    p_actor: profile.id,
  });
  if (error) return { error: error.message };
  const row = data as { ok?: boolean; error?: string };
  if (!row?.ok) return { error: row?.error ?? "Attach failed." };
  revalidateBankRecon(sessionId);
  return { ok: true as const };
}

export async function createBankMatchAction(formData: FormData) {
  const profile = await assertRole(["admin", "office"]);
  const sessionId = String(formData.get("session_id") || "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_bank_match_safe", {
    p_session_id: sessionId,
    p_import_line_id: String(formData.get("import_line_id") || ""),
    p_journal_line_id: String(formData.get("journal_line_id") || ""),
    p_allocated_amount: Number(formData.get("allocated_amount") || 0),
    p_actor: profile.id,
    p_idempotency_key: String(formData.get("idempotency_key") || "") || null,
  });
  if (error) return { error: error.message };
  const row = data as { ok?: boolean; error?: string };
  if (!row?.ok) return { error: row?.error ?? "Match failed." };
  revalidateBankRecon(sessionId);
  return { ok: true as const };
}

export async function removeBankMatchAction(formData: FormData) {
  const profile = await assertRole(["admin", "office"]);
  const sessionId = String(formData.get("session_id") || "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("remove_bank_match_safe", {
    p_match_id: String(formData.get("match_id") || ""),
    p_reason: String(formData.get("reason") || ""),
    p_actor: profile.id,
  });
  if (error) return { error: error.message };
  const row = data as { ok?: boolean; error?: string };
  if (!row?.ok) return { error: row?.error ?? "Remove failed." };
  revalidateBankRecon(sessionId);
  return { ok: true as const };
}

export async function resolveDuplicateAction(formData: FormData) {
  const profile = await assertRole(["admin", "office"]);
  const sessionId = String(formData.get("session_id") || "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_bank_import_duplicate_safe", {
    p_import_line_id: String(formData.get("import_line_id") || ""),
    p_resolution: String(formData.get("resolution") || ""),
    p_reason: String(formData.get("reason") || ""),
    p_actor: profile.id,
  });
  if (error) return { error: error.message };
  const row = data as { ok?: boolean; error?: string };
  if (!row?.ok) return { error: row?.error ?? "Resolve failed." };
  revalidateBankRecon(sessionId);
  return { ok: true as const };
}

export async function finalizeBankReconciliationAction(formData: FormData) {
  const profile = await assertRole(["admin", "office"]);
  const sessionId = String(formData.get("session_id") || "");
  const confirm =
    formData.get("confirm") === "on" ||
    formData.get("confirm") === "true" ||
    formData.get("p_confirm") === "true";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finalize_bank_reconciliation_safe", {
    p_session_id: sessionId,
    p_actor: profile.id,
    p_confirm: confirm,
  });
  if (error) return { error: error.message };
  const row = data as { ok?: boolean; error?: string };
  if (!row?.ok) return { error: row?.error ?? "Finalize failed." };
  revalidateBankRecon(sessionId);
  return { ok: true as const };
}

export async function voidBankReconciliationAction(formData: FormData) {
  const profile = await assertRole(["admin"]);
  const sessionId = String(formData.get("session_id") || "");
  const reason = String(formData.get("void_reason") || "").trim();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("void_bank_reconciliation_safe", {
    p_session_id: sessionId,
    p_reason: reason,
    p_actor: profile.id,
  });
  if (error) return { error: error.message };
  const row = data as { ok?: boolean; error?: string };
  if (!row?.ok) return { error: row?.error ?? "Void failed." };
  revalidateBankRecon(sessionId);
  return { ok: true as const };
}
