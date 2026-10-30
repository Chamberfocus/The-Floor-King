/**
 * Gas, car allowance, and commission are added to what the customer pays.
 * They are spread across the existing lines so the customer never sees a
 * separate fee, and they are not job costs — they do not reduce margin.
 *
 * Of the gas charge, the salesperson's portion (settings: job_fuel_fee,
 * usually $50) is paid to the salesperson out of that charge. It is not a
 * second deduction and it is not taken off the job cost.
 */
import {
  resolveCommission,
  type CommissionOverrideKind,
} from "@/lib/estimate-commission";

export interface BillRecoverySettings {
  /** What the customer pays for gas (business_settings.job_fuel_charge). */
  fuelCharge?: number | string | null;
  /** Salesperson's share of that gas (business_settings.job_fuel_fee). */
  salespersonGas?: number | string | null;
  /** Fleet upkeep added to the bill (business_settings.job_car_allowance). */
  carAllowance?: number | string | null;
  commissionPct?: number | string | null;
  commissionOverridePct?: number | string | null;
  commissionOverrideAmount?: number | string | null;
}

export interface BillRecovery {
  /** Flooring sell after discount, before gas / car / commission. */
  baseRevenue: number;
  /** Gas added to the bill. */
  fuelCharge: number;
  /**
   * Paid to the salesperson out of the gas charge. Never larger than the
   * charge, and never a cost.
   */
  salespersonGas: number;
  carAllowance: number;
  commission: number;
  commissionPct: number;
  commissionKind: CommissionOverrideKind;
  commissionOverridden: boolean;
  /** fuel + car + commission. */
  added: number;
  /** base + added. Pre-tax customer revenue. */
  customerRevenue: number;
}

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Dollars added on top of the flooring price. Zero when there is nothing to
 * bill yet, so a blank estimate does not grow a fuel charge.
 */
export function computeBillRecovery(
  baseRevenue: number,
  settings: BillRecoverySettings = {},
): BillRecovery {
  const base = Math.max(0, num(baseRevenue));
  if (base <= 0) {
    return {
      baseRevenue: 0,
      fuelCharge: 0,
      salespersonGas: 0,
      carAllowance: 0,
      commission: 0,
      commissionPct: 0,
      commissionKind: "none",
      commissionOverridden: false,
      added: 0,
      customerRevenue: 0,
    };
  }
  const fuelCharge = Math.max(0, num(settings.fuelCharge));
  const salespersonGas = Math.min(
    Math.max(0, num(settings.salespersonGas)),
    fuelCharge,
  );
  const carAllowance = Math.max(0, num(settings.carAllowance));
  const resolved = resolveCommission(base, {
    defaultPct: settings.commissionPct,
    overridePct: settings.commissionOverridePct,
    overrideAmount: settings.commissionOverrideAmount,
  });
  const added = round2(fuelCharge + carAllowance + resolved.commission);
  return {
    baseRevenue: base,
    fuelCharge,
    salespersonGas,
    carAllowance,
    commission: resolved.commission,
    commissionPct: resolved.commissionPct,
    commissionKind: resolved.kind,
    commissionOverridden: resolved.overridden,
    added,
    customerRevenue: round2(base + added),
  };
}

/**
 * Flooring sell that, once gas, car allowance, and commission are added,
 * lands on the customer pre-tax total the salesperson typed.
 */
export function flooringBaseForCustomerTotal(
  customerPretax: number,
  settings: BillRecoverySettings = {},
): number {
  const target = Math.max(0, num(customerPretax));
  const fuel = Math.max(0, num(settings.fuelCharge));
  const car = Math.max(0, num(settings.carAllowance));
  const amount = settings.commissionOverrideAmount;
  const amountSet =
    amount !== null && amount !== undefined && String(amount).trim() !== "";
  if (amountSet) {
    return round2(Math.max(0, target - fuel - car - Math.max(0, num(amount))));
  }
  const pctRaw = settings.commissionOverridePct;
  const pctSet =
    pctRaw !== null && pctRaw !== undefined && String(pctRaw).trim() !== "";
  const pct = Math.max(0, num(pctSet ? pctRaw : settings.commissionPct));
  const rate = pct / 100;
  if (rate >= 1) return round2(Math.max(0, target - fuel - car));
  return round2(Math.max(0, (target - fuel - car) / (1 + rate)));
}

/**
 * Spread extra dollars across line amounts by weight, to the cent.
 * Zero lines stay zero. The shares sum to the extra.
 */
export function spreadRecoveryOntoAmounts(
  amounts: number[],
  extra: number,
): number[] {
  const cents = amounts.map((a) => Math.round((Number(a) || 0) * 100));
  const extraCents = Math.round((Number(extra) || 0) * 100);
  if (extraCents === 0) return cents.map((c) => c / 100);
  const weights = cents.map((c) => Math.max(0, c));
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (weightSum <= 0) {
    if (!cents.length) return [];
    const next = [...cents];
    next[0] += extraCents;
    return next.map((c) => c / 100);
  }
  const shares = weights.map((w) => Math.floor((extraCents * w) / weightSum));
  let used = shares.reduce((s, n) => s + n, 0);
  const order = weights
    .map((w, i) => ({ w, i }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w || a.i - b.i);
  let k = 0;
  while (used < extraCents && order.length) {
    shares[order[k % order.length].i] += 1;
    used += 1;
    k += 1;
  }
  return cents.map((c, i) => (c + (shares[i] ?? 0)) / 100);
}

/**
 * Add buried dollars onto positive extended prices (quantity × rate).
 * A discount line (negative rate) is left alone.
 */
export function buryAddedOnExtendedPrices<
  T extends { quantity: number; rate: number },
>(items: T[], added: number): T[] {
  const extended = items.map((it) => {
    const ext = (Number(it.quantity) || 0) * (Number(it.rate) || 0);
    return ext > 0 ? ext : 0;
  });
  const spread = spreadRecoveryOntoAmounts(extended, added);
  return items.map((it, i) => {
    if (!(extended[i] > 0)) return it;
    const qty = Number(it.quantity) || 0;
    if (!(qty > 0)) return it;
    return { ...it, rate: spread[i] / qty };
  });
}

/**
 * Portion of the job add that belongs on a partial invoice.
 * `fullLineSubtotal` is the approved flooring subtotal; `selectedPositive`
 * is the sum of the positive lines actually being billed.
 */
export function addedShareForSelection(
  fullLineSubtotal: number,
  selectedPositive: number,
  added: number,
): number {
  if (!(added > 0) || !(fullLineSubtotal > 0) || !(selectedPositive > 0)) return 0;
  const share = Math.min(1, selectedPositive / fullLineSubtotal);
  return round2(added * share);
}

export interface PresentedBill {
  lineTotals: number[];
  /** Sum of the lines after the buried add. */
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

/**
 * Customer-facing money. `discount` is the flooring discount (already
 * computed on the pre-add subtotal). The add is buried in the line totals.
 */
export function presentCustomerBill(args: {
  lineTotals: number[];
  discount: number;
  taxRatePct: number | string | null | undefined;
  added: number;
}): PresentedBill {
  const lineTotals = spreadRecoveryOntoAmounts(args.lineTotals, args.added);
  const subtotal = round2(lineTotals.reduce((s, n) => s + n, 0));
  const discount = round2(
    Math.min(Math.max(0, num(args.discount)), Math.max(0, subtotal)),
  );
  const taxable = round2(subtotal - discount);
  const tax = taxable * (num(args.taxRatePct) / 100);
  return { lineTotals, subtotal, discount, tax, total: taxable + tax };
}
