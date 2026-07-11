import { redirect } from "next/navigation";

// Install crews are now managed on the unified "Team & installers" page.
export default function InstallCrewsPage() {
  redirect("/settings/team");
}
