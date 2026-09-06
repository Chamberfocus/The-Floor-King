/**
 * F6-P1 canonical sales tax decomposition policy.
 *
 * PRESENTATION: **Net revenue** (discount embedded in subtotal via negative invoice_items).
 *
 * Invoice issue journal (matches buildInvoiceIssueJournal / finalize_invoice_safe):
 *   Dr Accounts Receivable     = total  (subtotal + tax)
 *   Cr Sales Revenue           = subtotal  (includes discount lines)
 *   Cr Sales Tax Payable       = tax       (when tax > 0)
 *
 * Discount is NOT double-counted: negative invoice_items reduce subtotal before tax.
 * We do NOT use gross revenue + separate sales_discounts debit on invoice issue.
 * sales_discounts is reserved for credit-memo tax decomposition fallback paths.
 */
import { invoiceTotals, type CalcInvoiceItem } from "@/lib/invoice-calc";
import { buildInvoiceIssueJournal } from "@/lib/accounting/builders";
import { assessJournalBalance } from "@/lib/accounting/journal";
import type { AccountMappingDict } from "@/lib/accounting/types";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface InvoiceTaxDecomposition {
  grossLineTotal: number;
  discountAmount: number;
  netTaxableSubtotal: number;
  tax: number;
  total: number;
  taxRatePct: number;
}

/** Decompose invoice lines into revenue/tax components for reporting. */
export function decomposeInvoiceTax(args: {
  items: CalcInvoiceItem[];
  taxRatePct: number | string;
}): InvoiceTaxDecomposition {
  const grossLineTotal = round2(
    args.items.reduce((s, i) => {
      const qty = Number(i.quantity) || 0;
      const rate = Number(i.rate) || 0;
      return rate >= 0 ? s + qty * rate : s;
    }, 0),
  );
  const discountAmount = round2(
    Math.abs(
      args.items.reduce((s, i) => {
        const qty = Number(i.quantity) || 0;
        const rate = Number(i.rate) || 0;
        return rate < 0 ? s + qty * rate : s;
      }, 0),
    ),
  );
  const t = invoiceTotals(args.items, args.taxRatePct, 0);
  return {
    grossLineTotal,
    discountAmount,
    netTaxableSubtotal: round2(t.subtotal),
    tax: round2(t.tax),
    total: round2(t.total),
    taxRatePct: Number(args.taxRatePct) || 0,
  };
}

/** Prove invoice total = net taxable subtotal + tax and journal balances. */
export function validateInvoiceTaxJournalParity(args: {
  invoiceId: string;
  entryDate: string;
  items: CalcInvoiceItem[];
  taxRatePct: number | string;
  mappings: AccountMappingDict;
}): {
  decomposition: InvoiceTaxDecomposition;
  journalBalanced: boolean;
  totalParity: boolean;
} {
  const decomposition = decomposeInvoiceTax({
    items: args.items,
    taxRatePct: args.taxRatePct,
  });
  const entry = buildInvoiceIssueJournal({
    invoiceId: args.invoiceId,
    entryDate: args.entryDate,
    items: args.items,
    taxRate: args.taxRatePct,
    mappings: args.mappings,
  });
  const gate = assessJournalBalance(entry.lines);
  const totalParity =
    Math.abs(decomposition.total - (decomposition.netTaxableSubtotal + decomposition.tax)) <=
    0.005;
  return {
    decomposition,
    journalBalanced: gate.ok,
    totalParity,
  };
}
