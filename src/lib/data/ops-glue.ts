/**
 * F2 office tasks / holds / callbacks data access.
 */
import { createClient } from "@/lib/supabase/server";
import { isOpenTaskStatus, isTaskOverdue } from "@/lib/office-task";

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
