/**
 * Customer list contract — one row per customers.id.
 * Pure helpers only. No production mutation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCustomerListActivity,
  customerMatchesSearch,
  findPossibleDuplicateCustomerRecords,
  formatCustomerActivityLine,
  indexCustomerListActivity,
  paginateByCustomerId,
  relatedCustomerIdsForSearch,
  salesmanMaySeeCustomer,
  uniqueCustomersById,
  uniqueIds,
  type CustomerListEstimate,
  type CustomerListIdentity,
  type CustomerListInvoice,
  type CustomerListJob,
  type CustomerListOrder,
} from "@/lib/customer-list";
import { computeJobOpenBalance, invoiceTotals } from "@/lib/invoice-calc";

const ROOT = join(import.meta.dirname, "../..");

function job(
  partial: Partial<CustomerListJob> & Pick<CustomerListJob, "id" | "customer_id">,
): CustomerListJob {
  return {
    status: "scheduled",
    delivery_type: "deliver",
    title: "Kitchen",
    ...partial,
  };
}

function invoice(
  partial: Partial<CustomerListInvoice> &
    Pick<CustomerListInvoice, "id" | "customer_id">,
): CustomerListInvoice {
  return {
    status: "sent",
    tax_rate: 0,
    items: [{ quantity: 1, rate: 1000 }],
    payments: [],
    counter_sale: false,
    ...partial,
  };
}

describe("customer list — one row per customer.id", () => {
  it("CASE 1: customer with 1 job → 1 list row, job_count 1", () => {
    const customers = uniqueCustomersById([
      { id: "A", full_name: "Ann" },
      { id: "A", full_name: "Ann" },
    ]);
    expect(customers).toHaveLength(1);
    const act = buildCustomerListActivity(
      "A",
      [job({ id: "j1", customer_id: "A" })],
      [],
      [],
    );
    expect(act.totalJobs).toBe(1);
    expect(act.openJobs).toBe(1);
  });

  it("CASE 2: customer with 5 jobs → 1 list row, job_count 5", () => {
    const jobs = [1, 2, 3, 4, 5].map((n) =>
      job({
        id: `j${n}`,
        customer_id: "B",
        title: `Room ${n}`,
        status: n <= 2 ? "scheduled" : "completed",
      }),
    );
    const rows = uniqueCustomersById([{ id: "B", full_name: "Bea" }]);
    expect(rows).toHaveLength(1);
    const act = buildCustomerListActivity("B", jobs, [], []);
    expect(act.totalJobs).toBe(5);
    expect(act.openJobs).toBe(2);
    expect(act.completedJobs).toBe(3);
    expect(formatCustomerActivityLine(act)).toContain("5 Jobs");
    expect(formatCustomerActivityLine(act)).toContain("2 Open");
  });

  it("CASE 3: 2 install jobs + 3 cash-and-carry → 1 row, counts split", () => {
    const jobs: CustomerListJob[] = [
      job({ id: "j1", customer_id: "C", title: "Kitchen" }),
      job({ id: "j2", customer_id: "C", title: "Basement", status: "completed" }),
      job({
        id: "cc1",
        customer_id: "C",
        delivery_type: "cash_carry",
        title: "COREtec",
      }),
    ];
    const invoices: CustomerListInvoice[] = [
      invoice({
        id: "cs1",
        customer_id: "C",
        counter_sale: true,
        job_id: null,
        items: [{ quantity: 1, rate: 80 }],
        status: "paid",
      }),
    ];
    const orders: CustomerListOrder[] = [
      {
        id: "o1",
        customer_id: "C",
        status: "submitted",
        job_id: null,
      },
    ];
    expect(uniqueCustomersById([{ id: "C", full_name: "Cara" }])).toHaveLength(
      1,
    );
    const act = buildCustomerListActivity("C", jobs, [], invoices, orders);
    expect(act.totalJobs).toBe(2);
    expect(act.cashAndCarryCount).toBe(3);
    expect(formatCustomerActivityLine(act)).toContain("2 Jobs");
    expect(formatCustomerActivityLine(act)).toContain("Cash & Carry");
  });

  it("CASE 3b: approved order that already created a cash_carry job is not double-counted", () => {
    const jobs = [
      job({
        id: "cc-job",
        customer_id: "C",
        delivery_type: "cash_carry",
      }),
    ];
    const orders: CustomerListOrder[] = [
      { id: "o1", customer_id: "C", status: "approved", job_id: "cc-job" },
    ];
    const invoices = [
      invoice({
        id: "i1",
        customer_id: "C",
        job_id: "cc-job",
        counter_sale: true,
        status: "paid",
      }),
    ];
    const act = buildCustomerListActivity("C", jobs, [], invoices, orders);
    expect(act.cashAndCarryCount).toBe(1);
    expect(act.totalJobs).toBe(0);
  });

  it("CASE 4: many estimates/invoices/payments → 1 row, money not multiplied", () => {
    const jobs = [
      job({ id: "j1", customer_id: "D" }),
      job({ id: "j2", customer_id: "D" }),
    ];
    const estimates: CustomerListEstimate[] = [
      { id: "e1", customer_id: "D" },
      { id: "e2", customer_id: "D" },
      { id: "e3", customer_id: "D" },
    ];
    const invoices: CustomerListInvoice[] = [
      invoice({
        id: "i1",
        customer_id: "D",
        job_id: "j1",
        items: [{ quantity: 1, rate: 1000 }],
        payments: [{ amount: 200, status: "active" }],
      }),
      invoice({
        id: "i2",
        customer_id: "D",
        job_id: "j1",
        items: [{ quantity: 1, rate: 500 }],
        payments: [{ amount: 500, status: "active" }],
        status: "paid",
      }),
      invoice({
        id: "i3",
        customer_id: "D",
        job_id: "j2",
        items: [{ quantity: 1, rate: 300 }],
        payments: [{ amount: 50, status: "active" }],
      }),
    ];
    const act = buildCustomerListActivity("D", jobs, estimates, invoices);
    expect(act.totalJobs).toBe(2);
    expect(act.estimateCount).toBe(3);
    expect(act.invoiceCount).toBe(3);

    const expectedSales =
      invoiceTotals([{ quantity: 1, rate: 1000 }], 0).total +
      invoiceTotals([{ quantity: 1, rate: 500 }], 0).total +
      invoiceTotals([{ quantity: 1, rate: 300 }], 0).total;
    expect(act.lifetimeSales).toBe(expectedSales);

    const expectedOpen = computeJobOpenBalance(invoices).balance;
    expect(act.openBalance).toBe(expectedOpen);
    // 2 jobs × 3 invoices must NOT become 6 × $1000.
    expect(act.lifetimeSales).not.toBe(expectedSales * 2);
    expect(act.openBalance).toBe(800 + 250);
  });

  it("CASE 4b: void invoices and void payments do not inflate totals", () => {
    const invoices: CustomerListInvoice[] = [
      invoice({
        id: "live",
        customer_id: "D",
        items: [{ quantity: 1, rate: 100 }],
        payments: [{ amount: 10, status: "active" }],
      }),
      invoice({
        id: "voided",
        customer_id: "D",
        status: "void",
        items: [{ quantity: 1, rate: 9999 }],
        payments: [{ amount: 9999, status: "active" }],
      }),
      invoice({
        id: "void-pay",
        customer_id: "D",
        items: [{ quantity: 1, rate: 50 }],
        payments: [{ amount: 50, status: "void" }],
      }),
    ];
    const act = buildCustomerListActivity("D", [], [], invoices);
    expect(act.invoiceCount).toBe(2);
    expect(act.lifetimeSales).toBe(150);
    expect(act.openBalance).toBe(140);
  });

  it("CASE 5: two different customer ids with the same last name stay two rows", () => {
    const rows = uniqueCustomersById([
      { id: "s1", full_name: "John Smith" },
      { id: "s2", full_name: "John Smith" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual(["s1", "s2"]);
    expect(
      customerMatchesSearch(
        { id: "s1", full_name: "John Smith" },
        "Smith",
      ),
    ).toBe(true);
    expect(
      customerMatchesSearch(
        { id: "s2", full_name: "Jane Smith" },
        "Smith",
      ),
    ).toBe(true);
  });

  it("CASE 6: same customer found through multiple job matches still once", () => {
    const jobs = [
      job({ id: "j1", customer_id: "E", title: "Kitchen" }),
      job({ id: "j2", customer_id: "E", title: "Kitchen extra" }),
      job({ id: "j3", customer_id: "E", site_street: "Kitchen Ave" }),
    ];
    const related = relatedCustomerIdsForSearch("Kitchen", jobs, []);
    expect(uniqueIds(related)).toEqual(["E"]);
    const listed = uniqueCustomersById([
      { id: "E", full_name: "Eve" },
      { id: "E", full_name: "Eve" },
    ]);
    expect(listed).toHaveLength(1);
  });

  it("CASE 7: pagination counts customer ids, not job rows", () => {
    const customers = Array.from({ length: 100 }, (_, i) => ({
      id: `c${i}`,
      full_name: `Cust ${i}`,
    }));
    // 100 customers, 250 jobs — page size 20 must page customers.
    const page1 = paginateByCustomerId(customers, 1, 20);
    expect(page1.total).toBe(100);
    expect(page1.rows).toHaveLength(20);
    expect(page1.rows[0].id).toBe("c0");
    const page5 = paginateByCustomerId(customers, 5, 20);
    expect(page5.rows).toHaveLength(20);
    expect(page5.rows[0].id).toBe("c80");
    const exploded = customers.flatMap((c) => [
      c,
      { ...c },
      { ...c },
    ]);
    const paged = paginateByCustomerId(exploded, 1, 10);
    expect(paged.total).toBe(100);
    expect(paged.rows).toHaveLength(10);
  });

  it("CASE 8: salesman only sees assigned / workflow-owned customers", () => {
    const mine: CustomerListIdentity = {
      id: "m1",
      full_name: "Mine",
      assigned_to: "sales-1",
    };
    const owned: CustomerListIdentity = {
      id: "m2",
      full_name: "Owned",
      workflow_owner_id: "sales-1",
    };
    const other: CustomerListIdentity = {
      id: "m3",
      full_name: "Other",
      assigned_to: "sales-2",
    };
    expect(salesmanMaySeeCustomer(mine, "sales-1")).toBe(true);
    expect(salesmanMaySeeCustomer(owned, "sales-1")).toBe(true);
    expect(salesmanMaySeeCustomer(other, "sales-1")).toBe(false);
  });
});

describe("customer list search", () => {
  const c: CustomerListIdentity = {
    id: "x",
    full_name: "Pat Lee",
    company: "Lee Floors",
    phone: "216-555-1212",
    email: "pat@example.com",
    street: "123 Main St",
    city: "Cleveland",
    zip: "44111",
  };

  it("matches name, company, phone, email, address", () => {
    expect(customerMatchesSearch(c, "Pat")).toBe(true);
    expect(customerMatchesSearch(c, "Lee Floors")).toBe(true);
    expect(customerMatchesSearch(c, "555-1212")).toBe(true);
    expect(customerMatchesSearch(c, "pat@example")).toBe(true);
    expect(customerMatchesSearch(c, "123 Main")).toBe(true);
    expect(customerMatchesSearch(c, "Cleveland")).toBe(true);
    expect(customerMatchesSearch(c, "44111")).toBe(true);
    expect(customerMatchesSearch(c, "nobody")).toBe(false);
  });

  it("job-number/address related hit still returns the customer once", () => {
    const jobs = [
      job({
        id: "WO-99",
        customer_id: "x",
        title: "WO-99 basement",
        site_street: "999 Side St",
      }),
    ];
    const related = relatedCustomerIdsForSearch("WO-99", jobs, [
      { customer_id: "x", number: "INV-12" },
    ]);
    expect(related).toEqual(["x"]);
    expect(customerMatchesSearch(c, "WO-99", related)).toBe(true);
    expect(customerMatchesSearch(c, "INV-12", relatedCustomerIdsForSearch("INV-12", [], [{ customer_id: "x", number: "INV-12" }]))).toBe(true);
  });
});

describe("customer list activity index has no join fan-out", () => {
  it("indexes each customer independently", () => {
    const jobs = [
      job({ id: "j1", customer_id: "A" }),
      job({ id: "j2", customer_id: "B" }),
      job({ id: "j3", customer_id: "B" }),
    ];
    const invoices = [
      invoice({ id: "i1", customer_id: "A", items: [{ quantity: 1, rate: 10 }] }),
      invoice({ id: "i2", customer_id: "B", items: [{ quantity: 1, rate: 20 }] }),
      invoice({ id: "i3", customer_id: "B", items: [{ quantity: 1, rate: 30 }] }),
    ];
    const map = indexCustomerListActivity(
      ["A", "B", "B", "A"],
      jobs,
      [],
      invoices,
    );
    expect(Object.keys(map).sort()).toEqual(["A", "B"]);
    expect(map.A.totalJobs).toBe(1);
    expect(map.B.totalJobs).toBe(2);
    expect(map.A.lifetimeSales).toBe(10);
    expect(map.B.lifetimeSales).toBe(50);
  });
});

describe("possible real duplicate records — informational only", () => {
  it("groups exact phone / email / name+address; does not merge by name alone", () => {
    const people: CustomerListIdentity[] = [
      {
        id: "1",
        full_name: "Sam Jones",
        phone: "(216) 555-0001",
        email: "a@x.com",
        street: "1 Oak",
        city: "Cleveland",
        state: "OH",
        zip: "44111",
      },
      {
        id: "2",
        full_name: "Samuel Jones",
        phone: "2165550001",
        email: "other@x.com",
      },
      {
        id: "3",
        full_name: "Sam Jones",
        email: "A@x.com",
        street: "9 Pine",
      },
      {
        id: "4",
        full_name: "Sam Jones",
        street: "1 Oak",
        city: "Cleveland",
        state: "OH",
        zip: "44111",
      },
      {
        id: "5",
        full_name: "Sam Jones",
        street: "Somewhere else",
      },
    ];
    const groups = findPossibleDuplicateCustomerRecords(people);
    const phone = groups.find((g) => g.reason === "phone");
    const email = groups.find((g) => g.reason === "email");
    const addr = groups.find((g) => g.reason === "name_address");
    expect(phone?.ids.sort()).toEqual(["1", "2"]);
    expect(email?.ids.sort()).toEqual(["1", "3"]);
    expect(addr?.ids.sort()).toEqual(["1", "4"]);
    expect(groups.every((g) => !g.ids.includes("5") || g.ids.length > 1)).toBe(
      true,
    );
    expect(groups.some((g) => g.ids.includes("5") && g.ids.length === 1)).toBe(
      false,
    );
  });
});

describe("customer list data layer uses customers table, not a job join", () => {
  it("listCustomers selects from customers without embedding jobs", () => {
    const src = readFileSync(join(ROOT, "src/lib/data/customers.ts"), "utf8");
    expect(src).toContain('.from("customers")');
    expect(src).toContain("uniqueCustomersById");
    expect(src).toContain("getCustomerListActivity");
    expect(src).not.toMatch(
      /\.from\("customers"\)[\s\S]{0,400}\.select\([^)]*jobs/i,
    );
  });

  it("Customers page links rows by customer id", () => {
    const page = readFileSync(
      join(ROOT, "src/app/(app)/customers/page.tsx"),
      "utf8",
    );
    const list = readFileSync(
      join(ROOT, "src/app/(app)/customers/customer-list.tsx"),
      "utf8",
    );
    expect(page).toContain("getCustomerListActivity");
    expect(list).toContain("`/customers/${c.id}`");
    expect(list).toContain("formatCustomerActivityLine");
  });
});
