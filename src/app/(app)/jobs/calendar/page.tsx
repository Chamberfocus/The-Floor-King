import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";

// The read-only week/month "Install Calendar" duplicated the editable Install
// Scheduler grid. Retired to a single scheduling home: installers go to their
// own calendar; everyone else to the Install Scheduler. (Old links still work.)
export default async function InstallCalendarRedirect() {
  const profile = await requireProfile();
  if (profile.role === "crew") redirect("/installer");
  redirect("/install-scheduler");
}
