/** Which screen the installer phone opens inside My Work. */
export const INSTALLER_HUB_TABS = ["today", "jobs", "board", "off"] as const;

export type InstallerHubTab = (typeof INSTALLER_HUB_TABS)[number];

export function installerHubTab(value: string | undefined): InstallerHubTab {
  if (value && (INSTALLER_HUB_TABS as readonly string[]).includes(value)) {
    return value as InstallerHubTab;
  }
  return "today";
}

export type InstallerFocusInput = {
  id: string;
  status: string;
  scheduled_date: string | null;
};

/**
 * The job the phone should put first: today's install, then the next dated
 * job, then one already in progress.
 */
export function installerFocusJob<T extends InstallerFocusInput>(
  jobs: T[],
  today: string,
): T | null {
  const active = jobs.filter((job) => job.status !== "cancelled");
  const open = active.filter((job) => job.status !== "completed");
  const todayJob = open.find((job) => job.scheduled_date === today);
  if (todayJob) return todayJob;
  const upcoming = open
    .filter((job) => job.scheduled_date != null && job.scheduled_date >= today)
    .sort((a, b) => (a.scheduled_date ?? "").localeCompare(b.scheduled_date ?? ""));
  if (upcoming[0]) return upcoming[0];
  const installing = open.find((job) => job.status === "in_progress");
  if (installing) return installing;
  const needsSignoff = active.find((job) => job.status === "completed");
  if (needsSignoff) return needsSignoff;
  return open[0] ?? null;
}
