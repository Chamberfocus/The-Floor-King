"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function revalidateOpening() {
  revalidatePath("/accounting");
  revalidatePath("/accounting/opening-balances");
}

export async function createOpeningBalanceBatchAction(formData: FormData) {
  const profile = await assertRole(["admin"]);
  const asOf = String(formData.get("as_of_date") || "").trim();
  const description = String(formData.get("description") || "Opening balances");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_opening_balance_batch_safe", {
    p_as_of_date: asOf,
    p_description: description,
    p_actor: profile.id,
    p_idempotency_key: null,
  });
  if (error) return { error: error.message };
  const row = data as { ok?: boolean; error?: string; batch_id?: string };
  if (!row?.ok) return { error: row?.error ?? "Create failed." };
  revalidateOpening();
  return { ok: true as const, batchId: row.batch_id as string };
}

export async function saveOpeningBalanceDraftAction(formData: FormData) {
  const profile = await assertRole(["admin"]);
  const batchId = String(formData.get("batch_id") || "");
  const asOf = String(formData.get("as_of_date") || "").trim();
  const description = String(formData.get("description") || "Opening balances");
  let lines: unknown[] = [];
  let arItems: unknown[] = [];
  let apItems: unknown[] = [];
  try {
    lines = JSON.parse(String(formData.get("lines_json") || "[]"));
    arItems = JSON.parse(String(formData.get("ar_json") || "[]"));
    apItems = JSON.parse(String(formData.get("ap_json") || "[]"));
  } catch {
    return { error: "Invalid draft JSON." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_opening_balance_draft_safe", {
    p_batch_id: batchId,
    p_as_of_date: asOf,
    p_description: description,
    p_lines: lines,
    p_ar_items: arItems,
    p_ap_items: apItems,
    p_actor: profile.id,
  });
  if (error) return { error: error.message };
  const row = data as { ok?: boolean; error?: string };
  if (!row?.ok) return { error: row?.error ?? "Save failed." };
  revalidateOpening();
  return { ok: true as const };
}

export async function validateOpeningBalanceBatchAction(formData: FormData) {
  const profile = await assertRole(["admin"]);
  const batchId = String(formData.get("batch_id") || "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("validate_opening_balance_batch_safe", {
    p_batch_id: batchId,
    p_actor: profile.id,
  });
  if (error) return { error: error.message };
  const row = data as { ok?: boolean; error?: string };
  if (!row?.ok) return { error: row?.error ?? "Validation failed." };
  revalidateOpening();
  return { ok: true as const, result: row };
}

export async function finalizeOpeningBalancesAction(formData: FormData) {
  const profile = await assertRole(["admin"]);
  const batchId = String(formData.get("batch_id") || "");
  const confirm = formData.get("confirm") === "on" || formData.get("confirm") === "true";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finalize_opening_balances_safe", {
    p_batch_id: batchId,
    p_actor: profile.id,
    p_confirm: confirm,
  });
  if (error) return { error: error.message };
  const row = data as { ok?: boolean; error?: string; journal_entry_id?: string };
  if (!row?.ok) return { error: row?.error ?? "Finalize failed." };
  revalidateOpening();
  return { ok: true as const, journalEntryId: row.journal_entry_id };
}

export async function voidOpeningBalanceBatchAction(formData: FormData) {
  const profile = await assertRole(["admin"]);
  const batchId = String(formData.get("batch_id") || "");
  const reason = String(formData.get("void_reason") || "").trim();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("void_opening_balance_batch_safe", {
    p_batch_id: batchId,
    p_void_reason: reason,
    p_actor: profile.id,
  });
  if (error) return { error: error.message };
  const row = data as { ok?: boolean; error?: string };
  if (!row?.ok) return { error: row?.error ?? "Void failed." };
  revalidateOpening();
  return { ok: true as const };
}
