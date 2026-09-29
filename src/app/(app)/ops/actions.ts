"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRole, requireProfile } from "@/lib/auth";
import type { UserRole } from "@/lib/types";
import {
  automationSourceKey,
  shouldCreateAutomatedTask,
} from "@/lib/office-task";
import { listOpenSourceKeys } from "@/lib/data/ops-glue";
import {
  completeAutomatedOfficeTasks,
  ensureAutomatedOfficeTaskSafe,
  onServiceCallbackOpenedOps,
} from "@/lib/data/ops-automation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  INSTALLER_ISSUE_KIND,
  SERVICE_CALLBACK_KIND,
  callbackCategoryForIssue,
  installerIssueTitle,
  installerMayReportIssue,
  isInstallerIssueCategory,
  reuseOpenInstallerIssueId,
} from "@/lib/ops-followup";
import {
  assessServiceTransition,
  SERVICE_CHANGED_MESSAGE,
  serviceEmployeeMessage,
  serviceResolvePatch,
  serviceSchedulePatch,
  type ServiceStatus,
} from "@/lib/service-callback";

const TASK_SAVE_FAILED = "This task could not be saved. Refresh and try again.";
const TASK_CHANGED =
  "This task changed while you were working. Refresh and try again.";
const HOLD_SAVE_FAILED = "This hold could not be saved. Refresh and try again.";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Create/cancel/reassign — matches office_tasks_insert RLS (0178). */
const TASK_ASSIGN_ROLES: UserRole[] = [
  "admin",
  "office",
  "sales_manager",
];
/**
 * Complete path: assignees of any ops role may complete *their* task; bosses
 * (admin/office/sales_manager) may complete any. RLS + trigger (0178) use those
 * explicit roles — not is_staff() alone. Ordinary assignees cannot rewrite
 * assignment/provenance/content fields.
 */
const TASK_COMPLETE_ROLES: UserRole[] = [
  "admin",
  "office",
  "sales_manager",
  "salesman",
  "scheduler",
  "warehouse",
];
const HOLD_ROLES: UserRole[] = ["admin", "office", "sales_manager", "scheduler"];
const CALLBACK_ROLES: UserRole[] = [
  "admin",
  "office",
  "sales_manager",
  "salesman",
];

function refreshOps(jobId?: string | null, customerId?: string | null, callbackId?: string | null) {
  revalidatePath("/dashboard");
  revalidatePath("/jobs");
  revalidatePath("/tasks");
  revalidatePath("/service");
  if (callbackId) revalidatePath(`/service/${callbackId}`);
  if (jobId) revalidatePath(`/jobs/${jobId}`);
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

export async function createOfficeTask(formData: FormData): Promise<void> {
  await assertRole(TASK_ASSIGN_ROLES);
  const title = str(formData.get("title"));
  if (!title) throw new Error("Task title is required.");
  const profile = await requireProfile();
  const supabase = await createClient();
  const assigned =
    str(formData.get("assigned_to")) || profile.id;
  const { error } = await supabase.from("office_tasks").insert({
    title,
    description: str(formData.get("description")) || null,
    priority: str(formData.get("priority")) || "normal",
    assigned_to: assigned,
    created_by: profile.id,
    due_at: str(formData.get("due_at")) || null,
    customer_id: str(formData.get("customer_id")) || null,
    job_id: str(formData.get("job_id")) || null,
    estimate_id: str(formData.get("estimate_id")) || null,
    source: "manual",
    status: "open",
  });
  if (error) {
    console.error("[createOfficeTask]", error.code);
    throw new Error(TASK_SAVE_FAILED);
  }
  refreshOps(str(formData.get("job_id")), str(formData.get("customer_id")));
}

export async function completeOfficeTask(formData: FormData): Promise<void> {
  const id = str(formData.get("task_id"));
  if (!id) throw new Error("Missing task.");
  const profile = await assertRole(TASK_COMPLETE_ROLES);
  const supabase = await createClient();
  const { data: task } = await supabase
    .from("office_tasks")
    .select("assigned_to, status")
    .eq("id", id)
    .maybeSingle();
  if (!task) throw new Error("Task not found.");
  const isAssignee = task.assigned_to === profile.id;
  const isBoss = ["admin", "office", "sales_manager"].includes(profile.role);
  // App + RLS must agree: non-boss may only complete own assignment.
  if (!isAssignee && !isBoss) {
    throw new Error("You can only complete tasks assigned to you.");
  }
  if (task.status === "cancelled") {
    throw new Error("Cancelled tasks can’t be completed.");
  }
  if (task.status === "completed") {
    throw new Error("This task is already complete.");
  }
  const { data: saved, error } = await supabase
    .from("office_tasks")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      completed_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", task.status)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[completeOfficeTask]", error.code);
    throw new Error(TASK_SAVE_FAILED);
  }
  if (!saved) throw new Error(TASK_CHANGED);
  refreshOps();
}

export async function cancelOfficeTask(formData: FormData): Promise<void> {
  const id = str(formData.get("task_id"));
  if (!id) throw new Error("Missing task.");
  await assertRole(TASK_ASSIGN_ROLES);
  const supabase = await createClient();
  const { data: task } = await supabase
    .from("office_tasks")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!task) throw new Error("Task not found.");
  if (task.status === "cancelled") return;
  const { data: saved, error } = await supabase
    .from("office_tasks")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", task.status)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[cancelOfficeTask]", error.code);
    throw new Error(TASK_SAVE_FAILED);
  }
  if (!saved) throw new Error(TASK_CHANGED);
  refreshOps();
}

/** Idempotent automation helper — creates at most one open task per source_key. */
export async function ensureAutomatedOfficeTask(args: {
  title: string;
  sourceKind: string;
  entityId: string;
  assignedTo: string | null;
  jobId?: string | null;
  customerId?: string | null;
  dueAt?: string | null;
  description?: string | null;
}): Promise<{ created: boolean }> {
  await assertRole(TASK_ASSIGN_ROLES);
  const key = automationSourceKey(args.sourceKind, args.entityId);
  const open = await listOpenSourceKeys([key]);
  if (!shouldCreateAutomatedTask({ sourceKey: key, existingOpenSourceKeys: open })) {
    return { created: false };
  }
  const profile = await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from("office_tasks").insert({
    title: args.title,
    description: args.description ?? null,
    assigned_to: args.assignedTo ?? profile.id,
    created_by: profile.id,
    due_at: args.dueAt ?? null,
    job_id: args.jobId ?? null,
    customer_id: args.customerId ?? null,
    source: "automation",
    source_key: key,
    status: "open",
    priority: "normal",
  });
  if (error) {
    // Unique race → treat as already created.
    if (error.message.includes("office_tasks_source_key")) {
      return { created: false };
    }
    console.error("[ensureAutomatedOfficeTask]", error.code);
    throw new Error(TASK_SAVE_FAILED);
  }
  return { created: true };
}

export async function placeJobHold(formData: FormData): Promise<void> {
  await assertRole(HOLD_ROLES);
  const jobId = str(formData.get("job_id"));
  const reason = str(formData.get("reason"));
  if (!jobId || !reason) throw new Error("Job and hold reason are required.");
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data: active } = await supabase
    .from("job_operational_holds")
    .select("id")
    .eq("job_id", jobId)
    .is("released_at", null)
    .limit(1);
  if (active?.length) throw new Error("This job already has an active hold.");
  const { error } = await supabase.from("job_operational_holds").insert({
    job_id: jobId,
    reason,
    note: str(formData.get("note")) || null,
    category: str(formData.get("category")) || "other",
    placed_by: profile.id,
  });
  if (error) {
    console.error("[placeJobHold]", error.code);
    throw new Error(HOLD_SAVE_FAILED);
  }
  refreshOps(jobId);
}

export async function releaseJobHold(formData: FormData): Promise<void> {
  await assertRole(HOLD_ROLES);
  const holdId = str(formData.get("hold_id"));
  const jobId = str(formData.get("job_id"));
  if (!holdId) throw new Error("Missing hold.");
  const profile = await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase
    .from("job_operational_holds")
    .update({
      released_at: new Date().toISOString(),
      released_by: profile.id,
    })
    .eq("id", holdId)
    .is("released_at", null);
  if (error) {
    console.error("[releaseJobHold]", error.code);
    throw new Error(HOLD_SAVE_FAILED);
  }
  refreshOps(jobId);
}

export async function createServiceCallback(formData: FormData): Promise<void> {
  await assertRole(CALLBACK_ROLES);
  const customerId = str(formData.get("customer_id"));
  const description = str(formData.get("description"));
  if (!customerId || !description) {
    throw new Error("Customer and description are required.");
  }
  const profile = await requireProfile();
  const supabase = await createClient();
  const jobId = str(formData.get("job_id")) || null;
  let openQuery = supabase
    .from("service_callbacks")
    .select("id, description")
    .eq("customer_id", customerId)
    .eq("created_by", profile.id)
    .in("status", ["open", "scheduled", "in_progress", "waiting"]);
  if (jobId) openQuery = openQuery.eq("job_id", jobId);
  const { data: existingOpen } = await openQuery;
  const reuseId = reuseOpenInstallerIssueId({
    existingOpen: (existingOpen ?? []) as {
      id: string;
      description: string | null;
    }[],
    description,
  });
  if (reuseId) {
    refreshOps(jobId, customerId);
    return;
  }
  const { data: created, error } = await supabase
    .from("service_callbacks")
    .insert({
    customer_id: customerId,
    job_id: jobId,
    category: str(formData.get("category")) || "other",
    description,
    status: "open",
    assigned_to: str(formData.get("assigned_to")) || profile.id,
    follow_up_at: str(formData.get("follow_up_at")) || null,
    reported_at: str(formData.get("reported_at")) || new Date().toISOString().slice(0, 10),
    created_by: profile.id,
  })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(serviceEmployeeMessage("create"));
  if (created?.id) {
    void onServiceCallbackOpenedOps({
      callbackId: created.id as string,
      customerId,
      jobId,
      assignedTo: str(formData.get("assigned_to")) || profile.id,
      actorId: profile.id,
      title: `Service callback: ${description.slice(0, 80)}`,
    });
  }
  refreshOps(jobId, customerId);
}

export async function resolveServiceCallback(
  formData: FormData,
): Promise<{ error: string | null }> {
  await assertRole(CALLBACK_ROLES);
  const id = str(formData.get("callback_id"));
  if (!id) return { error: serviceEmployeeMessage("resolve") };
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data: prior } = await supabase
    .from("service_callbacks")
    .select("status, job_id, customer_id")
    .eq("id", id)
    .maybeSingle();
  if (!prior) return { error: serviceEmployeeMessage("resolve") };
  if ((prior.status as string) === "resolved") {
    return { error: "This service issue is already resolved." };
  }
  const gate = assessServiceTransition(prior.status as string, "resolved");
  if (!gate.ok) return { error: serviceEmployeeMessage("resolve") };
  const { data: saved, error } = await supabase
    .from("service_callbacks")
    .update(serviceResolvePatch(str(formData.get("resolution_notes")) || null))
    .eq("id", id)
    .eq("status", prior.status as string)
    .select("id")
    .maybeSingle();
  if (error) return { error: serviceEmployeeMessage("resolve") };
  if (!saved) return { error: SERVICE_CHANGED_MESSAGE };
  void completeAutomatedOfficeTasks({
    sourceKind: SERVICE_CALLBACK_KIND,
    entityId: id,
    completedBy: profile.id,
  });
  void completeAutomatedOfficeTasks({
    sourceKind: INSTALLER_ISSUE_KIND,
    entityId: id,
    completedBy: profile.id,
  });
  refreshOps(
    (prior.job_id as string | null) ?? str(formData.get("job_id")),
    (prior.customer_id as string | null) ?? str(formData.get("customer_id")),
    id,
  );
  return { error: null };
}

export async function cancelServiceCallback(formData: FormData): Promise<void> {
  await assertRole(["admin", "office"]);
  const id = str(formData.get("callback_id"));
  if (!id) throw new Error(serviceEmployeeMessage("update"));
  const { supabase, prior } = await loadCallbackForEdit(id);
  if (!prior) throw new Error(serviceEmployeeMessage("update"));
  const gate = assessServiceTransition(prior.status as string, "cancelled");
  if (!gate.ok) throw new Error(serviceEmployeeMessage("update"));
  const { data: saved, error } = await supabase
    .from("service_callbacks")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", prior.status as string)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(serviceEmployeeMessage("update"));
  if (!saved) throw new Error(SERVICE_CHANGED_MESSAGE);
  refreshOps(null, null, id);
}

async function loadCallbackForEdit(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("service_callbacks")
    .select("id, status, job_id, customer_id")
    .eq("id", id)
    .maybeSingle();
  return { supabase, prior: data };
}

export async function scheduleServiceVisit(
  formData: FormData,
): Promise<{ error: string | null }> {
  await assertRole(CALLBACK_ROLES);
  const id = str(formData.get("callback_id"));
  const day = str(formData.get("visit_date"));
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { error: serviceEmployeeMessage("schedule") };
  }
  const { supabase, prior } = await loadCallbackForEdit(id);
  if (!prior) return { error: serviceEmployeeMessage("schedule") };
  const gate = assessServiceTransition(prior.status as string, "scheduled");
  if (!gate.ok) return { error: serviceEmployeeMessage("schedule") };
  const { data: saved, error } = await supabase
    .from("service_callbacks")
    .update(serviceSchedulePatch(`${day}T12:00:00.000Z`))
    .eq("id", id)
    .eq("status", prior.status as string)
    .select("id")
    .maybeSingle();
  if (error) return { error: serviceEmployeeMessage("schedule") };
  if (!saved) return { error: SERVICE_CHANGED_MESSAGE };
  refreshOps(prior.job_id as string | null, prior.customer_id as string | null, id);
  return { error: null };
}

export async function assignServiceCallback(
  formData: FormData,
): Promise<{ error: string | null }> {
  await assertRole(CALLBACK_ROLES);
  const id = str(formData.get("callback_id"));
  const assignedTo = str(formData.get("assigned_to"));
  if (!id) return { error: serviceEmployeeMessage("assign") };
  const { supabase, prior } = await loadCallbackForEdit(id);
  if (!prior) return { error: serviceEmployeeMessage("assign") };
  if ((prior.status as string) === "resolved" || (prior.status as string) === "cancelled") {
    return { error: serviceEmployeeMessage("assign") };
  }
  const { data: saved, error } = await supabase
    .from("service_callbacks")
    .update({
      assigned_to: assignedTo || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", prior.status as string)
    .select("id")
    .maybeSingle();
  if (error) return { error: serviceEmployeeMessage("assign") };
  if (!saved) return { error: SERVICE_CHANGED_MESSAGE };
  refreshOps(prior.job_id as string | null, prior.customer_id as string | null, id);
  return { error: null };
}

export async function setServiceCallbackStatus(
  formData: FormData,
): Promise<{ error: string | null }> {
  await assertRole(CALLBACK_ROLES);
  const id = str(formData.get("callback_id"));
  const status = str(formData.get("status")) as ServiceStatus;
  if (!id || (status !== "in_progress" && status !== "waiting" && status !== "open")) {
    return { error: serviceEmployeeMessage("update") };
  }
  const { supabase, prior } = await loadCallbackForEdit(id);
  if (!prior) return { error: serviceEmployeeMessage("update") };
  const gate = assessServiceTransition(prior.status as string, status);
  if (!gate.ok) return { error: serviceEmployeeMessage("update") };
  const { data: saved, error } = await supabase
    .from("service_callbacks")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", prior.status as string)
    .select("id")
    .maybeSingle();
  if (error) return { error: serviceEmployeeMessage("update") };
  if (!saved) return { error: SERVICE_CHANGED_MESSAGE };
  refreshOps(prior.job_id as string | null, prior.customer_id as string | null, id);
  return { error: null };
}

const ISSUE_ROLES: UserRole[] = ["crew", "admin", "office"];

/**
 * Field issue report. Crew cannot INSERT service_callbacks under RLS
 * (is_staff is office/admin), so this writes via the service role after
 * verifying the actor is assigned to the job (or is office/admin).
 */
export async function reportInstallerIssue(formData: FormData): Promise<void> {
  const profile = await assertRole(ISSUE_ROLES);
  const jobId = str(formData.get("job_id"));
  const description = str(formData.get("description"));
  const categoryRaw = str(formData.get("category")) || "installation";
  if (!jobId || !description) {
    throw new Error("Job and a short description are required.");
  }
  if (!isInstallerIssueCategory(categoryRaw) && categoryRaw !== "installation") {
    throw new Error("Pick a valid issue type.");
  }
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, customer_id, assigned_to, assigned_crew_id, title, customer:customers(full_name)",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!job) throw new Error("Job not found.");
  const isBoss = ["admin", "office"].includes(profile.role);
  let memberCrewIds: string[] = [];
  if (!isBoss && profile.role === "crew") {
    const { data: crewRows } = await supabase
      .from("install_crews")
      .select("id")
      .eq("profile_id", profile.id)
      .eq("active", true);
    memberCrewIds = (crewRows ?? []).map((c) => c.id as string);
  }
  if (
    !installerMayReportIssue({
      role: profile.role,
      actorId: profile.id,
      assignedTo: (job.assigned_to as string | null) ?? null,
      assignedCrewId: (job.assigned_crew_id as string | null) ?? null,
      memberCrewIds,
    })
  ) {
    throw new Error("You can only report issues on jobs assigned to you.");
  }
  const customerId = (job.customer_id as string | null) ?? null;
  if (!customerId) throw new Error("This job has no customer on file.");
  const cust = job.customer as unknown as { full_name?: string | null } | null;
  const category = callbackCategoryForIssue(categoryRaw);
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    throw new Error(
      "Could not record the issue. Try again from the office job page.",
    );
  }
  const { data: existingOpen } = await admin
    .from("service_callbacks")
    .select("id, description")
    .eq("job_id", jobId)
    .eq("created_by", profile.id)
    .in("status", ["open", "scheduled", "in_progress", "waiting"]);
  const reuseId = reuseOpenInstallerIssueId({
    existingOpen: (existingOpen ?? []) as {
      id: string;
      description: string | null;
    }[],
    description,
  });
  let callbackId = reuseId;
  if (!callbackId) {
    const { data: created, error } = await admin
      .from("service_callbacks")
      .insert({
        customer_id: customerId,
        job_id: jobId,
        category,
        description,
        status: "open",
        assigned_to: isBoss ? profile.id : null,
        reported_at: new Date().toISOString().slice(0, 10),
        created_by: profile.id,
      })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(serviceEmployeeMessage("create"));
    callbackId = (created?.id as string | null) ?? null;
  }
  const title = installerIssueTitle(
    categoryRaw,
    cust?.full_name || (job.title as string) || "job",
  );
  if (callbackId) {
    void ensureAutomatedOfficeTaskSafe({
      title,
      sourceKind: INSTALLER_ISSUE_KIND,
      entityId: callbackId,
      assignedTo: isBoss ? profile.id : null,
      createdBy: profile.id,
      jobId,
      customerId,
      description,
      priority: "high",
    });
  }
  refreshOps(jobId, customerId);
}
