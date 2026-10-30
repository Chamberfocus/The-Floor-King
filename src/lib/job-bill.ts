import { resolveCommission } from "@/lib/estimate-commission";

/**
 * Gas, the car allowance, and commission are added to the customer bill.
 * They are not job costs, so they do not reduce margin.
 *
 * Of the gas charge, `salespersonGas` (Settings → salesperson gas, default $50)
 * is the salesperson's share. It is paid out of the gas on the bill. It is
 * not subtracted from cost or margin.
 */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface JobBillRates {
  /** Dollars added to the customer bill for gas (`job_fuel_charge`). */
  fuelCharge: number;
  /** Salesperson's share of that gas (`job_fuel_fee`). Not a cost. */
  salespersonGas: number;
  /** Dollars added to the customer bill for the vehicle (`job_car_allowance`). */
  carAllowance: number;
  /** Percent of the flooring sale added to the bill (`job_commission_pct`). */
  commissionPct: number;
}

export interface CustomerBill {
  flooringSubtotal: number;
  discount: number;
  /** Flooring price after discount, before the add-ons. Margin uses this. */
  flooringRevenue: number;
  fuelCharge: number;
  salespersonGas: number;
  carAllowance: number;
  commission: number;
  /** fuel + car + commission. Buried in customer line prices. */
  added: number;
  /** Flooring revenue plus the add-ons. */
  preTax: number;
  tax: number;
  total: number;
  /** Displayed line amounts. Same order as the sells passed in. Sum to flooring subtotal + added. */
  lineAmounts: number[];
}

export function jobBillRatesFromSettings(row: {
  job_fuel_charge?: number | string | null;
  job_fuel_fee?: number | string | null;
  job_car_allowance?: number | string | null;
  job_commission_pct?: number | string | null;
} | null | undefined): JobBillRates {
  const n = (v: number | string | null | undefined) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  return {
    fuelCharge: Math.max(0, n(row?.job_fuel_charge)),
    salespersonGas: Math.max(0, n(row?.job_fuel_fee)),
    carAllowance: Math.max(0, n(row?.job_car_allowance)),
    commissionPct: Math.max(0, n(row?.job_commission_pct)),
  };
}

/**
 * Spread `added` across positive sells. Zero sells stay zero.
 * The result sums to (sum of sells) + added, to the cent.
 */
export function spreadBillAddOn(sells: number[], added: number): number[] {
  const base = sells.map((n) => Math.max(0, Number(n) || 0));
  const sum = base.reduce((s, n) => s + n, 0);
  const extra = round2(added);
  if (!(extra > 0) || !(sum > 0)) return base.map(round2);

  const last = base.reduce((idx, n, i) => (n > 0 ? i : idx), -1);
  let remaining = extra;
  return base.map((sell, i) => {
    if (!(sell > 0)) return 0;
    if (i === last) return round2(sell + remaining);
    const share = round2((sell / sum) * extra);
    remaining = round2(remaining - share);
    return round2(sell + share);
  });
}

export function customerBillForLines(args: {
  lineSells: number[];
  discount?: number | null;
  taxRate?: number | string | null;
  rates: JobBillRates;
  commissionOverridePct?: number | string | null;
  commissionOverrideAmount?: number | string | null;
}): CustomerBill {
  const lineSells = args.lineSells.map((n) => Math.max(0, Number(n) || 0));
  const flooringSubtotal = round2(lineSells.reduce((s, n) => s + n, 0));
  const discount = Math.min(flooringSubtotal, Math.max(0, round2(Number(args.discount) || 0)));
  const flooringRevenue = round2(flooringSubtotal - discount);
  const hasSale = flooringRevenue > 0;
  const fuelCharge = hasSale ? round2(args.rates.fuelCharge) : 0;
  const salespersonGas = hasSale
    ? round2(Math.min(args.rates.salespersonGas, fuelCharge))
    : 0;
  const carAllowance = hasSale ? round2(args.rates.carAllowance) : 0;
  const commission = hasSale
    ? round2(
        resolveCommission(flooringRevenue, {
          defaultPct: args.rates.commissionPct,
          overridePct: args.commissionOverridePct,
          overrideAmount: args.commissionOverrideAmount,
        }).commission,
      )
    : 0;
  const added = round2(fuelCharge + carAllowance + commission);
  const lineAmounts = spreadBillAddOn(lineSells, added);
  const preTax = round2(flooringRevenue + added);
  const taxRate = Math.max(0, Number(args.taxRate) || 0);
  const tax = round2(preTax * (taxRate / 100));
  return {
    flooringSubtotal,
    discount,
    flooringRevenue,
    fuelCharge,
    salespersonGas,
    carAllowance,
    commission,
    added,
    preTax,
    tax,
    total: round2(preTax + tax),
    lineAmounts,
  };
}

/** Customer copy. Reads the estimate's manual override without naming it at the call site. */
export function customerBillForEstimate(args: {
  lineSells: number[];
  discount?: number | null;
  taxRate?: number | string | null;
  rates: JobBillRates;
  estimate: {
    commission_override_pct?: number | string | null;
    commission_override_amount?: number | string | null;
  };
}): CustomerBill {
  return customerBillForLines({
    lineSells: args.lineSells,
    discount: args.discount,
    taxRate: args.taxRate,
    rates: args.rates,
    commissionOverridePct: args.estimate.commission_override_pct,
    commissionOverrideAmount: args.estimate.commission_override_amount,
  });
}

/**
 * The flooring price that lands on a customer pre-tax total once gas, the car
 * allowance, and commission have been added on top.
 */
export function flooringPriceForCustomerPreTax(
  customerPreTax: number,
  rates: JobBillRates,
  commission?: { overridePct?: number | string | null; overrideAmount?: number | string | null },
): number {
  const target = round2(customerPreTax);
  const fuel = Math.max(0, rates.fuelCharge);
  const car = Math.max(0, rates.carAllowance);
  const flatCommission = commission?.overrideAmount;
  if (flatCommission != null && String(flatCommission).trim() !== "" && Number.isFinite(Number(flatCommission))) {
    return round2(target - fuel - car - Math.max(0, Number(flatCommission)));
  }
  const pct = Math.max(
    0,
    Number(
      commission?.overridePct != null && String(commission.overridePct).trim() !== ""
        ? commission.overridePct
        : rates.commissionPct,
    ) || 0,
  );
  const denom = 1 + pct / 100;
  return round2((target - fuel - car) / denom);
}

/** Raise positive invoice rows so they include `added`. Discount rows stay put. */
export function buryAddOnInPricedRows<T extends { quantity: number; rate: number }>(
  rows: T[],
  added: number,
): T[] {
  if (!(added > 0) || !rows.length) return rows;
  const amounts = rows.map((r) => {
    const ext = (Number(r.quantity) || 0) * (Number(r.rate) || 0);
    return ext > 0 ? round2(ext) : 0;
  });
  const spread = spreadBillAddOn(amounts, added);
  return rows.map((r, i) => {
    if (!(amounts[i] > 0)) return r;
    const qty = Number(r.quantity) > 0 ? Number(r.quantity) : 1;
    // Six decimals match invoice_items.rate so quantity × rate keeps the cent.
    return { ...r, rate: Math.round((spread[i] / qty) * 1e6) / 1e6 };
  });
}

/**
 * Margin stays on the flooring sale.
 *
 * A new invoice buries gas, the car allowance, and commission in the line
 * prices, so its subtotal is the customer pre-tax bill. An older invoice
 * billed only the flooring sale. Use whichever figure this subtotal is closer
 * to, and when the add-ons are already in the subtotal, take them back out
 * before margin is judged.
 */
export function marginRevenueForInvoice(
  invoiceSubtotal: number,
  flooringRevenue: number,
  customerPreTax: number,
): number {
  const sub = round2(invoiceSubtotal);
  const bare = round2(flooringRevenue);
  const buried = round2(customerPreTax);
  if (!(sub > 0)) return 0;
  if (Math.abs(sub - buried) + 0.001 < Math.abs(sub - bare)) {
    const added = round2(buried - bare);
    const share = buried > 0 ? Math.min(1, sub / buried) : 1;
    return round2(Math.max(0, sub - added * share));
  }
  return sub;
}
