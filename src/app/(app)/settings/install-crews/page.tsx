import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { listInstallCrews, getCrewPayoutTotals } from "@/lib/data/install-crews";
import { InstallCrewsManager } from "./install-crews-manager";

export const metadata: Metadata = { title: "Install Crews" };
export const dynamic = "force-dynamic";

export default async function InstallCrewsPage() {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "office") redirect("/");
  const [crews, payouts] = await Promise.all([
    listInstallCrews(),
    getCrewPayoutTotals(),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/settings"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Install Crews"
        description="The crews you assign jobs to — your subcontractor crews and employee crews. These show up when you assign a crew on a job."
      />
      <InstallCrewsManager initial={crews} payouts={payouts} />
    </div>
  );
}
