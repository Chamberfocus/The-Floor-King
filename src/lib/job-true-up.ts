/**
 * Job true-up, actual gross profit, and Floor King sales commission.
 *
 * Operational job costing only. This module does not post accounting,
 * change invoice balances, or replace estimate-approval snapshots.
 *
 * Commission is a percent of ACTUAL GROSS PROFIT DOLLARS, not sales revenue.
 * Formula version 1. Tier comparisons use integer cents:
 *   gpCents * 10000 >= revenueCents * thresholdHundredths
 * where 50.00% is 5000, 45.00% is 4500, 40.00% is 4000, 35.00% is 3500.
 * 49.999% fails the 50% test. Currency half-up is integer cents.
 *
 * The estimate screen's job_commission_pct (% of pre-tax sale) is a different
 * number and is not this payable schedule.
 */

import type { UserRole } from "@/lib/types";
import {
  actualInstallerLaborForJob,
  committedInstallerLaborForJob,
  type InstallerBillLike,
} from "@/lib/accounting/installer-labor-source";
import { computeJobOpenBalance, type JobBalanceInvoiceInput } from "@/lib/invoice-calc";
import { isCommittedPoStatus } from "@/lib/po-calc";

export const TRUE_UP_FORMULA_VERSION = 1 as const;

export const NO_COMMISSION_NO_GP =
  "NO COMMISSION — JOB HAS NO POSITIVE GROSS PROFIT";
export const CAUSE_INCOMPLETE =
  "CAUSE NOT YET DETERMINABLE — COST DATA INCOMPLETE";
export const LABOR_INCOMPLETE = "LABOR COST INCOMPLETE";

/** No commission-split model exists on customers or jobs. */
export const COMMISSION_SPLIT_UNSUPPORTED =
  "This CRM stores one salesperson on the customer (customers.assigned_to). Jobs do not split commission. A shared job needs an owner decision before any split is added.";

export type TrueUpStatus =
  | "needs_true_up"
  | "missing_costs"
  | "ready_for_review"
  | "approved"
  | "commission_payable"
  | "commission_paid";

export const TRUE_UP_STATUS_LABEL: Record<TrueUpStatus, string> = {
  needs_true_up: "NEEDS TRUE-UP",
  missing_costs: "MISSING COSTS",
  ready_for_review: "READY FOR REVIEW",
  approved: "APPROVED",
  commission_payable: "COMMISSION PAYABLE",
  commission_paid: "COMMISSION PAID",
};

export type CostCategory = "material" | "labor" | "freight" | "other";

export type CostResolution =
  | { state: "auto"; cents: bigint; source: string }
  | { state: "confirmed_zero"; cents: bigint; reason: string }
  | { state: "manual"; cents: bigint; reason: string }
  | { state: "incomplete"; hint: string }
  | { state: "unknown" };

export interface TrueUpAccess {
  viewOwn: boolean;
  viewAll: boolean;
  enterCosts: boolean;
  approve: boolean;
  overrideCommission: boolean;
  overrideCollection: boolean;
  correctSalesperson: boolean;
  markPaid: boolean;
  ownerReport: boolean;
  performance: boolean;
}

/** Server and UI share this matrix. Hidden navigation is not the control. */
export function trueUpAccess(role: UserRole | null | undefined): TrueUpAccess {
  const none: TrueUpAccess = {
    viewOwn: false,
    viewAll: false,
    enterCosts: false,
    approve: false,
    overrideCommission: false,
    overrideCollection: false,
    correctSalesperson: false,
    markPaid: false,
    ownerReport: false,
    performance: false,
  };
  if (role === "admin") {
    return {
      viewOwn: true,
      viewAll: true,
      enterCosts: true,
      approve: true,
      overrideCommission: true,
      overrideCollection: true,
      correctSalesperson: true,
      markPaid: true,
      ownerReport: true,
      performance: true,
    };
  }
  if (role === "office") {
    return {
      viewOwn: true,
      viewAll: true,
      enterCosts: true,
      approve: true,
      overrideCommission: false,
      overrideCollection: false,
      correctSalesperson: true,
      markPaid: true,
      ownerReport: true,
      performance: true,
    };
  }
  if (role === "salesman") {
    return { ...none, viewOwn: true };
  }
  return none;
}

export function assertTrueUpCapability(
  role: UserRole | null | undefined,
  cap: keyof TrueUpAccess,
): void {
  if (!trueUpAccess(role)[cap]) {
    throw new Error("Not authorized.");
  }
}

/** Decimal text or finite number → integer cents, half-up. Null if blank/invalid. */
export function moneyToCents(value: number | string | null | undefined): bigint | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return parseDecimalToCents(value.toFixed(8));
  }
  const s = value.trim().replace(/[$,\s]/g, "");
  if (!s) return null;
  return parseDecimalToCents(s);
}

export function requireCents(value: number | string | null | undefined): bigint {
  const c = moneyToCents(value);
  if (c == null) throw new Error("Invalid money amount.");
  return c;
}

function parseDecimalToCents(raw: string): bigint | null {
  const m = raw.trim().match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const neg = m[1] === "-";
  const whole = BigInt(m[2] ?? "0");
  const frac = m[3] ?? "";
  const padded = (frac + "000").slice(0, 3);
  const cents2 = BigInt(padded.slice(0, 2) || "0");
  const roundDigit = BigInt(padded.slice(2, 3) || "0");
  let cents = whole * BigInt(100) + cents2;
  if (roundDigit >= BigInt(5)) cents += BigInt(1);
  return neg ? -cents : cents;
}

/** Quantity or rate → millionths, so qty × rate stays in integers. */
function toMicros(value: number | string | null | undefined): bigint {
  if (value == null || value === "") return BigInt(0);
  const raw = typeof value === "number" ? value.toFixed(8) : String(value).trim();
  const m = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!m) return BigInt(0);
  const neg = m[1] === "-";
  const whole = BigInt(m[2] ?? "0");
  const frac = (m[3] ?? "").slice(0, 6).padEnd(6, "0");
  const micros = whole * BigInt(1000000) + BigInt(frac || "0");
  return neg ? -micros : micros;
}

export function lineAmountCents(
  quantity: number | string | null | undefined,
  rate: number | string | null | undefined,
): bigint {
  const productMicros = (toMicros(quantity) * toMicros(rate)) / BigInt(1000000);
  const neg = productMicros < BigInt(0);
  const abs = neg ? -productMicros : productMicros;
  const cents = (abs + BigInt(5000)) / BigInt(10000);
  return neg ? -cents : cents;
}

export function formatCents(cents: bigint | null | undefined): string {
  if (cents == null) return "—";
  const neg = cents < BigInt(0);
  const abs = neg ? -cents : cents;
  const dollars = (abs / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % BigInt(100)).toString().padStart(2, "0");
  return `${neg ? "-" : ""}$${dollars}.${frac}`;
}

export function centsToInput(cents: bigint): string {
  const neg = cents < BigInt(0);
  const abs = neg ? -cents : cents;
  return `${neg ? "-" : ""}${abs / BigInt(100)}.${(abs % BigInt(100)).toString().padStart(2, "0")}`;
}

/** Margin in hundredths of a percent (45.00% = 4500). Null when revenue is not positive. */
export function marginHundredths(gpCents: bigint, revenueCents: bigint): bigint | null {
  if (revenueCents <= BigInt(0)) return null;
  const neg = gpCents < BigInt(0);
  const abs = neg ? -gpCents : gpCents;
  const hundredths = (abs * BigInt(10000) + revenueCents / BigInt(2)) / revenueCents;
  return neg ? -hundredths : hundredths;
}

export function formatMarginHundredths(h: bigint | null | undefined): string {
  if (h == null) return "—";
  const neg = h < BigInt(0);
  const abs = neg ? -h : h;
  return `${neg ? "-" : ""}${abs / BigInt(100)}.${(abs % BigInt(100)).toString().padStart(2, "0")}%`;
}

export function formatPoints(hundredths: bigint | null | undefined): string {
  if (hundredths == null) return "—";
  const neg = hundredths < BigInt(0);
  const abs = neg ? -hundredths : hundredths;
  return `${neg ? "-" : ""}${abs / BigInt(100)}.${(abs % BigInt(100)).toString().padStart(2, "0")} points`;
}

export function formatRateBps(bps: bigint): string {
  const abs = bps < BigInt(0) ? -bps : bps;
  return `${abs / BigInt(100)}.${(abs % BigInt(100)).toString().padStart(2, "0")}%`;
}

/**
 * Exact tier. 50.00% → 800 bps (8%). 49.999% → 700. 45% → 700.
 * 40% → 600. 35% → 500. Below 35% → 250 (2.50%). Non-positive GP or revenue → 0.
 */
export function commissionRateBps(gpCents: bigint, revenueCents: bigint): bigint {
  if (revenueCents <= BigInt(0) || gpCents <= BigInt(0)) return BigInt(0);
  if (gpCents * BigInt(10000) >= revenueCents * BigInt(5000)) return BigInt(800);
  if (gpCents * BigInt(10000) >= revenueCents * BigInt(4500)) return BigInt(700);
  if (gpCents * BigInt(10000) >= revenueCents * BigInt(4000)) return BigInt(600);
  if (gpCents * BigInt(10000) >= revenueCents * BigInt(3500)) return BigInt(500);
  return BigInt(250);
}

/** Half-up cents. Never negative. */
export function commissionAmountCents(gpCents: bigint, revenueCents: bigint): bigint {
  if (gpCents <= BigInt(0) || revenueCents <= BigInt(0)) return BigInt(0);
  const rate = commissionRateBps(gpCents, revenueCents);
  return (gpCents * rate + BigInt(5000)) / BigInt(10000);
}

export function commissionFromRate(gpCents: bigint, rateBps: bigint): bigint {
  if (gpCents <= BigInt(0) || rateBps <= BigInt(0)) return BigInt(0);
  return (gpCents * rateBps + BigInt(5000)) / BigInt(10000);
}

export interface RevenueLine {
  quantity: number | string | null;
  rate: number | string | null;
  cancelled?: boolean;
}

export interface RevenueInvoice {
  id: string;
  status: string;
  commercialKind?: string | null;
  /** Sort key. Lower sorts first when dropping a duplicate original. */
  sequence?: number;
  lines: RevenueLine[];
  /** Tax-inclusive active credits applied to this invoice. */
  appliedCreditCents?: bigint;
  /** Tax-inclusive active write-offs. */
  appliedWriteOffCents?: bigint;
}

export interface CommissionableRevenue {
  cents: bigint;
  taxCents: bigint;
  state: "known" | "missing";
  duplicateOriginalsExcluded: string[];
  voidExcluded: number;
  draftExcluded: number;
  /** Refunds are cash out of a credit and are not subtracted again. */
  refundsIgnoredCents: bigint;
  depositsIgnoredCents: bigint;
  paymentsIgnoredCents: bigint;
}

const ACTIVE_INVOICE = new Set(["sent", "partial", "paid"]);

function taxOn(subtotal: bigint, taxRatePct: number | string | null | undefined): bigint {
  const rate = moneyToCents(taxRatePct ?? 0) ?? BigInt(0);
  if (subtotal === BigInt(0) || rate === BigInt(0)) return BigInt(0);
  const neg = subtotal < BigInt(0);
  const abs = neg ? -subtotal : subtotal;
  const tax = (abs * rate + BigInt(5000)) / BigInt(10000);
  return neg ? -tax : tax;
}

function preTaxPortion(amount: bigint, subtotal: bigint, total: bigint): bigint {
  if (amount <= BigInt(0) || total <= BigInt(0) || subtotal <= BigInt(0)) return BigInt(0);
  return (amount * subtotal + total / BigInt(2)) / total;
}

export interface RevenueInput {
  invoices: (RevenueInvoice & { taxRatePct?: number | string | null })[];
  /** Present only so tests can prove they are ignored. */
  refundsCents?: bigint;
  depositsCents?: bigint;
  paymentsCents?: bigint;
}

/**
 * Final commissionable revenue, pre-tax.
 *
 * Sum of qty × rate on active (sent/partial/paid) job invoices,
 * minus the pre-tax share of applied credits and write-offs.
 * Sales tax, deposits, payments, refunds, voids, drafts, and cancelled
 * lines are not revenue. A second active commercial_kind=original is excluded.
 */
export function commissionableRevenue(input: RevenueInput): CommissionableRevenue {
  const kept: (RevenueInvoice & { taxRatePct?: number | string | null })[] = [];
  const duplicateOriginalsExcluded: string[] = [];
  let voidExcluded = 0;
  let draftExcluded = 0;
  const originals: typeof kept = [];

  for (const inv of input.invoices) {
    const status = (inv.status ?? "").toLowerCase();
    if (status === "void" || status === "cancelled") {
      voidExcluded += 1;
      continue;
    }
    if (!ACTIVE_INVOICE.has(status)) {
      draftExcluded += 1;
      continue;
    }
    if ((inv.commercialKind ?? "").toLowerCase() === "original") originals.push(inv);
    else kept.push(inv);
  }

  originals.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.id.localeCompare(b.id));
  if (originals.length) {
    kept.push(originals[0]!);
    for (const extra of originals.slice(1)) duplicateOriginalsExcluded.push(extra.id);
  }

  let cents = BigInt(0);
  let taxCents = BigInt(0);
  for (const inv of kept) {
    let subtotal = BigInt(0);
    for (const line of inv.lines) {
      if (line.cancelled) continue;
      subtotal += lineAmountCents(line.quantity, line.rate);
    }
    const tax = taxOn(subtotal, inv.taxRatePct ?? 0);
    const total = subtotal + tax;
    taxCents += tax;
    const credit = preTaxPortion(inv.appliedCreditCents ?? BigInt(0), subtotal, total);
    const writeOff = preTaxPortion(inv.appliedWriteOffCents ?? BigInt(0), subtotal, total);
    cents += subtotal - credit - writeOff;
  }

  return {
    cents,
    taxCents,
    state: kept.length ? "known" : "missing",
    duplicateOriginalsExcluded,
    voidExcluded,
    draftExcluded,
    refundsIgnoredCents: input.refundsCents ?? BigInt(0),
    depositsIgnoredCents: input.depositsCents ?? BigInt(0),
    paymentsIgnoredCents: input.paymentsCents ?? BigInt(0),
  };
}

export interface ApprovalMoney {
  version: number;
  subtotalCents: bigint;
  discountCents: bigint;
  taxCents: bigint;
  totalCents: bigint;
}

/** Pre-tax approved contract = snapshot total − tax, which is subtotal − discount. */
export function snapshotPreTaxCents(s: ApprovalMoney): bigint {
  return s.totalCents - s.taxCents;
}

export function estimatedRevenueFromSnapshots(snapshots: ApprovalMoney[]): {
  originalCents: bigint | null;
  changeOrderCents: bigint | null;
  latestCents: bigint | null;
} {
  if (!snapshots.length) {
    return { originalCents: null, changeOrderCents: null, latestCents: null };
  }
  const ordered = [...snapshots].sort((a, b) => a.version - b.version);
  const original = snapshotPreTaxCents(ordered[0]!);
  const latest = snapshotPreTaxCents(ordered[ordered.length - 1]!);
  return {
    originalCents: original,
    changeOrderCents: latest - original,
    latestCents: latest,
  };
}

/** Estimated freight dollars = bare snapshotted material × org freight markup. */
export function estimatedFreightCents(
  bareMaterialCents: bigint | null,
  freightMarkupPct: number | string | null | undefined,
): bigint | null {
  if (bareMaterialCents == null) return null;
  const pct = moneyToCents(freightMarkupPct ?? 0) ?? BigInt(0);
  if (pct === BigInt(0)) return BigInt(0);
  const neg = bareMaterialCents < BigInt(0);
  const abs = neg ? -bareMaterialCents : bareMaterialCents;
  const freight = (abs * pct + BigInt(5000)) / BigInt(10000);
  return neg ? -freight : freight;
}

const FREIGHT_TEXT = /\b(freight|shipping|delivery)\b/i;

export function isFreightDescription(description: string | null | undefined): boolean {
  return FREIGHT_TEXT.test(description ?? "");
}

export interface PullFact {
  productId?: string | null;
  qty?: number | string | null;
  unitCost?: number | string | null;
  extendedCost?: number | string | null;
}

export interface PoLineFact {
  poStatus: string;
  productId?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  receivedQty?: number | string | null;
  unitCost?: number | string | null;
}

export interface ManualCostEntry {
  category: CostCategory;
  kind: "confirm_zero" | "manual_amount";
  amountCents: bigint;
  reason: string;
}

export interface CategoryResolution {
  category: CostCategory;
  resolution: CostResolution;
  /** Automatic figure even when a manual entry replaces it. Null when unknown. */
  calculatedCents: bigint | null;
  calculatedState: "auto" | "incomplete" | "unknown";
  hint: string | null;
}

function latestManual(entries: ManualCostEntry[], category: CostCategory): ManualCostEntry | null {
  const rows = entries.filter((e) => e.category === category);
  return rows.length ? rows[rows.length - 1]! : null;
}

function pullCents(p: PullFact): bigint {
  if (p.extendedCost != null && p.extendedCost !== "") {
    return moneyToCents(p.extendedCost) ?? BigInt(0);
  }
  const qty = toMicros(p.qty);
  const absQty = qty < BigInt(0) ? -qty : qty;
  const cost = toMicros(p.unitCost);
  const micros = (absQty * cost) / BigInt(1000000);
  return (micros + BigInt(5000)) / BigInt(10000);
}

function receivedMaterialCents(line: PoLineFact): bigint | null {
  const recv = moneyToCents(line.receivedQty ?? null);
  if (recv == null || recv <= BigInt(0)) return null;
  const unit = moneyToCents(line.unitCost ?? null);
  if (unit == null) return null;
  return lineAmountCents(line.receivedQty ?? 0, line.unitCost ?? 0);
}

export function resolveMaterial(args: {
  pulls: PullFact[];
  poLines: PoLineFact[];
  entries: ManualCostEntry[];
}): CategoryResolution {
  const manual = latestManual(args.entries, "material");
  const pulledProducts = new Set(
    args.pulls.map((p) => p.productId).filter((id): id is string => !!id),
  );
  let auto = BigInt(0);
  let sawAuto = false;
  let incomplete: string | null = null;

  for (const p of args.pulls) {
    auto += pullCents(p);
    sawAuto = true;
  }

  for (const line of args.poLines) {
    if (!isCommittedPoStatus(line.poStatus)) continue;
    if (isFreightDescription(line.description)) continue;
    const received = receivedMaterialCents(line);
    const pulled = !!line.productId && pulledProducts.has(line.productId);
    if (pulled) continue;
    if (received != null) {
      auto += received;
      sawAuto = true;
      continue;
    }
    const ordered = moneyToCents(line.quantity ?? null);
    if (ordered != null && ordered > BigInt(0)) {
      incomplete = "PO exists but no final material cost";
    }
  }

  const calculatedState = incomplete ? "incomplete" : sawAuto ? "auto" : "unknown";
  const calculatedCents = calculatedState === "auto" ? auto : null;
  if (manual?.kind === "manual_amount") {
    return {
      category: "material",
      resolution: { state: "manual", cents: manual.amountCents, reason: manual.reason },
      calculatedCents,
      calculatedState,
      hint: incomplete,
    };
  }
  if (manual?.kind === "confirm_zero") {
    return {
      category: "material",
      resolution: { state: "confirmed_zero", cents: BigInt(0), reason: manual.reason },
      calculatedCents,
      calculatedState,
      hint: incomplete,
    };
  }
  if (incomplete) {
    return {
      category: "material",
      resolution: { state: "incomplete", hint: incomplete },
      calculatedCents: null,
      calculatedState,
      hint: incomplete,
    };
  }
  if (sawAuto) {
    return {
      category: "material",
      resolution: { state: "auto", cents: auto, source: "Stock pulls plus received drop-ship lines. Receipts that were also pulled are not added twice." },
      calculatedCents: auto,
      calculatedState,
      hint: null,
    };
  }
  return {
    category: "material",
    resolution: { state: "unknown" },
    calculatedCents: null,
    calculatedState: "unknown",
    hint: null,
  };
}

export function resolveLabor(args: {
  bills: InstallerBillLike[];
  jobId: string;
  installerAssigned: boolean;
  legacyLaborRows: number;
  entries: ManualCostEntry[];
}): CategoryResolution {
  const manual = latestManual(args.entries, "labor");
  const actual = moneyToCents(actualInstallerLaborForJob(args.bills, args.jobId)) ?? BigInt(0);
  const committed = moneyToCents(committedInstallerLaborForJob(args.bills, args.jobId)) ?? BigInt(0);
  const approved = args.bills.some(
    (b) => b.job_id === args.jobId && !b.legacy_display_only && (b.status === "approved" || b.status === "paid"),
  );
  let hint: string | null = null;
  if (committed > BigInt(0)) hint = LABOR_INCOMPLETE;
  else if (!approved && (args.installerAssigned || args.legacyLaborRows > 0)) hint = LABOR_INCOMPLETE;

  const calculatedState = hint ? "incomplete" : approved ? "auto" : "unknown";
  const calculatedCents = calculatedState === "auto" ? actual : null;

  if (manual?.kind === "manual_amount") {
    return {
      category: "labor",
      resolution: { state: "manual", cents: manual.amountCents, reason: manual.reason },
      calculatedCents,
      calculatedState,
      hint,
    };
  }
  if (manual?.kind === "confirm_zero") {
    return {
      category: "labor",
      resolution: { state: "confirmed_zero", cents: BigInt(0), reason: manual.reason },
      calculatedCents,
      calculatedState,
      hint,
    };
  }
  if (hint) {
    return {
      category: "labor",
      resolution: { state: "incomplete", hint },
      calculatedCents: null,
      calculatedState,
      hint,
    };
  }
  if (approved) {
    return {
      category: "labor",
      resolution: {
        state: "auto",
        cents: actual,
        source: "Approved and paid installer bills. Legacy job_labor is not added.",
      },
      calculatedCents: actual,
      calculatedState: "auto",
      hint: null,
    };
  }
  return {
    category: "labor",
    resolution: { state: "unknown" },
    calculatedCents: null,
    calculatedState: "unknown",
    hint: null,
  };
}

export function resolveFreight(args: {
  poLines: PoLineFact[];
  entries: ManualCostEntry[];
}): CategoryResolution {
  const manual = latestManual(args.entries, "freight");
  let auto = BigInt(0);
  let saw = false;
  let incomplete: string | null = null;
  for (const line of args.poLines) {
    if (!isCommittedPoStatus(line.poStatus)) continue;
    if (!isFreightDescription(line.description)) continue;
    const received = receivedMaterialCents(line);
    if (received != null) {
      auto += received;
      saw = true;
    } else {
      incomplete = "Supplier/order indicates freight but no freight amount exists";
    }
  }
  const calculatedState = incomplete ? "incomplete" : saw ? "auto" : "unknown";
  const calculatedCents = calculatedState === "auto" ? auto : null;
  if (manual?.kind === "manual_amount") {
    return {
      category: "freight",
      resolution: { state: "manual", cents: manual.amountCents, reason: manual.reason },
      calculatedCents,
      calculatedState,
      hint: incomplete,
    };
  }
  if (manual?.kind === "confirm_zero") {
    return {
      category: "freight",
      resolution: { state: "confirmed_zero", cents: BigInt(0), reason: manual.reason },
      calculatedCents,
      calculatedState,
      hint: incomplete,
    };
  }
  if (incomplete) {
    return {
      category: "freight",
      resolution: { state: "incomplete", hint: incomplete },
      calculatedCents: null,
      calculatedState,
      hint: incomplete,
    };
  }
  if (saw) {
    return {
      category: "freight",
      resolution: { state: "auto", cents: auto, source: "Freight, shipping, or delivery lines on committed purchase orders." },
      calculatedCents: auto,
      calculatedState,
      hint: null,
    };
  }
  return {
    category: "freight",
    resolution: { state: "unknown" },
    calculatedCents: null,
    calculatedState: "unknown",
    hint: null,
  };
}

const OTHER_CATEGORIES = new Set(["materials", "tools", "other"]);
const OVERHEAD_CATEGORIES = new Set([
  "vehicle",
  "fuel",
  "rent",
  "utilities",
  "insurance",
  "marketing",
  "payroll",
  "office",
]);

export interface ExpenseFact {
  category: string;
  amountCents: bigint;
  awaitingReview?: boolean;
}

export function resolveOther(args: {
  expenses: ExpenseFact[];
  issueCostCents: bigint;
  hasInstallerBills: boolean;
  subcontractorExpenseCents: bigint;
  entries: ManualCostEntry[];
}): CategoryResolution {
  const manual = latestManual(args.entries, "other");
  let auto = BigInt(0);
  let saw = false;
  let incomplete: string | null = null;
  for (const exp of args.expenses) {
    const cat = exp.category.toLowerCase();
    if (OVERHEAD_CATEGORIES.has(cat) || cat === "labor" || cat === "subcontractor") continue;
    if (!OTHER_CATEGORIES.has(cat)) continue;
    if (exp.awaitingReview) {
      incomplete = "Job has miscellaneous direct expenses awaiting review";
      continue;
    }
    auto += exp.amountCents;
    saw = true;
  }
  if (args.issueCostCents > BigInt(0)) {
    auto += args.issueCostCents;
    saw = true;
  }
  if (!args.hasInstallerBills && args.subcontractorExpenseCents > BigInt(0)) {
    auto += args.subcontractorExpenseCents;
    saw = true;
  }
  const calculatedState = incomplete ? "incomplete" : saw ? "auto" : "unknown";
  const calculatedCents = calculatedState === "auto" ? auto : null;
  if (manual?.kind === "manual_amount") {
    return {
      category: "other",
      resolution: { state: "manual", cents: manual.amountCents, reason: manual.reason },
      calculatedCents,
      calculatedState,
      hint: incomplete,
    };
  }
  if (manual?.kind === "confirm_zero") {
    return {
      category: "other",
      resolution: { state: "confirmed_zero", cents: BigInt(0), reason: manual.reason },
      calculatedCents,
      calculatedState,
      hint: incomplete,
    };
  }
  if (incomplete) {
    return {
      category: "other",
      resolution: { state: "incomplete", hint: incomplete },
      calculatedCents: null,
      calculatedState,
      hint: incomplete,
    };
  }
  if (saw) {
    return {
      category: "other",
      resolution: {
        state: "auto",
        cents: auto,
        source: "Job-linked direct expenses and job-issue costs. Overhead is excluded. Installer bills are not added here.",
      },
      calculatedCents: auto,
      calculatedState,
      hint: null,
    };
  }
  return {
    category: "other",
    resolution: { state: "unknown" },
    calculatedCents: null,
    calculatedState: "unknown",
    hint: null,
  };
}

export function resolutionCents(r: CostResolution): bigint | null {
  if (r.state === "auto" || r.state === "manual" || r.state === "confirmed_zero") return r.cents;
  return null;
}

export function isResolved(r: CostResolution): boolean {
  return r.state === "auto" || r.state === "manual" || r.state === "confirmed_zero";
}

export interface TrueUpFacts {
  jobCompleted: boolean;
  trueUpExists: boolean;
  salespersonId: string | null;
  /** Frozen at approval. Null before approval. */
  snapshotSalespersonId?: string | null;
  approved: boolean;
  paidInFull: boolean;
  openBalanceCents: bigint;
  hasCollectibleInvoice: boolean;
  collectionOverride: boolean;
  revenue: CommissionableRevenue;
  /** Explicit admin acknowledgement when revenue is not positive. */
  zeroRevenueAcknowledged: boolean;
  estimated: {
    originalRevenueCents: bigint | null;
    changeOrderRevenueCents: bigint | null;
    materialCents: bigint | null;
    laborCents: bigint | null;
    freightCents: bigint | null;
    otherCents: bigint | null;
  };
  material: CategoryResolution;
  labor: CategoryResolution;
  freight: CategoryResolution;
  other: CategoryResolution;
  gpOverrideCents?: bigint | null;
  rateOverrideBps?: bigint | null;
  amountOverrideCents?: bigint | null;
}

export interface MoneyTrio {
  estimatedCents: bigint | null;
  actualCents: bigint | null;
  varianceCents: bigint | null;
}

export interface TrueUpResult {
  status: TrueUpStatus | null;
  costsComplete: boolean;
  revenue: MoneyTrio;
  material: MoneyTrio;
  labor: MoneyTrio;
  freight: MoneyTrio;
  other: MoneyTrio;
  totalDirect: MoneyTrio;
  grossProfit: MoneyTrio;
  marginHundredths: { estimated: bigint | null; actual: bigint | null; variance: bigint | null };
  actualRevenueCents: bigint | null;
  actualCostCents: bigint | null;
  actualGpCents: bigint | null;
  commissionableGpCents: bigint | null;
  calculatedRateBps: bigint;
  calculatedCommissionCents: bigint;
  rateBps: bigint;
  commissionCents: bigint;
  flags: string[];
  canApprove: boolean;
  approveBlockers: string[];
  collectionSatisfied: boolean;
  commissionStatus: "not_approved" | "approved_awaiting_collection" | "payable" | "paid";
  marginAnalysis: string[];
  salespersonId: string | null;
}

function trio(estimated: bigint | null, actual: bigint | null): MoneyTrio {
  if (estimated == null || actual == null) {
    return { estimatedCents: estimated, actualCents: actual, varianceCents: null };
  }
  return { estimatedCents: estimated, actualCents: actual, varianceCents: actual - estimated };
}

function sumOpt(parts: (bigint | null)[]): bigint | null {
  if (parts.some((p) => p == null)) return null;
  return parts.reduce<bigint>((s, p) => s + (p ?? BigInt(0)), BigInt(0));
}

export function deriveTrueUpStatus(args: {
  jobCompleted: boolean;
  trueUpExists: boolean;
  costsComplete: boolean;
  approved: boolean;
  collectionSatisfied: boolean;
  paidInFull: boolean;
}): TrueUpStatus | null {
  if (!args.jobCompleted) return null;
  if (args.approved && args.paidInFull) return "commission_paid";
  if (args.approved && args.collectionSatisfied) return "commission_payable";
  if (args.approved) return "approved";
  if (!args.trueUpExists) return "needs_true_up";
  if (!args.costsComplete) return "missing_costs";
  return "ready_for_review";
}

export function collectionSatisfied(args: {
  hasCollectibleInvoice: boolean;
  openBalanceCents: bigint;
  collectionOverride: boolean;
  revenueCents: bigint | null;
  zeroRevenueAcknowledged: boolean;
}): boolean {
  if (args.collectionOverride) return true;
  if ((args.revenueCents ?? BigInt(1)) <= BigInt(0) && args.zeroRevenueAcknowledged) return true;
  return args.hasCollectibleInvoice && args.openBalanceCents <= BigInt(0);
}

export function buildTrueUp(facts: TrueUpFacts): TrueUpResult {
  const materialCents = resolutionCents(facts.material.resolution);
  const laborCents = resolutionCents(facts.labor.resolution);
  const freightCents = resolutionCents(facts.freight.resolution);
  const otherCents = resolutionCents(facts.other.resolution);
  const costsComplete = [facts.material, facts.labor, facts.freight, facts.other].every((c) =>
    isResolved(c.resolution),
  );
  const actualRevenue = facts.revenue.state === "known" ? facts.revenue.cents : null;
  const actualCost = costsComplete
    ? (materialCents ?? BigInt(0)) + (laborCents ?? BigInt(0)) + (freightCents ?? BigInt(0)) + (otherCents ?? BigInt(0))
    : null;
  const actualGp =
    actualRevenue != null && actualCost != null ? actualRevenue - actualCost : null;

  const estRevenue = facts.estimated.originalRevenueCents == null
    ? null
    : facts.estimated.originalRevenueCents + (facts.estimated.changeOrderRevenueCents ?? BigInt(0));
  const estCost = sumOpt([
    facts.estimated.materialCents,
    facts.estimated.laborCents,
    facts.estimated.freightCents,
    facts.estimated.otherCents,
  ]);
  const estGp = estRevenue != null && estCost != null ? estRevenue - estCost : null;
  const estMargin = estGp != null && estRevenue != null ? marginHundredths(estGp, estRevenue) : null;
  const actMargin = actualGp != null && actualRevenue != null ? marginHundredths(actualGp, actualRevenue) : null;

  const flags: string[] = [];
  if (actualRevenue != null && actualRevenue <= BigInt(0)) flags.push("Revenue is not positive. Review is required.");
  if (actualGp != null && actualGp <= BigInt(0)) flags.push(NO_COMMISSION_NO_GP);
  if (facts.revenue.duplicateOriginalsExcluded.length) {
    flags.push("A duplicate original invoice was excluded from revenue.");
  }
  if (!facts.salespersonId) flags.push("No salesperson is assigned on the customer.");

  const commissionableGp = facts.gpOverrideCents != null ? facts.gpOverrideCents : actualGp;
  const calculatedRate =
    actualGp != null && actualRevenue != null ? commissionRateBps(actualGp, actualRevenue) : BigInt(0);
  const calculatedCommission =
    actualGp != null && actualRevenue != null ? commissionAmountCents(actualGp, actualRevenue) : BigInt(0);
  const rate = facts.rateOverrideBps != null ? facts.rateOverrideBps : calculatedRate;
  const commission =
    facts.amountOverrideCents != null
      ? (facts.amountOverrideCents < BigInt(0) ? BigInt(0) : facts.amountOverrideCents)
      : commissionableGp != null && actualRevenue != null
        ? facts.rateOverrideBps != null
          ? commissionFromRate(commissionableGp, facts.rateOverrideBps)
          : facts.gpOverrideCents != null
            ? commissionAmountCents(commissionableGp, actualRevenue)
            : calculatedCommission
        : BigInt(0);

  const collected = collectionSatisfied({
    hasCollectibleInvoice: facts.hasCollectibleInvoice,
    openBalanceCents: facts.openBalanceCents,
    collectionOverride: facts.collectionOverride,
    revenueCents: actualRevenue,
    zeroRevenueAcknowledged: facts.zeroRevenueAcknowledged,
  });

  const approveBlockers: string[] = [];
  if (!facts.jobCompleted) approveBlockers.push("Job is not completed.");
  if (!costsComplete) approveBlockers.push("Required actual costs are still missing.");
  if (actualRevenue == null) approveBlockers.push("Final revenue is not on an active invoice.");
  if (facts.revenue.duplicateOriginalsExcluded.length) {
    approveBlockers.push("Duplicate original invoices must be voided before approval.");
  }
  if (actualRevenue != null && actualRevenue <= BigInt(0) && !facts.zeroRevenueAcknowledged) {
    approveBlockers.push("Zero or negative revenue requires an admin review acknowledgement.");
  }
  if (!facts.salespersonId) approveBlockers.push("Assign a salesperson before approval.");
  if (facts.labor.resolution.state === "incomplete") approveBlockers.push(LABOR_INCOMPLETE);

  const status = deriveTrueUpStatus({
    jobCompleted: facts.jobCompleted,
    trueUpExists: facts.trueUpExists,
    costsComplete: costsComplete && actualRevenue != null && !!facts.salespersonId,
    approved: facts.approved,
    collectionSatisfied: collected,
    paidInFull: facts.paidInFull,
  });

  const marginAnalysis = marginCauseLines({
    costsComplete: costsComplete && actualRevenue != null && estRevenue != null && estGp != null && actualGp != null,
    revenueVariance: actualRevenue != null && estRevenue != null ? actualRevenue - estRevenue : null,
    materialImpact:
      materialCents != null && facts.estimated.materialCents != null
        ? facts.estimated.materialCents - materialCents
        : null,
    laborImpact:
      laborCents != null && facts.estimated.laborCents != null
        ? facts.estimated.laborCents - laborCents
        : null,
    freightImpact:
      freightCents != null && facts.estimated.freightCents != null
        ? facts.estimated.freightCents - freightCents
        : null,
    otherImpact:
      otherCents != null && facts.estimated.otherCents != null
        ? facts.estimated.otherCents - otherCents
        : null,
  });

  let commissionStatus: TrueUpResult["commissionStatus"] = "not_approved";
  if (facts.approved && facts.paidInFull) commissionStatus = "paid";
  else if (facts.approved && collected) commissionStatus = "payable";
  else if (facts.approved) commissionStatus = "approved_awaiting_collection";

  return {
    status,
    costsComplete,
    revenue: trio(estRevenue, actualRevenue),
    material: trio(facts.estimated.materialCents, materialCents),
    labor: trio(facts.estimated.laborCents, laborCents),
    freight: trio(facts.estimated.freightCents, freightCents),
    other: trio(facts.estimated.otherCents, otherCents),
    totalDirect: trio(estCost, actualCost),
    grossProfit: trio(estGp, actualGp),
    marginHundredths: {
      estimated: estMargin,
      actual: actMargin,
      variance: estMargin != null && actMargin != null ? actMargin - estMargin : null,
    },
    actualRevenueCents: actualRevenue,
    actualCostCents: actualCost,
    actualGpCents: actualGp,
    commissionableGpCents: commissionableGp,
    calculatedRateBps: calculatedRate,
    calculatedCommissionCents: calculatedCommission,
    rateBps: rate,
    commissionCents: commission,
    flags,
    canApprove: approveBlockers.length === 0 && !facts.approved,
    approveBlockers,
    collectionSatisfied: collected,
    commissionStatus,
    marginAnalysis,
    salespersonId: facts.snapshotSalespersonId ?? facts.salespersonId,
  };
}

export function marginCauseLines(args: {
  costsComplete: boolean;
  revenueVariance: bigint | null;
  materialImpact: bigint | null;
  laborImpact: bigint | null;
  freightImpact: bigint | null;
  otherImpact: bigint | null;
}): string[] {
  if (!args.costsComplete) return [CAUSE_INCOMPLETE];
  const row = (label: string, cents: bigint | null) =>
    `${label} ${cents == null ? "—" : formatCents(cents)}`;
  return [
    row("Revenue variance", args.revenueVariance),
    row("Material variance", args.materialImpact),
    row("Labor variance", args.laborImpact),
    row("Freight variance", args.freightImpact),
    row("Other variance", args.otherImpact),
  ];
}

export function openBalanceFromInvoices(invoices: JobBalanceInvoiceInput[]): {
  hasCollectibleInvoice: boolean;
  openBalanceCents: bigint;
} {
  const result = computeJobOpenBalance(invoices);
  const active = invoices.some((inv) => inv.status !== "void" && inv.status !== "draft");
  return {
    hasCollectibleInvoice: result.hasInvoice && active,
    openBalanceCents: moneyToCents(result.balance) ?? BigInt(0),
  };
}

export interface LateAdjustment {
  revisedCommissionCents: bigint;
  adjustmentCents: bigint;
  timing: "before_payment" | "carry_forward" | "none";
}

/**
 * Difference between the approved commission and the commission the same
 * formula produces from revised actuals. The approved snapshot is not rewritten.
 * Unpaid: apply before payment. Paid: carry to the next statement.
 */
export function lateCostAdjustment(args: {
  approvedCommissionCents: bigint;
  revisedRevenueCents: bigint;
  revisedGpCents: bigint;
  rateOverrideBps?: bigint | null;
  amountOverrideCents?: bigint | null;
  alreadyPaidCents: bigint;
}): LateAdjustment {
  let revised = BigInt(0);
  if (args.amountOverrideCents != null) {
    revised = args.amountOverrideCents < BigInt(0) ? BigInt(0) : args.amountOverrideCents;
  } else if (args.revisedRevenueCents <= BigInt(0) || args.revisedGpCents <= BigInt(0)) {
    revised = BigInt(0);
  } else if (args.rateOverrideBps != null) {
    revised = commissionFromRate(args.revisedGpCents, args.rateOverrideBps);
  } else {
    revised = commissionAmountCents(args.revisedGpCents, args.revisedRevenueCents);
  }
  const adjustment = revised - args.approvedCommissionCents;
  if (adjustment === BigInt(0)) {
    return { revisedCommissionCents: revised, adjustmentCents: BigInt(0), timing: "none" };
  }
  const timing = args.alreadyPaidCents > BigInt(0) ? "carry_forward" : "before_payment";
  return { revisedCommissionCents: revised, adjustmentCents: adjustment, timing };
}

export function earnedIdempotencyKey(trueUpId: string, version: number): string {
  return `earned:${trueUpId}:v${version}`;
}

export function adjustmentIdempotencyKey(trueUpId: string, fingerprint: string): string {
  return `adjustment:${trueUpId}:${fingerprint}`;
}

export function paymentIdempotencyKey(salespersonId: string, reference: string): string {
  return `payment:${salespersonId}:${reference}`;
}

export interface LedgerRow {
  id: string;
  salespersonId: string;
  jobId: string;
  kind: "earned" | "adjustment" | "payment";
  amountCents: bigint;
  status: "recorded" | "payable" | "paid";
}

export function ledgerRemaining(rows: LedgerRow[]): bigint {
  return rows
    .filter((r) => r.kind !== "payment")
    .reduce((s, r) => s + (r.status === "paid" ? BigInt(0) : r.amountCents), BigInt(0));
}

export function salespersonChangeAllowed(args: {
  approved: boolean;
  role: UserRole | null | undefined;
}): { ok: boolean; message: string } {
  const access = trueUpAccess(args.role);
  if (!args.approved && access.correctSalesperson) {
    return { ok: true, message: "Salesperson can be corrected before approval. The change is audited." };
  }
  if (args.approved && access.overrideCommission) {
    return {
      ok: true,
      message: "After approval the snapshot salesperson stays. An admin correction posts a ledger transfer.",
    };
  }
  if (args.approved) {
    return {
      ok: false,
      message: "Salesperson is frozen on the approved true-up. An administrator must post a commission correction.",
    };
  }
  return { ok: false, message: "Not authorized." };
}

export interface StatementJob {
  jobId: string;
  customer: string;
  completedOn: string | null;
  finalRevenueCents: bigint;
  actualCostCents: bigint;
  gpCents: bigint;
  marginHundredths: bigint | null;
  rateBps: bigint;
  commissionCents: bigint;
  adjustmentCents: bigint;
  paidCents: bigint;
  salespersonId: string;
  status: TrueUpStatus | "approved";
}

export interface StatementTotals {
  jobs: number;
  finalRevenueCents: bigint;
  actualCostCents: bigint;
  gpCents: bigint;
  weightedMarginHundredths: bigint | null;
  commissionEarnedCents: bigint;
  adjustmentCents: bigint;
  paidCents: bigint;
  owedCents: bigint;
}

export function statementTotals(rows: StatementJob[]): StatementTotals {
  const finalRevenueCents = rows.reduce((s, r) => s + r.finalRevenueCents, BigInt(0));
  const actualCostCents = rows.reduce((s, r) => s + r.actualCostCents, BigInt(0));
  const gpCents = rows.reduce((s, r) => s + r.gpCents, BigInt(0));
  const commissionEarnedCents = rows.reduce((s, r) => s + r.commissionCents, BigInt(0));
  const adjustmentCents = rows.reduce((s, r) => s + r.adjustmentCents, BigInt(0));
  const paidCents = rows.reduce((s, r) => s + r.paidCents, BigInt(0));
  return {
    jobs: rows.length,
    finalRevenueCents,
    actualCostCents,
    gpCents,
    weightedMarginHundredths: marginHundredths(gpCents, finalRevenueCents),
    commissionEarnedCents,
    adjustmentCents,
    paidCents,
    owedCents: commissionEarnedCents + adjustmentCents - paidCents,
  };
}

export function pageOf<T>(rows: T[], page: number, pageSize: number): {
  rows: T[];
  page: number;
  pageCount: number;
  total: number;
} {
  const size = Math.max(1, pageSize);
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * size;
  return { rows: rows.slice(start, start + size), page: current, pageCount, total };
}

export interface ProfitJob {
  revenueCents: bigint;
  estimatedCostCents: bigint;
  actualCostCents: bigint;
  estimatedGpCents: bigint;
  actualGpCents: bigint;
  commissionCents: bigint;
}

export function profitTotals(rows: ProfitJob[]): ProfitJob & { netAfterCommissionCents: bigint } {
  const sum = rows.reduce<ProfitJob>(
    (s, r) => ({
      revenueCents: s.revenueCents + r.revenueCents,
      estimatedCostCents: s.estimatedCostCents + r.estimatedCostCents,
      actualCostCents: s.actualCostCents + r.actualCostCents,
      estimatedGpCents: s.estimatedGpCents + r.estimatedGpCents,
      actualGpCents: s.actualGpCents + r.actualGpCents,
      commissionCents: s.commissionCents + r.commissionCents,
    }),
    {
      revenueCents: BigInt(0),
      estimatedCostCents: BigInt(0),
      actualCostCents: BigInt(0),
      estimatedGpCents: BigInt(0),
      actualGpCents: BigInt(0),
      commissionCents: BigInt(0),
    },
  );
  return { ...sum, netAfterCommissionCents: sum.actualGpCents - sum.commissionCents };
}

export function marginBand(hundredths: bigint | null): "under_35" | "35" | "40" | "45" | "50" | "unknown" {
  if (hundredths == null) return "unknown";
  if (hundredths >= BigInt(5000)) return "50";
  if (hundredths >= BigInt(4500)) return "45";
  if (hundredths >= BigInt(4000)) return "40";
  if (hundredths >= BigInt(3500)) return "35";
  return "under_35";
}

export function planFullPayment(args: {
  lines: { id: string; status: string; amountCents: bigint }[];
}): { ok: true; totalCents: bigint } | { ok: false; message: string } {
  if (!args.lines.length) return { ok: false, message: "Select at least one commission line." };
  let total = BigInt(0);
  for (const line of args.lines) {
    if (line.status === "paid") return { ok: false, message: "That commission line is already paid." };
    if (line.status !== "payable") return { ok: false, message: "Only payable lines can be marked paid." };
    total += line.amountCents;
  }
  return { ok: true, totalCents: total };
}

/** Partial dollar payments are intentionally not planned. Each ledger line is paid in full. */
export const PARTIAL_PAYMENT_LIMITATION =
  "This phase pays each commission line in full. A batch can include some lines and leave others for a later statement. Splitting one line into a partial dollar payment is not supported.";

export function approvalRecheckMessage(): string {
  return "Approval recalculates revenue, costs, collection, and commission on the server. Amounts from the browser are not stored.";
}
