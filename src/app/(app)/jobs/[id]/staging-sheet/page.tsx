import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getOrgSettings } from "@/lib/data/org";
import { getWarehouseJob } from "@/lib/data/jobs";
import { getJobMaterials } from "@/lib/data/job-materials";
import { StagingSheetDoc } from "@/app/(app)/warehouse/staging-sheet-doc";
import { AutoPrint } from "@/components/auto-print";

export const metadata: Metadata = { title: "Staging sheet" };
export const dynamic = "force-dynamic";

/**
 * Print-ready staging sheet for a single job — the SAME StagingSheetDoc and the
 * SAME getJobMaterials source the warehouse uses, so it can never be a stale or
 * duplicate copy. Reached in one click from the customer file. Staff only.
 */
export default async function JobStagingSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const profile = await requireProfile();
  if (!["admin", "office", "warehouse", "sales_manager"].includes(profile.role)) redirect("/");
  const { id } = await params;
  const noPrint = (await searchParams).print === "0";

  const [org, job, mats] = await Promise.all([
    getOrgSettings(),
    getWarehouseJob(id),
    getJobMaterials(id),
  ]);
  if (!job) notFound();

  return (
    <div className="mx-auto max-w-4xl p-4 print:p-0">
      {noPrint ? null : <AutoPrint />}
      <StagingSheetDoc org={org} job={job} lines={mats.lines} />
    </div>
  );
}
