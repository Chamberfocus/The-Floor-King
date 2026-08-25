"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { deriveLeadStage } from "@/lib/workflow-engine";

/**
 * Move ONE job's stage by hand.
 *
 * The manual stage picker has always written to `customers`, which was the only
 * place a stage lived. Now that a job carries its own, an account with three
 * jobs running needs three controls, not one — otherwise the columns exist but
 * every job on the account is still forced to share a position, which is the
 * problem this was all meant to solve.
 *
 * The handoff and the activity are logged against the ACCOUNT, because that's
 * where the customer's history is read, but the note names the job so a
 * three-job account's history stays readable.
 */
export async function setJobStage(formData: FormData): Promise<void> {
  const jobId = str(formData.get("job_id"));
  const toStageId = str(formData.get("to_stage"));
  const note = str(formData.get("note"));
  if (!jobId || !toStageId) return;

  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("id, title, customer_id, workflow_stage_id, workflow_owner_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return;

  const [{ data: stage }, { data: allStages }] = await Promise.all([
    supabase
      .from("workflow_stages")
      .select("id, name, position, sla_hours, default_owner")
      .eq("id", toStageId)
      .maybeSingle(),
    supabase.from("workflow_stages").select("position, auto_action, name"),
  ]);
  if (!stage) return;

  const owner =
    (job.workflow_owner_id as string | null) ??
    (stage.default_owner as string | null) ??
    null;
  const due =
    stage.sla_hours && (stage.sla_hours as number) > 0
      ? new Date(Date.now() + (stage.sla_hours as number) * 3600 * 1000).toISOString()
      : null;

  const { error } = await supabase
    .from("jobs")
    .update({
      workflow_stage_id: toStageId,
      workflow_owner_id: owner,
      next_action_due: due,
    })
    .eq("id", jobId);
  if (error) throw new Error(`Couldn't move the job: ${error.message}`);

  const customerId = job.customer_id as string | null;
  if (customerId) {
    /**
     * The coarse `lead_stage` on the customer is a roll-up of the account, and
     * it drives the customer list and the win/loss reports. Refresh it from the
     * job that just moved — the account is at least as far along as its
     * furthest-moved work.
     */
    const leadStage = deriveLeadStage(
      { name: stage.name as string, position: stage.position as number },
      (allStages ?? []) as { position: number; auto_action: string | null; name: string | null }[],
    );
    if (leadStage) {
      await supabase.from("customers").update({ stage: leadStage }).eq("id", customerId);
    }

    const label = (job.title as string) || "this job";
    await supabase.from("handoffs").insert({
      customer_id: customerId,
      from_stage_id: (job.workflow_stage_id as string | null) ?? null,
      to_stage_id: toStageId,
      from_user: (job.workflow_owner_id as string | null) ?? null,
      to_user: owner,
      note: `${label} → ${stage.name}${note ? ` · ${note}` : ""}`,
    });
    await supabase.from("activities").insert({
      customer_id: customerId,
      user_id: profile.id,
      type: "stage_change",
      body: `${label} moved to "${stage.name}"${note ? ` — ${note}` : ""}`,
    });
    revalidatePath(`/customers/${customerId}`);
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/client-status");
  revalidatePath("/board");
  revalidatePath("/dashboard");
}

const str = (v: FormDataEntryValue | null): string =>
  typeof v === "string" ? v.trim() : "";
