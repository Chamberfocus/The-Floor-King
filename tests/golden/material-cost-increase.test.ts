/**
 * One-time 5% material-cost increase. Quotes, labor, and stock already
 * purchased stay at the cost they were written with.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/0496_material_cost_plus_five.sql"),
  "utf8",
);

describe("migration 0496", () => {
  it("raises catalog and vendor material costs by 5% once", () => {
    const guard = sql.indexOf("id = 'material-cost-plus-5'");
    const history = sql.indexOf("insert into public.product_price_history");
    const vendors = sql.indexOf("update public.product_vendors");
    const products = sql.indexOf("update public.products");
    const addons = sql.indexOf("update public.addon_defaults");
    const rooms = sql.indexOf("update public.room_defaults");
    const marker = sql.lastIndexOf("insert into public.catalog_cost_adjustments");

    expect(guard).toBeGreaterThan(-1);
    expect(history).toBeGreaterThan(guard);
    expect(vendors).toBeGreaterThan(history);
    expect(products).toBeGreaterThan(vendors);
    expect(addons).toBeGreaterThan(products);
    expect(rooms).toBeGreaterThan(addons);
    expect(marker).toBeGreaterThan(rooms);

    expect(sql).toContain("round(cost * 1.05, 2)");
    expect(sql).toContain("round(material_rate * 1.05, 2)");
    expect(sql).toContain("round(material_cost * 1.05, 2)");
    expect(sql).toContain("round(src.old_cost * 1.05, 2)");
    expect(sql).toContain("where cost > 0");
    expect(sql).toContain("where material_rate > 0");
    expect(sql).toContain("where labor is not true");
    expect(sql).toContain("where material_cost > 0");
    expect(sql).toContain("1.0500");
    expect(sql).toContain("already applied");
    expect(sql).not.toMatch(/\bbegin\s*;/i);
    expect(sql).not.toMatch(/\bcommit\s*;/i);
    expect(sql).not.toMatch(/\bdrop table\b/i);
    expect(sql).not.toMatch(/\bdelete from\b/i);
    expect(sql).not.toContain("posting_enabled");
  });

  it("does not rewrite labor, clearance prices, inventory value, or saved paperwork", () => {
    expect(sql).not.toMatch(/labor_rate/);
    expect(sql).not.toMatch(/clearance_price/);
    expect(sql).not.toMatch(/avg_unit_cost/);
    expect(sql).not.toMatch(/inventory_carrying_value/);
    expect(sql).not.toMatch(/estimate_line_items/);
    expect(sql).not.toMatch(/purchase_order/);
    expect(sql).not.toMatch(/invoices/);
  });
});
