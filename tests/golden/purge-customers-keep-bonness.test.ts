import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/0519_purge_customers_keep_bonness_orders.sql",
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

  it("keeps his client orders and a supplier purchase order, and leaves the catalog", () => {
    expect(sql).toContain("public.name_is_person(o.contact_name, p_name)");
    expect(sql).toContain("public.name_is_person(c.full_name, p_name)");
    expect(sql).toContain("public.name_is_person(po.supplier, p_name)");
    expect(sql).toContain("delete from public.orders");
    expect(sql).toContain("not (id = any (v_keep_orders))");
    expect(sql).not.toContain("delete from public.products");
    expect(sql).not.toContain("delete from public.purchase_orders");
    expect(sql).toContain("p.role = 'customer'");
  });

  it("matches the first and last name as whole words", () => {
    expect(sql).toContain("wanted.parts[1] = any (have.parts)");
    expect(sql).toContain("wanted.parts[cardinality(wanted.parts)] = any (have.parts)");
  });
});
