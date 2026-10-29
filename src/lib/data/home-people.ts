/**
 * A few named customers for Home. Each query matches the count on the same
 * queue. A failed read becomes an empty slice so the counts still render.
 * Follow-ups are not narrowed by assignee: the count is not, and row security
 * is what limits a salesperson.
 */
import { createClient } from "@/lib/supabase/server";
import { readQueuePage, orderByIds } from "@/lib/data/queue-rpc";
import { listJobsOnDate } from "@/lib/data/jobs";
import { shopTodayYmd } from "@/lib/job-snapshot";
import { homeEstimateCountArgs, homeTodayScope } from "@/lib/home-command";
import { DEFAULT_ESTIMATE_FOLLOWUP_DAYS } from "@/lib/ops-followup";
import {
  homePersonKinds,
  homePersonName,
  homePersonWhy,
  pickHomePeople,
  type HomePerson,
  type HomePersonKind,
} from "@/lib/home-people";
import type { UserRole } from "@/lib/types";

const SLICE = 4;

type Db = Awaited<ReturnType<typeof createClient>>;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function pendingLeads(db: Db, role: UserRole, userId: string): Promise<HomePerson[]> {
  // Pending leads
  let query = db
    .from("customers")
    .select("id, full_name")
    .eq("lead_acceptance", "pending")
    .is("cancelled_at", null)
    .order("created_at", { ascending: true })
    .limit(SLICE);
  if (role === "salesman") query = query.eq("assigned_to", userId);
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as { id: string; full_name: string | null }[]).map((row) => ({
    id: row.id,
    name: homePersonName(row.full_name, "Unnamed customer"),
    why: homePersonWhy("lead", role),
    href: `/customers/${row.id}`,
  }));
}

async function followUps(db: Db, role: UserRole): Promise<HomePerson[]> {
  // Follow-ups due
  const { data, error } = await db
    .from("customers")
    .select("id, full_name, stage:workflow_stages(next_action)")
    .is("cancelled_at", null)
    .not("next_action_due", "is", null)
    .lt("next_action_due", new Date().toISOString())
    .order("next_action_due", { ascending: true })
    .limit(SLICE);
  if (error || !data) return [];
  return (
    data as {
      id: string;
      full_name: string | null;
      stage: { next_action?: string | null } | { next_action?: string | null }[] | null;
    }[]
  ).map((row) => ({
    id: row.id,
    name: homePersonName(row.full_name, "Unnamed customer"),
    why: homePersonWhy("followup", role, one(row.stage)?.next_action),
    href: `/customers/${row.id}`,
  }));
}

async function declinedLeads(db: Db, role: UserRole): Promise<HomePerson[]> {
  // Declined leads
  const { data, error } = await db
    .from("customers")
    .select("id, full_name")
    .eq("lead_acceptance", "declined")
    .is("cancelled_at", null)
    .order("lead_acceptance_at", { ascending: false, nullsFirst: false })
    .limit(SLICE);
  if (error || !data) return [];
  return (data as { id: string; full_name: string | null }[]).map((row) => ({
    id: row.id,
    name: homePersonName(row.full_name, "Unnamed customer"),
    why: homePersonWhy("decline", role),
    href: `/customers/${row.id}`,
  }));
}

async function sentEstimates(db: Db, role: UserRole, userId: string): Promise<HomePerson[]> {
  const followupBefore = new Date(
    Date.now() - DEFAULT_ESTIMATE_FOLLOWUP_DAYS * 86_400_000,
  ).toISOString();
  const found = await readQueuePage(db, "estimate_queue_page", {
    ...homeEstimateCountArgs(role, userId, followupBefore),
    p_limit: SLICE,
    p_offset: 0,
  });
  if (!found.ids.length) return [];
  const { data, error } = await db
    .from("estimates")
    .select("id, title, customer:customers(full_name)")
    .in("id", found.ids);
  if (error || !data) return [];
  const rows = orderByIds(
    data as {
      id: string;
      title: string | null;
      customer: { full_name?: string | null } | { full_name?: string | null }[] | null;
    }[],
    found.ids,
  );
  return rows.map((row) => {
    const customer = one(row.customer)?.full_name;
    return {
      id: row.id,
      name: homePersonName(customer, homePersonName(row.title, "Estimate")),
      why: homePersonWhy("estimate", role),
      href: `/estimates/${row.id}`,
    };
  });
}

async function installsToday(role: UserRole, userId: string): Promise<HomePerson[]> {
  const listed = await listJobsOnDate({
    date: shopTodayYmd(),
    ...homeTodayScope(role, userId),
  });
  return listed.rows.slice(0, SLICE).map((job) => ({
    id: job.id,
    name: homePersonName(job.customer_name, homePersonName(job.title, "Install")),
    why: homePersonWhy("today", role),
    href: `/jobs/${job.id}`,
  }));
}

async function loadKind(
  db: Db,
  kind: HomePersonKind,
  role: UserRole,
  userId: string,
): Promise<HomePerson[]> {
  try {
    if (kind === "lead") return await pendingLeads(db, role, userId);
    if (kind === "followup") return await followUps(db, role);
    if (kind === "decline") return await declinedLeads(db, role);
    if (kind === "estimate") return await sentEstimates(db, role, userId);
    return await installsToday(role, userId);
  } catch {
    return [];
  }
}

export async function loadHomePeople(args: {
  role: UserRole;
  userId: string;
}): Promise<HomePerson[]> {
  const kinds = homePersonKinds(args.role);
  if (!kinds.length) return [];
  const db = await createClient();
  const buckets = await Promise.all(
    kinds.map((kind) => loadKind(db, kind, args.role, args.userId)),
  );
  return pickHomePeople(buckets);
}
