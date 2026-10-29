/**
 * Idempotent office-task automation. Uses the service-role client so a
 * salesman sending an estimate (or a portal approval) can still create the
 * follow-up task — office_tasks INSERT RLS is manager-only.
 *
 * Never throws into the domain action: missing service role or a unique race
 * is treated as "already created / skipped".
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { customerIsArchived } from "@/lib/customer-operational";
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
  callbackFollowUpDue,
  followUpDueAt,
  isAutomationSourceKind,
  shouldCreateCollectBalanceTask,
  shouldCreateDepositDueTask,
  shouldCreateEstimateFollowup,
  shouldStopEstimateFollowup,
  soonerFollowUpDue,
} from "@/lib/ops-followup";

/** User session or service-role client. Pinning must not require the service role. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FollowUpDb = { from: (table: string) => any };

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
  if (args.customerId) {
    const { data: cust } = await admin
      .from("customers")
      .select("cancelled_at")
      .eq("id", args.customerId)
      .maybeSingle();
    if (customerIsArchived(cust?.cancelled_at as string | null | undefined)) {
      return { created: false };
    }
  }
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

/**
 * Write customers.next_action_due to the sooner of the current reminder and
 * the event's follow-up. Stage moves that clear a timer run before this.
 * Archived customers are left alone. Never throws into the domain action.
 */
export async function pinCustomerFollowUp(args: {
  customerId: string | null;
  dueAt: string;
  db?: FollowUpDb | null;
}): Promise<void> {
  if (!args.customerId || !args.dueAt) return;
  const db = tryAdmin() ?? args.db ?? null;
  if (!db) return;
  const { data: cust } = await db
    .from("customers")
    .select("cancelled_at, next_action_due")
    .eq("id", args.customerId)
    .maybeSingle();
  if (!cust) return;
  if (customerIsArchived(cust.cancelled_at as string | null | undefined)) return;
  const next = soonerFollowUpDue(
    cust.next_action_due as string | null | undefined,
    args.dueAt,
  );
  if (next === cust.next_action_due) return;
  await db.from("customers").update({ next_action_due: next }).eq("id", args.customerId);
}

/** Pull an open automation task forward. Does not create a second task. */
async function pullOpenTaskDueForward(args: {
  sourceKind: string;
  entityId: string;
  dueAt: string;
  priority?: "low" | "normal" | "high" | "urgent";
}): Promise<void> {
  const admin = tryAdmin();
  if (!admin || !isAutomationSourceKind(args.sourceKind)) return;
  const key = automationSourceKey(args.sourceKind, args.entityId);
  const { data } = await admin
    .from("office_tasks")
    .select("id, due_at")
    .eq("source_key", key)
    .in("status", ["open", "in_progress"]);
  const now = new Date().toISOString();
  for (const row of data ?? []) {
    const next = soonerFollowUpDue(row.due_at as string | null, args.dueAt);
    if (next === row.due_at && !args.priority) continue;
    await admin
      .from("office_tasks")
      .update({
        due_at: next,
        ...(args.priority ? { priority: args.priority } : {}),
        updated_at: now,
      })
      .eq("id", row.id as string);
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
  db?: FollowUpDb | null;
}): Promise<void> {
  if (!args.customerId) return;
  if (!shouldCreateEstimateFollowup("sent")) return;
  const dueAt = followUpDueAt(new Date(), DEFAULT_ESTIMATE_FOLLOWUP_DAYS);
  await ensureAutomatedOfficeTaskSafe({
    title: `Follow up estimate${args.title ? `: ${args.title}` : ""}`,
    sourceKind: ESTIMATE_FOLLOWUP_KIND,
    entityId: args.estimateId,
    assignedTo: args.assignedTo ?? args.actorId,
    createdBy: args.actorId,
    customerId: args.customerId,
    estimateId: args.estimateId,
    dueAt,
    description:
      "Estimate is out. Call or text, log the outcome, or snooze follow-up on the customer file.",
  });
  await pinCustomerFollowUp({
    customerId: args.customerId,
    dueAt,
    db: args.db,
  });
}

/** Customer asked for changes — same follow-up task, due now, and the file stays on the list. */
export async function onEstimateChangesRequestedOps(args: {
  estimateId: string;
  customerId: string | null;
  assignedTo: string | null;
  actorId: string | null;
  title: string | null;
  note?: string | null;
  db?: FollowUpDb | null;
}): Promise<void> {
  if (!args.customerId) return;
  const dueAt = followUpDueAt(new Date(), 0);
  const said = args.note?.trim();
  await ensureAutomatedOfficeTaskSafe({
    title: `Customer asked for estimate changes${args.title ? `: ${args.title}` : ""}`,
    sourceKind: ESTIMATE_FOLLOWUP_KIND,
    entityId: args.estimateId,
    assignedTo: args.assignedTo ?? args.actorId,
    createdBy: args.actorId,
    customerId: args.customerId,
    estimateId: args.estimateId,
    dueAt,
    description: said
      ? `Call and update the estimate. Customer said: ${said}`
      : "Call and update the estimate.",
    priority: "high",
  });
  await pullOpenTaskDueForward({
    sourceKind: ESTIMATE_FOLLOWUP_KIND,
    entityId: args.estimateId,
    dueAt,
    priority: "high",
  });
  await pinCustomerFollowUp({
    customerId: args.customerId,
    dueAt,
    db: args.db,
  });
}

/** Customer wants to talk about the quote. Same follow-up task, due now. */
export async function onEstimateDiscussionRequestedOps(args: {
  estimateId: string;
  customerId: string | null;
  assignedTo: string | null;
  actorId: string | null;
  title: string | null;
  note?: string | null;
  db?: FollowUpDb | null;
}): Promise<void> {
  if (!args.customerId) return;
  const dueAt = followUpDueAt(new Date(), 0);
  const said = args.note?.trim();
  const taskTitle = `Customer wants to discuss estimate${args.title ? `: ${args.title}` : ""}`;
  const description = said
    ? `Call them about the estimate. They said: ${said}`
    : "The customer wants to discuss this estimate. Call them.";
  await ensureAutomatedOfficeTaskSafe({
    title: taskTitle,
    sourceKind: ESTIMATE_FOLLOWUP_KIND,
    entityId: args.estimateId,
    assignedTo: args.assignedTo ?? args.actorId,
    createdBy: args.actorId,
    customerId: args.customerId,
    estimateId: args.estimateId,
    dueAt,
    description,
    priority: "high",
  });
  await pullOpenTaskDueForward({
    sourceKind: ESTIMATE_FOLLOWUP_KIND,
    entityId: args.estimateId,
    dueAt,
    priority: "high",
  });
  const admin = tryAdmin();
  if (admin) {
    const key = automationSourceKey(ESTIMATE_FOLLOWUP_KIND, args.estimateId);
    await admin
      .from("office_tasks")
      .update({
        title: taskTitle,
        description,
        priority: "high",
        updated_at: new Date().toISOString(),
      })
      .eq("source_key", key)
      .in("status", ["open", "in_progress"]);
  }
  await pinCustomerFollowUp({
    customerId: args.customerId,
    dueAt,
    db: args.db,
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
  db?: FollowUpDb | null;
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
    const dueAt = followUpDueAt(new Date(), DEFAULT_DEPOSIT_FOLLOWUP_DAYS);
    await ensureAutomatedOfficeTaskSafe({
      title: `Collect deposit${args.title ? `: ${args.title}` : ""}`,
      sourceKind: DEPOSIT_DUE_KIND,
      entityId: args.estimateId,
      assignedTo: args.assignedTo ?? args.actorId,
      createdBy: args.actorId,
      customerId: args.customerId,
      estimateId: args.estimateId,
      dueAt,
      description:
        "Estimate approved — deposit is still outstanding before materials can be ordered.",
      priority: "high",
    });
    await pinCustomerFollowUp({
      customerId: args.customerId,
      dueAt,
      db: args.db,
    });
  }
}

export async function onJobCompletedOps(args: {
  jobId: string;
  customerId: string | null;
  actorId: string | null;
  title: string | null;
  openBalance: number;
  db?: FollowUpDb | null;
}): Promise<void> {
  if (
    !shouldCreateCollectBalanceTask({
      jobStatus: "completed",
      openBalance: args.openBalance,
    })
  ) {
    return;
  }
  const dueAt = followUpDueAt(new Date(), 1);
  await ensureAutomatedOfficeTaskSafe({
    title: `Collect balance${args.title ? `: ${args.title}` : ""}`,
    sourceKind: COLLECT_BALANCE_KIND,
    entityId: args.jobId,
    assignedTo: args.actorId,
    createdBy: args.actorId,
    customerId: args.customerId,
    jobId: args.jobId,
    dueAt,
    description:
      "Install is complete and a balance remains. Collect or set a follow-up.",
    priority: "high",
  });
  await pinCustomerFollowUp({
    customerId: args.customerId,
    dueAt,
    db: args.db,
  });
}

export async function onServiceCallbackOpenedOps(args: {
  callbackId: string;
  customerId: string | null;
  jobId: string | null;
  assignedTo: string | null;
  actorId: string | null;
  title: string;
  followUpAt?: string | null;
  db?: FollowUpDb | null;
}): Promise<void> {
  const dueAt = callbackFollowUpDue(args.followUpAt);
  await ensureAutomatedOfficeTaskSafe({
    title: args.title,
    sourceKind: SERVICE_CALLBACK_KIND,
    entityId: args.callbackId,
    assignedTo: args.assignedTo ?? args.actorId,
    createdBy: args.actorId,
    customerId: args.customerId,
    jobId: args.jobId,
    dueAt,
    description: "Open service/callback — assign, schedule a return, or resolve it.",
    priority: "high",
  });
  await pinCustomerFollowUp({
    customerId: args.customerId,
    dueAt,
    db: args.db,
  });
}
