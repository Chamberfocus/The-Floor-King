/**
 * Canonical invoice open AR — mirrors public.invoice_open_ar_balance (0171).
 *
 * commercial total
 * − active payments
 * − active credit applications
 * − active deposit applications
 * − active write-offs
 */
import { invoiceTotals, type CalcInvoiceItem } from "@/lib/invoice-calc";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function invoiceOpenArBalance(args: {
  items: CalcInvoiceItem[];
  taxRate: number | string | null | undefined;
  activePayments?: number;
  activeCredits?: number;
  activeDeposits?: number;
  activeWriteOffs?: number;
}): number {
  const total = invoiceTotals(args.items, args.taxRate ?? 0).total;
  const reductions =
    round2(args.activePayments ?? 0) +
    round2(args.activeCredits ?? 0) +
    round2(args.activeDeposits ?? 0) +
    round2(args.activeWriteOffs ?? 0);
  return round2(Math.max(0, total - reductions));
}

export function assessOpenArConsumption(args: {
  amount: number;
  openAr: number;
}): { ok: true; remainingAfter: number } | { ok: false; error: string; remaining: number } {
  const amount = round2(args.amount);
  const openAr = round2(args.openAr);
  if (!(amount > 0)) {
    return { ok: false, error: "Amount must be greater than zero.", remaining: openAr };
  }
  if (openAr <= 0.005) {
    return {
      ok: false,
      error: "Invoice has no remaining open AR.",
      remaining: 0,
    };
  }
  if (amount > openAr + 0.005) {
    return {
      ok: false,
      error: `Amount exceeds open AR of $${Math.max(0, openAr).toFixed(2)}.`,
      remaining: Math.max(0, openAr),
    };
  }
  return { ok: true, remainingAfter: round2(openAr - amount) };
}

/** Simulate sequential AR reductions under a shared open-AR cap (concurrency model). */
export function simulateConcurrentArReductions(
  openAr: number,
  attempts: number[],
): { accepted: number[]; rejected: number[]; remaining: number } {
  let left = round2(openAr);
  const accepted: number[] = [];
  const rejected: number[] = [];
  for (const amt of attempts) {
    const gate = assessOpenArConsumption({ amount: amt, openAr: left });
    if (gate.ok) {
      accepted.push(amt);
      left = gate.remainingAfter;
    } else {
      rejected.push(amt);
    }
  }
  return { accepted, rejected, remaining: left };
}

export function resolveCrossEntityIdempotency(args: {
  key: string | null | undefined;
  existing: { id: string; parentKey: string } | null;
  requestedParentKey: string;
}):
  | { action: "proceed" }
  | { action: "duplicate"; entityId: string }
  | { action: "reject"; code: "IDEMPOTENCY_CROSS_ENTITY" } {
  if (!args.key || !args.existing) return { action: "proceed" };
  if (args.existing.parentKey === args.requestedParentKey) {
    return { action: "duplicate", entityId: args.existing.id };
  }
  return { action: "reject", code: "IDEMPOTENCY_CROSS_ENTITY" };
}
