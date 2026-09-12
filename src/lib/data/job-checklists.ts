import { createClient } from "@/lib/supabase/server";
import {
  buildChecklist,
  checklistProgress,
  type ChecklistStep,
  type StepOverride,
} from "@/lib/job-checklist";
import { amountPaid, invoiceAmountDue } from "@/lib/data/invoices";
import { listCreditApplicationsForInvoices } from "@/lib/data/credits";
import type { Invoice } from "@/lib/types";

/**
 * One checklist PER JOB, not one per customer.
 *
 * The customer file used to build a single checklist and pick "the" job for it
 * — the first one that wasn't finished, by creation order. On an account with
 * one job that's invisible. On Abington Arms, which has two open, it picked an
 * empty placeholder and left the real Unit 813 work — scheduled, quoted,
 * $1,628 — with no checklist, no progress and no next step at all.
 *
 * A job is the unit of work. The customer is the account it belongs to.
 */

/**
 * What counts as having ACTUALLY talked to them.
 *
 * `stage_change` and `system` rows are the app narrating itself — moving a lead
 * along the pipeline wrote an activity, which ticked "Talk to the customer" for
 * people nobody had rung. Step one is a claim about a conversation, so only the
 * human channels prove it.
 */
const CONTACT_ACTIVITY_TYPES = ["note", "call", "text", "email"];

export interface JobProgress {
  /** Null when the customer has no work order yet — the pre-job steps still
   *  need somewhere to live (talk to them, measure, build, send, approve). */
  jobId: string | null;
  title: string;
  /** Which property, when the account has more than one. */
  siteLabel: string | null;
  status: string | null;
  scheduledDate: string | null;
  steps: ChecklistStep[];
  done: number;
  total: number;
  pct: number;
  current: ChecklistStep | null;
  /** Nothing has ever been attached to it — no estimate, no invoice, no PO, no
   *  date, no address. A stray "New job" click, and safe to remove from here.
   *  A real job keeps its delete on the job page, behind the full warning. */
  isBlank: boolean;
}

interface JobRow {
  id: string;
  title: string | null;
  status: string | null;
  scheduled_date: string | null;
  estimate_id: string | null;
  service_address_id: string | null;
  warehouse_ready_at: string | null;
  warehouse_submitted_at: string | null;
  closed_out_at: string | null;
  created_at: string;
}

interface OverrideRow {
  job_id: string | null;
  step_key: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

/**
 * The steps a person has decided are handled, ready to look up per job.
 *
 * Returns a lookup rather than a flat map because an account-level override
 * (job_id null — talk to them, book the visit, build, send, approve) applies to
 * every list the account has, while a job's own overrides apply only to it.
 *
 * Silent when `step_overrides` isn't there yet: before the migration is run
 * nothing is overridden, which is exactly the behaviour that came before it.
 */
async function loadStepOverrides(
  supabase: Awaited<ReturnType<typeof createClient>>,
  customerId: string,
): Promise<(jobId: string | null) => Record<string, StepOverride>> {
  const { data } = await supabase
    .from("step_overrides")
    .select("job_id, step_key, reason, created_by, created_at")
    .eq("customer_id", customerId);
  const rows = (data ?? []) as OverrideRow[];
  if (!rows.length) return () => ({});

  // Who overrode it, by name — an unattributed override is just a fudge.
  const ids = [...new Set(rows.map((r) => r.created_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids);
    for (const p of people ?? [])
      names.set(p.id as string, (p.full_name as string) || "");
  }

  return (jobId) => {
    const out: Record<string, StepOverride> = {};
    for (const r of rows) {
      if (r.job_id !== null && r.job_id !== jobId) continue;
      out[r.step_key] = {
        reason: r.reason,
        by: names.get(r.created_by ?? "") || null,
        at: r.created_at,
      };
    }
    return out;
  };
}

/**
 * Every checklist for a customer — one per work order, newest first, plus a
 * pre-job one when there's an estimate but no work order yet.
 */
export async function getCustomerChecklists(
  customerId: string,
): Promise<JobProgress[]> {
  if (!customerId) return [];
  const supabase = await createClient();

  const [
    { data: jobs },
    { data: ests },
    { data: addrs },
    { count: activityCount },
    { count: apptCount },
  ] = await Promise.all([
      supabase
        .from("jobs")
        .select(
          "id, title, status, scheduled_date, estimate_id, service_address_id, warehouse_ready_at, warehouse_submitted_at, closed_out_at, created_at",
        )
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false }),
      supabase
        .from("estimates")
        .select("id, status, created_at")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false }),
      supabase
        .from("service_addresses")
        .select("id, label, street")
        .eq("customer_id", customerId),
      supabase
        .from("activities")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerId)
        .in("type", CONTACT_ACTIVITY_TYPES),
      supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerId),
    ]);

  const jobRows = (jobs ?? []) as JobRow[];
  const estRows = (ests ?? []) as { id: string; status: string }[];
  const addrLabel = new Map(
    (addrs ?? []).map((a) => [a.id as string, (a.label as string) || (a.street as string) || "Property"]),
  );
  const hasActivity = (activityCount ?? 0) > 0;
  // Booking a measure visit is an account-level fact, not a per-work-order one.
  const estimateBooked = (apptCount ?? 0) > 0;

  const claimedEstimates = new Set<string>();
  for (const job of jobRows) if (job.estimate_id) claimedEstimates.add(job.estimate_id);

  const overridesFor = await loadStepOverrides(supabase, customerId);

  // Every job's checklist at once. Built one at a time in a loop this was N+1
  // — each job waiting on the one before it for queries that have nothing to do
  // with each other.
  const out: JobProgress[] = await Promise.all(
    jobRows.map((job) =>
      buildOne({
        supabase,
        customerId,
        job,
        estimateId: job.estimate_id,
        allEstimates: estRows,
        addrLabel,
        hasActivity,
        estimateBooked,
        overrides: overridesFor(job.id),
      }),
    ),
  );

  /**
   * An estimate with no work order behind it is still live work — it's the
   * whole first half of the job. Show it so "build the estimate → send it →
   * get it approved" has somewhere to live before a job exists.
   */
  const orphanEst =
    estRows.find((e) => !claimedEstimates.has(e.id) && e.status !== "declined") ?? null;
  if (orphanEst || !jobRows.length) {
    out.push(
      await buildOne({
        supabase,
        customerId,
        job: null,
        estimateId: orphanEst?.id ?? null,
        allEstimates: estRows,
        addrLabel,
        hasActivity,
        estimateBooked,
        overrides: overridesFor(null),
      }),
    );
  }

  return out;
}

/** One job's checklist, on its own — what the job page renders. */
export async function getJobChecklist(jobId: string): Promise<JobProgress | null> {
  if (!jobId) return null;
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, customer_id, title, status, scheduled_date, estimate_id, service_address_id, warehouse_ready_at, warehouse_submitted_at, closed_out_at, created_at",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;
  const customerId = job.customer_id as string;

  const [{ data: ests }, { data: addrs }, { count: activityCount }, { count: apptCount }] =
    await Promise.all([
      supabase.from("estimates").select("id, status").eq("customer_id", customerId),
      supabase.from("service_addresses").select("id, label, street").eq("customer_id", customerId),
      supabase
        .from("activities")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerId)
        .in("type", CONTACT_ACTIVITY_TYPES),
      supabase.from("appointments").select("id", { count: "exact", head: true }).eq("customer_id", customerId),
    ]);

  return buildOne({
    supabase,
    customerId,
    job: job as unknown as JobRow,
    estimateId: (job.estimate_id as string | null) ?? null,
    allEstimates: (ests ?? []) as { id: string; status: string }[],
    addrLabel: new Map(
      (addrs ?? []).map((a) => [a.id as string, (a.label as string) || (a.street as string) || "Property"]),
    ),
    hasActivity: (activityCount ?? 0) > 0,
    estimateBooked: (apptCount ?? 0) > 0,
    overrides: (await loadStepOverrides(supabase, customerId))(jobId),
  });
}

async function buildOne({
  supabase,
  customerId,
  job,
  estimateId,
  allEstimates,
  addrLabel,
  hasActivity,
  estimateBooked,
  overrides,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  customerId: string;
  job: JobRow | null;
  estimateId: string | null;
  allEstimates: { id: string; status: string }[];
  addrLabel: Map<string, string>;
  hasActivity: boolean;
  estimateBooked: boolean;
  overrides?: Record<string, StepOverride>;
}): Promise<JobProgress> {
  // THIS job's estimate. Falling back to the account's newest live quote only
  // when the job has none — otherwise two jobs would report each other's.
  const own = estimateId ? (allEstimates.find((e) => e.id === estimateId) ?? null) : null;
  const estimate =
    own ??
    (job
      ? null
      : (allEstimates.find((e) => e.status === "sent") ??
        allEstimates.find((e) => e.status === "approved") ??
        allEstimates.find((e) => e.status === "draft") ??
        allEstimates[0] ??
        null));

  // Money and material scoped to THIS job, not to everything the account owes.
  let invoices: Invoice[] = [];
  let issuedPos = 0;
  let satisfaction = false;
  if (job) {
    // POs raised straight off the estimate, before the job existed, count too —
    // fetched alongside rather than after, so it costs no extra round trip.
    const [{ data: inv }, { count: poCount }, { data: sat }, { count: estPo }] =
      await Promise.all([
      supabase.from("invoices").select("*, items:invoice_items(*), payments(*)").eq("job_id", job.id),
      supabase
        .from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .eq("job_id", job.id)
        .in("status", ["ordered", "received", "closed"]),
      supabase.from("job_satisfaction").select("id").eq("job_id", job.id).maybeSingle(),
      estimate
        ? supabase
            .from("purchase_orders")
            .select("id", { count: "exact", head: true })
            .eq("estimate_id", estimate.id)
            .in("status", ["ordered", "received", "closed"])
        : Promise.resolve({ count: 0 }),
    ]);
    const estPoCount = estPo ?? 0;
    invoices = (inv ?? []) as unknown as Invoice[];
    if (invoices.length) {
      const apps = await listCreditApplicationsForInvoices(
        invoices.map((i) => i.id),
        supabase,
      );
      const appsBy = new Map<string, typeof apps>();
      for (const a of apps) {
        const list = appsBy.get(a.invoice_id) ?? [];
        list.push(a);
        appsBy.set(a.invoice_id, list);
      }
      for (const row of invoices) {
        row.creditApplications = appsBy.get(row.id) ?? [];
      }
    }
    issuedPos = poCount ?? 0;
    satisfaction = !!sat;
    issuedPos = issuedPos || estPoCount;
  } else if (estimate) {
    const { count } = await supabase
      .from("purchase_orders")
      .select("id", { count: "exact", head: true })
      .eq("estimate_id", estimate.id)
      .in("status", ["ordered", "received", "closed"]);
    issuedPos = count ?? 0;
  }

  const live = invoices
    .filter((i) => i.status !== "void")
    .map((i) => ({ inv: i, bal: invoiceAmountDue(i) }));
  const outstanding = live.reduce((s, x) => s + Math.max(0, x.bal), 0);

  const steps = buildChecklist({
    customerId,
    estimate: estimate ? { id: estimate.id, status: estimate.status } : null,
    approvedEstimateId:
      own?.status === "approved"
        ? own.id
        : job
          ? null
          : (allEstimates.find((e) => e.status === "approved")?.id ?? null),
    job: job
      ? {
          id: job.id,
          status: job.status ?? "",
          scheduledDate: job.scheduled_date,
          warehouseReadyAt: job.warehouse_ready_at,
          warehouseSubmittedAt: job.warehouse_submitted_at,
          closedOutAt: job.closed_out_at,
        }
      : null,
    invoice: live.length ? { id: live[0].inv.id, balance: live[0].bal } : null,
    depositPaid: invoices.some((i) => amountPaid(i) > 0),
    balanceOutstanding: outstanding,
    hasActivity,
    estimateBooked,
    materialsOrdered: issuedPos > 0,
    satisfactionSigned: satisfaction,
    overrides,
  });

  const { done, total, pct } = checklistProgress(steps);
  const site = job?.service_address_id ? (addrLabel.get(job.service_address_id) ?? null) : null;
  return {
    jobId: job?.id ?? null,
    title: site ?? job?.title ?? (estimate ? "Quote in progress" : "New enquiry"),
    siteLabel: site,
    status: job?.status ?? null,
    scheduledDate: job?.scheduled_date ?? null,
    steps,
    done,
    total,
    pct,
    current: steps.find((s) => s.state === "current") ?? null,
    isBlank:
      !!job &&
      !estimateId &&
      !job.scheduled_date &&
      !job.service_address_id &&
      !job.closed_out_at &&
      !job.warehouse_submitted_at &&
      !invoices.length &&
      issuedPos === 0,
  };
}
