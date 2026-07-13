import { createClient } from "@/lib/supabase/server";

export interface InstallCrew {
  id: string;
  name: string;
  kind: "subcontractor" | "employee";
  phone: string | null;
  email: string | null;
  pay_basis: string | null;
  pay_rate: number | null;
  active: boolean;
  notes: string | null;
  /** Hard link to the installer's login profile (null = pure subcontractor). */
  profile_id: string | null;
}

/**
 * The install crews you maintain (subcontractor crews + employee crews). Reads
 * are defensive: if the table isn't there yet (migration 0049 not run), return
 * an empty list rather than crashing the page.
 */
export async function listInstallCrews(
  opts: { activeOnly?: boolean } = {},
): Promise<InstallCrew[]> {
  try {
    const supabase = await createClient();
    let q = supabase
      .from("install_crews")
      .select("id, name, kind, phone, email, pay_basis, pay_rate, active, notes, profile_id")
      .order("active", { ascending: false })
      .order("name", { ascending: true });
    if (opts.activeOnly) q = q.eq("active", true);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as InstallCrew[];
  } catch {
    return [];
  }
}

/** The crew currently assigned to a job (or null). Defensive against the
 *  column/table not existing yet. */
export interface CrewPayout {
  paid: number;
  unpaid: number;
  total: number;
  jobs: number;
}

/**
 * What you've paid / still owe each crew, summed across all jobs (only payouts
 * tied to a crew). Defensive: returns {} if the crew_id column isn't there yet.
 */
export async function getCrewPayoutTotals(): Promise<Record<string, CrewPayout>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("job_labor")
      .select("crew_id, amount, paid, job_id")
      .not("crew_id", "is", null)
      .limit(5000);
    if (error || !data) return {};
    const out: Record<string, CrewPayout> = {};
    const jobsByCrew: Record<string, Set<string>> = {};
    for (const r of data as { crew_id: string | null; amount: number; paid: boolean; job_id: string }[]) {
      const cid = r.crew_id;
      if (!cid) continue;
      const amt = Number(r.amount) || 0;
      const e = out[cid] ?? { paid: 0, unpaid: 0, total: 0, jobs: 0 };
      e.total += amt;
      if (r.paid) e.paid += amt;
      else e.unpaid += amt;
      out[cid] = e;
      (jobsByCrew[cid] ??= new Set()).add(r.job_id);
    }
    for (const cid of Object.keys(out)) out[cid].jobs = jobsByCrew[cid].size;
    return out;
  } catch {
    return {};
  }
}

export type JobCrew = Pick<
  InstallCrew,
  "id" | "name" | "kind" | "phone" | "pay_basis" | "pay_rate"
>;

export async function getJobCrew(jobId: string): Promise<JobCrew | null> {
  try {
    const supabase = await createClient();
    const { data: job, error } = await supabase
      .from("jobs")
      .select("assigned_crew_id")
      .eq("id", jobId)
      .maybeSingle();
    if (error || !job?.assigned_crew_id) return null;
    const { data: crew } = await supabase
      .from("install_crews")
      .select("id, name, kind, phone, pay_basis, pay_rate")
      .eq("id", job.assigned_crew_id as string)
      .maybeSingle();
    return (crew as JobCrew | null) ?? null;
  } catch {
    return null;
  }
}
