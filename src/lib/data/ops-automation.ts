/**
 * Idempotent office-task automation. Uses the service-role client so a
 * salesman sending an estimate (or a portal approval) can still create the
 * follow-up task — office_tasks INSERT RLS is manager-only.
 *
 * Never throws into the domain action: missing service role or a unique race
 * is treated as "already created / skipped".
 */
import { createAdminClient } from "@/lib/supabase/admin";
import {
  automationSourceKey,
  shouldCreateAutomatedTask,
} from "@/lib/office-task";
import {
  COLLECT_BALANCE_KIND,
  DEFAULT_DEPOSIT_FOLLOWUP_DAYS,
  DEFAULT_ESTIMATE_FOLLOWUP_DAYS,
  DEPOSIT_DUE_KIND,
  ESTIMATE_FOLLOWUP_KIND,
  SERVICE_CALLBACK_KIND,
  automationSourceKeyPrefix,
  followUpDueAt,
  isAutomationSourceKind,
  shouldCreateCollectBalanceTask,
  shouldCreateDepositDueTask,
  shouldCreateEstimateFollowup,
  shouldStopEstimateFollowup,
} from "@/lib/ops-followup";

function tryAdmin() {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

export async function ensureAutomatedOfficeTaskSafe(args: {
  title: string;
  sourceKind: string;
  entityId: string;
  assignedTo: string | null;
  createdBy: string | null;
  jobId?: string | null;
  customerId?: string | null;
  estimateId?: string | null;
  dueAt?: string | null;
  description?: string | null;
  priority?: "low" | "normal" | "high" | "urgent";
}): Promise<{ created: boolean }> {
  const admin = tryAdmin();
  if (!admin) return { created: false };
  if (!isAutomationSourceKind(args.sourceKind)) return { created: false };
  const key = automationSourceKey(args.sourceKind, args.entityId);
  const { data: existing } = await admin
    .from("office_tasks")
    .select("source_key")
    .eq("source_key", key)
    .in("status", ["open", "in_progress"]);
  const open = (existing ?? [])
    .map((r) => r.source_key as string | null)
    .filter((k): k is string => !!k);
  if (!shouldCreateAutomatedTask({ sourceKey: key, existingOpenSourceKeys: open })) {
    return { created: false };
  }
  const { error } = await admin.from("office_tasks").insert({
    title: args.title,
    description: args.description ?? null,
    assigned_to: args.assignedTo,
    created_by: args.createdBy ?? args.assignedTo,
    due_at: args.dueAt ?? null,
    job_id: args.jobId ?? null,
    customer_id: args.customerId ?? null,
    estimate_id: args.estimateId ?? null,
    source: "automation",
    source_key: key,
    status: "open",
    priority: args.priority ?? "normal",
  });
  if (error) {
    if (error.message.includes("office_tasks_source_key")) return { created: false };
    return { created: false };
  }
  return { created: true };
}

export async function completeAutomatedOfficeTasks(args: {
  sourceKind: string;
  entityId: string;
  completedBy: string | null;
}): Promise<number> {
  const admin = tryAdmin();
  if (!admin) return 0;
  if (!isAutomationSourceKind(args.sourceKind)) return 0;
  const key = automationSourceKey(args.sourceKind, args.entityId);
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("office_tasks")
    .update({
      status: "completed",
      completed_at: now,
      completed_by: args.completedBy,
      updated_at: now,
    })
    .eq("source_key", key)
    .in("status", ["open", "in_progress"])
    .select("id");
  if (error) return 0;
  return (data ?? []).length;
}

export async function completeOpenAutomatedTasksForCustomer(args: {
  sourceKind: string;
  customerId: string;
  completedBy: string | null;
}): Promise<number> {
  const admin = tryAdmin();
  if (!admin) return 0;
  const prefix = automationSourceKeyPrefix(args.sourceKind);
  if (!prefix) return 0;
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("office_tasks")
    .update({
      status: "completed",
      completed_at: now,
      completed_by: args.completedBy,
      updated_at: now,
    })
    .eq("customer_id", args.customerId)
    .like("source_key", `${prefix}%`)
    .in("status", ["open", "in_progress"])
    .select("id");
  if (error) return 0;
  return (data ?? []).length;
}

/** Money landed — stop chasing deposit, and stop collect-balance if AR is gone. */
export async function onMoneyReceivedOps(args: {
  customerId: string | null;
  jobId: string | null;
  actorId: string | null;
  openJobBalance?: number | null;
}): Promise<void> {
  if (args.customerId) {
    await completeOpenAutomatedTasksForCustomer({
      sourceKind: DEPOSIT_DUE_KIND,
      customerId: args.customerId,
      completedBy: args.actorId,
    });
  }
  if (
    args.jobId &&
    args.openJobBalance != null &&
    args.openJobBalance <= 0.5
  ) {
    await completeAutomatedOfficeTasks({
      sourceKind: COLLECT_BALANCE_KIND,
      entityId: args.jobId,
      completedBy: args.actorId,
    });
  }
}

export async function snoozeAutomatedOfficeTasks(args: {
  sourceKind: string;
  entityId: string;
  dueAt: string;
}): Promise<number> {
  const admin = tryAdmin();
  if (!admin) return 0;
  if (!isAutomationSourceKind(args.sourceKind)) return 0;
  const key = automationSourceKey(args.sourceKind, args.entityId);
  const { data, error } = await admin
    .from("office_tasks")
    .update({
      due_at: args.dueAt,
      updated_at: new Date().toISOString(),
    })
    .eq("source_key", key)
    .in("status", ["open", "in_progress"])
    .select("id");
  if (error) return 0;
  return (data ?? []).length;
}

export async function onEstimateSentOps(args: {
  estimateId: string;
  customerId: string | null;
  assignedTo: string | null;
  actorId: string | null;
  title: string | null;
}): Promise<void> {
  if (!args.customerId) return;
  if (!shouldCreateEstimateFollowup("sent")) return;
  await ensureAutomatedOfficeTaskSafe({
    title: `Follow up estimate${args.title ? `: ${args.title}` : ""}`,
    sourceKind: ESTIMATE_FOLLOWUP_KIND,
    entityId: args.estimateId,
    assignedTo: args.assignedTo ?? args.actorId,
    createdBy: args.actorId,
    customerId: args.customerId,
    estimateId: args.estimateId,
    dueAt: followUpDueAt(new Date(), DEFAULT_ESTIMATE_FOLLOWUP_DAYS),
    description:
      "Estimate is out. Call or text, log the outcome, or snooze follow-up on the customer file.",
  });
}

export async function onEstimateResolvedOps(args: {
  estimateId: string;
  status: string;
  customerId: string | null;
  assignedTo: string | null;
  actorId: string | null;
  title: string | null;
  availableDeposit?: number;
  appliedDeposit?: number;
}): Promise<void> {
  if (shouldStopEstimateFollowup(args.status)) {
    await completeAutomatedOfficeTasks({
      sourceKind: ESTIMATE_FOLLOWUP_KIND,
      entityId: args.estimateId,
      completedBy: args.actorId,
    });
  }
  if (
    args.customerId &&
    args.availableDeposit != null &&
    args.appliedDeposit != null &&
    shouldCreateDepositDueTask({
      estimateStatus: args.status,
      availableDeposit: args.availableDeposit,
      appliedDeposit: args.appliedDeposit,
    })
  ) {
    await ensureAutomatedOfficeTaskSafe({
      title: `Collect deposit${args.title ? `: ${args.title}` : ""}`,
      sourceKind: DEPOSIT_DUE_KIND,
      entityId: args.estimateId,
      assignedTo: args.assignedTo ?? args.actorId,
      createdBy: args.actorId,
      customerId: args.customerId,
      estimateId: args.estimateId,
      dueAt: followUpDueAt(new Date(), DEFAULT_DEPOSIT_FOLLOWUP_DAYS),
      description:
        "Estimate approved — deposit is still outstanding before materials can be ordered.",
      priority: "high",
    });
  }
}

export async function onJobCompletedOps(args: {
  jobId: string;
  customerId: string | null;
  actorId: string | null;
  title: string | null;
  openBalance: number;
}): Promise<void> {
  if (
    !shouldCreateCollectBalanceTask({
      jobStatus: "completed",
      openBalance: args.openBalance,
    })
  ) {
    return;
  }
  await ensureAutomatedOfficeTaskSafe({
    title: `Collect balance${args.title ? `: ${args.title}` : ""}`,
    sourceKind: COLLECT_BALANCE_KIND,
    entityId: args.jobId,
    assignedTo: args.actorId,
    createdBy: args.actorId,
    customerId: args.customerId,
    jobId: args.jobId,
    dueAt: followUpDueAt(new Date(), 1),
    description:
      "Install is complete and a balance remains. Collect or set a follow-up.",
    priority: "high",
  });
}

export async function onServiceCallbackOpenedOps(args: {
  callbackId: string;
  customerId: string | null;
  jobId: string | null;
  assignedTo: string | null;
  actorId: string | null;
  title: string;
}): Promise<void> {
  await ensureAutomatedOfficeTaskSafe({
    title: args.title,
    sourceKind: SERVICE_CALLBACK_KIND,
    entityId: args.callbackId,
    assignedTo: args.assignedTo ?? args.actorId,
    createdBy: args.actorId,
    customerId: args.customerId,
    jobId: args.jobId,
    dueAt: followUpDueAt(new Date(), 1),
    description: "Open service/callback — assign, schedule a return, or resolve it.",
    priority: "high",
  });
}
