"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";
import { restartFlowForNewWork } from "@/lib/workflow-engine";
import { ensureJobForEstimate } from "@/app/(app)/jobs/actions";
import { formatServiceAddress } from "@/lib/types";
import { defaultJobTitle } from "@/lib/job-label";
import type { UserRole, LeadSource, LeadStage } from "@/lib/types";

/**
 * Starting a second (or fifth) job for a client you already have.
 *
 * The customer file had a "New job" button that made a work order literally
 * titled "Job" with nothing on it, then dropped you on the work order to fill in
 * the blanks — and the roll-up flagged the result as a stray click, safe to
 * delete. Repeat customers are the best work this business gets; starting their
 * next room deserved better than a placeholder.
 *
 * This asks the three things that make a job real — who, what, and where — and
 * can hang the new job off an estimate that already exists, so the scope and
 * costed material come with it instead of being retyped.
 */

const STAFF: UserRole[] = ["admin", "office", "sales_manager", "salesman", "scheduler"];

export interface JobSiteOption {
  id: string;
  label: string;
}

export interface JobEstimateOption {
  id: string;
  label: string;
}

export interface CustomerJobContext {
  addresses: JobSiteOption[];
  /** Work already running on this account. A new job restarts the account's
   *  stage, and the account only holds one — so if there IS other live work,
   *  the form has to say what that costs before you commit to it. */
  liveJobs: { id: string; title: string; status: string }[];
  /** Estimates with no work order behind them yet — the ones worth starting
   *  from. An estimate that already has a job would only make a duplicate. */
  estimates: JobEstimateOption[];
}

/** What the form needs once a customer is picked. Fetched on demand so the
 *  page doesn't have to preload every address of every account up front. */
export async function getCustomerJobContext(
  customerId: string,
): Promise<CustomerJobContext> {
  if (!customerId) return { addresses: [], estimates: [], liveJobs: [] };
  await assertRole(STAFF);
  const supabase = await createClient();

  const [{ data: addrs }, { data: ests }, { data: jobs }] = await Promise.all([
    supabase
      .from("service_addresses")
      .select("id, label, street, city, state, zip")
      .eq("customer_id", customerId),
    supabase
      .from("estimates")
      .select("id, title, status, created_at")
      .eq("customer_id", customerId)
      .neq("status", "declined")
      .order("created_at", { ascending: false }),
    supabase
      .from("jobs")
      .select("id, title, status, estimate_id")
      .eq("customer_id", customerId),
  ]);

  const taken = new Set(
    (jobs ?? []).map((j) => j.estimate_id as string | null).filter(Boolean) as string[],
  );
  const liveJobs = (jobs ?? [])
    .filter((j) => j.status !== "completed" && j.status !== "cancelled")
    .map((j) => ({
      id: j.id as string,
      title: (j.title as string) || "Job",
      status: (j.status as string) || "",
    }));

  return {
    liveJobs,
    addresses: (addrs ?? []).map((a) => ({
      id: a.id as string,
      label:
        (a.label as string) ||
        formatServiceAddress({
          street: a.street as string | null,
          city: a.city as string | null,
          state: a.state as string | null,
          zip: a.zip as string | null,
        }) ||
        "Job site",
    })),
    estimates: (ests ?? [])
      .filter((e) => !taken.has(e.id as string))
      .map((e) => ({
        id: e.id as string,
        label: `${(e.title as string) || "Estimate"} · ${e.status as string}`,
      })),
  };
}

export interface NewCustomerInput {
  full_name: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface NewJobInput {
  /** An existing account. Null when `newCustomer` is supplied instead. */
  customerId: string | null;
  /** Someone not on the books yet — the case "Quick install" used to own. */
  newCustomer: NewCustomerInput | null;
  title: string;
  serviceAddressId: string | null;
  /** A property not on the account yet — saved so the next job can pick it. */
  newSite: {
    label: string;
    street: string;
    city: string;
    state: string;
    zip: string;
  } | null;
  /** Start the job from this estimate — scope, option and costed material come
   *  with it. Null for work that hasn't been quoted. */
  estimateId: string | null;
  /** Put it straight on the calendar. All optional — a job with no date sits on
   *  the board waiting to be scheduled, which is the normal case. */
  scheduledDate: string | null;
  arrivalWindow: string | null;
  installerId: string | null;
  notes: string;
}

export interface NewJobResult {
  error: string | null;
  jobId?: string;
}

export async function createJobForCustomer(
  input: NewJobInput,
): Promise<NewJobResult> {
  const typedTitle = input.title?.trim();
  if (!input.customerId && !input.newCustomer?.full_name?.trim())
    return { error: "Pick the customer, or add their name." };

  const profile = await assertRole(STAFF);
  const supabase = await createClient();

  let customerId = input.customerId?.trim() || null;

  /**
   * Someone new. A work order means the work is sold — you don't raise one for
   * a lead — so they land qualified and won rather than at the top of the
   * pipeline waiting to be chased for a quote that already happened.
   */
  if (!customerId) {
    const nc = input.newCustomer!;
    const { data: created, error: custErr } = await supabase
      .from("customers")
      .insert({
        full_name: nc.full_name.trim(),
        phone: nc.phone?.trim() || null,
        street: nc.street?.trim() || null,
        city: nc.city?.trim() || null,
        state: nc.state?.trim() || null,
        zip: nc.zip?.trim() || null,
        source: "repeat" as LeadSource,
        stage: "won" as LeadStage,
        qualified: true,
        workflow_owner_id: profile.id,
        assigned_to: profile.id,
        created_by: profile.id,
      })
      .select("id")
      .single();
    if (custErr || !created)
      return { error: custErr?.message || "Couldn't add the customer." };
    customerId = created.id as string;
  }

  const { data: cust } = await supabase
    .from("customers")
    .select("id, stage, street, city, state, zip")
    .eq("id", customerId)
    .maybeSingle();
  if (!cust) return { error: "That customer no longer exists." };

  /**
   * A brand-new property, typed here rather than on the customer's file.
   *
   * Requiring the address to exist first is why 32 of 36 live jobs carry a
   * street copied off the account instead of a real job site — the easy path
   * was to skip it. Saved against the customer, so it's a pick next time.
   */
  if (!input.serviceAddressId && input.newSite?.street?.trim()) {
    const { data: created } = await supabase
      .from("service_addresses")
      .insert({
        customer_id: customerId,
        label: input.newSite.label?.trim() || null,
        street: input.newSite.street.trim(),
        city: input.newSite.city?.trim() || null,
        state: input.newSite.state?.trim() || null,
        zip: input.newSite.zip?.trim() || null,
        created_by: profile.id,
      })
      .select("id")
      .single();
    if (created?.id) input = { ...input, serviceAddressId: created.id as string };
  }

  // The site: the chosen job site, else the account's own address.
  let site = {
    street: (cust.street as string | null) ?? null,
    city: (cust.city as string | null) ?? null,
    state: (cust.state as string | null) ?? null,
    zip: (cust.zip as string | null) ?? null,
  };
  if (input.serviceAddressId) {
    const { data: sa } = await supabase
      .from("service_addresses")
      .select("street, city, state, zip")
      .eq("id", input.serviceAddressId)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (sa)
      site = {
        street: (sa.street as string) ?? null,
        city: (sa.city as string) ?? null,
        state: (sa.state as string) ?? null,
        zip: (sa.zip as string) ?? null,
      };
  }

  /**
   * A job is named for WHERE it is.
   *
   * "Flooring for Abington Arms C/O The Finch Group" is indistinguishable from
   * the eleven others on that account; "Unit 814" isn't. A typed title always
   * wins — sometimes the work needs saying ("Home Addition") — but the fallback
   * is the site rather than the customer's name.
   */
  const siteAddrLabel = input.serviceAddressId
    ? ((
        await supabase
          .from("service_addresses")
          .select("label")
          .eq("id", input.serviceAddressId)
          .maybeSingle()
      ).data?.label as string | null) ?? null
    : null;
  const title = defaultJobTitle(
    {
      site_label: siteAddrLabel,
      site_street: site.street,
      site_city: site.city,
    },
    typedTitle || null,
  );
  if (!title) return { error: "Say what the work is, or pick a job site." };

  /**
   * Optional booking — schedule fields must go through schedule_job_install_safe
   * after the job row exists (0178 jobs_schedule_mutation_guard).
   */
  let jobId: string | null = null;
  /** Where the new work already stands, so the flow restarts at the right step
   *  rather than sending an approved quote back to "book the measure". */
  let approvedEstimate = false;

  if (input.estimateId) {
    const { data: est } = await supabase
      .from("estimates")
      .select("status")
      .eq("id", input.estimateId)
      .maybeSingle();
    approvedEstimate = est?.status === "approved";

    // Reuse the one path that knows how to build a job from an estimate —
    // accepted option, scope, and the costed material snapshot. It's idempotent,
    // so a double-click can't produce two work orders for the same quote.
    jobId = await ensureJobForEstimate(input.estimateId, profile.id);
    if (!jobId) return { error: "Couldn't start the job from that estimate." };
    // The typed title and chosen site are the operator's intent — they win over
    // whatever the estimate happened to be called.
    await supabase
      .from("jobs")
      .update({
        title,
        ...(input.notes.trim() ? { notes: input.notes.trim() } : {}),
        ...(input.serviceAddressId
          ? { service_address_id: input.serviceAddressId }
          : {}),
        site_street: site.street,
        site_city: site.city,
        site_state: site.state,
        site_zip: site.zip,
        // Undated installer assign is allowed without RPC.
        ...(input.installerId && !input.scheduledDate
          ? { assigned_to: input.installerId }
          : {}),
      })
      .eq("id", jobId);
  } else {
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        customer_id: customerId,
        title,
        notes: input.notes.trim() || null,
        service_address_id: input.serviceAddressId,
        site_street: site.street,
        site_city: site.city,
        site_state: site.state,
        site_zip: site.zip,
        created_by: profile.id,
        ...(input.installerId && !input.scheduledDate
          ? { assigned_to: input.installerId }
          : {}),
      })
      .select("id")
      .single();
    if (error || !job) return { error: error?.message || "Couldn't create the job." };
    jobId = job.id as string;
  }

  if (input.scheduledDate && jobId) {
    const { data: schedRes, error: schedErr } = await supabase.rpc(
      "schedule_job_install_safe",
      {
        p_job_id: jobId,
        p_scheduled_date: input.scheduledDate,
        p_scheduled_end: null,
        p_assigned_to: input.installerId || null,
        p_assigned_crew_id: null,
        p_arrival_window: input.arrivalWindow || null,
        p_set_arrival_window: Boolean(input.arrivalWindow),
        p_open_for_claim: false,
      },
    );
    if (schedErr) {
      return { error: schedErr.message };
    }
    const body = schedRes as { ok?: boolean; error?: string } | null;
    if (body && body.ok === false) {
      return { error: body.error || "Could not schedule the install." };
    }
  }

  /**
   * A new job restarts the flow.
   *
   * The stage lives on the customer, so a repeat customer's second room used to
   * inherit wherever the first one finished — starting life reported as "Install
   * In Progress" with nothing chasing it. Starting new work puts the account
   * back at the beginning for that work, landing wherever the job actually is:
   * no quote yet → book the measure; quote built → send it; quote approved →
   * take the deposit; already booked onto the calendar → leave it be.
   */
  await restartFlowForNewWork(customerId, {
    hasEstimate: !!input.estimateId,
    estimateApproved: approvedEstimate,
    booked: !!input.scheduledDate,
  });

  revalidatePath("/jobs");
  revalidatePath("/board");
  revalidatePath("/client-status");
  revalidatePath("/dashboard");
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  // Booked or assigned on the way in — it belongs on the crew's list, the
  // warehouse queue and the scheduler straight away, not after a refresh.
  revalidatePath("/installer");
  revalidatePath("/install-scheduler");
  revalidatePath("/warehouse");
  return { error: null, jobId };
}
