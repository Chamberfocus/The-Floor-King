/**
 * Job, estimate, customer, and approval-undo deletion policy.
 *
 * Posted invoices, payments, credits, deposits, write-offs, approval
 * snapshots, issued purchase orders, and job cost history are kept.
 * Only untouched draft paperwork may be removed, and only after this check
 * returns ok and reserved stock has actually been released.
 *
 * This is the same paperwork rule as order deletion. It lives here so that
 * repair does not take over the order-deletion module.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { netReservedQty } from "@/lib/job-stock-reserve";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;

export type DeletionSubject = "job" | "estimate" | "customer" | "approval";

export type InvoicePaperwork = {
  id: string;
  status: string | null;
  paymentCount: number;
  creditApplicationCount: number;
  depositApplicationCount: number;
  writeOffCount: number;
};

export type PurchaseOrderPaperwork = {
  id: string;
  status: string | null;
  receivedQty: number;
};

export type JobPaperwork = {
  id: string;
  status: string | null;
  scheduledDate: string | null;
  completedAt: string | null;
  actualLaborCost: number | null;
};

export type FinancialDeletionFacts = {
  invoices: InvoicePaperwork[];
  purchaseOrders: PurchaseOrderPaperwork[];
  jobs: JobPaperwork[];
  jobLaborCount: number;
  installerBillCount: number;
  trueUpCount: number;
  commissionLedgerCount: number;
  expenseCount: number;
  supplierBillCount: number;
  orderCount: number;
  approvalSnapshotCount: number;
  pulledQty: number;
  stockRollCount: number;
};

export type DestructionBlock = {
  code:
    | "POSTED_INVOICE"
    | "PAYMENT_HISTORY"
    | "CREDIT_APPLICATION"
    | "DEPOSIT_OR_WRITE_OFF"
    | "ISSUED_PURCHASE_ORDER"
    | "PURCHASE_ORDER_RECEIPTS"
    | "JOB_FINANCIAL_HISTORY"
    | "EXPENSE_HISTORY"
    | "SUPPLIER_BILL"
    | "MATERIAL_ORDER"
    | "APPROVAL_HISTORY"
    | "OPERATIONAL_JOB"
    | "INVENTORY_PULL"
    | "STOCK_ALLOCATION"
    | "RESERVATION_RELEASE_FAILED"
    | "UNCONFIRMED";
  message: string;
};

export type FinancialDeletionScope = {
  jobIds?: string[];
  estimateIds?: string[];
  customerId?: string | null;
};

export type FinancialDeletionSnapshot = {
  facts: FinancialDeletionFacts;
  jobIds: string[];
  estimateIds: string[];
};

const POSTED_INVOICE_MESSAGE =
  "Issued invoices cannot be deleted. Void the invoice to cancel it.";
const PAYMENT_HISTORY_MESSAGE =
  "This invoice has payment history and can’t be deleted. Void only if unpaid, or keep it for history.";
const CREDIT_APPLICATION_MESSAGE =
  "This invoice has credit applications and can’t be deleted. Void instead.";
const DEPOSIT_OR_WRITE_OFF_MESSAGE =
  "This invoice has deposits or write-offs and can’t be deleted. Void instead.";

const SUBJECT_PREFIX: Record<DeletionSubject, string> = {
  job: "This job was not deleted.",
  estimate: "This estimate was not deleted.",
  customer: "This customer was not deleted.",
  approval: "This approval was not undone.",
};

function prefix(subject: DeletionSubject, sentence: string): string {
  return `${SUBJECT_PREFIX[subject]} ${sentence}`;
}

/** Same rule as draft-invoice deletion. Null means a bare draft. */
export function invoiceHardDeleteBlocker(
  invoice: InvoicePaperwork,
): DestructionBlock | null {
  const status = invoice.status ?? "draft";
  if (status !== "draft") {
    return { code: "POSTED_INVOICE", message: POSTED_INVOICE_MESSAGE };
  }
  if (invoice.paymentCount > 0) {
    return { code: "PAYMENT_HISTORY", message: PAYMENT_HISTORY_MESSAGE };
  }
  if (invoice.creditApplicationCount > 0) {
    return { code: "CREDIT_APPLICATION", message: CREDIT_APPLICATION_MESSAGE };
  }
  if (invoice.depositApplicationCount > 0 || invoice.writeOffCount > 0) {
    return { code: "DEPOSIT_OR_WRITE_OFF", message: DEPOSIT_OR_WRITE_OFF_MESSAGE };
  }
  return null;
}

function jobIsBareDraft(job: JobPaperwork): boolean {
  if ((job.status ?? "unscheduled") !== "unscheduled") return false;
  if (job.scheduledDate) return false;
  if (job.completedAt) return false;
  if (job.actualLaborCost != null) return false;
  return true;
}

/**
 * Whether this operational delete may remove untouched draft paperwork.
 * Outstanding reservations are not decided here — release first, then
 * reservationReleaseBlocker.
 */
export function financialDestructionBlocker(
  subject: DeletionSubject,
  facts: FinancialDeletionFacts,
  options?: { blockAnyInvoice?: boolean },
): { ok: true } | { ok: false; block: DestructionBlock } {
  if (options?.blockAnyInvoice && facts.invoices.length > 0) {
    return {
      ok: false,
      block: {
        code: "POSTED_INVOICE",
        message: prefix(
          subject,
          "An invoice has been raised. Keep it, or void it. The approval stays.",
        ),
      },
    };
  }

  for (const invoice of facts.invoices) {
    const block = invoiceHardDeleteBlocker(invoice);
    if (block) {
      return { ok: false, block: { code: block.code, message: prefix(subject, block.message) } };
    }
  }

  for (const po of facts.purchaseOrders) {
    if (po.receivedQty > 0) {
      return {
        ok: false,
        block: {
          code: "PURCHASE_ORDER_RECEIPTS",
          message: prefix(
            subject,
            "A purchase order has received quantities. That receiving history stays on the books.",
          ),
        },
      };
    }
    if ((po.status ?? "draft") !== "draft") {
      return {
        ok: false,
        block: {
          code: "ISSUED_PURCHASE_ORDER",
          message: prefix(
            subject,
            "A purchase order was already ordered, received, closed, or voided. It was kept.",
          ),
        },
      };
    }
  }

  if (
    facts.jobLaborCount > 0 ||
    facts.installerBillCount > 0 ||
    facts.trueUpCount > 0 ||
    facts.commissionLedgerCount > 0
  ) {
    return {
      ok: false,
      block: {
        code: "JOB_FINANCIAL_HISTORY",
        message: prefix(
          subject,
          "Labor, installer billing, true-up, or commission history stays on the books.",
        ),
      },
    };
  }

  if (facts.expenseCount > 0) {
    return {
      ok: false,
      block: {
        code: "EXPENSE_HISTORY",
        message: prefix(subject, "An expense is posted against this work. That expense stays on the books."),
      },
    };
  }

  if (facts.supplierBillCount > 0) {
    return {
      ok: false,
      block: {
        code: "SUPPLIER_BILL",
        message: prefix(subject, "A supplier bill is posted against this work. That bill stays on the books."),
      },
    };
  }

  if (facts.orderCount > 0) {
    return {
      ok: false,
      block: {
        code: "MATERIAL_ORDER",
        message: prefix(subject, "A customer order is attached. That order stays on the books."),
      },
    };
  }

  if (subject !== "job" && subject !== "approval" && facts.approvalSnapshotCount > 0) {
    return {
      ok: false,
      block: {
        code: "APPROVAL_HISTORY",
        message: prefix(subject, "An approval snapshot is on file. That commercial record stays."),
      },
    };
  }

  if (facts.jobs.some((job) => !jobIsBareDraft(job))) {
    return {
      ok: false,
      block: {
        code: "OPERATIONAL_JOB",
        message: prefix(
          subject,
          "The work order is scheduled, in progress, completed, or cancelled. That history stays.",
        ),
      },
    };
  }

  if (facts.pulledQty > 0) {
    return {
      ok: false,
      block: {
        code: "INVENTORY_PULL",
        message: prefix(subject, "Material has already been pulled. That inventory history stays."),
      },
    };
  }

  if (facts.stockRollCount > 0) {
    return {
      ok: false,
      block: {
        code: "STOCK_ALLOCATION",
        message: prefix(subject, "Rolls are allocated to this work. That inventory stays."),
      },
    };
  }

  return { ok: true };
}

export function reservationReleaseBlocker(
  subject: DeletionSubject,
  outstandingQty: number,
): DestructionBlock | null {
  if (outstandingQty <= 0) return null;
  return {
    code: "RESERVATION_RELEASE_FAILED",
    message: prefix(
      subject,
      "Reserved material could not be released, so nothing was deleted.",
    ),
  };
}

export function laborHistoryDeletionBlocker(): DestructionBlock {
  return {
    code: "JOB_FINANCIAL_HISTORY",
    message:
      "This pay line was not deleted. Labor history stays on the job.",
  };
}

export function unconfirmedMessage(subject: DeletionSubject): string {
  return prefix(
    subject,
    "Financial history could not be confirmed, so nothing was deleted.",
  );
}

/** Database triggers from 0488 and 0490 use these exception texts. */
export function deleteErrorPreservesHistory(message: string | null | undefined): boolean {
  if (!message) return false;
  return /POSTED_INVOICE|PAYMENT_HISTORY|CREDIT_APPLICATION|DEPOSIT_APPLICATION|WRITE_OFF|JOB_FINANCIAL_HISTORY|PURCHASE_ORDER_RECEIPTS|ISSUED_PURCHASE_ORDER|EXPENSE_HISTORY|SUPPLIER_BILL|APPROVAL_HISTORY|OPERATIONAL_JOB|INVENTORY_PULL|RESERVATION_RELEASE_FAILED|STOCK_ALLOCATION|MATERIAL_ORDER/.test(
    message,
  );
}

type Movement = {
  kind: string;
  qty: number;
  jobId?: string | null;
  productId?: string | null;
  lineId?: string | null;
};

/** Outstanding reserved quantity across job lines. Zero means the release landed. */
export function outstandingReservedQty(movements: Movement[]): number {
  const groups = new Map<string, { kind: string; qty: number }[]>();
  for (const movement of movements) {
    if (!movement.jobId || !movement.productId) continue;
    const key = `${movement.jobId}::${movement.productId}::${movement.lineId ?? "_"}`;
    const list = groups.get(key) ?? [];
    list.push({ kind: movement.kind, qty: Number(movement.qty) || 0 });
    groups.set(key, list);
  }
  let total = 0;
  for (const list of groups.values()) total += netReservedQty(list);
  return Math.round(total * 100) / 100;
}

export function pulledQtyFromMovements(movements: { kind: string; qty: number }[]): number {
  let pulled = 0;
  for (const movement of movements) {
    if (movement.kind === "pull") pulled += Math.abs(Number(movement.qty) || 0);
  }
  return Math.round(pulled * 100) / 100;
}

type Row = Record<string, unknown>;

function asRows(data: unknown): Row[] {
  return Array.isArray(data) ? (data as Row[]) : [];
}

async function rowsWhere(
  db: DB,
  table: string,
  column: string,
  ids: string[],
  columns: string,
): Promise<Row[]> {
  if (!ids.length) return [];
  const { data, error } = await db.from(table).select(columns).in(column, ids);
  if (error) throw new Error(error.message);
  return asRows(data);
}

async function countWhere(
  db: DB,
  table: string,
  column: string,
  ids: string[],
): Promise<number> {
  if (!ids.length) return 0;
  const { count, error } = await db
    .from(table)
    .select("id", { count: "exact", head: true })
    .in(column, ids);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function tally(rows: Row[], invoiceId: string): number {
  return rows.filter((row) => row.invoice_id === invoiceId).length;
}

function receivedQty(items: unknown): number {
  if (!Array.isArray(items)) return 0;
  let total = 0;
  for (const item of items) {
    total += Number((item as { received_qty?: number | string | null }).received_qty) || 0;
  }
  return Math.round(total * 100) / 100;
}

function laborCost(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function loadFinancialDeletionSnapshot(
  db: DB,
  scope: FinancialDeletionScope,
): Promise<FinancialDeletionSnapshot> {
  const mode = scope.customerId ? "customer" : scope.estimateIds?.length ? "estimate" : "job";
  const jobIds = new Set(scope.jobIds ?? []);
  const estimateIds = new Set(scope.estimateIds ?? []);

  if (scope.customerId) {
    const { data, error } = await db
      .from("jobs")
      .select("id, estimate_id")
      .eq("customer_id", scope.customerId);
    if (error) throw new Error(error.message);
    for (const row of asRows(data)) {
      if (row.id) jobIds.add(row.id as string);
      if (row.estimate_id) estimateIds.add(row.estimate_id as string);
    }
    const estimates = await db.from("estimates").select("id").eq("customer_id", scope.customerId);
    if (estimates.error) throw new Error(estimates.error.message);
    for (const row of asRows(estimates.data)) {
      if (row.id) estimateIds.add(row.id as string);
    }
  }

  if (mode === "estimate") {
    const jobs = await rowsWhere(db, "jobs", "estimate_id", [...estimateIds], "id, estimate_id");
    for (const row of jobs) {
      if (row.id) jobIds.add(row.id as string);
      if (row.estimate_id) estimateIds.add(row.estimate_id as string);
    }
  }

  if (mode === "job" && jobIds.size) {
    const jobs = await rowsWhere(db, "jobs", "id", [...jobIds], "id, estimate_id");
    for (const row of jobs) {
      if (row.estimate_id) estimateIds.add(row.estimate_id as string);
    }
  }

  const jobIdList = [...jobIds];
  const estimateIdList = [...estimateIds];
  const jobRows = await rowsWhere(
    db,
    "jobs",
    "id",
    jobIdList,
    "id, status, scheduled_date, completed_at, actual_labor_cost",
  );

  const invoiceMap = new Map<string, Row>();
  const addInvoices = (list: Row[]) => {
    for (const row of list) if (row.id) invoiceMap.set(row.id as string, row);
  };
  addInvoices(await rowsWhere(db, "invoices", "job_id", jobIdList, "id, status, job_id, estimate_id"));
  if (mode !== "job") {
    addInvoices(
      await rowsWhere(db, "invoices", "estimate_id", estimateIdList, "id, status, job_id, estimate_id"),
    );
  }
  if (mode === "customer" && scope.customerId) {
    const { data, error } = await db
      .from("invoices")
      .select("id, status, job_id, estimate_id")
      .eq("customer_id", scope.customerId);
    if (error) throw new Error(error.message);
    addInvoices(asRows(data));
  }

  const invoiceIds = [...invoiceMap.keys()];
  const [payments, credits, deposits, writeOffs] = await Promise.all([
    rowsWhere(db, "payments", "invoice_id", invoiceIds, "invoice_id"),
    rowsWhere(db, "credit_applications", "invoice_id", invoiceIds, "invoice_id"),
    rowsWhere(db, "customer_deposit_applications", "invoice_id", invoiceIds, "invoice_id"),
    rowsWhere(db, "invoice_write_offs", "invoice_id", invoiceIds, "invoice_id"),
  ]);

  const poMap = new Map<string, Row>();
  const addPos = (list: Row[]) => {
    for (const row of list) if (row.id) poMap.set(row.id as string, row);
  };
  const poColumns = "id, status, job_id, estimate_id, customer_id, items:po_items(received_qty)";
  addPos(await rowsWhere(db, "purchase_orders", "job_id", jobIdList, poColumns));
  if (mode !== "job") {
    addPos(await rowsWhere(db, "purchase_orders", "estimate_id", estimateIdList, poColumns));
  }
  if (mode === "customer" && scope.customerId) {
    const { data, error } = await db
      .from("purchase_orders")
      .select(poColumns)
      .eq("customer_id", scope.customerId);
    if (error) throw new Error(error.message);
    addPos(asRows(data));
  }

  const orderRows = [
    ...(await rowsWhere(db, "orders", "job_id", jobIdList, "id")),
  ];
  if (mode === "customer" && scope.customerId) {
    const { data, error } = await db.from("orders").select("id").eq("customer_id", scope.customerId);
    if (error) throw new Error(error.message);
    orderRows.push(...asRows(data));
  }
  const orderIds = new Set(orderRows.map((row) => row.id as string).filter(Boolean));

  let supplierBillCount = await countWhere(db, "bills", "job_id", jobIdList);
  if (mode === "customer" && scope.customerId) {
    const { count, error } = await db
      .from("bills")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", scope.customerId);
    if (error) throw new Error(error.message);
    supplierBillCount += count ?? 0;
  }

  const movements = await rowsWhere(
    db,
    "stock_movements",
    "job_id",
    jobIdList,
    "job_id, product_id, line_id, kind, qty",
  );

  const facts: FinancialDeletionFacts = {
    invoices: [...invoiceMap.values()].map((invoice) => ({
      id: invoice.id as string,
      status: (invoice.status as string | null) ?? null,
      paymentCount: tally(payments, invoice.id as string),
      creditApplicationCount: tally(credits, invoice.id as string),
      depositApplicationCount: tally(deposits, invoice.id as string),
      writeOffCount: tally(writeOffs, invoice.id as string),
    })),
    purchaseOrders: [...poMap.values()].map((po) => ({
      id: po.id as string,
      status: (po.status as string | null) ?? null,
      receivedQty: receivedQty(po.items),
    })),
    jobs: jobRows.map((job) => ({
      id: job.id as string,
      status: (job.status as string | null) ?? null,
      scheduledDate: (job.scheduled_date as string | null) ?? null,
      completedAt: (job.completed_at as string | null) ?? null,
      actualLaborCost: laborCost(job.actual_labor_cost),
    })),
    jobLaborCount: await countWhere(db, "job_labor", "job_id", jobIdList),
    installerBillCount: await countWhere(db, "installer_bills", "job_id", jobIdList),
    trueUpCount: await countWhere(db, "job_true_ups", "job_id", jobIdList),
    commissionLedgerCount: await countWhere(db, "job_commission_ledger", "job_id", jobIdList),
    expenseCount: await countWhere(db, "expenses", "job_id", jobIdList),
    supplierBillCount,
    orderCount: orderIds.size,
    approvalSnapshotCount:
      mode === "job"
        ? 0
        : await countWhere(db, "estimate_approval_snapshots", "estimate_id", estimateIdList),
    pulledQty: pulledQtyFromMovements(
      movements.map((row) => ({ kind: String(row.kind ?? ""), qty: Number(row.qty) || 0 })),
    ),
    stockRollCount: await countWhere(db, "stock_rolls", "job_id", jobIdList),
  };

  return { facts, jobIds: jobIdList, estimateIds: estimateIdList };
}

export async function assertFinancialDeletionAllowed(
  db: DB,
  subject: DeletionSubject,
  scope: FinancialDeletionScope,
  options?: { blockAnyInvoice?: boolean },
): Promise<
  | { ok: true; snapshot: FinancialDeletionSnapshot }
  | { ok: false; message: string }
> {
  try {
    const snapshot = await loadFinancialDeletionSnapshot(db, scope);
    const decision = financialDestructionBlocker(subject, snapshot.facts, options);
    if (!decision.ok) return { ok: false, message: decision.block.message };
    return { ok: true, snapshot };
  } catch {
    return { ok: false, message: unconfirmedMessage(subject) };
  }
}

export async function reservationStillHeld(
  db: DB,
  jobIds: string[],
): Promise<{ ok: true; qty: number } | { ok: false; message: string }> {
  if (!jobIds.length) return { ok: true, qty: 0 };
  const { data, error } = await db
    .from("stock_movements")
    .select("job_id, product_id, line_id, kind, qty")
    .in("job_id", jobIds);
  if (error) {
    return {
      ok: false,
      message: "Reserved material could not be confirmed, so nothing was deleted.",
    };
  }
  return {
    ok: true,
    qty: outstandingReservedQty(
      asRows(data).map((row) => ({
        kind: String(row.kind ?? ""),
        qty: Number(row.qty) || 0,
        jobId: (row.job_id as string | null) ?? null,
        productId: (row.product_id as string | null) ?? null,
        lineId: (row.line_id as string | null) ?? null,
      })),
    ),
  };
}

/**
 * Remove only the bare-draft paperwork the gate already allowed.
 * Does not delete payments, labor, installer bills, true-ups, commissions,
 * expenses, supplier bills, or customer orders.
 */
export async function deleteBareDraftPaperwork(
  db: DB,
  subject: DeletionSubject,
  snapshot: FinancialDeletionSnapshot,
  options?: { preserveInvoices?: boolean },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const held = await reservationStillHeld(db, snapshot.jobIds);
  if (!held.ok || held.qty > 0) {
    return {
      ok: false,
      message:
        reservationReleaseBlocker(subject, held.ok ? held.qty : 1)?.message ??
        unconfirmedMessage(subject),
    };
  }

  const invoiceIds = snapshot.facts.invoices.map((invoice) => invoice.id);
  if (options?.preserveInvoices && invoiceIds.length) {
    return {
      ok: false,
      message: prefix(subject, "An invoice has been raised. Nothing was deleted."),
    };
  }

  if (invoiceIds.length) {
    const { error } = await db.from("invoices").delete().in("id", invoiceIds);
    if (error) {
      return {
        ok: false,
        message: deleteErrorPreservesHistory(error.message)
          ? prefix(subject, "Posted invoice or payment history is still on the books.")
          : prefix(subject, "A draft invoice could not be removed, so nothing further was deleted."),
      };
    }
  }

  const poIds = snapshot.facts.purchaseOrders
    .filter((po) => (po.status ?? "draft") === "draft" && po.receivedQty <= 0)
    .map((po) => po.id);
  if (poIds.length) {
    const { error } = await db.from("purchase_orders").delete().in("id", poIds);
    if (error) {
      return {
        ok: false,
        message: prefix(subject, "A draft purchase order could not be removed, so the record was kept."),
      };
    }
  }

  if (snapshot.jobIds.length) {
    const { data: docs, error: docReadError } = await db
      .from("documents")
      .select("path")
      .in("job_id", snapshot.jobIds);
    if (docReadError) {
      return {
        ok: false,
        message: prefix(subject, "Job files could not be confirmed, so the work order was kept."),
      };
    }
    const paths = asRows(docs).map((doc) => doc.path as string).filter(Boolean);
    if (paths.length) {
      try {
        await db.storage.from("documents").remove(paths);
      } catch {
        // A missing file must not keep a bare draft, and it must not delete money.
      }
    }
    const { error: docError } = await db.from("documents").delete().in("job_id", snapshot.jobIds);
    if (docError) {
      return {
        ok: false,
        message: prefix(subject, "Job files could not be removed, so the work order was kept."),
      };
    }

    const { error: moveError } = await db
      .from("stock_movements")
      .delete()
      .in("job_id", snapshot.jobIds);
    if (moveError) {
      return {
        ok: false,
        message: prefix(subject, "Inventory rows could not be cleared, so the work order was kept."),
      };
    }

    const { error: jobError } = await db.from("jobs").delete().in("id", snapshot.jobIds);
    if (jobError) {
      return {
        ok: false,
        message: deleteErrorPreservesHistory(jobError.message)
          ? prefix(subject, "Financial history is still on the books.")
          : prefix(subject, "The work order could not be removed, so it was kept."),
      };
    }
  }

  return { ok: true };
}
