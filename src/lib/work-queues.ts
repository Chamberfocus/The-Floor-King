/**
 * Operational list queues.
 *
 * These helpers choose which records to show. They do not decide the next
 * step on a record — that stays in the Record Action Center.
 */
import { flooringJobSnapshot, type JobSnapshotInput } from "@/lib/job-snapshot";
import type { UserRole } from "@/lib/types";

export const WORK_QUEUE_PAGE_SIZE = 40;

export type OrderQueueView = "review" | "approved" | "declined" | "all";
export type EstimateQueueView = "all" | "draft" | "sent" | "followup" | "approved";
export type InvoiceQueueView = "open" | "partial" | "paid" | "overdue" | "all";
export type PoQueueView = "open" | "ordered" | "received" | "all";
export type JobQueueView =
  | "open"
  | "material"
  | "ready"
  | "scheduled"
  | "installing"
  | "completed"
  | "service"
  | "all";
export type ServiceQueueView = "open" | "scheduled" | "completed" | "all";
export type TaskQueueView = "mine" | "open" | "overdue" | "completed";

const ORDER_VIEWS: OrderQueueView[] = ["review", "approved", "declined", "all"];
const ESTIMATE_VIEWS: EstimateQueueView[] = ["all", "draft", "sent", "followup", "approved"];
const INVOICE_VIEWS: InvoiceQueueView[] = ["open", "partial", "paid", "overdue", "all"];
const PO_VIEWS: PoQueueView[] = ["open", "ordered", "received", "all"];
const JOB_VIEWS: JobQueueView[] = [
  "open",
  "material",
  "ready",
  "scheduled",
  "installing",
  "completed",
  "service",
  "all",
];
const SERVICE_VIEWS: ServiceQueueView[] = ["open", "scheduled", "completed", "all"];
const TASK_VIEWS: TaskQueueView[] = ["mine", "open", "overdue", "completed"];

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function parseListPage(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

export function listPageWindow(page: number, pageSize: number, total: number) {
  const pages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), pages);
  const from = (safePage - 1) * pageSize;
  const to = Math.min(total, from + pageSize);
  return { page: safePage, pages, from, to, pageSize, total };
}

export function parseOrderQueue(value: string | undefined): OrderQueueView {
  return oneOf(value, ORDER_VIEWS, "review");
}
export function parseEstimateQueue(value: string | undefined): EstimateQueueView {
  return oneOf(value, ESTIMATE_VIEWS, "all");
}
export function parseInvoiceQueue(value: string | undefined): InvoiceQueueView {
  return oneOf(value, INVOICE_VIEWS, "open");
}
export function parsePoQueue(value: string | undefined): PoQueueView {
  return oneOf(value, PO_VIEWS, "open");
}
export function parseJobQueue(value: string | undefined, role: UserRole): JobQueueView {
  if (value && (JOB_VIEWS as readonly string[]).includes(value)) return value as JobQueueView;
  return role === "scheduler" ? "ready" : "open";
}
export function parseServiceQueue(value: string | undefined): ServiceQueueView {
  return oneOf(value, SERVICE_VIEWS, "open");
}
export function parseTaskQueue(value: string | undefined, role: UserRole): TaskQueueView {
  if (role === "salesman") return value === "completed" ? "completed" : value === "overdue" ? "overdue" : "mine";
  return oneOf(value, TASK_VIEWS, "open");
}

/** Salesman starts on their own jobs. All stays one click away. */
export function jobQueueMine(who: string | undefined, role: UserRole): boolean {
  if (role === "crew") return true;
  if (who === "all") return false;
  if (who === "mine") return true;
  return role === "salesman";
}

export function estimateQueueMine(who: string | undefined, role: UserRole): boolean {
  if (who === "all") return false;
  if (who === "mine") return true;
  return role === "salesman";
}

export function orderStatusesForView(view: OrderQueueView): string[] | null {
  if (view === "review") return ["submitted"];
  if (view === "approved") return ["approved"];
  if (view === "declined") return ["declined", "cancelled"];
  return null;
}

export function estimateStatusForView(view: EstimateQueueView): string | null {
  if (view === "draft") return "draft";
  if (view === "sent" || view === "followup") return "sent";
  if (view === "approved") return "approved";
  return null;
}

export function invoiceStatusesForView(view: InvoiceQueueView): string[] | null {
  if (view === "open") return ["sent", "partial"];
  if (view === "partial") return ["partial"];
  if (view === "paid") return ["paid"];
  if (view === "overdue") return ["sent", "partial"];
  return null;
}

export function poStatusesForView(view: PoQueueView): string[] | null {
  if (view === "open") return ["draft", "ordered"];
  if (view === "ordered") return ["ordered"];
  if (view === "received") return ["received", "closed"];
  return null;
}

export function serviceStatusesForView(view: ServiceQueueView): string[] | null {
  if (view === "all") return null;
  if (view === "scheduled") return ["scheduled"];
  if (view === "completed") return ["resolved"];
  return ["open", "in_progress", "waiting"];
}

export function serviceQueueStatusLabel(status: string): string {
  if (status === "scheduled") return "Scheduled";
  if (status === "resolved") return "Completed";
  if (status === "cancelled") return "Cancelled";
  return "Service open";
}

export function serviceQueueKindLabel(category: string): string {
  const labels: Record<string, string> = {
    installation: "Install issue",
    material: "Material",
    damage: "Damage",
    transition_trim: "Trim",
    floor_movement: "Floor movement",
    repair: "Repair",
    manufacturer: "Manufacturer",
    other: "Service",
  };
  return labels[category] ?? "Service";
}

/** One factual line for a job card. Not an instruction. */
export function jobQueueFact(input: JobSnapshotInput): string {
  const snap = flooringJobSnapshot(input);
  return snap.chips.slice(0, 2).join(" · ") || snap.fact;
}

export function orderQueueEmpty(view: OrderQueueView, searching: boolean): string {
  if (searching) return "No orders match that search.";
  if (view === "review") return "No orders are waiting for review.";
  if (view === "approved") return "No approved orders in this list.";
  if (view === "declined") return "No declined orders in this list.";
  return "No orders yet.";
}

export function estimateQueueEmpty(view: EstimateQueueView, searching: boolean): string {
  if (searching) return "No estimates match that search.";
  if (view === "followup") return "No estimates need follow-up.";
  if (view === "sent") return "No sent estimates.";
  if (view === "draft") return "No draft estimates.";
  if (view === "approved") return "No approved estimates.";
  return "No estimates yet.";
}

export function jobQueueEmpty(view: JobQueueView, searching: boolean): string {
  if (searching) return "No jobs match that search.";
  if (view === "material") return "No jobs are waiting for material.";
  if (view === "ready") return "No jobs are ready to schedule.";
  if (view === "scheduled") return "No installs are booked.";
  if (view === "installing") return "No jobs are installing.";
  if (view === "completed") return "No completed jobs in this list.";
  if (view === "service") return "No jobs have an open service call.";
  if (view === "open") return "No open jobs.";
  return "No jobs yet.";
}

export function invoiceQueueEmpty(view: InvoiceQueueView, searching: boolean): string {
  if (searching) return "No invoices match that search.";
  if (view === "overdue") return "No invoices are overdue.";
  if (view === "paid") return "No paid invoices in this list.";
  if (view === "partial") return "No invoices with a partial payment.";
  if (view === "open") return "No open invoices.";
  return "No invoices yet.";
}

export function poQueueEmpty(view: PoQueueView, searching: boolean): string {
  if (searching) return "No purchase orders match that search.";
  if (view === "open") return "No open purchase orders.";
  if (view === "ordered") return "No purchase orders are out with a vendor.";
  if (view === "received") return "No received purchase orders in this list.";
  return "No purchase orders yet.";
}

export function serviceQueueEmpty(view: ServiceQueueView, searching: boolean): string {
  if (searching) return "No service calls match that search.";
  if (view === "open") return "No open service calls.";
  if (view === "scheduled") return "No service calls are scheduled.";
  if (view === "completed") return "No completed service calls in this list.";
  return "No service calls yet.";
}

export function taskQueueEmpty(view: TaskQueueView, searching: boolean): string {
  if (searching) return "No tasks match that search.";
  if (view === "overdue") return "No tasks are overdue.";
  if (view === "completed") return "No completed tasks in this list.";
  if (view === "mine") return "No tasks are assigned to you.";
  return "No open tasks.";
}

export function resultCountLabel(shown: number, total: number, noun: string): string {
  const word = total === 1 ? noun : `${noun}s`;
  if (total === 0) return `0 ${word}`;
  if (shown === total) return `${total} ${word}`;
  return `Showing ${shown} of ${total} ${word}`;
}

export const MONEY_LIST_ROLES: UserRole[] = ["admin", "office", "sales_manager", "salesman"];
export const ORDER_LIST_ROLES: UserRole[] = ["admin", "office"];
export const TASK_LIST_ROLES: UserRole[] = ["admin", "office", "sales_manager", "salesman"];
export const SERVICE_LIST_ROLES: UserRole[] = [
  "admin",
  "office",
  "sales_manager",
  "salesman",
  "scheduler",
];

export function roleSeesMoneyList(role: UserRole): boolean {
  return MONEY_LIST_ROLES.includes(role);
}
