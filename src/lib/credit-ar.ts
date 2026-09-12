/**
 * F1 Credits / Refunds / Effective AR — pure helpers (no DB).
 *
 * Concepts:
 * - Invoice = charge
 * - Payment = money in (active only)
 * - Credit memo = AR reduction (issued / void)
 * - Credit application = credit applied to a specific invoice
 * - Refund = money out against available (unapplied) credit
 *
 * Canonical remaining (matches public.invoice_open_ar_balance / 0171):
 *   amountDue = max(0, total − active payments − active credits
 *                         − active deposit applications − active write-offs)
 * Invoice *total* is commercial lines + tax and is never reduced to hide deposits.
 * Unapplied customer deposits are NOT netted here — they must be applied first.
 * available credit on memo = issued − applied − refunded (voids excluded)
 */
import { invoiceTotals, type CalcInvoiceItem } from "@/lib/invoice-calc";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export const CREDIT_NONPOSITIVE_MESSAGE =
  "Credit amount must be greater than zero.";
export const REFUND_NONPOSITIVE_MESSAGE =
  "Refund amount must be greater than zero.";
export const CREDIT_OVERAPPLY_MESSAGE =
  "Cannot apply more credit than the invoice amount still due.";
export const CREDIT_OVERAVAILABLE_MESSAGE =
  "Cannot apply more than available credit.";
export const REFUND_OVERAVAILABLE_MESSAGE =
  "Cannot refund more than available credit.";
export const CREDIT_VOID_REQUIRED_MESSAGE =
  "Credits can’t be deleted. Void the credit to preserve history.";
export const REFUND_VOID_REQUIRED_MESSAGE =
  "Refunds can’t be deleted. Void the refund to preserve history.";

export type CreditMemoStatus = "issued" | "void";
export type CreditApplicationStatus = "active" | "void";
export type RefundStatus = "active" | "void";

export interface CreditMemoLike {
  amount: number | string;
  status?: string | null;
}

export interface CreditApplicationLike {
  amount: number | string;
  status?: string | null;
  invoice_id?: string | null;
  credit_memo_id?: string | null;
}

export interface RefundLike {
  amount: number | string;
  status?: string | null;
  credit_memo_id?: string | null;
}

export function isIssuedCredit(c: CreditMemoLike): boolean {
  return ((c.status ?? "issued") as string).toLowerCase() !== "void";
}

export function isActiveCreditApplication(a: CreditApplicationLike): boolean {
  return ((a.status ?? "active") as string).toLowerCase() !== "void";
}

export function isActiveRefund(r: RefundLike): boolean {
  return ((r.status ?? "active") as string).toLowerCase() !== "void";
}

export function issuedCreditsTotal(
  memos: CreditMemoLike[] | null | undefined,
): number {
  return round2(
    (memos ?? [])
      .filter(isIssuedCredit)
      .reduce((s, c) => s + (Number(c.amount) || 0), 0),
  );
}

export function activeApplicationsTotal(
  apps: CreditApplicationLike[] | null | undefined,
): number {
  return round2(
    (apps ?? [])
      .filter(isActiveCreditApplication)
      .reduce((s, a) => s + (Number(a.amount) || 0), 0),
  );
}

export function activeRefundsTotal(
  refunds: RefundLike[] | null | undefined,
): number {
  return round2(
    (refunds ?? [])
      .filter(isActiveRefund)
      .reduce((s, r) => s + (Number(r.amount) || 0), 0),
  );
}

/** Available (refundable / still-unapplied) amount on one memo. */
export function creditMemoAvailable(args: {
  memoAmount: number;
  memoStatus?: string | null;
  applications?: CreditApplicationLike[] | null;
  refunds?: RefundLike[] | null;
}): number {
  if (!isIssuedCredit({ amount: args.memoAmount, status: args.memoStatus })) {
    return 0;
  }
  return round2(
    Math.max(
      0,
      (Number(args.memoAmount) || 0) -
        activeApplicationsTotal(args.applications) -
        activeRefundsTotal(args.refunds),
    ),
  );
}

/** Customer-level available credit across memos. */
export function customerAvailableCredit(args: {
  memos: { id: string; amount: number; status?: string | null }[];
  applications: CreditApplicationLike[];
  refunds: RefundLike[];
}): number {
  let total = 0;
  for (const m of args.memos) {
    total += creditMemoAvailable({
      memoAmount: m.amount,
      memoStatus: m.status,
      applications: args.applications.filter((a) => a.credit_memo_id === m.id),
      refunds: args.refunds.filter((r) => r.credit_memo_id === m.id),
    });
  }
  return round2(total);
}

export interface EffectiveInvoiceBalance {
  total: number;
  paid: number;
  credited: number;
  deposited: number;
  writtenOff: number;
  /** total − reductions (may be negative if over-applied; display clamps). */
  rawBalance: number;
  /** Amount still due from customer — never unexplained negative. */
  amountDue: number;
}

/**
 * Canonical collectible invoice balance. Same arithmetic as
 * public.invoice_open_ar_balance. Payments are invoice-linked rows (the
 * allocation). Deposits reduce due only after an active application row.
 */
export function effectiveInvoiceBalance(args: {
  items: CalcInvoiceItem[];
  taxRate: number | string | null | undefined;
  amountPaid: number;
  appliedCredits: number;
  appliedDeposits?: number;
  appliedWriteOffs?: number;
}): EffectiveInvoiceBalance {
  const { total } = invoiceTotals(args.items, args.taxRate ?? 0, 0);
  const paid = round2(Math.max(0, Number(args.amountPaid) || 0));
  const credited = round2(Math.max(0, Number(args.appliedCredits) || 0));
  const deposited = round2(Math.max(0, Number(args.appliedDeposits) || 0));
  const writtenOff = round2(Math.max(0, Number(args.appliedWriteOffs) || 0));
  const rawBalance = round2(total - paid - credited - deposited - writtenOff);
  return {
    total: round2(total),
    paid,
    credited,
    deposited,
    writtenOff,
    rawBalance,
    amountDue: Math.max(0, rawBalance),
  };
}

export function assessCreditApplication(args: {
  amount: number;
  availableOnMemo: number;
  invoiceAmountDue: number;
}): { ok: true; apply: number } | { ok: false; error: string } {
  const amount = round2(args.amount);
  if (!(amount > 0)) return { ok: false, error: CREDIT_NONPOSITIVE_MESSAGE };
  const available = round2(args.availableOnMemo);
  if (amount > available + 0.005) {
    return {
      ok: false,
      error: `${CREDIT_OVERAVAILABLE_MESSAGE} Available: $${available.toFixed(2)}.`,
    };
  }
  const due = round2(args.invoiceAmountDue);
  if (due <= 0.005) {
    return {
      ok: false,
      error: "Invoice has no remaining balance to apply this credit against.",
    };
  }
  if (amount > due + 0.005) {
    return {
      ok: false,
      error: `${CREDIT_OVERAPPLY_MESSAGE} Amount due: $${due.toFixed(2)}.`,
    };
  }
  return { ok: true, apply: amount };
}

export function assessRefundAmount(args: {
  amount: number;
  availableCredit: number;
}): { ok: true } | { ok: false; error: string } {
  const amount = round2(args.amount);
  if (!(amount > 0)) return { ok: false, error: REFUND_NONPOSITIVE_MESSAGE };
  const available = round2(args.availableCredit);
  if (amount > available + 0.005) {
    return {
      ok: false,
      error: `${REFUND_OVERAVAILABLE_MESSAGE} Available: $${available.toFixed(2)}.`,
    };
  }
  return { ok: true };
}

/** Two concurrent attempts against the same available pool. */
export function simulateConcurrentCreditUse(
  available: number,
  attemptA: number,
  attemptB: number,
): { accepted: number[]; rejected: number[] } {
  let left = round2(available);
  const accepted: number[] = [];
  const rejected: number[] = [];
  for (const amt of [attemptA, attemptB]) {
    const gate = assessRefundAmount({ amount: amt, availableCredit: left });
    if (gate.ok) {
      accepted.push(amt);
      left = round2(left - amt);
    } else {
      rejected.push(amt);
    }
  }
  return { accepted, rejected };
}

export function simulateConcurrentApplications(
  availableOnMemo: number,
  invoiceDue: number,
  attemptA: number,
  attemptB: number,
): { accepted: number[]; rejected: number[] } {
  let memoLeft = round2(availableOnMemo);
  let dueLeft = round2(invoiceDue);
  const accepted: number[] = [];
  const rejected: number[] = [];
  for (const amt of [attemptA, attemptB]) {
    const gate = assessCreditApplication({
      amount: amt,
      availableOnMemo: memoLeft,
      invoiceAmountDue: dueLeft,
    });
    if (gate.ok) {
      accepted.push(gate.apply);
      memoLeft = round2(memoLeft - gate.apply);
      dueLeft = round2(dueLeft - gate.apply);
    } else {
      rejected.push(amt);
    }
  }
  return { accepted, rejected };
}

/**
 * Same credit dollar cannot be both fully applied and refunded.
 * After applying `applied`, refund of `refund` against original issued fails
 * when applied + refund > issued.
 */
export function assessApplyAndRefundExclusive(args: {
  issued: number;
  applied: number;
  refund: number;
}): { ok: true } | { ok: false; error: string } {
  const issued = round2(args.issued);
  const applied = round2(args.applied);
  const refund = round2(args.refund);
  if (applied + refund > issued + 0.005) {
    return {
      ok: false,
      error: "The same credit dollar cannot be both applied and refunded.",
    };
  }
  return { ok: true };
}
