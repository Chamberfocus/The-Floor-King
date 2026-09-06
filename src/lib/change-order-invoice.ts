/**
 * Change-order invoice safety — pure planning helpers (Phase 1).
 *
 * Commercial billing uses immutable approval snapshot totals (tax-inclusive)
 * and persisted invoice totals. Never live estimate lines or job_line_items.
 */
import { invoiceTotals } from "@/lib/invoice-calc";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type InvoiceCommercialKind =
  | "original"
  | "replacement"
  | "supplemental";

export const INVOICE_PAID_IMMUTABLE_MESSAGE =
  "This invoice has payments on file, so its commercial lines and totals can’t be changed. Create a supplemental invoice for an approved increase, or handle credits/refunds separately.";

export const INVOICE_CREDIT_REQUIRED_MESSAGE =
  "Approved contract decreased below the amount already invoiced. A credit or refund adjustment is required.";

export const INVOICE_LEGACY_REVIEW_MESSAGE =
  "An existing invoice for this estimate predates approval-version tracking. Review it manually before creating another invoice.";

export const INVOICE_NO_ADDITIONAL_NEEDED_MESSAGE =
  "Approved commercial charges are already fully invoiced. No additional invoice is needed.";

export interface CoverageInvoiceRow {
  id: string;
  status: string;
  /** null = legacy / non-estimate-derived / unlinked */
  approvalSnapshotId: string | null;
  /** Tax-inclusive invoice total (qty×rate + tax). */
  total: number;
  /** True when any payment row exists. */
  hasPayments: boolean;
}

export type EstimateInvoicePlan =
  | {
      action: "full";
      kind: "original";
      amount: number;
    }
  | {
      action: "void_reissue";
      kind: "replacement";
      voidIds: string[];
      amount: number;
    }
  | {
      action: "supplemental";
      kind: "supplemental";
      amount: number;
    }
  | {
      action: "none";
      message: string;
    }
  | {
      /** Paid/partial commercial decrease — issue tax-inclusive credit memo. */
      action: "issue_credit";
      amount: number;
      approvedTotal: number;
      invoicedTotal: number;
      netInvoiced: number;
      message: string;
    }
  | {
      /** @deprecated Prefer issue_credit — kept for typed error messaging only. */
      action: "credit_required";
      message: string;
      approvedTotal: number;
      invoicedTotal: number;
      creditNeeded: number;
    }
  | {
      action: "legacy_review";
      message: string;
    };

/** Void invoices never count toward active billed coverage. */
export function isActiveCommercialInvoice(status: string): boolean {
  return status !== "void";
}

/** Sum of tax-inclusive totals on active (non-void) invoices. */
export function activeInvoicedTotal(rows: CoverageInvoiceRow[]): number {
  return round2(
    rows
      .filter((r) => isActiveCommercialInvoice(r.status))
      .reduce((s, r) => s + (Number(r.total) || 0), 0),
  );
}

/**
 * Net commercial billed after issued (non-void) commercial credits.
 * Historical invoice rows stay; credits reduce net coverage.
 */
export function netCommercialInvoiced(
  invoicedTotal: number,
  commercialCreditsTotal: number,
): number {
  return round2(
    Math.max(0, Number(invoicedTotal) || 0) -
      Math.max(0, Number(commercialCreditsTotal) || 0),
  );
}

/**
 * Plan how to bill the latest approved commercial total for an estimate.
 *
 * `approvedTotal` = current approval snapshot payload.total (tax-inclusive).
 * `commercialCreditsTotal` = sum of issued non-void commercial credit memos
 * for this estimate (tax-inclusive, same spirit as supplemental deltas).
 */
export function planEstimateInvoiceCreation(args: {
  approvedTotal: number;
  existing: CoverageInvoiceRow[];
  commercialCreditsTotal?: number;
}): EstimateInvoicePlan {
  const approved = round2(Math.max(0, args.approvedTotal));
  const active = args.existing.filter((r) =>
    isActiveCommercialInvoice(r.status),
  );

  // Legacy / unlinked active invoices → no automatic stacking.
  if (active.some((r) => !r.approvalSnapshotId)) {
    return {
      action: "legacy_review",
      message: INVOICE_LEGACY_REVIEW_MESSAGE,
    };
  }

  const invoiced = activeInvoicedTotal(active);
  const credits = round2(Math.max(0, args.commercialCreditsTotal ?? 0));
  const netInvoiced = netCommercialInvoiced(invoiced, credits);
  const delta = round2(approved - netInvoiced);

  if (active.length === 0) {
    return { action: "full", kind: "original", amount: approved };
  }

  const anyPaid = active.some((r) => r.hasPayments);

  // Unpaid-only: void & reissue from latest approved snapshot.
  // Credits should be zero in normal unpaid path; ignore for replace.
  if (!anyPaid) {
    if (Math.abs(round2(approved - invoiced)) < 0.005) {
      return {
        action: "none",
        message: INVOICE_NO_ADDITIONAL_NEEDED_MESSAGE,
      };
    }
    return {
      action: "void_reissue",
      kind: "replacement",
      voidIds: active.map((r) => r.id),
      amount: approved,
    };
  }

  // Any payment exists: never void/rewrite paid invoices.
  if (delta > 0.005) {
    return {
      action: "supplemental",
      kind: "supplemental",
      amount: delta,
    };
  }
  if (delta < -0.005) {
    return {
      action: "issue_credit",
      amount: round2(-delta),
      approvedTotal: approved,
      invoicedTotal: invoiced,
      netInvoiced,
      message: INVOICE_CREDIT_REQUIRED_MESSAGE,
    };
  }
  return {
    action: "none",
    message: INVOICE_NO_ADDITIONAL_NEEDED_MESSAGE,
  };
}

/** Tax-inclusive total for one invoice from its items + tax rate. */
export function invoiceCoverageTotal(
  items: { quantity?: number | string | null; rate?: number | string | null }[],
  taxRate: number | string | null | undefined,
): number {
  return round2(invoiceTotals(items, taxRate ?? 0, 0).total);
}

/**
 * Build a single flat supplemental line so invoice total (with tax_rate 0)
 * equals the approved tax-inclusive delta.
 */
export function supplementalDeltaInvoiceItems(
  invoiceId: string,
  deltaTotal: number,
  label: string,
): {
  invoice_id: string;
  position: number;
  description: string;
  quantity: number;
  unit: string;
  rate: number;
}[] {
  const amount = round2(deltaTotal);
  if (amount <= 0) return [];
  return [
    {
      invoice_id: invoiceId,
      position: 0,
      description: label,
      quantity: 1,
      unit: "ea",
      rate: amount,
    },
  ];
}

/** Server-side: block commercial line/total rewrites when payments exist. */
export function invoiceCommercialEditBlocked(hasPayments: boolean): {
  blocked: boolean;
  message: string | null;
} {
  if (!hasPayments) return { blocked: false, message: null };
  return { blocked: true, message: INVOICE_PAID_IMMUTABLE_MESSAGE };
}
