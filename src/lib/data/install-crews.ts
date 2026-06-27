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
      .select("id, name, kind, phone, email, pay_basis, pay_rate, active, notes")
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
