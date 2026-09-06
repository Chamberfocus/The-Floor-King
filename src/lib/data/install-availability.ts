import { createAdminClient } from "@/lib/supabase/admin";
import {
  nextFreeWindow,
  workDaySet,
  installDaysForJob,
  ymd,
  addDaysYmd,
  type DateRange,
} from "@/lib/scheduling";
import { SCHEDULING_DEFAULTS, mergeInstaller } from "@/lib/data/scheduling";
import { loadSchedulingScopeLines } from "@/lib/scheduling-scope";
import { INSTALL_ROLES, type SchedulingSettings } from "@/lib/types";

export interface InstallAvailability {
  /** Expected install days for the job (headline shown to the client). */
  days: number;
  /** Valid START dates (YYYY-MM-DD) over the horizon — dates where SOME installer
   *  has a free run long enough for this job. Everything else is "not available". */
  availableStarts: string[];
  horizonEnd: string;
}

/**
 * Capacity-aware availability for a job, computed with the SAME engine the office
 * scheduler uses (per-installer capacity, work days, and booked ranges via
 * nextFreeWindow). Runs with the service role and returns ONLY availability — no
 * other job's details ever reach the client. Null if the job can't be found.
 *
 * Scope: job_line_items (measured qty) once a job exists — matches office scheduling.
 */
export async function getInstallAvailability(
  jobId: string,
  horizonDays = 60,
): Promise<InstallAvailability | null> {
  const admin = createAdminClient();
  const { data: job } = await admin
    .from("jobs")
    .select("id, option_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;

  const lines = await loadSchedulingScopeLines(
    admin,
    jobId,
    (job.option_id as string | null) ?? null,
  );

  const { data: sRow } = await admin
    .from("scheduling_settings")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  const global = { ...SCHEDULING_DEFAULTS, ...(sRow ?? {}) } as SchedulingSettings;

  const days = installDaysForJob(lines, global).days;
  if (days <= 0) return { days: 0, availableStarts: [], horizonEnd: "" };

  const { data: insts } = await admin
    .from("profiles")
    .select("id")
    .in("role", INSTALL_ROLES as unknown as string[]);
  const ids = (insts ?? []).map((p) => p.id as string);
  if (!ids.length) return { days, availableStarts: [], horizonEnd: "" };

  const { data: ovRows } = await admin
    .from("installer_settings")
    .select("*")
    .in("installer_id", ids);
  const overrides = new Map<string, Record<string, unknown>>();
  for (const r of ovRows ?? []) overrides.set(r.installer_id as string, r as Record<string, unknown>);

  const { data: bookedJobs } = await admin
    .from("jobs")
    .select("assigned_to, scheduled_date, scheduled_end")
    .in("assigned_to", ids)
    .not("scheduled_date", "is", null);
  const booked = new Map<string, DateRange[]>();
  for (const j of bookedJobs ?? []) {
    const who = j.assigned_to as string;
    const start = j.scheduled_date as string;
    const end = (j.scheduled_end as string) || start;
    const arr = booked.get(who) ?? [];
    arr.push({ start, end });
    booked.set(who, arr);
  }

  const perInstaller = ids.map((id) => {
    const s = mergeInstaller(global, overrides.get(id));
    return {
      workDays: workDaySet(s),
      days: installDaysForJob(lines, s).days,
      booked: booked.get(id) ?? [],
    };
  });

  // A date is an available START if SOME installer's earliest free run at/after it
  // begins exactly on it (their nextFreeWindow starts there).
  const from = addDaysYmd(ymd(new Date()), 1); // from tomorrow
  const availableStarts: string[] = [];
  let cursor = from;
  for (let i = 0; i < horizonDays; i++) {
    const D = cursor;
    const ok = perInstaller.some((p) => {
      if (p.days <= 0) return false;
      const win = nextFreeWindow(p.booked, p.workDays, p.days, D);
      return !!win && win.start === D;
    });
    if (ok) availableStarts.push(D);
    cursor = addDaysYmd(cursor, 1);
  }

  return { days, availableStarts, horizonEnd: addDaysYmd(from, horizonDays - 1) };
}

export interface InstallPreference {
  rank: number;
  preferred_date: string;
}

/** The customer's submitted preferred install dates for a job (rank order). */
export async function listInstallPreferences(jobId: string): Promise<InstallPreference[]> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("install_preferences")
      .select("rank, preferred_date")
      .eq("job_id", jobId)
      .order("rank", { ascending: true });
    return (data ?? []).map((r) => ({
      rank: r.rank as number,
      preferred_date: r.preferred_date as string,
    }));
  } catch {
    return []; // table not created yet (pre-migration 0090)
  }
}
