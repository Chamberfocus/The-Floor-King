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
import { getBusinessSettings } from "@/lib/data/business-settings";
import { getJobOpenBalance } from "@/lib/data/invoices";
import { buildInvoiceFromOrder } from "@/lib/data/order-invoice";
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

  // Scheduled → auto-submit to the warehouse (notifies the assigned person).
  await ensureWarehouseSubmitted(id);

  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  revalidatePath("/warehouse");
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
      .select(
        "id, customer_id, title, accepted_option_id, job_description, service_address_id",
      )
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

    // Site address: the estimate's chosen service address if set, else the
    // account's primary address.
    const svcId = (est.service_address_id as string | null) ?? null;
    let site = {
      street: cust?.street ?? null,
      city: cust?.city ?? null,
      state: cust?.state ?? null,
      zip: cust?.zip ?? null,
    };
    if (svcId) {
      const { data: sa } = await admin
        .from("service_addresses")
        .select("street, city, state, zip")
        .eq("id", svcId)
        .maybeSingle();
      if (sa)
        site = {
          street: (sa.street as string) ?? null,
          city: (sa.city as string) ?? null,
          state: (sa.state as string) ?? null,
          zip: (sa.zip as string) ?? null,
        };
    }

    const { data: job, error } = await admin
      .from("jobs")
      .insert({
        customer_id: est.customer_id,
        estimate_id: estimateId,
        option_id: optionId,
        service_address_id: svcId,
        title: (est.title as string) || "Job",
        notes: (est.job_description as string | null) || null,
        created_by: createdBy,
        site_street: site.street,
        site_city: site.city,
        site_state: site.state,
        site_zip: site.zip,
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

/** Create a blank job tied to a customer (optionally at a service address). */
export async function createJob(formData: FormData): Promise<void> {
  const customerId = str(formData.get("customer_id"));
  if (!customerId) return;
  const serviceAddressId = str(formData.get("service_address_id")) || null;

  const supabase = await createClient();
  const { data: cust } = await supabase
    .from("customers")
    .select("street, city, state, zip")
    .eq("id", customerId)
    .maybeSingle();

  // Site address: chosen service address, else the account's primary.
  let site = {
    street: cust?.street ?? null,
    city: cust?.city ?? null,
    state: cust?.state ?? null,
    zip: cust?.zip ?? null,
  };
  if (serviceAddressId) {
    const { data: sa } = await supabase
      .from("service_addresses")
      .select("street, city, state, zip")
      .eq("id", serviceAddressId)
      .maybeSingle();
    if (sa)
      site = {
        street: (sa.street as string) ?? null,
        city: (sa.city as string) ?? null,
        state: (sa.state as string) ?? null,
        zip: (sa.zip as string) ?? null,
      };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      customer_id: customerId,
      title: "Job",
      created_by: user?.id ?? null,
      service_address_id: serviceAddressId,
      site_street: site.street,
      site_city: site.city,
      site_state: site.state,
      site_zip: site.zip,
    })
    .select("id")
    .single();
  if (error || !job) return;

  revalidatePath("/jobs");
  revalidatePath(`/customers/${customerId}`);
  redirect(`/jobs/${job.id}`);
}

/** Change which address a job is for — refills its site_* fields to match. */
export async function setJobAddress(formData: FormData): Promise<void> {
  const id = str(formData.get("job_id"));
  if (!id) return;
  const serviceAddressId = str(formData.get("service_address_id")) || null;
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("customer_id")
    .eq("id", id)
    .maybeSingle();
  if (!job) return;

  let site = { street: null, city: null, state: null, zip: null } as {
    street: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  };
  if (serviceAddressId) {
    const { data: sa } = await supabase
      .from("service_addresses")
      .select("street, city, state, zip")
      .eq("id", serviceAddressId)
      .maybeSingle();
    site = {
      street: (sa?.street as string) ?? null,
      city: (sa?.city as string) ?? null,
      state: (sa?.state as string) ?? null,
      zip: (sa?.zip as string) ?? null,
    };
  } else {
    const { data: cust } = await supabase
      .from("customers")
      .select("street, city, state, zip")
      .eq("id", job.customer_id as string)
      .maybeSingle();
    site = {
      street: (cust?.street as string) ?? null,
      city: (cust?.city as string) ?? null,
      state: (cust?.state as string) ?? null,
      zip: (cust?.zip as string) ?? null,
    };
  }

  await supabase
    .from("jobs")
    .update({
      service_address_id: serviceAddressId,
      site_street: site.street,
      site_city: site.city,
      site_state: site.state,
      site_zip: site.zip,
    })
    .eq("id", id);
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  revalidatePath("/warehouse");
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

  // If a scheduled date was set here, auto-submit to the warehouse (once).
  if (str(formData.get("scheduled_date")))
    await ensureWarehouseSubmitted(id);

  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  revalidatePath("/warehouse");
  return { error: null, ok: true };
}

/** Assign (or clear) the install crew on a job — from your managed crew list. */
export async function setJobCrew(formData: FormData): Promise<void> {
  const id = str(formData.get("job_id"));
  if (!id) return;
  let crewId = str(formData.get("crew_id")) || null;
  const supabase = await createClient();

  // A team installer can be assigned directly (value "user:<profileId>"). We
  // find-or-create a matching employee crew so they "just work" here without
  // being re-entered under Settings → Install Crews — and so payout tracking
  // still has a crew to hang off of.
  if (crewId && crewId.startsWith("user:")) {
    const profileId = crewId.slice(5);
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", profileId)
      .maybeSingle();
    const name =
      (prof?.full_name as string) || (prof?.email as string) || "Installer";
    const email = (prof?.email as string) || null;

    let existingId: string | null = null;
    if (email) {
      const { data } = await supabase
        .from("install_crews")
        .select("id")
        .eq("email", email)
        .limit(1)
        .maybeSingle();
      existingId = (data?.id as string) ?? null;
    }
    if (!existingId) {
      const { data } = await supabase
        .from("install_crews")
        .select("id")
        .eq("name", name)
        .limit(1)
        .maybeSingle();
      existingId = (data?.id as string) ?? null;
    }
    if (existingId) {
      crewId = existingId;
    } else {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: created } = await supabase
        .from("install_crews")
        .insert({
          name,
          kind: "employee",
          email,
          active: true,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      crewId = (created?.id as string) ?? null;
    }
  }

  await supabase.from("jobs").update({ assigned_crew_id: crewId }).eq("id", id);
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  revalidatePath("/settings/install-crews");
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

type WhDb = Awaited<ReturnType<typeof createClient>>;

function fmtDay(d: string | null | undefined): string {
  if (!d) return "TBD";
  return new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Warehouse-role team members (id, name, email). */
async function warehouseUsers(
  db: WhDb,
): Promise<{ id: string; name: string; email: string | null }[]> {
  const { data } = await db
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "warehouse");
  return (data ?? []).map((p) => ({
    id: p.id as string,
    name: (p.full_name as string) || (p.email as string) || "Warehouse",
    email: (p.email as string) || null,
  }));
}

/**
 * Send a scheduled job to the warehouse ONCE — assigns a person (auto if there's
 * a single warehouse user, else leaves it open) and notifies them. No-op if the
 * job isn't scheduled yet or was already submitted. Runs elevated so it works no
 * matter which role scheduled the install (warehouse/customers/profiles reads
 * are otherwise RLS-restricted).
 */
async function ensureWarehouseSubmitted(
  jobId: string,
  opts?: { force?: boolean },
): Promise<void> {
  const db = createAdminClient() as unknown as WhDb;
  const { data: job } = await db
    .from("jobs")
    .select(
      "id, title, scheduled_date, warehouse_submitted_at, warehouse_assigned_to, site_street, site_city, site_state, customer:customers(full_name)",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!job || job.warehouse_submitted_at) return;
  // Installs go to the warehouse once scheduled; cash-and-carry / pickup orders
  // go when explicitly sent (force), since they have no install date.
  if (!job.scheduled_date && !opts?.force) return;

  const whu = await warehouseUsers(db);
  let assignee = (job.warehouse_assigned_to as string | null) ?? null;
  if (!assignee && whu.length === 1) assignee = whu[0].id;

  await db
    .from("jobs")
    .update({
      warehouse_submitted_at: new Date().toISOString(),
      warehouse_assigned_to: assignee,
    })
    .eq("id", jobId);

  const cust = job.customer as unknown as { full_name: string | null } | null;
  const custName = cust?.full_name ?? "Customer";
  const site = [job.site_street, job.site_city, job.site_state]
    .filter(Boolean)
    .join(", ");
  const recipients = assignee ? whu.filter((u) => u.id === assignee) : whu;
  for (const u of recipients) {
    if (!u.email) continue;
    await sendEmail({
      to: u.email,
      subject: `🧰 New job to prep — ${custName}`,
      html: emailLayout(
        "New job to stage",
        `<p><strong>${custName}</strong>${job.title ? ` — ${job.title}` : ""}</p>
         <p>${job.scheduled_date ? `Install: <strong>${fmtDay(job.scheduled_date as string)}</strong>` : "<strong>Cash &amp; carry — cut for pickup</strong>"}${site ? ` · ${site}` : ""}</p>
         <p>Open it in the warehouse and <strong>accept</strong> it to get started.</p>`,
        { label: "Open warehouse", url: `${siteUrl()}/warehouse` },
      ),
    });
  }
}

/** Send a job to the warehouse now (cash-and-carry / pickup — no install date).
 *  Callable directly (e.g. from order approval) or via the form wrapper. */
export async function sendJobToWarehouse(jobId: string): Promise<void> {
  if (!jobId) return;
  await ensureWarehouseSubmitted(jobId, { force: true });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/warehouse");
}

export async function submitJobToWarehouse(formData: FormData): Promise<void> {
  const id = str(formData.get("job_id"));
  if (!id) return;
  await sendJobToWarehouse(id);
}

/** Office/admin: assign (or change) which warehouse person preps a job. */
export async function assignWarehousePerson(
  formData: FormData,
): Promise<void> {
  const id = str(formData.get("job_id"));
  if (!id) return;
  const personId = str(formData.get("warehouse_person_id")) || null;
  const supabase = await createClient();
  await supabase
    .from("jobs")
    .update({ warehouse_assigned_to: personId })
    .eq("id", id);

  if (personId) {
    const { data: p } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("id", personId)
      .maybeSingle();
    const { data: job } = await supabase
      .from("jobs")
      .select("title, scheduled_date, customer:customers(full_name)")
      .eq("id", id)
      .maybeSingle();
    const cust = job?.customer as unknown as { full_name: string | null } | null;
    if (p?.email) {
      await sendEmail({
        to: p.email as string,
        subject: `🧰 You're assigned to prep — ${cust?.full_name ?? "a job"}`,
        html: emailLayout(
          "You've been assigned a job to stage",
          `<p><strong>${cust?.full_name ?? "Customer"}</strong>${job?.title ? ` — ${job.title}` : ""}</p>
           <p>Install: <strong>${fmtDay(job?.scheduled_date as string)}</strong></p>
           <p>Open it in the warehouse and <strong>accept</strong> it to get started.</p>`,
          { label: "Open warehouse", url: `${siteUrl()}/warehouse` },
        ),
      });
    }
  }
  revalidatePath("/warehouse");
  revalidatePath(`/jobs/${id}`);
}

/**
 * Warehouse accepts a job — must acknowledge cutting/pulling the right material.
 * Whoever accepts an unassigned job becomes its owner.
 */
export async function acceptWarehouseJob(formData: FormData): Promise<void> {
  const id = str(formData.get("job_id"));
  const ack = str(formData.get("ack")); // "on" when the checkbox is ticked
  if (!id || ack !== "on") return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const now = new Date().toISOString();
  const { data: job } = await supabase
    .from("jobs")
    .select("warehouse_assigned_to")
    .eq("id", id)
    .maybeSingle();
  const patch: Record<string, string | null> = {
    warehouse_accepted_at: now,
    warehouse_ack_at: now,
  };
  if (!job?.warehouse_assigned_to && user?.id)
    patch.warehouse_assigned_to = user.id;
  await supabase.from("jobs").update(patch).eq("id", id);
  revalidatePath("/warehouse");
  revalidatePath(`/jobs/${id}`);
}

/**
 * Warehouse marks a job staged & ready at a location — notifies the installer,
 * salesperson and admin (with the staging location) and drops the customer a
 * brief heads-up. Keeps the existing auto-advance to install scheduling.
 */
export async function completeWarehouseJob(formData: FormData): Promise<void> {
  const id = str(formData.get("id") || formData.get("job_id"));
  const location = str(formData.get("staging_location"));
  if (!id || !location) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Elevated: the warehouse role can't read customers/profiles or write messages
  // under RLS, but this action legitimately needs to notify everyone.
  const admin = createAdminClient() as unknown as WhDb;
  const now = new Date().toISOString();

  await admin
    .from("jobs")
    .update({
      warehouse_status: "staged",
      warehouse_ready_at: now,
      staging_location: location,
    })
    .eq("id", id);

  const { data: job } = await admin
    .from("jobs")
    .select(
      "title, scheduled_date, assigned_to, customer_id, delivery_type, customer:customers(full_name, email, assigned_to, workflow_owner_id)",
    )
    .eq("id", id)
    .maybeSingle();
  const isPickup =
    job?.delivery_type === "cash_carry" ||
    job?.delivery_type === "installer_pickup";

  // Materials ready → advance the lead to install scheduling (unchanged).
  if (job?.customer_id)
    await moveToAutoActionStage(job.customer_id as string, "schedule_install");

  const cust = job?.customer as unknown as {
    full_name: string | null;
    email: string | null;
    assigned_to: string | null;
    workflow_owner_id: string | null;
  } | null;
  const custName = cust?.full_name ?? "Customer";

  // Installer + salesperson + admin get the "ready + where" email.
  const ids = [
    (job?.assigned_to as string | null) ?? null,
    cust?.assigned_to ?? null,
    cust?.workflow_owner_id ?? null,
  ].filter(Boolean) as string[];
  const recipients = new Set<string>([ownerEmail()]);
  if (ids.length) {
    const { data: profs } = await admin
      .from("profiles")
      .select("email")
      .in("id", [...new Set(ids)]);
    for (const p of profs ?? []) if (p.email) recipients.add(p.email as string);
  }
  for (const to of recipients) {
    await sendEmail({
      to,
      subject: `✅ Materials staged & ready — ${custName}`,
      html: emailLayout(
        "Job is staged and ready",
        `<p><strong>${custName}</strong>${job?.title ? ` — ${job.title}` : ""}</p>
         <p>Staged at: <strong>${location}</strong></p>
         <p>Install: <strong>${fmtDay(job?.scheduled_date as string)}</strong></p>`,
        { label: "Open job", url: `${siteUrl()}/jobs/${id}` },
      ),
    });
  }

  // Brief, non-technical note to the customer via their portal thread.
  if (job?.customer_id) {
    await admin.from("messages").insert({
      customer_id: job.customer_id,
      channel: "client",
      author_id: user?.id ?? null,
      body: isPickup
        ? "✅ Your order is cut and ready for pickup. Come grab it whenever you're ready!"
        : "✅ Good news — your materials are prepped and ready for your installation.",
    });
  }

  // If this job came from a client order, auto-generate the invoice now that
  // it's cut & staged (idempotent — skips if one already exists).
  const { data: linkedOrder } = await admin
    .from("orders")
    .select("id, invoice_id")
    .eq("job_id", id)
    .maybeSingle();
  if (linkedOrder && !linkedOrder.invoice_id) {
    const invId = await buildInvoiceFromOrder(
      admin,
      linkedOrder.id as string,
      user?.id ?? null,
    );
    if (invId) {
      await sendEmail({
        to: ownerEmail(),
        subject: `🧾 Invoice ready — ${custName}`,
        html: emailLayout(
          "Invoice generated",
          `<p><strong>${custName}</strong>'s order is cut &amp; staged, so a draft invoice was generated automatically. Review it and collect at pickup.</p>`,
          { label: "Open invoice", url: `${siteUrl()}/invoices/${invId}` },
        ),
      });
    }
  }

  revalidatePath("/warehouse");
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/orders");
  revalidatePath("/invoices");
  if (job?.customer_id) revalidatePath(`/customers/${job.customer_id}`);
}

/**
 * Installer collects the on-site balance (opt-in via business settings). Cash/
 * check record the full-balance payment and mark the invoice paid; "link" just
 * flags the office to collect online (no money recorded). Runs elevated (crews
 * can't touch invoices/payments under RLS) but is GUARDED: the setting must be
 * on and the caller must be the job's assigned installer (or staff).
 */
export async function collectJobBalance(formData: FormData): Promise<void> {
  const jobId = str(formData.get("job_id"));
  const method = str(formData.get("method")); // 'cash' | 'check' | 'link'
  const reference = str(formData.get("reference")) || null;
  if (!jobId || !["cash", "check", "link"].includes(method)) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const settings = await getBusinessSettings();
  if (!settings.installer_collects_balance) return;

  const { data: me } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .maybeSingle();
  const role = me?.role as string | undefined;
  const isStaff = role === "admin" || role === "office";

  const admin = createAdminClient() as unknown as WhDb;
  const { data: job } = await admin
    .from("jobs")
    .select(
      "assigned_to, customer_id, title, customer:customers(full_name, assigned_to, workflow_owner_id)",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return;
  // Guard: only the assigned installer (or staff) may collect.
  if (!isStaff && job.assigned_to !== user.id) return;

  const coll = await getJobOpenBalance(jobId);
  if (!coll.invoiceId || coll.balance <= 0) return;

  const installerName = (me?.full_name as string) || "Installer";
  const cust = job.customer as unknown as {
    full_name: string | null;
    assigned_to: string | null;
    workflow_owner_id: string | null;
  } | null;
  const custName = cust?.full_name ?? "Customer";
  const amt = coll.balance.toFixed(2);

  // Notify the office (owner + the customer's rep).
  const notifyOffice = async (subject: string, bodyHtml: string) => {
    const ids = [cust?.assigned_to ?? null, cust?.workflow_owner_id ?? null].filter(
      Boolean,
    ) as string[];
    const recipients = new Set<string>([ownerEmail()]);
    if (ids.length) {
      const { data: profs } = await admin
        .from("profiles")
        .select("email")
        .in("id", [...new Set(ids)]);
      for (const p of profs ?? [])
        if (p.email) recipients.add(p.email as string);
    }
    for (const to of recipients) {
      await sendEmail({
        to,
        subject,
        html: emailLayout(subject, bodyHtml, {
          label: "Open job",
          url: `${siteUrl()}/jobs/${jobId}`,
        }),
      });
    }
  };

  if (method === "link") {
    await notifyOffice(
      `💳 Online payment requested — ${custName}`,
      `<p>${installerName} asked <strong>${custName}</strong> to pay the remaining balance of <strong>$${amt}</strong> online. Send them a payment link to close it out.</p>`,
    );
    revalidatePath(`/jobs/${jobId}`);
    return;
  }

  // cash / check → record the full balance and mark the invoice paid.
  await admin.from("payments").insert({
    invoice_id: coll.invoiceId,
    amount: coll.balance,
    method,
    reference,
    paid_at: new Date().toISOString().slice(0, 10),
    notes: `Collected on site by ${installerName}`,
    created_by: user.id,
  });
  await admin.from("invoices").update({ status: "paid" }).eq("id", coll.invoiceId);

  await notifyOffice(
    `💵 Balance collected — ${custName}`,
    `<p>${installerName} collected <strong>$${amt}</strong> by <strong>${method}</strong> on site for <strong>${custName}</strong>${
      reference ? ` · ref ${reference}` : ""
    }. The invoice is marked paid.</p>`,
  );

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/invoices");
  if (job.customer_id) revalidatePath(`/customers/${job.customer_id}`);
}

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
  const row = {
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
  };
  const crewId = nullable(formData.get("crew_id"));
  // Tie the payout to the assigned crew. If the crew_id column isn't there yet
  // (migration 0049 not run), fall back to recording without it.
  const res = await supabase.from("job_labor").insert({ ...row, crew_id: crewId });
  if (res.error) await supabase.from("job_labor").insert(row);
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
