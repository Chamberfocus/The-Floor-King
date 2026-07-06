import { createClient } from "@/lib/supabase/server";
import {
  OPEN_STAGES,
  type Activity,
  type Customer,
  type LeadStage,
} from "@/lib/types";

/** Strip characters that would break PostgREST's `or` filter grammar. */
function sanitize(term: string) {
  return term.replace(/[,()]/g, " ").trim();
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
        "id, customer_id, status, scheduled_date, scheduled_end, arrival_window, assigned_to",
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
    };
  }
  return out;
}

export async function listCustomers(
  opts: {
    search?: string;
    stage?: LeadStage;
    stages?: LeadStage[];
    assignedTo?: string;
  } = {},
): Promise<Customer[]> {
  const supabase = await createClient();
  let query = supabase
    .from("customers")
    .select("*")
    .order("updated_at", { ascending: false });

  if (opts.stage) query = query.eq("stage", opts.stage);
  if (opts.stages?.length) query = query.in("stage", opts.stages);
  if (opts.assignedTo) query = query.eq("assigned_to", opts.assignedTo);

  const search = opts.search ? sanitize(opts.search) : "";
  if (search) {
    const like = `%${search}%`;
    query = query.or(
      [
        `full_name.ilike.${like}`,
        `company.ilike.${like}`,
        `email.ilike.${like}`,
        `phone.ilike.${like}`,
        `city.ilike.${like}`,
      ].join(","),
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Customer[];
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
