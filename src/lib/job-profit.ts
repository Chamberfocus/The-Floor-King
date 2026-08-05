import {
  lineTotal,
  lineCost,
  optionCostTotals,
  discountAmount,
  num,
  type CalcLine,
} from "@/lib/estimate-calc";

/**
 * THE profit calculation. One definition, used by every screen that shows a
 * margin — the live builder, the saved estimate, the invoice, job costing.
 *
 * It exists because there used to be two. The builder computed
 * `(subtotal − cost) / subtotal` off the raw line rates, while the estimate page
 * subtracted the discount, marked material up by freight, and took out sales
 * gas, the car allowance, and commission. The same job showed two different
 * margins depending which screen you were on — and the one you saw WHILE
 * PRICING was the optimistic one, which is the worst possible place to be wrong.
 *
 * Every deduction below is real money that leaves before the profit is yours,
 * so every one belongs in the margin an estimator is looking at.
 */
export interface ProfitInputs {
  /** Freight & fees markup on material cost, as a percent (org settings). */
  freightMarkupPct?: number | string | null;
  /** Salesperson's gas for the job (business settings). */
  fuelFee?: number | string | null;
  /** Fleet upkeep per job (business settings). */
  carAllowance?: number | string | null;
  /** Internal commission, as a percent of the sale (business settings). */
  commissionPct?: number | string | null;
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
  fuelFee: number;
  carAllowance: number;
  commission: number;
  commissionPct: number;
  /** revenue − cost − gas − car − commission. */
  profit: number;
  /** profit ÷ revenue, as a percent. Zero revenue ⇒ 0. */
  margin: number;
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
  // A discount is a real price cut, so it comes off before margin is judged.
  const revenue = subtotal - discount;

  // optionCostTotals already applies quantity, waste, the flat-line rule, and
  // the labor-line rule. Reusing it is the whole point — a second split here is
  // how the two definitions diverged in the first place.
  const ct = optionCostTotals(lines);
  const freightMult = 1 + num(opts.freightMarkupPct) / 100;
  const material = ct.material * freightMult;
  const cost = material + ct.labor;

  // These only apply once there is a sale to take them out of.
  const hasRevenue = revenue > 0;
  const fuelFee = hasRevenue ? num(opts.fuelFee) : 0;
  const carAllowance = hasRevenue ? num(opts.carAllowance) : 0;
  const commissionPct = num(opts.commissionPct);
  const commission = hasRevenue ? (commissionPct / 100) * revenue : 0;

  const profit = revenue - cost - fuelFee - carAllowance - commission;

  return {
    subtotal,
    discount,
    revenue,
    material,
    labor: ct.labor,
    cost,
    fuelFee,
    carAllowance,
    commission,
    commissionPct,
    profit,
    margin: revenue > 0 ? (profit / revenue) * 100 : 0,
  };
}

/**
 * A single line's margin, on the same cost basis as the job (freight included).
 *
 * Job-level deductions — gas, car allowance, commission — are deliberately NOT
 * spread across lines: any split would be invented. So a line can read 40% while
 * the job reads 34%, and both are right. `marginShortfall` below explains the
 * difference rather than leaving it to look like a contradiction.
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
