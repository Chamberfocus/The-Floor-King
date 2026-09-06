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
