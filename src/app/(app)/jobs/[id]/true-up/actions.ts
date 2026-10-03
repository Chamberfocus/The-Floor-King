"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { assertTrueUpCapability, moneyToCents } from "@/lib/job-true-up";
import type { UserRole } from "@/lib/types";

export type ActionResult = { ok: true; detail?: string } | { ok: false; error: string };

function fail(error: { message: string } | null, fallback: string): ActionResult {
  if (!error) return { ok: true };
  if (/does not exist|schema cache|42883|job_true_up/i.test(error.message)) {
    return {
      ok: false,
      error:
        "True-up is not installed in this database yet. Apply supabase/migrations/0481_job_true_up.sql in the Supabase SQL editor. Nothing was written.",
    };
  }
  return { ok: false, error: error.message || fallback };
}

async function staff() {
  const profile = await assertRole(["admin", "office"]);
  assertTrueUpCapability(profile.role, "enterCosts");
  return profile;
}

export async function saveTrueUpCost(input: {
  jobId: string;
  category: "material" | "labor" | "freight" | "other";
  kind: "confirm_zero" | "manual_amount";
  amount: string;
  reason: string;
  note: string;
}): Promise<ActionResult> {
  await staff();
  const cents = input.kind === "confirm_zero" ? BigInt(0) : moneyToCents(input.amount);
  if (cents == null) return { ok: false, error: "Enter a dollar amount." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_true_up_entry", {
    p_job_id: input.jobId,
    p_category: input.category,
    p_kind: input.kind,
    p_amount_cents: Number(cents),
    p_reason: input.reason,
    p_note: input.note,
  });
  const result = fail(error, "Could not save the cost.");
  if (result.ok) revalidatePath(`/jobs/${input.jobId}/true-up`);
  return result;
}

export async function approveTrueUp(jobId: string): Promise<ActionResult> {
  const profile = await assertRole(["admin", "office"]);
  assertTrueUpCapability(profile.role, "approve");
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_job_true_up", { p_job_id: jobId });
  const result = fail(error, "Could not approve.");
  if (result.ok) {
    revalidatePath(`/jobs/${jobId}/true-up`);
    revalidatePath("/commissions");
  }
  return result;
}

export async function reopenTrueUp(jobId: string, reason: string): Promise<ActionResult> {
  const profile = await assertRole(["admin", "office"]);
  assertTrueUpCapability(profile.role, "approve");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_job_true_up", {
    p_job_id: jobId,
    p_reason: reason,
  });
  const result = fail(error, "Could not reopen the true-up.");
  if (result.ok) revalidatePath(`/jobs/${jobId}/true-up`);
  return result;
}

export async function recordLateAdjustment(jobId: string, note: string): Promise<ActionResult> {
  await staff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_late_true_up_adjustment", {
    p_job_id: jobId,
    p_source_note: note,
  });
  const result = fail(error, "Could not record the adjustment.");
  if (!result.ok) return result;
  revalidatePath(`/jobs/${jobId}/true-up`);
  const row = data as { adjustment_cents?: number; timing?: string } | null;
  return { ok: true, detail: row ? `${row.timing ?? "recorded"}:${row.adjustment_cents ?? 0}` : undefined };
}

export async function overrideCollection(jobId: string, reason: string): Promise<ActionResult> {
  const profile = await assertRole(["admin"]);
  assertTrueUpCapability(profile.role, "overrideCollection");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_true_up_collection_override", {
    p_job_id: jobId,
    p_reason: reason,
  });
  const result = fail(error, "Could not save the override.");
  if (result.ok) revalidatePath(`/jobs/${jobId}/true-up`);
  return result;
}

export async function overrideCommission(input: {
  jobId: string;
  field: "gp" | "rate" | "amount" | "zero_revenue";
  value: string;
  reason: string;
}): Promise<ActionResult> {
  const profile = await assertRole(["admin"]);
  assertTrueUpCapability(profile.role, "overrideCommission");
  const cents = input.field === "zero_revenue" ? BigInt(0) : moneyToCents(input.value);
  if (cents == null) return { ok: false, error: "Enter a number." };
  const value = input.field === "rate" ? cents : cents;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_true_up_commission_override", {
    p_job_id: input.jobId,
    p_field: input.field,
    p_value: Number(value),
    p_reason: input.reason,
  });
  const result = fail(error, "Could not save the override.");
  if (result.ok) revalidatePath(`/jobs/${input.jobId}/true-up`);
  return result;
}

export async function correctSalesperson(input: {
  jobId: string;
  salespersonId: string;
  reason: string;
}): Promise<ActionResult> {
  const profile = await assertRole(["admin", "office"]);
  assertTrueUpCapability(profile.role as UserRole, "correctSalesperson");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_true_up_salesperson", {
    p_job_id: input.jobId,
    p_salesperson_id: input.salespersonId,
    p_reason: input.reason,
  });
  const result = fail(error, "Could not change the salesperson.");
  if (result.ok) revalidatePath(`/jobs/${input.jobId}/true-up`);
  return result;
}

export async function markCommissionPaid(input: {
  salespersonId: string;
  ledgerIds: string[];
  paidOn: string;
  reference: string;
  periodStart: string;
  periodEnd: string;
  idempotencyKey: string;
}): Promise<ActionResult> {
  const profile = await assertRole(["admin", "office"]);
  assertTrueUpCapability(profile.role, "markPaid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_commission_lines_paid", {
    p_salesperson_id: input.salespersonId,
    p_ledger_ids: input.ledgerIds,
    p_paid_on: input.paidOn || null,
    p_reference: input.reference,
    p_period_start: input.periodStart || null,
    p_period_end: input.periodEnd || null,
    p_idempotency_key: input.idempotencyKey,
  });
  const result = fail(error, "Could not mark the commission paid.");
  if (result.ok) revalidatePath("/commissions");
  return result;
}
