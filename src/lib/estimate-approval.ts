/**
 * Step 6 — approval snapshots, commercial material-change detection,
 * accepted-option protection helpers.
 *
 * APPROVED SNAPSHOT = immutable what the customer accepted
 * LIVE ESTIMATE = editable commercial working record
 * JOB = operational (never auto-pushed from estimate saves)
 */
import {
  lineTotal,
  optionTotalsWithDiscount,
  type CalcLine,
} from "@/lib/estimate-calc";
import type {
  Estimate,
  EstimateLineItem,
  EstimateOption,
  EstimatePresentation,
} from "@/lib/types";

export const ACCEPTED_OPTION_PROTECTED_MESSAGE =
  "That option was accepted by the customer or is linked to a job, so it can’t be removed. Keep it and add another option if you need a different package.";

export const REAPPROVAL_REQUIRED_MESSAGE =
  "Commercial changes were saved. The previous customer approval is unchanged — send this revised estimate for reapproval. The job, POs, and invoices were not updated.";

export type ApprovalSource = "staff" | "portal";

/** One immutable approval version payload (stored as jsonb). */
export interface ApprovalSnapshotPayload {
  schema_version: 1;
  estimate_id: string;
  customer_id: string;
  title: string | null;
  presentation: EstimatePresentation;
  show_project_details: boolean;
  job_description: string | null;
  notes: string | null;
  accepted_option_id: string | null;
  option: {
    id: string;
    name: string;
    notes: string | null;
    lines: ApprovalSnapshotLine[];
  };
  tax_rate: number;
  discount_kind: "amount" | "percent";
  discount_value: number;
  discount_amount: number;
  subtotal: number;
  tax_amount: number;
  total: number;
}

export interface ApprovalSnapshotLine {
  id: string;
  position: number;
  room: string | null;
  description: string;
  note: string | null;
  line_type: string;
  category: string | null;
  sqft: number | null;
  length_in: number | null;
  width_in: number | null;
  measure_unit: string | null;
  material_rate: number | null;
  labor_rate: number | null;
  installed_rate: number | null;
  flat_amount: number | null;
  waste_pct: number | null;
  product_id: string | null;
  manufacturer: string | null;
  style: string | null;
  color: string | null;
  item_no: string | null;
  quantity: number | null;
  unit: string | null;
  measurements: unknown;
  /** Customer-facing line sell total at approval (canonical lineTotal). */
  line_total: number;
}

export interface EstimateApprovalSnapshot {
  id: string;
  estimate_id: string;
  version: number;
  accepted_option_id: string | null;
  approved_at: string;
  approval_source: ApprovalSource;
  approved_by_user_id: string | null;
  approved_by_customer_id: string | null;
  payload: ApprovalSnapshotPayload;
  created_at: string;
}

/** Commercial fields that affect what the customer owes / accepted scope. */
export function commercialLineFingerprint(line: {
  id?: string | null;
  product_id?: string | null;
  line_type?: string | null;
  category?: string | null;
  sqft?: number | string | null;
  quantity?: number | string | null;
  waste_pct?: number | string | null;
  measure_unit?: string | null;
  material_rate?: number | string | null;
  labor_rate?: number | string | null;
  installed_rate?: number | string | null;
  flat_amount?: number | string | null;
  length_in?: number | string | null;
  width_in?: number | string | null;
  measurements?: unknown;
  from_stock?: boolean | null;
  is_optional?: boolean | null;
  /** When no product_id, description identifies sold material. */
  description?: string | null;
}): string {
  const n = (v: unknown) => {
    if (v == null || v === "") return null;
    const x = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null;
  };
  const body = {
    product_id: line.product_id || null,
    // Description is commercial identity when there is no catalog product.
    description: line.product_id ? null : (line.description || "").trim(),
    line_type: line.line_type || null,
    category: line.category || null,
    sqft: n(line.sqft),
    quantity: n(line.quantity),
    waste_pct: n(line.waste_pct) ?? 0,
    measure_unit: line.measure_unit || "sqft",
    material_rate: n(line.material_rate),
    labor_rate: n(line.labor_rate),
    installed_rate: n(line.installed_rate),
    flat_amount: n(line.flat_amount),
    length_in: n(line.length_in),
    width_in: n(line.width_in),
    measurements: line.measurements ?? null,
    from_stock: !!line.from_stock,
    is_optional: !!line.is_optional,
  };
  return JSON.stringify(body);
}

export function commercialHeaderFingerprint(header: {
  tax_rate?: number | string | null;
  discount_kind?: string | null;
  discount_value?: number | string | null;
  accepted_option_id?: string | null;
}): string {
  const n = (v: unknown) => {
    if (v == null || v === "") return 0;
    const x = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isFinite(x) ? Math.round(x * 10000) / 10000 : 0;
  };
  return JSON.stringify({
    tax_rate: n(header.tax_rate),
    discount_kind: header.discount_kind === "percent" ? "percent" : "amount",
    discount_value: n(header.discount_value),
    accepted_option_id: header.accepted_option_id || null,
  });
}

export function commercialOptionFingerprint(
  lines: Parameters<typeof commercialLineFingerprint>[0][],
): string {
  // Stable order by position index as given (caller sorts).
  return JSON.stringify(lines.map((l) => commercialLineFingerprint(l)));
}

/**
 * True when the live commercial obligation differs from the approved snapshot
 * (or from the prior live state when no snapshot exists — caller compares before/after).
 */
export function isMaterialCommercialChange(args: {
  beforeHeader: Parameters<typeof commercialHeaderFingerprint>[0];
  afterHeader: Parameters<typeof commercialHeaderFingerprint>[0];
  beforeLines: Parameters<typeof commercialLineFingerprint>[0][];
  afterLines: Parameters<typeof commercialLineFingerprint>[0][];
}): boolean {
  if (
    commercialHeaderFingerprint(args.beforeHeader) !==
    commercialHeaderFingerprint(args.afterHeader)
  ) {
    return true;
  }
  return (
    commercialOptionFingerprint(args.beforeLines) !==
    commercialOptionFingerprint(args.afterLines)
  );
}

/** Compare live accepted-option commercial state to a snapshot payload. */
export function liveDiffersFromSnapshot(
  snapshot: ApprovalSnapshotPayload,
  live: {
    tax_rate: number | string | null;
    discount_kind: string | null;
    discount_value: number | string | null;
    accepted_option_id: string | null;
    lines: Parameters<typeof commercialLineFingerprint>[0][];
  },
): boolean {
  return isMaterialCommercialChange({
    beforeHeader: {
      tax_rate: snapshot.tax_rate,
      discount_kind: snapshot.discount_kind,
      discount_value: snapshot.discount_value,
      accepted_option_id: snapshot.accepted_option_id,
    },
    afterHeader: {
      tax_rate: live.tax_rate,
      discount_kind: live.discount_kind,
      discount_value: live.discount_value,
      accepted_option_id: live.accepted_option_id,
    },
    beforeLines: snapshot.option.lines,
    afterLines: live.lines,
  });
}

export function buildApprovalSnapshotPayload(args: {
  estimate: Pick<
    Estimate,
    | "id"
    | "customer_id"
    | "title"
    | "presentation"
    | "show_project_details"
    | "job_description"
    | "notes"
    | "tax_rate"
    | "discount_kind"
    | "discount_value"
  >;
  option: EstimateOption;
  lines: EstimateLineItem[];
}): ApprovalSnapshotPayload {
  const { estimate, option, lines } = args;
  const sorted = [...lines].sort((a, b) => a.position - b.position);
  const totals = optionTotalsWithDiscount(
    sorted as CalcLine[],
    estimate.tax_rate,
    estimate.discount_kind,
    estimate.discount_value,
  );
  return {
    schema_version: 1,
    estimate_id: estimate.id,
    customer_id: estimate.customer_id,
    title: estimate.title,
    presentation: estimate.presentation ?? "detailed",
    show_project_details: estimate.show_project_details !== false,
    job_description: estimate.job_description,
    notes: estimate.notes,
    accepted_option_id: option.id,
    option: {
      id: option.id,
      name: option.name,
      notes: option.notes,
      lines: sorted.map((l) => ({
        id: l.id,
        position: l.position,
        room: l.room,
        description: l.description,
        note: l.note,
        line_type: l.line_type,
        category: l.category,
        sqft: l.sqft,
        length_in: l.length_in,
        width_in: l.width_in,
        measure_unit: l.measure_unit,
        material_rate: l.material_rate,
        labor_rate: l.labor_rate,
        installed_rate: l.installed_rate,
        flat_amount: l.flat_amount,
        waste_pct: l.waste_pct,
        product_id: l.product_id,
        manufacturer: l.manufacturer,
        style: l.style,
        color: l.color,
        item_no: l.item_no,
        quantity: l.quantity,
        unit: l.unit,
        measurements: l.measurements ?? null,
        line_total: lineTotal(l as CalcLine),
      })),
    },
    tax_rate: Number(estimate.tax_rate) || 0,
    discount_kind: estimate.discount_kind === "percent" ? "percent" : "amount",
    discount_value: Number(estimate.discount_value) || 0,
    discount_amount: totals.discount,
    subtotal: totals.subtotal,
    tax_amount: totals.tax,
    total: totals.total,
  };
}

/** Options that must not be deleted while approved or job-linked. */
export function protectedOptionIds(args: {
  status: string;
  acceptedOptionId: string | null | undefined;
  jobOptionIds: readonly string[];
}): Set<string> {
  const set = new Set<string>();
  if (args.acceptedOptionId) {
    // Always protect the accepted option if set (even when pending reapproval).
    set.add(args.acceptedOptionId);
  }
  for (const id of args.jobOptionIds) {
    if (id) set.add(id);
  }
  // Extra: while currently approved, accepted is already included.
  void args.status;
  return set;
}

export function optionRemovalBlocked(
  removedIds: readonly string[],
  protectedIds: ReadonlySet<string>,
): boolean {
  return removedIds.some((id) => protectedIds.has(id));
}

/** Legacy approved row with no snapshot — do not invent history. */
export function legacyApprovalSnapshotUnavailable(
  status: string,
  hasSnapshot: boolean,
): boolean {
  return status === "approved" && !hasSnapshot;
}

export const INVOICE_REQUIRES_REAPPROVAL_MESSAGE =
  "This estimate has changes that have not been approved yet. Reapprove the estimate before creating an invoice.";

export const INVOICE_REQUIRES_APPROVAL_SNAPSHOT_MESSAGE =
  "This estimate does not have an approval snapshot on file. Review and reapprove it before creating an invoice.";

export const INVOICE_REQUIRES_APPROVED_STATUS_MESSAGE =
  "This estimate is not approved. Approve it before creating an invoice.";

export type InvoiceCommercialGate =
  | { ok: true }
  | { ok: false; reason: "stale" | "no_snapshot" | "not_approved"; message: string };

/**
 * Whether a new invoice may be created from an estimate's commercial agreement.
 * Requires approved status, not stale, and a valid current approval snapshot.
 * Never invents legacy approval history.
 */
export function assessInvoiceCommercialGate(args: {
  status: string | null | undefined;
  approvalStale: boolean | null | undefined;
  hasSnapshot: boolean;
}): InvoiceCommercialGate {
  const status = (args.status ?? "").toLowerCase();
  if (args.approvalStale) {
    return {
      ok: false,
      reason: "stale",
      message: INVOICE_REQUIRES_REAPPROVAL_MESSAGE,
    };
  }
  if (status !== "approved") {
    return {
      ok: false,
      reason: "not_approved",
      message: INVOICE_REQUIRES_APPROVED_STATUS_MESSAGE,
    };
  }
  if (!args.hasSnapshot) {
    return {
      ok: false,
      reason: "no_snapshot",
      message: INVOICE_REQUIRES_APPROVAL_SNAPSHOT_MESSAGE,
    };
  }
  return { ok: true };
}

/** True only when an approval operation produced an immutable snapshot id. */
export function approvalCompletedSuccessfully(result: {
  snapshotId: string | null;
  error: string | null;
}): boolean {
  return !!result.snapshotId && !result.error;
}

/** Portal JWT may PATCH only these estimate columns (0179 trigger). */
export const PORTAL_ESTIMATE_MUTABLE_FIELDS = [
  "status",
  "customer_response_note",
  "updated_at",
] as const;

/**
 * Transaction-local GUC set only inside record_estimate_approval_safe immediately
 * before its internal estimates UPDATE. Never grant a setter to authenticated.
 */
export const PORTAL_APPROVAL_MUTATION_GUC =
  "app.allow_portal_approval_mutation";

export function portalMayMutateEstimateField(field: string): boolean {
  return (PORTAL_ESTIMATE_MUTABLE_FIELDS as readonly string[]).includes(field);
}

/**
 * Direct portal JWT status allowlist (must match 0179 trigger).
 * Approval (status=approved) is not a direct UPDATE — RPC only.
 */
export function portalEstimateStatusChangeAllowed(
  from: string,
  to: string,
): boolean {
  if (from === to) return true;
  if (from === "sent" && (to === "declined" || to === "changes_requested")) {
    return true;
  }
  if (from === "changes_requested" && to === "declined") return true;
  return false;
}

export type PortalDirectUpdateEval = {
  jwtIsServiceRole: boolean;
  actorRole: string;
  trustedApprovalMutation: boolean;
  old: Record<string, unknown>;
  next: Record<string, unknown>;
};

/**
 * Behavioral mirror of estimates_protect_portal_columns (0179).
 * Used so tests prove allow/deny without regex-only SQL matching.
 */
export function evaluatePortalDirectEstimateUpdate(
  args: PortalDirectUpdateEval,
): { ok: true } | { ok: false; code: string } {
  if (args.jwtIsServiceRole) return { ok: true };
  if (args.trustedApprovalMutation) return { ok: true };
  if (args.actorRole !== "customer") return { ok: true };

  if (args.next.customer_id !== args.old.customer_id) {
    return { ok: false, code: "PORTAL_ESTIMATE_FORBIDDEN" };
  }

  const oldStatus = String(args.old.status ?? "");
  const newStatus = String(args.next.status ?? "");
  if (oldStatus !== newStatus) {
    if (!portalEstimateStatusChangeAllowed(oldStatus, newStatus)) {
      return { ok: false, code: "PORTAL_ESTIMATE_FORBIDDEN" };
    }
  }

  const skip = new Set<string>(PORTAL_ESTIMATE_MUTABLE_FIELDS);
  const keys = new Set([
    ...Object.keys(args.old),
    ...Object.keys(args.next),
  ]);
  for (const k of keys) {
    if (skip.has(k)) continue;
    if (args.old[k] !== args.next[k]) {
      return { ok: false, code: "PORTAL_ESTIMATE_FORBIDDEN" };
    }
  }
  return { ok: true };
}
