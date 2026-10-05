/**
 * Queue membership rules shared with job_queue_page
 * (0478_ops_queue_scale.sql, archive exclusion in 0483_archived_customer_active_queues.sql).
 * The database pages the real lists. These functions let tests prove a match
 * past the old 200-row cap is still on a later page.
 * They do not choose a next step.
 */
import { assessMaterialsReadyForSchedule } from "@/lib/materials-ready";
import { customerIsArchived } from "@/lib/customer-operational";
import { isMaterialLine } from "@/lib/job-scope";
import { phoneSearchPattern } from "@/lib/search-query";
import { listPageWindow, WORK_QUEUE_PAGE_SIZE } from "@/lib/work-queues";

export const QUEUE_LIST_UNAVAILABLE =
  "This list is temporarily unavailable. Please try again.";

export function logQueueFailure(op: string, error: unknown) {
  const err = error as { code?: string; message?: string };
  console.error(op, err?.code ?? "", err?.message ?? error);
}

/** Employee-facing list failure. Never returns SQL, Postgres, or migration text. */
export function queueFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message === QUEUE_LIST_UNAVAILABLE) return error.message;
  logQueueFailure("queue-page", error);
  return QUEUE_LIST_UNAVAILABLE;
}

export function recordsOnPage<T>(rows: T[], page: number, pageSize = WORK_QUEUE_PAGE_SIZE): T[] {
  const window = listPageWindow(page, pageSize, rows.length);
  return rows.slice(window.from, window.to);
}

export interface ScaleCustomer {
  id: string;
  fullName: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  street?: string | null;
  city?: string | null;
  zip?: string | null;
}

export function customerSearchMatches(row: ScaleCustomer, query: string): boolean {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  const digits = query.replace(/\D/g, "");
  const phoneDigits = (row.phone ?? "").replace(/\D/g, "");
  const hay = [row.fullName, row.company, row.email, row.street, row.city, row.zip]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (hay.includes(text)) return true;
  if (digits.length >= 7 && phoneDigits.includes(digits)) return true;
  const pattern = phoneSearchPattern(query);
  if (!pattern || !row.phone) return false;
  const parts = pattern.split("%").filter(Boolean);
  let rest = row.phone;
  for (const part of parts) {
    const at = rest.indexOf(part);
    if (at < 0) return false;
    rest = rest.slice(at + part.length);
  }
  return true;
}

export interface ScaleJob {
  id: string;
  status: string;
  scheduledDate?: string | null;
  warehouseReadyAt?: string | null;
  hasMaterialNeed: boolean;
  serviceOpen?: boolean;
  /** Present only so a test can prove a PO does not change the queue. */
  purchaseOrders?: { status?: string | null }[];
  /** customers.cancelled_at. Active queues omit archived customers. */
  customerCancelledAt?: string | null;
}

export function jobHasMaterialNeed(
  lines: {
    category?: string | null;
    line_type?: string | null;
    product_id?: string | null;
    manufacturer?: string | null;
    color?: string | null;
    sqft_per_box?: number | null;
    roll_width_ft?: number | null;
  }[],
): boolean {
  return lines.some((line) => isMaterialLine(line));
}

function materialsReady(job: ScaleJob): boolean {
  return assessMaterialsReadyForSchedule({
    hasMaterialNeed: job.hasMaterialNeed,
    warehouseReadyAt: job.warehouseReadyAt,
  }).ready;
}

const OPEN_JOB = new Set(["unscheduled", "scheduled", "in_progress"]);

function archivedCustomer(job: { customerCancelledAt?: string | null }): boolean {
  return customerIsArchived(job.customerCancelledAt);
}

/** Canonical queue membership. Purchase orders and deposits are not inputs. */
export function jobQueueIncludes(job: ScaleJob, queue: "material" | "ready" | "service"): boolean {
  if (archivedCustomer(job)) return false;
  if (queue === "service") return OPEN_JOB.has(job.status) && !!job.serviceOpen;
  if (queue === "material") {
    return OPEN_JOB.has(job.status) && !job.warehouseReadyAt && job.hasMaterialNeed;
  }
  return (
    job.status === "unscheduled" &&
    !job.scheduledDate &&
    materialsReady(job)
  );
}

export interface ScaleInvoice {
  id: string;
  status: string;
  dueDate: string | null;
  /** Canonical remaining balance (invoiceAmountDue / invoice_open_ar_balance). */
  balance: number;
}

/** Same overdue rule as invoice_overdue_page: open status, due before today, balance > 0.5. */
export function invoiceIsOverdue(row: ScaleInvoice, today: string): boolean {
  if (row.status === "void") return false;
  if (row.status !== "sent" && row.status !== "partial") return false;
  if (!row.dueDate || row.dueDate >= today) return false;
  return row.balance > 0.5;
}

export function schedulerQueueIncludes(job: ScaleJob, section: "ready" | "booked"): boolean {
  if (archivedCustomer(job)) return false;
  if (section === "ready") return jobQueueIncludes(job, "ready");
  return (
    !!job.scheduledDate &&
    (job.status === "scheduled" || job.status === "in_progress")
  );
}

const STAGED = new Set(["staged", "out_for_delivery", "delivered", "picked_up"]);

export function warehouseSectionIncludes(
  job: {
    status: string;
    warehouseStatus: string | null;
    customerCancelledAt?: string | null;
  },
  section: "active" | "staged",
): boolean {
  if (archivedCustomer(job)) return false;
  if (!OPEN_JOB.has(job.status)) return false;
  const staged = job.warehouseStatus != null && STAGED.has(job.warehouseStatus);
  return section === "staged" ? staged : !staged;
}
