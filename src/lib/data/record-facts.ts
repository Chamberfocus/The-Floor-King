import { createClient } from "@/lib/supabase/server";
import { isMaterialLine } from "@/lib/job-scope";

/** One bounded material-line read and one bounded callback read for a customer. */
export async function loadCustomerRecordFacts(customerId: string, jobIds: string[]) {
  const supabase = await createClient();
  const materialJobs = new Set<string>();
  if (jobIds.length) {
    const { data } = await supabase
      .from("job_line_items")
      .select("job_id, line_type, category")
      .in("job_id", jobIds)
      .limit(400);
    for (const line of data ?? []) {
      if (isMaterialLine(line as { line_type?: string | null; category?: string | null })) {
        materialJobs.add(line.job_id as string);
      }
    }
  }
  const { data: callbacks } = await supabase
    .from("service_callbacks")
    .select("id, job_id")
    .eq("customer_id", customerId)
    .in("status", ["open", "scheduled", "in_progress", "waiting"])
    .limit(20);
  return {
    materialJobs,
    callbacks: (callbacks ?? []) as { id: string; job_id: string | null }[],
  };
}

export async function loadJobMaterialNeed(jobId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_line_items")
    .select("line_type, category")
    .eq("job_id", jobId)
    .limit(200);
  return (data ?? []).some((line) =>
    isMaterialLine(line as { line_type?: string | null; category?: string | null }),
  );
}
