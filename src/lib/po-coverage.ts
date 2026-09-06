/**
 * Purchasing coverage — pure helpers (Step 4).
 *
 * Once a job exists, operational need comes from job_line_items (lineOrderQty).
 * PO items linked via job_line_id contribute coverage by status:
 *   void / cancelled → 0
 *   draft            → planned
 *   ordered          → committed (never auto-edited)
 *   received/closed  → fulfilled (never auto-edited; history preserved)
 *
 * gap = max(0, need − (draft + ordered + received + closed))
 * excess on issued = max(0, (ordered + received + closed) − need)
 */
import type { PoStatus } from "@/lib/types";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Statuses that never contribute purchasing coverage (P7). */
export function isNonCoveringPoStatus(status: string | null | undefined): boolean {
  return status === "void" || status === "cancelled";
}

/** Issued / historical — never silently modify quantities (P4 / P5). */
export function isImmutablePoStatus(status: string | null | undefined): boolean {
  return (
    status === "ordered" ||
    status === "received" ||
    status === "closed"
  );
}

export function isDraftPoStatus(status: string | null | undefined): boolean {
  return status === "draft";
}

export interface CoveragePoItem {
  poItemId: string;
  poId: string;
  jobLineId: string | null;
  productId: string | null;
  /** Ordered / planned quantity on the PO line. */
  quantity: number;
  /** Qty checked in on the dock; null if never receiving-checked. */
  receivedQty: number | null;
  /** When set, the line has been receiving-checked (even if qty 0). */
  receivedAt: string | null;
  poStatus: PoStatus | string;
}

export interface LineCoverage {
  jobLineId: string;
  need: number;
  draftQty: number;
  orderedQty: number;
  receivedClosedQty: number;
  /** draft + ordered + received/closed (void excluded). */
  validCovered: number;
  /** max(0, need − validCovered) */
  gap: number;
  /** max(0, (ordered + received/closed) − need) — excess on issued/historical. */
  excessIssued: number;
  /**
   * Quantity that has physically arrived against this job line
   * (sum of received amounts on linked items; full qty if PO received and no per-line receive stamp).
   */
  arrivedQty: number;
  /** max(0, need − arrivedQty) */
  outstandingArrival: number;
  arrival: "order" | "partial" | "arrived";
}

/** How much of an item's quantity counts as purchasing coverage. */
export function coveringQuantity(item: CoveragePoItem): number {
  if (isNonCoveringPoStatus(item.poStatus)) return 0;
  return round2(Math.max(0, Number(item.quantity) || 0));
}

/**
 * Physical arrival quantity for one PO item toward a job line.
 * Compatibility: header-received with no line receive stamp → full quantity.
 */
export function arrivedQuantity(item: CoveragePoItem): number {
  if (isNonCoveringPoStatus(item.poStatus)) return 0;
  const qty = Math.max(0, Number(item.quantity) || 0);
  if (item.receivedAt != null || item.receivedQty != null) {
    return round2(Math.max(0, Number(item.receivedQty) || 0));
  }
  if (item.poStatus === "received" || item.poStatus === "closed") {
    return round2(qty);
  }
  return 0;
}

export function computeLineCoverage(
  jobLineId: string,
  need: number,
  items: CoveragePoItem[],
  /** Deterministically matched legacy PO items (null job_line_id). */
  legacyItems: CoveragePoItem[] = [],
): LineCoverage {
  const linked = items.filter((i) => i.jobLineId === jobLineId);
  const merged = [...linked, ...legacyItems];
  let draftQty = 0;
  let orderedQty = 0;
  let receivedClosedQty = 0;
  let arrivedQty = 0;

  for (const it of merged) {
    if (isNonCoveringPoStatus(it.poStatus)) continue;
    const c = coveringQuantity(it);
    if (isDraftPoStatus(it.poStatus)) draftQty = round2(draftQty + c);
    else if (it.poStatus === "ordered") orderedQty = round2(orderedQty + c);
    else if (it.poStatus === "received" || it.poStatus === "closed") {
      receivedClosedQty = round2(receivedClosedQty + c);
    }
    arrivedQty = round2(arrivedQty + arrivedQuantity(it));
  }

  const needR = round2(Math.max(0, need));
  const validCovered = round2(draftQty + orderedQty + receivedClosedQty);
  const gap = round2(Math.max(0, needR - validCovered));
  const issued = round2(orderedQty + receivedClosedQty);
  const excessIssued = round2(Math.max(0, issued - needR));
  const outstandingArrival = round2(Math.max(0, needR - arrivedQty));

  let arrival: LineCoverage["arrival"] = "order";
  if (needR <= 0) arrival = "arrived";
  else if (arrivedQty >= needR - 0.001) arrival = "arrived";
  else if (arrivedQty > 0.001) arrival = "partial";

  return {
    jobLineId,
    need: needR,
    draftQty,
    orderedQty,
    receivedClosedQty,
    validCovered,
    gap,
    excessIssued,
    arrivedQty,
    outstandingArrival,
    arrival,
  };
}

/**
 * Decide how to reconcile draft purchasing for one job material line.
 * Never proposes edits to ordered/received/closed quantities.
 *
 * - Existing draft → grow/shrink draft to (need − issued).
 * - No draft → supplementalQty = uncovered need (create new draft coverage).
 */
export function planPurchasingAdjust(cov: LineCoverage): {
  /** Target total draft qty for this job line when a draft already exists. */
  targetDraftQty: number;
  /** Qty for a new draft PO line when no draft coverage exists yet. */
  supplementalQty: number;
  /** Excess sitting on issued POs (for variance UI). */
  excessIssued: number;
  /** Whether an existing draft's quantity should change. */
  shouldAdjustDraft: boolean;
} {
  const issuedFloor = round2(cov.orderedQty + cov.receivedClosedQty);
  const desiredDraft = round2(Math.max(0, cov.need - issuedFloor));
  const currentDraft = cov.draftQty;

  if (currentDraft > 0) {
    return {
      targetDraftQty: desiredDraft,
      supplementalQty: 0,
      excessIssued: cov.excessIssued,
      shouldAdjustDraft: round2(currentDraft) !== desiredDraft,
    };
  }

  return {
    targetDraftQty: 0,
    supplementalQty: desiredDraft,
    excessIssued: cov.excessIssued,
    shouldAdjustDraft: false,
  };
}

/**
 * When only issued coverage exists and need rose: supplemental = gap.
 * When draft exists: planPurchasingAdjust handles grow/shrink.
 */
export function supplementalGapOnly(need: number, issuedCovered: number): number {
  return round2(Math.max(0, need - Math.max(0, issuedCovered)));
}

/** One operational material line considered for legacy PO matching. */
export interface LegacyMatchLine {
  id: string;
  productId: string | null;
}

/**
 * Legacy estimate-era PO items have no `job_line_id` (migration 0154, no backfill).
 *
 * Matching rules (conservative):
 * - Linked items (`job_line_id` set) are always authoritative — handled by caller.
 * - Unlinked items match a job line ONLY when `product_id` is set on both sides
 *   AND exactly one operational line on the job uses that product_id.
 * - Multiple lines sharing a product → ambiguous → reviewRequired (no auto-match).
 * - Unlinked items with no product_id → reviewRequired.
 * - Unlinked items for products not on the job scope are ignored (orphan estimate PO).
 *
 * Each unlinked PO item is allocated to at most one line. Never mutates PO rows.
 */
export function buildLegacyCoverageContext(
  jobLines: LegacyMatchLine[],
  items: CoveragePoItem[],
): {
  legacyByLine: Map<string, CoveragePoItem[]>;
  reviewRequired: boolean;
} {
  const legacyByLine = new Map<string, CoveragePoItem[]>();
  const unlinked = items.filter(
    (i) => !i.jobLineId && !isNonCoveringPoStatus(i.poStatus),
  );
  if (!unlinked.length) return { legacyByLine, reviewRequired: false };

  const byProduct = new Map<string, string[]>();
  for (const l of jobLines) {
    if (!l.productId) continue;
    const arr = byProduct.get(l.productId) ?? [];
    arr.push(l.id);
    byProduct.set(l.productId, arr);
  }

  let reviewRequired = false;
  const unlinkedByProduct = new Map<string, CoveragePoItem[]>();

  for (const it of unlinked) {
    if (!it.productId) {
      reviewRequired = true;
      continue;
    }
    const arr = unlinkedByProduct.get(it.productId) ?? [];
    arr.push(it);
    unlinkedByProduct.set(it.productId, arr);
  }

  for (const [productId, poItems] of unlinkedByProduct) {
    const lineIds = byProduct.get(productId) ?? [];
    if (lineIds.length === 1) {
      const lineId = lineIds[0]!;
      const existing = legacyByLine.get(lineId) ?? [];
      legacyByLine.set(lineId, [...existing, ...poItems]);
    } else if (lineIds.length > 1) {
      reviewRequired = true;
    }
    // lineIds.length === 0 → orphan product on legacy PO; ignore
  }

  return { legacyByLine, reviewRequired };
}

/**
 * When legacy PO review is required, do not auto-create supplemental drafts.
 */
export function planPurchasingAdjustWithReview(
  cov: LineCoverage,
  reviewRequired: boolean,
): ReturnType<typeof planPurchasingAdjust> {
  if (reviewRequired) {
    return {
      targetDraftQty: cov.draftQty,
      supplementalQty: 0,
      excessIssued: cov.excessIssued,
      shouldAdjustDraft: false,
    };
  }
  return planPurchasingAdjust(cov);
}

/** P1: estimate→PO UI must not run once a job exists for that estimate. */
export function shouldRoutePurchasingToJob(jobExistsForEstimate: boolean): boolean {
  return jobExistsForEstimate;
}
