/**
 * The customer's projects, using the same work-unit rule as Client status.
 * A job's stage wins. Before any job exists, the account's stage is the project.
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listWorkflowStages } from "@/lib/data/workflow";
import { presentPortalStage, type PortalStageView } from "@/lib/portal-dashboard";
import { jobSiteLine } from "@/lib/job-label";
import { workUnitsFor, type JobLike } from "@/lib/work-stage";

export interface PortalProject {
  id: string;
  kind: "job" | "customer";
  title: string;
  site: string | null;
  stage: PortalStageView;
  salespersonName: string | null;
  /** Profile ids that count as this project's salesperson. Not rendered. */
  salespersonIds: string[];
}

interface JobStageRow {
  id: string;
  workflow_stage_id: string | null;
  workflow_owner_id: string | null;
}

async function jobStagesFromStore(
  customerId: string,
  jobIds: string[],
): Promise<Map<string, JobStageRow>> {
  const byId = new Map<string, JobStageRow>();
  if (!jobIds.length) return byId;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("jobs")
      .select("id, workflow_stage_id, workflow_owner_id")
      .eq("customer_id", customerId)
      .in("id", jobIds);
    if (error) return byId;
    for (const row of data ?? []) {
      byId.set(row.id as string, {
        id: row.id as string,
        workflow_stage_id: (row.workflow_stage_id as string | null) ?? null,
        workflow_owner_id: (row.workflow_owner_id as string | null) ?? null,
      });
    }
  } catch {
    return byId;
  }
  return byId;
}

async function profileNames(ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return names;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", unique);
    if (error) return names;
    for (const row of data ?? []) {
      const name = ((row.full_name as string | null) ?? "").trim();
      if (name) names.set(row.id as string, name);
    }
  } catch {
    return names;
  }
  return names;
}

export async function listPortalProjects(customerId: string): Promise<PortalProject[]> {
  const supabase = await createClient();
  const [{ data: customer }, { data: jobRows }, stages] = await Promise.all([
    supabase
      .from("customers")
      .select("id, full_name, workflow_stage_id, workflow_owner_id, assigned_to")
      .eq("id", customerId)
      .maybeSingle(),
    supabase
      .from("jobs_customer")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false }),
    listWorkflowStages(),
  ]);
  if (!customer) return [];

  const rows = jobRows ?? [];
  const storeStages = await jobStagesFromStore(
    customerId,
    rows.map((row) => row.id as string),
  );
  const viewHasStage =
    rows.length === 0 || Object.prototype.hasOwnProperty.call(rows[0], "workflow_stage_id");

  const jobs: JobLike[] = rows.map((row) => {
    const stored = storeStages.get(row.id as string);
    const fromView = viewHasStage
      ? ((row.workflow_stage_id as string | null) ?? null)
      : null;
    return {
      id: row.id as string,
      customer_id: customerId,
      title: (row.title as string | null) ?? null,
      status: (row.status as string | null) ?? null,
      site_street: (row.site_street as string | null) ?? null,
      site_city: (row.site_city as string | null) ?? null,
      site_label: (row.site_label as string | null) ?? null,
      workflow_stage_id: stored?.workflow_stage_id ?? fromView,
      workflow_owner_id: stored?.workflow_owner_id ?? null,
    };
  });

  const units = workUnitsFor(
    {
      id: customer.id as string,
      full_name: (customer.full_name as string | null) ?? null,
      workflow_stage_id: (customer.workflow_stage_id as string | null) ?? null,
      workflow_owner_id: (customer.workflow_owner_id as string | null) ?? null,
      assigned_to: (customer.assigned_to as string | null) ?? null,
    },
    jobs,
  );

  const ownerIds = units.map((unit) => unit.ownerId).filter((id): id is string => !!id);
  const names = await profileNames(ownerIds);
  const stageById = new Map(stages.map((stage) => [stage.id, stage] as const));

  return units.map((unit) => {
    const stage = unit.stageId ? stageById.get(unit.stageId) ?? null : null;
    const job = jobs.find((row) => row.id === unit.id);
    return {
      id: unit.id,
      kind: unit.kind,
      title: unit.preJob ? "Your project" : unit.title?.trim() || "Your installation",
      site: unit.site ?? (job ? jobSiteLine(job) : null),
      stage: presentPortalStage(
        stage
          ? {
              id: stage.id,
              name: stage.name,
              position: stage.position,
              outcome: stage.outcome,
            }
          : null,
      ),
      salespersonName: unit.ownerId ? names.get(unit.ownerId) ?? null : null,
      salespersonIds: unit.ownerId ? [unit.ownerId] : [],
    };
  });
}

/** Names for people who already wrote on this customer's client thread. */
export async function portalAuthorNames(authorIds: string[]): Promise<Map<string, string>> {
  return profileNames(authorIds);
}
