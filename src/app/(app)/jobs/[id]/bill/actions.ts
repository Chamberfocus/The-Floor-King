"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBillJobContext, getInstallerBill } from "@/lib/data/installer-bills";
import { laborBillLinesFromScope, round2 } from "@/lib/installer-bill";
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

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** A line needs a reason if it was edited (is_modified) or hand-added. */
function needsReason(l: { source: BillLineSource; is_modified: boolean }): boolean {
  return l.is_modified || l.source === "manually_added";
}

function persistRows(billId: string, lines: BillLineInput[]) {
  return lines.map((l, i) => ({
    bill_id: billId,
    description: (l.description ?? "").trim(),
    quantity: l.quantity == null ? null : round2(l.quantity),
    unit: (l.unit ?? "").trim() || null,
    rate: l.rate == null ? null : round2(l.rate),
    line_total: round2(num(l.quantity) * num(l.rate)),
    source: l.source,
    is_modified: !!l.is_modified,
    change_reason: (l.change_reason ?? "").trim() || null,
    position: i,
  }));
}

function totalsFor(rows: { line_total: number }[], adjustments: number) {
  const subtotal = round2(rows.reduce((s, r) => s + (Number(r.line_total) || 0), 0));
  const total = round2(subtotal + round2(adjustments));
  return { subtotal, adjustments: round2(adjustments), total };
}

/**
 * Create the installer bill for a job and generate its lines directly from the
 * job's WORK ORDER LABOR SCOPE (category === 'labor' lines, at our labor cost).
 * Idempotent: if a bill already exists, this just returns to it. Never invents
 * rows — an empty labor scope yields a bill with no lines (the screen shows the
 * empty state).
 */
export async function createBillFromWorkOrder(formData: FormData): Promise<void> {
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

  const subtotal = round2(generated.reduce((s, l) => s + l.line_total, 0));
  const { data: bill } = await supabase
    .from("installer_bills")
    .insert({
      job_id: jobId,
      installer_id: ctx.installerId,
      status: "draft",
      subtotal,
      adjustments: 0,
      total: subtotal,
    })
    .select("id")
    .single();
  if (!bill) return;

  if (generated.length) {
    await supabase.from("installer_bill_line_items").insert(
      generated.map((l, i) => ({
        bill_id: bill.id,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        rate: l.rate,
        line_total: l.line_total,
        source: "from_work_order",
        is_modified: false,
        change_reason: null,
        position: i,
      })),
    );
  }

  revalidatePath(`/jobs/${jobId}/bill`);
  redirect(`/jobs/${jobId}/bill`);
}

/** Save the bill as a draft — replaces its lines and recomputes totals. */
export async function saveInstallerBillDraft(input: {
  billId: string;
  jobId: string;
  adjustments: number;
  notes: string | null;
  lines: BillLineInput[];
}): Promise<BillActionState> {
  const supabase = await createClient();
  const { data: bill } = await supabase
    .from("installer_bills")
    .select("id, status")
    .eq("id", input.billId)
    .maybeSingle();
  if (!bill) return { error: "Bill not found." };
  if (bill.status !== "draft") return { error: "This bill is locked and can't be edited." };

  const rows = persistRows(input.billId, input.lines);
  const { subtotal, adjustments, total } = totalsFor(rows, input.adjustments);

  await supabase.from("installer_bill_line_items").delete().eq("bill_id", input.billId);
  if (rows.length) {
    const { error } = await supabase.from("installer_bill_line_items").insert(rows);
    if (error) return { error: error.message };
  }
  await supabase
    .from("installer_bills")
    .update({ subtotal, adjustments, total, notes: (input.notes ?? "").trim() || null })
    .eq("id", input.billId);

  revalidatePath(`/jobs/${input.jobId}/bill`);
  return { error: null, ok: true };
}

/**
 * Approve the bill for payment. Rejects if any modified or hand-added line is
 * missing a change_reason. On success: locks the lines, writes the bill total to
 * the job's actual_labor_cost, and computes labor_variance (actual − estimated).
 * NEVER writes estimated_labor_cost.
 */
export async function approveInstallerBill(input: {
  billId: string;
  jobId: string;
  adjustments: number;
  notes: string | null;
  lines: BillLineInput[];
}): Promise<BillActionState> {
  const supabase = await createClient();
  const { data: bill } = await supabase
    .from("installer_bills")
    .select("id, status")
    .eq("id", input.billId)
    .maybeSingle();
  if (!bill) return { error: "Bill not found." };
  if (bill.status !== "draft") return { error: "This bill is already approved." };

  // Validation: every edited or hand-added line must carry a reason.
  const missing = input.lines.find(
    (l) => needsReason(l) && !(l.change_reason ?? "").trim(),
  );
  if (missing) {
    return {
      error: "Add a change reason to every modified or added line before approving.",
    };
  }

  const rows = persistRows(input.billId, input.lines);
  const { subtotal, adjustments, total } = totalsFor(rows, input.adjustments);

  await supabase.from("installer_bill_line_items").delete().eq("bill_id", input.billId);
  if (rows.length) {
    const { error } = await supabase.from("installer_bill_line_items").insert(rows);
    if (error) return { error: error.message };
  }

  await supabase
    .from("installer_bills")
    .update({
      subtotal,
      adjustments,
      total,
      notes: (input.notes ?? "").trim() || null,
      status: "approved",
      approved_at: new Date().toISOString(),
    })
    .eq("id", input.billId);

  // Write the actual to the job and compute the variance. estimated_labor_cost
  // is read here, never written.
  const { data: job } = await supabase
    .from("jobs")
    .select("estimated_labor_cost")
    .eq("id", input.jobId)
    .maybeSingle();
  const estimated =
    job?.estimated_labor_cost != null ? Number(job.estimated_labor_cost) : 0;
  await supabase
    .from("jobs")
    .update({
      actual_labor_cost: total,
      labor_variance: round2(total - estimated),
    })
    .eq("id", input.jobId);

  revalidatePath(`/jobs/${input.jobId}/bill`);
  revalidatePath(`/jobs/${input.jobId}`);
  return { error: null, ok: true };
}

/** Mark an approved bill paid. */
export async function markInstallerBillPaid(formData: FormData): Promise<void> {
  const billId = String(formData.get("bill_id") ?? "").trim();
  const jobId = String(formData.get("job_id") ?? "").trim();
  if (!billId || !jobId) return;
  const supabase = await createClient();
  const { data: bill } = await supabase
    .from("installer_bills")
    .select("status")
    .eq("id", billId)
    .maybeSingle();
  if (bill?.status !== "approved") return;
  await supabase
    .from("installer_bills")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", billId);
  revalidatePath(`/jobs/${jobId}/bill`);
}
