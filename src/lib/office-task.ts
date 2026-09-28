/**
 * F2 office task helpers — pure.
 */
import { INSTALLER_ISSUE_KIND, SERVICE_CALLBACK_KIND } from "@/lib/ops-followup";

export type OfficeTaskStatus =
  | "open"
  | "in_progress"
  | "completed"
  | "cancelled";

export type OfficeTaskPriority = "low" | "normal" | "high" | "urgent";

export function isOpenTaskStatus(status: string): boolean {
  return status === "open" || status === "in_progress";
}

export function isTaskOverdue(args: {
  status: string;
  dueAt: string | null | undefined;
  now?: Date;
}): boolean {
  if (!isOpenTaskStatus(args.status)) return false;
  if (!args.dueAt) return false;
  const due = new Date(args.dueAt).getTime();
  if (!Number.isFinite(due)) return false;
  return due < (args.now ?? new Date()).getTime();
}

export function assessTaskComplete(args: {
  status: string;
  completedAt: string | null | undefined;
  completedBy: string | null | undefined;
}): boolean {
  return (
    args.status === "completed" &&
    !!args.completedAt &&
    !!args.completedBy
  );
}

/** Automation must not spam: same source_key while open/in_progress. */
export function shouldCreateAutomatedTask(args: {
  sourceKey: string;
  existingOpenSourceKeys: string[];
}): boolean {
  return !args.existingOpenSourceKeys.includes(args.sourceKey);
}

export function automationSourceKey(
  kind: string,
  entityId: string,
): string {
  return `${kind}:${entityId}`;
}

const SOURCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where a task row should open. Service tasks open the callback, not the customer file. */
export function taskOperationalHref(task: {
  source_key?: string | null;
  customer_id?: string | null;
  job_id?: string | null;
}): string | null {
  const key = task.source_key ?? "";
  const split = key.indexOf(":");
  if (split > 0) {
    const kind = key.slice(0, split);
    const id = key.slice(split + 1);
    if (
      (kind === SERVICE_CALLBACK_KIND || kind === INSTALLER_ISSUE_KIND) &&
      SOURCE_ID.test(id)
    ) {
      return `/service/${id}`;
    }
  }
  if (task.customer_id) return `/customers/${task.customer_id}`;
  if (task.job_id) return `/jobs/${task.job_id}`;
  return null;
}

/**
 * F2 task management (create / reassign / cancel / rewrite content).
 * Matches 0178 office_tasks_insert / manager branch of office_tasks_protect_columns.
 * public.is_staff() is admin|office only (0001) — salesman/scheduler/warehouse are not managers.
 */
export const OFFICE_TASK_MANAGE_ROLES = [
  "admin",
  "office",
  "sales_manager",
] as const;

export type OfficeTaskManageRole = (typeof OFFICE_TASK_MANAGE_ROLES)[number];

const ASSIGNEE_SELF_SERVICE_FIELDS = new Set([
  "status",
  "completed_at",
  "completed_by",
  "updated_at",
]);

export const OFFICE_TASK_PROTECTED_FIELDS = [
  "assigned_to",
  "created_by",
  "customer_id",
  "job_id",
  "estimate_id",
  "title",
  "priority",
  "due_at",
  "source",
  "source_key",
  "description",
] as const;

export function mayManageOfficeTaskFields(role: string | null | undefined): boolean {
  return (OFFICE_TASK_MANAGE_ROLES as readonly string[]).includes(role ?? "");
}

/** Assignee self-service: complete open/in_progress → completed only. */
export function assigneeMayMutateOfficeTaskField(field: string): boolean {
  return ASSIGNEE_SELF_SERVICE_FIELDS.has(field);
}

export function assessAssigneeOfficeTaskUpdate(args: {
  actorRole: string;
  actorId: string;
  assignedTo: string | null;
  field: string;
}): { ok: true } | { ok: false; code: "TASK_FORBIDDEN" | "TASK_FIELD_FORBIDDEN" } {
  if (mayManageOfficeTaskFields(args.actorRole)) return { ok: true };
  if (args.assignedTo !== args.actorId) {
    return { ok: false, code: "TASK_FORBIDDEN" };
  }
  if (!assigneeMayMutateOfficeTaskField(args.field)) {
    return { ok: false, code: "TASK_FIELD_FORBIDDEN" };
  }
  return { ok: true };
}
