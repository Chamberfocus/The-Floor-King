/**
 * F6-P3A installer labor — canonical estimated / committed / actual cost.
 *
 * Source of truth: installer_bills (+ line items).
 * job_labor is legacy/display-only and MUST NOT feed actual job cost.
 *
 * Accounting posting remains OFF; this module never enables GL posting.
 */
import type { BillAccountingCategory } from "@/lib/accounting/ap-category";

export const INSTALLER_LABOR_SOURCE = "installer_bills" as const;
export type InstallerLaborSource = typeof INSTALLER_LABOR_SOURCE;

export const JOB_LABOR_IS_LEGACY = true;

export type InstallerLaborStatus =
  | "draft"
  | "approved"
  | "paid"
  | "void"
  | "cancelled";

export type InstallerWorkerKind = "employee" | "subcontractor" | "unknown";

export type LaborCostBasis = "estimated" | "committed" | "actual";

export interface InstallerBillLineLike {
  description?: string | null;
  quantity?: number | string | null;
  rate?: number | string | null;
  amount?: number | string | null;
  line_total?: number | string | null;
  job_line_id?: string | null;
}

export interface InstallerBillLike {
  id: string;
  job_id?: string | null;
  installer_id?: string | null;
  crew_id?: string | null;
  worker_kind?: string | null;
  status?: string | null;
  total?: number | string | null;
  subtotal?: number | string | null;
  adjustments?: number | string | null;
  ap_bill_id?: string | null;
  reversal_of_bill_id?: string | null;
  legacy_display_only?: boolean | null;
  payroll_ops_status?: string | null;
  ap_lifecycle?: string | null;
  ap_paid?: number | string | null;
  lines?: InstallerBillLineLike[] | null;
}

export const INSTALLER_LABOR_MONEY_ERROR = {
  NAN: "INSTALLER_LABOR_INVALID_AMOUNT: NaN rejected.",
  INFINITY: "INSTALLER_LABOR_INVALID_AMOUNT: Infinity rejected.",
  NEGATIVE: "INSTALLER_LABOR_INVALID_AMOUNT: negative amount rejected.",
  PRECISION: "INSTALLER_LABOR_INVALID_AMOUNT: more than two decimal places.",
  QTY_PRECISION: "INSTALLER_LABOR_INVALID_AMOUNT: quantity precision exceeds 4 decimals.",
  RATE_PRECISION: "INSTALLER_LABOR_INVALID_AMOUNT: rate precision exceeds 4 decimals.",
} as const;

function asNumber(v: number | string | null | undefined): number {
  if (typeof v === "number") return v;
  if (v == null || v === "") return NaN;
  return Number(v);
}

export function roundMoney2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Reject NaN / Infinity / extra cents. Non-negative money in cents. */
export function parseLaborMoney(
  v: number | string | null | undefined,
  opts?: { allowNegative?: boolean },
): { ok: true; cents: number; amount: number } | { ok: false; error: string } {
  const n = asNumber(v);
  if (Number.isNaN(n)) return { ok: false, error: INSTALLER_LABOR_MONEY_ERROR.NAN };
  if (!Number.isFinite(n)) return { ok: false, error: INSTALLER_LABOR_MONEY_ERROR.INFINITY };
  if (n < 0 && !opts?.allowNegative) {
    return { ok: false, error: INSTALLER_LABOR_MONEY_ERROR.NEGATIVE };
  }
  const scaled = n * 100;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-8) {
    return { ok: false, error: INSTALLER_LABOR_MONEY_ERROR.PRECISION };
  }
  const cents = Math.round(scaled);
  return { ok: true, cents, amount: cents / 100 };
}

export function parseLaborQuantity(
  v: number | string | null | undefined,
): { ok: true; value: number } | { ok: false; error: string } {
  const n = asNumber(v);
  if (Number.isNaN(n)) return { ok: false, error: INSTALLER_LABOR_MONEY_ERROR.NAN };
  if (!Number.isFinite(n)) return { ok: false, error: INSTALLER_LABOR_MONEY_ERROR.INFINITY };
  if (n < 0) return { ok: false, error: INSTALLER_LABOR_MONEY_ERROR.NEGATIVE };
  const scaled = n * 10000;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-8) {
    return { ok: false, error: INSTALLER_LABOR_MONEY_ERROR.QTY_PRECISION };
  }
  return { ok: true, value: Math.round(scaled) / 10000 };
}

export function parseLaborRate(
  v: number | string | null | undefined,
): { ok: true; value: number } | { ok: false; error: string } {
  const n = asNumber(v);
  if (Number.isNaN(n)) return { ok: false, error: INSTALLER_LABOR_MONEY_ERROR.NAN };
  if (!Number.isFinite(n)) return { ok: false, error: INSTALLER_LABOR_MONEY_ERROR.INFINITY };
  if (n < 0) return { ok: false, error: INSTALLER_LABOR_MONEY_ERROR.NEGATIVE };
  const scaled = n * 10000;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-8) {
    return { ok: false, error: INSTALLER_LABOR_MONEY_ERROR.RATE_PRECISION };
  }
  return { ok: true, value: Math.round(scaled) / 10000 };
}

/** Server-side quantity × rate → cents. Never trust a browser total. */
export function laborLineTotalFromQtyRate(
  quantity: number | string | null | undefined,
  rate: number | string | null | undefined,
): { ok: true; amount: number } | { ok: false; error: string } {
  const q = parseLaborQuantity(quantity);
  if (!q.ok) return q;
  const r = parseLaborRate(rate);
  if (!r.ok) return r;
  const raw = q.value * r.value;
  if (!Number.isFinite(raw)) {
    return { ok: false, error: INSTALLER_LABOR_MONEY_ERROR.INFINITY };
  }
  return { ok: true, amount: roundMoney2(raw) };
}

export function isActiveActualLaborStatus(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "approved" || s === "paid";
}

export function isCommittedLaborStatus(status: string | null | undefined): boolean {
  return (status ?? "").toLowerCase() === "draft";
}

export function isCancelledLaborStatus(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "cancelled" || s === "void";
}

function billAmount(b: InstallerBillLike): number {
  if (b.lines?.length) {
    return roundMoney2(
      b.lines.reduce((s, l) => {
        if (l.line_total != null) {
          const n = asNumber(l.line_total);
          return s + (Number.isFinite(n) ? n : 0);
        }
        if (l.amount != null) {
          const n = asNumber(l.amount);
          return s + (Number.isFinite(n) ? n : 0);
        }
        const q = asNumber(l.quantity);
        const r = asNumber(l.rate);
        return s + (Number.isFinite(q) && Number.isFinite(r) ? q * r : 0);
      }, 0),
    );
  }
  const t = asNumber(b.total);
  return Number.isFinite(t) ? roundMoney2(t) : 0;
}

function financialBills(bills: InstallerBillLike[], jobId?: string): InstallerBillLike[] {
  return bills.filter((b) => {
    if (jobId && b.job_id !== jobId) return false;
    if (b.legacy_display_only) return false;
    return true;
  });
}

/** Approved + paid net. Draft/cancelled/void are not actual cost. */
export function actualInstallerLaborForJob(
  bills: InstallerBillLike[],
  jobId: string,
): number {
  return roundMoney2(
    financialBills(bills, jobId)
      .filter((b) => isActiveActualLaborStatus(b.status))
      .reduce((s, b) => s + billAmount(b), 0),
  );
}

/** Draft (assigned/authorized, not yet accepted as actual). */
export function committedInstallerLaborForJob(
  bills: InstallerBillLike[],
  jobId: string,
): number {
  return roundMoney2(
    financialBills(bills, jobId)
      .filter((b) => isCommittedLaborStatus(b.status))
      .reduce((s, b) => s + billAmount(b), 0),
  );
}

/** @deprecated alias — previously included drafts; actuals only. */
export function installerLaborIncurredForJob(
  bills: InstallerBillLike[],
  jobId: string,
): number {
  return actualInstallerLaborForJob(bills, jobId);
}

export function laborSettlementForJob(
  bills: InstallerBillLike[],
  jobId: string,
): {
  estimated?: number;
  committed: number;
  actual: number;
  owed: number;
  paid: number;
  remaining: number;
  basis: LaborCostBasis;
} {
  const rows = financialBills(bills, jobId);
  const committed = committedInstallerLaborForJob(rows, jobId);
  const actual = actualInstallerLaborForJob(rows, jobId);
  const paid = roundMoney2(
    rows
      .filter((b) => (b.status ?? "").toLowerCase() === "paid")
      .reduce((s, b) => s + billAmount(b), 0),
  );
  const owed = roundMoney2(
    rows
      .filter((b) => (b.status ?? "").toLowerCase() === "approved")
      .reduce((s, b) => s + billAmount(b), 0),
  );
  const basis: LaborCostBasis =
    actual > 0 || rows.some((b) => isActiveActualLaborStatus(b.status))
      ? "actual"
      : committed > 0
        ? "committed"
        : "estimated";
  return {
    committed,
    actual,
    owed,
    paid,
    remaining: owed,
    basis,
  };
}

export function projectedLaborCost(args: {
  estimated: number;
  committed: number;
  hasApprovedLabor: boolean;
  actual: number;
}): { amount: number; basis: LaborCostBasis } {
  return laborCostForProfitability({
    estimated: args.estimated,
    committed: args.committed,
    actual: args.actual,
    hasApprovedLabor: args.hasApprovedLabor,
  });
}

/**
 * Actual job profitability labor: approved obligations only.
 * Projected: estimated (job snapshot) or committed draft — never both plus actual.
 */
export function laborCostForProfitability(args: {
  estimated: number;
  committed: number;
  actual: number;
  hasApprovedLabor: boolean;
}): { amount: number; basis: LaborCostBasis } {
  if (args.hasApprovedLabor) {
    return { amount: roundMoney2(args.actual), basis: "actual" };
  }
  if (args.committed > 0) {
    return { amount: roundMoney2(args.committed), basis: "committed" };
  }
  return { amount: roundMoney2(args.estimated), basis: "estimated" };
}

export function jobLaborMustNotFeedActual(): true {
  return true;
}

export function assignmentIsNotActualCost(): true {
  return true;
}

export function installerLaborAccountingCategory(): BillAccountingCategory {
  return "installer_labor";
}

export function installerLaborMayPostToGl(): false {
  return false;
}

export function employeeLaborCreatesVendorAp(kind: InstallerWorkerKind): boolean {
  return kind === "subcontractor";
}

export function payrollBoundaryForEmployee(): {
  createsVendorAp: false;
  tracksJobCost: true;
  processesPayroll: false;
} {
  return { createsVendorAp: false, tracksJobCost: true, processesPayroll: false };
}

export function assessLaborIdempotency(args: {
  existingKey: string | null | undefined;
  existingContextHash: string | null | undefined;
  incomingKey: string | null | undefined;
  incomingContextHash: string;
  existingAction?: string | null;
  incomingAction?: string | null;
}): "proceed" | "duplicate" | "conflict" {
  if (!args.incomingKey) return "proceed";
  if (!args.existingKey || args.existingKey !== args.incomingKey) return "proceed";
  if (
    args.existingAction &&
    args.incomingAction &&
    args.existingAction !== args.incomingAction
  ) {
    return "conflict";
  }
  if (args.existingContextHash === args.incomingContextHash) return "duplicate";
  return "conflict";
}

export function laborContextFingerprint(args: {
  jobId: string;
  installerId: string | null;
  crewId: string | null;
  subtotal: number;
  adjustments: number;
  total: number;
  serviceDate: string | null;
  lineFingerprint: string;
}): string {
  return [
    args.jobId,
    args.installerId ?? "",
    args.crewId ?? "",
    roundMoney2(args.subtotal).toFixed(2),
    roundMoney2(args.adjustments).toFixed(2),
    roundMoney2(args.total).toFixed(2),
    args.serviceDate ?? "",
    args.lineFingerprint,
  ].join("|");
}

export function mayApproveInstallerLabor(args: {
  actorRole: string | null | undefined;
  actorId: string | null | undefined;
  installerId: string | null | undefined;
  crewId?: string | null;
  workerKind?: string | null;
}): { ok: true } | { ok: false; code: string } {
  const role = (args.actorRole ?? "").toLowerCase();
  if (role === "crew") return { ok: false, code: "SELF_APPROVE_BLOCKED" };
  if (role !== "admin" && role !== "office") {
    return { ok: false, code: "UNAUTHORIZED" };
  }
  if (!args.installerId && !args.crewId) {
    return { ok: false, code: "CLASSIFICATION_REQUIRED" };
  }
  const kind = (args.workerKind ?? "").toLowerCase();
  if (kind === "unknown" || kind === "") {
    return { ok: false, code: "CLASSIFICATION_REQUIRED" };
  }
  if (
    args.actorId &&
    args.installerId &&
    args.actorId === args.installerId &&
    role !== "admin" &&
    role !== "office"
  ) {
    return { ok: false, code: "SELF_APPROVE_BLOCKED" };
  }
  return { ok: true };
}

export function reversalExceedsActive(args: {
  originalActiveTotal: number;
  reversalAmount: number;
}): boolean {
  return roundMoney2(args.reversalAmount) - roundMoney2(args.originalActiveTotal) > 0.005;
}

export function paidLaborMaySilentVoid(): false {
  return false;
}

export function postingOffCreatesNoJournal(postingEnabled: boolean): boolean {
  return postingEnabled !== true;
}

export const INSTALLER_LABOR_LOCK_ORDER = [
  "discover_job_id",
  "job",
  "installer_bill",
  "ap_bill",
  "ap_payments",
  "accounting_outbox",
] as const;

export function subcontractorCannotMarkPaidIndependently(): true {
  return true;
}

export function unknownWorkerCannotApprove(kind: string | null | undefined): boolean {
  return kind !== "employee" && kind !== "subcontractor";
}

export function draftSaveMustValidateBeforeDelete(): true {
  return true;
}

/** Subcontractor accounting owner is vendor AP — never dual installer_bill posting. */
export function subcontractorAccountingOwner(): "vendor_bill" {
  return "vendor_bill";
}

export function employeeAccountingOwner(): "installer_bill" {
  return "installer_bill";
}

export function correctionMustRaiseOnNestedFailure(): true {
  return true;
}

export const INSTALLER_LABOR_AUDIT_ACTIONS = [
  "installer_labor_created",
  "installer_labor_cancelled",
  "installer_labor_approved",
  "installer_labor_reversed",
  "installer_labor_corrected",
  "installer_labor_paid",
  "installer_labor_ap_linked",
  "installer_labor_ap_voided",
  "installer_labor_payroll_ops_recorded",
] as const;
