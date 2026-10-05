/**
 * Archive is customers.cancelled_at.
 * There is no second archive column.
 *
 * READ RULE: an archived customer does not participate in active operational
 * queues. Completed work, resolved service, and the All list stay searchable.
 * Queue filters are presentation. Hiding a row does not stop a write.
 *
 * WRITE RULE: an archived customer cannot receive new active operational work.
 * newActiveOperationalWorkAllowed is that rule. Scheduling is also enforced
 * inside schedule_job_install_safe, which locks the customer row before it
 * writes the job. Both rules read customers.cancelled_at. They are different
 * checks. Closing, completing, or correcting history is not new work.
 *
 * Archive is an operational stop. It does not rewrite job status, invoices,
 * payments, or history.
 */

export const ARCHIVED_CUSTOMER_SCHEDULE_ERROR =
  "This customer is archived and cannot be scheduled.";

export function customerIsArchived(
  cancelledAt: string | null | undefined,
): boolean {
  return typeof cancelledAt === "string" && cancelledAt.length > 0;
}

export function newActiveOperationalWorkAllowed(
  cancelledAt: string | null | undefined,
): boolean {
  return !customerIsArchived(cancelledAt);
}

/**
 * A status change that opens or restarts operational work.
 * Completing or cancelling a job is not new work.
 * Editing a job without changing its status is not new work.
 */
export function jobStatusChangeIsNewActiveWork(from: string, to: string): boolean {
  if (from === to) return false;
  return to === "unscheduled" || to === "scheduled" || to === "in_progress";
}

export type ScheduleWriteRefusal = {
  ok: false;
  code: "SCHEDULE_CUSTOMER_ARCHIVED" | "SCHEDULE_CANCELLED";
  error: string;
};

/**
 * Same decision schedule_job_install_safe makes after it locks the job and
 * the owning customer. The database function is authoritative. This is the
 * shared description of that decision for tests and for the friendly message.
 */
export function scheduleWriteDecision(args: {
  customerCancelledAt: string | null | undefined;
  jobStatus: string | null | undefined;
}): { ok: true } | ScheduleWriteRefusal {
  if (args.jobStatus === "cancelled") {
    return {
      ok: false,
      code: "SCHEDULE_CANCELLED",
      error: "Cannot schedule a cancelled job.",
    };
  }
  if (!newActiveOperationalWorkAllowed(args.customerCancelledAt)) {
    return {
      ok: false,
      code: "SCHEDULE_CUSTOMER_ARCHIVED",
      error: ARCHIVED_CUSTOMER_SCHEDULE_ERROR,
    };
  }
  return { ok: true };
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
  return newActiveOperationalWorkAllowed(cancelledAt);
}
