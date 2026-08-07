"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";

const OFFICE = ["admin", "office", "sales_manager"] as const;

export interface IssueInput {
  code: string;
  blame: string;
  blameProfileId: string | null;
  blameSupplierId: string | null;
  costImpact: string | number | null;
  note: string;
}

export interface CloseoutInput {
  jobId: string;
  actualMaterial: string | number | null;
  actualLabor: string | number | null;
  actualOther: string | number | null;
  notes: string;
  issues: IssueInput[];
  /** Where to land afterwards — a customer-list row sends its own URL so you
   *  come back to the (filtered) list you left, not the job page. */
  redirectTo?: string | null;
}

const n = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const x = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(x) ? x : null;
};

/**
 * Close a job out: what it really cost, and what went wrong.
 *
 * Costing already compared estimated against actual, but the actual side was
 * derived only from installer bills and committed POs — so with no bills
 * written and every PO a draft, every job read "not yet costed" forever. This
 * writes the real numbers directly, and the derived figures become the
 * pre-fill rather than the only source.
 *
 * A null cost is NOT zero. "Nobody has said yet" and "it cost nothing" are
 * different facts, and only closed_out_at distinguishes them.
 */
export async function saveCloseout(input: CloseoutInput): Promise<{
  error: string | null;
}> {
  const profile = await assertRole([...OFFICE]);
  const supabase = await createClient();

  const material = n(input.actualMaterial);
  const labor = n(input.actualLabor);
  const other = n(input.actualOther);

  if (material === null && labor === null && other === null) {
    return { error: "Enter at least one actual cost before closing the job out." };
  }

  const { error } = await supabase
    .from("jobs")
    .update({
      actual_material_cost: material,
      actual_labor_cost: labor,
      actual_other_cost: other,
      closeout_notes: input.notes.trim() || null,
      closed_out_at: new Date().toISOString(),
      closed_out_by: profile.id,
    })
    .eq("id", input.jobId);

  if (error) {
    console.error("[saveCloseout]", error.code, error.message);
    return { error: "Couldn't save the close-out. Try again." };
  }

  // Replace the issue list wholesale — the screen shows every issue on the job,
  // so what was submitted IS the list.
  await supabase.from("job_issues").delete().eq("job_id", input.jobId);

  const rows = input.issues
    .filter((i) => i.code)
    .map((i) => ({
      job_id: input.jobId,
      code: i.code,
      blame: i.blame || "unknown",
      blame_profile_id: i.blameProfileId || null,
      blame_supplier_id: i.blameSupplierId || null,
      cost_impact: n(i.costImpact),
      note: i.note.trim() || null,
      created_by: profile.id,
    }));

  if (rows.length) {
    const { error: issueErr } = await supabase.from("job_issues").insert(rows);
    if (issueErr) {
      console.error("[saveCloseout issues]", issueErr.code, issueErr.message);
      return { error: "Costs saved, but the problems didn't. Try those again." };
    }
  }

  revalidatePath(`/jobs/${input.jobId}`);
  revalidatePath("/customers");
  revalidatePath("/reports");
  // Only ever an in-app path — never trust a caller-supplied absolute URL.
  const back = input.redirectTo;
  redirect(
    back && back.startsWith("/") && !back.startsWith("//")
      ? back
      : `/jobs/${input.jobId}`,
  );
}

/** What the records imply the job cost — the pre-fill, never the last word. */
export async function suggestedActuals(jobId: string): Promise<{
  material: number | null;
  labor: number | null;
  materialSource: string;
  laborSource: string;
}> {
  const supabase = await createClient();

  // Material: what was actually committed on issued POs for this job.
  const { data: pos } = await supabase
    .from("purchase_orders")
    .select("id, status, items:po_items(quantity, unit_cost, received_qty)")
    .eq("job_id", jobId)
    .in("status", ["ordered", "received", "closed"]);

  let material: number | null = null;
  let materialSource = "no issued POs on this job yet";
  if (pos?.length) {
    material = 0;
    for (const po of pos) {
      for (const it of (po.items ?? []) as {
        quantity: number | null;
        unit_cost: number | null;
        received_qty: number | null;
      }[]) {
        // What actually arrived, where the warehouse has checked it in.
        const qty = it.received_qty ?? it.quantity ?? 0;
        material += Number(qty) * Number(it.unit_cost ?? 0);
      }
    }
    material = Math.round(material * 100) / 100;
    materialSource = `${pos.length} issued ${pos.length === 1 ? "PO" : "POs"}`;
  }

  // Labor: the installer bill, if one was written.
  const { data: bills } = await supabase
    .from("installer_bills")
    .select("total")
    .eq("job_id", jobId);

  let labor: number | null = null;
  let laborSource = "no installer bill written";
  if (bills?.length) {
    labor = Math.round(
      bills.reduce((s, b) => s + Number(b.total ?? 0), 0) * 100,
    ) / 100;
    laborSource = `${bills.length} installer ${bills.length === 1 ? "bill" : "bills"}`;
  }

  return { material, labor, materialSource, laborSource };
}
