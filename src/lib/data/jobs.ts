import { createClient } from "@/lib/supabase/server";
import type {
  Customer,
  EstimateLineItem,
  Job,
  JobFile,
  JobFileWithUrl,
} from "@/lib/types";

export interface JobListRow extends Job {
  customer_name: string | null;
}

export async function listJobs(
  opts: { assignedTo?: string } = {},
): Promise<JobListRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("jobs")
    .select("*, customer:customers(full_name)")
    .order("created_at", { ascending: false });
  if (opts.assignedTo) query = query.eq("assigned_to", opts.assignedTo);

  const { data } = await query;
  const rows = (data ?? []) as (Job & {
    customer?: { full_name: string | null } | null;
  })[];
  return rows.map((r) => ({ ...r, customer_name: r.customer?.full_name ?? null }));
}

export async function listJobsForCustomer(
  customerId: string,
): Promise<Job[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Job[];
}

export interface JobDetail extends Job {
  customer: Customer | null;
  line_items: EstimateLineItem[];
  option_name: string | null;
  estimate_title: string | null;
}

export async function getJob(id: string): Promise<JobDetail | null> {
  const supabase = await createClient();
  const { data: jobData } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!jobData) return null;
  const job = jobData as Job;

  const { data: customer } = await supabase
    .from("customers")
    .select("*")
    .eq("id", job.customer_id)
    .maybeSingle();

  let line_items: EstimateLineItem[] = [];
  let option_name: string | null = null;
  let estimate_title: string | null = null;

  if (job.option_id) {
    const { data: opt } = await supabase
      .from("estimate_options")
      .select("name")
      .eq("id", job.option_id)
      .maybeSingle();
    option_name = (opt?.name as string) ?? null;
    const { data: lines } = await supabase
      .from("estimate_line_items")
      .select("*")
      .eq("option_id", job.option_id)
      .order("position", { ascending: true });
    line_items = (lines ?? []) as EstimateLineItem[];
  }
  if (job.estimate_id) {
    const { data: est } = await supabase
      .from("estimates")
      .select("title")
      .eq("id", job.estimate_id)
      .maybeSingle();
    estimate_title = (est?.title as string) ?? null;
  }

  return {
    ...job,
    customer: (customer as Customer) ?? null,
    line_items,
    option_name,
    estimate_title,
  };
}

export interface AssignableUser {
  id: string;
  name: string;
  role: string;
}

export async function listAssignableUsers(): Promise<AssignableUser[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .in("role", ["admin", "office", "crew"])
    .order("full_name", { ascending: true });
  const rows = (data ?? []) as {
    id: string;
    full_name: string | null;
    email: string;
    role: string;
  }[];
  return rows.map((p) => ({
    id: p.id,
    name: p.full_name || p.email,
    role: p.role,
  }));
}

export async function listJobFiles(
  jobId: string,
): Promise<JobFileWithUrl[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_files")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  const files = (data ?? []) as JobFile[];

  const out: JobFileWithUrl[] = [];
  for (const f of files) {
    const { data: signed } = await supabase.storage
      .from("job-files")
      .createSignedUrl(f.path, 3600);
    out.push({ ...f, url: signed?.signedUrl ?? null });
  }
  return out;
}

export async function getActiveJobCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .in("status", ["scheduled", "in_progress"]);
  return count ?? 0;
}
