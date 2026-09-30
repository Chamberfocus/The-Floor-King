/**
 * Customers list view model.
 *
 * The page normalizes every display field here, before React renders the list.
 * Components then interpolate strings and finite numbers only. Unexpected
 * values become a fallback and a type-only diagnostic — never "[object Object]"
 * and never customer PII.
 */
import type { ArrivalWindow } from "@/lib/format";
import { formatDate, formatMoney, parseLocalDate } from "@/lib/format";
import {
  formatCustomerActivityLine,
  leadSourceLabel,
  type CustomerListActivity,
  EMPTY_CUSTOMER_LIST_ACTIVITY,
} from "@/lib/customer-list";
import { customerIdForLog, logCustomersPhase, logUnexpectedCustomerField } from "@/lib/customers-render-log";
import type { CloseoutTarget } from "@/lib/job-flow";
import type { QuickAction } from "@/lib/preferences";
import {
  DUTY_LABELS,
  DUTY_ROLES,
  inferStageDuty,
  LEAD_STAGE_BADGE,
  LEAD_STAGE_LABELS,
  STAGE_COLOR_BADGE,
  type LeadStage,
} from "@/lib/types";

export type CustomerListSortKey =
  | "name"
  | "assigned"
  | "stage"
  | "phone"
  | "city"
  | "source"
  | "updated";

export type CustomerListQuickModel = {
  customerId: string;
  stages: { id: string; name: string }[];
  currentStageId: string | null;
  currentStageName: string | null;
  currentOwnerId: string | null;
  assignedRepId: string | null;
  currentOwnerName: string | null;
  ownerDutyLabel: string | null;
  reassignOptions: { id: string; name: string; title: string | null }[];
  repOptions: { id: string; name: string }[];
  installOptions: { id: string; name: string }[];
  estimate: { startsAt: string; rep: string | null } | null;
  job: {
    id: string;
    date: string | null;
    endDate: string | null;
    window: string | null;
    installerId: string | null;
    installerName: string | null;
  } | null;
  closeout: CloseoutTarget | null;
  canCloseOut: boolean;
  arrivalWindows: ArrivalWindow[];
  actions: QuickAction[];
  showSwitcher: false;
  compact: true;
  redirectTo: string;
};

export type CustomerListRowModel = {
  id: string;
  displayName: string;
  company: string;
  contactLine: string;
  phone: string;
  city: string;
  sourceLabel: string;
  stageLabel: string;
  stageClassName: string;
  assignedLabel: string;
  hasAssignee: boolean;
  updatedDisplay: string;
  overdue: boolean;
  activityLine: string;
  moneyLine: string;
  hasActions: boolean;
  sort: Record<CustomerListSortKey, string | number>;
  quick: CustomerListQuickModel | null;
};

export type CustomerListStageOption = { value: string; label: string };
export type CustomerListMemberOption = { id: string; name: string; title: string | null; role: string };

type Member = CustomerListMemberOption;

const LEAD_STAGES = new Set<string>(Object.keys(LEAD_STAGE_LABELS));

function textField(field: string, value: unknown, customerId: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value == null) return "";
  logUnexpectedCustomerField(field, value, customerId);
  return "";
}

function idField(field: string, value: unknown, customerId: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value == null) return null;
  logUnexpectedCustomerField(field, value, customerId);
  return null;
}

function finiteNumber(field: string, value: unknown, customerId: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  if (value != null) logUnexpectedCustomerField(field, value, customerId);
  return 0;
}

function timeValue(field: string, value: unknown, customerId: unknown, report = true): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" || typeof value === "number" || value instanceof Date) {
    const time = parseLocalDate(value).getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (report) logUnexpectedCustomerField(field, value, customerId);
  return null;
}

function displayDate(field: string, value: unknown, customerId: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string" || typeof value === "number" || value instanceof Date) {
    return formatDate(typeof value === "number" || value instanceof Date ? (value as never) : value);
  }
  logUnexpectedCustomerField(field, value, customerId);
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function activityOf(raw: unknown, customerId: string): CustomerListActivity {
  if (raw == null) return EMPTY_CUSTOMER_LIST_ACTIVITY;
  const row = asRecord(raw);
  if (!row) {
    logUnexpectedCustomerField("activity", raw, customerId);
    return EMPTY_CUSTOMER_LIST_ACTIVITY;
  }
  const num = (field: keyof CustomerListActivity) =>
    finiteNumber(`activity.${field}`, row[field], customerId);
  return {
    totalJobs: num("totalJobs"),
    openJobs: num("openJobs"),
    completedJobs: num("completedJobs"),
    estimateCount: num("estimateCount"),
    cashAndCarryCount: num("cashAndCarryCount"),
    invoiceCount: num("invoiceCount"),
    openBalance: num("openBalance"),
    lifetimeSales: num("lifetimeSales"),
    previewJobs: [],
  };
}

function moneyLine(activity: CustomerListActivity): string {
  const money: string[] = [];
  if (activity.openBalance > 0.005) money.push(`${formatMoney(activity.openBalance)} open`);
  if (activity.lifetimeSales > 0.005) money.push(`${formatMoney(activity.lifetimeSales)} lifetime`);
  return money.join(" · ");
}

function stagePresentation(
  customerId: string,
  workflowStageId: string | null,
  leadStage: unknown,
  stages: { id: string; name: string; color: string; position: number }[],
): { label: string; className: string; position: number } {
  const wf = workflowStageId ? stages.find((s) => s.id === workflowStageId) : undefined;
  if (wf) {
    return {
      label: wf.name,
      className: STAGE_COLOR_BADGE[wf.color] ?? STAGE_COLOR_BADGE.zinc,
      position: Number.isFinite(wf.position) ? wf.position : Number.MAX_SAFE_INTEGER,
    };
  }
  if (typeof leadStage === "string" && LEAD_STAGES.has(leadStage)) {
    const key = leadStage as LeadStage;
    return {
      label: LEAD_STAGE_LABELS[key],
      className: LEAD_STAGE_BADGE[key],
      position: Number.MAX_SAFE_INTEGER,
    };
  }
  if (typeof leadStage === "string" && leadStage) {
    return { label: leadStage, className: STAGE_COLOR_BADGE.zinc, position: Number.MAX_SAFE_INTEGER };
  }
  if (leadStage != null) logUnexpectedCustomerField("stage", leadStage, customerId);
  return { label: "—", className: STAGE_COLOR_BADGE.zinc, position: Number.MAX_SAFE_INTEGER };
}

function memberName(members: Member[], id: string | null): string {
  if (!id) return "";
  return members.find((m) => m.id === id)?.name ?? "";
}

function normalizeCloseout(value: unknown, customerId: string): CloseoutTarget | null {
  const row = asRecord(value);
  if (!row) {
    if (value != null) logUnexpectedCustomerField("closeout", value, customerId);
    return null;
  }
  const jobId = idField("closeout.jobId", row.jobId, customerId);
  if (!jobId) return null;
  return {
    jobId,
    closedOut: row.closedOut === true,
    ready: row.ready === true,
  };
}

function buildQuick(
  customerId: string,
  ownerId: string | null,
  assignedId: string | null,
  stageId: string | null,
  stageName: string,
  ctx: unknown,
  members: Member[],
  stages: { id: string; name: string; color: string; position: number; auto_action: string | null; owner_duty: string | null }[],
  reps: { id: string; name: string }[],
  installOptions: { id: string; name: string }[],
  arrivalWindows: ArrivalWindow[],
  listActions: QuickAction[],
  canCloseOut: boolean,
  listHref: string,
): CustomerListQuickModel | null {
  const stage = stageId ? stages.find((s) => s.id === stageId) ?? null : null;
  const duty = inferStageDuty(stage) ?? (stage?.owner_duty || null);
  const roles = duty ? DUTY_ROLES[duty] : null;
  const nameById = (id: string | null) => (id ? memberName(members, id) || null : null);
  const pool = roles
    ? members.filter((m) => (roles as string[]).includes(m.role) || m.id === ownerId)
    : members;
  const context = asRecord(ctx);
  const jobRaw = context ? asRecord(context.job) : null;
  const estimateRaw = context ? asRecord(context.estimate) : null;
  const closeout = normalizeCloseout(context?.closeout, customerId);
  const jobId = jobRaw ? idField("job.id", jobRaw.id, customerId) : null;
  const installerId = jobRaw ? idField("job.installerId", jobRaw.installerId, customerId) : null;
  const startsAt = estimateRaw ? textField("estimate.startsAt", estimateRaw.startsAt, customerId) : "";
  const hasActions = listActions.some((action) =>
    action === "closeout" ? canCloseOut && !!closeout : true,
  );
  if (!hasActions) return null;
  return {
    customerId,
    stages: stages.map((s) => ({ id: s.id, name: s.name })),
    currentStageId: stageId,
    currentStageName: stageName || null,
    currentOwnerId: ownerId,
    assignedRepId: assignedId,
    currentOwnerName: nameById(ownerId),
    ownerDutyLabel: duty && DUTY_LABELS[duty] ? DUTY_LABELS[duty] : null,
    reassignOptions: pool.map((m) => ({ id: m.id, name: m.name, title: m.title })),
    repOptions: reps,
    installOptions,
    estimate: estimateRaw && startsAt
      ? { startsAt, rep: nameById(idField("estimate.salespersonId", estimateRaw.salespersonId, customerId)) }
      : null,
    job: jobId
      ? {
          id: jobId,
          date: textField("job.date", jobRaw?.date, customerId) || null,
          endDate: textField("job.endDate", jobRaw?.endDate, customerId) || null,
          window: textField("job.window", jobRaw?.window, customerId) || null,
          installerId,
          installerName: nameById(installerId),
        }
      : null,
    closeout,
    canCloseOut,
    arrivalWindows,
    actions: listActions,
    showSwitcher: false,
    compact: true,
    redirectTo: listHref,
  };
}

export function buildCustomerListView(input: {
  customers: unknown;
  contexts: unknown;
  activity: unknown;
  stages: { id: string; name: string; color: string; position: number; auto_action: string | null; owner_duty: string | null }[];
  members: Member[];
  reps: { id: string; name: string }[];
  installOptions: { id: string; name: string }[];
  arrivalWindows: ArrivalWindow[];
  listActions: QuickAction[];
  canCloseOut: boolean;
  listHref: string;
  nowMs?: number;
}): { rows: CustomerListRowModel[]; dropped: number } {
  const now = input.nowMs ?? Date.now();
  const contexts = asRecord(input.contexts) ?? {};
  const activityMap = asRecord(input.activity) ?? {};
  const actions = Array.isArray(input.listActions) ? input.listActions : [];
  const rowsIn = Array.isArray(input.customers) ? input.customers : [];
  let dropped = 0;
  const rows: CustomerListRowModel[] = [];

  for (const raw of rowsIn) {
    const record = asRecord(raw);
    if (!record) {
      dropped += 1;
      logUnexpectedCustomerField("row", raw, null);
      continue;
    }
    const id = idField("id", record.id, record.id);
    if (!id) {
      dropped += 1;
      continue;
    }
    try {
      const name = textField("full_name", record.full_name, id);
      const company = textField("company", record.company, id);
      const phone = textField("phone", record.phone, id);
      const city = textField("city", record.city, id);
      const street = textField("street", record.street, id);
      const sourceLabel = leadSourceLabel(record.source);
      if (record.source != null && typeof record.source !== "string") {
        logUnexpectedCustomerField("source", record.source, id);
      }
      const stageId = idField("workflow_stage_id", record.workflow_stage_id, id);
      const assignedId = idField("assigned_to", record.assigned_to, id);
      const ownerId = idField("workflow_owner_id", record.workflow_owner_id, id);
      const stage = stagePresentation(id, stageId, record.stage, input.stages);
      const assignedLabel = assignedId ? (memberName(input.members, assignedId) || "Unassigned") : "Unassigned";
      const updatedDisplay = displayDate("updated_at", record.updated_at, id);
      const updatedSort = timeValue("updated_at", record.updated_at, id, false) ?? 0;
      const due = timeValue("next_action_due", record.next_action_due, id);
      const activity = activityOf(activityMap[id], id);
      const contactLine = [street, city, phone].filter(Boolean).join(" · ");
      const quick = buildQuick(
        id,
        ownerId,
        assignedId,
        stageId,
        stage.label === "—" ? "" : stage.label,
        contexts[id],
        input.members,
        input.stages,
        input.reps,
        input.installOptions,
        input.arrivalWindows,
        actions,
        input.canCloseOut,
        input.listHref,
      );
      rows.push({
        id,
        displayName: name || "Customer",
        company,
        contactLine,
        phone,
        city,
        sourceLabel,
        stageLabel: stage.label,
        stageClassName: stage.className,
        assignedLabel,
        hasAssignee: !!assignedId,
        updatedDisplay,
        overdue: due != null && due < now,
        activityLine: formatCustomerActivityLine(activity),
        moneyLine: moneyLine(activity),
        hasActions: !!quick,
        sort: {
          name: (name || "Customer").toLowerCase(),
          assigned: assignedLabel.toLowerCase(),
          stage: stage.position,
          phone: phone.toLowerCase(),
          city: city.toLowerCase(),
          source: sourceLabel.toLowerCase(),
          updated: updatedSort,
        },
        quick,
      });
    } catch (error) {
      dropped += 1;
      logCustomersPhase("customers.transform", "failure", {
        field: "row",
        error_type: error instanceof Error ? error.name : "throw",
        customer_id: customerIdForLog(id),
        message: error instanceof Error ? error.message : "",
      });
    }
  }

  return { rows, dropped };
}
