import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/0521_bonness_purge_one_block.sql",
  "utf8",
);

describe("fresh customer start keeping John Bonness orders", () => {
  it("stops when the name is missing and cannot be called from the app", () => {
    expect(sql).toContain("ORDERS_NOT_FOUND");
    expect(sql).toContain("Nothing was deleted.");
    expect(sql).toContain("do $purge$");
    expect(sql).toContain("end\n$purge$;");
    expect(sql).not.toMatch(/\$\$/);
    expect(sql).toContain("public.delete_customer_clean");
  });

  it("keeps Bonness on customers, staff, jobs, and supplier orders", () => {
    expect(sql).toContain("like '%bonness%'");
    expect(sql).toContain("j.assigned_to = any (v_staff)");
    expect(sql).toContain("lower(coalesce(po.supplier, '')) like '%bonness%'");
    expect(sql).toContain("delete from public.orders o");
    expect(sql).toContain("not (o.id = any (v_keep_orders))");
    expect(sql).not.toContain("delete from public.products");
    expect(sql).not.toContain("delete from public.purchase_orders");
    expect(sql).toContain("where role = 'admin'");
  });

  it("names similar customers when Bonness is still missing", () => {
    expect(sql).toContain("like '%bonness%'");
    expect(sql).toContain("Similar names:");
    expect(sql).toContain("BONNESS_HAS_NO_ORDERS");
  });
});
