/**
 * F4 deposit classification (pure).
 */
import { ACCOUNTING_FAILURE } from "@/lib/accounting/event-status";

export type DepositClassification =
  | "ar_payment"
  | "pre_invoice_deposit"
  | "legacy_ambiguous";

export function classifyPaymentForAccounting(args: {
  hasIssuedInvoiceWithPositiveTotal: boolean;
  blankZeroInvoice: boolean;
  explicitPreInvoiceDeposit: boolean;
  legacyAmbiguous?: boolean;
}):
  | { ok: true; classification: DepositClassification }
  | { ok: false; classification: "legacy_ambiguous"; code: string; message: string } {
  if (args.legacyAmbiguous) {
    return {
      ok: false,
      classification: "legacy_ambiguous",
      code: ACCOUNTING_FAILURE.DEPOSIT_UNCLASSIFIED,
      message: "Legacy/ambiguous deposit — no automatic posting.",
    };
  }
  if (args.explicitPreInvoiceDeposit) {
    return { ok: true, classification: "pre_invoice_deposit" };
  }
  if (args.hasIssuedInvoiceWithPositiveTotal && !args.blankZeroInvoice) {
    return { ok: true, classification: "ar_payment" };
  }
  if (args.blankZeroInvoice) {
    return {
      ok: false,
      classification: "legacy_ambiguous",
      code: ACCOUNTING_FAILURE.DEPOSIT_UNCLASSIFIED,
      message:
        "Blank/zero invoice payment is ambiguous (AR vs deposit). Classify explicitly before posting.",
    };
  }
  return {
    ok: false,
    classification: "legacy_ambiguous",
    code: ACCOUNTING_FAILURE.DEPOSIT_UNCLASSIFIED,
    message: "Payment classification could not be determined.",
  };
}

/** Deposit apply to invoice is a non-cash transfer. */
export function depositApplyIsCashMovement(): false {
  return false;
}
