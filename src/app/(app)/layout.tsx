import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getOrgSettings } from "@/lib/data/org";
import { AppShell, SIDEBAR_COOKIE } from "@/components/app-shell";
import { LiveSync } from "@/components/live-sync";

// Authenticated pages are per-user and read cookies — never pre-render them.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  // Customers use the dedicated portal, not the staff app.
  if (profile.role === "customer") redirect("/portal");
  const org = await getOrgSettings();
  // Read here rather than in the client so a collapsed sidebar renders collapsed
  // on the first paint instead of flashing open.
  const collapsed =
    (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed";
  return (
    <AppShell profile={profile} org={org} defaultCollapsed={collapsed}>
      <LiveSync />
      {children}
    </AppShell>
  );
}
