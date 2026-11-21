/**
 * Price-book logins sell with the catalog formula and never return cost.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalogSellPrice } from "@/lib/catalog-pricing";
import { buyerPriceRow, buyerQueryMatches, buyerSellPrice, customerHome } from "@/lib/buyer-price";

const sql = readFileSync("supabase/migrations/0513_price_book_access.sql", "utf8");
const list = readFileSync("src/app/price-book/price-list.tsx", "utf8");
const page = readFileSync("src/app/price-book/page.tsx", "utf8");
const actions = readFileSync("src/app/(app)/settings/price-book/actions.ts", "utf8");
const loader = readFileSync("src/lib/data/price-book.ts", "utf8");

describe("buyer sell price", () => {
  it("matches the catalog: cost / (1 − margin), freight landed first", () => {
    const cases = [
      { material_rate: 6.89, marginPct: 40, freightMarkupPct: 0, sell: 11.48 },
      { material_rate: 6.89, marginPct: 40, freightMarkupPct: 10, sell: 12.63 },
      { material_rate: 6, marginPct: 40, freightMarkupPct: 0, sell: 10 },
      { material_rate: 10, marginPct: 25, freightMarkupPct: 0, sell: 13.33 },
      { material_rate: 10, marginPct: 0, freightMarkupPct: 0, sell: 10 },
    ];
    for (const row of cases) {
      expect(buyerSellPrice(row)).toBe(row.sell);
      expect(
        catalogSellPrice({
          material_rate: row.material_rate,
          clearance: false,
          clearance_price: 1,
          targetMarginPct: row.marginPct,
          freightMarkupPct: row.freightMarkupPct,
        }).amount,
      ).toBe(row.sell);
    }
  });

  it("uses the vendor cost, not the catalog rate, and ignores clearance", () => {
    const vendors = [
      {
        id: "v",
        product_id: "p",
        vendor_id: "s",
        cost: 5,
        vendor_sku: null,
        position: 0,
      },
    ];
    expect(
      buyerSellPrice({
        material_rate: 6.89,
        vendors,
        marginPct: 40,
        freightMarkupPct: 0,
      }),
    ).toBe(8.33);
  });

  it("returns no price when the cost or the margin is unusable", () => {
    expect(buyerSellPrice({ material_rate: 0, marginPct: 40 })).toBeNull();
    expect(buyerSellPrice({ material_rate: 6.89, marginPct: 100 })).toBeNull();
    expect(buyerSellPrice({ material_rate: 6.89, marginPct: -1 })).toBeNull();
    expect(
      buyerPriceRow(
        { id: "labor", name: "Install", category: "labor", labor_rate: 4, material_rate: 0 },
        40,
        0,
      ),
    ).toBeNull();
  });

  it("sends the sell price only", () => {
    const row = buyerPriceRow(
      {
        id: "oak",
        name: "Oak",
        category: "hardwood",
        unit: "sqft",
        sku: "OAK-1",
        manufacturer: "LW Flooring",
        style: "Select",
        color: "Natural",
        material_rate: 6.89,
        labor_rate: 3.25,
      },
      40,
      10,
    );
    expect(row?.sell).toBe(12.63);
    const payload = JSON.stringify(row);
    expect(payload).not.toContain("6.89");
    expect(payload).not.toContain("7.58");
    expect(payload).not.toContain("3.25");
    expect(payload).not.toContain("material_rate");
    expect(payload).not.toContain("margin");
    expect(Object.keys(row ?? {}).sort()).toEqual(
      ["category", "color", "id", "manufacturer", "name", "sell", "sku", "style", "unit"].sort(),
    );
  });

  it("finds Primrose when the search is typed Primose, including a note", () => {
    expect(buyerQueryMatches({ name: "State Crest", color: "Primrose" }, "primose")).toBe(true);
    expect(buyerQueryMatches({ name: "State Crest", color: "Primose" }, "primose")).toBe(true);
    expect(
      buyerQueryMatches({ name: "State Crest", notes: "Color Primrose" }, "primose"),
    ).toBe(true);
    expect(buyerQueryMatches({ name: "State Crest", color: "Sand" }, "primose")).toBe(false);
    const hidden = buyerPriceRow(
      { id: "p", name: "State Crest", color: "Primrose", material_rate: 4.25 },
      40,
      0,
    );
    expect(hidden?.sell).toBe(7.08);
    expect(JSON.stringify(hidden)).not.toContain("4.25");
    expect(JSON.stringify(hidden)).not.toContain("material_rate");
  });

  it("keeps a price-book account out of the customer portal", () => {
    expect(customerHome(null)).toBe("/portal");
    expect(customerHome({ active: true })).toBe("/price-book");
    expect(customerHome({ active: false })).toBe("/price-book");
  });
});

describe("price-book access stays off the customer login", () => {
  it("stores the margin where the login cannot read it", () => {
    expect(sql).toContain("create table if not exists public.price_book_access");
    expect(sql).toContain("constraint price_book_margin_range check (margin_pct >= 0 and margin_pct < 100)");
    expect(sql).toContain("revoke all on public.price_book_access from public, anon, authenticated");
    expect(sql).toContain("security definer");
    expect(sql).not.toMatch(/grant select on public\.price_book_access to authenticated/i);
  });

  it("closes the open reads a signed-in customer could use", () => {
    for (const policy of [
      "ls_read",
      "lsd_read",
      "cancel_reasons_read",
      "appointment_types_read",
      "showroom_settings_read",
      "eq_read",
      "qq_read",
      "workflow_stages_read",
      "handoffs_mine",
    ]) {
      expect(sql).toContain(`drop policy if exists ${policy}`);
      expect(sql).toContain("not public.is_price_book_viewer()");
    }
    expect(sql).toContain("to_user = auth.uid() or from_user = auth.uid()");
  });

  it("creates a customer login and never renders cost on the price book", () => {
    expect(actions).toContain('role: "customer"');
    expect(list).not.toContain("material_rate");
    expect(list).not.toContain("margin");
    expect(page).not.toContain("material_rate");
    expect(loader).toContain("buyerPriceRow");
    expect(loader).toContain("search_products");
    expect(loader).toContain("buyerQueryMatches");
    expect(page).toContain('searchParams');
    expect(readFileSync("src/lib/price-book.ts", "utf8")).toContain("subfloorSheetCost");
  });
});
