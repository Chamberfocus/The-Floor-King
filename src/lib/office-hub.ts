/**
 * What the office desk should chase on a job.
 * Money that is already invoiced stays on the invoice list (invoiceAmountDue).
 * This only says whether the next step is a bill, the warehouse, or the install.
 */

export type OfficeJobLane = "invoice" | "warehouse" | "install";

export const OFFICE_LANE_ORDER: OfficeJobLane[] = ["invoice", "warehouse", "install"];

export const OFFICE_LANE_LABEL: Record<OfficeJobLane, string> = {
  invoice: "Write the invoice",
  warehouse: "Waiting on the warehouse",
  install: "Ready to schedule",
};

export type OfficeJobInput = {
  status: string;
  warehouseStatus: string | null;
  warehouseSubmittedAt: string | null;
  warehouseReadyAt: string | null;
  scheduledDate: string | null;
  /** Invoices that are not void. */
  invoiceCount: number;
  /** Sent or partial. Those balances stay on the invoice list. */
  openInvoiceCount: number;
  /** Draft invoices that have not been sent. */
  draftInvoiceCount: number;
};

export type OfficeInvoiceStatus = { status: string | null };

export function officeInvoiceCounts(rows: OfficeInvoiceStatus[]): {
  invoiceCount: number;
  openInvoiceCount: number;
  draftInvoiceCount: number;
} {
  let invoiceCount = 0;
  let openInvoiceCount = 0;
  let draftInvoiceCount = 0;
  for (const row of rows) {
    if (row.status === "void") continue;
    invoiceCount += 1;
    if (row.status === "draft") draftInvoiceCount += 1;
    if (row.status === "sent" || row.status === "partial") openInvoiceCount += 1;
  }
  return { invoiceCount, openInvoiceCount, draftInvoiceCount };
}

function withWarehouse(input: OfficeJobInput): boolean {
  return (
    Boolean(input.warehouseSubmittedAt) ||
    (input.warehouseStatus != null && input.warehouseStatus !== "pending")
  );
}

/** Null when the job is cancelled or nothing on it needs the office today. */
export function officeJobFollowUp(
  input: OfficeJobInput,
): { lane: OfficeJobLane; next: string } | null {
  if (input.status === "cancelled") return null;
  const ready = Boolean(input.warehouseReadyAt);
  const done = input.status === "completed";
  const billable = ready || done;

  if (billable && input.invoiceCount === 0) {
    if (done) {
      return { lane: "invoice", next: "The job is finished and there is no invoice yet." };
    }
    if (input.scheduledDate) {
      return {
        lane: "invoice",
        next: "The warehouse marked the material ready and the install is on the calendar. Write the invoice.",
      };
    }
    return {
      lane: "invoice",
      next: "The warehouse marked the material ready. Write the invoice, then the install can be scheduled.",
    };
  }

  if (
    billable &&
    input.draftInvoiceCount > 0 &&
    input.openInvoiceCount === 0 &&
    input.invoiceCount === input.draftInvoiceCount
  ) {
    return { lane: "invoice", next: "A draft invoice is sitting on this job. Send it." };
  }

  if (withWarehouse(input) && !ready && !done) {
    return {
      lane: "warehouse",
      next: "The order is with the warehouse. Confirm it arrived before you invoice.",
    };
  }

  if (ready && !input.scheduledDate && !done && input.invoiceCount > 0) {
    return {
      lane: "install",
      next: "Material is ready and the invoice is written. The install is not on the calendar yet.",
    };
  }

  return null;
}
