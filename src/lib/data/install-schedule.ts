import { getJob, listAssignableUsers } from "@/lib/data/jobs";
import { getProfileNames } from "@/lib/data/customers";
import { getSchedulingSettings, getInstallerSuggestions } from "@/lib/data/scheduling";
import { installDaysForJob } from "@/lib/scheduling";
import { listInstallCrews, getJobCrew } from "@/lib/data/install-crews";
import { parseArrivalWindows } from "@/lib/format";
import { listInstallPreferences } from "@/lib/data/install-availability";
import { INSTALL_ROLES } from "@/lib/types";
import type { InstallScheduleProps } from "@/app/(app)/customers/[id]/install-schedule";

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
  const [job, settings, installCrews, jobCrew, assignable] = await Promise.all([
    getJob(jobId),
    getSchedulingSettings(),
    listInstallCrews({ activeOnly: true }),
    getJobCrew(jobId),
    listAssignableUsers(),
  ]);
  if (!job) return null;

  const lineItems = job.line_items ?? [];
  const est = lineItems.length ? installDaysForJob(lineItems, settings) : null;
  const suggestions =
    est && est.days > 0 ? await getInstallerSuggestions(lineItems, settings) : [];

  const crewUsers = assignable.filter((u) => (INSTALL_ROLES as string[]).includes(u.role));
  const existingCrewNames = new Set(
    installCrews.map((c) => (c.name || "").trim().toLowerCase()),
  );
  const crewOptions = [
    ...installCrews.map((c) => ({
      value: c.id,
      label: `${c.name}${c.kind === "subcontractor" ? " (sub)" : ""}`,
    })),
    ...crewUsers
      .filter((u) => !existingCrewNames.has(u.name.trim().toLowerCase()))
      .map((u) => ({ value: `user:${u.id}`, label: `${u.name} (team installer)` })),
  ];

  const names = job.assigned_to ? await getProfileNames([job.assigned_to]) : {};

  return {
    jobId,
    customerId,
    jobTitle: job.title ?? null,
    schedule: {
      date: job.scheduled_date ?? null,
      endDate: job.scheduled_end ?? null,
      window: job.arrival_window ?? null,
      installerId: job.assigned_to ?? null,
      installerName: job.assigned_to ? (names[job.assigned_to] ?? null) : null,
    },
    installEst: est,
    suggestions,
    installerUsers: crewUsers.map((u) => ({ value: u.id, label: u.name })),
    crewOptions,
    currentCrew: jobCrew,
    arrivalWindows: parseArrivalWindows(settings.arrival_windows),
    preferences: (await listInstallPreferences(jobId)).map((p) => p.preferred_date),
  };
}
