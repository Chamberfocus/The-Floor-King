import { createClient } from "@/lib/supabase/server";
import { buildChecklist, checklistProgress, type ChecklistStep } from "@/lib/job-checklist";
import { invoiceTotals } from "@/lib/invoice-calc";
import { amountPaid } from "@/lib/data/invoices";
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

/**
 * Every checklist for a customer — one per work order, newest first, plus a
 * pre-job one when there's an estimate but no work order yet.
 */
export async function getCustomerChecklists(
  customerId: string,
): Promise<JobProgress[]> {
  if (!customerId) return [];
  const supabase = await createClient();

  const [{ data: jobs }, { data: ests }, { data: addrs }, { count: activityCount }] =
    await Promise.all([
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
        .eq("customer_id", customerId),
    ]);

  const jobRows = (jobs ?? []) as JobRow[];
  const estRows = (ests ?? []) as { id: string; status: string }[];
  const addrLabel = new Map(
    (addrs ?? []).map((a) => [a.id as string, (a.label as string) || (a.street as string) || "Property"]),
  );
  const hasActivity = (activityCount ?? 0) > 0;

  // The customer's estimate appointment is an account-level fact — booking a
  // measure visit isn't per work order.
  const { count: apptCount } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId);
  const estimateBooked = (apptCount ?? 0) > 0;

  const out: JobProgress[] = [];
  const claimedEstimates = new Set<string>();

  for (const job of jobRows) {
    if (job.estimate_id) claimedEstimates.add(job.estimate_id);
    out.push(
      await buildOne({
        supabase,
        customerId,
        job,
        estimateId: job.estimate_id,
        allEstimates: estRows,
        addrLabel,
        hasActivity,
        estimateBooked,
      }),
    );
  }

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
      supabase.from("activities").select("id", { count: "exact", head: true }).eq("customer_id", customerId),
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
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  customerId: string;
  job: JobRow | null;
  estimateId: string | null;
  allEstimates: { id: string; status: string }[];
  addrLabel: Map<string, string>;
  hasActivity: boolean;
  estimateBooked: boolean;
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
    const [{ data: inv }, { count: poCount }, { data: sat }] = await Promise.all([
      supabase.from("invoices").select("*, items:invoice_items(*), payments(*)").eq("job_id", job.id),
      supabase
        .from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .eq("job_id", job.id)
        .in("status", ["ordered", "received", "closed"]),
      supabase.from("job_satisfaction").select("id").eq("job_id", job.id).maybeSingle(),
    ]);
    invoices = (inv ?? []) as unknown as Invoice[];
    issuedPos = poCount ?? 0;
    satisfaction = !!sat;
    // POs raised straight off the estimate, before the job existed, count too.
    if (!issuedPos && estimate) {
      const { count } = await supabase
        .from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .eq("estimate_id", estimate.id)
        .in("status", ["ordered", "received", "closed"]);
      issuedPos = count ?? 0;
    }
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
    .map((i) => ({ inv: i, bal: invoiceTotals(i.items ?? [], i.tax_rate, amountPaid(i)).balance }));
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
