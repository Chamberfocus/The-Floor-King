/**
 * Canonical customer-file install target.
 *
 * The schedule strip and "Schedule install" must bind to the SAME job.
 * Never infer from jobs[0] / first array element of a newest-first list.
 */

export interface ScheduleTargetJob {
  id: string;
  status: string | null;
  scheduled_date?: string | null;
  created_at?: string | null;
  title?: string | null;
}

export function isActiveInstallJob(job: ScheduleTargetJob): boolean {
  const s = (job.status ?? "").toLowerCase();
  return s !== "cancelled" && s !== "completed";
}

export function activeInstallJobs<T extends ScheduleTargetJob>(jobs: T[]): T[] {
  return jobs.filter(isActiveInstallJob);
}

/**
 * Active jobs only.
 * Soonest scheduled_date wins (then oldest created_at).
 * If none are dated, the oldest unscheduled active job.
 */
export function resolveCustomerInstallScheduleTarget<T extends ScheduleTargetJob>(
  jobs: T[],
): T | null {
  const active = activeInstallJobs(jobs);
  if (!active.length) return null;

  const dated = active
    .filter((j) => Boolean(j.scheduled_date))
    .sort((a, b) => {
      const byDate = String(a.scheduled_date).localeCompare(String(b.scheduled_date));
      if (byDate !== 0) return byDate;
      return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
    });
  if (dated.length) return dated[0];

  return [...active].sort((a, b) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
  )[0];
}
