import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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
        description="Another room, another property, a callback — start the next piece of work for a customer you already have. Hang it off an estimate you've already built, or start it empty and price it later."
      />
      <NewJobForm customers={customers} preselected={preselected} />
    </div>
  );
}
