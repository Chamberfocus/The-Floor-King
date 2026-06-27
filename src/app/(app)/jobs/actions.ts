"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailLayout, siteUrl, ownerEmail } from "@/lib/notify";
import {
  moveToAutoActionStage,
  advanceFromAutoAction,
} from "@/lib/workflow-engine";
import { prepareJobMaterialsFor } from "./material-actions";
import type {
  JobDeliveryType,
  JobStatus,
  WarehouseStatus,
} from "@/lib/types";

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

/** Book a smart-scheduled install: assign installer + date range. */
export async function bookInstall(formData: FormData): Promise<void> {
  const id = str(formData.get("job_id"));
  const installer = str(formData.get("installer_id"));
  const start = str(formData.get("start"));
  const end = str(formData.get("end")) || start;
  if (!id || !start) return;
  const supabase = await createClient();
  await supabase
    .from("jobs")
    .update({
      assigned_to: installer || null,
      scheduled_date: start,
      scheduled_end: end,
      status: "scheduled",
      open_for_claim: false,
    })
    .eq("id", id);

  // Install booked → advance out of the "schedule install" stage.
  const { data: job } = await supabase
    .from("jobs")
    .select("customer_id")
    .eq("id", id)
    .maybeSingle();
  if (job?.customer_id)
    await advanceFromAutoAction(job.customer_id as string, "schedule_install");

  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
}

/** Create a job from an estimate (uses the accepted option, or the first one). */
/**
 * Create the job for an approved estimate — idempotent and reusable. Runs with
 * the service-role client so it works from ANY trigger: a staff "Create job"
 * click OR a customer approving in the portal (whose RLS session can't insert
 * jobs). Returns the job id (existing or new), or null on failure. Never throws
 * into the caller, so an approval is never blocked by a job-creation hiccup.
 */
export async function ensureJobForEstimate(
  estimateId: string,
  createdBy: string | null = null,
): Promise<string | null> {
  if (!estimateId) return null;
  try {
    const admin = createAdminClient();
    const { data: est } = await admin
      .from("estimates")
      .select("id, customer_id, title, accepted_option_id, job_description")
      .eq("id", estimateId)
      .maybeSingle();
    if (!est) return null;

    // Idempotent: one job per estimate (covers double-clicks AND a staff click
    // racing the portal approval).
    const { data: existing } = await admin
      .from("jobs")
      .select("id")
      .eq("estimate_id", estimateId)
      .limit(1)
      .maybeSingle();
    if (existing) return existing.id as string;

    let optionId = (est.accepted_option_id as string | null) ?? null;
    if (!optionId) {
      const { data: opt } = await admin
        .from("estimate_options")
        .select("id")
        .eq("estimate_id", estimateId)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();
      optionId = (opt?.id as string) ?? null;
    }

    const { data: cust } = await admin
      .from("customers")
      .select("street, city, state, zip")
      .eq("id", est.customer_id as string)
      .maybeSingle();

    const { data: job, error } = await admin
      .from("jobs")
      .insert({
        customer_id: est.customer_id,
        estimate_id: estimateId,
        option_id: optionId,
        title: (est.title as string) || "Job",
        notes: (est.job_description as string | null) || null,
        created_by: createdBy,
        site_street: cust?.street ?? null,
        site_city: cust?.city ?? null,
        site_state: cust?.state ?? null,
        site_zip: cust?.zip ?? null,
      })
      .select("id")
      .single();
    if (error || !job) return null;

    // Reserve stock + build POs for special-order items right after the win.
    // Elevated, since the trigger may be a customer's portal session.
    after(() => prepareJobMaterialsFor(job.id as string, { admin: true }));

    revalidatePath("/jobs");
    if (est.customer_id) revalidatePath(`/customers/${est.customer_id}`);
    return job.id as string;
  } catch {
    return null;
  }
}

export async function createJobFromEstimate(formData: FormData): Promise<void> {
  const estimateId = str(formData.get("estimate_id"));
  if (!estimateId) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const jobId = await ensureJobForEstimate(estimateId, user?.id ?? null);
  if (jobId) redirect(`/jobs/${jobId}`);
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
      delivery_type: (str(formData.get("delivery_type")) ||
        "deliver") as JobDeliveryType,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  return { error: null, ok: true };
}

/** Assign (or clear) the install crew on a job — from your managed crew list. */
export async function setJobCrew(formData: FormData): Promise<void> {
  const id = str(formData.get("job_id"));
  if (!id) return;
  const crewId = str(formData.get("crew_id")) || null;
  const supabase = await createClient();
  await supabase.from("jobs").update({ assigned_crew_id: crewId }).eq("id", id);
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
}

/** Quick status change (also usable by assigned crew from the field). */
export async function setJobStatus(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const status = str(formData.get("status")) as JobStatus;
  if (!id || !status) return;

  const supabase = await createClient();
  await supabase.from("jobs").update({ status }).eq("id", id);

  // Finishing the install advances the customer past the install stage, the
  // same way every earlier event auto-advances the lifecycle.
  if (status === "completed") {
    const { data: job } = await supabase
      .from("jobs")
      .select("customer_id")
      .eq("id", id)
      .maybeSingle();
    if (job?.customer_id) {
      await advanceFromAutoAction(job.customer_id as string, "schedule_install");
    }
  }

  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  revalidatePath("/pipeline");
}

/** Email the customer their scheduled install date. */
export async function emailJobSchedule(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("title, scheduled_date, customer:customers(full_name, email)")
    .eq("id", id)
    .maybeSingle();
  const cust = job?.customer as unknown as {
    full_name: string | null;
    email: string | null;
  } | null;
  if (cust?.email) {
    const dateStr = job?.scheduled_date
      ? new Date(job.scheduled_date as string).toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : "soon";
    await sendEmail({
      to: cust.email,
      subject: "Your installation is scheduled",
      html: emailLayout(
        "Your installation is scheduled",
        `<p>Hi ${cust.full_name?.split(" ")[0] ?? "there"},</p>
         <p>Your flooring installation${job?.title ? ` (${job.title})` : ""} is scheduled for <strong>${dateStr}</strong>. We'll see you then!</p>`,
        { label: "View your project", url: `${siteUrl()}/portal` },
      ),
    });
  }
  revalidatePath(`/jobs/${id}`);
}

// --- Job board (installers claim open jobs) ---------------------------------

export async function postJobToBoard(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("jobs").update({ open_for_claim: true }).eq("id", id);
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/board");
}

export async function unpostJobFromBoard(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("jobs").update({ open_for_claim: false }).eq("id", id);
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/board");
}

/** An installer signals they can do an open job. */
export async function applyToJob(formData: FormData): Promise<void> {
  const jobId = str(formData.get("job_id"));
  if (!jobId) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("job_applications")
    .upsert(
      { job_id: jobId, installer_id: user.id, status: "applied" },
      { onConflict: "job_id,installer_id" },
    );
  revalidatePath("/board");
  revalidatePath(`/jobs/${jobId}`);
}

export async function withdrawApplication(formData: FormData): Promise<void> {
  const jobId = str(formData.get("job_id"));
  if (!jobId) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("job_applications")
    .delete()
    .eq("job_id", jobId)
    .eq("installer_id", user.id);
  revalidatePath("/board");
  revalidatePath(`/jobs/${jobId}`);
}

/** Scheduler assigns an applicant — the job becomes theirs and leaves the board. */
export async function assignInstaller(formData: FormData): Promise<void> {
  const jobId = str(formData.get("job_id"));
  const installerId = str(formData.get("installer_id"));
  if (!jobId || !installerId) return;
  const supabase = await createClient();
  await supabase
    .from("jobs")
    .update({
      assigned_to: installerId,
      open_for_claim: false,
      status: "scheduled",
    })
    .eq("id", jobId);
  await supabase
    .from("job_applications")
    .update({ status: "accepted" })
    .eq("job_id", jobId)
    .eq("installer_id", installerId);
  await supabase
    .from("job_applications")
    .update({ status: "declined" })
    .eq("job_id", jobId)
    .neq("installer_id", installerId);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/board");
  revalidatePath("/jobs");
}

// --- Warehouse --------------------------------------------------------------

export async function setWarehouseStatus(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const status = str(formData.get("warehouse_status")) as WarehouseStatus;
  if (!id || !status) return;
  const supabase = await createClient();
  await supabase.from("jobs").update({ warehouse_status: status }).eq("id", id);

  // Intelligent flow: materials received/staged → jump to the install-scheduling stage.
  if (status === "staged") {
    const { data: job } = await supabase
      .from("jobs")
      .select("customer_id")
      .eq("id", id)
      .maybeSingle();
    if (job?.customer_id)
      await moveToAutoActionStage(
        job.customer_id as string,
        "schedule_install",
      );
  }

  revalidatePath("/warehouse");
  revalidatePath(`/jobs/${id}`);
}

/** Warehouse flags a problem (missing/short/wrong) → alert everyone on the job. */
export async function reportMaterialIssue(formData: FormData): Promise<void> {
  const jobId = str(formData.get("id"));
  const note = str(formData.get("note"));
  if (!jobId || !note) return;
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select(
      "title, assigned_to, customer_id, customer:customers(full_name, assigned_to, workflow_owner_id)",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return;

  const cust = job.customer as unknown as {
    full_name: string | null;
    assigned_to: string | null;
    workflow_owner_id: string | null;
  } | null;

  const ids = [
    job.assigned_to as string | null,
    cust?.assigned_to ?? null,
    cust?.workflow_owner_id ?? null,
  ].filter(Boolean) as string[];

  const recipients = new Set<string>([ownerEmail()]);
  if (ids.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("email")
      .in("id", [...new Set(ids)]);
    for (const p of profs ?? []) if (p.email) recipients.add(p.email as string);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  for (const to of recipients) {
    await sendEmail({
      to,
      subject: `⚠️ Material problem — ${(job.title as string) || cust?.full_name || "job"}`,
      html: emailLayout(
        "Material problem reported",
        `<p>The warehouse flagged an issue on${job.title ? ` "${job.title}"` : ""}${cust?.full_name ? ` for ${cust.full_name}` : ""}:</p><p><strong>${note}</strong></p>`,
        { label: "Open job", url: `${siteUrl()}/jobs/${jobId}` },
      ),
    });
  }

  // Log it on the job for the record.
  if (job.customer_id) {
    await supabase.from("activities").insert({
      customer_id: job.customer_id,
      user_id: user?.id ?? null,
      type: "system",
      body: `Warehouse reported a material problem: ${note}`,
    });
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/warehouse");
}

export async function setDeliveryType(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const deliveryType = str(formData.get("delivery_type")) as JobDeliveryType;
  if (!id || !deliveryType) return;
  const supabase = await createClient();
  await supabase
    .from("jobs")
    .update({ delivery_type: deliveryType })
    .eq("id", id);
  revalidatePath("/warehouse");
  revalidatePath(`/jobs/${id}`);
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

// --- Subcontractor / crew payouts (the real labor cost per job) -------------

function toNum(v: FormDataEntryValue | null): number | null {
  const s = str(v).replace(/[^0-9.]/g, "");
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Record what we paid a crew/sub on a job. Amount is computed when per-unit. */
export async function addJobLabor(formData: FormData): Promise<void> {
  const jobId = str(formData.get("job_id"));
  if (!jobId) return;
  const basis = (str(formData.get("basis")) || "flat") as
    | "flat"
    | "per_sqft"
    | "per_sqyd";
  const rate = toNum(formData.get("rate"));
  const area = toNum(formData.get("area"));
  const flat = toNum(formData.get("amount"));
  const amount =
    basis === "flat"
      ? (flat ?? 0)
      : Math.round((rate ?? 0) * (area ?? 0) * 100) / 100;
  if (amount <= 0) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("job_labor").insert({
    job_id: jobId,
    payee: nullable(formData.get("payee")),
    basis,
    rate: basis === "flat" ? null : rate,
    area: basis === "flat" ? null : area,
    amount,
    paid: str(formData.get("paid")) === "on",
    paid_on: str(formData.get("paid")) === "on" ? nullable(formData.get("paid_on")) : null,
    note: nullable(formData.get("note")),
    created_by: user?.id ?? null,
  });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/pulse");
  revalidatePath("/financials");
}

export async function toggleJobLaborPaid(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const jobId = str(formData.get("job_id"));
  const paid = str(formData.get("paid")) === "true"; // current value
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("job_labor")
    .update({
      paid: !paid,
      paid_on: !paid ? new Date().toISOString().slice(0, 10) : null,
    })
    .eq("id", id);
  if (jobId) revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/pulse");
}

export async function deleteJobLabor(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const jobId = str(formData.get("job_id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("job_labor").delete().eq("id", id);
  if (jobId) revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/pulse");
  revalidatePath("/financials");
}
