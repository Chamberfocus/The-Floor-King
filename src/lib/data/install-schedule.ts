import { getJob, listAssignableUsers } from "@/lib/data/jobs";
import { getProfileNames } from "@/lib/data/customers";
import { getSchedulingSettings, getInstallerSuggestions } from "@/lib/data/scheduling";
import { installDaysForJob } from "@/lib/scheduling";
import { listInstallCrews, getJobCrew } from "@/lib/data/install-crews";
import { parseArrivalWindows } from "@/lib/format";
import { listInstallPreferences } from "@/lib/data/install-availability";
import { listCrewAvailabilityForOffice } from "@/lib/data/crew-availability";
import { INSTALL_ROLES } from "@/lib/types";
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
  };
}
