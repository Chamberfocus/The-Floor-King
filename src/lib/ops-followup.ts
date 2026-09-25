/**
 * Business-ops follow-up helpers — pure.
 *
 * Reuses office_tasks source_key idempotency. Does not invent a second
 * task engine, AR ledger, or job status model.
 */
import { assessMaterialsReadyForSchedule } from "@/lib/materials-ready";

export const ESTIMATE_FOLLOWUP_KIND = "estimate_followup";
export const DEPOSIT_DUE_KIND = "deposit_due";
export const COLLECT_BALANCE_KIND = "collect_balance";
export const SERVICE_CALLBACK_KIND = "service_callback";
export const INSTALLER_ISSUE_KIND = "installer_issue";

export const DEFAULT_ESTIMATE_FOLLOWUP_DAYS = 2;
export const DEFAULT_DEPOSIT_FOLLOWUP_DAYS = 1;
export const DEFAULT_SNOOZE_DAYS = 3;
export const ALLOWED_SNOOZE_DAYS = [1, 3, 7] as const;

export function followUpDueAt(
  from: Date,
  days: number = DEFAULT_ESTIMATE_FOLLOWUP_DAYS,
): string {
  const d = new Date(from.getTime());
  const n = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : DEFAULT_ESTIMATE_FOLLOWUP_DAYS;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString();
}

export function snoozeDueAt(
  from: Date,
  days: number = DEFAULT_SNOOZE_DAYS,
): string {
  const allowed = (ALLOWED_SNOOZE_DAYS as readonly number[]).includes(days)
    ? days
    : DEFAULT_SNOOZE_DAYS;
  return followUpDueAt(from, allowed);
}

export function shouldCreateEstimateFollowup(status: string): boolean {
  return status === "sent";
}

export function shouldStopEstimateFollowup(status: string): boolean {
  return status === "approved" || status === "declined";
}

export function hasActiveDepositOnFile(args: {
  availableDeposit: number;
  appliedDeposit: number;
}): boolean {
  return (
    (Number(args.availableDeposit) || 0) + (Number(args.appliedDeposit) || 0) >=
    0.005
  );
}

export function shouldCreateDepositDueTask(args: {
  estimateStatus: string;
  availableDeposit: number;
  appliedDeposit: number;
}): boolean {
  if (args.estimateStatus !== "approved") return false;
  return !hasActiveDepositOnFile(args);
}

/** Numeric PO search — never ilike an integer po_number column. */
export function parsePoNumberQuery(q: string): number | null {
  const t = q.trim();
  if (!/^\d{1,9}$/.test(t)) return null;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Strip PostgREST `.or()` separators and LIKE wildcards from user search input. */
export function sanitizeIlikeQuery(q: string): string {
  return q
    .replace(/[%_,()\\*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const AUTOMATION_SOURCE_KINDS = [
  ESTIMATE_FOLLOWUP_KIND,
  DEPOSIT_DUE_KIND,
  COLLECT_BALANCE_KIND,
  SERVICE_CALLBACK_KIND,
  INSTALLER_ISSUE_KIND,
] as const;

export type AutomationSourceKind = (typeof AUTOMATION_SOURCE_KINDS)[number];

export function isAutomationSourceKind(
  kind: string,
): kind is AutomationSourceKind {
  return (AUTOMATION_SOURCE_KINDS as readonly string[]).includes(kind);
}

/** Complete-by-prefix is only safe after the kind is allowlisted (no LIKE metachars). */
export function automationSourceKeyPrefix(kind: string): string | null {
  if (!isAutomationSourceKind(kind)) return null;
  return `${kind}:`;
}

export function maySnoozeCustomerFollowup(args: {
  role: string;
  actorId: string;
  assignedTo: string | null | undefined;
  workflowOwnerId: string | null | undefined;
}): boolean {
  if (["admin", "office", "sales_manager"].includes(args.role)) return true;
  if (args.role !== "salesman") return false;
  return (
    args.assignedTo === args.actorId || args.workflowOwnerId === args.actorId
  );
}

export function installerMayReportIssue(args: {
  role: string;
  actorId: string;
  assignedTo: string | null | undefined;
  assignedCrewId: string | null | undefined;
  memberCrewIds: readonly string[];
}): boolean {
  if (["admin", "office"].includes(args.role)) return true;
  if (args.role !== "crew") return false;
  if (!args.actorId) return false;
  if (args.assignedTo === args.actorId) return true;
  const crewId = args.assignedCrewId ?? null;
  return Boolean(crewId && args.memberCrewIds.includes(crewId));
}

/** Same crew, same job, same description, still open → reuse (no duplicate callback). */
export function reuseOpenInstallerIssueId(args: {
  existingOpen: { id: string; description: string | null }[];
  description: string;
}): string | null {
  const want = args.description.trim();
  if (!want) return null;
  const hit = args.existingOpen.find((r) => (r.description ?? "").trim() === want);
  return hit?.id ?? null;
}

export function shouldCreateCollectBalanceTask(args: {
  jobStatus: string;
  openBalance: number;
}): boolean {
  if (args.jobStatus !== "completed") return false;
  return (Number(args.openBalance) || 0) > 0.5;
}

export type CollectionBucket = "paid" | "current" | "due_soon" | "overdue";

export function classifyInvoiceCollection(args: {
  status: string;
  dueDate: string | null | undefined;
  balance: number;
  now?: Date;
}): CollectionBucket {
  const bal = Number(args.balance) || 0;
  if (args.status === "void" || args.status === "draft") return "paid";
  if (bal <= 0.5) return "paid";
  const due = (args.dueDate ?? "").slice(0, 10);
  if (!due) return args.status === "partial" ? "due_soon" : "current";
  const today = (args.now ?? new Date()).toISOString().slice(0, 10);
  if (due < today) return "overdue";
  if (due === today) return "due_soon";
  return "current";
}

export function splitUnscheduledByMaterialsReady<
  T extends {
    warehouseReadyAt: string | null | undefined;
    hasMaterialNeed: boolean;
  },
>(jobs: T[]): { ready: T[]; blocked: T[] } {
  const ready: T[] = [];
  const blocked: T[] = [];
  for (const job of jobs) {
    const readyToBook = assessMaterialsReadyForSchedule({
      warehouseReadyAt: job.warehouseReadyAt,
      hasMaterialNeed: job.hasMaterialNeed,
    }).ready;
    if (readyToBook) ready.push(job);
    else blocked.push(job);
  }
  return { ready, blocked };
}

export const INSTALLER_ISSUE_CATEGORIES = [
  { value: "shortage", label: "Shortage" },
  { value: "damage", label: "Damaged material" },
  { value: "subfloor", label: "Subfloor / prep issue" },
  { value: "extra_work", label: "Extra work needed" },
  { value: "cannot_complete", label: "Cannot complete today" },
  { value: "return_trip", label: "Return trip needed" },
  { value: "customer_issue", label: "Customer issue" },
  { value: "installation", label: "Other install issue" },
] as const;

export type InstallerIssueCategory =
  (typeof INSTALLER_ISSUE_CATEGORIES)[number]["value"];

const CALLBACK_CATEGORY: Record<InstallerIssueCategory, string> = {
  shortage: "material",
  damage: "damage",
  subfloor: "floor_movement",
  extra_work: "repair",
  cannot_complete: "installation",
  return_trip: "installation",
  customer_issue: "other",
  installation: "installation",
};

export function isInstallerIssueCategory(
  value: string,
): value is InstallerIssueCategory {
  return INSTALLER_ISSUE_CATEGORIES.some((c) => c.value === value);
}

export function callbackCategoryForIssue(value: string): string {
  if (isInstallerIssueCategory(value)) return CALLBACK_CATEGORY[value];
  return "installation";
}

export function installerIssueTitle(
  category: string,
  customerName: string,
): string {
  const label =
    INSTALLER_ISSUE_CATEGORIES.find((c) => c.value === category)?.label ??
    "Install issue";
  const who = customerName.trim() || "job";
  return `${label}: ${who}`;
}

export type OpsQueueId =
  | "follow_up"
  | "deposit"
  | "order"
  | "material"
  | "schedule"
  | "install_today"
  | "collect"
  | "callback"
  | "customer_order";

export function opsQueueLabel(id: OpsQueueId): string {
  switch (id) {
    case "follow_up":
      return "Follow up today";
    case "deposit":
      return "Deposit due";
    case "order":
      return "Need to order";
    case "material":
      return "Waiting on material";
    case "schedule":
      return "Ready — not scheduled";
    case "install_today":
      return "Installs today";
    case "collect":
      return "Collect balance";
    case "callback":
      return "Service / callback";
    case "customer_order":
      return "Customer orders";
  }
}
