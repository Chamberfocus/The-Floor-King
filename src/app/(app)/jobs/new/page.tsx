import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSchedulingSettings, listInstallers } from "@/lib/data/scheduling";
import { parseArrivalWindows } from "@/lib/format";
import { NewJobForm } from "./new-job-form";

export const metadata: Metadata = { title: "New job" };
export const dynamic = "force-dynamic";

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  await requireProfile();
  const preselected = (await searchParams).customer ?? null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id, full_name")
    .is("cancelled_at", null)
    .order("full_name", { ascending: true })
    .limit(2000);
  const customers = (data ?? []).map((c) => ({
    id: c.id as string,
    full_name: (c.full_name as string) ?? "Unnamed",
  }));

  // Booking on the way in was Quick install's job; it lives here now.
  const installers = (await listInstallers()).map((u) => ({ id: u.id, name: u.name }));
  const sched = await getSchedulingSettings();
  const windows = parseArrivalWindows(sched.arrival_windows).map((w) => ({
    value: `${w.start}-${w.end}`,
    label: w.label,
  }));

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href={preselected ? `/customers/${preselected}` : "/jobs"}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {preselected ? "Back to the customer" : "Back to jobs"}
      </Link>
      <PageHeader
        title="New job"
        description="Every new job starts here — a repeat customer's next room, or someone you've never worked for. Hang it off an estimate you've already built, or start it empty and price it later. Book the date now if you already know it."
      />
      <NewJobForm
        preselectedName={
          preselected
            ? (customers.find((c) => c.id === preselected)?.full_name ?? null)
            : null
        }
        customers={customers}
        installers={installers}
        windows={windows}
        preselected={preselected}
      />
    </div>
  );
}
