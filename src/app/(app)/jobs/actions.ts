"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertRole } from "@/lib/auth";
import { sendEmail, emailLayout, emailInfoCard, siteUrl, ownerEmail } from "@/lib/notify";
import { sendSms } from "@/lib/sms";
import { addDaysYmd } from "@/lib/scheduling";
import { to12, formatDate } from "@/lib/format";
import { releaseJobReservations } from "@/lib/po-stock";
import {
  moveToAutoActionStage,
  advanceToNamedStage,
} from "@/lib/workflow-engine";
import { estimatedLaborCostForOption } from "@/lib/installer-bill";
import { estimatedMaterialCostForOption } from "@/lib/job-costing";

// Back-half pipeline stages carry no auto_action marker, so job-lifecycle events
// map to them by name (forward-only, best-effort).
// The "install is booked" stage — must match "Install Scheduled" but NOT the
// earlier "Installation Needs Scheduled" stage (both contain install+scheduled),
// or booking would try to move the customer to the stage they're already on and
// silently no-op. Excludes any "needs" scheduling stage.
const STAGE_INSTALL_SCHEDULED = /^(?!.*\bneeds\b).*install.*sched/;
const STAGE_INSTALLED = /installed|follow/;
/** The crew is on site — its own stage, between scheduled and installed. */
const STAGE_INSTALL_IN_PROGRESS = /in progress|in-progress/;
import { prepareJobMaterialsFor } from "./material-actions";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { getJobOpenBalance } from "@/lib/data/invoices";
import { buildInvoiceFromOrder } from "@/lib/data/order-invoice";
import type {
  JobDeliveryType,
  JobStatus,
  WarehouseStatus,
  EstimateLineItem,
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

type JobsDb = Awaited<ReturnType<typeof createClient>>;

/**
 * Find-or-create the employee crew that represents a login installer, so pay and
 * the warehouse always have a crew to hang off of. Returns the crew id.
 */
async function ensureCrewForProfile(
  supabase: JobsDb,
  profileId: string,
): Promise<string | null> {
  const { data: prof } = await supabase
    .from("profiles")
    .select("full_name, email, phone")
    .eq("id", profileId)
    .maybeSingle();
  const name =
    (prof?.full_name as string) || (prof?.email as string) || "Installer";
  const email = (prof?.email as string) || null;
  const phone = (prof?.phone as string) || null;

  // 1) A crew already hard-linked to this profile? Use it. (Guarded so it's a
  //    no-op before the profile_id migration is run.)
  const { data: linked } = await supabase
    .from("install_crews")
    .select("id")
    .eq("profile_id", profileId)
    .limit(1)
    .maybeSingle();
  if (linked?.id) return linked.id as string;

  // 2) Match an existing crew by phone / email / name, then link it so it's
  //    never ambiguous again.
  const { data: crewRows } = await supabase
    .from("install_crews")
    .select("id, name, email, phone");
  const pp = phone10(phone);
  const match = (crewRows ?? []).find((c) => {
    const cc = c as { id: string; name: string | null; email: string | null; phone: string | null };
    return (
      (pp && phone10(cc.phone) === pp) ||
      (email && (cc.email ?? "").trim().toLowerCase() === email.toLowerCase()) ||
      (cc.name ?? "").trim().toLowerCase() === name.trim().toLowerCase()
    );
  }) as { id: string } | undefined;
  if (match?.id) {
    await supabase
      .from("install_crews")
      .update({ profile_id: profileId })
      .eq("id", match.id);
    return match.id;
  }

  // 3) Create a new employee crew, linked to this profile from the start.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const base = {
    name,
    kind: "employee",
    email,
    phone,
    active: true,
    created_by: user?.id ?? null,
  };
  let { data: created } = await supabase
    .from("install_crews")
    .insert({ ...base, profile_id: profileId })
    .select("id")
    .single();
  if (!created) {
    // Fallback for before the profile_id migration is run.
    ({ data: created } = await supabase
      .from("install_crews")
      .insert(base)
      .select("id")
      .single());
  }
  return (created?.id as string) ?? null;
}

/**
 * The login installer (crew/admin profile) a managed crew maps to — by email
 * first, then by exact name (subcontractor crews are often set up without an
 * email but share a name with the installer's phone login). Returns null when
 * there's no login installer behind the crew (a pure subcontractor).
 */
/** A phone reduced to its last 10 digits, for format-agnostic matching. */
function phone10(v: string | null | undefined): string {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
}

/**
 * One assignment/schedule change ripples to EVERY view that shows the job, so
 * the app stays interconnected: the installer's page, the warehouse queue, the
 * install calendar, the job board, the pipeline/dashboard, and the customer file.
 */
function revalidateJobEverywhere(id: string, customerId?: string | null): void {
  for (const p of [
    `/jobs/${id}`,
    "/jobs",
    "/jobs/calendar",
    "/installer",
    "/install-scheduler",
    "/warehouse",
    "/board",
    "/client-status",
    "/dashboard",
  ]) {
    revalidatePath(p);
  }
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

/** Book a smart-scheduled install: assign installer + date range. */
/** Confirm to the customer that their install is booked, with the arrival
 *  window. Best-effort: every send is guarded so one failure never blocks. */
async function notifyInstallBooked(o: {
  customerId: string | null;
  title: string | null;
  date: string;
  window: string | null; // raw "HH:MM-HH:MM"
}): Promise<void> {
  if (!o.customerId) return;
  const admin = createAdminClient();
  const { data: c } = await admin
    .from("customers")
    .select("full_name, email, phone")
    .eq("id", o.customerId)
    .maybeSingle();
  if (!c) return;
  const first = (c.full_name as string | null)?.split(" ")[0] ?? "there";
  const niceDate = formatDate(o.date);
  const win = o.window
    ? o.window.split("-").map((t) => to12(t.trim())).join(" – ")
    : null;
  if (c.email)
    await sendEmail({
      to: c.email as string,
      subject: "Your installation is scheduled 🎉",
      html: emailLayout(
        "Your installation is booked!",
        `<p>Hi ${first},</p>
         <p>Great news — your flooring installation is on the calendar, and we can't wait to get started!</p>
         ${emailInfoCard(
           [
             { label: "Date", value: niceDate },
             ...(win ? [{ label: "Arrival window", value: win }] : []),
           ],
           { title: "Your installation" },
         )}
         <p>Our team will arrive within the window above. If you have any questions beforehand, just reply to this email — we're happy to help.</p>
         <p>Thank you for choosing us. See you soon!</p>`,
        { label: "View your project", url: `${siteUrl()}/portal` },
        {
          preheader: `Installation scheduled for ${niceDate}${win ? `, arriving ${win}` : ""}.`,
        },
      ),
    }).catch(() => {});
  if (c.phone)
    await sendSms(
      c.phone as string,
      `Cleveland Floor King: your installation is scheduled for ${niceDate}${win ? `, arriving ${win}` : ""}. We look forward to seeing you!`,
    ).catch(() => {});
}

/** Tell the assigned installer / crew they've been scheduled for an install,
 *  with the date, arrival window, and site address. Best-effort (guarded). */
async function notifyInstallerAssigned(o: {
  jobId: string;
  installerId: string | null; // login installer (profiles.id)
  crewId: string | null; // subcontractor crew (install_crews.id)
  customerId: string | null;
  title: string | null;
  date: string;
  window: string | null; // raw "HH:MM-HH:MM"
}): Promise<void> {
  const admin = createAdminClient();

  // Resolve the recipient (a login installer, else the assigned crew).
  let email: string | null = null;
  let phone: string | null = null;
  if (o.installerId) {
    const { data: p } = await admin
      .from("profiles")
      .select("email, phone")
      .eq("id", o.installerId)
      .maybeSingle();
    email = (p?.email as string | null) ?? null;
    phone = (p?.phone as string | null) ?? null;
  } else if (o.crewId) {
    const { data: cr } = await admin
      .from("install_crews")
      .select("email, phone")
      .eq("id", o.crewId)
      .maybeSingle();
    email = (cr?.email as string | null) ?? null;
    phone = (cr?.phone as string | null) ?? null;
  }
  if (!email && !phone) return;

  // Customer name + site address for the job.
  let custName = "a customer";
  if (o.customerId) {
    const { data: c } = await admin
      .from("customers")
      .select("full_name")
      .eq("id", o.customerId)
      .maybeSingle();
    custName = (c?.full_name as string | null) ?? custName;
  }
  const { data: j } = await admin
    .from("jobs")
    .select("site_street, site_city, site_state")
    .eq("id", o.jobId)
    .maybeSingle();
  const site =
    [j?.site_street, j?.site_city, j?.site_state].filter(Boolean).join(", ") ||
    null;

  const niceDate = formatDate(o.date);
  const win = o.window
    ? o.window.split("-").map((t) => to12(t.trim())).join(" – ")
    : null;
  const label = o.title || custName;

  if (email)
    await sendEmail({
      to: email,
      subject: `🧰 You're scheduled for an install — ${custName}`,
      html: emailLayout(
        "You've got an install scheduled",
        `<p>You've been assigned an installation${label ? ` for <strong>${label}</strong>` : ""}.</p>
         ${emailInfoCard(
           [
             { label: "Customer", value: custName },
             { label: "Date", value: niceDate },
             ...(win ? [{ label: "Arrival window", value: win }] : []),
             ...(site ? [{ label: "Address", value: site }] : []),
           ],
           { title: "Your install" },
         )}
         <p>Open your schedule for the full work order and cut list.</p>`,
        { label: "Open my schedule", url: `${siteUrl()}/installer` },
        { preheader: `${custName} · ${niceDate}${win ? `, ${win}` : ""}` },
      ),
    }).catch(() => {});
  if (phone)
    await sendSms(
      phone,
      `Floor King: you're scheduled to install for ${custName} on ${niceDate}${win ? `, ${win}` : ""}. Open the app for the work order.`,
    ).catch(() => {});
}

export async function bookInstall(formData: FormData): Promise<void> {
  const id = str(formData.get("job_id"));
  // One picker, one assignment. The value is either a login installer's profile
  // id (→ assigned_to, so it shows in their "My Work") or "crew:<id>" for a
  // subcontractor crew with no login (→ assigned_crew_id).
  const installerRaw = str(formData.get("installer_id"));
  const crewDirect = installerRaw.startsWith("crew:")
    ? installerRaw.slice(5)
    : null;
  const installer = crewDirect ? "" : installerRaw;
  const start = str(formData.get("start"));
  let end = str(formData.get("end")) || start;
  if (end < start) end = start; // never store an end date before the start
  const arrivalWindow = str(formData.get("arrival_window"));
  // The booking popup decides who gets notified: the customer (send_email) and
  // the assigned installer (notify_assignee). Absent = notify (back-compat).
  const skipClientEmail = str(formData.get("send_email")) === "no";
  const notifyAssignee = str(formData.get("notify_assignee")) !== "no";
  if (!id || !start) return;
  const supabase = await createClient();
  await supabase
    .from("jobs")
    .update({
      assigned_to: installer || null,
      ...(crewDirect ? { assigned_crew_id: crewDirect } : {}),
      scheduled_date: start,
      scheduled_end: end,
      status: "scheduled",
      open_for_claim: false,
    })
    .eq("id", id);
  // Arrival window — separate update so a pre-migration DB (no column yet)
  // can't break booking the install.
  if (arrivalWindow) {
    await supabase
      .from("jobs")
      .update({ arrival_window: arrivalWindow })
      .eq("id", id);
  }

  // Install booked → advance out of the "schedule install" stage.
  const { data: job } = await supabase
    .from("jobs")
    .select("customer_id, title")
    .eq("id", id)
    .maybeSingle();
  // Install booked → move the customer to the "Install Scheduled" stage so the
  // dashboard follows the job (forward-only; skips the mid "Waiting" stage).
  if (job?.customer_id)
    await advanceToNamedStage(job.customer_id as string, STAGE_INSTALL_SCHEDULED, id);

  // Scheduled → auto-submit to the warehouse (notifies the assigned person).
  await ensureWarehouseSubmitted(id);

  // Keep the crew record (pay + warehouse + the scheduler grid read it) matching
  // the booked login installer, so reassigning the installer moves the crew too.
  if (installer) {
    const crewId = await ensureCrewForProfile(supabase, installer);
    if (crewId)
      await supabase.from("jobs").update({ assigned_crew_id: crewId }).eq("id", id);
  }

  revalidateJobEverywhere(id, job?.customer_id as string | null);

  // Tell the customer their install is booked, with the arrival window — after
  // the response so the booking feels instant. Best-effort (guarded). Skipped
  // when the booking popup opted out.
  if (!skipClientEmail)
    after(() =>
      notifyInstallBooked({
        customerId: (job?.customer_id as string | null) ?? null,
        title: (job?.title as string | null) ?? null,
        date: start,
        window: arrivalWindow || null,
      }),
    );

  // Tell the assigned installer / crew they're scheduled, with the date, arrival
  // window, and site address. Skipped when the popup opted out.
  if (notifyAssignee)
    after(() =>
      notifyInstallerAssigned({
        jobId: id,
        installerId: installer || null,
        crewId: crewDirect,
        customerId: (job?.customer_id as string | null) ?? null,
        title: (job?.title as string | null) ?? null,
        date: start,
        window: arrivalWindow || null,
      }),
    );

  // When invoked from the customer LIST, return there; the guided flow / file
  // pass nothing and stay put (revalidate only), as before.
  const redirectTo = str(formData.get("redirect_to"));
  if (redirectTo) {
    revalidatePath(redirectTo);
    redirect(redirectTo);
  }
}

/** Alert the customer AND the assigned installer/crew that an install moved.
 *  Best-effort: every send is guarded so one failure never blocks the others. */
async function alertReschedule(
  admin: ReturnType<typeof createAdminClient>,
  o: {
    customerId: string | null;
    installerId: string | null;
    crewId: string | null;
    title: string | null;
    window: string | null;
    newDate: string;
    actorId: string;
  },
): Promise<void> {
  const nice = new Date(`${o.newDate}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const win = o.window
    ? o.window.split("-").map((t) => to12(t.trim())).join("–")
    : null;

  // Customer: portal message + email + text.
  if (o.customerId) {
    const { data: c } = await admin
      .from("customers")
      .select("full_name, email, phone")
      .eq("id", o.customerId)
      .maybeSingle();
    const first = (c?.full_name as string | null)?.split(" ")[0] ?? "there";
    const line = `Your installation has been rescheduled to ${nice}${win ? ` (arriving ${win})` : ""}.`;
    await admin
      .from("messages")
      .insert({
        customer_id: o.customerId,
        channel: "client",
        author_id: o.actorId,
        body: `📅 ${line}`,
      })
      .then(() => {}, () => {});
    if (c?.email)
      await sendEmail({
        to: c.email as string,
        subject: "Your new installation date 🗓️",
        html: emailLayout(
          "Your installation has been rescheduled",
          `<p>Hi ${first},</p>
           <p>Just a heads-up — we've updated your flooring installation to a new date. Here are the latest details:</p>
           ${emailInfoCard(
             [
               { label: "New date", value: nice },
               ...(win ? [{ label: "Arrival window", value: win }] : []),
             ],
             { title: "Your installation" },
           )}
           <p>If this new time doesn't work for you, just reply and we'll happily sort it out. Thank you for your flexibility!</p>`,
          { label: "View your project", url: `${siteUrl()}/portal` },
          { preheader: line },
        ),
      }).catch(() => {});
    if (c?.phone)
      await sendSms(c.phone as string, `Cleveland Floor King: ${line}`).catch(
        () => {},
      );
  }

  // Installer (app login) and/or managed crew.
  const label = o.title || "an install";
  const instLine = `Install "${label}" was moved to ${nice}${win ? ` (${win})` : ""}.`;
  if (o.installerId) {
    const { data: p } = await admin
      .from("profiles")
      .select("email, phone")
      .eq("id", o.installerId)
      .maybeSingle();
    if (p?.email)
      await sendEmail({
        to: p.email as string,
        subject: "Install rescheduled",
        html: emailLayout("Install rescheduled", `<p>${instLine}</p>`, {
          label: "Open my schedule",
          url: `${siteUrl()}/installer`,
        }),
      }).catch(() => {});
    if (p?.phone)
      await sendSms(p.phone as string, `Floor King: ${instLine}`).catch(() => {});
  }
  if (o.crewId) {
    const { data: cr } = await admin
      .from("install_crews")
      .select("email, phone")
      .eq("id", o.crewId)
      .maybeSingle();
    if (cr?.email)
      await sendEmail({
        to: cr.email as string,
        subject: "Install rescheduled",
        html: emailLayout("Install rescheduled", `<p>${instLine}</p>`),
      }).catch(() => {});
    if (cr?.phone)
      await sendSms(cr.phone as string, `Floor King: ${instLine}`).catch(() => {});
  }
}

/** Move a booked install to a new date (drag-to-reschedule on the calendar).
 *  Preserves the job's duration, then alerts BOTH the customer and the assigned
 *  installer/crew. Staff can move any install; an installer can move one assigned
 *  to them. Alerts run after the response so the move feels instant. */
export async function rescheduleInstall(
  jobId: string,
  newDate: string,
  /** Optional target row on the installer grid: a user id, `crew:<id>`, or
   *  "unassigned". Staff only — reassigns the job to that installer/crew. */
  resourceId?: string,
  /** New arrival window "HH:MM-HH:MM" (or "" to clear). Omit to keep the
   *  existing window. */
  arrivalWindow?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!jobId || !/^\d{4}-\d{2}-\d{2}$/.test(newDate))
    return { ok: false, error: "Missing job or a valid date." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const role = (me?.role as string) ?? "";

  const admin = createAdminClient();
  const { data: job } = await admin
    .from("jobs")
    .select(
      "id, title, customer_id, assigned_to, assigned_crew_id, scheduled_date, scheduled_end, arrival_window",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return { ok: false, error: "Job not found." };

  const isStaff = ["admin", "office", "scheduler"].includes(role);
  const isAssigned = !!job.assigned_to && job.assigned_to === user.id;
  if (!isStaff && !isAssigned)
    return { ok: false, error: "You can only move installs assigned to you." };

  // Reassignment (installer grid): only staff may change WHO the job is on.
  let newInstaller = (job.assigned_to as string | null) ?? null;
  let newCrew = (job.assigned_crew_id as string | null) ?? null;
  let reassigned = false;
  if (resourceId != null && isStaff) {
    if (resourceId === "unassigned") {
      newInstaller = null;
      newCrew = null;
    } else if (resourceId.startsWith("crew:")) {
      newCrew = resourceId.slice(5);
      newInstaller = null;
    } else {
      newInstaller = resourceId;
    }
    reassigned =
      newInstaller !== ((job.assigned_to as string | null) ?? null) ||
      newCrew !== ((job.assigned_crew_id as string | null) ?? null);
  }

  const oldWindow = (job.arrival_window as string | null) ?? null;
  const nextWindow =
    arrivalWindow !== undefined ? arrivalWindow || null : oldWindow;
  const windowChanged = nextWindow !== oldWindow;

  const oldStart = (job.scheduled_date as string | null) ?? null;
  if (oldStart === newDate && !reassigned && !windowChanged) return { ok: true }; // nothing changed
  const oldEnd = (job.scheduled_end as string | null) || oldStart;
  let newEnd = newDate;
  if (oldStart && oldEnd) {
    const span = Math.max(
      0,
      Math.round((Date.parse(oldEnd) - Date.parse(oldStart)) / 86_400_000),
    );
    newEnd = addDaysYmd(newDate, span);
  }
  await admin
    .from("jobs")
    .update({
      scheduled_date: newDate,
      scheduled_end: newEnd,
      status: "scheduled",
      ...(arrivalWindow !== undefined ? { arrival_window: nextWindow } : {}),
      ...(reassigned
        ? {
            assigned_to: newInstaller,
            assigned_crew_id: newCrew,
            // Unassigning must also pull the job OFF the claim board, so an
            // unassigned job is never left visible to installers. (Re-posting is
            // a deliberate, separate action.)
            ...(newInstaller === null && newCrew === null
              ? { open_for_claim: false }
              : {}),
          }
        : {}),
    })
    .eq("id", jobId);

  after(async () => {
    try {
      await alertReschedule(admin, {
        customerId: (job.customer_id as string | null) ?? null,
        installerId: newInstaller,
        crewId: newCrew,
        title: (job.title as string | null) ?? null,
        window: nextWindow,
        newDate,
        actorId: user.id,
      });
    } catch {
      /* alerts are best-effort */
    }
  });

  revalidateJobEverywhere(jobId, (job.customer_id as string | null) ?? null);
  revalidatePath("/install-scheduler");
  revalidatePath("/installer");
  return { ok: true };
}

/** Set / change the install arrival window on a job (independent of booking). */
export async function setJobArrivalWindow(formData: FormData): Promise<void> {
  const id = str(formData.get("job_id"));
  const window = str(formData.get("arrival_window"));
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("jobs")
    .update({ arrival_window: window || null })
    .eq("id", id);
  revalidatePath(`/jobs/${id}`);
  if (formData.get("customer_id")) {
    revalidatePath(`/customers/${str(formData.get("customer_id"))}`);
  }
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

    // Snapshot the estimate's isolated MATERIAL + LABOR cost onto the job —
    // written ONCE here, at approval (the estimate flow, NOT the costing/bill
    // views). Those views only read these later; nothing there overwrites them.
    let estimatedLaborCost: number | null = null;
    let estimatedMaterialCost: number | null = null;
    if (optionId) {
      const { data: optLines } = await admin
        .from("estimate_line_items")
        .select("*")
        .eq("option_id", optionId);
      const lines = (optLines ?? []) as EstimateLineItem[];
      estimatedLaborCost = estimatedLaborCostForOption(lines);
      estimatedMaterialCost = estimatedMaterialCostForOption(lines);
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

    const baseRow = {
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
    };
    let { data: job, error } = await admin
      .from("jobs")
      .insert({
        ...baseRow,
        estimated_labor_cost: estimatedLaborCost,
        estimated_material_cost: estimatedMaterialCost,
      })
      .select("id")
      .single();
    if (error) {
      // Pre-migration fallback (0123 / 0124 not run yet): create the job without
      // the cost snapshots rather than blocking the win.
      ({ data: job, error } = await admin
        .from("jobs")
        .insert(baseRow)
        .select("id")
        .single());
    }
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
  if (jobId) redirect(`/jobs/${jobId}?created=1`);
}

/**
 * `createJob` lived here: it made a work order titled literally "Job" with
 * nothing on it, then dropped you on the work order to fill in the blanks — and
 * the roll-up flagged the result as a stray click, safe to delete. Worse, it
 * nudged the pipeline off the deposit stage unconditionally, so starting a job
 * for someone still on "New Lead" teleported them into Materials & Warehouse
 * with no quote sent and no money taken.
 *
 * Starting work for an existing customer now goes through /jobs/new, which asks
 * what the work is and where, can hang it off an estimate that already exists,
 * and only advances the pipeline when the account is actually sold. See
 * `createJobForCustomer` in src/app/(app)/jobs/new/actions.ts.
 */

/** Change which address a job is for — refills its site_* fields to match. */
export async function setJobAddress(formData: FormData): Promise<void> {
  const id = str(formData.get("job_id"));
  if (!id) return;
  let serviceAddressId = str(formData.get("service_address_id")) || null;
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("customer_id")
    .eq("id", id)
    .maybeSingle();
  if (!job) return;

  /**
   * Add the address here, rather than sending you away to create it.
   *
   * A job could only be pointed at a site that ALREADY existed, so using a
   * second address meant leaving the work order, adding it on the customer's
   * file, and coming back. That's why 32 of 36 live jobs carry a loose street
   * copied off the account instead of a real, reusable job site — the path of
   * least resistance was to not use the feature.
   *
   * Anything typed here is saved against the CUSTOMER, so the next job at that
   * property just picks it from the list.
   */
  const newStreet = str(formData.get("new_street"));
  const newLabel = str(formData.get("new_label"));
  if (!serviceAddressId && (newStreet || newLabel)) {
    const { data: created } = await supabase
      .from("service_addresses")
      .insert({
        customer_id: job.customer_id as string,
        label: newLabel || null,
        street: newStreet || null,
        city: str(formData.get("new_city")) || null,
        state: str(formData.get("new_state")) || null,
        zip: str(formData.get("new_zip")) || null,
      })
      .select("id")
      .single();
    serviceAddressId = (created?.id as string) ?? null;
  }

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

  // Job EDIT only — title, status, delivery, site, notes. The install DATE and
  // INSTALLER are owned solely by the "Schedule install" flow (bookInstall), so
  // this form can't produce a half-booked state (dated but still "unscheduled",
  // still on the claim board, no arrival window). See job-form.tsx.
  const supabase = await createClient();
  const { error } = await supabase
    .from("jobs")
    .update({
      title: nullable(formData.get("title")),
      status: (str(formData.get("status")) || "unscheduled") as JobStatus,
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

  const { data: job } = await supabase
    .from("jobs")
    .select("customer_id")
    .eq("id", id)
    .maybeSingle();
  const customerId = (job?.customer_id as string | null) ?? null;
  // Completing / starting a job here advances the pipeline stage too, matching
  // the quick-status path (otherwise the dashboard/pipeline stay behind).
  const newStatus = str(formData.get("status"));
  if (customerId) {
    if (newStatus === "completed")
      await advanceToNamedStage(customerId, STAGE_INSTALLED, id);
    else if (newStatus === "in_progress")
      // Starting work now lands on its own stage. It used to advance only as far
      // as "Install Scheduled", so a job being worked on read the same as one
      // merely booked.
      await advanceToNamedStage(customerId, STAGE_INSTALL_IN_PROGRESS, id);
  }
  // Same unwind as the quick-status path — cancelling from the edit form must
  // free the reserved material too, or the two routes disagree.
  if (newStatus === "cancelled") {
    await releaseJobReservations(supabase, [id]);
    revalidatePath("/inventory");
    revalidatePath("/warehouse");
  }
  revalidateJobEverywhere(id, customerId);
  return { error: null, ok: true };
}

/** Quick status change (also usable by assigned crew from the field). */
export async function setJobStatus(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const status = str(formData.get("status")) as JobStatus;
  if (!id || !status) return;

  const supabase = await createClient();
  await supabase.from("jobs").update({ status }).eq("id", id);

  const { data: job } = await supabase
    .from("jobs")
    .select("customer_id")
    .eq("id", id)
    .maybeSingle();
  const customerId = (job?.customer_id as string | null) ?? null;
  if (customerId) {
    // Finishing advances to "Installed – Follow-up"; starting advances to
    // "Install Scheduled" if it lagged (both forward-only).
    if (status === "completed")
      await advanceToNamedStage(customerId, STAGE_INSTALLED, id);
    else if (status === "in_progress")
      await advanceToNamedStage(customerId, STAGE_INSTALL_IN_PROGRESS, id);
  }
  // Cancelling used to change the status and nothing else, so the material
  // stayed reserved against a job that will never happen — inventory read as
  // committed and the next job couldn't have it.
  if (status === "cancelled") {
    await releaseJobReservations(supabase, [id]);
    revalidatePath("/inventory");
    revalidatePath("/warehouse");
  }

  // Fan out to every view that shows the job (installer, warehouse, board,
  // calendar, pipeline, dashboard, customer file) — not just the jobs list.
  revalidateJobEverywhere(id, customerId);
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
  // Target window + expected duration for installers claiming it. Separate update
  // so a pre-migration DB (columns not added yet) can't block posting.
  const wantedStart = str(formData.get("wanted_start")) || null;
  const wantedEnd = str(formData.get("wanted_end")) || null;
  const daysRaw = str(formData.get("expected_days"));
  const expectedDays = daysRaw ? Math.max(0, parseFloat(daysRaw)) || null : null;
  if (wantedStart || wantedEnd || expectedDays) {
    await supabase
      .from("jobs")
      .update({
        board_wanted_start: wantedStart,
        board_wanted_end: wantedEnd,
        board_expected_days: expectedDays,
      })
      .eq("id", id);
  }
  // Targeting: specific installers, or everyone (empty). Separate update so a
  // pre-migration DB can't block posting. Always set so re-posting to everyone
  // clears any prior targeting.
  const installerIds = formData.getAll("installer_ids").map(String).filter(Boolean);
  await supabase
    .from("jobs")
    .update({ board_installer_ids: installerIds.length ? installerIds : null })
    .eq("id", id);
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/board");
}

/** Change the dates the customer wants the job done. Works whether the job is on
 *  the board OR already sent to an installer. If an installer/crew is on it, they
 *  get a text/email about the new requested window. */
export async function updateWantedDates(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  const wantedStart = str(formData.get("wanted_start")) || null;
  const wantedEnd = str(formData.get("wanted_end")) || null;
  const daysRaw = str(formData.get("expected_days"));
  const expectedDays = daysRaw ? Math.max(0, parseFloat(daysRaw)) || null : null;
  await supabase
    .from("jobs")
    .update({
      board_wanted_start: wantedStart,
      board_wanted_end: wantedEnd,
      board_expected_days: expectedDays,
    })
    .eq("id", id);

  const { data: job } = await supabase
    .from("jobs")
    .select("customer_id, assigned_to, assigned_crew_id, title")
    .eq("id", id)
    .maybeSingle();

  // Tell the assigned installer/crew about the new requested window (best-effort).
  if (job && (wantedStart || wantedEnd) && (job.assigned_to || job.assigned_crew_id)) {
    const fmt = (d: string) =>
      new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const win = wantedStart
      ? `${fmt(wantedStart)}${wantedEnd ? ` – ${fmt(wantedEnd)}` : ""}`
      : "updated";
    const line = `Requested dates for "${(job.title as string) || "an install"}" changed to ${win}.`;
    try {
      if (job.assigned_to) {
        const { data: p } = await supabase
          .from("profiles")
          .select("email, phone")
          .eq("id", job.assigned_to)
          .maybeSingle();
        if (p?.email)
          await sendEmail({
            to: p.email as string,
            subject: "Requested install dates changed",
            html: emailLayout("Requested dates updated", `<p>${line}</p>`, {
              label: "Open my schedule",
              url: `${siteUrl()}/installer`,
            }),
          }).catch(() => {});
        if (p?.phone) await sendSms(p.phone as string, `Floor King: ${line}`).catch(() => {});
      }
      if (job.assigned_crew_id) {
        const { data: cr } = await supabase
          .from("install_crews")
          .select("email, phone")
          .eq("id", job.assigned_crew_id)
          .maybeSingle();
        if (cr?.email)
          await sendEmail({
            to: cr.email as string,
            subject: "Requested install dates changed",
            html: emailLayout("Requested dates updated", `<p>${line}</p>`),
          }).catch(() => {});
        if (cr?.phone) await sendSms(cr.phone as string, `Floor King: ${line}`).catch(() => {});
      }
    } catch {
      /* best-effort */
    }
  }

  revalidateJobEverywhere(id, (job?.customer_id as string | null) ?? null);
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

/** Repost a job to the board MID-JOB — the assigned installer fell through, so
 *  clear the installer/crew and reopen it for anyone to claim, keeping the
 *  scheduled date as the target. Works from any status. */
export async function repostJobToBoard(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("customer_id")
    .eq("id", id)
    .maybeSingle();
  await supabase
    .from("jobs")
    .update({ open_for_claim: true, assigned_to: null, assigned_crew_id: null })
    .eq("id", id);
  // Reposting clears the fallen-through installer and reopens it. Target specific
  // installers if chosen, else everyone. Separate/guarded so a pre-migration DB
  // can't block it.
  const installerIds = formData.getAll("installer_ids").map(String).filter(Boolean);
  await supabase
    .from("jobs")
    .update({ board_installer_ids: installerIds.length ? installerIds : null })
    .eq("id", id);
  revalidateJobEverywhere(id, (job?.customer_id as string | null) ?? null);
  revalidatePath("/board");
  revalidatePath("/dashboard");
}

/** An installer files a CLAIM REQUEST on a posted job (Option B: you approve). */
export async function applyToJob(formData: FormData): Promise<void> {
  const jobId = str(formData.get("job_id"));
  if (!jobId) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  // Only a genuinely-claimable (posted) job can be requested — guards against a
  // stale board tab requesting a job that was un-posted or already assigned.
  const { data: openJob } = await supabase
    .from("jobs")
    .select("id")
    .eq("id", jobId)
    .eq("open_for_claim", true)
    .is("assigned_to", null)
    .maybeSingle();
  if (!openJob) {
    revalidatePath("/board");
    return;
  }
  await supabase
    .from("job_applications")
    .upsert(
      { job_id: jobId, installer_id: user.id, status: "applied" },
      { onConflict: "job_id,installer_id" },
    );
  revalidatePath("/board");
  revalidatePath(`/jobs/${jobId}`);

  // Tell the office a claim request came in — email + text, best-effort.
  after(async () => {
    try {
      const admin = createAdminClient();
      const { data: job } = await admin
        .from("jobs")
        .select("title, customer:customers(full_name)")
        .eq("id", jobId)
        .maybeSingle();
      const { data: me } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      const cust = job?.customer as { full_name: string | null } | { full_name: string | null }[] | null;
      const custName =
        (Array.isArray(cust) ? cust[0]?.full_name : cust?.full_name) ??
        (job?.title as string | null) ??
        "a job";
      const installer = (me?.full_name as string | null) ?? "An installer";
      const line = `${installer} wants to claim ${custName}. Approve it on the job board.`;
      const url = `${siteUrl()}/jobs/${jobId}`;
      const { data: owners } = await admin
        .from("profiles")
        .select("email, phone")
        .in("role", ["admin", "office"]);
      for (const o of owners ?? []) {
        if (o.email)
          await sendEmail({
            to: o.email as string,
            subject: `Claim request: ${custName}`,
            html: emailLayout("Job board — claim request", `<p>${line}</p>`, {
              label: "Review & approve",
              url,
            }),
          }).catch(() => {});
        if (o.phone)
          await sendSms(o.phone as string, `Floor King: ${line} ${url}`).catch(() => {});
      }
    } catch {
      /* notifications are best-effort */
    }
  });
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
  // Keep the crew in sync + ripple the assignment to every view.
  const { data: cur } = await supabase
    .from("jobs")
    .select("customer_id, assigned_crew_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!cur?.assigned_crew_id) {
    const crewId = await ensureCrewForProfile(supabase, installerId);
    if (crewId)
      await supabase.from("jobs").update({ assigned_crew_id: crewId }).eq("id", jobId);
  }
  // Claiming a job off the board = it's scheduled: advance the pipeline stage and
  // auto-submit to the warehouse, same as the smart-scheduler (bookInstall) path.
  if (cur?.customer_id)
    await advanceToNamedStage(cur.customer_id as string, STAGE_INSTALL_SCHEDULED, jobId);
  await ensureWarehouseSubmitted(jobId);
  revalidateJobEverywhere(jobId, cur?.customer_id as string | null);
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
    await moveToAutoActionStage(job.customer_id as string, "schedule_install", id);

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
  const { data: prevJob } = await supabase
    .from("jobs")
    .select("warehouse_status, customer_id")
    .eq("id", id)
    .maybeSingle();
  await supabase.from("jobs").update({ warehouse_status: status }).eq("id", id);
  const customerId = (prevJob?.customer_id as string | null) ?? null;

  // Intelligent flow: materials received/staged → jump to the install-scheduling stage.
  if (status === "staged" && customerId) {
    await moveToAutoActionStage(customerId, "schedule_install", id);
  }

  // Newly delivered → let the customer know their materials arrived on site (the
  // "delivered" step previously notified no one).
  if (status === "delivered" && prevJob?.warehouse_status !== "delivered" && customerId) {
    const { data: c } = await supabase
      .from("customers")
      .select("full_name, email")
      .eq("id", customerId)
      .maybeSingle();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (c?.email) {
      await sendEmail({
        to: c.email as string,
        subject: "Your materials have been delivered",
        html: emailLayout(
          "Materials delivered ✅",
          `<p>Hi ${(c.full_name as string)?.split(" ")[0] ?? "there"},</p>
           <p>Your flooring materials have been delivered. We'll be in touch to get your installation on the calendar.</p>`,
          { label: "View your project", url: `${siteUrl()}/portal` },
        ),
      });
    }
    await supabase.from("messages").insert({
      customer_id: customerId,
      channel: "client",
      author_id: user?.id ?? null,
      body: "🚚 Your materials have been delivered.",
    });
  }

  revalidatePath("/warehouse");
  revalidatePath(`/jobs/${id}`);
  if (customerId) revalidatePath(`/customers/${customerId}`);
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
  await assertRole(["admin", "office"]);

  const supabase = await createClient();
  // MUST happen before the delete. stock_movements.job_id is ON DELETE SET
  // NULL, and releaseJobReservations derives the amount to give back from
  // exactly those rows — once the job is gone they're orphaned and the
  // reserved quantity is stuck on the product forever with nothing to
  // reconcile against.
  await releaseJobReservations(supabase, [id]);

  /**
   * Everything hanging off this job that Postgres will NOT cascade.
   *
   * Same trap deleting an estimate fell into: these all reference jobs with
   * `on delete set null`, so the row outlives the job with its link quietly
   * blanked — an invoice with no job, purchase orders no one can trace, photos
   * still in the customer's files. Service role so the cleanup can't be
   * half-blocked by row-level security.
   */
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    admin = supabase; // fall back (may leave orphans under RLS)
  }
  const { data: docs } = await admin.from("documents").select("path").eq("job_id", id);
  const paths = (docs ?? []).map((d) => d.path as string).filter(Boolean);
  if (paths.length) {
    try {
      await admin.storage.from("documents").remove(paths);
    } catch {
      // A missing object must not stop the rows from going.
    }
  }
  for (const table of [
    "invoices",         // invoice items + payments cascade from it
    "purchase_orders",  // PO items cascade
    "documents",
    "expenses",
    "bills",
    "orders",
    "stock_movements",
    "stock_rolls",
  ]) {
    await admin.from(table).delete().eq("job_id", id);
  }

  await admin.from("jobs").delete().eq("id", id);

  revalidateJobEverywhere(id, customerId || null);
  // Land back where the delete was pressed. From a customer's job list that's
  // the customer file; from the job page itself, the jobs board.
  if (customerId) redirect(`/customers/${customerId}`);
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
