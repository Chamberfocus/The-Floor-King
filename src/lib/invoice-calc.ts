import type { InvoiceStatus, EstimatePresentation } from "@/lib/types";

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
