import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/0520_bonness_orders_by_last_name.sql",
  "utf8",
);

describe("fresh customer start keeping John Bonness orders", () => {
  it("stops when the name is missing and cannot be called from the app", () => {
    expect(sql).toContain("ORDERS_NOT_FOUND");
    expect(sql).toContain("Nothing was deleted.");
    expect(sql).toContain("PURGE_SQL_EDITOR_ONLY");
    expect(sql).toContain(
      "revoke all on function public.purge_customers_keep_named_orders(text) from public, anon, authenticated;",
    );
    expect(sql).toContain("select public.purge_customers_keep_named_orders('John Bonness');");
  });

  it("keeps Bonness on customers, staff, jobs, and supplier orders", () => {
    expect(sql).toContain("public.name_has_bonness(c.full_name)");
    expect(sql).toContain("public.name_has_bonness(p.full_name)");
    expect(sql).toContain("public.name_has_bonness(o.contact_name)");
    expect(sql).toContain("public.name_has_bonness(po.supplier)");
    expect(sql).toContain("j.assigned_to = any (v_staff)");
    expect(sql).toContain("delete from public.orders");
    expect(sql).toContain("not (id = any (v_keep_orders))");
    expect(sql).not.toContain("delete from public.products");
    expect(sql).not.toContain("delete from public.purchase_orders");
    expect(sql).toContain("p.role = 'customer'");
  });

  it("names similar customers when Bonness is still missing", () => {
    expect(sql).toContain("like '%bonness%'");
    expect(sql).toContain("Similar names:");
    expect(sql).toContain("BONNESS_HAS_NO_ORDERS");
  });
});
