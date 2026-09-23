/**
 * Guided Estimate product price → estimate line.
 *
 * Catalog cost and customer sell stay separate. A selling price the
 * salesperson types is the line sell (`material_rate`). It is not written
 * into cost, and it is not run through target-margin a second time.
 * A missing catalog cost with no typed sell stays unresolved — the line
 * must show PRICE NEEDED, not a $0 price.
 */
import { PRICE_NEEDED } from "@/lib/catalog-pricing";
import { lineTotal, type CalcLine } from "@/lib/estimate-calc";

const num = (v: number | string | null | undefined): number => {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const cents = (n: number) => Math.round(n * 100) / 100;

export type GuidedProductRates = {
  /** Customer unit sell. Null when the price is unresolved. */
  material_rate: number | null;
  /** Catalog / vendor cost in the line's billing unit. Never the typed sell. */
  material_cost: number;
  unresolved: boolean;
  /** Typed sell must survive "I'll set prices in the builder". */
  sellLocked: boolean;
};

export function resolveGuidedProductRates(args: {
  /** Catalog cost already converted into the line billing unit. Ignored when missing. */
  catalogCostInLineUnit: number;
  costMissing: boolean;
  /** Raw selling-price input in the line billing unit. Blank = use derived catalog sell. */
  enteredSell: string;
  /** sellMaterialFromTargetMargin(catalog cost). Not applied to a typed sell. */
  derivedSell: number;
}): GuidedProductRates {
  const typed = num(args.enteredSell);
  if (typed > 0) {
    return {
      material_rate: cents(typed),
      material_cost: args.costMissing ? 0 : cents(num(args.catalogCostInLineUnit)),
      unresolved: false,
      sellLocked: true,
    };
  }
  const cost = args.costMissing ? 0 : cents(num(args.catalogCostInLineUnit));
  const derived = args.costMissing ? 0 : cents(num(args.derivedSell));
  if (!args.costMissing && derived > 0) {
    return {
      material_rate: derived,
      material_cost: cost,
      unresolved: false,
      sellLocked: false,
    };
  }
  return {
    material_rate: null,
    material_cost: 0,
    unresolved: true,
    sellLocked: false,
  };
}

/**
 * Sell written onto the estimate. A typed selling price is kept even when
 * the salesperson chooses to blank other catalog prices. Unresolved stays 0
 * in the NOT NULL column; the builder hydrates that as PRICE NEEDED.
 */
export function guidedLineSellForSave(
  line: {
    material_rate: number | null;
    sell_locked?: boolean;
    product_id?: string | null;
    category?: string | null;
  },
  blankCatalogPrices: boolean,
): number {
  if (
    blankCatalogPrices &&
    line.product_id &&
    line.category !== "labor" &&
    !line.sell_locked
  ) {
    return 0;
  }
  return persistGuidedSell(line.material_rate);
}

/** DB material_rate is NOT NULL. Unresolved stores 0; the UI must not call that a price. */
export function persistGuidedSell(rate: number | null | undefined): number {
  const n = num(rate);
  return n > 0 ? cents(n) : 0;
}

export function materialSellUnresolved(line: {
  category?: string | null;
  material_rate?: number | string | null;
  material_cost?: number | string | null;
  labor_rate?: number | string | null;
}): boolean {
  if (line.category === "labor") return false;
  const sell = num(line.material_rate);
  const cost = num(line.material_cost);
  const labor = num(line.labor_rate);
  if (labor > 0 && sell <= 0 && cost <= 0) return false;
  return !(sell > 0) && !(cost > 0);
}

/** Builder field value. Unresolved 0 from the database becomes an empty sell, not "$0.00". */
export function hydrateBuilderMaterialRate(
  materialRate: number | string | null | undefined,
  materialCost: number | string | null | undefined,
  category?: string | null,
  laborRate?: number | string | null,
): string {
  if (
    materialSellUnresolved({
      category,
      material_rate: materialRate,
      material_cost: materialCost,
      labor_rate: laborRate,
    })
  ) {
    return "";
  }
  if (materialRate == null || materialRate === "") return "";
  return String(materialRate);
}

/** Review / Builder line amount. Unresolved is PRICE NEEDED, never formatMoney(0). */
export function guidedMaterialPriceLabel(
  line: {
    category?: string | null;
    material_rate?: number | string | null;
    material_cost?: number | string | null;
    labor_rate?: number | string | null;
  },
  extended: number,
  formatMoney: (n: number) => string,
): string {
  if (materialSellUnresolved(line)) return PRICE_NEEDED;
  return formatMoney(extended);
}

/**
 * Entered sell → stored line → reload → extended amount.
 * Uses the existing lineTotal (qty × sell × waste). Does not reprice from cost.
 */
export function roundTripGuidedMaterialPrice(args: {
  enteredSell: string;
  catalogCostInLineUnit: number;
  costMissing: boolean;
  derivedSell: number;
  quantity: number;
  wastePct?: number;
}): {
  sell: number;
  cost: number;
  hydratedSell: string;
  extended: number;
  unresolved: boolean;
  sellLocked: boolean;
} {
  const resolved = resolveGuidedProductRates(args);
  const sell = persistGuidedSell(resolved.material_rate);
  const cost = resolved.material_cost;
  const hydratedSell = hydrateBuilderMaterialRate(sell, cost, "carpet", 0);
  const calc: CalcLine = {
    line_type: "mat_labor",
    category: "carpet",
    unit: "sq yd",
    measure_unit: "sqyd",
    quantity: args.quantity,
    material_rate: hydratedSell,
    material_cost: cost,
    labor_rate: 0,
    labor_cost: 0,
    waste_pct: args.wastePct ?? 0,
  };
  return {
    sell,
    cost,
    hydratedSell,
    extended: lineTotal(calc),
    unresolved: materialSellUnresolved({
      category: "carpet",
      material_rate: hydratedSell,
      material_cost: cost,
    }),
    sellLocked: resolved.sellLocked,
  };
}
