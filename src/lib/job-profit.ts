import {
  lineTotal,
  lineCost,
  optionCostTotals,
  discountAmount,
  num,
  type CalcLine,
} from "@/lib/estimate-calc";
import {
  resolveCommission,
  type CommissionOverrideKind,
} from "@/lib/estimate-commission";
import { computeBillRecovery } from "@/lib/bill-recovery";

/**
 * THE profit calculation. One definition, used by every screen that shows a
 * margin — the live builder, the saved estimate, the invoice, job costing.
 *
 * Direct cost is freighted material plus labor. Gas, the car allowance, and
 * commission are added to the customer bill (see bill-recovery) and are not
 * subtracted here. The salesperson's gas is a share of the fuel charge, not
 * a job cost, so it does not lower the margin.
 */
export interface ProfitInputs {
  /** Freight & fees markup on material cost, as a percent (org settings). */
  freightMarkupPct?: number | string | null;
  /**
   * Gas added to the customer bill (business_settings.job_fuel_charge).
   * `jobProfit` folds this into revenue. `allInProfit` only records it —
   * pass revenue that already includes it.
   */
  fuelCharge?: number | string | null;
  /** Salesperson's share of the gas charge. A payout, not a job cost. */
  fuelFee?: number | string | null;
  /** Fleet upkeep added to the customer bill. Not a job cost. */
  carAllowance?: number | string | null;
  /** Commission percent of the flooring sale, added to the bill. */
  commissionPct?: number | string | null;
  /** Per-estimate manual percent. Ignored when `commissionOverrideAmount` is set. */
  commissionOverridePct?: number | string | null;
  /** Per-estimate manual dollars, added to the bill. */
  commissionOverrideAmount?: number | string | null;
}

export interface ProfitResult {
  subtotal: number;
  discount: number;
  /** Pre-tax, after any estimate-level discount. */
  revenue: number;
  /** Material at cost, already carrying the freight markup. */
  material: number;
  labor: number;
  /** material + labor. */
  cost: number;
  /** Gas added to the bill. */
  fuelCharge: number;
  /** Salesperson's share of that gas. Not subtracted from profit. */
  fuelFee: number;
  carAllowance: number;
  commission: number;
  commissionPct: number;
  /** True when this estimate's commission is a manual override, not org default. */
  commissionOverridden: boolean;
  commissionKind: CommissionOverrideKind;
  /** revenue − direct cost. Gas, car allowance, and commission stay in revenue. */
  profit: number;
  /** profit ÷ revenue, as a percent. Zero revenue ⇒ 0. */
  margin: number;
}

/**
 * All-in profit when revenue is already known (e.g. invoice subtotal) and cost
 * is bare material + labor from the estimate. Freight is applied once here.
 *
 * Use this instead of reimplementing jobProfit's fee/freight math. Do not feed
 * already-freighted material into `materialBare` or freight is double-counted.
 */
export function allInProfit(
  args: {
    revenue: number;
    /** Optional bookkeeping; defaults keep the result shape filled. */
    subtotal?: number;
    discount?: number;
    /** Material cost BEFORE freight markup. */
    materialBare: number;
    labor: number;
  } & ProfitInputs,
): ProfitResult {
  const revenue = Number(args.revenue) || 0;
  const freightMult = 1 + num(args.freightMarkupPct) / 100;
  const material = (Number(args.materialBare) || 0) * freightMult;
  const labor = Number(args.labor) || 0;
  const cost = material + labor;

  const hasRevenue = revenue > 0;
  const fuelCharge = hasRevenue ? num(args.fuelCharge) : 0;
  // Salesperson gas is a share of the fuel charge when that charge is known.
  // It is recorded for the owner and never subtracted from profit.
  const salespersonGas = hasRevenue
    ? fuelCharge > 0
      ? Math.min(Math.max(0, num(args.fuelFee)), fuelCharge)
      : Math.max(0, num(args.fuelFee))
    : 0;
  const carAllowance = hasRevenue ? num(args.carAllowance) : 0;
  const resolved = resolveCommission(revenue, {
    defaultPct: args.commissionPct,
    overridePct: args.commissionOverridePct,
    overrideAmount: args.commissionOverrideAmount,
  });

  const profit = revenue - cost;
  const subtotal = args.subtotal ?? revenue;
  const discount = args.discount ?? 0;

  return {
    subtotal,
    discount,
    revenue,
    material,
    labor,
    cost,
    fuelCharge,
    fuelFee: salespersonGas,
    carAllowance,
    commission: resolved.commission,
    commissionPct: resolved.commissionPct,
    commissionOverridden: resolved.overridden,
    commissionKind: resolved.kind,
    profit,
    margin: revenue > 0 ? (profit / revenue) * 100 : 0,
  };
}

export function jobProfit(
  lines: CalcLine[],
  opts: {
    discountKind?: string | null;
    discountValue?: number | string | null;
  } & ProfitInputs = {},
): ProfitResult {
  const subtotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const discount = discountAmount(subtotal, opts.discountKind, opts.discountValue);
  // A discount is a real price cut, so it comes off before the bill add.
  const base = subtotal - discount;
  const recovery = computeBillRecovery(base, {
    fuelCharge: opts.fuelCharge,
    salespersonGas: opts.fuelFee,
    carAllowance: opts.carAllowance,
    commissionPct: opts.commissionPct,
    commissionOverridePct: opts.commissionOverridePct,
    commissionOverrideAmount: opts.commissionOverrideAmount,
  });

  // optionCostTotals already applies quantity, waste, the flat-line rule, and
  // the labor-line rule. Reusing it is the whole point — a second split here is
  // how the two definitions diverged in the first place.
  const ct = optionCostTotals(lines);
  const result = allInProfit({
    revenue: recovery.customerRevenue,
    subtotal,
    discount,
    materialBare: ct.material,
    labor: ct.labor,
    freightMarkupPct: opts.freightMarkupPct,
    fuelCharge: recovery.fuelCharge,
    fuelFee: recovery.salespersonGas,
    carAllowance: recovery.carAllowance,
    // Lock the memo to the commission that was added on the flooring sale,
    // not a second percent of the already-increased bill.
    commissionOverrideAmount: recovery.commission,
    commissionPct: recovery.commissionPct,
  });
  return {
    ...result,
    commission: recovery.commission,
    commissionPct: recovery.commissionPct,
    commissionOverridden: recovery.commissionOverridden,
    commissionKind: recovery.commissionKind,
  };
}

/**
 * A single line's margin, on the same cost basis as the job (freight included).
 *
 * Gas, car allowance, and commission are added to the job bill, not to a
 * single line, so a line can still read the flooring margin while the job
 * reads the margin on the higher customer total. `marginShortfall` names
 * lines priced under the flooring target.
 */
export function lineMargin(
  line: CalcLine,
  freightMarkupPct?: number | string | null,
): number {
  const sell = lineTotal(line);
  if (sell <= 0) return 0;
  const ct = optionCostTotals([line]);
  const cost = ct.material * (1 + num(freightMarkupPct) / 100) + ct.labor;
  return ((sell - cost) / sell) * 100;
}

/** A line priced below the target, with the dollars that costs. */
export interface OffTargetLine {
  index: number;
  description: string;
  margin: number;
  sell: number;
  /** Extra revenue this line would carry at the target margin. */
  shortfall: number;
}

/**
 * Why the job margin misses the target, line by line.
 *
 * A blended margin below target is usually not a bug — it is one or two lines
 * priced deliberately low, and the app should say which rather than leave the
 * estimator to wonder whether the arithmetic is broken.
 */
export function marginShortfall(
  lines: CalcLine[],
  targetPct: number | string | null | undefined,
  freightMarkupPct?: number | string | null,
): { target: number; offTarget: OffTargetLine[]; totalShortfall: number } {
  const target = num(targetPct);
  const offTarget: OffTargetLine[] = [];
  if (target <= 0 || target >= 100) return { target, offTarget, totalShortfall: 0 };

  lines.forEach((l, index) => {
    const sell = lineTotal(l);
    if (sell <= 0) return;
    const m = lineMargin(l, freightMarkupPct);
    if (m >= target - 0.05) return;
    const ct = optionCostTotals([l]);
    const cost = ct.material * (1 + num(freightMarkupPct) / 100) + ct.labor;
    // What this line would sell for at the target, and the gap it leaves.
    const atTarget = cost / (1 - target / 100);
    offTarget.push({
      index,
      description: String((l as { description?: string }).description ?? "Line"),
      margin: m,
      sell,
      shortfall: atTarget - sell,
    });
  });

  offTarget.sort((a, b) => b.shortfall - a.shortfall);
  return {
    target,
    offTarget,
    totalShortfall: offTarget.reduce((s, l) => s + l.shortfall, 0),
  };
}

/** Kept so callers don't reach past this module for a raw line cost. */
export { lineCost };
