import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CloseoutForm } from "./closeout-form";
import { suggestedActuals, type IssueInput } from "./actions";

export const metadata: Metadata = { title: "Close out the job" };
export const dynamic = "force-dynamic";

export default async function CloseoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["admin", "office", "sales_manager"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, title, status, estimated_material_cost, estimated_labor_cost, closeout_notes, closed_out_at, customer:customers(full_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();

  const [{ data: issues }, { data: people }, { data: suppliers }, suggested] =
    await Promise.all([
      supabase
        .from("job_issues")
        .select("id, code, blame, blame_profile_id, blame_supplier_id, cost_impact, note")
        .eq("job_id", id)
        .order("created_at"),
      supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("role", ["admin", "office", "sales_manager", "salesman", "crew"])
        .eq("active", true)
        .order("full_name"),
      supabase.from("suppliers").select("id, name").eq("active", true).order("name"),
      suggestedActuals(id),
    ]);

  const cust = job.customer as { full_name?: string } | { full_name?: string }[] | null;
  const customerName = Array.isArray(cust) ? cust[0]?.full_name : cust?.full_name;

  const existing: (IssueInput & { id: string })[] = (issues ?? []).map((i) => ({
    id: i.id as string,
    code: i.code as string,
    blame: i.blame as string,
    blameProfileId: (i.blame_profile_id as string | null) ?? null,
    blameSupplierId: (i.blame_supplier_id as string | null) ?? null,
    costImpact: i.cost_impact == null ? "" : String(i.cost_impact),
    note: (i.note as string) ?? "",
  }));

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/jobs/${id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to the work order
      </Link>
      <PageHeader
        title="Close out the job"
        description={
          job.closed_out_at
            ? `${customerName ?? "This job"} — already closed out. Changing anything here replaces what's recorded.`
            : `${customerName ?? "This job"} — what it really cost, and what went wrong.`
        }
      />
      <CloseoutForm
        jobId={id}
        estMaterial={Number(job.estimated_material_cost ?? 0)}
        estLabor={Number(job.estimated_labor_cost ?? 0)}
        suggested={suggested}
        people={(people ?? []).map((p) => ({
          id: p.id as string,
          name: (p.full_name as string) ?? (p.email as string),
        }))}
        suppliers={(suppliers ?? []).map((s) => ({
          id: s.id as string,
          name: s.name as string,
        }))}
        existing={existing}
        existingNotes={(job.closeout_notes as string) ?? ""}
        alreadyClosed={job.closed_out_at != null}
      />
    </div>
  );
}
