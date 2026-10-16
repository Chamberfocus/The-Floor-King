/**
 * Operational deletes keep posted financial history.
 * Bare drafts can go only after a real reservation release.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertFinancialDeletionAllowed,
  deleteBareDraftPaperwork,
  deleteErrorPreservesHistory,
  financialDestructionBlocker,
  invoiceHardDeleteBlocker,
  laborHistoryDeletionBlocker,
  outstandingReservedQty,
  reservationReleaseBlocker,
  type FinancialDeletionFacts,
  type InvoicePaperwork,
} from "@/lib/financial-deletion";

const root = process.cwd();
const src = (path: string) => readFileSync(join(root, path), "utf8");

function between(file: string, start: string, end: string): string {
  const text = src(file);
  const from = text.indexOf(start);
  const to = end ? text.indexOf(end, from + start.length) : text.length;
  expect(from).toBeGreaterThanOrEqual(0);
  return text.slice(from, to === -1 ? text.length : to);
}

const bareInvoice = (over: Partial<InvoicePaperwork> = {}): InvoicePaperwork => ({
  id: "inv",
  status: "draft",
  paymentCount: 0,
  creditApplicationCount: 0,
  depositApplicationCount: 0,
  writeOffCount: 0,
  ...over,
});

function bareFacts(over: Partial<FinancialDeletionFacts> = {}): FinancialDeletionFacts {
  return {
    invoices: [],
    purchaseOrders: [],
    jobs: [
      {
        id: "job",
        status: "unscheduled",
        scheduledDate: null,
        completedAt: null,
        actualLaborCost: null,
      },
    ],
    jobLaborCount: 0,
    installerBillCount: 0,
    trueUpCount: 0,
    commissionLedgerCount: 0,
    expenseCount: 0,
    supplierBillCount: 0,
    orderCount: 0,
    approvalSnapshotCount: 0,
    pulledQty: 0,
    stockRollCount: 0,
    ...over,
  };
}

type Row = Record<string, unknown>;

function memoryDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => ({ ...row }));
  const deleted: string[] = [];
  const db = {
    deleted,
    from(table: string) {
      const state = {
        filters: [] as { op: "eq" | "in" | "is"; col: string; val?: unknown; vals?: unknown[] }[],
        head: false,
        deleting: false,
        missing: !(table in tables),
      };
      const builder = {
        select(_cols: string, opts?: { head?: boolean }) {
          state.head = !!opts?.head;
          return builder;
        },
        eq(col: string, val: unknown) {
          state.filters.push({ op: "eq", col, val });
          return builder;
        },
        in(col: string, vals: unknown[]) {
          state.filters.push({ op: "in", col, vals });
          return builder;
        },
        is(col: string, val: unknown) {
          state.filters.push({ op: "is", col, val });
          return builder;
        },
        delete() {
          state.deleting = true;
          return builder;
        },
        then(resolve: (value: unknown) => void) {
          if (state.missing) {
            resolve({ data: null, error: { message: `missing ${table}` }, count: null });
            return;
          }
          const matched = tables[table].filter((row) =>
            state.filters.every((filter) => {
              if (filter.op === "eq" || filter.op === "is") return row[filter.col] === filter.val;
              return (filter.vals ?? []).includes(row[filter.col]);
            }),
          );
          if (state.deleting) {
            const drop = new Set(matched);
            tables[table] = tables[table].filter((row) => !drop.has(row));
            deleted.push(table);
            resolve({ data: null, error: null, count: matched.length });
            return;
          }
          resolve({
            data: state.head ? null : matched,
            error: null,
            count: matched.length,
          });
        },
      };
      return builder;
    },
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
    rows: tables,
  };
  return db;
}

const EMPTY_TABLES = [
  "jobs",
  "estimates",
  "invoices",
  "payments",
  "credit_applications",
  "customer_deposit_applications",
  "invoice_write_offs",
  "purchase_orders",
  "orders",
  "bills",
  "expenses",
  "job_labor",
  "installer_bills",
  "job_true_ups",
  "job_commission_ledger",
  "stock_movements",
  "stock_rolls",
  "documents",
  "estimate_approval_snapshots",
];

function dbWith(extra: Record<string, Row[]>) {
  const seed = Object.fromEntries(EMPTY_TABLES.map((name) => [name, [] as Row[]]));
  for (const [name, rows] of Object.entries(extra)) seed[name] = rows;
  return memoryDb(seed);
}

describe("invoice and financial blockers", () => {
  it("allows a bare draft invoice and blocks posted money", () => {
    expect(invoiceHardDeleteBlocker(bareInvoice())).toBeNull();
    expect(invoiceHardDeleteBlocker(bareInvoice({ status: "sent" }))?.code).toBe("POSTED_INVOICE");
    expect(invoiceHardDeleteBlocker(bareInvoice({ status: "paid" }))?.message).toContain(
      "Issued invoices cannot be deleted",
    );
    expect(invoiceHardDeleteBlocker(bareInvoice({ paymentCount: 1 }))?.code).toBe("PAYMENT_HISTORY");
    expect(invoiceHardDeleteBlocker(bareInvoice({ paymentCount: 1 }))?.message).toContain("can’t");
    expect(invoiceHardDeleteBlocker(bareInvoice({ creditApplicationCount: 1 }))?.code).toBe(
      "CREDIT_APPLICATION",
    );
    expect(invoiceHardDeleteBlocker(bareInvoice({ depositApplicationCount: 1 }))?.code).toBe(
      "DEPOSIT_OR_WRITE_OFF",
    );
    expect(invoiceHardDeleteBlocker(bareInvoice({ writeOffCount: 1 }))?.code).toBe(
      "DEPOSIT_OR_WRITE_OFF",
    );
  });

  it.each(["job", "estimate", "customer", "approval"] as const)(
    "%s delete keeps each committed record",
    (subject) => {
      expect(financialDestructionBlocker(subject, bareFacts()).ok).toBe(true);

      const cases: [Partial<FinancialDeletionFacts>, string][] = [
        [{ invoices: [bareInvoice({ status: "sent" })] }, "POSTED_INVOICE"],
        [{ invoices: [bareInvoice({ paymentCount: 2 })] }, "PAYMENT_HISTORY"],
        [{ invoices: [bareInvoice({ creditApplicationCount: 1 })] }, "CREDIT_APPLICATION"],
        [{ invoices: [bareInvoice({ writeOffCount: 1 })] }, "DEPOSIT_OR_WRITE_OFF"],
        [{ purchaseOrders: [{ id: "po", status: "ordered", receivedQty: 0 }] }, "ISSUED_PURCHASE_ORDER"],
        [{ purchaseOrders: [{ id: "po", status: "draft", receivedQty: 4 }] }, "PURCHASE_ORDER_RECEIPTS"],
        [{ jobLaborCount: 1 }, "JOB_FINANCIAL_HISTORY"],
        [{ installerBillCount: 1 }, "JOB_FINANCIAL_HISTORY"],
        [{ trueUpCount: 1 }, "JOB_FINANCIAL_HISTORY"],
        [{ commissionLedgerCount: 1 }, "JOB_FINANCIAL_HISTORY"],
        [{ expenseCount: 1 }, "EXPENSE_HISTORY"],
        [{ supplierBillCount: 1 }, "SUPPLIER_BILL"],
        [{ orderCount: 1 }, "MATERIAL_ORDER"],
        [{ pulledQty: 3 }, "INVENTORY_PULL"],
        [{ stockRollCount: 1 }, "STOCK_ALLOCATION"],
        [
          {
            jobs: [
              {
                id: "job",
                status: "in_progress",
                scheduledDate: null,
                completedAt: null,
                actualLaborCost: null,
              },
            ],
          },
          "OPERATIONAL_JOB",
        ],
        [
          {
            jobs: [
              {
                id: "job",
                status: "unscheduled",
                scheduledDate: "2026-10-10",
                completedAt: null,
                actualLaborCost: null,
              },
            ],
          },
          "OPERATIONAL_JOB",
        ],
      ];

      for (const [over, code] of cases) {
        const decision = financialDestructionBlocker(subject, bareFacts(over));
        expect(decision.ok).toBe(false);
        if (!decision.ok) {
          expect(decision.block.code).toBe(code);
          expect(decision.block.message.length).toBeGreaterThan(20);
        }
      }
    },
  );

  it("blocks estimate and customer deletes that would drop an approval snapshot", () => {
    const facts = bareFacts({ approvalSnapshotCount: 1 });
    expect(financialDestructionBlocker("estimate", facts).ok).toBe(false);
    expect(financialDestructionBlocker("customer", facts).ok).toBe(false);
    expect(financialDestructionBlocker("approval", facts).ok).toBe(true);
    expect(financialDestructionBlocker("job", facts).ok).toBe(true);
  });

  it("treats any invoice as too far along to undo an approval", () => {
    const facts = bareFacts({ invoices: [bareInvoice()] });
    const decision = financialDestructionBlocker("approval", facts, { blockAnyInvoice: true });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.block.message).toContain("This approval was not undone.");
  });

  it("stops a delete when reserved quantity is still outstanding", () => {
    expect(outstandingReservedQty([])).toBe(0);
    expect(
      outstandingReservedQty([
        { kind: "reserve", qty: 8, jobId: "j", productId: "p", lineId: "l" },
        { kind: "release", qty: -3, jobId: "j", productId: "p", lineId: "l" },
        { kind: "pull", qty: 2, jobId: "j", productId: "p", lineId: "l" },
      ]),
    ).toBe(3);
    expect(
      outstandingReservedQty([
        { kind: "reserve", qty: 5, jobId: "j", productId: "p", lineId: null },
        { kind: "release", qty: -5, jobId: "j", productId: "p", lineId: null },
      ]),
    ).toBe(0);
    expect(reservationReleaseBlocker("job", 0)).toBeNull();
    expect(reservationReleaseBlocker("estimate", 2)?.code).toBe("RESERVATION_RELEASE_FAILED");
    expect(laborHistoryDeletionBlocker().code).toBe("JOB_FINANCIAL_HISTORY");
    expect(deleteErrorPreservesHistory("JOB_FINANCIAL_HISTORY")).toBe(true);
    expect(deleteErrorPreservesHistory("RESERVATION_RELEASE_FAILED")).toBe(true);
    expect(deleteErrorPreservesHistory("duplicate key")).toBe(false);
  });
});

describe("loader and paperwork delete", () => {
  it("refuses a job whose invoice has a payment and does not delete that invoice", async () => {
    const db = dbWith({
      jobs: [{ id: "j1", status: "unscheduled", scheduled_date: null, completed_at: null, actual_labor_cost: null }],
      invoices: [{ id: "inv", status: "draft", job_id: "j1", estimate_id: null }],
      payments: [{ invoice_id: "inv" }],
    });
    const gate = await assertFinancialDeletionAllowed(db as never, "job", { jobIds: ["j1"] });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.message).toContain("This job was not deleted.");
    expect(db.deleted).not.toContain("invoices");
    expect(db.rows.payments).toHaveLength(1);
    expect(db.rows.invoices).toHaveLength(1);
  });

  it("deletes a bare draft job only after the reservation is gone", async () => {
    const held = dbWith({
      jobs: [{ id: "j1", status: "unscheduled", scheduled_date: null, completed_at: null, actual_labor_cost: null }],
      stock_movements: [{ job_id: "j1", product_id: "p", line_id: "l", kind: "reserve", qty: 4 }],
    });
    const gate = await assertFinancialDeletionAllowed(held as never, "job", { jobIds: ["j1"] });
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    const blocked = await deleteBareDraftPaperwork(held as never, "job", gate.snapshot);
    expect(blocked.ok).toBe(false);
    expect(held.rows.jobs).toHaveLength(1);
    expect(held.deleted).not.toContain("jobs");

    const open = dbWith({
      jobs: [{ id: "j1", status: "unscheduled", scheduled_date: null, completed_at: null, actual_labor_cost: null }],
      invoices: [{ id: "draft", status: "draft", job_id: "j1", estimate_id: null }],
      purchase_orders: [{ id: "po", status: "draft", job_id: "j1", items: [{ received_qty: 0 }] }],
      stock_movements: [
        { job_id: "j1", product_id: "p", line_id: "l", kind: "reserve", qty: 4 },
        { job_id: "j1", product_id: "p", line_id: "l", kind: "release", qty: -4 },
      ],
      payments: [{ invoice_id: "other" }],
    });
    const allowed = await assertFinancialDeletionAllowed(open as never, "job", { jobIds: ["j1"] });
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    const removed = await deleteBareDraftPaperwork(open as never, "job", allowed.snapshot);
    expect(removed.ok).toBe(true);
    expect(open.rows.jobs).toHaveLength(0);
    expect(open.rows.invoices).toHaveLength(0);
    expect(open.rows.purchase_orders).toHaveLength(0);
    expect(open.rows.payments).toHaveLength(1);
    expect(open.deleted).not.toContain("payments");
    expect(open.deleted).not.toContain("job_labor");
    expect(open.deleted).not.toContain("orders");
    expect(open.deleted).not.toContain("expenses");
    expect(open.deleted).not.toContain("bills");
  });

  it("fails closed when financial tables cannot be read", async () => {
    const db = memoryDb({ jobs: [{ id: "j1", status: "unscheduled" }] });
    const gate = await assertFinancialDeletionAllowed(db as never, "customer", { customerId: "c1" });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.message).toContain("could not be confirmed");
    expect(db.deleted).toHaveLength(0);
  });

  it("keeps a customer who has labor even when the job itself is unscheduled", async () => {
    const db = dbWith({
      jobs: [{ id: "j1", customer_id: "c1", estimate_id: null, status: "unscheduled", scheduled_date: null, completed_at: null, actual_labor_cost: null }],
      job_labor: [{ id: "labor", job_id: "j1" }],
    });
    const gate = await assertFinancialDeletionAllowed(db as never, "customer", { customerId: "c1" });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.message).toContain("This customer was not deleted.");
    expect(db.rows.job_labor).toHaveLength(1);
  });
});

describe("deletion actions call the gate before any delete", () => {
  it("deleteJob releases, confirms, then removes only a bare draft", () => {
    const body = between(
      "src/app/(app)/jobs/actions.ts",
      "export async function deleteJob",
      "export async function addJobLabor",
    );
    const gate = body.indexOf("assertFinancialDeletionAllowed");
    const release = body.indexOf("releaseJobReservations");
    const held = body.indexOf("reservationStillHeld");
    const paperwork = body.indexOf("deleteBareDraftPaperwork");
    expect(gate).toBeGreaterThan(0);
    expect(release).toBeGreaterThan(gate);
    expect(held).toBeGreaterThan(release);
    expect(paperwork).toBeGreaterThan(held);
    expect(body).not.toContain('from("expenses")');
    expect(body).not.toContain('from("bills")');
    expect(body).not.toContain('from("orders")');
    expect(body).not.toContain('from("payments")');
    expect(body).not.toContain('from("job_labor")');
    expect(body).not.toContain("stock_rolls");
  });

  it("deleteJobLabor never deletes a pay line", () => {
    const body = between(
      "src/app/(app)/jobs/actions.ts",
      "export async function deleteJobLabor",
      "export async function NO_FURTHER_JOB_ACTION",
    );
    expect(body).toContain("laborHistoryDeletionBlocker");
    expect(body).not.toContain(".delete(");
    expect(src("src/app/(app)/jobs/[id]/job-labor-card.tsx")).not.toContain("deleteJobLabor");
  });

  it("deleteEstimate and unapprove stop before destroying history", () => {
    const estimate = between(
      "src/app/(app)/estimates/actions.ts",
      "export async function deleteEstimate",
      "export async function saveEstimateBuilderDraft",
    );
    const gate = estimate.indexOf("assertFinancialDeletionAllowed");
    const release = estimate.indexOf("releaseJobReservations");
    const held = estimate.indexOf("reservationStillHeld");
    const paperwork = estimate.indexOf("deleteBareDraftPaperwork");
    const estimateDelete = estimate.indexOf('from("estimates").delete');
    expect(gate).toBeGreaterThan(0);
    expect(release).toBeGreaterThan(gate);
    expect(held).toBeGreaterThan(release);
    expect(paperwork).toBeGreaterThan(held);
    expect(estimateDelete).toBeGreaterThan(paperwork);
    expect(estimate).not.toContain("best-effort");
    expect(estimate).not.toContain('from("expenses")');
    expect(estimate).not.toContain('from("bills")');
    expect(estimate).not.toContain('from("orders")');
    expect(estimate).not.toContain('del("invoices")');

    const undo = between(
      "src/app/(app)/estimates/actions.ts",
      "export async function unapproveEstimate",
      "export async function deleteEstimate",
    );
    expect(undo.indexOf("deleteBareDraftPaperwork")).toBeGreaterThan(undo.indexOf("reservationStillHeld"));
    expect(undo.indexOf('status: "sent"')).toBeGreaterThan(undo.indexOf("deleteBareDraftPaperwork"));
    expect(undo).toContain("blockAnyInvoice: true");
    expect(undo).toContain("preserveInvoices: true");
    expect(undo).not.toContain('from("invoices").delete');
  });

  it("deleteCustomer does not reverse receipts or wipe stock before the gate", () => {
    const body = between(
      "src/app/(app)/customers/actions.ts",
      "export async function deleteCustomer",
      "const FOLLOWUP_ROLES",
    );
    expect(body.indexOf("releaseJobReservations")).toBeGreaterThan(
      body.indexOf("assertFinancialDeletionAllowed"),
    );
    expect(body.indexOf("deleteBareDraftPaperwork")).toBeGreaterThan(
      body.indexOf("reservationStillHeld"),
    );
    expect(body).not.toContain("reverseReceivedPOs");
    expect(body).not.toContain('from("stock_movements").delete');
    expect(body).not.toContain('from("invoices").delete');
    expect(body).not.toContain('from("payments")');

    const forever = between(
      "src/app/(app)/customer-records/actions.ts",
      "export async function deleteCustomerForever",
      "export async function NO_FURTHER_CUSTOMER_ACTION",
    );
    expect(forever).toContain("delete_customer_if_unused");
    expect(forever).not.toContain('from("invoices")');
    expect(forever).not.toContain('from("payments")');
    expect(forever).not.toContain('from("jobs").delete');
  });

  it("does not take over the order-deletion module", () => {
    // RC1 includes PR #67, so the order module exists beside this one.
    // Neither file calls the other's blocker.
    expect(existsSync(join(root, "src/lib/order-deletion.ts"))).toBe(true);
    expect(src("src/lib/financial-deletion.ts")).not.toContain("orderDestructionBlocker");
    expect(src("src/lib/order-deletion.ts")).not.toContain("financialDestructionBlocker");
    const orders = src("src/app/(app)/orders/actions.ts");
    expect(orders.indexOf("orderDestructionBlocker")).toBeLessThan(
      orders.indexOf('from("invoices").delete'),
    );
  });
});

describe("migration 0490", () => {
  it("refuses job, estimate, and customer deletes that would drop financial history", () => {
    const sql = src("supabase/migrations/0490_job_delete_preserves_financial_history.sql");
    expect(sql).toContain("refuse_job_delete_with_financial_history");
    expect(sql).toContain("refuse_job_cost_history_delete");
    expect(sql).toContain("refuse_estimate_delete_with_financial_history");
    expect(sql).toContain("refuse_customer_delete_with_financial_history");
    expect(sql).toContain("JOB_FINANCIAL_HISTORY");
    expect(sql).toContain("RESERVATION_RELEASE_FAILED");
    expect(sql).toContain("POSTED_INVOICE");
    expect(sql).toContain("security definer");
    expect(sql).toContain("Does not enable accounting");
    expect(sql).not.toContain("function public.refuse_posted_invoice_delete");
    expect(sql).not.toContain("function public.refuse_payment_delete");
    expect(sql).not.toMatch(/\bdrop table\b/i);
    expect(sql).not.toMatch(/\bdelete from\b/i);
  });
});
