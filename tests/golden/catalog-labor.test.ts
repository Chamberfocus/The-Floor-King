import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapCategory } from "@/lib/catalog-csv";
import { validateRow } from "@/app/(app)/catalog/smart-importer";
import {
  catalogProductCategory,
  CATALOG_PRODUCT_CATEGORIES,
  isCatalogProductCategory,
  isLaborCategory,
} from "@/lib/types";

describe("labor is not a catalog product", () => {
  it("keeps labor off the categories a product may have", () => {
    expect(CATALOG_PRODUCT_CATEGORIES).not.toContain("labor");
    expect(isCatalogProductCategory("lvp")).toBe(true);
    expect(isCatalogProductCategory("other")).toBe(true);
    expect(isCatalogProductCategory("labor")).toBe(false);
    expect(isCatalogProductCategory("Labor")).toBe(false);
    expect(isCatalogProductCategory("")).toBe(false);
    expect(isLaborCategory(" Labor ")).toBe(true);
  });

  it("skips an install row instead of filing it as a product", () => {
    expect(mapCategory("Install labor")).toBe("labor");
    expect(catalogProductCategory("labor")).toBeNull();
    expect(catalogProductCategory(mapCategory("labour"))).toBeNull();
    expect(catalogProductCategory("carpet")).toBe("carpet");
    expect(catalogProductCategory("not-a-real-category")).toBe("other");
    expect(catalogProductCategory("")).toBe("other");
  });

  it("holds a labor price-list row back from import", () => {
    expect(
      validateRow({
        name: "Tear-out",
        category: "labor",
        unit: "sqft",
        sku: null,
        material_rate: 1.25,
        labor_rate: null,
        manufacturer: null,
        style: null,
        color: null,
        notes: null,
      }).level,
    ).toBe("flag");
  });

  it("does not offer labor as a price-list column", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/(app)/catalog/smart-importer.tsx"),
      "utf8",
    );
    expect(src).not.toContain('label: "Labor"');
    expect(src).not.toContain(">Labor<");
    expect(src).toContain('label: "Price"');
    expect(src).toContain(">Price<");
  });
});
