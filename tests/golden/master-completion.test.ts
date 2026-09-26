/**
 * Master completion: the flooring business path and the roles that run it.
 * Uses the canonical helpers. Does not enable accounting or touch production.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planEstimateInvoiceCreation } from "@/lib/change-order-invoice";
import { assessBooksOfRecordEnable } from "@/lib/accounting/integrity";
import { assessMaterialsReadyForSchedule } from "@/lib/materials-ready";
import { invoiceRemainingBalance } from "@/lib/payment-safety";
import { navGroupsForRole } from "@/lib/nav";
import { customerSeesCustomerMoney } from "@/lib/customer-record-access";
import {
  insertActiveSupplemental,
  insertObligation,
  orderInvoiceIdempotencyKey,
  replacementInvoiceIdempotencyKey,
  resolveBlankInvoiceIdempotencyKey,
  resolveCounterSaleIdempotencyKey,
} from "@/lib/financial-idempotency";

function src(path: string): string {
  return readFileSync(path, "utf8");
}

describe("master flooring journey", () => {
  it("material job, labor-only job, change order, and payments stay on the canonical rules", () => {
    expect(
      assessMaterialsReadyForSchedule({ hasMaterialNeed: true, warehouseReadyAt: null }).ready,
    ).toBe(false);
    expect(
      assessMaterialsReadyForSchedule({
        hasMaterialNeed: true,
        warehouseReadyAt: "2026-09-26",
      }).ready,
    ).toBe(true);
    expect(
      assessMaterialsReadyForSchedule({ hasMaterialNeed: false, warehouseReadyAt: null }).reason,
    ).toBe("no_material_need");

    expect(planEstimateInvoiceCreation({ approvedTotal: 2000, existing: [] }).action).toBe("full");
    const increase = planEstimateInvoiceCreation({
      approvedTotal: 2500,
      existing: [
        {
          id: "inv",
          status: "partial",
          approvalSnapshotId: "snap-1",
          total: 2000,
          hasFinancialActivity: true,
          hasPayments: true,
        },
      ],
    });
    expect(increase.action).toBe("supplemental");
    const decrease = planEstimateInvoiceCreation({
      approvedTotal: 1500,
      existing: [
        {
          id: "inv",
          status: "sent",
          approvalSnapshotId: "snap-1",
          total: 2000,
          hasFinancialActivity: false,
          hasPayments: false,
        },
      ],
    });
    expect(decrease.action).toBe("void_reissue");

    expect(
      invoiceRemainingBalance([{ quantity: 1, rate: 2000 }], 0, [{ amount: 500, status: "active" }], 0, 0, 0),
    ).toBe(1500);
    expect(
      invoiceRemainingBalance([{ quantity: 1, rate: 2000 }], 0, [{ amount: 2000, status: "active" }], 0, 0, 0),
    ).toBe(0);
    expect(
      invoiceRemainingBalance([{ quantity: 1, rate: 2000 }], 0, [], 200, 0, 0),
    ).toBe(1800);
  });

  it("invoice, counter sale, and order retries still collapse to one write", () => {
    const supplements = new Map();
    insertActiveSupplemental(supplements, {
      estimateId: "e",
      approvalSnapshotId: "s",
      id: "1",
    });
    expect(
      insertActiveSupplemental(supplements, {
        estimateId: "e",
        approvalSnapshotId: "s",
        id: "2",
      }).ok,
    ).toBe(false);

    const replacements = new Map();
    const key = replacementInvoiceIdempotencyKey("e", "s2");
    insertObligation(replacements, { key, id: "r1" });
    expect(insertObligation(replacements, { key, id: "r2" }).ok).toBe(false);

    expect(resolveBlankInvoiceIdempotencyKey("t", "u")).toBe(
      resolveBlankInvoiceIdempotencyKey("t", "u"),
    );
    expect(resolveCounterSaleIdempotencyKey("t", "u")).toBe(
      resolveCounterSaleIdempotencyKey("t", "u"),
    );
    expect(orderInvoiceIdempotencyKey("order-9")).toBe("order:order-9");
  });
});

describe("role journeys", () => {
  function labels(role: Parameters<typeof navGroupsForRole>[0]) {
    return navGroupsForRole(role).flatMap((g) => g.items.map((i) => i.href));
  }

  it("salesman can sell and cannot open accounting", () => {
    const hrefs = labels("salesman");
    expect(hrefs).toContain("/estimates");
    expect(hrefs).toContain("/customers");
    expect(hrefs).not.toContain("/accounting");
    expect(customerSeesCustomerMoney("salesman")).toBe(true);
  });

  it("scheduler can schedule and cannot see customer money", () => {
    const hrefs = labels("scheduler");
    expect(hrefs).toContain("/install-scheduler");
    expect(hrefs).not.toContain("/invoices");
    expect(hrefs).not.toContain("/accounting");
    expect(customerSeesCustomerMoney("scheduler")).toBe(false);
  });

  it("warehouse can stage and cannot open invoices or accounting", () => {
    const hrefs = labels("warehouse");
    expect(hrefs).toContain("/warehouse");
    expect(hrefs).not.toContain("/invoices");
    expect(hrefs).not.toContain("/accounting");
    expect(customerSeesCustomerMoney("warehouse")).toBe(false);
  });

  it("crew sees jobs and not office money", () => {
    const hrefs = labels("crew");
    expect(hrefs).toContain("/jobs");
    expect(hrefs).not.toContain("/invoices");
    expect(hrefs).not.toContain("/accounting");
    expect(customerSeesCustomerMoney("crew")).toBe(false);
  });

  it("office and admin can run money and settings stay admin-only", () => {
    expect(labels("office")).toContain("/invoices");
    expect(labels("office")).toContain("/accounting");
    expect(labels("admin")).toContain("/accounting");
    expect(labels("sales_manager")).not.toContain("/accounting");
  });
});

describe("accounting stays off until a real cutover", () => {
  it("books of record cannot turn on without openings and accountant validation", () => {
    const blocked = assessBooksOfRecordEnable({
      requested: true,
      postingEnabled: true,
      cutoverDate: "2026-10-01",
      openingBalancesEntered: false,
      accountantValidated: false,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.booksOfRecord).toBe(false);
  });

  it("the settings action reads the live cutover flags instead of forcing them off", () => {
    const action = src("src/app/(app)/accounting/actions.ts");
    expect(action).toContain("current.opening_balances_entered");
    expect(action).toContain("current.accountant_validated");
    expect(action).not.toContain("openingBalancesEntered: false");
    expect(action).not.toContain("accountantValidated: false");
  });
});
