"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { JobStatus } from "@/lib/types";

export interface JobFormState {
  error: string | null;
  ok?: boolean;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function nullable(v: FormDataEntryValue | null): string | null {
  return str(v) || null;
}

/** Create a job from an estimate (uses the accepted option, or the first one). */
export async function createJobFromEstimate(formData: FormData): Promise<void> {
  const estimateId = str(formData.get("estimate_id"));
  if (!estimateId) return;

  const supabase = await createClient();
  const { data: est } = await supabase
    .from("estimates")
    .select("id, customer_id, title, accepted_option_id")
    .eq("id", estimateId)
    .maybeSingle();
  if (!est) return;

  let optionId = (est.accepted_option_id as string | null) ?? null;
  if (!optionId) {
    const { data: opt } = await supabase
      .from("estimate_options")
      .select("id")
      .eq("estimate_id", estimateId)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    optionId = (opt?.id as string) ?? null;
  }

  const { data: cust } = await supabase
    .from("customers")
    .select("street, city, state, zip")
    .eq("id", est.customer_id as string)
    .maybeSingle();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      customer_id: est.customer_id,
      estimate_id: estimateId,
      option_id: optionId,
      title: (est.title as string) || "Job",
      created_by: user?.id ?? null,
      site_street: cust?.street ?? null,
      site_city: cust?.city ?? null,
      site_state: cust?.state ?? null,
      site_zip: cust?.zip ?? null,
    })
    .select("id")
    .single();
  if (error || !job) return;

  revalidatePath("/jobs");
  revalidatePath(`/customers/${est.customer_id}`);
  redirect(`/jobs/${job.id}`);
}

/** Create a blank job tied to a customer. */
export async function createJob(formData: FormData): Promise<void> {
  const customerId = str(formData.get("customer_id"));
  if (!customerId) return;

  const supabase = await createClient();
  const { data: cust } = await supabase
    .from("customers")
    .select("street, city, state, zip")
    .eq("id", customerId)
    .maybeSingle();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      customer_id: customerId,
      title: "Job",
      created_by: user?.id ?? null,
      site_street: cust?.street ?? null,
      site_city: cust?.city ?? null,
      site_state: cust?.state ?? null,
      site_zip: cust?.zip ?? null,
    })
    .select("id")
    .single();
  if (error || !job) return;

  revalidatePath("/jobs");
  revalidatePath(`/customers/${customerId}`);
  redirect(`/jobs/${job.id}`);
}

export async function updateJob(
  _prev: JobFormState,
  formData: FormData,
): Promise<JobFormState> {
  const id = str(formData.get("id"));
  if (!id) return { error: "Missing job id." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("jobs")
    .update({
      title: nullable(formData.get("title")),
      status: (str(formData.get("status")) || "unscheduled") as JobStatus,
      scheduled_date: nullable(formData.get("scheduled_date")),
      scheduled_end: nullable(formData.get("scheduled_end")),
      assigned_to: nullable(formData.get("assigned_to")),
      site_street: nullable(formData.get("site_street")),
      site_city: nullable(formData.get("site_city")),
      site_state: nullable(formData.get("site_state")),
      site_zip: nullable(formData.get("site_zip")),
      notes: nullable(formData.get("notes")),
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  return { error: null, ok: true };
}

/** Quick status change (also usable by assigned crew from the field). */
export async function setJobStatus(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const status = str(formData.get("status")) as JobStatus;
  if (!id || !status) return;

  const supabase = await createClient();
  await supabase.from("jobs").update({ status }).eq("id", id);

  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
}

export async function deleteJob(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const customerId = str(formData.get("customer_id"));
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("jobs").delete().eq("id", id);

  revalidatePath("/jobs");
  if (customerId) revalidatePath(`/customers/${customerId}`);
  redirect("/jobs");
}
