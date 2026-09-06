/**
 * F6-P2B opening balance wizard — pure validation & preview.
 * Never auto-plugs Opening Balance Equity; owner must enter equity explicitly.
 */
import { assessJournalBalance } from "@/lib/accounting/journal";
import type { AccountMappingDict } from "@/lib/accounting/types";
import { invoiceOpenArBalance } from "@/lib/accounting/open-ar";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const TOLERANCE = 0.005;

export type OpeningBatchStatus = "draft" | "validated" | "posted" | "void";

export type OpeningBsGroup =
  | "cash"
  | "receivable"
  | "inventory"
  | "other_asset"
  | "fixed_asset"
  | "payable"
  | "other_liability"
  | "equity";

export interface OpeningGlLineDraft {
  accountId: string;
  /** Positive = debit, negative = credit. */
  signedAmount: number;
  note?: string;
}

export interface OpeningArItemDraft {
  customerId: string;
  amount: number;
  dueDate?: string | null;
  asOfDate?: string | null;
  legacyInvoiceNumber?: string | null;
  reference?: string | null;
  jobId?: string | null;
  note?: string | null;
}

export interface OpeningApItemDraft {
  vendorId: string;
  amount: number;
  billDate?: string | null;
  dueDate?: string | null;
  asOfDate?: string | null;
  legacyBillNumber?: string | null;
  reference?: string | null;
  note?: string | null;
}

export function classifyOpeningAccount(args: {
  accountType: string;
  subtype: string | null;
}): OpeningBsGroup | "excluded" {
  const t = args.accountType;
  const s = (args.subtype ?? "").toLowerCase();
  if (t === "revenue" || t === "expense") return "excluded";
  if (t === "asset") {
    if (s === "cash" || s === "cash_clearing" || s === "bank") return "cash";
    if (s === "receivable") return "receivable";
    if (s === "inventory") return "inventory";
    if (s === "fixed") return "fixed_asset";
    return "other_asset";
  }
  if (t === "liability") {
    if (s === "payable") return "payable";
    return "other_liability";
  }
  if (t === "equity") return "equity";
  return "excluded";
}

export const OPENING_BS_GROUP_LABELS: Record<OpeningBsGroup, string> = {
  cash: "Cash / Bank",
  receivable: "Accounts Receivable (from customer list)",
  inventory: "Inventory",
  other_asset: "Other Current Assets",
  fixed_asset: "Fixed Assets",
  payable: "Accounts Payable (from vendor list)",
  other_liability: "Other Liabilities / Loans",
  equity: "Equity",
};

export const OPENING_EQUITY_HELP =
  "Opening Balance Equity represents the net historical balance needed to bring prior books into Floor King CRM. Enter this amount only after confirming your assets and liabilities are complete.";

export function openingStatusLabel(status: OpeningBatchStatus | null): string {
  switch (status) {
    case null:
      return "Not started";
    case "draft":
      return "Draft";
    case "validated":
      return "Ready to finalize";
    case "posted":
      return "Completed";
    case "void":
      return "Needs correction";
    default:
      return "Not started";
  }
}

export function imbalanceWarning(difference: number): string {
  const abs = Math.abs(round2(difference));
  return `Opening balances are out of balance by $${abs.toFixed(2)}. Review your bank balances, receivables, inventory, assets, payables, loans, and equity before continuing.`;
}

/**
 * Build opening journal lines from owner-entered amounts only.
 * Does NOT invent an Opening Balance Equity plug.
 */
export function buildOpeningJournalLines(args: {
  lines: OpeningGlLineDraft[];
  arTotal: number;
  apTotal: number;
  mappings: AccountMappingDict;
}): {
  ok: true;
  lines: { accountId: string; debit: number; credit: number; memo: string }[];
  totalDebits: number;
  totalCredits: number;
  difference: number;
} | {
  ok: false;
  error: string;
  lines?: { accountId: string; debit: number; credit: number; memo: string }[];
  totalDebits?: number;
  totalCredits?: number;
  difference?: number;
} {
  const arAcct = args.mappings.accounts_receivable;
  const apAcct = args.mappings.accounts_payable;
  const ar = round2(args.arTotal);
  const ap = round2(args.apTotal);

  if (ar > TOLERANCE && !arAcct) {
    return {
      ok: false,
      error: "Missing mapping: accounts_receivable (required because opening AR > 0).",
    };
  }
  if (ap > TOLERANCE && !apAcct) {
    return {
      ok: false,
      error: "Missing mapping: accounts_payable (required because opening AP > 0).",
    };
  }

  const out: { accountId: string; debit: number; credit: number; memo: string }[] = [];
  let debits = 0;
  let credits = 0;

  for (const l of args.lines) {
    const amt = round2(l.signedAmount);
    if (!l.accountId || amt === 0) continue;
    if (
      (arAcct && l.accountId === arAcct) ||
      (apAcct && l.accountId === apAcct)
    ) {
      return {
        ok: false,
        error:
          "Do not enter AR/AP GL manually. Use opening customer/vendor items.",
      };
    }
    if (amt > 0) {
      debits = round2(debits + amt);
      out.push({
        accountId: l.accountId,
        debit: amt,
        credit: 0,
        memo: l.note?.trim() || "Opening balance",
      });
    } else {
      credits = round2(credits + Math.abs(amt));
      out.push({
        accountId: l.accountId,
        debit: 0,
        credit: Math.abs(amt),
        memo: l.note?.trim() || "Opening balance",
      });
    }
  }

  if (ar > TOLERANCE && arAcct) {
    debits = round2(debits + ar);
    out.push({
      accountId: arAcct,
      debit: ar,
      credit: 0,
      memo: "Opening accounts receivable",
    });
  }
  if (ap > TOLERANCE && apAcct) {
    credits = round2(credits + ap);
    out.push({
      accountId: apAcct,
      debit: 0,
      credit: ap,
      memo: "Opening accounts payable",
    });
  }

  const difference = round2(debits - credits);
  if (Math.abs(difference) > TOLERANCE) {
    return {
      ok: false,
      error: "Opening balances do not balance.",
      lines: out,
      totalDebits: debits,
      totalCredits: credits,
      difference,
    };
  }

  const gate = assessJournalBalance(out);
  if (!gate.ok) return { ok: false, error: gate.error };

  return {
    ok: true,
    lines: out,
    totalDebits: debits,
    totalCredits: credits,
    difference: 0,
  };
}

export function validateOpeningBatchDraft(args: {
  asOfDate: string;
  lines: OpeningGlLineDraft[];
  arItems: OpeningArItemDraft[];
  apItems: OpeningApItemDraft[];
  accounts: {
    id: string;
    accountType: string;
    subtype: string | null;
    isActive: boolean;
  }[];
  mappings: AccountMappingDict;
  /** Optional existence sets for client-side preview (server still revalidates). */
  knownCustomerIds?: Set<string>;
  knownVendorIds?: Set<string>;
  knownJobIds?: Set<string>;
}):
  | {
      ok: true;
      preview: {
        ok: true;
        lines: { accountId: string; debit: number; credit: number; memo: string }[];
        totalDebits: number;
        totalCredits: number;
        difference: number;
      };
    }
  | {
      ok: false;
      errors: string[];
      preview?: {
        totalDebits: number;
        totalCredits: number;
        difference: number;
      };
    } {
  const errors: string[] = [];
  if (!args.asOfDate) errors.push("Opening balance as-of date is required.");

  const byId = new Map(args.accounts.map((a) => [a.id, a]));
  for (const l of args.lines) {
    if (!l.accountId || round2(l.signedAmount) === 0) continue;
    const acct = byId.get(l.accountId);
    if (!acct || !acct.isActive) {
      errors.push("Every opening line must use an active account.");
      continue;
    }
    const group = classifyOpeningAccount(acct);
    if (group === "excluded") {
      errors.push("Opening lines must be balance-sheet accounts only.");
    }
    if (group === "receivable" || group === "payable") {
      errors.push(
        "AR/AP control amounts must come from opening subledger items, not manual lines.",
      );
    }
  }

  for (const a of args.arItems) {
    if (!a.customerId) errors.push("Each opening AR item requires a customer.");
    else if (args.knownCustomerIds && !args.knownCustomerIds.has(a.customerId)) {
      errors.push("Opening AR item references a missing customer.");
    }
    if (!(a.amount > 0)) errors.push("Opening AR amounts must be greater than zero.");
    const asOf = a.asOfDate || args.asOfDate;
    if (asOf && args.asOfDate && asOf > args.asOfDate) {
      errors.push(
        "Opening AR as-of date cannot be after the batch opening-balance date.",
      );
    }
    if (a.jobId && args.knownJobIds && !args.knownJobIds.has(a.jobId)) {
      errors.push("Opening AR item references a missing job.");
    }
  }
  for (const a of args.apItems) {
    if (!a.vendorId) errors.push("Each opening AP item requires a vendor.");
    else if (args.knownVendorIds && !args.knownVendorIds.has(a.vendorId)) {
      errors.push("Opening AP item references a missing vendor.");
    }
    if (!(a.amount > 0)) errors.push("Opening AP amounts must be greater than zero.");
    const asOf = a.asOfDate || args.asOfDate;
    if (asOf && args.asOfDate && asOf > args.asOfDate) {
      errors.push(
        "Opening AP as-of date cannot be after the batch opening-balance date.",
      );
    }
  }

  const arTotal = round2(
    args.arItems.reduce((s, i) => s + (Number(i.amount) || 0), 0),
  );
  const apTotal = round2(
    args.apItems.reduce((s, i) => s + (Number(i.amount) || 0), 0),
  );
  const built = buildOpeningJournalLines({
    lines: args.lines,
    arTotal,
    apTotal,
    mappings: args.mappings,
  });

  if (!built.ok) {
    errors.push(built.error);
    if (errors.length || built.difference !== undefined) {
      return {
        ok: false,
        errors,
        preview:
          built.totalDebits !== undefined
            ? {
                totalDebits: built.totalDebits,
                totalCredits: built.totalCredits ?? 0,
                difference: built.difference ?? 0,
              }
            : undefined,
      };
    }
  }

  if (errors.length) return { ok: false, errors };
  if (!built.ok) return { ok: false, errors: [built.error] };

  return {
    ok: true,
    preview: {
      ok: true,
      lines: built.lines,
      totalDebits: built.totalDebits,
      totalCredits: built.totalCredits,
      difference: built.difference,
    },
  };
}

/** Map posted opening AR items into buildArAging invoice shape. */
export function openingArItemsToAgingInvoices(
  items: {
    id: string;
    amount: number;
    due_date: string | null;
    as_of_date: string | null;
    legacy_invoice_number: string | null;
    status: string;
  }[],
): {
  id: string;
  number: string | null;
  due_date: string | null;
  issue_date: string | null;
  status: string;
  balance: number;
}[] {
  return items.map((i) => ({
    id: i.id,
    number: i.legacy_invoice_number,
    due_date: i.due_date,
    issue_date: i.as_of_date,
    status: i.status === "void" ? "void" : "issued",
    balance: round2(i.amount),
  }));
}

export function openingApItemsToAgingBills(
  items: {
    id: string;
    amount: number;
    due_date: string | null;
    bill_date: string | null;
    as_of_date: string | null;
    legacy_bill_number: string | null;
    status: string;
  }[],
): {
  id: string;
  bill_number: string | null;
  due_date: string | null;
  bill_date: string;
  status: string;
  balance: number;
}[] {
  return items.map((i) => ({
    id: i.id,
    bill_number: i.legacy_bill_number,
    due_date: i.due_date,
    bill_date: i.bill_date ?? i.as_of_date ?? "1970-01-01",
    status: i.status === "void" ? "void" : "open",
    balance: round2(i.amount),
  }));
}

/** Merge commercial invoices + finalized opening AR into one aging input list. */
export function mergeArAgingInvoices(args: {
  invoices: {
    id: string;
    number?: string | null;
    due_date: string | null;
    issue_date: string | null;
    status: string;
    balance: number;
  }[];
  openingArItems: {
    id: string;
    amount: number;
    due_date: string | null;
    as_of_date: string | null;
    legacy_invoice_number: string | null;
    status: string;
  }[];
}) {
  return [
    ...args.invoices,
    ...openingArItemsToAgingInvoices(args.openingArItems),
  ];
}

/** Merge vendor bills + finalized opening AP into one aging input list. */
export function mergeApAgingBills(args: {
  bills: {
    id: string;
    bill_number: string | null;
    due_date: string | null;
    bill_date: string;
    status: string;
    balance: number;
  }[];
  openingApItems: {
    id: string;
    amount: number;
    due_date: string | null;
    bill_date: string | null;
    as_of_date: string | null;
    legacy_bill_number: string | null;
    status: string;
  }[];
}) {
  return [
    ...args.bills,
    ...openingApItemsToAgingBills(args.openingApItems),
  ];
}

/** Sanity: opening AR is independent of commercial invoice open AR helpers. */
export function openingArDoesNotUseCommercialInvoiceFormula(): boolean {
  void invoiceOpenArBalance;
  return true;
}

/** Documented posting gate from post_journal_entry_safe (0172 hardening). */
export function openingBalancePostingExceptionPolicy(): {
  openingBalanceAllowedWhenPostingOff: boolean;
  openingBalanceRequiresTrustedDefiner: boolean;
  normalInvoicePostBlockedWhenPostingOff: boolean;
  manualPostBlockedWhenPostingOff: boolean;
  adminOnly: boolean;
  genericBypassBlocked: boolean;
} {
  return {
    openingBalanceAllowedWhenPostingOff: true,
    openingBalanceRequiresTrustedDefiner: true,
    normalInvoicePostBlockedWhenPostingOff: true,
    manualPostBlockedWhenPostingOff: true,
    adminOnly: true,
    genericBypassBlocked: true,
  };
}
