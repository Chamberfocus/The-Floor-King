import { getJob, listAssignableUsers } from "@/lib/data/jobs";
import { getProfileNames } from "@/lib/data/customers";
import {
  getSchedulingSettings,
  getInstallerSuggestions,
  loadInstallerOutlook,
  suggestionsFromOutlook,
} from "@/lib/data/scheduling";
import { installDaysForJob } from "@/lib/scheduling";
import { listInstallCrews, getJobCrew } from "@/lib/data/install-crews";
import { parseArrivalWindows } from "@/lib/format";
import { listInstallPreferences } from "@/lib/data/install-availability";
import { listCrewAvailabilityForOffice } from "@/lib/data/crew-availability";
import { INSTALL_ROLES } from "@/lib/types";
import type { EstimateLineItem } from "@/lib/types";
import { isMaterialLine } from "@/lib/job-scope";
import { assessMaterialsReadyForSchedule } from "@/lib/materials-ready";
import { QUEUE_LIST_UNAVAILABLE, logQueueFailure } from "@/lib/ops-scale";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { InstallScheduleProps } from "@/app/(app)/customers/[id]/install-schedule";

/** Compact phone label for disambiguating installers, e.g. 3304286866 → 330-428-6866. */
function fmtPhone(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1")
    return `${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
  return phone?.trim() || null;
}

/**
 * Build everything the smart install scheduler needs for one job — suggested
 * next-available crews, the install-day estimate, crew options and the current
 * booking. Shared by the customer file and the job page so both open the exact
 * same scheduler. Returns null if the job can't be found.
 */
export async function buildInstallScheduleProps(
  jobId: string,
  customerId: string,
): Promise<InstallScheduleProps | null> {
  const [job, settings, installCrews, jobCrew, assignable, crewAvailability] =
    await Promise.all([
      getJob(jobId),
      getSchedulingSettings(),
      listInstallCrews({ activeOnly: true }),
      getJobCrew(jobId),
      listAssignableUsers(),
      listCrewAvailabilityForOffice(),
    ]);
  if (!job) return null;

  const lineItems = job.line_items ?? [];
  const materialsReady = assessMaterialsReadyForSchedule({
    warehouseReadyAt: job.warehouse_ready_at ?? null,
    hasMaterialNeed: lineItems.some((l) => isMaterialLine(l)),
  }).ready;

  const est = lineItems.length ? installDaysForJob(lineItems, settings) : null;
  const suggestions =
    est && est.days > 0 ? await getInstallerSuggestions(lineItems, settings) : [];

  const crewUsers = assignable.filter((u) => (INSTALL_ROLES as string[]).includes(u.role));

  // ONE unified installer list: login installers (assign → assigned_to, so the
  // job shows in their "My Work"), plus subcontractor crews that have no login
  // (value "crew:<id>" → assigned_crew_id). A crew linked to a login installer is
  // NOT listed separately — it shows once, as that installer.
  const installerUsers = [
    ...crewUsers.map((u) => ({
      value: u.id,
      // Phone disambiguates look-alike names (e.g. two "Ron"s).
      label: [u.name, fmtPhone(u.phone)].filter(Boolean).join(" · "),
    })),
    ...installCrews
      .filter((c) => !c.profile_id)
      .map((c) => ({
        value: `crew:${c.id}`,
        label: [c.name, "(sub)", fmtPhone(c.phone)].filter(Boolean).join(" · "),
      })),
  ];

  const names = job.assigned_to ? await getProfileNames([job.assigned_to]) : {};
  // Preselect + name whoever the job is on — a login installer or a sub crew.
  const installerId = job.assigned_to
    ? job.assigned_to
    : job.assigned_crew_id
      ? `crew:${job.assigned_crew_id}`
      : null;
  const installerName = job.assigned_to
    ? (names[job.assigned_to] ?? null)
    : (jobCrew?.name ?? null);

  return {
    jobId,
    customerId,
    jobTitle: job.title ?? null,
    schedule: {
      date: job.scheduled_date ?? null,
      endDate: job.scheduled_end ?? null,
      window: job.arrival_window ?? null,
      installerId,
      installerName,
    },
    installEst: est,
    suggestions,
    installerUsers,
    arrivalWindows: parseArrivalWindows(settings.arrival_windows),
    preferences: (await listInstallPreferences(jobId)).map((p) => p.preferred_date),
    availability: crewAvailability.map((b) => ({
      id: b.id,
      installerId: b.installer_id,
      start_date: b.start_date,
      end_date: b.end_date,
      kind: b.kind,
      is_private: b.is_private,
      label: b.label,
    })),
    materialsReady,
  };
}

/** Scheduling scope only. Rates, costs, and flat amounts stay off this select. */
const SCHEDULER_LINE_COLUMNS =
  "id, position, room, description, line_type, sqft, length_in, width_in, measure_unit, quantity, unit, category, product_id, manufacturer, color, sqft_per_box, roll_width_ft, measurements";

const SCHEDULER_JOB_COLUMNS =
  "id, customer_id, title, scheduled_date, scheduled_end, arrival_window, assigned_to, assigned_crew_id, warehouse_ready_at, option_id";

/**
 * One scheduling payload for every visible "Needs a date" row.
 * Shared settings, crews, and installer bookings are loaded once.
 * Does not call getJob.
 */
export async function buildSchedulerInstallProps(
  jobs: { id: string; customerId: string }[],
): Promise<Map<string, InstallScheduleProps>> {
  const out = new Map<string, InstallScheduleProps>();
  if (!jobs.length) return out;
  const supabase = await createClient();
  const ids = jobs.map((job) => job.id);
  const [settings, installCrews, assignable, crewAvailability, jobRes, lineRes, preferences] =
    await Promise.all([
      getSchedulingSettings(),
      listInstallCrews({ activeOnly: true }),
      listAssignableUsers(),
      listCrewAvailabilityForOffice(),
      supabase.from("jobs").select(SCHEDULER_JOB_COLUMNS).in("id", ids),
      supabase
        .from("job_line_items")
        .select(`job_id, ${SCHEDULER_LINE_COLUMNS}`)
        .in("job_id", ids)
        .order("position", { ascending: true }),
      listPreferencesForJobs(ids),
    ]);
  if (jobRes.error || lineRes.error) {
    logQueueFailure("scheduler_install_props", jobRes.error ?? lineRes.error);
    throw new Error(QUEUE_LIST_UNAVAILABLE);
  }

  const jobRows = (jobRes.data ?? []) as {
    id: string;
    customer_id: string | null;
    title: string | null;
    scheduled_date: string | null;
    scheduled_end: string | null;
    arrival_window: string | null;
    assigned_to: string | null;
    assigned_crew_id: string | null;
    warehouse_ready_at: string | null;
    option_id: string | null;
  }[];
  const linesByJob = new Map<string, EstimateLineItem[]>();
  for (const row of (lineRes.data ?? []) as (EstimateLineItem & { job_id?: string })[]) {
    const jobId = row.job_id;
    if (!jobId) continue;
    const list = linesByJob.get(jobId) ?? [];
    list.push(row);
    linesByJob.set(jobId, list);
  }
  const missingOptions = jobRows
    .filter((job) => !linesByJob.has(job.id) && job.option_id)
    .map((job) => job.option_id as string);
  if (missingOptions.length) {
    const { data: estimateLines } = await supabase
      .from("estimate_line_items")
      .select(`option_id, ${SCHEDULER_LINE_COLUMNS}`)
      .in("option_id", missingOptions)
      .order("position", { ascending: true });
    const byOption = new Map<string, EstimateLineItem[]>();
    for (const row of (estimateLines ?? []) as (EstimateLineItem & { option_id?: string })[]) {
      if (!row.option_id) continue;
      const list = byOption.get(row.option_id) ?? [];
      list.push(row);
      byOption.set(row.option_id, list);
    }
    for (const job of jobRows) {
      if (!linesByJob.has(job.id) && job.option_id) {
        linesByJob.set(job.id, byOption.get(job.option_id) ?? []);
      }
    }
  }

  const names = await getProfileNames(
    jobRows.map((job) => job.assigned_to).filter((id): id is string => !!id),
  );
  const crewById = new Map(installCrews.map((crew) => [crew.id, crew]));
  const crewUsers = assignable.filter((u) => (INSTALL_ROLES as string[]).includes(u.role));
  const installerUsers = [
    ...crewUsers.map((u) => ({
      value: u.id,
      label: [u.name, fmtPhone(u.phone)].filter(Boolean).join(" · "),
    })),
    ...installCrews
      .filter((c) => !c.profile_id)
      .map((c) => ({
        value: `crew:${c.id}`,
        label: [c.name, "(sub)", fmtPhone(c.phone)].filter(Boolean).join(" · "),
      })),
  ];
  const availability = crewAvailability.map((b) => ({
    id: b.id,
    installerId: b.installer_id,
    start_date: b.start_date,
    end_date: b.end_date,
    kind: b.kind,
    is_private: b.is_private,
    label: b.label,
  }));
  const windows = parseArrivalWindows(settings.arrival_windows);
  const needsSuggestions = jobRows.some((job) => {
    const lines = linesByJob.get(job.id) ?? [];
    return lines.length > 0 && installDaysForJob(lines, settings).days > 0;
  });
  const outlook = needsSuggestions ? await loadInstallerOutlook() : null;

  for (const requested of jobs) {
    const job = jobRows.find((row) => row.id === requested.id);
    if (!job) continue;
    const lineItems = linesByJob.get(job.id) ?? [];
    const materialsReady = assessMaterialsReadyForSchedule({
      warehouseReadyAt: job.warehouse_ready_at ?? null,
      hasMaterialNeed: lineItems.some((line) => isMaterialLine(line)),
    }).ready;
    const est = lineItems.length ? installDaysForJob(lineItems, settings) : null;
    const suggestions =
      outlook && est && est.days > 0
        ? suggestionsFromOutlook(outlook, lineItems, settings)
        : [];
    const installerId = job.assigned_to
      ? job.assigned_to
      : job.assigned_crew_id
        ? `crew:${job.assigned_crew_id}`
        : null;
    const installerName = job.assigned_to
      ? (names[job.assigned_to] ?? null)
      : (crewById.get(job.assigned_crew_id ?? "")?.name ?? null);
    out.set(job.id, {
      jobId: job.id,
      customerId: requested.customerId,
      jobTitle: job.title ?? null,
      schedule: {
        date: job.scheduled_date ?? null,
        endDate: job.scheduled_end ?? null,
        window: job.arrival_window ?? null,
        installerId,
        installerName,
      },
      installEst: est,
      suggestions,
      installerUsers,
      arrivalWindows: windows,
      preferences: preferences.get(job.id) ?? [],
      availability,
      materialsReady,
    });
  }
  return out;
}

async function listPreferencesForJobs(jobIds: string[]): Promise<Map<string, string[]>> {
  const prefs = new Map<string, string[]>();
  if (!jobIds.length) return prefs;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("install_preferences")
      .select("job_id, rank, preferred_date")
      .in("job_id", jobIds)
      .order("rank", { ascending: true });
    for (const row of data ?? []) {
      const jobId = row.job_id as string;
      const list = prefs.get(jobId) ?? [];
      list.push(row.preferred_date as string);
      prefs.set(jobId, list);
    }
  } catch {
    return prefs;
  }
  return prefs;
}
