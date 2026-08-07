import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { JobForm } from "../../job-form";
import type { Job } from "@/lib/types";

export const metadata: Metadata = { title: "Edit work order" };
export const dynamic = "force-dynamic";

/**
 * Editing a work order.
 *
 * JobForm has existed all along with the right fields on it — title, status,
 * delivery type, the site address, notes — but nothing ever rendered it, so
 * there was no way to correct a work order once it existed. This is that page.
 */
export default async function EditJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["admin", "office", "sales_manager", "scheduler"]);
  const { id } = await params;

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("*, customer:customers(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();

  const cust = job.customer as { full_name?: string } | { full_name?: string }[] | null;
  const customerName = Array.isArray(cust) ? cust[0]?.full_name : cust?.full_name;

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href={`/jobs/${id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to the work order
      </Link>
      <PageHeader
        title="Edit work order"
        description={
          customerName
            ? `${customerName} — changes here show on the crew's copy straight away.`
            : "Changes here show on the crew's copy straight away."
        }
      />
      <JobForm job={job as unknown as Job} />
    </div>
  );
}
