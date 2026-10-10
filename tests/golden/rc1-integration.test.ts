/**
 * RC1 interactions across PRs #65–#71.
 * Pure policy plus source order. These tests do not execute SQL.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  jobEffectOnArchive,
  jobEffectOnCancel,
  jobEffectOnLost,
  selectDeclineStage,
  stageIsLost,
  stageIsParked,
} from "@/lib/customer-lifecycle";
import {
  deleteErrorPreservesHistory as jobDeleteKeepsHistory,
  financialDestructionBlocker,
  reservationReleaseBlocker,
  type FinancialDeletionFacts,
} from "@/lib/financial-deletion";
import { cancelJobRpcOutcome } from "@/lib/job-cancel";
import {
  deleteErrorPreservesHistory as orderDeleteKeepsHistory,
  orderDestructionBlocker,
  type OrderDestructionFacts,
} from "@/lib/order-deletion";
import { invoiceRemainingBalance, paymentVoidRpcUnavailable } from "@/lib/payment-safety";
import {
  committedReceiptDeltas,
  planPoReceiveDelta,
  poStatusAfterRequiredReceipt,
} from "@/lib/po-stock";
import { authorizeDailyCronRequest, authorizeResendWebhook } from "@/lib/request-auth";

const ROOT = join(process.cwd());

function src(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function slice(path: string, start: string, end: string): string {
  const text = src(path);
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  return text.slice(from, to === -1 ? undefined : to);
}

function bareFinancial(over: Partial<FinancialDeletionFacts> = {}): FinancialDeletionFacts {
  return {
    invoices: [],
    purchaseOrders: [],
    jobs: [
      {
        id: "job-1",
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

function bareOrder(over: Partial<OrderDestructionFacts> = {}): OrderDestructionFacts {
  return {
    invoices: [],
    purchaseOrders: [],
    jobLaborCount: 0,
    installerBillCount: 0,
    trueUpCount: 0,
    commissionLedgerCount: 0,
    ...over,
  };
}

const sentInvoice = {
  id: "inv-1",
  status: "sent",
  paymentCount: 0,
  creditApplicationCount: 0,
  depositApplicationCount: 0,
  writeOffCount: 0,
};

describe("order deletion and job deletion", () => {
  it("a sent invoice blocks both the order and the job", () => {
    const order = orderDestructionBlocker(
      bareOrder({ invoices: [{ ...sentInvoice }] }),
    );
    const job = financialDestructionBlocker(
      "job",
      bareFinancial({ invoices: [sentInvoice] }),
    );
    expect(order.ok).toBe(false);
    expect(job.ok).toBe(false);
    if (!order.ok && !job.ok) {
      expect(order.block.code).toBe("POSTED_INVOICE");
      expect(job.block.code).toBe("POSTED_INVOICE");
      expect(orderDeleteKeepsHistory(order.block.code)).toBe(true);
      expect(jobDeleteKeepsHistory(job.block.code)).toBe(true);
    }
  });

  it("labor history blocks the order and the job, and a bare draft blocks neither", () => {
    const orderLabor = orderDestructionBlocker(bareOrder({ jobLaborCount: 1 }));
    const jobLabor = financialDestructionBlocker("job", bareFinancial({ jobLaborCount: 1 }));
    expect(orderLabor.ok).toBe(false);
    expect(jobLabor.ok).toBe(false);
    if (!orderLabor.ok && !jobLabor.ok) {
      expect(orderLabor.block.code).toBe("JOB_FINANCIAL_HISTORY");
      expect(jobLabor.block.code).toBe("JOB_FINANCIAL_HISTORY");
    }
    expect(orderDestructionBlocker(bareOrder()).ok).toBe(true);
    expect(financialDestructionBlocker("job", bareFinancial()).ok).toBe(true);
  });

  it("each delete checks its own guard before any row is removed", () => {
    const order = slice(
      "src/app/(app)/orders/actions.ts",
      "export async function deleteOrder",
      "export async function",
    );
    const job = slice(
      "src/app/(app)/jobs/actions.ts",
      "export async function deleteJob",
      "export async function",
    );
    expect(order.indexOf("orderDestructionBlocker")).toBeLessThan(
      order.indexOf('from("invoices").delete'),
    );
    expect(job.indexOf("assertFinancialDeletionAllowed")).toBeLessThan(
      job.indexOf("deleteBareDraftPaperwork"),
    );
    expect(job).not.toContain("orderDestructionBlocker");
    expect(order).not.toContain("financialDestructionBlocker");
  });
});

describe("customer deletion and financial history", () => {
  it("posted money, approval history, and a failed release stop a customer delete", () => {
    const posted = financialDestructionBlocker(
      "customer",
      bareFinancial({
        invoices: [
          {
            id: "inv-1",
            status: "draft",
            paymentCount: 1,
            creditApplicationCount: 0,
            depositApplicationCount: 0,
            writeOffCount: 0,
          },
        ],
      }),
    );
    const approved = financialDestructionBlocker(
      "customer",
      bareFinancial({ approvalSnapshotCount: 1 }),
    );
    const bare = financialDestructionBlocker("customer", bareFinancial());
    expect(posted.ok).toBe(false);
    expect(approved.ok).toBe(false);
    expect(bare.ok).toBe(true);
    if (!posted.ok) expect(posted.block.code).toBe("PAYMENT_HISTORY");
    if (!approved.ok) expect(approved.block.code).toBe("APPROVAL_HISTORY");
    expect(reservationReleaseBlocker("customer", 3)?.code).toBe("RESERVATION_RELEASE_FAILED");
    expect(reservationReleaseBlocker("customer", 0)).toBeNull();
  });

  it("customer delete confirms history before it releases stock or removes the row", () => {
    const fn = slice(
      "src/app/(app)/customers/actions.ts",
      "export async function deleteCustomer",
      "const FOLLOWUP_ROLES",
    );
    const gate = fn.indexOf("assertFinancialDeletionAllowed");
    const release = fn.indexOf("releaseJobReservations");
    const held = fn.indexOf("reservationStillHeld");
    const paperwork = fn.indexOf("deleteBareDraftPaperwork");
    const row = fn.indexOf('from("customers").delete');
    expect(gate).toBeGreaterThan(0);
    expect(release).toBeGreaterThan(gate);
    expect(held).toBeGreaterThan(release);
    expect(paperwork).toBeGreaterThan(held);
    expect(row).toBeGreaterThan(paperwork);
    expect(fn).not.toContain("reverseReceivedPOs");
    expect(fn).toContain('["admin", "office"]');
  });
});

describe("job cancellation and inventory reservations", () => {
  it("a failed release leaves the job uncancelled, and a repeat cancel is idempotent", () => {
    expect(
      cancelJobRpcOutcome({
        errorMessage: "Could not find the function cancel_job_with_reservations",
        payload: null,
      }).ok,
    ).toBe(false);
    expect(
      cancelJobRpcOutcome({
        errorMessage: null,
        payload: { ok: false, code: "RESERVATION_RELEASE_FAILED" },
      }).ok,
    ).toBe(false);
    expect(
      cancelJobRpcOutcome({
        errorMessage: null,
        payload: { ok: false, code: "JOB_COMPLETED" },
      }),
    ).toMatchObject({ ok: false });
    expect(
      cancelJobRpcOutcome({
        errorMessage: null,
        payload: { ok: true, already_cancelled: true },
      }),
    ).toEqual({ ok: true, alreadyCancelled: true });
  });

  it("Lost cancels only work that has not started, and uses the same cancel transaction", () => {
    expect(jobEffectOnLost("scheduled")).toBe("cancel");
    expect(jobEffectOnLost("in_progress")).toBe("keep");
    expect(jobEffectOnCancel("in_progress")).toBe("cancel");
    expect(jobEffectOnArchive("in_progress")).toBe("keep");
    const settle = slice(
      "src/lib/workflow-engine.ts",
      "export async function settleJobsForStage",
      "export async function moveToAutoActionStage",
    );
    expect(settle.indexOf("stageIsLost")).toBeLessThan(settle.indexOf("cancelJobWithReservations"));
    expect(settle).not.toContain('.update({ status: "cancelled" })');
    const edit = slice(
      "src/app/(app)/jobs/actions.ts",
      "if (newStatus === \"cancelled\")",
      "const patch",
    );
    expect(edit.indexOf("cancelJobWithReservations")).toBeLessThan(edit.indexOf("if (!cancelled.ok)"));
  });
});

describe("purchase-order receiving and the inventory ledger", () => {
  it("a partial receipt stays partial, and a failed line posts nothing", () => {
    const first = planPoReceiveDelta({
      orderedQty: 100,
      targetReceivedQty: 40,
      alreadyOnLedger: 0,
    });
    expect(first).toEqual({ ok: true, delta: 40 });
    expect(
      poStatusAfterRequiredReceipt({
        previousStatus: "ordered",
        requestedStatus: "ordered",
        stockPosted: true,
      }),
    ).toBe("ordered");
    expect(
      poStatusAfterRequiredReceipt({
        previousStatus: "ordered",
        requestedStatus: "received",
        stockPosted: false,
      }),
    ).toBe("ordered");
    const rest = planPoReceiveDelta({
      orderedQty: 100,
      targetReceivedQty: 100,
      alreadyOnLedger: 40,
    });
    expect(rest).toEqual({ ok: true, delta: 60 });
    expect(
      poStatusAfterRequiredReceipt({
        previousStatus: "ordered",
        requestedStatus: "received",
        stockPosted: true,
      }),
    ).toBe("received");
    expect(
      planPoReceiveDelta({
        orderedQty: 100,
        targetReceivedQty: 40,
        alreadyOnLedger: 40,
      }),
    ).toEqual({ ok: true, delta: 0 });
    expect(
      committedReceiptDeltas([
        { id: "a", delta: 40, postOk: true },
        { id: "b", delta: 60, postOk: false },
      ]),
    ).toEqual({ committed: false, deltas: [] });
  });

  it("the received status is written only after the batch call", () => {
    const apply = slice(
      "src/app/(app)/purchase-orders/actions.ts",
      "export async function applyPoStatus",
      "export async function deletePurchaseOrder",
    );
    const stock = apply.indexOf("await reconcilePoStock");
    const status = apply.indexOf('update({ status })');
    expect(stock).toBeGreaterThan(0);
    expect(status).toBeGreaterThan(stock);
    const receipt = slice(
      "src/lib/po-stock.ts",
      "export async function applyReceiptToStock",
      "export async function reconcilePoStock",
    );
    expect(receipt.match(/postPoReceiptLines/g)).toHaveLength(1);
    const sql = src("supabase/migrations/0491_atomic_po_receive.sql");
    expect(sql.indexOf("for update")).toBeLessThan(sql.indexOf("receive_inventory_safe("));
    expect(sql.indexOf("receive_inventory_safe(")).toBeLessThan(
      sql.indexOf("raise exception 'PO_RECEIVE_FAILED'"),
    );
    expect(sql).not.toMatch(/update\s+public\.purchase_orders/i);
  });
});

describe("payment voids and invoice balances", () => {
  it("a void restores collectible balance and still blocks hard delete", () => {
    const due = invoiceRemainingBalance(
      [{ quantity: 1, rate: 1000 }],
      0,
      [
        { amount: 400, status: "active" },
        { amount: 600, status: "void" },
      ],
    );
    expect(due).toBe(600);
    const blocked = financialDestructionBlocker(
      "job",
      bareFinancial({
        invoices: [
          {
            id: "inv-1",
            status: "draft",
            paymentCount: 1,
            creditApplicationCount: 0,
            depositApplicationCount: 0,
            writeOffCount: 0,
          },
        ],
      }),
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.block.code).toBe("PAYMENT_HISTORY");
  });

  it("a missing void function does not change the payment", () => {
    expect(paymentVoidRpcUnavailable("Could not find void_invoice_payment_safe")).toBe(true);
    const fn = slice(
      "src/app/(app)/invoices/actions.ts",
      "export async function voidPayment",
      "export async function deletePayment",
    );
    expect(fn.indexOf("assertRole(INVOICE_PAYMENT_VOID_ROLES)")).toBeLessThan(
      fn.indexOf("void_invoice_payment_safe"),
    );
    expect(fn).toContain("paymentVoidRpcUnavailable");
    expect(fn).not.toContain('status: "void"');
    expect(fn).not.toContain(".delete(");
  });
});

describe("Lost and Parked outcomes with the customer lifecycle", () => {
  it("a stored outcome wins over a misleading label", () => {
    const lost = { name: "Install follow-up", outcome: "lost" as const, position: 90 };
    const parked = { name: "Lost / Declined", outcome: "parked" as const, position: 40 };
    const active = { name: "Lost / Declined", outcome: "active" as const, position: 20 };
    expect(stageIsLost(lost)).toBe(true);
    expect(stageIsParked(lost)).toBe(false);
    expect(stageIsParked(parked)).toBe(true);
    expect(stageIsLost(parked)).toBe(false);
    expect(stageIsLost(active)).toBe(false);
    expect(
      selectDeclineStage([
        { id: "label", name: "Cancelled", outcome: null, position: 10 },
        { id: "real", name: "Did not buy", outcome: "lost" as const, position: 80 },
      ])?.id,
    ).toBe("real");
  });

  it("a declined estimate moves to the Lost outcome, not a name match", () => {
    const decline = slice(
      "src/app/(app)/estimates/actions.ts",
      "export async function onEstimateDeclined",
      "export async function",
    );
    expect(decline).toContain("advanceToLostStage");
    expect(decline).not.toContain("advanceToNamedStage");
  });
});

describe("role permissions and protected operations", () => {
  it("cron and webhook auth fail closed", () => {
    const request = { headers: { get: () => "Bearer secret" } };
    expect(authorizeDailyCronRequest(request, {}).status).toBe(401);
    expect(
      authorizeDailyCronRequest(request, {
        CRON_SECRET: "secret",
        VERCEL_ENV: "preview",
      }).status,
    ).toBe(403);
    expect(
      authorizeDailyCronRequest(request, {
        CRON_SECRET: "secret",
        VERCEL_ENV: "production",
      }).ok,
    ).toBe(true);
    expect(authorizeResendWebhook("nope", { RESEND_WEBHOOK_SECRET: "secret" }).status).toBe(401);
  });

  it("delete, void, and receiving check a role before the protected write", () => {
    const job = slice(
      "src/app/(app)/jobs/actions.ts",
      "export async function deleteJob",
      "export async function",
    );
    expect(job.indexOf('assertRole(["admin", "office"])')).toBeLessThan(
      job.indexOf("assertFinancialDeletionAllowed"),
    );
    const invoice = slice(
      "src/app/(app)/invoices/actions.ts",
      "export async function deleteInvoice",
      "export async function",
    );
    expect(invoice.indexOf("assertRole(INVOICE_DELETE_ROLES)")).toBeLessThan(
      invoice.indexOf("invoiceHardDeleteBlocker"),
    );
    const receive = slice(
      "src/app/(app)/warehouse/receiving-actions.ts",
      "export async function receivePoLines",
      "export async function unreceivePoLine",
    );
    expect(receive.indexOf("assertRole")).toBeLessThan(receive.indexOf("postPoReceiptLines"));
    expect(receive).toContain("assertRole([...RECEIVERS])");
    expect(src("src/app/(app)/warehouse/receiving-actions.ts")).toContain(
      'const RECEIVERS = ["admin", "office", "warehouse"]',
    );
  });
});

describe("migrations 0487 through 0491", () => {
  it("each repair has one migration and does not recreate another repair's function", () => {
    const files = [
      "0487_workflow_stage_outcome.sql",
      "0488_order_delete_preserves_financial_history.sql",
      "0489_cancel_job_with_reservations.sql",
      "0490_job_delete_preserves_financial_history.sql",
      "0491_atomic_po_receive.sql",
    ];
    const bodies = files.map((name) => src(`supabase/migrations/${name}`));
    expect(bodies[0]).toContain("outcome");
    expect(bodies[1]).toContain("refuse_posted_invoice_delete");
    expect(bodies[2]).toContain("cancel_job_with_reservations");
    expect(bodies[3]).toContain("refuse_job_delete_with_financial_history");
    expect(bodies[4]).toContain("receive_po_lines_safe");
    expect(bodies[3]).not.toContain("function public.refuse_posted_invoice_delete");
    expect(bodies[3]).not.toContain("function public.refuse_payment_delete");
    expect(bodies[4]).not.toContain("cancel_job_with_reservations");
    expect(bodies[2]).not.toContain("receive_po_lines_safe");
    for (const body of bodies) {
      expect(body).not.toMatch(/drop\s+table/i);
      expect(body).not.toMatch(/delete\s+from/i);
    }
  });
});
