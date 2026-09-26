/**
 * F2 office tasks / holds / callbacks data access.
 */
import { createClient } from "@/lib/supabase/server";
import { isOpenTaskStatus, isTaskOverdue } from "@/lib/office-task";
import { sanitizeIlikeQuery } from "@/lib/ops-followup";
import {
  WORK_QUEUE_PAGE_SIZE,
  listPageWindow,
  serviceStatusesForView,
  type ServiceQueueView,
  type TaskQueueView,
} from "@/lib/work-queues";

export interface OfficeTaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigned_to: string | null;
  created_by: string | null;
  due_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  customer_id: string | null;
  job_id: string | null;
  estimate_id: string | null;
  source: string;
  source_key: string | null;
  created_at: string;
  updated_at: string;
}

export async function listMyOfficeTasks(userId: string): Promise<{
  overdue: OfficeTaskRow[];
  dueToday: OfficeTaskRow[];
  upcoming: OfficeTaskRow[];
  completed: OfficeTaskRow[];
}> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("office_tasks")
    .select("*")
    .eq("assigned_to", userId)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(100);
  const rows = (data ?? []) as OfficeTaskRow[];
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const overdue: OfficeTaskRow[] = [];
  const dueToday: OfficeTaskRow[] = [];
  const upcoming: OfficeTaskRow[] = [];
  const completed: OfficeTaskRow[] = [];
  for (const t of rows) {
    if (t.status === "completed") {
      completed.push(t);
      continue;
    }
    if (t.status === "cancelled") continue;
    if (isTaskOverdue({ status: t.status, dueAt: t.due_at, now })) {
      overdue.push(t);
      continue;
    }
    if (t.due_at && t.due_at.slice(0, 10) === today) {
      dueToday.push(t);
      continue;
    }
    if (isOpenTaskStatus(t.status)) upcoming.push(t);
  }
  return { overdue, dueToday, upcoming, completed: completed.slice(0, 20) };
}

export async function getActiveJobHold(jobId: string): Promise<{
  id: string;
  reason: string;
  category: string;
  note: string | null;
  placed_at: string;
  placed_by: string | null;
} | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_operational_holds")
    .select("id, reason, category, note, placed_at, placed_by")
    .eq("job_id", jobId)
    .is("released_at", null)
    .order("placed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as {
    id: string;
    reason: string;
    category: string;
    note: string | null;
    placed_at: string;
    placed_by: string | null;
  } | null;
}

export async function listOpenServiceCallbacksForJob(
  jobId: string,
): Promise<{ id: string; status: string; category: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("service_callbacks")
    .select("id, status, category")
    .eq("job_id", jobId)
    .in("status", ["open", "scheduled", "in_progress", "waiting"]);
  return (data ?? []) as { id: string; status: string; category: string }[];
}

export async function listOpenSourceKeys(
  keys: string[],
): Promise<string[]> {
  if (!keys.length) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("office_tasks")
    .select("source_key")
    .in("source_key", keys)
    .in("status", ["open", "in_progress"]);
  return (data ?? [])
    .map((r) => r.source_key as string | null)
    .filter((k): k is string => !!k);
}

export async function listOpenOfficeTasksForCustomer(
  customerId: string,
): Promise<OfficeTaskRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("office_tasks")
    .select("*")
    .eq("customer_id", customerId)
    .in("status", ["open", "in_progress"])
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(20);
  return (data ?? []) as OfficeTaskRow[];
}

export async function listOpenServiceCallbacks(): Promise<
  {
    id: string;
    status: string;
    category: string;
    description: string | null;
    follow_up_at: string | null;
    customer_id: string;
    job_id: string | null;
    customer_name: string | null;
  }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("service_callbacks")
    .select(
      "id, status, category, description, follow_up_at, customer_id, job_id, customer:customers(full_name)",
    )
    .in("status", ["open", "scheduled", "in_progress", "waiting"])
    .order("follow_up_at", { ascending: true, nullsFirst: false })
    .limit(80);
  return ((data ?? []) as unknown as {
    id: string;
    status: string;
    category: string;
    description: string | null;
    follow_up_at: string | null;
    customer_id: string;
    job_id: string | null;
    customer?:
      | { full_name: string | null }
      | { full_name: string | null }[]
      | null;
  }[]).map((r) => {
    const customer = Array.isArray(r.customer) ? r.customer[0] ?? null : r.customer;
    return {
      id: r.id,
      status: r.status,
      category: r.category,
      description: r.description,
      follow_up_at: r.follow_up_at,
      customer_id: r.customer_id,
      job_id: r.job_id,
      customer_name: customer?.full_name ?? null,
    };
  });
}

export interface ServiceQueueRow {
  id: string;
  status: string;
  category: string;
  description: string | null;
  follow_up_at: string | null;
  customer_id: string;
  job_id: string | null;
  customer_name: string | null;
  place: string | null;
}

const SERVICE_COLUMNS =
  "id, status, category, description, follow_up_at, customer_id, job_id, customer:customers(full_name, street, city), job:jobs(title, site_street, site_city)";

function shapeServiceRows(data: unknown): ServiceQueueRow[] {
  return ((data ?? []) as {
    id: string;
    status: string;
    category: string;
    description: string | null;
    follow_up_at: string | null;
    customer_id: string;
    job_id: string | null;
    customer?:
      | { full_name?: string | null; street?: string | null; city?: string | null }
      | { full_name?: string | null; street?: string | null; city?: string | null }[]
      | null;
    job?:
      | { title?: string | null; site_street?: string | null; site_city?: string | null }
      | { title?: string | null; site_street?: string | null; site_city?: string | null }[]
      | null;
  }[]).map((row) => {
    const customer = Array.isArray(row.customer) ? row.customer[0] : row.customer;
    const job = Array.isArray(row.job) ? row.job[0] : row.job;
    const place = [job?.site_street, job?.site_city, customer?.street, customer?.city]
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index)
      .join(", ");
    return {
      id: row.id,
      status: row.status,
      category: row.category,
      description: row.description,
      follow_up_at: row.follow_up_at,
      customer_id: row.customer_id,
      job_id: row.job_id,
      customer_name: customer?.full_name ?? job?.title ?? null,
      place: place || null,
    };
  });
}

export async function listServiceQueue(args: {
  view: ServiceQueueView;
  search?: string;
  page?: number;
}): Promise<{ rows: ServiceQueueRow[]; total: number; page: number; pageSize: number; capped: boolean }> {
  const pageSize = WORK_QUEUE_PAGE_SIZE;
  const supabase = await createClient();
  const statuses = serviceStatusesForView(args.view);
  const safe = sanitizeIlikeQuery(args.search ?? "");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyStatus = (query: any) => (statuses ? query.in("status", statuses) : query);

  if (safe.length < 2) {
    const counted = await applyStatus(
      supabase.from("service_callbacks").select("id", { count: "exact", head: true }),
    );
    const total = (counted.count as number | null) ?? 0;
    const window = listPageWindow(args.page ?? 1, pageSize, total);
    const { data } = await applyStatus(
      supabase
        .from("service_callbacks")
        .select(SERVICE_COLUMNS)
        .order("follow_up_at", { ascending: true, nullsFirst: false }),
    ).range(window.from, Math.max(window.from, window.to - 1));
    return { rows: shapeServiceRows(data), total, page: window.page, pageSize, capped: false };
  }

  const like = `%${safe}%`;
  const cap = 200;
  const [{ data: customers }, { data: jobs }] = await Promise.all([
    supabase
      .from("customers")
      .select("id")
      .or(`full_name.ilike.${like},street.ilike.${like},city.ilike.${like}`)
      .limit(80),
    supabase
      .from("jobs")
      .select("id")
      .or(`title.ilike.${like},site_street.ilike.${like},site_city.ilike.${like}`)
      .limit(80),
  ]);
  const customerIds = (customers ?? []).map((row) => row.id as string);
  const jobIds = (jobs ?? []).map((row) => row.id as string);
  const [byText, byCustomer, byJob] = await Promise.all([
    applyStatus(
      supabase
        .from("service_callbacks")
        .select(SERVICE_COLUMNS)
        .order("follow_up_at", { ascending: true, nullsFirst: false }),
    )
      .ilike("description", like)
      .limit(cap),
    customerIds.length
      ? applyStatus(
          supabase
            .from("service_callbacks")
            .select(SERVICE_COLUMNS)
            .order("follow_up_at", { ascending: true, nullsFirst: false }),
        )
          .in("customer_id", customerIds)
          .limit(cap)
      : Promise.resolve({ data: [] }),
    jobIds.length
      ? applyStatus(
          supabase
            .from("service_callbacks")
            .select(SERVICE_COLUMNS)
            .order("follow_up_at", { ascending: true, nullsFirst: false }),
        )
          .in("job_id", jobIds)
          .limit(cap)
      : Promise.resolve({ data: [] }),
  ]);
  const seen = new Map<string, ServiceQueueRow>();
  for (const row of [
    ...shapeServiceRows(byText.data),
    ...shapeServiceRows(byCustomer.data),
    ...shapeServiceRows(byJob.data),
  ]) {
    seen.set(row.id, row);
  }
  const matched = [...seen.values()];
  const window = listPageWindow(args.page ?? 1, pageSize, matched.length);
  return {
    rows: matched.slice(window.from, window.to),
    total: matched.length,
    page: window.page,
    pageSize,
    capped:
      (byText.data?.length ?? 0) >= cap ||
      (byCustomer.data?.length ?? 0) >= cap ||
      (byJob.data?.length ?? 0) >= cap ||
      (customers?.length ?? 0) >= 80 ||
      (jobs?.length ?? 0) >= 80,
  };
}

const TASK_COLUMNS =
  "id, title, description, status, priority, assigned_to, created_by, due_at, completed_at, completed_by, customer_id, job_id, estimate_id, source, source_key, created_at, updated_at, customer:customers(full_name)";

function shapeTaskRows(data: unknown): (OfficeTaskRow & { customer_name: string | null })[] {
  return ((data ?? []) as (OfficeTaskRow & {
    customer?: { full_name?: string | null } | { full_name?: string | null }[] | null;
  })[]).map((row) => {
    const customer = Array.isArray(row.customer) ? row.customer[0] : row.customer;
    return { ...row, customer_name: customer?.full_name ?? null };
  });
}

export async function listTaskQueue(args: {
  view: TaskQueueView;
  search?: string;
  page?: number;
  userId: string;
  seeAll: boolean;
}): Promise<{
  rows: (OfficeTaskRow & { customer_name: string | null })[];
  total: number;
  page: number;
  pageSize: number;
  capped: boolean;
}> {
  const pageSize = WORK_QUEUE_PAGE_SIZE;
  const supabase = await createClient();
  const safe = sanitizeIlikeQuery(args.search ?? "");
  const nowIso = new Date().toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apply = (query: any) => {
    let next = query;
    if (!args.seeAll || args.view === "mine") next = next.eq("assigned_to", args.userId);
    if (args.view === "completed") next = next.eq("status", "completed");
    else if (args.view === "overdue") {
      next = next.in("status", ["open", "in_progress"]).lt("due_at", nowIso);
    } else next = next.in("status", ["open", "in_progress"]);
    return next;
  };

  if (safe.length < 2) {
    const counted = await apply(
      supabase.from("office_tasks").select("id", { count: "exact", head: true }),
    );
    const total = (counted.count as number | null) ?? 0;
    const window = listPageWindow(args.page ?? 1, pageSize, total);
    const { data } = await apply(
      supabase
        .from("office_tasks")
        .select(TASK_COLUMNS)
        .order("due_at", { ascending: true, nullsFirst: false }),
    ).range(window.from, Math.max(window.from, window.to - 1));
    return { rows: shapeTaskRows(data), total, page: window.page, pageSize, capped: false };
  }

  const like = `%${safe}%`;
  const cap = 200;
  const [{ data: customers }, assigneeLookup] = await Promise.all([
    supabase.from("customers").select("id").ilike("full_name", like).limit(40),
    args.seeAll
      ? supabase.from("profiles").select("id").ilike("full_name", like).limit(20)
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);
  const customerIds = (customers ?? []).map((row) => row.id as string);
  const assigneeIds = (assigneeLookup.data ?? []).map((row) => row.id as string);
  const [byText, byCustomer, byAssignee] = await Promise.all([
    apply(
      supabase
        .from("office_tasks")
        .select(TASK_COLUMNS)
        .order("due_at", { ascending: true, nullsFirst: false }),
    )
      .or(`title.ilike.${like},description.ilike.${like}`)
      .limit(cap),
    customerIds.length
      ? apply(
          supabase
            .from("office_tasks")
            .select(TASK_COLUMNS)
            .order("due_at", { ascending: true, nullsFirst: false }),
        )
          .in("customer_id", customerIds)
          .limit(cap)
      : Promise.resolve({ data: [] }),
    args.seeAll && assigneeIds.length
      ? apply(
          supabase
            .from("office_tasks")
            .select(TASK_COLUMNS)
            .order("due_at", { ascending: true, nullsFirst: false }),
        )
          .in("assigned_to", assigneeIds)
          .limit(cap)
      : Promise.resolve({ data: [] }),
  ]);
  const seen = new Map<string, OfficeTaskRow & { customer_name: string | null }>();
  for (const row of [
    ...shapeTaskRows(byText.data),
    ...shapeTaskRows(byCustomer.data),
    ...shapeTaskRows(byAssignee.data),
  ]) {
    if (args.view === "overdue" && !isTaskOverdue({ status: row.status, dueAt: row.due_at })) continue;
    seen.set(row.id, row);
  }
  const matched = [...seen.values()];
  const window = listPageWindow(args.page ?? 1, pageSize, matched.length);
  return {
    rows: matched.slice(window.from, window.to),
    total: matched.length,
    page: window.page,
    pageSize,
    capped:
      (byText.data?.length ?? 0) >= cap ||
      (byCustomer.data?.length ?? 0) >= cap ||
      (byAssignee.data?.length ?? 0) >= cap ||
      (customers?.length ?? 0) >= 40,
  };
}
