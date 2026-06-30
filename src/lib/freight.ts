// Pure freight helpers — safe to use on the client.
import type { Supplier } from "@/lib/types";

/**
 * The single global "Freight & fees" model: catalog prices are bare material
 * cost; one markup % covers freight, fuel, drop fees and handling on average.
 * Applied to MATERIAL cost only (never labor) wherever a true/landed cost is
 * needed — margins, job profit, Business Pulse, the catalog display.
 */
export function freightMultiplier(pct: number | null | undefined): number {
  const p = Number(pct) || 0;
  return 1 + p / 100;
}

/** Base material cost → landed material cost (base × freight multiplier). */
export function landedMaterialCost(
  baseCost: number,
  pct: number | null | undefined,
): number {
  return Math.round(baseCost * freightMultiplier(pct) * 100) / 100;
}

/**
 * Freight % for a product's manufacturer. Matches the supplier whose name is
 * contained in (or equals) the manufacturer text — longest match wins, so
 * "Shaw Resilient T&P" still maps to the "Shaw" supplier.
 */
export function freightPctForManufacturer(
  manufacturer: string | null | undefined,
  suppliers: Supplier[],
): number {
  const m = (manufacturer ?? "").toLowerCase().trim();
  if (!m) return 0;
  let best: Supplier | null = null;
  for (const s of suppliers) {
    const name = s.name.toLowerCase().trim();
    if (!name) continue;
    if (m.includes(name) || name.includes(m)) {
      if (!best || s.name.length > best.name.length) best = s;
    }
  }
  return best?.freight_pct ?? 0;
}

/**
 * Landed material cost = product cost × (1 + freight% + fuel%).
 * Freight is matched per supplier; fuel is the global surcharge.
 */
export function landedCost(
  productCost: number,
  manufacturer: string | null | undefined,
  suppliers: Supplier[],
  fuelPct: number,
): number {
  const freight = freightPctForManufacturer(manufacturer, suppliers);
  const mult = 1 + (freight + (fuelPct || 0)) / 100;
  return Math.round(productCost * mult * 100) / 100;
}
