/**
 * F0 payment safety — pure helpers (overpay, void, active paid totals).
 * F1: remaining balance also subtracts applied credits via effectiveInvoiceBalance.
 */
import { type CalcInvoiceItem } from "@/lib/invoice-calc";
import {
  activeApplicationsTotal,
  effectiveInvoiceBalance,
} from "@/lib/credit-ar";

export type PaymentStatus = "active" | "void";

export const PAYMENT_OVERPAY_MESSAGE =
  "Payment exceeds the remaining balance on this invoice.";

export const PAYMENT_NONPOSITIVE_MESSAGE =
  "Payment amount must be greater than zero.";

export const PAYMENT_VOID_REQUIRED_MESSAGE =
  "Payments can’t be deleted. Void the payment to preserve history.";

export const PAYMENT_VOID_RPC_REQUIRED_MESSAGE =
  "This payment was not voided. The safe void function is required, and the payment row was not changed.";

/** True when PostgREST reports that void_invoice_payment_safe is missing. */
export function paymentVoidRpcUnavailable(message: string | null | undefined): boolean {
  return (message ?? "").includes("void_invoice_payment_safe");
}

export const PAYMENT_SAVE_FAILED_MESSAGE =
  "This payment could not be recorded. Refresh and verify the balance before retrying.";

const INTERNAL_MONEY_ERROR =
  /sqlstate|postgres|pgrst|syntax error|violates|duplicate key|permission denied|schema cache|could not find the function|jwt_role|accounting_forbidden|record_invoice_payment_safe|void_invoice_payment_safe|record_customer_deposit_safe|42501|23505|23514|stack|supabase/i;

/**
 * Employee-facing payment/deposit failure.
 * Known business sentences from the payment RPC stay visible.
 * Transport, constraint, and role-exception text does not.
 */
export function employeePaymentError(
  raw: string | null | undefined,
  fallback: string = PAYMENT_SAVE_FAILED_MESSAGE,
): string {
  const msg = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!msg || msg.length > 240 || INTERNAL_MONEY_ERROR.test(msg)) return fallback;
  return msg;
}

export interface PaymentLike {
  amount?: number | string | null;
  status?: string | null;
}

/** Active (non-void) payments only. Missing status = active (legacy). */
export function isActivePayment(p: PaymentLike): boolean {
  const s = (p.status ?? "active").toLowerCase();
  return s !== "void";
}

export function activePaymentsTotal(payments: PaymentLike[] | null | undefined): number {
  return Math.round(
    ((payments ?? []).filter(isActivePayment).reduce((s, p) => {
      const n = typeof p.amount === "number" ? p.amount : parseFloat(String(p.amount ?? 0));
      return s + (Number.isFinite(n) ? n : 0);
    }, 0) +
      Number.EPSILON) *
      100,
  ) / 100;
}

export function invoiceRemainingBalance(
  items: CalcInvoiceItem[],
  taxRate: number | string | null | undefined,
  payments: PaymentLike[] | null | undefined,
  appliedCredits: number = 0,
  appliedDeposits: number = 0,
  appliedWriteOffs: number = 0,
): number {
  const paid = activePaymentsTotal(payments);
  return effectiveInvoiceBalance({
    items,
    taxRate,
    amountPaid: paid,
    appliedCredits,
    appliedDeposits,
    appliedWriteOffs,
  }).amountDue;
}

/**
 * Day Briefing / collect-task amount due — same as invoiceRemainingBalance
 * (payments + credits + applied deposits + write-offs).
 * Void payments never reduce this amount. Unapplied deposits are not netted.
 */
export function dayTaskCollectAmountDue(args: {
  items: CalcInvoiceItem[];
  taxRate: number | string | null | undefined;
  payments?: PaymentLike[] | null;
  creditApplications?: { amount: number | string; status?: string | null }[] | null;
  appliedDeposits?: number;
  appliedWriteOffs?: number;
}): number {
  return invoiceRemainingBalance(
    args.items,
    args.taxRate,
    args.payments,
    activeApplicationsTotal(args.creditApplications),
    args.appliedDeposits ?? 0,
    args.appliedWriteOffs ?? 0,
  );
}

export function assessPaymentAmount(args: {
  amount: number;
  remainingBalance: number;
  /** Blank deposit invoice: total ~0 and no line items. */
  allowDepositOnZeroTotal?: boolean;
  invoiceTotal?: number;
  itemCount?: number;
}): { ok: true } | { ok: false; error: string } {
  const amount = Math.round((Number(args.amount) || 0) * 100) / 100;
  if (!(amount > 0)) {
    return { ok: false, error: PAYMENT_NONPOSITIVE_MESSAGE };
  }
  const total = Math.round((Number(args.invoiceTotal) || 0) * 100) / 100;
  const items = args.itemCount ?? 1;
  if (args.allowDepositOnZeroTotal && total <= 0.005 && items === 0) {
    return { ok: true };
  }
  const remaining = Math.round((Number(args.remainingBalance) || 0) * 100) / 100;
  if (amount > remaining + 0.005) {
    return {
      ok: false,
      error: `${PAYMENT_OVERPAY_MESSAGE} Remaining: $${Math.max(0, remaining).toFixed(2)}.`,
    };
  }
  return { ok: true };
}

/** Simulate two payment attempts against the same remaining balance. */
export function simulateConcurrentPayments(
  remaining: number,
  attemptA: number,
  attemptB: number,
): { accepted: number[]; rejected: number[] } {
  let left = Math.round(remaining * 100) / 100;
  const accepted: number[] = [];
  const rejected: number[] = [];
  for (const amt of [attemptA, attemptB]) {
    const gate = assessPaymentAmount({ amount: amt, remainingBalance: left });
    if (gate.ok) {
      accepted.push(amt);
      left = Math.round((left - amt) * 100) / 100;
    } else {
      rejected.push(amt);
    }
  }
  return { accepted, rejected };
}

export type IdempotencyReplayResult =
  | { action: "proceed" }
  | { action: "duplicate"; paymentId: string }
  | {
      action: "reject";
      code: "IDEMPOTENCY_CROSS_INVOICE" | "IDEMPOTENCY_CONFLICT";
    };

/**
 * Mirrors record_invoice_payment_safe idempotency branches (pre-lock, post-lock, unique_violation).
 */
export function resolveIdempotencyReplay(args: {
  key: string | null | undefined;
  targetInvoiceId: string;
  existing: { paymentId: string; invoiceId: string; key: string } | null;
}): IdempotencyReplayResult {
  if (!args.key) return { action: "proceed" };
  const hit = args.existing;
  if (!hit || hit.key !== args.key) return { action: "proceed" };
  if (hit.invoiceId === args.targetInvoiceId) {
    return { action: "duplicate", paymentId: hit.paymentId };
  }
  return { action: "reject", code: "IDEMPOTENCY_CROSS_INVOICE" };
}
