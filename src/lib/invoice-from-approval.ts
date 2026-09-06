/**
 * Build invoice item rows from an approval snapshot (Step 6 commercial SoT).
 * Never reads live estimate_line_items or job_line_items.
 */
import { lineQty, discountAmount, type CalcLine } from "@/lib/estimate-calc";
import { snapshotLinesAsEstimateLines } from "@/lib/approval-snapshot-view";
import type { ApprovalSnapshotPayload, ApprovalSnapshotLine } from "@/lib/estimate-approval";
import type { EstimateLineItem } from "@/lib/types";

function unitLabelFor(l: EstimateLineItem): string {
  const u = (l.unit ?? "").trim();
  if (u) return u;
  return l.measure_unit === "sqyd" ? "sqyd" : "sqft";
}

/** One invoice item from an approved snapshot line (uses frozen line_total). */
export function invoiceItemFromSnapshotLine(
  invoiceId: string,
  snapLine: ApprovalSnapshotLine,
  estLine: EstimateLineItem,
  position: number,
): {
  invoice_id: string;
  position: number;
  description: string;
  quantity: number;
  unit: string;
  rate: number;
} {
  const description = estLine.room
    ? `${estLine.room} — ${estLine.description}`
    : estLine.description;
  if (estLine.line_type === "flat") {
    return {
      invoice_id: invoiceId,
      position,
      description,
      quantity: 1,
      unit: "ea",
      rate: Number(snapLine.line_total) || Number(estLine.flat_amount) || 0,
    };
  }
  const fullTotal = Number(snapLine.line_total) || 0;
  const shownQty = Math.round(lineQty(estLine as CalcLine) * 100) / 100;
  const adjRate = shownQty > 0 ? fullTotal / shownQty : 0;
  return {
    invoice_id: invoiceId,
    position,
    description,
    quantity: shownQty,
    unit: unitLabelFor(estLine),
    rate: adjRate,
  };
}

export interface SnapshotInvoiceBuild {
  customerId: string;
  optionId: string | null;
  taxRate: number;
  items: ReturnType<typeof invoiceItemFromSnapshotLine>[];
}

/**
 * Build invoice items from the approval snapshot.
 * If selectedLineIds is provided/non-empty, only those snapshot lines are billed
 * (IDs match estimate line ids frozen at approval). Discount follows snapshot rules.
 */
export function buildInvoiceItemsFromApprovalSnapshot(args: {
  invoiceId: string;
  payload: ApprovalSnapshotPayload;
  selectedLineIds?: string[] | null;
}): SnapshotInvoiceBuild {
  const { invoiceId, payload } = args;
  const estLines = snapshotLinesAsEstimateLines(payload);
  const byId = new Map(payload.option.lines.map((l) => [l.id, l]));
  const selected = args.selectedLineIds?.filter(Boolean) ?? [];
  const useAll = selected.length === 0;
  const selectedSet = new Set(selected);

  const chosenEst = estLines.filter((l) => useAll || selectedSet.has(l.id));
  const items = chosenEst.map((l, i) => {
    const snap = byId.get(l.id)!;
    return invoiceItemFromSnapshotLine(invoiceId, snap, l, i);
  });

  // Discount from approved snapshot commercial terms.
  if (payload.discount_value > 0 && chosenEst.length) {
    const selectedSub = chosenEst.reduce(
      (s, l) => s + (Number(byId.get(l.id)?.line_total) || 0),
      0,
    );
    let disc = 0;
    if (payload.discount_kind === "percent") {
      disc = discountAmount(selectedSub, "percent", payload.discount_value);
    } else if (useAll) {
      disc = Math.min(payload.discount_amount, selectedSub);
    } else {
      const fullSub = payload.option.lines.reduce(
        (s, l) => s + (Number(l.line_total) || 0),
        0,
      );
      const share = fullSub > 0 ? Math.min(1, selectedSub / fullSub) : 0;
      disc = Math.min(payload.discount_value * share, selectedSub);
    }
    if (disc > 0) {
      items.push({
        invoice_id: invoiceId,
        position: items.length,
        description: "Discount",
        quantity: 1,
        unit: "ea",
        rate: -Math.round(disc * 100) / 100,
      });
    }
  }

  return {
    customerId: payload.customer_id,
    optionId: payload.accepted_option_id ?? payload.option.id,
    taxRate: Number(payload.tax_rate) || 0,
    items,
  };
}
