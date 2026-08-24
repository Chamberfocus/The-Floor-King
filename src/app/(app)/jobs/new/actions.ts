"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";
import { advanceFromAutoAction } from "@/lib/workflow-engine";
import { ensureJobForEstimate } from "@/app/(app)/jobs/actions";
import { formatServiceAddress } from "@/lib/types";
import type { UserRole } from "@/lib/types";

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
  /** Estimates with no work order behind them yet — the ones worth starting
   *  from. An estimate that already has a job would only make a duplicate. */
  estimates: JobEstimateOption[];
}

/** What the form needs once a customer is picked. Fetched on demand so the
 *  page doesn't have to preload every address of every account up front. */
export async function getCustomerJobContext(
  customerId: string,
): Promise<CustomerJobContext> {
  if (!customerId) return { addresses: [], estimates: [] };
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
      .select("estimate_id")
      .eq("customer_id", customerId)
      .not("estimate_id", "is", null),
  ]);

  const taken = new Set((jobs ?? []).map((j) => j.estimate_id as string));

  return {
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

export interface NewJobInput {
  customerId: string;
  title: string;
  serviceAddressId: string | null;
  /** Start the job from this estimate — scope, option and costed material come
   *  with it. Null for work that hasn't been quoted. */
  estimateId: string | null;
  notes: string;
}

export interface NewJobResult {
  error: string | null;
  jobId?: string;
}

export async function createJobForCustomer(
  input: NewJobInput,
): Promise<NewJobResult> {
  const customerId = input.customerId?.trim();
  const title = input.title?.trim();
  if (!customerId) return { error: "Pick the customer this job is for." };
  if (!title) return { error: "Say what the work is." };

  const profile = await assertRole(STAFF);
  const supabase = await createClient();

  const { data: cust } = await supabase
    .from("customers")
    .select("id, stage, street, city, state, zip")
    .eq("id", customerId)
    .maybeSingle();
  if (!cust) return { error: "That customer no longer exists." };

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

  let jobId: string | null = null;

  if (input.estimateId) {
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
      })
      .select("id")
      .single();
    if (error || !job) return { error: error?.message || "Couldn't create the job." };
    jobId = job.id as string;
  }

  /**
   * Nudge the pipeline only when the work is actually SOLD.
   *
   * The old button called this unconditionally, which meant creating a job for
   * someone still sitting on "New Lead" teleported them past the quote and the
   * deposit into "Materials & Warehouse" — the account's stage said the money
   * was in when nobody had even sent a price. A job existing is a fact about the
   * work, not proof anyone paid.
   */
  if (cust.stage === "won") {
    await advanceFromAutoAction(customerId, "collect_deposit");
  }

  revalidatePath("/jobs");
  revalidatePath("/board");
  revalidatePath("/client-status");
  revalidatePath("/dashboard");
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  return { error: null, jobId };
}
