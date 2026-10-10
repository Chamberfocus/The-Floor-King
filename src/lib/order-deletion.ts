/**
 * Order and draft-invoice deletion policy.
 * Posted invoices, payments, credits, deposits, write-offs, issued purchase
 * orders, and job cost history are kept. Only untouched draft paperwork may
 * be removed, and only after this check returns ok.
 */

export type InvoicePaperwork = {
  status: string | null;
  paymentCount: number;
  creditApplicationCount: number;
  depositApplicationCount: number;
  writeOffCount: number;
};

export type PurchaseOrderPaperwork = {
  status: string | null;
  receivedQty: number;
};

export type OrderDestructionFacts = {
  invoices: InvoicePaperwork[];
  purchaseOrders: PurchaseOrderPaperwork[];
  jobLaborCount: number;
  installerBillCount: number;
  trueUpCount: number;
  commissionLedgerCount: number;
};

export type DestructionBlock = {
  code:
    | "POSTED_INVOICE"
    | "PAYMENT_HISTORY"
    | "CREDIT_APPLICATION"
    | "DEPOSIT_OR_WRITE_OFF"
    | "ISSUED_PURCHASE_ORDER"
    | "PURCHASE_ORDER_RECEIPTS"
    | "JOB_FINANCIAL_HISTORY";
  message: string;
};

const POSTED_INVOICE_MESSAGE =
  "Issued invoices cannot be deleted. Void the invoice to cancel it.";
const PAYMENT_HISTORY_MESSAGE =
  "This invoice has payment history and can’t be deleted. Void only if unpaid, or keep it for history.";
const CREDIT_APPLICATION_MESSAGE =
  "This invoice has credit applications and can’t be deleted. Void instead.";
const DEPOSIT_OR_WRITE_OFF_MESSAGE =
  "This invoice has deposits or write-offs and can’t be deleted. Void instead.";

/** Same rule as the draft-invoice delete screen. Null means a bare draft. */
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

/**
 * Whether deleteOrder may remove the order and its untouched draft paperwork.
 * Any posted financial row blocks the entire delete. Nothing is voided here.
 */
export function orderDestructionBlocker(
  facts: OrderDestructionFacts,
): { ok: true } | { ok: false; block: DestructionBlock } {
  for (const invoice of facts.invoices) {
    const block = invoiceHardDeleteBlocker(invoice);
    if (block) {
      return {
        ok: false,
        block: {
          code: block.code,
          message: `This order was not deleted. ${block.message}`,
        },
      };
    }
  }

  for (const po of facts.purchaseOrders) {
    if (po.receivedQty > 0) {
      return {
        ok: false,
        block: {
          code: "PURCHASE_ORDER_RECEIPTS",
          message:
            "This order was not deleted. A purchase order has received quantities. That receiving history stays on the books.",
        },
      };
    }
    if ((po.status ?? "draft") !== "draft") {
      return {
        ok: false,
        block: {
          code: "ISSUED_PURCHASE_ORDER",
          message:
            "This order was not deleted. A purchase order was already ordered, received, closed, or voided. It was kept.",
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
        message:
          "This order was not deleted. The warehouse job has labor, installer billing, true-up, or commission history. That history stays on the books.",
      },
    };
  }

  return { ok: true };
}

/** Database triggers from 0488 use these exception texts. */
export function deleteErrorPreservesHistory(message: string | null | undefined): boolean {
  if (!message) return false;
  return /POSTED_INVOICE|PAYMENT_HISTORY|CREDIT_APPLICATION|DEPOSIT_APPLICATION|WRITE_OFF/.test(
    message,
  );
}
