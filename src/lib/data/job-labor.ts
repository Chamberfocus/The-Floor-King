import { createClient } from "@/lib/supabase/server";
import type { JobLabor } from "@/lib/types";

export async function listJobLabor(jobId: string): Promise<JobLabor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_labor")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  return (data ?? []) as JobLabor[];
}

export function jobLaborTotal(rows: JobLabor[]): number {
  return rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
}

/** Sum of subcontractor payouts per job, for a set of jobs (one query). */
export async function laborCostByJob(
  jobIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!jobIds.length) return out;
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_labor")
    .select("job_id, amount")
    .in("job_id", jobIds);
  for (const r of data ?? []) {
    const id = r.job_id as string;
    out.set(id, (out.get(id) ?? 0) + (Number(r.amount) || 0));
  }
  return out;
}
