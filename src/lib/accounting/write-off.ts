/**
 * F6-P1 AR write-off pure helpers (mirrors write_off_invoice_safe).
 */
import { effectiveInvoiceBalance } from "@/lib/credit-ar";
import type { CalcInvoiceItem } from "@/lib/invoice-calc";
import { buildInvoiceWriteOffJournal } from "@/lib/accounting/builders";
import type { AccountMappingDict } from "@/lib/accounting/types";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export const WRITE_OFF_REASON_REQUIRED =
  "Write-off reason is required.";
export const WRITE_OFF_OVER_REMAINING_MESSAGE =
  "Write-off exceeds remaining AR on this invoice.";
export const WRITE_OFF_MAPPING_MISSING_MESSAGE =
  "Write-off blocked: required accounting mappings are missing (bad_debt_expense and accounts_receivable).";

export function assessWriteOffMappingPrecheck(
  mappings: AccountMappingDict,
): { ok: true } | { ok: false; error: string; missing: string[] } {
  const missing: string[] = [];
  if (!mappings.bad_debt_expense) missing.push("bad_debt_expense");
  if (!mappings.accounts_receivable) missing.push("accounts_receivable");
  if (missing.length) {
    return {
      ok: false,
      error: WRITE_OFF_MAPPING_MISSING_MESSAGE,
      missing,
    };
  }
  return { ok: true };
}

export function invoiceArRemainingAfterWriteOffs(args: {
  items: CalcInvoiceItem[];
  taxRate: number | string;
  amountPaid: number;
  appliedCredits: number;
  appliedWriteOffs: number;
  appliedDeposits?: number;
}): number {
  return effectiveInvoiceBalance({
    items: args.items,
    taxRate: args.taxRate,
    amountPaid: args.amountPaid,
    appliedCredits: args.appliedCredits,
    appliedDeposits: args.appliedDeposits ?? 0,
    appliedWriteOffs: args.appliedWriteOffs,
  }).amountDue;
}

export function assessWriteOffAmount(args: {
  amount: number;
  remainingAr: number;
  reason: string;
}): { ok: true } | { ok: false; error: string } {
  if (!(args.amount > 0)) {
    return { ok: false, error: "Write-off amount must be greater than zero." };
  }
  if (!String(args.reason ?? "").trim()) {
    return { ok: false, error: WRITE_OFF_REASON_REQUIRED };
  }
  if (round2(args.amount) > round2(args.remainingAr) + 0.005) {
    return { ok: false, error: WRITE_OFF_OVER_REMAINING_MESSAGE };
  }
  return { ok: true };
}

export function previewWriteOffJournal(args: {
  writeOffId: string;
  invoiceId: string;
  amount: number;
  entryDate: string;
  mappings: AccountMappingDict;
  customerId?: string | null;
  jobId?: string | null;
}) {
  const gate = assessWriteOffMappingPrecheck(args.mappings);
  if (!gate.ok) throw new Error(gate.error);
  return buildInvoiceWriteOffJournal(args);
}
