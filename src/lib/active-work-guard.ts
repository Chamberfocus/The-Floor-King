/**
 * Server-side write rule for new active operational work.
 * customers.cancelled_at is the only archive flag.
 * A queue that hides the customer is not this check.
 * The schedule booking itself is refused again inside schedule_job_install_safe.
 */
import { newActiveOperationalWorkAllowed } from "@/lib/customer-operational";

export const ARCHIVED_NEW_WORK_ERROR =
  "This customer is archived and cannot receive new work. Restore them first.";

// Supabase clients differ by cookie vs service role. The check only needs a read.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RowDb = { from: (table: string) => any };

function asCancelledAt(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function loadCustomerCancelledAt(
  db: RowDb,
  customerId: string | null | undefined,
): Promise<string | null> {
  if (!customerId) return null;
  const { data } = await db
    .from("customers")
    .select("cancelled_at")
    .eq("id", customerId)
    .maybeSingle();
  return asCancelledAt(data?.cancelled_at);
}

export async function loadJobCustomerCancelledAt(
  db: RowDb,
  jobId: string,
): Promise<string | null> {
  const { data } = await db
    .from("jobs")
    .select("customer_id, customer:customers(cancelled_at)")
    .eq("id", jobId)
    .maybeSingle();
  if (!data) return null;
  const embedded = Array.isArray(data.customer) ? data.customer[0] : data.customer;
  if (embedded && typeof embedded === "object" && "cancelled_at" in embedded) {
    return asCancelledAt(embedded.cancelled_at);
  }
  return loadCustomerCancelledAt(db, data.customer_id as string | null);
}

/** Null when the write may proceed. The sentence when it must not. */
export async function refuseNewActiveWorkForCustomer(
  db: RowDb,
  customerId: string | null | undefined,
): Promise<string | null> {
  if (!customerId) return null;
  const cancelledAt = await loadCustomerCancelledAt(db, customerId);
  if (!newActiveOperationalWorkAllowed(cancelledAt)) return ARCHIVED_NEW_WORK_ERROR;
  return null;
}

/** Null when the write may proceed. The sentence when it must not. */
export async function refuseNewActiveWorkForJob(
  db: RowDb,
  jobId: string,
): Promise<string | null> {
  const cancelledAt = await loadJobCustomerCancelledAt(db, jobId);
  if (!newActiveOperationalWorkAllowed(cancelledAt)) return ARCHIVED_NEW_WORK_ERROR;
  return null;
}
