"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";
import { getBillJobContext, getInstallerBill } from "@/lib/data/installer-bills";
import { laborBillLinesFromScope } from "@/lib/installer-bill";
import {
  laborLineTotalFromQtyRate,
  parseLaborMoney,
} from "@/lib/accounting/installer-labor-source";
import type { BillLineSource } from "@/lib/types";

export interface BillLineInput {
  description: string;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  source: BillLineSource;
  is_modified: boolean;
  change_reason: string | null;
}

export interface BillActionState {
  error: string | null;
  ok?: boolean;
}

function needsReason(l: { source: BillLineSource; is_modified: boolean }): boolean {
  return l.is_modified || l.source === "manually_added";
}

function linesToJson(lines: BillLineInput[]) {
  return lines.map((l) => {
    const computed = laborLineTotalFromQtyRate(l.quantity, l.rate);
    if (!computed.ok) {
      throw new Error(computed.error);
    }
    return {
      description: (l.description ?? "").trim(),
      quantity: l.quantity,
      unit: (l.unit ?? "").trim() || null,
      rate: l.rate,
      line_total: computed.amount,
      source: l.source,
      is_modified: !!l.is_modified,
      change_reason: (l.change_reason ?? "").trim() || null,
    };
  });
}

function rpcError(data: unknown, error: { message?: string } | null): string {
  if (error?.message) return error.message;
  if (data && typeof data === "object" && data !== null && "error" in data) {
    const e = (data as { error?: unknown }).error;
    if (typeof e === "string" && e.trim()) return e;
  }
  return "Installer labor action failed.";
}

function rpcOk(data: unknown): boolean {
  return !!(
    data &&
    typeof data === "object" &&
    (data as { ok?: boolean }).ok === true
  );
}

/**
 * Create the installer bill for a job from work-order labor scope.
 * Uses create_installer_labor_bill_safe (draft only — not actual cost).
 */
export async function createBillFromWorkOrder(formData: FormData): Promise<void> {
  await assertRole(["admin", "office"]);
  const jobId = String(formData.get("job_id") ?? "").trim();
  if (!jobId) return;

  const existing = await getInstallerBill(jobId);
  if (existing) {
    redirect(`/jobs/${jobId}/bill`);
  }

  const ctx = await getBillJobContext(jobId);
  if (!ctx) return;

  const generated = laborBillLinesFromScope(ctx.laborScope);
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { data, error } = await supabase.rpc("create_installer_labor_bill_safe", {
    p_job_id: jobId,
    p_installer_id: ctx.installerId,
    p_crew_id: null,
    p_service_date: null,
    p_notes: null,
    p_lines: generated.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      rate: l.rate,
      source: "from_work_order",
      is_modified: false,
      change_reason: null,
    })),
    p_adjustments: 0,
    p_created_by: user.user?.id ?? null,
    p_idempotency_key: `create-wo-bill:${jobId}`,
  });

  if (!rpcOk(data)) {
    // Fall through: still redirect if a concurrent create won.
    const again = await getInstallerBill(jobId);
    if (!again) {
      console.error("create_installer_labor_bill_safe", error, data);
      return;
    }
  }

  revalidatePath(`/jobs/${jobId}/bill`);
  redirect(`/jobs/${jobId}/bill`);
}

export async function saveInstallerBillDraft(input: {
  billId: string;
  jobId: string;
  adjustments: number;
  notes: string | null;
  lines: BillLineInput[];
}): Promise<BillActionState> {
  await assertRole(["admin", "office"]);
  const adj = parseLaborMoney(input.adjustments, { allowNegative: true });
  if (!adj.ok) return { error: adj.error };

  let payload: ReturnType<typeof linesToJson>;
  try {
    payload = linesToJson(input.lines);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid line amounts." };
  }

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const { data, error } = await supabase.rpc("save_installer_labor_draft_safe", {
    p_bill_id: input.billId,
    p_lines: payload,
    p_adjustments: adj.amount,
    p_notes: (input.notes ?? "").trim() || null,
    p_service_date: null,
    p_created_by: user.user?.id ?? null,
    p_idempotency_key: null,
  });
  if (!rpcOk(data)) return { error: rpcError(data, error) };
  revalidatePath(`/jobs/${input.jobId}/bill`);
  return { error: null, ok: true };
}

/**
 * Approve completed labor — creates immutable actual cost (+ AP for subcontractors).
 */
export async function approveInstallerBill(input: {
  billId: string;
  jobId: string;
  adjustments: number;
  notes: string | null;
  lines: BillLineInput[];
}): Promise<BillActionState> {
  await assertRole(["admin", "office"]);

  const missing = input.lines.find(
    (l) => needsReason(l) && !(l.change_reason ?? "").trim(),
  );
  if (missing) {
    return {
      error: "Add a change reason to every modified or added line before approving.",
    };
  }

  const saved = await saveInstallerBillDraft(input);
  if (saved.error) return saved;

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const { data, error } = await supabase.rpc("approve_installer_labor_safe", {
    p_bill_id: input.billId,
    p_confirm: true,
    p_service_date: null,
    p_created_by: user.user?.id ?? null,
    p_idempotency_key: `approve:${input.billId}`,
  });
  if (!rpcOk(data)) return { error: rpcError(data, error) };

  revalidatePath(`/jobs/${input.jobId}/bill`);
  revalidatePath(`/jobs/${input.jobId}`);
  return { error: null, ok: true };
}

export async function markInstallerBillPaid(formData: FormData): Promise<void> {
  await assertRole(["admin", "office"]);
  const billId = String(formData.get("bill_id") ?? "").trim();
  const jobId = String(formData.get("job_id") ?? "").trim();
  if (!billId || !jobId) return;
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const { data, error } = await supabase.rpc("mark_installer_labor_paid_safe", {
    p_bill_id: billId,
    p_paid_on: null,
    p_created_by: user.user?.id ?? null,
    p_idempotency_key: `payroll-ops:${billId}`,
  });
  if (!rpcOk(data)) {
    console.error("mark_installer_labor_paid_safe", error, data);
    return;
  }
  revalidatePath(`/jobs/${jobId}/bill`);
  revalidatePath(`/jobs/${jobId}`);
}

export async function reverseInstallerBill(formData: FormData): Promise<BillActionState> {
  await assertRole(["admin", "office"]);
  const billId = String(formData.get("bill_id") ?? "").trim();
  const jobId = String(formData.get("job_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!billId || !jobId) return { error: "Missing bill." };
  if (!reason) return { error: "Reversal reason is required." };
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const { data, error } = await supabase.rpc("reverse_installer_labor_safe", {
    p_bill_id: billId,
    p_reason: reason,
    p_created_by: user.user?.id ?? null,
    p_idempotency_key: `reverse:${billId}:${reason.slice(0, 40)}`,
  });
  if (!rpcOk(data)) return { error: rpcError(data, error) };
  revalidatePath(`/jobs/${jobId}/bill`);
  revalidatePath(`/jobs/${jobId}`);
  return { error: null, ok: true };
}

export async function reverseInstallerBillForm(formData: FormData): Promise<void> {
  await reverseInstallerBill(formData);
}
