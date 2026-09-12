import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import {
  OPEN_STAGES,
  type Activity,
  type Customer,
  type LeadStage,
} from "@/lib/types";
import { pickCloseoutJob, type CloseoutTarget } from "@/lib/job-flow";
import {
  EMPTY_CUSTOMER_LIST_ACTIVITY,
  indexCustomerListActivity,
  uniqueCustomersById,
  uniqueIds,
  type CustomerListActivity,
  type CustomerListEstimate,
  type CustomerListInvoice,
  type CustomerListJob,
  type CustomerListOrder,
} from "@/lib/customer-list";

export type { CustomerListActivity };

const IN_CHUNK = 80;

/** Strip characters that would break PostgREST's `or` filter grammar. */
function sanitize(term: string) {
  return term.replace(/[,()]/g, " ").trim();
}

function chunkIds(ids: string[], size = IN_CHUNK): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

export interface CustomerRowContext {
  job: {
    id: string;
    date: string | null;
    endDate: string | null;
    window: string | null;
    installerId: string | null;
  } | null;
  estimate: { startsAt: string; salespersonId: string | null } | null;
  /** The job the close-out action targets. Deliberately a SEPARATE pick from
   *  `job` above: that one prefers a schedulable (open) job, while close-out
   *  wants the finished one — the same row can't answer both. */
  closeout: CloseoutTarget | null;
}

/**
 * For the customer LIST quick actions: in TWO batched queries (jobs +
 * appointments across every listed customer) find each customer's schedulable
 * job and soonest estimate appointment. Keeps per-row quick actions cheap — no
 * N+1. Names are resolved by the caller from the team list it already has.
 */
export async function getCustomerRowContexts(
  ids: string[],
): Promise<Record<string, CustomerRowContext>> {
  const out: Record<string, CustomerRowContext> = {};
  if (!ids.length) return out;
  const supabase = await createClient();

  const [{ data: jobRows }, { data: apptRows }] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, customer_id, status, scheduled_date, scheduled_end, arrival_window, assigned_to, closed_out_at",
      )
      .in("customer_id", ids),
    supabase
      .from("appointments")
      .select("customer_id, starts_at, salesperson_id, status, kind, is_block")
      .in("customer_id", ids)
      .eq("status", "scheduled"),
  ]);

  const jobsBy = new Map<string, NonNullable<typeof jobRows>>();
  for (const j of jobRows ?? []) {
    const k = j.customer_id as string;
    const arr = jobsBy.get(k) ?? [];
    arr.push(j);
    jobsBy.set(k, arr);
  }
  const apptsBy = new Map<string, NonNullable<typeof apptRows>>();
  for (const a of apptRows ?? []) {
    if (a.kind === "block" || a.is_block) continue;
    const k = a.customer_id as string;
    const arr = apptsBy.get(k) ?? [];
    arr.push(a);
    apptsBy.set(k, arr);
  }

  const nowIso = new Date().toISOString();
  for (const id of ids) {
    const jobs = jobsBy.get(id) ?? [];
    const open = jobs.filter(
      (j) => j.status !== "cancelled" && j.status !== "completed",
    );
    const jr =
      open.find((j) => j.scheduled_date) ??
      open[0] ??
      jobs.find((j) => j.scheduled_date) ??
      jobs[0] ??
      null;

    const appts = [...(apptsBy.get(id) ?? [])].sort((a, b) =>
      (a.starts_at as string).localeCompare(b.starts_at as string),
    );
    const upcoming = appts.find((a) => (a.starts_at as string) >= nowIso);
    const ap = upcoming ?? appts[appts.length - 1] ?? null;

    out[id] = {
      job: jr
        ? {
            id: jr.id as string,
            date: (jr.scheduled_date as string) ?? null,
            endDate: (jr.scheduled_end as string) ?? null,
            window: (jr.arrival_window as string) ?? null,
            installerId: (jr.assigned_to as string) ?? null,
          }
        : null,
      estimate: ap
        ? {
            startsAt: ap.starts_at as string,
            salespersonId: (ap.salesperson_id as string) ?? null,
          }
        : null,
      closeout: pickCloseoutJob(
        jobs.map((j) => ({
          id: j.id as string,
          status: (j.status as string) ?? null,
          scheduled_date: (j.scheduled_date as string) ?? null,
          closed_out_at: (j.closed_out_at as string) ?? null,
        })),
      ),
    };
  }
  return out;
}

/**
 * Batched, join-free activity for the customer list. Jobs / estimates /
 * invoices / orders are loaded independently and rolled up by customer_id in
 * {@link indexCustomerListActivity} so counts and money cannot fan out.
 */
export async function getCustomerListActivity(
  ids: string[],
): Promise<Record<string, CustomerListActivity>> {
  const unique = uniqueIds(ids);
  const empty: Record<string, CustomerListActivity> = {};
  for (const id of unique) empty[id] = EMPTY_CUSTOMER_LIST_ACTIVITY;
  if (!unique.length) return empty;

  const supabase = await createClient();
  const jobs: CustomerListJob[] = [];
  const estimates: CustomerListEstimate[] = [];
  const invoiceHeaders: Array<{
    id: string;
    customer_id: string;
    job_id: string | null;
    status: string;
    tax_rate: number;
    number: string | null;
    counter_sale: boolean | null;
  }> = [];
  const orders: CustomerListOrder[] = [];

  for (const chunk of chunkIds(unique)) {
    const [jobRows, estRows, invRows, orderRows] = await Promise.all([
      fetchAll<CustomerListJob>((from, to) =>
        supabase
          .from("jobs")
          .select(
            "id, customer_id, status, delivery_type, title, site_street, site_city, site_state, site_zip",
          )
          .in("customer_id", chunk)
          .range(from, to),
      ),
      fetchAll<CustomerListEstimate>((from, to) =>
        supabase
          .from("estimates")
          .select("id, customer_id")
          .in("customer_id", chunk)
          .range(from, to),
      ),
      fetchAll<(typeof invoiceHeaders)[number]>((from, to) =>
        supabase
          .from("invoices")
          .select(
            "id, customer_id, job_id, status, tax_rate, number, counter_sale",
          )
          .in("customer_id", chunk)
          .range(from, to),
      ),
      fetchAll<CustomerListOrder>((from, to) =>
        supabase
          .from("orders")
          .select("id, customer_id, status, job_id")
          .in("customer_id", chunk)
          .range(from, to),
      ).catch(() => [] as CustomerListOrder[]),
    ]);
    jobs.push(...jobRows);
    estimates.push(...estRows);
    invoiceHeaders.push(...invRows);
    orders.push(...orderRows);
  }

  const invoiceIds = invoiceHeaders.map((i) => i.id);
  const itemsBy = new Map<string, { quantity: number; rate: number }[]>();
  const paysBy = new Map<
    string,
    { amount: number; status: string | null }[]
  >();
  const creditsBy = new Map<
    string,
    { amount: number; status: string | null }[]
  >();
  const depositsBy = new Map<string, number>();
  const writeOffsBy = new Map<string, number>();

  for (const chunk of chunkIds(invoiceIds)) {
    if (!chunk.length) continue;
    const [itemRows, payRows, creditRows, depositRows, writeOffRows] =
      await Promise.all([
        fetchAll<{
          invoice_id: string;
          quantity: number | null;
          rate: number | null;
        }>((from, to) =>
          supabase
            .from("invoice_items")
            .select("invoice_id, quantity, rate")
            .in("invoice_id", chunk)
            .range(from, to),
        ),
        fetchAll<{
          invoice_id: string;
          amount: number | null;
          status: string | null;
        }>((from, to) =>
          supabase
            .from("payments")
            .select("invoice_id, amount, status")
            .in("invoice_id", chunk)
            .range(from, to),
        ),
        fetchAll<{
          invoice_id: string;
          amount: number | null;
          status: string | null;
        }>((from, to) =>
          supabase
            .from("credit_applications")
            .select("invoice_id, amount, status")
            .in("invoice_id", chunk)
            .range(from, to),
        ).catch(() => []),
        fetchAll<{ invoice_id: string; amount: number | null; status: string | null }>((from, to) =>
          supabase
            .from("customer_deposit_applications")
            .select("invoice_id, amount, status")
            .in("invoice_id", chunk)
            .range(from, to),
        ).catch(() => []),
        fetchAll<{ invoice_id: string; amount: number | null; status: string | null }>((from, to) =>
          supabase
            .from("invoice_write_offs")
            .select("invoice_id, amount, status")
            .in("invoice_id", chunk)
            .range(from, to),
        ).catch(() => []),
      ]);
    for (const it of itemRows) {
      const arr = itemsBy.get(it.invoice_id) ?? [];
      arr.push({
        quantity: Number(it.quantity) || 0,
        rate: Number(it.rate) || 0,
      });
      itemsBy.set(it.invoice_id, arr);
    }
    for (const p of payRows) {
      const arr = paysBy.get(p.invoice_id) ?? [];
      arr.push({ amount: Number(p.amount) || 0, status: p.status });
      paysBy.set(p.invoice_id, arr);
    }
    for (const c of creditRows) {
      const arr = creditsBy.get(c.invoice_id) ?? [];
      arr.push({ amount: Number(c.amount) || 0, status: c.status });
      creditsBy.set(c.invoice_id, arr);
    }
    for (const d of depositRows) {
      if ((d.status ?? "active") === "void") continue;
      depositsBy.set(
        d.invoice_id,
        (depositsBy.get(d.invoice_id) ?? 0) + (Number(d.amount) || 0),
      );
    }
    for (const w of writeOffRows) {
      if ((w.status ?? "active") === "void") continue;
      writeOffsBy.set(
        w.invoice_id,
        (writeOffsBy.get(w.invoice_id) ?? 0) + (Number(w.amount) || 0),
      );
    }
  }

  const invoices: CustomerListInvoice[] = invoiceHeaders.map((h) => ({
    id: h.id,
    customer_id: h.customer_id,
    job_id: h.job_id,
    status: h.status,
    tax_rate: h.tax_rate,
    number: h.number,
    counter_sale: !!h.counter_sale,
    items: itemsBy.get(h.id) ?? [],
    payments: paysBy.get(h.id) ?? [],
    creditApplications: creditsBy.get(h.id) ?? [],
    appliedDeposits: depositsBy.get(h.id) ?? 0,
    appliedWriteOffs: writeOffsBy.get(h.id) ?? 0,
  }));

  return {
    ...empty,
    ...indexCustomerListActivity(unique, jobs, estimates, invoices, orders),
  };
}

type CustomerListOpts = {
  search?: string;
  stage?: LeadStage;
  stages?: LeadStage[];
  /** Detailed workflow stage id (the 13-stage builder). */
  workflowStageId?: string;
  /** Show only these workflow stage ids (e.g. the "Closed" view). */
  workflowStageIds?: string[];
  /** Workflow stage ids to hide (e.g. "Closed") — keeps null-stage rows. */
  excludeWorkflowStageIds?: string[];
  assignedTo?: string;
  unassignedOnly?: boolean;
  stuckOnly?: boolean;
  /** Only cancelled jobs (the Cancelled view). */
  cancelledOnly?: boolean;
  /** Hide cancelled jobs (keeps the active/closed lists clean). */
  excludeCancelled?: boolean;
};

function applyCustomerListFilters(
  // PostgREST filter builder — keep this untyped so we don't couple to
  // generated Database types that this repo doesn't ship.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  opts: CustomerListOpts,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  let q = query;
  if (opts.cancelledOnly) q = q.not("cancelled_at", "is", null);
  else if (opts.excludeCancelled) q = q.is("cancelled_at", null);

  if (opts.workflowStageId) q = q.eq("workflow_stage_id", opts.workflowStageId);
  if (opts.workflowStageIds?.length)
    q = q.in("workflow_stage_id", opts.workflowStageIds);
  if (opts.excludeWorkflowStageIds?.length)
    q = q.or(
      `workflow_stage_id.is.null,workflow_stage_id.not.in.(${opts.excludeWorkflowStageIds.join(",")})`,
    );
  if (opts.stage) q = q.eq("stage", opts.stage);
  if (opts.stages?.length) q = q.in("stage", opts.stages);
  if (opts.unassignedOnly) q = q.is("assigned_to", null);
  else if (opts.assignedTo) q = q.eq("assigned_to", opts.assignedTo);
  if (opts.stuckOnly)
    q = q
      .not("next_action_due", "is", null)
      .lt("next_action_due", new Date().toISOString());
  return q;
}

/**
 * Customers matching a job title / site / invoice number. Returns customer
 * ids only — never job rows — so the list cannot fan out.
 */
async function customerIdsFromRelatedSearch(
  search: string,
): Promise<string[]> {
  const like = `%${search}%`;
  const supabase = await createClient();
  const [jobs, invoices] = await Promise.all([
    supabase
      .from("jobs")
      .select("customer_id")
      .or(
        [
          `title.ilike.${like}`,
          `site_street.ilike.${like}`,
          `site_city.ilike.${like}`,
          `site_zip.ilike.${like}`,
        ].join(","),
      )
      .limit(400),
    supabase
      .from("invoices")
      .select("customer_id")
      .ilike("number", like)
      .limit(200),
  ]);
  return uniqueIds([
    ...((jobs.data ?? []) as { customer_id: string | null }[]).map(
      (r) => r.customer_id,
    ),
    ...((invoices.data ?? []) as { customer_id: string | null }[]).map(
      (r) => r.customer_id,
    ),
  ]);
}

export async function listCustomers(
  opts: CustomerListOpts = {},
): Promise<Customer[]> {
  const supabase = await createClient();
  const search = opts.search ? sanitize(opts.search) : "";

  const run = async (extraIds?: string[]) => {
    let query = applyCustomerListFilters(
      supabase.from("customers").select("*") as never,
      opts,
    ).order("updated_at", { ascending: false });

    if (extraIds?.length) {
      query = query.in("id", extraIds);
    } else if (search) {
      const like = `%${search}%`;
      query = query.or(
        [
          `full_name.ilike.${like}`,
          `company.ilike.${like}`,
          `email.ilike.${like}`,
          `phone.ilike.${like}`,
          `street.ilike.${like}`,
          `city.ilike.${like}`,
          `zip.ilike.${like}`,
        ].join(","),
      );
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as Customer[];
  };

  const identity = await run();
  // ID-only collapse if PostgREST ever repeated a PK. This is NOT a
  // name/phone/email merge — distinct customer UUIDs always remain separate rows.
  if (!search) return uniqueCustomersById(identity);

  const relatedIds = await customerIdsFromRelatedSearch(search);
  const already = new Set(identity.map((c) => c.id));
  const missing = relatedIds.filter((id) => !already.has(id));
  const related = missing.length ? await run(missing) : [];
  return uniqueCustomersById([...identity, ...related]);
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as Customer) ?? null;
}

export async function listActivities(customerId: string): Promise<Activity[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("activities")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Activity[];
}

/** Map of profile id -> display name, for showing who logged an activity. */
export async function getProfileNames(
  ids: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", unique);
  const map: Record<string, string> = {};
  for (const p of data ?? []) {
    map[p.id as string] = (p.full_name as string) || (p.email as string);
  }
  return map;
}

export async function getPortalUser(
  customerId: string,
): Promise<{ id: string; email: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("customer_id", customerId)
    .limit(1)
    .maybeSingle();
  return data ? { id: data.id as string, email: data.email as string } : null;
}

export interface DashboardCounts {
  openLeads: number;
  quoted: number;
  wonCustomers: number;
}

export async function getDashboardCounts(): Promise<DashboardCounts> {
  const supabase = await createClient();

  const countIn = async (stages: LeadStage[]) => {
    const { count } = await supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .is("cancelled_at", null)
      .in("stage", stages);
    return count ?? 0;
  };

  const [openLeads, quoted, wonCustomers] = await Promise.all([
    countIn(OPEN_STAGES),
    countIn(["quoted"]),
    countIn(["won"]),
  ]);

  return { openLeads, quoted, wonCustomers };
}

export interface QueueItem {
  id: string;
  full_name: string;
  city: string | null;
  next_action_due: string | null;
  stage_name: string | null;
  stage_color: string | null;
  next_action: string | null;
}

/** A user's active leads (assigned to them) with their stage + next action. */
export async function listMyQueue(userId: string): Promise<QueueItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select(
      "id, full_name, city, next_action_due, stage:workflow_stages(name, next_action, color)",
    )
    // A rep's book = clients they permanently own (assigned_to) OR that are
    // currently on their plate (workflow_owner_id) — so passed-down clients
    // stay visible to their salesperson.
    .or(`assigned_to.eq.${userId},workflow_owner_id.eq.${userId}`)
    .not("workflow_stage_id", "is", null)
    .is("cancelled_at", null)
    .order("next_action_due", { ascending: true, nullsFirst: false })
    .limit(15);
  return (data ?? []).map((c) => {
    const s = c.stage as unknown as {
      name: string | null;
      next_action: string | null;
      color: string | null;
    } | null;
    return {
      id: c.id as string,
      full_name: c.full_name as string,
      city: (c.city as string) ?? null,
      next_action_due: (c.next_action_due as string) ?? null,
      stage_name: s?.name ?? null,
      stage_color: s?.color ?? null,
      next_action: s?.next_action ?? null,
    };
  });
}
