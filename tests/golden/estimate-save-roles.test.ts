/**
 * Salespeople save the estimates they own. The office writes purchase orders.
 * These checks read the migration and the server actions. They do not connect.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/0500_estimate_line_save_roles.sql",
  "utf8",
);
const estimates = readFileSync("src/app/(app)/estimates/actions.ts", "utf8");
const purchaseOrders = readFileSync(
  "src/app/(app)/purchase-orders/actions.ts",
  "utf8",
);
const customerPage = readFileSync(
  "src/app/(app)/customers/[id]/page.tsx",
  "utf8",
);
const orderPage = readFileSync(
  "src/app/(app)/estimates/[id]/order/page.tsx",
  "utf8",
);

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf("\nexport async function ", start + 10);
  return source.slice(start, next === -1 ? undefined : next);
}

describe("salespeople can save their own estimate lines", () => {
  it("locks the line-save function to office, a sales manager, or the owning salesperson", () => {
    const auth = sql.slice(
      sql.indexOf("if not ("),
      sql.indexOf("raise exception 'not authorized'"),
    );
    expect(auth).toContain("public.is_staff()");
    expect(auth).toContain("public.my_role() = 'sales_manager'");
    expect(auth).toContain("public.mine_option(p_option_id)");
    expect(auth).not.toMatch(/crew|warehouse|scheduler|'customer'/);
    expect(sql).toContain(
      "grant execute on function public.apply_estimate_option_lines(uuid, jsonb, jsonb, uuid[]) to authenticated",
    );
    expect(sql).toContain(
      "revoke all on function public.apply_estimate_option_lines(uuid, jsonb, jsonb, uuid[]) from public, anon",
    );
  });

  it("lets that same salesperson keep a builder draft and read vendor cost", () => {
    expect(sql).toContain("ebd_sales_own");
    expect(sql).toContain("public.mine_estimate(estimate_id)");
    const vendor = sql.slice(sql.indexOf("product_vendors_sales_read"));
    expect(vendor).toContain("for select to authenticated");
    expect(vendor).toContain("public.my_role() in ('sales_manager', 'salesman')");
    expect(vendor).not.toContain("for all");
    expect(vendor).not.toContain("for insert");
  });

  it("tells the salesperson when the save or the new estimate was refused", () => {
    const saveStart = estimates.indexOf("async function applyOptionLinesAtomic");
    expect(saveStart).toBeGreaterThan(-1);
    const save = estimates.slice(
      saveStart,
      estimates.indexOf("\nexport async function ", saveStart),
    );
    expect(save).toContain("not authorized");
    expect(save).toContain("customer assigned to you");
    const create = functionBody(estimates, "createEstimate");
    expect(create).toContain("estimate_error");
    expect(customerPage).toContain("estimate_error");
    expect(customerPage).toContain("estimateError");
  });
});

describe("purchase orders stay with the office", () => {
  it("checks admin and office before a purchase order is created or changed", () => {
    for (const name of [
      "createPOFromEstimate",
      "createPOsFromEstimateSelection",
      "savePurchaseOrder",
      "setPurchaseOrderStatus",
      "createBlankPO",
    ]) {
      expect(functionBody(purchaseOrders, name)).toContain(
        'assertRole(["admin", "office"])',
      );
    }
  });

  it("leaves warehouse receiving on its own client", () => {
    expect(functionBody(purchaseOrders, "applyPoStatus")).not.toContain(
      "assertRole",
    );
  });

  it("shows New PO and Create purchase orders only to the office", () => {
    expect(customerPage).toContain(
      'canCreate={profile.role === "admin" || profile.role === "office"}',
    );
    expect(orderPage).toContain(
      'canOrder={profile.role === "admin" || profile.role === "office"}',
    );
  });
});
