import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CatalogPriceRow } from "@/lib/fcb2b";
import { factsTableMissing } from "@/lib/data/supplier-facts";
import {
  factsFromCatalogRow,
  mergeSupplierFact,
  millFactLabel,
  specUrlFromBody,
  stockFromBody,
  storedFactFromRow,
} from "@/lib/supplier-facts";

const root = join(__dirname, "../..");

function catalogRow(overrides: Partial<CatalogPriceRow> = {}): CatalogPriceRow {
  return {
    supplierSku: "2896V",
    description: "Homeward",
    cost: 4.5,
    uom: "sqyd",
    rawUom: "SY",
    priceQualifier: "NET",
    effectiveDate: null,
    rollWidthFt: 12,
    rollLengthFt: 100,
    raw: {
      classifications: { fiber: "nylon" },
      measurements: [{ qualifier: "WD", value: 12, uom: "ft" }],
      manufacturer: "Shaw",
    },
    ...overrides,
  };
}

describe("supplier item facts", () => {
  it("sums every available quantity and normalizes the unit", () => {
    const xml = `
      <Item>
        <QuantityAvailable>10</QuantityAvailable>
        <QuantityAvailable>2.5</QuantityAvailable>
        <UnitOfMeasure>SY</UnitOfMeasure>
      </Item>`;
    expect(stockFromBody(xml)).toEqual({ qty: 12.5, uom: "sqyd" });

    const json = `{"availableQuantity":12,"stockAvailable":"1,003","unitOfMeasure":"sqft"}`;
    expect(stockFromBody(json)).toEqual({ qty: 1015, uom: "sqft" });
  });

  it("keeps an https spec link and drops anything else", () => {
    const body = `
      <Document>
        <ImageUrl>javascript:alert(1)</ImageUrl>
        <SpecUrl>http://mill.example/spec.pdf</SpecUrl>
        <DocumentUrl>https://mill.example/spec.pdf</DocumentUrl>
      </Document>`;
    expect(specUrlFromBody(body)).toBe("https://mill.example/spec.pdf");
    expect(specUrlFromBody(`{"specUrl":"http://mill.example/nope.pdf"}`)).toBeNull();
  });

  it("does not invent a quantity from a price-catalog row", () => {
    const fact = factsFromCatalogRow(catalogRow());
    expect(fact.availableQty).toBeNull();
    expect(fact.availableUom).toBeNull();
    expect(fact.specUrl).toBeNull();
    expect(fact.rollWidthFt).toBe(12);
    expect(fact.rollLengthFt).toBe(100);
    expect(fact.description).toBe("Homeward");
    expect(fact.details).toMatchObject({ manufacturer: "Shaw" });
  });

  it("labels mill quantity ahead of roll size", () => {
    expect(millFactLabel({ availableQty: 40, availableUom: "sqyd", rollWidthFt: 12 })).toBe(
      "Mill has 40 sqyd",
    );
    expect(millFactLabel({ availableQty: null, rollWidthFt: 12, rollLengthFt: 100 })).toBe(
      "Mill roll 12 ft × 100 ft",
    );
    expect(millFactLabel({ rollWidthFt: 12 })).toBe("Mill roll 12 ft wide");
    expect(millFactLabel({})).toBeNull();
  });

  it("does not wipe stored stock or specs when a later catalog row omits them", () => {
    const existing = storedFactFromRow({
      supplier_sku: "2896V",
      available_qty: "12.000",
      available_uom: "sqyd",
      roll_width_ft: "12",
      roll_length_ft: "100",
      description: "Homeward",
      spec_url: "https://mill.example/spec.pdf",
      details: { classifications: { fiber: "nylon" } },
    });
    const merged = mergeSupplierFact(
      existing,
      factsFromCatalogRow(
        catalogRow({
          description: null,
          rollWidthFt: null,
          rollLengthFt: null,
          raw: {},
        }),
      ),
    );
    expect(merged.available_qty).toBe(12);
    expect(merged.available_uom).toBe("sqyd");
    expect(merged.roll_width_ft).toBe(12);
    expect(merged.roll_length_ft).toBe(100);
    expect(merged.description).toBe("Homeward");
    expect(merged.spec_url).toBe("https://mill.example/spec.pdf");
    expect(merged.details).toEqual({ classifications: { fiber: "nylon" } });
  });

  it("treats a reported zero as the new quantity and refuses a non-https spec", () => {
    const existing = storedFactFromRow({
      supplier_sku: "2896V",
      available_qty: 12,
      spec_url: "https://mill.example/spec.pdf",
    });
    const incoming = factsFromCatalogRow(catalogRow());
    const merged = mergeSupplierFact(existing, {
      ...incoming,
      availableQty: 0,
      availableUom: "sy",
      specUrl: "http://evil.example/spec.pdf",
    });
    expect(merged.available_qty).toBe(0);
    expect(merged.available_uom).toBe("sy");
    expect(merged.spec_url).toBe("https://mill.example/spec.pdf");
  });

  it("recognizes a missing facts table without treating every error as that", () => {
    expect(
      factsTableMissing(
        "Could not find the table 'public.supplier_item_facts' in the schema cache",
      ),
    ).toBe(true);
    expect(factsTableMissing("duplicate key value")).toBe(false);
  });

  it("stores mill facts beside the catalog and does not turn posting on", () => {
    const sql = readFileSync(join(root, "supabase/migrations/0506_supplier_item_facts.sql"), "utf8");
    expect(sql).toContain("create table if not exists public.supplier_item_facts");
    expect(sql.toLowerCase()).not.toContain("posting_enabled");
    expect(sql).not.toMatch(/update\s+public\.products/i);
    expect(sql).toContain("products.on_hand");

    const feeds = readFileSync(join(root, "src/lib/data/supplier-feeds.ts"), "utf8");
    expect(feeds).toContain('const INVENTORY_SERVICE = "/inventoryinquiry"');
    expect(feeds).toContain('const DOCUMENT_SERVICE = "/documentservice"');
    const start = feeds.indexOf("export async function refreshSupplierStock");
    const end = feeds.indexOf("/* ---------------------------------------------------------------------------\n * SFTP mailboxes");
    const fn = feeds.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(fn).not.toContain("on_hand");
    expect(fn).not.toContain("material_rate");
    expect(fn).not.toMatch(/from\("products"\)[\s\S]*\.update/);

    const form = readFileSync(
      join(root, "src/app/(app)/settings/suppliers/[id]/connect/connection-form.tsx"),
      "utf8",
    );
    expect(form).toContain("Ask for stock and specs");
    expect(form).toContain("refreshSupplierStockNow");

    const picker = readFileSync(join(root, "src/app/(app)/estimates/product-picker.tsx"), "utf8");
    expect(picker).toMatch(/\$\{p\.on_hand\} \$\{p\.unit\}/);
    expect(picker).toContain("millFactLabel");
  });
});
