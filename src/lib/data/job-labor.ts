import { createClient } from "@/lib/supabase/server";
import type { JobLabor } from "@/lib/types";
import {
  actualInstallerLaborForJob,
  type InstallerBillLike,
} from "@/lib/accounting/installer-labor-source";

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

/**
 * @deprecated F6-P3A: job_labor is legacy/display-only.
 * Use installerLaborActualByJob for financial actuals.
 */
export async function laborCostByJob(
  jobIds: string[],
): Promise<Map<string, number>> {
  return installerLaborActualByJob(jobIds);
}

/** Canonical actual labor (approved + paid installer_bills) per job. */
export async function installerLaborActualByJob(
  jobIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!jobIds.length) return out;
  const supabase = await createClient();
  const { data } = await supabase
    .from("installer_bills")
    .select("id, job_id, status, total, legacy_display_only")
    .in("job_id", jobIds)
    .in("status", ["approved", "paid"]);
  const bills = (data ?? []) as InstallerBillLike[];
  for (const id of jobIds) {
    out.set(id, actualInstallerLaborForJob(bills, id));
  }
  return out;
}

/** Draft committed labor per job (not actual). */
export async function installerLaborCommittedByJob(
  jobIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!jobIds.length) return out;
  const supabase = await createClient();
  const { data } = await supabase
    .from("installer_bills")
    .select("id, job_id, status, total, legacy_display_only")
    .in("job_id", jobIds)
    .eq("status", "draft");
  for (const r of data ?? []) {
    const id = r.job_id as string;
    out.set(id, (out.get(id) ?? 0) + (Number(r.total) || 0));
  }
  return out;
}
