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

function refreshOps(jobId?: string | null, customerId?: string | null) {
  revalidatePath("/dashboard");
  revalidatePath("/jobs");
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
  if (error) throw new Error(error.message);
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
  const { error } = await supabase
    .from("office_tasks")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      completed_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  refreshOps();
}

export async function cancelOfficeTask(formData: FormData): Promise<void> {
  const id = str(formData.get("task_id"));
  if (!id) throw new Error("Missing task.");
  await assertRole(TASK_ASSIGN_ROLES);
  const supabase = await createClient();
  const { error } = await supabase
    .from("office_tasks")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
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
    throw new Error(error.message);
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
  if (error) throw new Error(error.message);
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
  if (error) throw new Error(error.message);
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
  const { error } = await supabase.from("service_callbacks").insert({
    customer_id: customerId,
    job_id: jobId,
    category: str(formData.get("category")) || "other",
    description,
    status: "open",
    assigned_to: str(formData.get("assigned_to")) || profile.id,
    follow_up_at: str(formData.get("follow_up_at")) || null,
    reported_at: str(formData.get("reported_at")) || new Date().toISOString().slice(0, 10),
    created_by: profile.id,
  });
  if (error) throw new Error(error.message);
  refreshOps(jobId, customerId);
}

export async function resolveServiceCallback(formData: FormData): Promise<void> {
  await assertRole(CALLBACK_ROLES);
  const id = str(formData.get("callback_id"));
  if (!id) throw new Error("Missing callback.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("service_callbacks")
    .update({
      status: "resolved",
      resolution_notes: str(formData.get("resolution_notes")) || null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  refreshOps(str(formData.get("job_id")), str(formData.get("customer_id")));
}

export async function cancelServiceCallback(formData: FormData): Promise<void> {
  await assertRole(["admin", "office"]);
  const id = str(formData.get("callback_id"));
  if (!id) throw new Error("Missing callback.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("service_callbacks")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  refreshOps();
}
