import type { InvoiceStatus, EstimatePresentation } from "@/lib/types";
import { effectiveInvoiceBalance } from "@/lib/credit-ar";

function n(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const x = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(x) ? x : 0;
}

export interface CalcInvoiceItem {
  quantity?: number | string | null;
  rate?: number | string | null;
}

export function itemAmount(item: CalcInvoiceItem): number {
  return n(item.quantity) * n(item.rate);
}

export interface InvoiceTotals {
  subtotal: number;
  tax: number;
  total: number;
  paid: number;
  balance: number;
}

export function invoiceTotals(
  items: CalcInvoiceItem[],
  taxRatePct: number | string,
  amountPaid: number | string = 0,
): InvoiceTotals {
  const subtotal = items.reduce((s, i) => s + itemAmount(i), 0);
  const tax = subtotal * (n(taxRatePct) / 100);
  const total = subtotal + tax;
  const paid = n(amountPaid);
  return { subtotal, tax, total, paid, balance: total - paid };
}

/** Minimal invoice shape for job-level open AR (no DB). */
export interface JobBalanceInvoiceInput {
  id: string;
  status: string;
  tax_rate: number | string;
  items?: CalcInvoiceItem[] | null;
  /** Sum of *active* payments already applied, or payment rows with amount. */
  amountPaid?: number | string;
  payments?: { amount: number | string; status?: string | null }[] | null;
  /** Sum of *active* credit applications, or application rows. */
  appliedCredits?: number | string;
  creditApplications?: { amount: number | string; status?: string | null }[] | null;
  appliedDeposits?: number | string;
  appliedWriteOffs?: number | string;
}

export interface JobOpenBalanceResult {
  hasInvoice: boolean;
  invoiceId: string | null;
  balance: number;
  openInvoices: { invoiceId: string; balance: number }[];
}

function paidOnInvoice(inv: JobBalanceInvoiceInput): number {
  if (inv.amountPaid !== undefined && inv.amountPaid !== null && inv.amountPaid !== "") {
    return n(inv.amountPaid);
  }
  return (inv.payments ?? [])
    .filter((p) => (p.status ?? "active") !== "void")
    .reduce((s, p) => s + n(p.amount), 0);
}

function creditedOnInvoice(inv: JobBalanceInvoiceInput): number {
  if (
    inv.appliedCredits !== undefined &&
    inv.appliedCredits !== null &&
    inv.appliedCredits !== ""
  ) {
    return n(inv.appliedCredits);
  }
  return (inv.creditApplications ?? [])
    .filter((a) => (a.status ?? "active") !== "void")
    .reduce((s, a) => s + n(a.amount), 0);
}

function depositedOnInvoice(inv: JobBalanceInvoiceInput): number {
  return n(inv.appliedDeposits);
}

function writtenOffOnInvoice(inv: JobBalanceInvoiceInput): number {
  return n(inv.appliedWriteOffs);
}

/**
 * Sum remaining *effective* balances across all active job invoices.
 * Void → 0. Uses effectiveInvoiceBalance.amountDue (payments + credits +
 * applied deposits + write-offs). Unapplied deposits are not netted here.
 */
export function computeJobOpenBalance(
  invoices: JobBalanceInvoiceInput[],
): JobOpenBalanceResult {
  if (!invoices.length) {
    return { hasInvoice: false, invoiceId: null, balance: 0, openInvoices: [] };
  }
  const openInvoices: { invoiceId: string; balance: number }[] = [];
  for (const inv of invoices) {
    if (inv.status === "void") continue;
    const paid = paidOnInvoice(inv);
    const credited = creditedOnInvoice(inv);
    const bal =
      Math.round(
        effectiveInvoiceBalance({
          items: inv.items ?? [],
          taxRate: inv.tax_rate,
          amountPaid: paid,
          appliedCredits: credited,
          appliedDeposits: depositedOnInvoice(inv),
          appliedWriteOffs: writtenOffOnInvoice(inv),
        }).amountDue * 100,
      ) / 100;
    if (bal > 0.005) {
      openInvoices.push({ invoiceId: inv.id, balance: bal });
    }
  }
  const balance =
    Math.round(openInvoices.reduce((s, r) => s + r.balance, 0) * 100) / 100;
  return {
    hasInvoice: true,
    invoiceId: openInvoices[0]?.invoiceId ?? null,
    balance,
    openInvoices,
  };
}

export interface SaveInvoiceItemInput {
  description: string;
  quantity: string | number | null;
  unit: string;
  rate: string | number | null;
}

export interface SaveInvoiceInput {
  number: string;
  status: InvoiceStatus;
  presentation: EstimatePresentation;
  issue_date: string | null;
  due_date: string | null;
  tax_rate: string | number;
  notes: string;
  terms: string;
  items: SaveInvoiceItemInput[];
}
