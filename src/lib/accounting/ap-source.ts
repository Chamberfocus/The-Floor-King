/**
 * F6-P3B canonical AP — vendor bills as the single payable ledger.
 * Posting remains OFF. This module never enables GL posting.
 */
import type { BillAccountingCategory } from "@/lib/accounting/ap-category";

export const AP_LEDGER = "bills" as const;

export type ApSourceType =
  | "manual"
  | "purchase_order"
  | "installer_labor"
  | "legacy";

export type ApLifecycle = "draft" | "open" | "void";

export type ApSettlementStatus = "draft" | "open" | "partial" | "paid" | "void";

/** JOB → PO/installer source → vendor invoice identity → AP bill → payments → outbox. */
export const AP_LOCK_ORDER = [
  "job",
  "source",
  "vendor_invoice",
  "ap_bill",
  "ap_payments",
  "accounting_outbox",
] as const;

export const AP_MONEY_ERROR = {
  NAN: "AP_INVALID_AMOUNT: NaN rejected.",
  INFINITY: "AP_INVALID_AMOUNT: Infinity rejected.",
  NEGATIVE: "AP_INVALID_AMOUNT: negative amount rejected.",
  PRECISION: "AP_INVALID_AMOUNT: more than two decimal places.",
  ZERO: "AP_INVALID_AMOUNT: zero amount rejected.",
} as const;

function asNumber(v: number | string | null | undefined): number {
  if (typeof v === "number") return v;
  if (v == null || v === "") return NaN;
  return Number(v);
}

export function roundMoney2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function parseApMoney(
  v: number | string | null | undefined,
  opts?: { allowZero?: boolean; allowNegative?: boolean },
): { ok: true; amount: number } | { ok: false; error: string } {
  const n = asNumber(v);
  if (Number.isNaN(n)) return { ok: false, error: AP_MONEY_ERROR.NAN };
  if (!Number.isFinite(n)) return { ok: false, error: AP_MONEY_ERROR.INFINITY };
  if (n < 0 && !opts?.allowNegative) return { ok: false, error: AP_MONEY_ERROR.NEGATIVE };
  const scaled = n * 100;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-8) {
    return { ok: false, error: AP_MONEY_ERROR.PRECISION };
  }
  const amount = Math.round(scaled) / 100;
  if (amount === 0 && !opts?.allowZero) return { ok: false, error: AP_MONEY_ERROR.ZERO };
  return { ok: true, amount };
}

export function apLineTotal(
  quantity: number | string | null | undefined,
  unitCost: number | string | null | undefined,
): { ok: true; amount: number } | { ok: false; error: string } {
  const q = parseApMoney(quantity, { allowZero: true });
  if (!q.ok) return q;
  const r = parseApMoney(unitCost, { allowZero: true });
  if (!r.ok) return r;
  const raw = q.amount * r.amount;
  if (!Number.isFinite(raw)) return { ok: false, error: AP_MONEY_ERROR.INFINITY };
  return { ok: true, amount: roundMoney2(raw) };
}

export function apOriginalTotal(
  lines: { quantity?: number | string | null; unit_cost?: number | string | null }[],
): number {
  return roundMoney2(
    lines.reduce((s, l) => {
      const t = apLineTotal(l.quantity ?? 0, l.unit_cost ?? 0);
      return s + (t.ok ? t.amount : 0);
    }, 0),
  );
}

export function apRemaining(args: {
  original: number;
  paidActive: number;
  lifecycle: string | null | undefined;
}): number {
  if ((args.lifecycle ?? "").toLowerCase() === "void") return 0;
  if ((args.lifecycle ?? "").toLowerCase() === "draft") return 0;
  return roundMoney2(Math.max(0, args.original - args.paidActive));
}

export function apSettlementStatus(args: {
  lifecycle: string | null | undefined;
  original: number;
  paidActive: number;
}): ApSettlementStatus {
  const life = (args.lifecycle ?? "open").toLowerCase();
  if (life === "void") return "void";
  if (life === "draft") return "draft";
  const rem = apRemaining({
    original: args.original,
    paidActive: args.paidActive,
    lifecycle: life,
  });
  if (args.original > 0 && rem <= 0.005) return "paid";
  if (args.paidActive > 0.005) return "partial";
  return "open";
}

export function normalizeVendorInvoice(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "");
  return s || null;
}

export function vendorInvoiceDuplicate(args: {
  supplierId: string;
  invoiceNorm: string | null;
  existing: { supplierId: string; invoiceNorm: string | null; lifecycle: string }[];
}): boolean {
  if (!args.invoiceNorm) return false;
  return args.existing.some(
    (e) =>
      e.supplierId === args.supplierId &&
      e.invoiceNorm === args.invoiceNorm &&
      e.lifecycle !== "void",
  );
}

export function assessApIdempotency(args: {
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

export function installerLinkedApMayManualEdit(): false {
  return false;
}

export function installerLinkedApMayDelete(): false {
  return false;
}

export function paidApMaySilentVoid(): false {
  return false;
}

export function paymentCreatesSecondExpense(): false {
  return false;
}

export function poCommitmentIsNotActual(hasActiveApForPo: boolean): boolean {
  return hasActiveApForPo;
}

export function installerLaborPlusApDoubleCountsLabor(): false {
  return false;
}

export function employeeLaborCreatesVendorAp(): false {
  return false;
}

export function vendorCreditsImplementedThisPhase(): false {
  return false;
}

/** Index may be absent; concurrent creates still serialize on this identity. */
export function vendorInvoiceLockRequiredWhenIndexAbsent(): true {
  return true;
}

export function poRowLockSerializesDuplicateAp(): true {
  return true;
}

export function nativeNumericMustRejectNonFinite(): true {
  return true;
}

export function billPaymentTriggerMustRejectDraftAndVoid(): true {
  return true;
}

export function apPaymentInsertsExpense(): false {
  return false;
}

export function billLinkedDirectExpenseCreatesSecondCost(): false {
  return false;
}

/** Unlinked free-text expenses cannot be proven to match AP. Canonical supplier+invoice is symmetric. */
export function unlinkedExpenseApDuplicateIsDeterministic(): false {
  return false;
}

export function apDirectExpenseIdentityIsSymmetric(): true {
  return true;
}

export function directExpenseIdempotencyIsContextAware(): true {
  return true;
}

export function authenticatedExpenseHardDeleteAllowed(): false {
  return false;
}

export function expenseReversalDeferredThisPhase(): true {
  return true;
}

export function apLockJobsSortedRequiredForJobChange(): true {
  return true;
}

export function financialIdempotencyRequiresCompleteContext(): true {
  return true;
}

export function paymentIdempotencyRejectsBillIdOnlyShortcut(): true {
  return true;
}

/** 0166/0171 snapshot post RPC — dropped in 0175; activate is canonical. */
export function postVendorBillSafeClosedAfter0175(): true {
  return true;
}

export const CANONICAL_AP_MUTATION_RPCS = [
  "create_vendor_bill_safe",
  "save_vendor_bill_draft_safe",
  "activate_vendor_bill_safe",
  "void_vendor_bill_safe",
  "correct_vendor_bill_safe",
  "record_bill_payment_safe",
  "void_bill_payment_safe",
  "record_direct_expense_safe",
] as const;

export function gucIsNotATablePrivilege(): true {
  return true;
}

export function apSelectRoles(): readonly ["admin", "office"] {
  return ["admin", "office"];
}

export function correctionNestedFailureMustRaise(): true {
  return true;
}

export function apAccountingCategoryValid(
  cat: string | null | undefined,
): cat is BillAccountingCategory {
  return (
    cat === "material_purchase" ||
    cat === "installer_labor" ||
    cat === "freight" ||
    cat === "operating_expense" ||
    cat === "inventory_asset" ||
    cat === "other_mapped" ||
    cat === "review_required"
  );
}

export const AP_AUDIT_ACTIONS = [
  "vendor_bill_created",
  "vendor_bill_activated",
  "vendor_bill_voided",
  "vendor_bill_corrected",
  "bill_payment_recorded",
  "bill_payment_voided",
] as const;
