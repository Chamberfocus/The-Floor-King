/**
 * The office desk. Reads the same invoice, bill, purchase-order, and job
 * records the rest of the store already uses. It does not keep a second ledger.
 */
import { createClient } from "@/lib/supabase/server";
import { getOutstandingAR } from "@/lib/data/finance";
import { invoiceAmountDue, listInvoicesQueue, OPEN_AR_MIN } from "@/lib/data/invoices";
import { listBills } from "@/lib/data/bills";
import { listPurchaseOrdersQueue } from "@/lib/data/purchase-orders";
import { getProfileNames } from "@/lib/data/customers";
import {
  officeInvoiceCounts,
  officeJobFollowUp,
  type OfficeJobLane,
} from "@/lib/office-hub";

const JOB_COLUMNS =
  "id, title, status, warehouse_status, warehouse_ready_at, warehouse_submitted_at, scheduled_date, customer_id, customer:customers(full_name, assigned_to)";

export type OfficeCollectRow = {
  id: string;
  number: string | null;
  customerId: string | null;
  customerName: string | null;
  due: string | null;
  balance: number;
};

export type OfficeJobRow = {
  id: string;
  title: string;
  customerId: string | null;
  customerName: string | null;
  salesperson: string | null;
  lane: OfficeJobLane;
  next: string;
  warehouseStatus: string | null;
  scheduledDate: string | null;
};

export type OfficePoRow = {
  id: string;
  number: number | null;
  supplier: string | null;
  customerName: string | null;
  jobTitle: string | null;
  backordered: boolean;
  eta: string | null;
};

export type OfficeBillRow = {
  id: string;
  number: string | null;
  supplier: string | null;
  due: string | null;
  balance: number;
  overdue: boolean;
};

export type OfficeHub = {
  ar: { total: number; count: number } | null;
  collectKind: "overdue" | "open";
  collectTotal: number;
  collect: OfficeCollectRow[];
  jobs: OfficeJobRow[];
  poOpen: number;
  poDraft: number;
  poReceived: number;
  purchaseOrders: OfficePoRow[];
  billCount: number;
  billTotal: number;
  billOverdue: number;
  bills: OfficeBillRow[];
};

const EMPTY: OfficeHub = {
  ar: null,
  collectKind: "open",
  collectTotal: 0,
  collect: [],
  jobs: [],
  poOpen: 0,
  poDraft: 0,
  poReceived: 0,
  purchaseOrders: [],
  billCount: 0,
  billTotal: 0,
  billOverdue: 0,
  bills: [],
};

type JobHit = {
  id: string;
  title: string | null;
  status: string;
  warehouse_status: string | null;
  warehouse_ready_at: string | null;
  warehouse_submitted_at: string | null;
  scheduled_date: string | null;
  customer_id: string | null;
  customer:
    | { full_name: string | null; assigned_to: string | null }
    | { full_name: string | null; assigned_to: string | null }[]
    | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function safe<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch {
    return fallback;
  }
}

async function followUpJobs(): Promise<OfficeJobRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select(JOB_COLUMNS)
    .neq("status", "cancelled")
    .order("updated_at", { ascending: false })
    .limit(80);
  if (error || !data?.length) return [];
  const jobs = data as JobHit[];
  const ids = jobs.map((job) => job.id);
  const { data: invoices } = await supabase
    .from("invoices")
    .select("job_id, status")
    .in("job_id", ids);
  const byJob = new Map<string, { status: string | null }[]>();
  for (const row of invoices ?? []) {
    const jobId = row.job_id as string | null;
    if (!jobId) continue;
    const list = byJob.get(jobId) ?? [];
    list.push({ status: (row.status as string | null) ?? null });
    byJob.set(jobId, list);
  }
  const salespersonIds = jobs.map((job) => one(job.customer)?.assigned_to ?? "");
  const names = await getProfileNames(salespersonIds);
  const rows: OfficeJobRow[] = [];
  for (const job of jobs) {
    const counts = officeInvoiceCounts(byJob.get(job.id) ?? []);
    const follow = officeJobFollowUp({
      status: job.status,
      warehouseStatus: job.warehouse_status,
      warehouseSubmittedAt: job.warehouse_submitted_at,
      warehouseReadyAt: job.warehouse_ready_at,
      scheduledDate: job.scheduled_date,
      ...counts,
    });
    if (!follow) continue;
    const customer = one(job.customer);
    const salespersonId = customer?.assigned_to ?? null;
    rows.push({
      id: job.id,
      title: job.title?.trim() || "Job",
      customerId: job.customer_id,
      customerName: customer?.full_name ?? null,
      salesperson: salespersonId ? (names[salespersonId] ?? null) : null,
      lane: follow.lane,
      next: follow.next,
      warehouseStatus: job.warehouse_status,
      scheduledDate: job.scheduled_date,
    });
  }
  return rows;
}

export async function loadOfficeHub(): Promise<OfficeHub> {
  const [ar, overdue, open, ordered, draft, received, bills, jobs] = await Promise.all([
    safe(() => getOutstandingAR(), null),
    safe(() => listInvoicesQueue({ view: "overdue", page: 1 }), null),
    safe(() => listInvoicesQueue({ view: "open", page: 1 }), null),
    safe(() => listPurchaseOrdersQueue({ view: "ordered", page: 1 }), null),
    safe(() => listPurchaseOrdersQueue({ view: "draft", page: 1 }), null),
    safe(() => listPurchaseOrdersQueue({ view: "received", page: 1 }), null),
    safe(() => listBills(), []),
    safe(() => followUpJobs(), []),
  ]);

  const collectSource = overdue && overdue.total > 0 ? overdue : open;
  const collectKind = overdue && overdue.total > 0 ? "overdue" : "open";
  const collect = (collectSource?.rows ?? []).slice(0, 8).map((row) => ({
    id: row.id,
    number: row.number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    due: row.due_date,
    balance: invoiceAmountDue(row),
  }));

  const openBills = bills
    .filter((bill) => bill.balance > OPEN_AR_MIN)
    .sort((a, b) => {
      const overdue = Number(b.overdue) - Number(a.overdue);
      if (overdue !== 0) return overdue;
      return (a.due_date ?? "").localeCompare(b.due_date ?? "");
    });
  const purchaseOrders = [...(ordered?.rows ?? [])]
    .sort((a, b) => Number(b.backordered) - Number(a.backordered))
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      number: row.po_number,
      supplier: row.supplier,
      customerName: row.customer_name,
      jobTitle: row.job_title,
      backordered: row.backordered,
      eta: row.eta_date,
    }));

  return {
    ...EMPTY,
    ar: ar ? { total: ar.total, count: ar.count } : null,
    collectKind,
    collectTotal: collectSource?.total ?? 0,
    collect,
    jobs,
    poOpen: ordered?.total ?? 0,
    poDraft: draft?.total ?? 0,
    poReceived: received?.total ?? 0,
    purchaseOrders,
    billCount: openBills.length,
    billTotal: openBills.reduce((sum, bill) => sum + bill.balance, 0),
    billOverdue: openBills.filter((bill) => bill.overdue).length,
    bills: openBills.slice(0, 8).map((bill) => ({
      id: bill.id,
      number: bill.bill_number,
      supplier: bill.supplier,
      due: bill.due_date,
      balance: bill.balance,
      overdue: bill.overdue,
    })),
  };
}
