import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getOrgSettings } from "@/lib/data/org";
import { AppShell } from "@/components/app-shell";
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
  return (
    <AppShell profile={profile} org={org}>
      <LiveSync />
      {children}
    </AppShell>
  );
}
