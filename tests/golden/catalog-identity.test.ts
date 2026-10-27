import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseStructuredRows } from "@/lib/catalog-csv";
import {
  catalogPickerDetail,
  colorNumberFromText,
  foldCatalogColor,
  lineColorFromCatalog,
} from "@/lib/catalog-identity";
import { rankCatalogProducts } from "@/lib/catalog-search";
import { searchCatalogWith } from "@/lib/data/products";

describe("catalog color and style numbers", () => {
  it("keeps a separate color number searchable and leaves the color name alone", () => {
    const folded = foldCatalogColor("Linen", "00712", "23.8 sf/carton");
    expect(folded.color).toBe("Linen");
    expect(folded.notes).toContain("Color # 00712");
    expect(folded.notes).toContain("23.8 sf/carton");
    expect(colorNumberFromText(folded.notes)).toBe("00712");
    expect(foldCatalogColor("Linen", "", null).color).toBe("Linen");
    expect(foldCatalogColor("", "00712", null)).toEqual({ color: "00712", notes: null });
    expect(foldCatalogColor("Linen", "00712", "Color # 00712").notes).toBe("Color # 00712");
  });

  it("parses a price sheet with a style number and a color number", () => {
    const rows = parseStructuredRows(
      [
        "Style Name,Style Number,Color Name,Color Number,Your Cost",
        "Refined Saga II,RS-2044,Linen,00712,8.50",
      ].join("\n"),
    );
    expect(rows).toHaveLength(1);
    expect(rows?.[0].style).toBe("Refined Saga II");
    expect(rows?.[0].sku).toBe("RS-2044");
    expect(rows?.[0].color).toBe("Linen");
    expect(rows?.[0].notes).toContain("Color # 00712");
  });

  it("keeps a plain Color column on the product", () => {
    const rows = parseStructuredRows(
      ["Name,Style,Color,Price", "Saga,RS-2044,Linen,8.50"].join("\n"),
    );
    expect(rows?.[0].color).toBe("Linen");
    expect(rows?.[0].sku).toBe("RS-2044");
    expect(rows?.[0].notes ?? "").not.toContain("Color #");
  });

  it("keeps both a Color column and a Color Number column", () => {
    const rows = parseStructuredRows(
      ["Name,Color,Color Number,Price", "Saga,Linen,00712,12"].join("\n"),
    );
    expect(rows?.[0].color).toBe("Linen");
    expect(rows?.[0].notes).toContain("Color # 00712");
  });

  it("ranks a fragment of the color, the style, the style number, or the color number first", () => {
    const saga = {
      id: "saga",
      name: "Refined Saga II",
      manufacturer: "Mohawk",
      sku: "RS-2044",
      style: "Refined Saga II",
      color: "Linen",
      notes: "Color # 00712",
      category: "carpet",
      active: true,
    };
    const other = {
      id: "other",
      name: "Oak Plank",
      sku: "X-00712",
      style: "Oak Plank",
      color: "Natural",
      category: "lvp",
      active: true,
    };
    const seagull = {
      id: "gull",
      name: "SmartStrand Silk",
      sku: "5T43",
      style: "SmartStrand",
      color: "Seagull",
      category: "carpet",
      active: true,
    };
    expect(rankCatalogProducts([other, saga], "00712")[0].id).toBe("saga");
    expect(rankCatalogProducts([other, saga], "712")[0].id).toBe("saga");
    expect(rankCatalogProducts([other, saga], "2044")[0].id).toBe("saga");
    expect(rankCatalogProducts([other, saga], "RS-2044")[0].id).toBe("saga");
    expect(rankCatalogProducts([other, seagull], "gull")[0].id).toBe("gull");
    expect(rankCatalogProducts([other, seagull], "5T43")[0].id).toBe("gull");
    expect(rankCatalogProducts([other, seagull], "T43")[0].id).toBe("gull");
    expect(rankCatalogProducts([saga, seagull], "linen")[0].id).toBe("saga");
    expect(rankCatalogProducts([other, saga], "refined")[0].id).toBe("saga");
  });

  it("shows the style number and color number on a picker row", () => {
    const detail = catalogPickerDetail({
      name: "Refined Saga II",
      manufacturer: "Mohawk",
      style: "Refined Saga II",
      color: "Linen",
      sku: "RS-2044",
      notes: "Color # 00712",
      categoryLabel: "Carpet",
    });
    expect(detail).toContain("Style # RS-2044");
    expect(detail).toContain("Color # 00712");
    expect(lineColorFromCatalog("Linen", "Color # 00712")).toBe("Linen · #00712");
  });

  it("merges a color-number match the database function did not return", async () => {
    const filters: string[] = [];
    const colorHit = {
      id: "color",
      name: "Refined Saga II",
      sku: "RS-2044",
      style: "Refined Saga II",
      color: "Linen",
      notes: "Color # 00712",
      category: "carpet",
      active: true,
    };
    const decoy = {
      id: "sku",
      name: "Other Carpet",
      sku: "X-00712",
      category: "carpet",
      active: true,
    };
    const productChain: Record<string, unknown> = {};
    const self = () => productChain;
    productChain.select = self;
    productChain.order = self;
    productChain.limit = self;
    productChain.eq = self;
    productChain.in = self;
    productChain.or = (expr: string) => {
      filters.push(expr);
      return productChain;
    };
    productChain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: [colorHit], error: null }).then(resolve);

    const dead: Record<string, unknown> = {};
    const deadSelf = () => dead;
    dead.select = deadSelf;
    dead.eq = deadSelf;
    dead.in = deadSelf;
    dead.order = deadSelf;
    dead.limit = deadSelf;
    dead.or = deadSelf;
    dead.maybeSingle = () => Promise.resolve({ data: null, error: { message: "no" } });
    dead.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, error: { message: "no" } }).then(resolve);

    const rows = await searchCatalogWith(
      {
        rpc() {
          return Promise.resolve({ data: [decoy], error: null });
        },
        from(table: string) {
          return table === "products" ? productChain : dead;
        },
      },
      "00712",
      { limit: 10 },
    );
    expect(filters.some((f) => f.includes("notes.ilike") && f.includes("color.ilike"))).toBe(true);
    expect(filters.some((f) => f.includes("style.ilike") && f.includes("sku.ilike"))).toBe(true);
    expect(rows[0]?.id).toBe("color");
  });

  it("searches notes from SQL without reading revoked cost columns", () => {
    const sql = readFileSync("supabase/migrations/0503_catalog_search_color_number.sql", "utf8");
    expect(sql).toMatch(/coalesce\(p\.notes, ''\)/);
    expect(sql).toMatch(/coalesce\(p\.style, ''\)/);
    expect(sql).toMatch(/coalesce\(p\.color, ''\)/);
    expect(sql).toMatch(/coalesce\(p\.sku, ''\)/);
    expect(sql).toContain("avg_unit_cost");
    expect(sql).toContain("inventory_carrying_value");
    expect(sql).toMatch(/null::/i);
    expect(sql).not.toMatch(/select \*\s+from public\.products/i);
    expect(sql).not.toMatch(/posting_enabled\s*=\s*true/);
    expect(sql).not.toMatch(/generated always/i);
  });

  it("adds a product from the builder without opening the line editor", () => {
    const src = readFileSync("src/app/(app)/estimates/estimate-builder.tsx", "utf8");
    expect(src).toContain("openOnFocus");
    expect(src).toContain("addLine(oi, false, false)");
    expect(src).toContain("Type any part of the color, the style, the style number, or the color number.");
    expect(src).toContain('["Style #", line.item_no]');
  });
});
