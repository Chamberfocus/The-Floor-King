/**
 * Order deletion must keep posted financial history.
 * Pure policy plus source order. No database and no service-role client.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  deleteErrorPreservesHistory,
  invoiceHardDeleteBlocker,
  orderDestructionBlocker,
  type InvoicePaperwork,
  type OrderDestructionFacts,
} from "@/lib/order-deletion";

const bare = (over: Partial<InvoicePaperwork> = {}): InvoicePaperwork => ({
  status: "draft",
  paymentCount: 0,
  creditApplicationCount: 0,
  depositApplicationCount: 0,
  writeOffCount: 0,
  ...over,
});

const clean = (over: Partial<OrderDestructionFacts> = {}): OrderDestructionFacts => ({
  invoices: [],
  purchaseOrders: [],
  jobLaborCount: 0,
  installerBillCount: 0,
  trueUpCount: 0,
  commissionLedgerCount: 0,
  ...over,
});

const action = readFileSync("src/app/(app)/orders/actions.ts", "utf8");
const invoiceAction = readFileSync("src/app/(app)/invoices/actions.ts", "utf8");
const page = readFileSync("src/app/(app)/orders/page.tsx", "utf8");
const migration = readFileSync(
  "supabase/migrations/0488_order_delete_preserves_financial_history.sql",
  "utf8",
);

function deleteOrderSource(): string {
  const start = action.indexOf("export async function deleteOrder");
  const end = action.indexOf("export async function declineOrder");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return action.slice(start, end);
}

describe("invoice hard delete", () => {
  it("allows a draft with no financial rows", () => {
    expect(invoiceHardDeleteBlocker(bare())).toBeNull();
  });

  it("blocks issued, paid, and void invoices before any payment check", () => {
    for (const status of ["sent", "partial", "paid", "void"]) {
      expect(invoiceHardDeleteBlocker(bare({ status }))?.code).toBe("POSTED_INVOICE");
    }
  });

  it("blocks a draft that already has a payment, including a voided payment row", () => {
    const block = invoiceHardDeleteBlocker(bare({ paymentCount: 1 }));
    expect(block?.code).toBe("PAYMENT_HISTORY");
    expect(block?.message).toContain("payment history");
  });

  it("blocks credits, deposits, and write-offs", () => {
    expect(invoiceHardDeleteBlocker(bare({ creditApplicationCount: 1 }))?.code).toBe(
      "CREDIT_APPLICATION",
    );
    expect(invoiceHardDeleteBlocker(bare({ depositApplicationCount: 1 }))?.code).toBe(
      "DEPOSIT_OR_WRITE_OFF",
    );
    expect(invoiceHardDeleteBlocker(bare({ writeOffCount: 1 }))?.code).toBe(
      "DEPOSIT_OR_WRITE_OFF",
    );
  });
});

describe("order destruction", () => {
  it("allows an order whose paperwork is still an untouched draft", () => {
    expect(
      orderDestructionBlocker(
        clean({
          invoices: [bare()],
          purchaseOrders: [{ status: "draft", receivedQty: 0 }],
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("refuses the whole order when any invoice has posted money", () => {
    const decision = orderDestructionBlocker(
      clean({
        invoices: [bare(), bare({ paymentCount: 2 })],
        purchaseOrders: [{ status: "draft", receivedQty: 0 }],
      }),
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.block.code).toBe("PAYMENT_HISTORY");
      expect(decision.block.message).toContain("This order was not deleted");
    }
  });

  it("refuses a void invoice instead of deleting it", () => {
    const decision = orderDestructionBlocker(clean({ invoices: [bare({ status: "void" })] }));
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.block.code).toBe("POSTED_INVOICE");
  });

  it("refuses received or issued purchase orders", () => {
    expect(
      orderDestructionBlocker(
        clean({ purchaseOrders: [{ status: "draft", receivedQty: 3 }] }),
      ).ok,
    ).toBe(false);
    const issued = orderDestructionBlocker(
      clean({ purchaseOrders: [{ status: "ordered", receivedQty: 0 }] }),
    );
    expect(issued.ok).toBe(false);
    if (!issued.ok) expect(issued.block.code).toBe("ISSUED_PURCHASE_ORDER");
  });

  it("refuses job labor, installer bills, true-ups, and commission history", () => {
    for (const patch of [
      { jobLaborCount: 1 },
      { installerBillCount: 1 },
      { trueUpCount: 1 },
      { commissionLedgerCount: 1 },
    ]) {
      const decision = orderDestructionBlocker(clean(patch));
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.block.code).toBe("JOB_FINANCIAL_HISTORY");
    }
  });
});

describe("deleteOrder wiring", () => {
  it("decides before any delete and does not cascade invoices by job", () => {
    const body = deleteOrderSource();
    const decisionAt = body.indexOf("orderDestructionBlocker");
    const deleteAt = body.indexOf(".delete(");
    expect(decisionAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(decisionAt);
    expect(body).not.toContain('.from("invoices").delete().eq("job_id"');
    expect(body).toContain("orderDeleteDenied(decision.block.message)");
    expect(page).not.toContain("invoice &");
    expect(page).toContain("order_error");
    expect(invoiceAction).toContain("invoiceHardDeleteBlocker");
  });

  it("treats the database guard errors as history that must be kept", () => {
    expect(deleteErrorPreservesHistory("POSTED_INVOICE")).toBe(true);
    expect(deleteErrorPreservesHistory("PAYMENT_HISTORY")).toBe(true);
    expect(deleteErrorPreservesHistory("CREDIT_APPLICATION")).toBe(true);
    expect(deleteErrorPreservesHistory("DEPOSIT_APPLICATION")).toBe(true);
    expect(deleteErrorPreservesHistory("WRITE_OFF")).toBe(true);
    expect(deleteErrorPreservesHistory("permission denied")).toBe(false);
    expect(migration).toContain("refuse_posted_invoice_delete");
    expect(migration).toContain("refuse_payment_delete");
    expect(migration).toContain("before delete on public.invoices");
    expect(migration).toContain("before delete on public.payments");
    expect(migration).not.toMatch(/posting_enabled\s*=\s*true/i);
  });
});
