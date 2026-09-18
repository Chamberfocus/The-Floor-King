import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRICE_NEEDED,
  catalogCostInLineUnit,
  catalogLineSnapshot,
  catalogSellPrice,
  catalogToLineMeasure,
  catalogUnitCost,
  catalogRateInLineUnit,
  formatCatalogPrice,
  hydrateCatalogPricing,
  redactCatalogCost,
  roleMaySeeCatalogCost,
  roleMaySeeCatalogMargin,
  roleMaySeeCatalogSell,
} from "@/lib/catalog-pricing";
import { priceFromMargin } from "@/lib/estimate-calc";
import { sellMaterialFromTargetMargin } from "@/lib/estimate-pricing";
import { formatMoney } from "@/lib/format";
import type { Product } from "@/lib/types";

const ROOT = join(import.meta.dirname, "../..");
const cents = (n: number) => Math.round(n * 100) / 100;

function product(partial: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Shaw Coretec Oak",
    category: "lvp",
    unit: "sqft",
    material_rate: 0,
    labor_rate: 0,
    sku: "SK-1",
    manufacturer: "Shaw",
    style: "Coretec",
    color: "Oak",
    supplier: null,
    supplier_id: null,
    notes: null,
    active: true,
    track_stock: false,
    on_hand: 0,
    reorder_point: 0,
    bin_location: null,
    clearance: false,
    clearance_price: null,
    last_movement_at: null,
    created_at: "",
    updated_at: "",
    ...partial,
  };
}

describe("catalog cost source of truth", () => {
  it("treats default-0 material_rate with no vendor as missing, not a valid $0", () => {
    const c = catalogUnitCost(product({ material_rate: 0, vendors: [] }));
    expect(c.missing).toBe(true);
    expect(c.amount).toBeNull();
    expect(formatCatalogPrice(c, (n) => `$${n}`)).toBe(PRICE_NEEDED);
  });

  it("uses primary vendor cost even when material_rate is 0", () => {
    const c = catalogUnitCost(
      product({
        material_rate: 0,
        vendors: [
          {
            id: "v1",
            product_id: "p1",
            vendor_id: "s1",
            cost: 2.45,
            vendor_sku: null,
            position: 0,
          },
        ],
      }),
    );
    expect(c.missing).toBe(false);
    expect(c.source).toBe("vendor");
    expect(c.amount).toBe(2.45);
  });

  it("falls back to material_rate when no vendor cost is recorded", () => {
    const c = catalogUnitCost(product({ material_rate: 3.5, vendors: [] }));
    expect(c.source).toBe("material_rate");
    expect(c.amount).toBe(3.5);
  });

  it("treats an explicit vendor cost of 0 as a legitimate zero", () => {
    const c = catalogUnitCost(
      product({
        material_rate: 4,
        vendors: [
          {
            id: "v1",
            product_id: "p1",
            vendor_id: "s1",
            cost: 0,
            vendor_sku: null,
            position: 0,
          },
        ],
      }),
    );
    expect(c.missing).toBe(false);
    expect(c.zero).toBe(true);
    expect(c.amount).toBe(0);
    expect(formatCatalogPrice(c, (n) => `$${n.toFixed(2)}`)).toBe("$0.00");
  });

  it("keeps vendor cost distinct from sell", () => {
    const p = product({
      material_rate: 2,
      vendors: [
        {
          id: "v1",
          product_id: "p1",
          vendor_id: "s1",
          cost: 2,
          vendor_sku: null,
          position: 0,
        },
      ],
    });
    const cost = catalogUnitCost(p);
    const sell = catalogSellPrice({ ...p, targetMarginPct: 40, freightMarkupPct: 0 });
    expect(cost.amount).toBe(2);
    expect(sell.amount).toBe(cents(priceFromMargin(2, 40)));
    expect(sell.amount).not.toBe(cost.amount);
  });
});

describe("catalog sell / margin", () => {
  it("computes sell as COST / (1 - margin) with freight on material", () => {
    const sell = catalogSellPrice({
      material_rate: 10,
      targetMarginPct: 40,
      freightMarkupPct: 10,
    });
    expect(sell.missing).toBe(false);
    expect(sell.amount).toBe(cents(sellMaterialFromTargetMargin(10, 40, 10)));
  });

  it("uses clearance sell when flagged", () => {
    const sell = catalogSellPrice({
      material_rate: 10,
      clearance: true,
      clearance_price: 8.88,
      targetMarginPct: 40,
    });
    expect(sell.kind).toBe("clearance");
    expect(sell.amount).toBe(8.88);
  });

  it("does not invent a sell when cost is missing", () => {
    const sell = catalogSellPrice({ material_rate: 0, targetMarginPct: 40 });
    expect(sell.missing).toBe(true);
    expect(sell.amount).toBeNull();
  });
});

describe("unit conversion does not corrupt price", () => {
  it("multiplies per-sq-ft carpet cost by 9 for sq-yd billing", () => {
    const p = product({
      category: "carpet",
      unit: "sqft",
      material_rate: 2,
    });
    const conv = catalogToLineMeasure(p);
    expect(conv.measureUnit).toBe("sqyd");
    expect(conv.factor).toBe(9);
    expect(catalogCostInLineUnit(p).amount).toBe(18);
  });

  it("does not ×9 when the catalog is already per sq yd", () => {
    const p = product({
      category: "carpet",
      unit: "sqyd",
      material_rate: 18,
    });
    expect(catalogToLineMeasure(p).factor).toBe(1);
    expect(catalogCostInLineUnit(p).amount).toBe(18);
  });

  it("does not ×9 when the catalog unit is SY (square yards)", () => {
    const p = product({
      category: "carpet",
      unit: "SY",
      material_rate: 18,
    });
    expect(catalogToLineMeasure(p).factor).toBe(1);
    expect(catalogCostInLineUnit(p).amount).toBe(18);
  });

  it("leaves count units 1:1 (box / each / lnft)", () => {
    const p = product({ category: "other", unit: "box", material_rate: 45.62 });
    expect(catalogToLineMeasure(p).count).toBe(true);
    expect(catalogToLineMeasure(p).factor).toBe(1);
    expect(catalogCostInLineUnit(p).amount).toBe(45.62);
  });

  it("boxed LVP with coverage takeoffs as area, not How many boxes", () => {
    const p = product({
      category: "lvp",
      unit: "box",
      sqft_per_box: 23.64,
      material_rate: 45.62,
    });
    const conv = catalogToLineMeasure(p);
    expect(conv.count).toBe(false);
    expect(conv.lineUnit).toBe("sq ft");
    expect(conv.factor).toBeCloseTo(1 / 23.64, 10);
    expect(catalogCostInLineUnit(p).amount).toBe(cents(45.62 / 23.64));
    expect(catalogRateInLineUnit(45.62, p, false)).toBe(cents(45.62 / 23.64));
    expect(catalogToLineMeasure({ ...p, sqft_per_box: null }).count).toBe(true);
    expect(catalogToLineMeasure({ ...p, sqft_per_box: null }).factor).toBe(1);
    expect(catalogRateInLineUnit(45.62, { ...p, sqft_per_box: null }, false)).toBe(45.62);
    expect(catalogToLineMeasure({ ...p, category: "other" }).count).toBe(true);
    expect(catalogToLineMeasure({ ...p, category: "other" }).factor).toBe(1);
  });
});

describe("ACL / price privacy", () => {
  it("salesman can see sell and catalog cost (quoting), not margin %", () => {
    expect(roleMaySeeCatalogSell("salesman")).toBe(true);
    expect(roleMaySeeCatalogCost("salesman", "sell")).toBe(true);
    expect(roleMaySeeCatalogMargin("salesman")).toBe(false);
  });

  it("admin/office/sales_manager see cost, sell, and margin", () => {
    for (const role of ["admin", "office", "sales_manager"] as const) {
      expect(roleMaySeeCatalogSell(role)).toBe(true);
      expect(roleMaySeeCatalogCost(role)).toBe(true);
      expect(roleMaySeeCatalogMargin(role)).toBe(true);
    }
  });

  it("warehouse sees vendor cost on PO purpose only, never sell/margin", () => {
    expect(roleMaySeeCatalogSell("warehouse")).toBe(false);
    expect(roleMaySeeCatalogCost("warehouse", "sell")).toBe(false);
    expect(roleMaySeeCatalogCost("warehouse", "cost")).toBe(true);
    expect(roleMaySeeCatalogMargin("warehouse")).toBe(false);
  });

  it("crew, scheduler, and customer never see catalog cost/sell/margin", () => {
    for (const role of ["crew", "scheduler", "customer"] as const) {
      expect(roleMaySeeCatalogSell(role)).toBe(false);
      expect(roleMaySeeCatalogCost(role, "sell")).toBe(false);
      expect(roleMaySeeCatalogCost(role, "cost")).toBe(false);
      expect(roleMaySeeCatalogMargin(role)).toBe(false);
    }
  });

  it("redacts cost fields for unauthorized roles", () => {
    const p = product({
      material_rate: 4.5,
      labor_rate: 1,
      catalog_cost: 4.5,
      vendors: [
        {
          id: "v1",
          product_id: "p1",
          vendor_id: "s1",
          cost: 4.5,
          vendor_sku: null,
          position: 0,
        },
      ],
    });
    const redacted = redactCatalogCost(p, "customer");
    expect(redacted.material_rate).toBe(0);
    expect(redacted.catalog_cost).toBeNull();
    expect(redacted.vendors?.[0].cost).toBeNull();
    expect(redactCatalogCost(p, "admin").material_rate).toBe(4.5);
  });
});

describe("hydrate + snapshot integrity", () => {
  it("hydrates catalog_sell from cost at target margin", () => {
    const [h] = hydrateCatalogPricing([product({ material_rate: 5 })], {
      targetMarginPct: 40,
      freightMarkupPct: 0,
    });
    expect(h.catalog_cost).toBe(5);
    expect(h.catalog_sell).toBe(cents(priceFromMargin(5, 40)));
  });

  it("historical estimate line sell is independent of a later master cost", () => {
    const lineSell = 12.5;
    const masterLater = product({ material_rate: 99 });
    expect(lineSell).not.toBe(catalogUnitCost(masterLater).amount);
    expect(lineSell).not.toBe(
      catalogSellPrice({ ...masterLater, targetMarginPct: 40 }).amount,
    );
  });
});

describe("picking a product snapshots sell onto the line", () => {
  it("populates line cost from vendor cost and sell from target margin", () => {
    const p = product({
      material_rate: 0,
      vendors: [
        {
          id: "v1",
          product_id: "p1",
          vendor_id: "s1",
          cost: 2.5,
          vendor_sku: null,
          position: 0,
        },
      ],
    });
    const snap = catalogLineSnapshot(p, {
      targetMarginPct: 40,
      freightMarkupPct: 0,
    });
    expect(snap.missing).toBe(false);
    expect(snap.materialCost).toBe(2.5);
    expect(snap.materialSell).toBe(cents(priceFromMargin(2.5, 40)));
  });

  it("leaves sell empty when catalog cost is missing (PRICE NEEDED)", () => {
    const snap = catalogLineSnapshot(product({ material_rate: 0, vendors: [] }), {
      targetMarginPct: 40,
      freightMarkupPct: 0,
    });
    expect(snap.missing).toBe(true);
    expect(snap.materialCost).toBeNull();
    expect(snap.materialSell).toBeNull();
  });

  it("treats explicit $0 vendor cost as a legitimate zero sell", () => {
    const snap = catalogLineSnapshot(
      product({
        material_rate: 9,
        vendors: [
          {
            id: "v1",
            product_id: "p1",
            vendor_id: "s1",
            cost: 0,
            vendor_sku: null,
            position: 0,
          },
        ],
      }),
      { targetMarginPct: 40, freightMarkupPct: 0 },
    );
    expect(snap.missing).toBe(false);
    expect(snap.materialCost).toBe(0);
    expect(snap.materialSell).toBe(0);
  });
});

describe("PO uses vendor cost, never customer sell", () => {
  it("catalogUnitCost stays the PO/inventory number while sell is higher", () => {
    const p = product({ material_rate: 3, vendors: [] });
    const cost = catalogUnitCost(p).amount;
    const sell = catalogSellPrice({ ...p, targetMarginPct: 40, freightMarkupPct: 0 }).amount;
    expect(cost).toBe(3);
    expect(sell).toBe(cents(priceFromMargin(3, 40)));
    expect(sell).not.toBe(cost);
  });
});

describe("catalog queries never request revoked valuation columns", () => {
  it("CATALOG_PRODUCT_COLUMNS omits avg_unit_cost and carrying_value", () => {
    const src = readFileSync(join(ROOT, "src/lib/data/products.ts"), "utf8");
    expect(src).toMatch(/export const CATALOG_PRODUCT_COLUMNS/);
    expect(src).not.toMatch(/CATALOG_PRODUCT_COLUMNS = \[[^\]]*avg_unit_cost/);
    expect(src).toContain('"material_rate"');
    expect(src).toContain('"clearance_price"');
    expect(src).not.toMatch(/"avg_unit_cost"/);
    expect(src).not.toMatch(/"inventory_carrying_value"/);
  });

  it("products.ts catalog selects do not use select *", () => {
    const src = readFileSync(join(ROOT, "src/lib/data/products.ts"), "utf8");
    expect(src).not.toMatch(/\.select\(\s*"\*"\s*\)/);
  });
});

describe("0187 search_products does not SELECT revoked valuation columns", () => {
  const sql = readFileSync(
    join(ROOT, "supabase/migrations/0187_catalog_search_pricing_columns.sql"),
    "utf8",
  );

  it("rebuilds search_products without select * from products", () => {
    expect(sql).toMatch(/create or replace function public\.search_products/i);
    expect(sql).not.toMatch(/select \*\s+from public\.products/i);
  });

  it("projects avg_unit_cost / carrying_value as null instead of reading them", () => {
    expect(sql).toContain("avg_unit_cost");
    expect(sql).toContain("inventory_carrying_value");
    expect(sql).toMatch(/null::/i);
  });

  it("does not enable accounting", () => {
    expect(sql).not.toMatch(/posting_enabled\s*=\s*true/);
  });
});

describe("money formatting", () => {
  it("never prints $NaN for missing/invalid values", () => {
    expect(formatMoney(undefined)).toBe("$0.00");
    expect(formatMoney(null)).toBe("$0.00");
    expect(formatMoney(Number.NaN)).toBe("$0.00");
    expect(formatMoney("")).toBe("$0.00");
  });

  it("formats a legitimate zero as $0.00, distinct from PRICE NEEDED", () => {
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatCatalogPrice({ amount: 0, missing: false }, formatMoney)).toBe(
      "$0.00",
    );
    expect(formatCatalogPrice({ amount: null, missing: true }, formatMoney)).toBe(
      PRICE_NEEDED,
    );
  });
});
