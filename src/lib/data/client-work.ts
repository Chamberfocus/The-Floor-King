/**
 * The live work Client status and the owner's salesperson book both read.
 * src/lib/work-stage.ts decides what a unit is.
 */
import { listCustomers, getProfileNames } from "@/lib/data/customers";
import { listOpenJobsForPipeline } from "@/lib/data/jobs";
import { listWorkflowStages } from "@/lib/data/workflow";
import { workUnitsFor, type WorkUnit } from "@/lib/work-stage";
import type { WorkflowStage } from "@/lib/types";

export async function loadClientWork(): Promise<{
  units: WorkUnit[];
  stages: WorkflowStage[];
  names: Record<string, string>;
}> {
  const stages = await listWorkflowStages();
  const customers = (await listCustomers()).filter((customer) => !customer.cancelled_at);
  const jobs = await listOpenJobsForPipeline();
  const jobsByCustomer = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const list = jobsByCustomer.get(job.customer_id) ?? [];
    list.push(job);
    jobsByCustomer.set(job.customer_id, list);
  }
  const units = customers.flatMap((customer) =>
    workUnitsFor(customer, jobsByCustomer.get(customer.id) ?? []),
  );
  const nameIds = [
    ...units.map((unit) => unit.ownerId),
    ...units.map((unit) => unit.salespersonId),
  ].filter((id): id is string => !!id);
  const names = nameIds.length ? await getProfileNames(nameIds) : {};
  return { units, stages, names };
}
