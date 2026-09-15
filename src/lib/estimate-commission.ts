/**
 * Estimate salesperson commission — org default % of pre-tax revenue, with an
 * optional per-estimate manual override (percent OR fixed dollars).
 *
 * Commission is a profitability deduction only. It does not change customer
 * line totals, tax, or invoices. One resolver; every screen that shows
 * commission goes through `resolveCommission` / `jobProfit`.
 */
import { num } from "@/lib/estimate-calc";
import { SALES_ROLES, type UserRole } from "@/lib/types";

export type CommissionOverrideKind = "none" | "percent" | "amount";

export interface CommissionOverride {
  /** Org default percent of pre-tax sale (`business_settings.job_commission_pct`). */
  defaultPct?: number | string | null;
  /** Manual percent override. Ignored when `overrideAmount` is present. */
  overridePct?: number | string | null;
  /** Manual dollar override. Wins over percent. Survives unrelated line edits. */
  overrideAmount?: number | string | null;
}

export interface ResolvedCommission {
  kind: CommissionOverrideKind;
  /** Effective percent (implied from $ / revenue when the override is dollars). */
  commissionPct: number;
  /** Dollar commission deducted from profit. */
  commission: number;
  overridden: boolean;
}

/** True when the stored/typed value is an explicit override, including 0. */
export function isPresentCommissionOverride(
  v: number | string | null | undefined,
): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string" && v.trim() === "") return false;
  const n = num(v);
  return Number.isFinite(n);
}

/**
 * Resolve auto vs manual commission.
 *
 * Precedence: amount override → percent override → org default percent.
 * Zero revenue → $0 (same as the historic allInProfit guard). A $0 / 0%
 * override is preserved as a real override, not treated as "unset".
 */
export function resolveCommission(
  revenue: number,
  args: CommissionOverride,
): ResolvedCommission {
  const hasRev = revenue > 0;
  if (isPresentCommissionOverride(args.overrideAmount)) {
    const commission = hasRev ? num(args.overrideAmount) : 0;
    const commissionPct = revenue > 0 ? (commission / revenue) * 100 : 0;
    return { kind: "amount", commissionPct, commission, overridden: true };
  }
  if (isPresentCommissionOverride(args.overridePct)) {
    const commissionPct = num(args.overridePct);
    const commission = hasRev ? (commissionPct / 100) * revenue : 0;
    return { kind: "percent", commissionPct, commission, overridden: true };
  }
  const commissionPct = num(args.defaultPct);
  const commission = hasRev ? (commissionPct / 100) * revenue : 0;
  return { kind: "none", commissionPct, commission, overridden: false };
}

/** Columns written on save. Amount override nulls percent (one source of truth). */
export function persistCommissionOverride(input: {
  overridePct?: number | string | null;
  overrideAmount?: number | string | null;
}): { pct: number | null; amount: number | null } {
  if (isPresentCommissionOverride(input.overrideAmount)) {
    return { pct: null, amount: num(input.overrideAmount) };
  }
  if (isPresentCommissionOverride(input.overridePct)) {
    return { pct: num(input.overridePct), amount: null };
  }
  return { pct: null, amount: null };
}

export function commissionInputsFromEstimate(
  estimate: {
    commission_override_pct?: number | string | null;
    commission_override_amount?: number | string | null;
  } | null | undefined,
  defaultPct: number | string | null | undefined,
): CommissionOverride {
  return {
    defaultPct,
    overridePct: estimate?.commission_override_pct ?? null,
    overrideAmount: estimate?.commission_override_amount ?? null,
  };
}

/**
 * Who may see or edit salesperson commission. Matches roles already allowed
 * to work estimates (admin / office / sales_manager / salesman). Never
 * customers, installers, warehouse, or scheduler.
 */
export function roleMayViewEstimateCommission(
  role: UserRole | null | undefined,
): boolean {
  return !!role && (SALES_ROLES as readonly string[]).includes(role);
}

export function roleMayEditEstimateCommission(
  role: UserRole | null | undefined,
): boolean {
  return roleMayViewEstimateCommission(role);
}
