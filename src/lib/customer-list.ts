/**
 * Customer list contract — one row per customers.id.
 *
 * The Customers page is an entity list, not a job/order/invoice list.
 * Aggregates MUST be computed from independent collections keyed by
 * customer_id. Never SUM() across a multi-table join (Cartesian fan-out
 * multiplies money and counts).
 *
 * Canonical identity is customer.id. Do not merge/dedupe by name, phone,
 * email, or address in the list query.
 */
import {
  computeJobOpenBalance,
  invoiceTotals,
  type JobBalanceInvoiceInput,
} from "@/lib/invoice-calc";
import {
  normalizeAddressKey,
  normalizeEmail,
  normalizePersonName,
  normalizePhoneDigits,
} from "@/lib/customer-duplicate";

export const OPEN_JOB_STATUSES = [
  "unscheduled",
  "scheduled",
  "in_progress",
] as const;

export type CustomerListJob = {
  id: string;
  customer_id: string;
  status: string | null;
  delivery_type: string | null;
  title?: string | null;
  site_street?: string | null;
  site_city?: string | null;
  site_state?: string | null;
  site_zip?: string | null;
};

export type CustomerListEstimate = {
  id: string;
  customer_id: string;
};

export type CustomerListInvoice = JobBalanceInvoiceInput & {
  customer_id: string;
  job_id?: string | null;
  counter_sale?: boolean | null;
  number?: string | null;
};

export type CustomerListOrder = {
  id: string;
  customer_id: string | null;
  status: string | null;
  job_id?: string | null;
};

export type CustomerListIdentity = {
  id: string;
  full_name: string;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  assigned_to?: string | null;
  workflow_owner_id?: string | null;
};

export type CustomerListActivity = {
  totalJobs: number;
  openJobs: number;
  completedJobs: number;
  estimateCount: number;
  cashAndCarryCount: number;
  invoiceCount: number;
  openBalance: number;
  lifetimeSales: number;
  previewJobs: { id: string; title: string; status: string }[];
};

export const EMPTY_CUSTOMER_LIST_ACTIVITY: CustomerListActivity = {
  totalJobs: 0,
  openJobs: 0,
  completedJobs: 0,
  estimateCount: 0,
  cashAndCarryCount: 0,
  invoiceCount: 0,
  openBalance: 0,
  lifetimeSales: 0,
  previewJobs: [],
};

export function isCashCarryJob(job: {
  delivery_type?: string | null;
}): boolean {
  return job.delivery_type === "cash_carry";
}

export function isActiveJobStatus(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return s !== "cancelled";
}

export function isOpenInstallStatus(status: string | null | undefined): boolean {
  return (OPEN_JOB_STATUSES as readonly string[]).includes(
    (status ?? "").toLowerCase(),
  );
}

/** Keep the first occurrence of each customer.id.
 *  Distinct UUIDs are never collapsed — this is not a name/phone merge. */
export function uniqueCustomersById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (!row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export function uniqueIds(ids: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function paginateByCustomerId<T extends { id: string }>(
  rows: T[],
  page: number,
  pageSize: number,
): { rows: T[]; total: number; page: number; pageSize: number } {
  const unique = uniqueCustomersById(rows);
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const total = unique.length;
  const lastPage = Math.max(1, Math.ceil(total / size) || 1);
  const p = Math.min(Math.max(1, Math.floor(page) || 1), lastPage);
  const start = (p - 1) * size;
  return {
    rows: unique.slice(start, start + size),
    total,
    page: p,
    pageSize: size,
  };
}

function hay(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

/**
 * Identity + contact search. Job/address hits are passed in as related
 * customer ids (from EXISTS/subquery), never by joining those tables into
 * the list result.
 */
export function customerMatchesSearch(
  customer: CustomerListIdentity,
  rawTerm: string,
  relatedCustomerIds?: Iterable<string>,
): boolean {
  const term = rawTerm.trim().toLowerCase();
  if (!term) return true;
  const related = relatedCustomerIds ? new Set(relatedCustomerIds) : null;
  if (related?.has(customer.id)) return true;
  const fields = [
    customer.full_name,
    customer.company,
    customer.phone,
    customer.email,
    customer.street,
    customer.city,
    customer.state,
    customer.zip,
  ];
  return fields.some((f) => hay(f).includes(term));
}

/** RLS rule for salesman: assigned book OR current workflow owner. */
export function salesmanMaySeeCustomer(
  customer: CustomerListIdentity,
  salesmanId: string,
): boolean {
  if (!salesmanId) return false;
  return (
    customer.assigned_to === salesmanId ||
    customer.workflow_owner_id === salesmanId
  );
}

export function relatedCustomerIdsForSearch(
  term: string,
  jobs: CustomerListJob[],
  invoices: Pick<CustomerListInvoice, "customer_id" | "number">[],
): string[] {
  const q = term.trim().toLowerCase();
  if (!q) return [];
  const ids: string[] = [];
  for (const j of jobs) {
    const blob = [
      j.title,
      j.id,
      j.site_street,
      j.site_city,
      j.site_state,
      j.site_zip,
    ]
      .map(hay)
      .join(" ");
    if (blob.includes(q)) ids.push(j.customer_id);
  }
  for (const inv of invoices) {
    if (hay(inv.number).includes(q)) ids.push(inv.customer_id);
  }
  return uniqueIds(ids);
}

/**
 * Per-customer activity from independent collections.
 * Jobs / estimates / invoices / orders are grouped by customer_id; a customer
 * with 2 jobs × 3 invoices still contributes 2 jobs and 3 invoices — never 6.
 */
export function buildCustomerListActivity(
  customerId: string,
  jobs: CustomerListJob[],
  estimates: CustomerListEstimate[],
  invoices: CustomerListInvoice[],
  orders: CustomerListOrder[] = [],
): CustomerListActivity {
  const mineJobs = jobs.filter((j) => j.customer_id === customerId);
  const installJobs = mineJobs.filter(
    (j) => isActiveJobStatus(j.status) && !isCashCarryJob(j),
  );
  const cashCarryJobs = mineJobs.filter(
    (j) => isActiveJobStatus(j.status) && isCashCarryJob(j),
  );
  const cashCarryJobIds = new Set(cashCarryJobs.map((j) => j.id));

  const mineEstimates = estimates.filter((e) => e.customer_id === customerId);
  const mineInvoices = invoices.filter((i) => i.customer_id === customerId);
  const liveInvoices = mineInvoices.filter(
    (i) => (i.status ?? "").toLowerCase() !== "void",
  );

  const mineOrders = orders.filter(
    (o) =>
      o.customer_id === customerId &&
      o.status !== "cancelled" &&
      o.status !== "declined",
  );

  const counterSaleWithoutJob = liveInvoices.filter((i) => {
    if (!i.counter_sale) return false;
    if (i.job_id && cashCarryJobIds.has(i.job_id)) return false;
    return true;
  });

  const ordersWithoutJob = mineOrders.filter(
    (o) => !o.job_id || !cashCarryJobIds.has(o.job_id),
  );

  const openBalance = computeJobOpenBalance(mineInvoices).balance;
  let lifetimeSales = 0;
  for (const inv of liveInvoices) {
    lifetimeSales += invoiceTotals(inv.items ?? [], inv.tax_rate, 0).total;
  }
  lifetimeSales = Math.round(lifetimeSales * 100) / 100;

  const previewJobs = installJobs.slice(0, 3).map((j) => ({
    id: j.id,
    title: (j.title ?? "").trim() || "Job",
    status: (j.status ?? "unscheduled") as string,
  }));

  return {
    totalJobs: installJobs.length,
    openJobs: installJobs.filter((j) => isOpenInstallStatus(j.status)).length,
    completedJobs: installJobs.filter(
      (j) => (j.status ?? "").toLowerCase() === "completed",
    ).length,
    estimateCount: mineEstimates.length,
    cashAndCarryCount:
      cashCarryJobs.length +
      counterSaleWithoutJob.length +
      ordersWithoutJob.length,
    invoiceCount: liveInvoices.length,
    openBalance,
    lifetimeSales,
    previewJobs,
  };
}

export function indexCustomerListActivity(
  customerIds: string[],
  jobs: CustomerListJob[],
  estimates: CustomerListEstimate[],
  invoices: CustomerListInvoice[],
  orders: CustomerListOrder[] = [],
): Record<string, CustomerListActivity> {
  const jobsBy = groupByCustomer(jobs);
  const estBy = groupByCustomer(estimates);
  const invBy = groupByCustomer(invoices);
  const ordBy = groupByCustomer(
    orders.filter((o): o is CustomerListOrder & { customer_id: string } =>
      Boolean(o.customer_id),
    ),
  );
  const out: Record<string, CustomerListActivity> = {};
  for (const id of uniqueIds(customerIds)) {
    out[id] = buildCustomerListActivity(
      id,
      jobsBy.get(id) ?? [],
      estBy.get(id) ?? [],
      invBy.get(id) ?? [],
      ordBy.get(id) ?? [],
    );
  }
  return out;
}

function groupByCustomer<T extends { customer_id: string | null }>(
  rows: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const id = row.customer_id;
    if (!id) continue;
    const arr = map.get(id) ?? [];
    arr.push(row);
    map.set(id, arr);
  }
  return map;
}

export function formatCustomerActivityLine(
  activity: CustomerListActivity,
): string {
  const bits: string[] = [];
  if (activity.totalJobs > 0) {
    bits.push(
      `${activity.totalJobs} Job${activity.totalJobs === 1 ? "" : "s"}`,
    );
    if (activity.openJobs > 0) {
      bits.push(
        `${activity.openJobs} Open`,
      );
    }
  }
  if (activity.cashAndCarryCount > 0) {
    bits.push(
      `${activity.cashAndCarryCount} Cash & Carry`,
    );
  }
  if (activity.estimateCount > 0 && activity.totalJobs === 0) {
    bits.push(
      `${activity.estimateCount} Estimate${activity.estimateCount === 1 ? "" : "s"}`,
    );
  }
  return bits.join(" · ");
}

export type PossibleDuplicateGroup = {
  reason: "phone" | "email" | "name_address";
  ids: string[];
};

/**
 * Read-only grouping of *possible* real duplicate customer records
 * (distinct ids). Never used to merge or hide list rows.
 */
export function findPossibleDuplicateCustomerRecords(
  customers: CustomerListIdentity[],
): PossibleDuplicateGroup[] {
  const phone = new Map<string, string[]>();
  const email = new Map<string, string[]>();
  const nameAddr = new Map<string, string[]>();

  const push = (map: Map<string, string[]>, key: string, id: string) => {
    const arr = map.get(key) ?? [];
    if (!arr.includes(id)) arr.push(id);
    map.set(key, arr);
  };

  for (const c of customers) {
    const p = normalizePhoneDigits(c.phone);
    if (p.length === 10) push(phone, p, c.id);
    const e = normalizeEmail(c.email);
    if (e) push(email, e, c.id);
    const n = normalizePersonName(c.full_name);
    const a = normalizeAddressKey({
      address: c.street,
      city: c.city,
      state: c.state,
      zip: c.zip,
    });
    if (n && a) push(nameAddr, `${n}|${a}`, c.id);
  }

  const groups: PossibleDuplicateGroup[] = [];
  const seen = new Set<string>();
  const add = (reason: PossibleDuplicateGroup["reason"], ids: string[]) => {
    if (ids.length < 2) return;
    const key = `${reason}:${[...ids].sort().join(",")}`;
    if (seen.has(key)) return;
    seen.add(key);
    groups.push({ reason, ids: [...ids] });
  };
  for (const ids of phone.values()) add("phone", ids);
  for (const ids of email.values()) add("email", ids);
  for (const ids of nameAddr.values()) add("name_address", ids);
  return groups;
}
