import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobMaterialType, type MaterialType } from "@/lib/job-scope";
import type {
  Customer,
  EstimateLineItem,
  Job,
  JobApplication,
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
  phone: string | null;
}

export interface JobSatisfaction {
  id: string;
  job_id: string;
  rating: number | null;
  comments: string | null;
  signature: string | null;
  signed_name: string | null;
  signed_at: string;
}

/** The latest customer satisfaction sign-off for a job (or null). */
export async function getJobSatisfaction(jobId: string): Promise<JobSatisfaction | null> {
  if (!jobId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_satisfaction")
    .select("id, job_id, rating, comments, signature, signed_name, signed_at")
    .eq("job_id", jobId)
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as JobSatisfaction | null) ?? null;
}

export async function listAssignableUsers(): Promise<AssignableUser[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, phone")
    .in("role", ["admin", "office", "crew"])
    .order("full_name", { ascending: true });
  const rows = (data ?? []) as {
    id: string;
    full_name: string | null;
    email: string;
    role: string;
    phone: string | null;
  }[];
  return rows.map((p) => ({
    id: p.id,
    name: p.full_name || p.email,
    role: p.role,
    phone: p.phone ?? null,
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

export interface OpenJobRow extends JobListRow {
  /** carpet | hard | both | null — derived from the job's line items. */
  materialType: MaterialType;
}

/**
 * Jobs on the board. When a non-staff viewer is passed, only jobs targeted to
 * everyone (no board_installer_ids) or to THEM are returned — so a post can be
 * aimed at specific installers. Each row is tagged carpet / hard / both.
 */
export async function listOpenJobs(
  viewer?: { id: string; isStaff: boolean },
): Promise<OpenJobRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("*, customer:customers(full_name)")
    .eq("open_for_claim", true)
    .order("created_at", { ascending: false });
  let rows = (data ?? []) as (Job & {
    customer?: { full_name: string | null } | null;
    board_installer_ids?: string[] | null;
  })[];

  // Targeting: a crew viewer only sees untargeted jobs, or ones aimed at them.
  if (viewer && !viewer.isStaff) {
    rows = rows.filter((r) => {
      const t = r.board_installer_ids;
      return !t || t.length === 0 || t.includes(viewer.id);
    });
  }

  // Material type from the line items (categories) — read with the service role
  // so an installer, whose RLS can't reach estimate lines, still sees the type.
  const optionIds = [...new Set(rows.map((r) => r.option_id).filter(Boolean) as string[])];
  const typeByOption = new Map<string, MaterialType>();
  if (optionIds.length) {
    try {
      const admin = createAdminClient();
      const { data: lines } = await admin
        .from("estimate_line_items")
        .select("option_id, category")
        .in("option_id", optionIds);
      const byOpt = new Map<string, { category: string | null }[]>();
      for (const l of lines ?? []) {
        const arr = byOpt.get(l.option_id as string) ?? [];
        arr.push({ category: (l.category as string) ?? null });
        byOpt.set(l.option_id as string, arr);
      }
      for (const [oid, items] of byOpt) typeByOption.set(oid, jobMaterialType(items));
    } catch {
      /* leave material type null if unreadable */
    }
  }

  return rows.map((r) => ({
    ...r,
    customer_name: r.customer?.full_name ?? null,
    materialType: r.option_id ? (typeByOption.get(r.option_id) ?? null) : null,
  }));
}

/** Warehouse-role team members, for assigning who preps a job. */
export async function listWarehouseUsers(): Promise<
  { id: string; name: string }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "warehouse")
    .order("full_name", { ascending: true });
  return (data ?? []).map((p) => ({
    id: p.id as string,
    name: (p.full_name as string) || (p.email as string) || "Warehouse",
  }));
}

export interface JobApplicant extends JobApplication {
  installer_name: string;
}

export async function getJobApplications(
  jobId: string,
): Promise<JobApplicant[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_applications")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  const apps = (data ?? []) as JobApplication[];
  if (!apps.length) return [];

  const ids = [...new Set(apps.map((a) => a.installer_id))];
  const { data: profs } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", ids);
  const nameById = new Map<string, string>();
  for (const p of profs ?? []) {
    nameById.set(p.id as string, (p.full_name as string) || (p.email as string));
  }
  return apps.map((a) => ({
    ...a,
    installer_name: nameById.get(a.installer_id) ?? "Installer",
  }));
}

export async function getMyApplicationJobIds(): Promise<string[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("job_applications")
    .select("job_id")
    .eq("installer_id", user.id);
  return (data ?? []).map((r) => r.job_id as string);
}

export interface WarehouseMaterial {
  room: string | null;
  description: string;
  sqft: number | null;
  quantity: number | null;
  unit: string | null;
  measure_unit: string | null;
  category: string | null;
  manufacturer: string | null;
  color: string | null;
  // Cut dimensions for roll goods (carpet / sheet vinyl) so the warehouse can
  // cut to size. Total inches.
  length_in: number | null;
  width_in: number | null;
}

export interface WarehouseJob extends JobListRow {
  materials: WarehouseMaterial[];
  crew_name: string | null; // who's doing the install (crew or assigned installer)
  warehouse_assignee_name: string | null; // warehouse person assigned to prep it
  customer_stage_id: string | null; // customer's workflow stage — for the shared flow badge
}

export async function listWarehouseJobs(
  dbArg?: Awaited<ReturnType<typeof createClient>>,
): Promise<WarehouseJob[]> {
  // The warehouse queue must read jobs + crew/installer names + material scope
  // for ALL active jobs. Callers (the warehouse page) verify the viewer's role
  // first and pass the service-role client, since the warehouse role's RLS
  // can't reach products/POs/etc. — same pattern the other warehouse loaders use.
  const supabase = dbArg ?? (await createClient());
  const { data } = await supabase
    .from("jobs")
    .select("*, customer:customers(full_name, workflow_stage_id)")
    .in("status", ["unscheduled", "scheduled", "in_progress"])
    .order("scheduled_date", { ascending: true });
  const jobs = (data ?? []) as (Job & {
    customer?: { full_name: string | null; workflow_stage_id: string | null } | null;
    assigned_to?: string | null;
    assigned_crew_id?: string | null;
    warehouse_assigned_to?: string | null;
  })[];
  const rows: WarehouseJob[] = jobs.map((j) => ({
    ...j,
    customer_name: j.customer?.full_name ?? null,
    materials: [],
    crew_name: null,
    warehouse_assignee_name: null,
    customer_stage_id: j.customer?.workflow_stage_id ?? null,
  }));

  // Resolve who's doing each job so the warehouse can see the installer/crew:
  // prefer the assigned install crew, else the assigned individual installer.
  const crewIds = [
    ...new Set(jobs.map((j) => j.assigned_crew_id).filter(Boolean) as string[]),
  ];
  const installerIds = [
    ...new Set(
      [
        ...jobs.map((j) => j.assigned_to),
        ...jobs.map((j) => j.warehouse_assigned_to),
      ].filter(Boolean) as string[],
    ),
  ];
  const crewName = new Map<string, string>();
  if (crewIds.length) {
    const { data: crews } = await supabase
      .from("install_crews")
      .select("id, name")
      .in("id", crewIds);
    for (const c of crews ?? [])
      crewName.set(c.id as string, (c.name as string) ?? "Crew");
  }
  const installerName = new Map<string, string>();
  if (installerIds.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", installerIds);
    for (const p of profs ?? [])
      installerName.set(
        p.id as string,
        (p.full_name as string) || (p.email as string) || "Installer",
      );
  }
  for (const r of rows) {
    const cid = (r as { assigned_crew_id?: string | null }).assigned_crew_id;
    const iid = (r as { assigned_to?: string | null }).assigned_to;
    const wid = (r as { warehouse_assigned_to?: string | null })
      .warehouse_assigned_to;
    r.crew_name =
      (cid ? crewName.get(cid) : null) ??
      (iid ? installerName.get(iid) : null) ??
      null;
    r.warehouse_assignee_name = wid ? (installerName.get(wid) ?? null) : null;
  }

  const optionIds = rows.map((r) => r.option_id).filter(Boolean) as string[];
  if (optionIds.length) {
    const { data: lineData } = await supabase
      .from("estimate_line_items")
      .select(
        "option_id, room, description, sqft, quantity, unit, measure_unit, category, manufacturer, color, length_in, width_in, line_type, position",
      )
      .in("option_id", optionIds)
      .order("position", { ascending: true });
    const lines = (lineData ?? []) as {
      option_id: string;
      room: string | null;
      description: string;
      sqft: number | null;
      quantity: number | null;
      unit: string | null;
      measure_unit: string | null;
      category: string | null;
      manufacturer: string | null;
      color: string | null;
      length_in: number | null;
      width_in: number | null;
      line_type: string;
    }[];
    const byOption = new Map<string, WarehouseMaterial[]>();
    for (const l of lines) {
      if (l.line_type === "flat") continue;
      const arr = byOption.get(l.option_id) ?? [];
      arr.push({
        room: l.room,
        description: l.description,
        sqft: l.sqft,
        quantity: l.quantity,
        unit: l.unit,
        measure_unit: l.measure_unit,
        category: l.category,
        manufacturer: l.manufacturer,
        color: l.color,
        length_in: l.length_in,
        width_in: l.width_in,
      });
      byOption.set(l.option_id, arr);
    }
    for (const r of rows) {
      if (r.option_id) r.materials = byOption.get(r.option_id) ?? [];
    }
  }
  return rows;
}

export interface ActiveInstallJob {
  id: string;
  title: string | null;
  customer_name: string | null;
  scheduled_date: string | null;
  installer_name: string | null;
  open_for_claim: boolean;
  status: string;
}

/** Scheduled / in-progress installs — for the dashboard "reassign / repost to
 *  board" card when an assigned installer falls through mid-job. */
export async function listActiveInstallJobs(): Promise<ActiveInstallJob[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("id, title, scheduled_date, assigned_to, open_for_claim, status, customer:customers(full_name)")
    .in("status", ["scheduled", "in_progress"])
    .order("scheduled_date", { ascending: true });
  const rows = (data ?? []) as (Job & { customer?: { full_name: string | null } | { full_name: string | null }[] | null })[];
  const ids = [...new Set(rows.map((r) => r.assigned_to).filter(Boolean) as string[])];
  const nameById = new Map<string, string>();
  if (ids.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids);
    for (const p of profs ?? [])
      nameById.set(p.id as string, (p.full_name as string) || (p.email as string) || "Installer");
  }
  return rows.map((r) => {
    const cust = Array.isArray(r.customer) ? r.customer[0] : r.customer;
    return {
      id: r.id,
      title: r.title,
      customer_name: cust?.full_name ?? null,
      scheduled_date: r.scheduled_date,
      installer_name: r.assigned_to ? (nameById.get(r.assigned_to) ?? null) : null,
      open_for_claim: !!r.open_for_claim,
      status: r.status,
    };
  });
}

export async function getActiveJobCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .in("status", ["scheduled", "in_progress"]);
  return count ?? 0;
}
