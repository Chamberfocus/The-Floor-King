/**
 * F4 tax-credit decomposition foundation (pure).
 * Do not fabricate tax splits when source data is insufficient.
 */
import { TAX_CREDIT_DECOMPOSITION_NOT_READY } from "@/lib/accounting/integrity";
import type { AccountMappingDict, BuiltJournalEntry } from "@/lib/accounting/types";
import { requireMappedAccount } from "@/lib/accounting/builders";
import { assessJournalBalance } from "@/lib/accounting/journal";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface TaxableInvoiceBasis {
  /** Pre-tax commercial total on the source invoice/snapshot. */
  pretaxTotal: number;
  /** Tax amount on the source invoice. */
  taxTotal: number;
  /** Invoice tax rate percent (for proportional split). */
  taxRatePct: number;
}

/**
 * If invoice basis is known and fully taxable at a single rate,
 * decompose a tax-inclusive credit into pretax + tax.
 * Mixed/non-taxable without line detail → review_required.
 */
export function decomposeTaxInclusiveCredit(args: {
  creditAmount: number;
  basis: TaxableInvoiceBasis | null;
  knownNonTaxable?: boolean;
}):
  | {
      ok: true;
      pretax: number;
      tax: number;
      total: number;
      mode: "fully_taxable" | "non_taxable";
    }
  | {
      ok: false;
      reviewRequired: true;
      flag: typeof TAX_CREDIT_DECOMPOSITION_NOT_READY;
      reason: string;
    } {
  const total = round2(args.creditAmount);
  if (!(total > 0)) {
    return {
      ok: false,
      reviewRequired: true,
      flag: TAX_CREDIT_DECOMPOSITION_NOT_READY,
      reason: "Credit amount must be positive.",
    };
  }
  if (args.knownNonTaxable) {
    return { ok: true, pretax: total, tax: 0, total, mode: "non_taxable" };
  }
  if (!args.basis) {
    return {
      ok: false,
      reviewRequired: true,
      flag: TAX_CREDIT_DECOMPOSITION_NOT_READY,
      reason: "No reliable invoice tax basis for decomposition.",
    };
  }
  const rate = Number(args.basis.taxRatePct) || 0;
  const pretaxInvoice = round2(args.basis.pretaxTotal);
  const taxInvoice = round2(args.basis.taxTotal);
  if (rate <= 0 || taxInvoice <= 0.005) {
    return { ok: true, pretax: total, tax: 0, total, mode: "non_taxable" };
  }
  // Single-rate fully taxable: credit_incl = pretax * (1 + r/100)
  const pretax = round2(total / (1 + rate / 100));
  const tax = round2(total - pretax);
  // Sanity: proportional to invoice composition
  const expectedTaxShare =
    pretaxInvoice > 0 ? round2(taxInvoice / (pretaxInvoice + taxInvoice)) : 0;
  const actualTaxShare = total > 0 ? round2(tax / total) : 0;
  if (Math.abs(expectedTaxShare - actualTaxShare) > 0.02) {
    return {
      ok: false,
      reviewRequired: true,
      flag: TAX_CREDIT_DECOMPOSITION_NOT_READY,
      reason:
        "Credit tax share diverges from invoice composition; mixed taxable content requires review.",
    };
  }
  return { ok: true, pretax, tax, total, mode: "fully_taxable" };
}

/** Build credit-issue journal with tax split when decomposition succeeds. */
export function buildCreditMemoIssueJournalTaxAware(args: {
  creditMemoId: string;
  amount: number;
  entryDate: string;
  mappings: AccountMappingDict;
  basis: TaxableInvoiceBasis | null;
  knownNonTaxable?: boolean;
  customerId?: string | null;
  jobId?: string | null;
}):
  | { ok: true; entry: BuiltJournalEntry; decomposed: true }
  | {
      ok: false;
      reviewRequired: true;
      flag: string;
      reason: string;
      /** Conservative tax-inclusive fallback entry (Sales Discounts only). */
      fallbackEntry: BuiltJournalEntry;
    } {
  const decomp = decomposeTaxInclusiveCredit({
    creditAmount: args.amount,
    basis: args.basis,
    knownNonTaxable: args.knownNonTaxable,
  });
  const discounts = requireMappedAccount(args.mappings, "sales_discounts");
  const liability = requireMappedAccount(
    args.mappings,
    "customer_credit_liability",
  );
  const taxPayable = requireMappedAccount(args.mappings, "sales_tax_payable");

  if (!decomp.ok) {
    const fallbackEntry: BuiltJournalEntry = {
      entryDate: args.entryDate,
      description: `Credit memo ${args.creditMemoId} (tax-inclusive pending review)`,
      sourceType: "credit_memo",
      sourceId: args.creditMemoId,
      entryKind: "post",
      idempotencyKey: `credit_memo:${args.creditMemoId}:issue`,
      lines: [
        {
          accountId: discounts,
          debit: round2(args.amount),
          memo: "Tax-inclusive credit — review required",
          customerId: args.customerId,
          jobId: args.jobId,
        },
        {
          accountId: liability,
          credit: round2(args.amount),
          memo: "Customer credit liability",
          customerId: args.customerId,
          jobId: args.jobId,
        },
      ],
    };
    return {
      ok: false,
      reviewRequired: true,
      flag: decomp.flag,
      reason: decomp.reason,
      fallbackEntry,
    };
  }

  const lines =
    decomp.tax > 0.005
      ? [
          {
            accountId: discounts,
            debit: decomp.pretax,
            memo: "Credit pretax",
            customerId: args.customerId,
            jobId: args.jobId,
          },
          {
            accountId: taxPayable,
            debit: decomp.tax,
            memo: "Sales tax payable reduction",
            customerId: args.customerId,
            jobId: args.jobId,
          },
          {
            accountId: liability,
            credit: decomp.total,
            memo: "Customer credit liability",
            customerId: args.customerId,
            jobId: args.jobId,
          },
        ]
      : [
          {
            accountId: discounts,
            debit: decomp.total,
            memo: "Non-taxable credit",
            customerId: args.customerId,
            jobId: args.jobId,
          },
          {
            accountId: liability,
            credit: decomp.total,
            memo: "Customer credit liability",
            customerId: args.customerId,
            jobId: args.jobId,
          },
        ];

  const entry: BuiltJournalEntry = {
    entryDate: args.entryDate,
    description: `Credit memo ${args.creditMemoId}`,
    sourceType: "credit_memo",
    sourceId: args.creditMemoId,
    entryKind: "post",
    idempotencyKey: `credit_memo:${args.creditMemoId}:issue`,
    lines,
  };
  const gate = assessJournalBalance(entry.lines);
  if (!gate.ok) throw new Error(gate.error);
  return { ok: true, entry, decomposed: true };
}
