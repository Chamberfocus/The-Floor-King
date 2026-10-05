/**
 * Archive is customers.cancelled_at.
 * There is no second archive column.
 *
 * Archive is an operational stop. It does not rewrite job status, invoices,
 * payments, or history. Active queues derive "leave this alone" from the
 * customer flag. Completed work and the All list stay searchable.
 */

export function customerIsArchived(
  cancelledAt: string | null | undefined,
): boolean {
  return typeof cancelledAt === "string" && cancelledAt.length > 0;
}

/** Job queues that ask someone to do something now. */
export const ACTIVE_OPERATIONAL_JOB_QUEUES = [
  "material",
  "ready",
  "service",
  "open",
  "scheduled",
  "installing",
  "warehouse_active",
  "warehouse_staged",
  "scheduler_ready",
  "scheduler_booked",
] as const;

export type ActiveOperationalJobQueue =
  (typeof ACTIVE_OPERATIONAL_JOB_QUEUES)[number];

export function activeOperationalQueueExcludesArchivedCustomer(
  queue: string,
): boolean {
  return (ACTIVE_OPERATIONAL_JOB_QUEUES as readonly string[]).includes(queue);
}

/**
 * Week and day calendars. A cancelled install is not a booking.
 * An archived customer's open install is not a booking.
 * A completed install can still show on the day it happened.
 */
export function showOnActiveInstallCalendar(args: {
  status: string | null | undefined;
  customerCancelledAt: string | null | undefined;
}): boolean {
  if (args.status === "cancelled") return false;
  if (customerIsArchived(args.customerCancelledAt)) return false;
  return true;
}

/** Open service work. Resolved and cancelled callbacks are history. */
export const ACTIVE_SERVICE_STATUSES = [
  "open",
  "scheduled",
  "in_progress",
  "waiting",
] as const;

/**
 * Active service views omit archived customers.
 * Resolved, cancelled, and the All browse keep them.
 * There is no separate warranty flag. An open callback is operational work.
 */
export function serviceQueueKeepsArchivedCustomer(
  statuses: readonly string[] | null | undefined,
): boolean {
  if (!statuses || statuses.length === 0) return true;
  return statuses.some(
    (status) => status === "resolved" || status === "cancelled",
  );
}

/** Completed task view is history. Open, overdue, and mine are attention. */
export function taskQueueKeepsArchivedCustomer(view: string): boolean {
  return view === "completed";
}

/**
 * Sent and draft estimates are sales attention.
 * Approved, declined, and the full list stay searchable.
 */
export function estimateQueueKeepsArchivedCustomer(
  status: string | null | undefined,
): boolean {
  return status !== "sent" && status !== "draft";
}

/**
 * Submitted and approved orders are open operational work.
 * A browse, or a declined/cancelled view, keeps archived customers.
 */
export function orderQueueKeepsArchivedCustomer(
  statuses: readonly string[] | null | undefined,
): boolean {
  if (!statuses || statuses.length === 0) return true;
  return statuses.some(
    (status) => status === "declined" || status === "cancelled",
  );
}

export function scheduleChangeAllowed(cancelledAt: string | null | undefined): boolean {
  return !customerIsArchived(cancelledAt);
}
