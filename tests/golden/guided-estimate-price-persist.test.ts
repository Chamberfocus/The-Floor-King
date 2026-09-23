/**
 * Guided Estimate selling price must survive into Builder.
 * Typed sell is not cost, is not marked up again, and is not stored as $0.
 * A missing price stays PRICE NEEDED.
 */
import { describe, expect, it } from "vitest";
import { PRICE_NEEDED } from "@/lib/catalog-pricing";
import { sellMaterialFromTargetMargin } from "@/lib/estimate-pricing";
import { formatMoney } from "@/lib/format";
import {
  guidedLineSellForSave,
  guidedMaterialPriceLabel,
  hydrateBuilderMaterialRate,
  resolveGuidedProductRates,
  roundTripGuidedMaterialPrice,
} from "@/lib/guided-estimate-price";

const COST = 5;
const DERIVED = Math.round(sellMaterialFromTargetMargin(COST, 40, 0) * 100) / 100;

describe("entered selling price persists into Builder", () => {
  it("keeps the typed sell on the line and in the builder field", () => {
    const trip = roundTripGuidedMaterialPrice({
      enteredSell: "8.50",
      catalogCostInLineUnit: COST,
      costMissing: false,
      derivedSell: DERIVED,
      quantity: 10,
    });
    expect(trip.sell).toBe(8.5);
    expect(trip.hydratedSell).toBe("8.5");
    expect(trip.unresolved).toBe(false);
    expect(trip.sellLocked).toBe(true);
  });

  it("survives save and reload as the same selling price", () => {
    const draft = JSON.parse(
      JSON.stringify({ sellPrice: "8.50", materialRate: 0 }),
    ) as { sellPrice: string; materialRate: number };
    const first = resolveGuidedProductRates({
      catalogCostInLineUnit: 0,
      costMissing: true,
      enteredSell: draft.sellPrice,
      derivedSell: 0,
    });
    const stored = guidedLineSellForSave(
      {
        material_rate: first.material_rate,
        sell_locked: first.sellLocked,
        product_id: "prod-1",
        category: "carpet",
      },
      true,
    );
    const reloaded = hydrateBuilderMaterialRate(stored, first.material_cost, "carpet", 0);
    expect(stored).toBe(8.5);
    expect(reloaded).toBe("8.5");
    expect(Number(reloaded)).toBe(Number(draft.sellPrice));
  });

  it("extends the material amount with the existing qty × sell math", () => {
    const trip = roundTripGuidedMaterialPrice({
      enteredSell: "8.50",
      catalogCostInLineUnit: 0,
      costMissing: true,
      derivedSell: 0,
      quantity: 12,
      wastePct: 0,
    });
    expect(trip.extended).toBe(102);
  });

  it("does not store the typed selling price as cost", () => {
    const trip = roundTripGuidedMaterialPrice({
      enteredSell: "8.50",
      catalogCostInLineUnit: COST,
      costMissing: false,
      derivedSell: DERIVED,
      quantity: 4,
    });
    expect(trip.cost).toBe(COST);
    expect(trip.sell).not.toBe(trip.cost);
    expect(trip.sell).toBe(8.5);
  });

  it("does not mark the typed selling price up again", () => {
    const resolved = resolveGuidedProductRates({
      catalogCostInLineUnit: COST,
      costMissing: false,
      enteredSell: "8.50",
      derivedSell: DERIVED,
    });
    expect(resolved.material_rate).toBe(8.5);
    expect(resolved.material_rate).not.toBe(DERIVED);
  });

  it("does not blank a typed sell when other catalog prices are cleared", () => {
    const kept = guidedLineSellForSave(
      {
        material_rate: 8.5,
        sell_locked: true,
        product_id: "prod-1",
        category: "carpet",
      },
      true,
    );
    const cleared = guidedLineSellForSave(
      {
        material_rate: DERIVED,
        sell_locked: false,
        product_id: "prod-2",
        category: "carpet",
      },
      true,
    );
    expect(kept).toBe(8.5);
    expect(cleared).toBe(0);
  });

  it("shows PRICE NEEDED for an unresolved price instead of $0.00", () => {
    const trip = roundTripGuidedMaterialPrice({
      enteredSell: "",
      catalogCostInLineUnit: 0,
      costMissing: true,
      derivedSell: 0,
      quantity: 20,
    });
    expect(trip.sell).toBe(0);
    expect(trip.hydratedSell).toBe("");
    expect(trip.unresolved).toBe(true);
    const label = guidedMaterialPriceLabel(
      { category: "carpet", material_rate: trip.hydratedSell, material_cost: trip.cost },
      trip.extended,
      formatMoney,
    );
    expect(label).toBe(PRICE_NEEDED);
    expect(label).not.toBe(formatMoney(0));
  });

  it("keeps a catalog-derived sell when the salesperson did not type one", () => {
    const resolved = resolveGuidedProductRates({
      catalogCostInLineUnit: COST,
      costMissing: false,
      enteredSell: "",
      derivedSell: DERIVED,
    });
    expect(resolved.material_rate).toBe(DERIVED);
    expect(resolved.material_cost).toBe(COST);
    expect(resolved.sellLocked).toBe(false);
    expect(resolved.unresolved).toBe(false);
  });
});
