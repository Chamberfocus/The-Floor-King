"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";
import { STEP_OVERRIDE_ROLES } from "@/lib/job-checklist";
import type { UserRole } from "@/lib/types";

/**
 * Overriding a checklist step.
 *
 * The list is record-backed on purpose — a step is done because the estimate,
 * the payment or the work order exists. Real jobs still go off-script: a
 * deposit is waived, a quote is approved on the phone, the material was already
 * on the shelf so no PO was ever raised. Without a way to say so those steps
 * sit open forever and the list stops telling the truth.
 *
 * An override never touches the underlying record. It is its own row, with who
 * and why, and the checklist labels it as an override rather than pretending a
 * payment turned up. Undo removes the row and the step goes back to whatever
 * the records actually say.
 */

/** Who may overrule the records — the same list the button reads, so the two
 *  can't drift. The crew and the portal only ever read the checklist. */
const OVERRIDE_ROLES = STEP_OVERRIDE_ROLES as UserRole[];

const str = (v: FormDataEntryValue | null): string =>
  typeof v === "string" ? v.trim() : "";

function refresh(customerId: string, jobId: string | null): void {
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  revalidatePath("/client-status");
  if (jobId) {
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");
  }
}

export async function overrideStep(formData: FormData): Promise<void> {
  const customerId = str(formData.get("customer_id"));
  const stepKey = str(formData.get("step_key"));
  const jobId = str(formData.get("job_id")) || null;
  const reason = str(formData.get("reason")) || null;
  if (!customerId || !stepKey) return;

  const profile = await assertRole(OVERRIDE_ROLES);
  const supabase = await createClient();

  // Upsert by hand: the unique index is partial (job_id null vs not), which
  // on_conflict can't name, so re-overriding a step replaces the old reason.
  const existing = supabase
    .from("step_overrides")
    .select("id")
    .eq("customer_id", customerId)
    .eq("step_key", stepKey);
  const { data: prior } = await (jobId
    ? existing.eq("job_id", jobId)
    : existing.is("job_id", null)
  ).maybeSingle();

  const { error } = prior?.id
    ? await supabase
        .from("step_overrides")
        .update({ reason, created_by: profile.id })
        .eq("id", prior.id)
    : await supabase.from("step_overrides").insert({
        customer_id: customerId,
        job_id: jobId,
        step_key: stepKey,
        reason,
        created_by: profile.id,
      });
  // Loud on purpose. A silent failure here would toast "step marked done" and
  // leave the step exactly where it was — the one outcome worse than no button.
  if (error) throw new Error(`Couldn't mark the step done: ${error.message}`);

  // Logged where the rest of the account's history lives, so an override is
  // never something you have to go looking for.
  await supabase.from("activities").insert({
    customer_id: customerId,
    user_id: profile.id,
    type: "system",
    body: `⚠ Step marked done by ${profile.full_name ?? "staff"} without the record${
      reason ? ` — ${reason}` : ""
    }.`,
  });

  refresh(customerId, jobId);
}

export async function clearStepOverride(formData: FormData): Promise<void> {
  const customerId = str(formData.get("customer_id"));
  const stepKey = str(formData.get("step_key"));
  const jobId = str(formData.get("job_id")) || null;
  if (!customerId || !stepKey) return;

  const profile = await assertRole(OVERRIDE_ROLES);
  const supabase = await createClient();

  const del = supabase
    .from("step_overrides")
    .delete()
    .eq("customer_id", customerId)
    .eq("step_key", stepKey);
  const { error } = await (jobId
    ? del.eq("job_id", jobId)
    : del.is("job_id", null));
  if (error) throw new Error(`Couldn't remove the override: ${error.message}`);

  await supabase.from("activities").insert({
    customer_id: customerId,
    user_id: profile.id,
    type: "system",
    body: `Override removed by ${profile.full_name ?? "staff"} — the step reads from the records again.`,
  });

  refresh(customerId, jobId);
}
