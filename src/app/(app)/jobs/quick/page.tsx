import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listAssignableUsers } from "@/lib/data/jobs";
import { QuickInstallForm } from "./quick-install-form";

export const metadata: Metadata = { title: "Quick install" };
export const dynamic = "force-dynamic";

export default async function QuickInstallPage() {
  await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id, full_name")
    .order("full_name", { ascending: true })
    .limit(2000);
  const customers = (data ?? []).map((c) => ({
    id: c.id as string,
    full_name: (c.full_name as string) ?? "Unnamed",
  }));
  const installers = (await listAssignableUsers())
    .filter((u) => u.role === "crew")
    .map((u) => ({ id: u.id, name: u.name }));

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/jobs"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to jobs
      </Link>
      <PageHeader
        title="Quick install"
        description="Already sold with materials in hand? Drop it straight onto the schedule and installer board — just the customer and the work. No estimate, no pricing, no invoicing."
      />
      <QuickInstallForm customers={customers} installers={installers} />
    </div>
  );
}
