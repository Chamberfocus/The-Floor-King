import { createAdminClient } from "@/lib/supabase/admin";
import { getJobOpenBalance } from "./invoices";
import { getJobPhotos } from "./documents";
import type { JobSatisfaction } from "./jobs";
import type { Job, CustomerDocument } from "@/lib/types";

export interface InstallerJob {
  job: Job & { customer_name: string | null };
  balance: number;
  hasInvoice: boolean;
  collectsBalance: boolean;
  satisfaction: JobSatisfaction | null;
  photos: (CustomerDocument & { url?: string | null })[];
}
export interface InstallerHome {
  jobs: InstallerJob[];
  pay: { earned: number; paid: number; unpaid: number };
  ratings: {
    avg: number;
    count: number;
    recent: { rating: number | null; comments: string | null; signed_at: string; job: string }[];
  };
}

/** Everything an installer needs about their OWN jobs — their world in one place.
 *  Uses the service-role client because crew are blocked from job_labor/invoices
 *  by RLS; we only ever read rows for jobs assigned to this installer. */
export async function getInstallerHome(
  userId: string,
  globalCollects: boolean,
): Promise<InstallerHome> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("jobs")
    .select("*, customer:customers(full_name)")
    .eq("assigned_to", userId)
    .in("status", ["unscheduled", "scheduled", "in_progress", "completed"])
    .order("scheduled_date", { ascending: true });
  const jobsRaw = (data ?? []) as (Job & { customer?: { full_name: string | null } | null })[];
  const jobIds = jobsRaw.map((j) => j.id);

  const pay = { earned: 0, paid: 0, unpaid: 0 };
  if (jobIds.length) {
    const { data: lab } = await admin.from("job_labor").select("amount, paid, job_id").in("job_id", jobIds);
    for (const l of lab ?? []) {
      const a = Number(l.amount) || 0;
      pay.earned += a;
      if (l.paid) pay.paid += a;
      else pay.unpaid += a;
    }
  }

  const ratings: InstallerHome["ratings"] = { avg: 0, count: 0, recent: [] };
  const satByJob = new Map<string, JobSatisfaction>();
  if (jobIds.length) {
    const { data: sat } = await admin
      .from("job_satisfaction")
      .select("id, job_id, rating, comments, signature, signed_name, signed_at")
      .in("job_id", jobIds)
      .order("signed_at", { ascending: false });
    const rows = (sat ?? []) as JobSatisfaction[];
    for (const s of rows) if (!satByJob.has(s.job_id)) satByJob.set(s.job_id, s);
    const rated = rows.filter((s) => s.rating);
    ratings.count = rated.length;
    ratings.avg = rated.length
      ? Math.round((rated.reduce((x, s) => x + (s.rating || 0), 0) / rated.length) * 10) / 10
      : 0;
    ratings.recent = rows.slice(0, 5).map((s) => ({
      rating: s.rating,
      comments: s.comments,
      signed_at: s.signed_at,
      job: jobsRaw.find((j) => j.id === s.job_id)?.title || jobsRaw.find((j) => j.id === s.job_id)?.customer?.full_name || "Job",
    }));
  }

  const jobs: InstallerJob[] = [];
  for (const j of jobsRaw) {
    const bal = await getJobOpenBalance(j.id);
    const photos = await getJobPhotos(j.id);
    jobs.push({
      job: { ...j, customer_name: j.customer?.full_name ?? null },
      balance: bal.balance,
      hasInvoice: bal.hasInvoice,
      collectsBalance: j.installer_collects_balance ?? globalCollects,
      satisfaction: satByJob.get(j.id) ?? null,
      photos,
    });
  }
  return { jobs, pay, ratings };
}
