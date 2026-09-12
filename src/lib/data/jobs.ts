import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { boardMaterialTypeFromScopes, installerCanDoJob, type MaterialType } from "@/lib/job-scope";
import {
  installerAssignmentOrFilter,
  installerSeesJob,
  dedupeJobsById,
} from "@/lib/installer-assignment";
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
  /** So a row can be dialled without opening the job first. Optional because
   *  not every list that reuses this shape loads it. */
  customer_phone?: string | null;
}

/**
 * Excludes pickup orders from the INSTALL views.
 *
 * Approving a customer order raises a job so the warehouse has something to cut
 * and stage against — see approveOrder in orders/actions.ts. It's flagged
 * `delivery_type: "cash_carry"` because nobody installs it: the customer drives
 * over and collects the material. But nothing filtered on that flag, so those
 * orders sat on the Jobs list, the claim board and the pipeline looking like
 * installs that had never been scheduled.
 *
 * The Install Scheduler already excluded them; this brings the rest into line.
 * The WAREHOUSE deliberately keeps them (listWarehouseJobs) — cutting and
 * staging is the entire reason the job exists.
 *
 * Written as an `.or()` so rows with no delivery_type at all still match.
 */
const PICKUP_EXCLUDED = "delivery_type.is.null,delivery_type.neq.cash_carry";

export async function listJobs(
  opts: {
    /** Installer scoping — crew see only what's assigned to them. */
    assignedTo?: string;
    /**
     * "My jobs" for anyone who isn't an installer.
     *
     * Deliberately NOT jobs.assigned_to: that column holds the INSTALLER, so
     * scoping a salesperson by it returns nothing. A job is yours when you're
     * the customer's salesperson, when you own the current workflow step, or
     * when you happen to be the installer too.
     */
    mineFor?: string;
  } = {},
): Promise<JobListRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("jobs")
    .select("*, customer:customers(full_name, phone)")
    // Cash-and-carry is a PICKUP, not an install: the customer collects the
    // material and there is nothing to schedule, assign or send a crew to. The
    // work order only exists so the warehouse can cut and stage it, and it was
    // landing on the Jobs list beside real installs. It lives on Orders.
    .or(PICKUP_EXCLUDED)
    .order("created_at", { ascending: false });
  if (opts.assignedTo) {
    const admin = createAdminClient();
    const { data: crewRows } = await admin
      .from("install_crews")
      .select("id")
      .eq("profile_id", opts.assignedTo)
      .eq("active", true);
    const memberCrewIds = (crewRows ?? []).map((c) => c.id as string);
    const { data } = await admin
      .from("jobs")
      .select("*, customer:customers(full_name, phone)")
      .or(PICKUP_EXCLUDED)
      .or(installerAssignmentOrFilter(opts.assignedTo, memberCrewIds))
      .order("created_at", { ascending: false });
    const rows = dedupeJobsById(
      ((data ?? []) as (Job & {
        customer?: { full_name: string | null; phone: string | null } | null;
      })[]).filter((r) =>
        installerSeesJob({
          assignedTo: r.assigned_to,
          assignedCrewId: r.assigned_crew_id,
          userId: opts.assignedTo!,
          memberCrewIds,
        }),
      ),
    );
    return rows.map((r) => ({
      ...r,
      customer_name: r.customer?.full_name ?? null,
      customer_phone: r.customer?.phone ?? null,
    }));
  }

  if (opts.mineFor) {
    const { data: mine } = await supabase
      .from("customers")
      .select("id")
      .or(`assigned_to.eq.${opts.mineFor},workflow_owner_id.eq.${opts.mineFor}`);
    const ids = (mine ?? []).map((c) => c.id as string);
    // Mine = a job for one of my customers, OR one I'm installing myself.
    query = ids.length
      ? query.or(`customer_id.in.(${ids.join(",")}),assigned_to.eq.${opts.mineFor}`)
      : query.eq("assigned_to", opts.mineFor);
  }

  const { data } = await query;
  const rows = (data ?? []) as (Job & {
    customer?: { full_name: string | null; phone: string | null } | null;
  })[];
  return rows.map((r) => ({
    ...r,
    customer_name: r.customer?.full_name ?? null,
    customer_phone: r.customer?.phone ?? null,
  }));
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

  /**
   * THE WORK ORDER'S OWN SCOPE (`job_line_items`).
   *
   * Seeded when the job is created from an approved estimate (Step 3). Staff
   * edits diverge from the commercial estimate without rewriting it.
   *
   * Falls back to the estimate's lines when a job has no copy yet (legacy jobs
   * before seeding) so the work order never comes up empty.
   */
  const { data: ownLines } = await supabase
    .from("job_line_items")
    .select("*")
    .eq("job_id", job.id)
    .order("position", { ascending: true });
  line_items = (ownLines ?? []) as EstimateLineItem[];

  if (job.option_id) {
    const { data: opt } = await supabase
      .from("estimate_options")
      .select("name")
      .eq("id", job.option_id)
      .maybeSingle();
    option_name = (opt?.name as string) ?? null;
    if (!line_items.length) {
      const { data: lines } = await supabase
        .from("estimate_line_items")
        .select("*")
        .eq("option_id", job.option_id)
        .order("position", { ascending: true });
      line_items = (lines ?? []) as EstimateLineItem[];
    }
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
  /** carpet | hard | both | null — from job_line_items (operational WO). */
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
    .select("*, customer:customers(full_name, phone)")
    .eq("open_for_claim", true)
    // Nothing for a crew to claim on a pickup order.
    .or(PICKUP_EXCLUDED)
    .order("created_at", { ascending: false });
  let rows = (data ?? []) as (Job & {
    customer?: { full_name: string | null; phone: string | null } | null;
    board_installer_ids?: string[] | null;
  })[];

  // Material type from OPERATIONAL job lines (categories) — what the installer
  // is actually being sent to install. Service role so crew RLS can't block it.
  // Computed BEFORE filtering so the skill gate below can use it.
  const typeByJob = new Map<string, MaterialType>();
  const jobIds = rows.map((r) => r.id);
  if (jobIds.length) {
    try {
      const admin = createAdminClient();
      const { data: jobLines } = await admin
        .from("job_line_items")
        .select("job_id, category")
        .in("job_id", jobIds);
      const byJob = new Map<string, { category: string | null }[]>();
      for (const l of jobLines ?? []) {
        const jid = l.job_id as string;
        const arr = byJob.get(jid) ?? [];
        arr.push({ category: (l.category as string) ?? null });
        byJob.set(jid, arr);
      }
      for (const [jid, items] of byJob) {
        typeByJob.set(
          jid,
          boardMaterialTypeFromScopes({ jobLineCategories: items }),
        );
      }
      // Legacy unseeded jobs: fall back to estimate option categories.
      const missing = rows.filter((r) => !byJob.has(r.id) && r.option_id);
      const optionIds = [
        ...new Set(missing.map((r) => r.option_id).filter(Boolean) as string[]),
      ];
      if (optionIds.length) {
        const { data: estLines } = await admin
          .from("estimate_line_items")
          .select("option_id, category")
          .in("option_id", optionIds);
        const byOpt = new Map<string, { category: string | null }[]>();
        for (const l of estLines ?? []) {
          const arr = byOpt.get(l.option_id as string) ?? [];
          arr.push({ category: (l.category as string) ?? null });
          byOpt.set(l.option_id as string, arr);
        }
        for (const r of missing) {
          if (!r.option_id) continue;
          const items = byOpt.get(r.option_id);
          if (items) {
            typeByJob.set(
              r.id,
              boardMaterialTypeFromScopes({
                jobLineCategories: [],
                estimateFallbackCategories: items,
              }),
            );
          }
        }
      }
    } catch {
      /* leave material type null if unreadable */
    }
  }
  const jobType = (r: (typeof rows)[number]): MaterialType =>
    typeByJob.get(r.id) ?? null;

  // A crew viewer sees a posted job when it is TARGETED at them (an explicit
  // office choice always wins), or it is untargeted AND matches their material
  // skills — so a carpet-only installer isn't offered a hard-surface job.
  if (viewer && !viewer.isStaff) {
    let skills: string[] = [];
    try {
      const admin = createAdminClient();
      const { data: crew } = await admin
        .from("install_crews")
        .select("skills")
        .eq("profile_id", viewer.id)
        .maybeSingle();
      skills = ((crew?.skills as string[] | null) ?? []).filter(Boolean);
    } catch {
      /* no crew row / column not migrated → skills empty → sees everything */
    }
    rows = rows.filter((r) => {
      const t = r.board_installer_ids;
      const targeted = Array.isArray(t) && t.length > 0;
      if (targeted) return t.includes(viewer.id); // targeted → only its targets
      return installerCanDoJob(skills, jobType(r)); // untargeted → skill gate
    });
  }

  return rows.map((r) => ({
    ...r,
    customer_name: r.customer?.full_name ?? null,
    customer_phone: r.customer?.phone ?? null,
    materialType: jobType(r),
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

/** Pending claim requests per job (status 'applied') — for the "N want this"
 *  badge on the staff jobs list, so posted jobs with requests stand out. */
export async function claimRequestCounts(): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_applications")
    .select("job_id")
    .eq("status", "applied");
  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    const id = r.job_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
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

export interface WarehouseJob extends JobListRow {
  crew_name: string | null; // who's doing the install (crew or assigned installer)
  warehouse_assignee_name: string | null; // warehouse person assigned to prep it
  customer_stage_id: string | null; // customer's workflow stage — for the shared flow badge
}

/**
 * One job in the WarehouseJob shape (crew/warehouse names resolved) — so the
 * SAME StagingSheetDoc the warehouse renders can be printed for a single job
 * from the customer file, with no status filter and no parallel material shape.
 */
export async function getWarehouseJob(
  jobId: string,
  dbArg?: Awaited<ReturnType<typeof createClient>>,
): Promise<WarehouseJob | null> {
  if (!jobId) return null;
  const supabase = dbArg ?? (await createClient());
  const { data: j } = await supabase
    .from("jobs")
    .select("*, customer:customers(full_name, workflow_stage_id)")
    .eq("id", jobId)
    .maybeSingle();
  if (!j) return null;
  const row = j as Job & {
    customer?: { full_name: string | null; workflow_stage_id: string | null } | null;
    assigned_to?: string | null;
    assigned_crew_id?: string | null;
    warehouse_assigned_to?: string | null;
  };
  const nameOfCrew = async (cid: string | null | undefined) => {
    if (!cid) return null;
    const { data } = await supabase.from("install_crews").select("name").eq("id", cid).maybeSingle();
    return (data?.name as string) ?? null;
  };
  const nameOfUser = async (uid: string | null | undefined) => {
    if (!uid) return null;
    const { data } = await supabase.from("profiles").select("full_name, email").eq("id", uid).maybeSingle();
    return (data?.full_name as string) || (data?.email as string) || null;
  };
  return {
    ...row,
    customer_name: row.customer?.full_name ?? null,
    crew_name: (await nameOfCrew(row.assigned_crew_id)) ?? (await nameOfUser(row.assigned_to)),
    warehouse_assignee_name: await nameOfUser(row.warehouse_assigned_to),
    customer_stage_id: row.customer?.workflow_stage_id ?? null,
  } as WarehouseJob;
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

  // Materials for the warehouse (queue + staging sheet) come from the single
  // sourced list, getJobMaterials — so there's no parallel material shape to
  // drift. The warehouse page loads it per job.
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

/**
 * Every job that still occupies a place in the pipeline.
 *
 * Cancelled jobs are gone; completed ones stay, because "collect the balance"
 * and "close it out" are real work sitting at real stages. Client status and
 * anything else building work units reads this — see src/lib/work-stage.ts.
 */
export async function listOpenJobsForPipeline(): Promise<
  {
    id: string;
    customer_id: string;
    title: string | null;
    status: string | null;
    workflow_stage_id: string | null;
    workflow_owner_id: string | null;
    next_action_due: string | null;
    site_street: string | null;
    site_city: string | null;
  }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, customer_id, title, status, workflow_stage_id, workflow_owner_id, next_action_due, site_street, site_city",
    )
    .neq("status", "cancelled")
    // A pickup order isn't in the install pipeline — it's an order.
    .or(PICKUP_EXCLUDED)
    .order("created_at", { ascending: false });
  // Before migration 0150 the stage columns don't exist and the select fails as
  // a whole. Falling back to no jobs makes every account read as a single
  // pre-job unit — exactly the behaviour that came before — instead of an error.
  if (error) return [];
  return (data ?? []) as {
    id: string;
    customer_id: string;
    title: string | null;
    status: string | null;
    workflow_stage_id: string | null;
    workflow_owner_id: string | null;
    next_action_due: string | null;
    site_street: string | null;
    site_city: string | null;
  }[];
}
