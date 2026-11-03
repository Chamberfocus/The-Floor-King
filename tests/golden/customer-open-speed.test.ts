import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("opening a customer stays on that customer", () => {
  it("loads the customer file together and does not price every job in the company", () => {
    const page = read("src/app/(app)/customers/[id]/page.tsx");
    expect(page).toContain("await Promise.all([");
    expect(page).toContain("getJobProfitability({ customerId: id })");
    expect(page).not.toContain("await getJobProfitability()");
    expect(page).toContain("placeInStockOrdersOnCustomerInvoices");

    const finance = read("src/lib/data/finance.ts");
    const scoped = finance.slice(
      finance.indexOf("async function loadProfitJobs"),
      finance.indexOf("async function loadProfitPurchases"),
    );
    expect(scoped).toContain('.eq("customer_id", customerId)');
    expect(scoped).toContain("delivery_type.neq.cash_carry");
    expect(finance).toContain("export async function getJobProfitability(scope?: { customerId?: string })");
  });

  it("does not match every unlinked order while one customer is opening", () => {
    const source = read("src/lib/data/order-invoice.ts");
    const fn = source.slice(source.indexOf("export async function placeInStockOrdersOnCustomerInvoices"));
    expect(fn).toContain("if (!onlyCustomerId)");
    expect(fn).toContain('.eq("stock_status", "in_stock")');
    expect(fn).toContain('.is("invoice_id", null)');
  });

  it("reuses one database client and one signed-in profile per request", () => {
    expect(read("src/lib/supabase/server.ts")).toContain("export const createClient = cache(");
    expect(read("src/lib/auth.ts")).toContain("export const getProfile = cache(");
    expect(read("src/lib/auth.ts")).toContain("const user = await getUser()");
    expect(read("src/lib/data/customers.ts")).toContain("export const getCustomer = cache(");
  });
});
