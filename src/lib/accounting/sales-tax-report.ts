/**
 * F6-P1 sales tax liability report (operational accrual from invoices/credits).
 * Traceable to source documents. Not tax filing automation.
 */
import { decomposeInvoiceTax } from "@/lib/accounting/tax-decomposition";
import type { CalcInvoiceItem } from "@/lib/invoice-calc";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface SalesTaxInvoiceRow {
  invoiceId: string;
  issueDate: string;
  grossTaxableSales: number;
  discounts: number;
  netTaxableSales: number;
  taxAccrued: number;
  total: number;
}

export interface SalesTaxCreditRow {
  creditMemoId: string;
  issuedAt: string;
  pretaxReduction: number;
  taxReduction: number;
  totalReduction: number;
}

export interface SalesTaxLiabilityReport {
  startDate: string;
  endDate: string;
  grossTaxableSales: number;
  discounts: number;
  netTaxableSales: number;
  taxCollected: number;
  creditTaxReduction: number;
  netTaxLiability: number;
  invoiceRows: SalesTaxInvoiceRow[];
  creditRows: SalesTaxCreditRow[];
  label: "SALES_TAX_LIABILITY_REPORT";
  note: string;
}

export function buildSalesTaxLiabilityReport(args: {
  startDate: string;
  endDate: string;
  invoices: {
    id: string;
    issue_date: string | null;
    tax_rate: number | string;
    status: string;
    items: CalcInvoiceItem[];
  }[];
  credits?: {
    id: string;
    issued_at: string | null;
    amount: number;
    pretax?: number;
    tax?: number;
  }[];
}): SalesTaxLiabilityReport {
  const invoiceRows: SalesTaxInvoiceRow[] = [];
  let grossTaxableSales = 0;
  let discounts = 0;
  let netTaxableSales = 0;
  let taxCollected = 0;

  for (const inv of args.invoices) {
    if (inv.status === "void" || !inv.issue_date) continue;
    if (inv.issue_date < args.startDate || inv.issue_date > args.endDate) continue;
    const d = decomposeInvoiceTax({
      items: inv.items,
      taxRatePct: inv.tax_rate,
    });
    invoiceRows.push({
      invoiceId: inv.id,
      issueDate: inv.issue_date,
      grossTaxableSales: d.grossLineTotal,
      discounts: d.discountAmount,
      netTaxableSales: d.netTaxableSubtotal,
      taxAccrued: d.tax,
      total: d.total,
    });
    grossTaxableSales = round2(grossTaxableSales + d.grossLineTotal);
    discounts = round2(discounts + d.discountAmount);
    netTaxableSales = round2(netTaxableSales + d.netTaxableSubtotal);
    taxCollected = round2(taxCollected + d.tax);
  }

  const creditRows: SalesTaxCreditRow[] = [];
  let creditTaxReduction = 0;
  for (const c of args.credits ?? []) {
    const issued = c.issued_at?.slice(0, 10);
    if (!issued || issued < args.startDate || issued > args.endDate) continue;
    const tax = round2(c.tax ?? 0);
    const pretax = round2(c.pretax ?? c.amount - tax);
    creditRows.push({
      creditMemoId: c.id,
      issuedAt: issued,
      pretaxReduction: pretax,
      taxReduction: tax,
      totalReduction: round2(c.amount),
    });
    creditTaxReduction = round2(creditTaxReduction + tax);
  }

  return {
    startDate: args.startDate,
    endDate: args.endDate,
    grossTaxableSales,
    discounts,
    netTaxableSales,
    taxCollected,
    creditTaxReduction,
    netTaxLiability: round2(taxCollected - creditTaxReduction),
    invoiceRows,
    creditRows,
    label: "SALES_TAX_LIABILITY_REPORT",
    note:
      "Operational accrual from invoice/credit documents. GL posting may differ while posting_enabled=false.",
  };
}
