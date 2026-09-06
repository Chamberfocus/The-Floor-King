import { createClient } from "@/lib/supabase/server";
import { loadOperationalJobLines } from "@/lib/data/job-operational-lines";
import type {
  EstimateLineItem,
  InstallerBill,
  InstallerBillLine,
} from "@/lib/types";

export interface BillJobContext {
  jobId: string;
  jobTitle: string | null;
  optionId: string | null;
  customerId: string | null;
  customerName: string | null;
  address: string;
  installerName: string | null;
  installerId: string | null;
  estimatedLaborCost: number | null;
  actualLaborCost: number | null;
  laborVariance: number | null;
  /** The job's work-order labor scope (category === 'labor' line items). */
  laborScope: EstimateLineItem[];
}

/** Everything the bill screen needs about the job — real data only. */
export async function getBillJobContext(
  jobId: string,
): Promise<BillJobContext | null> {
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, title, option_id, customer_id, assigned_to, assigned_crew_id, site_street, site_city, site_state, site_zip, estimated_labor_cost, actual_labor_cost, labor_variance",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;

  const [{ data: cust }, laborScope, installerName] = await Promise.all([
    job.customer_id
      ? supabase
          .from("customers")
          .select("full_name")
          .eq("id", job.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    (async () => {
      // Same operational job scope as staff WO / installer mobile (Step 3 D4).
      const scope = await loadOperationalJobLines(supabase, jobId, {
        seedIfEmpty: true,
        optionId: (job.option_id as string | null) ?? null,
      });
      return scope.filter((l) => l.category === "labor");
    })(),
    (async () => {
      if (job.assigned_to) {
        const { data } = await supabase
          .from("profiles")
          .select("full_name, email")
          .eq("id", job.assigned_to)
          .maybeSingle();
        return (data?.full_name as string) || (data?.email as string) || null;
      }
      if (job.assigned_crew_id) {
        const { data } = await supabase
          .from("install_crews")
          .select("name")
          .eq("id", job.assigned_crew_id)
          .maybeSingle();
        return (data?.name as string) ?? null;
      }
      return null;
    })(),
  ]);

  const address = [
    job.site_street,
    [job.site_city, job.site_state].filter(Boolean).join(", "),
    job.site_zip,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    jobId: job.id as string,
    jobTitle: (job.title as string) ?? null,
    optionId: (job.option_id as string) ?? null,
    customerId: (job.customer_id as string) ?? null,
    customerName: (cust?.full_name as string) ?? null,
    address,
    installerName,
    installerId: (job.assigned_to as string) ?? null,
    estimatedLaborCost:
      job.estimated_labor_cost != null ? Number(job.estimated_labor_cost) : null,
    actualLaborCost:
      job.actual_labor_cost != null ? Number(job.actual_labor_cost) : null,
    laborVariance:
      job.labor_variance != null ? Number(job.labor_variance) : null,
    laborScope,
  };
}

/** The current installer bill for a job (the latest), with its lines — or null. */
export async function getInstallerBill(
  jobId: string,
): Promise<{ bill: InstallerBill; lines: InstallerBillLine[] } | null> {
  const supabase = await createClient();
  const { data: bill } = await supabase
    .from("installer_bills")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!bill) return null;
  const { data: lines } = await supabase
    .from("installer_bill_line_items")
    .select("*")
    .eq("bill_id", bill.id)
    .order("position", { ascending: true });
  return {
    bill: bill as InstallerBill,
    lines: (lines ?? []) as InstallerBillLine[],
  };
}
