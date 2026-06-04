import { requireProfile } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

// Authenticated pages are per-user and read cookies — never pre-render them.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  return <AppShell profile={profile}>{children}</AppShell>;
}
