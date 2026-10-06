/**
 * Phase A: financial totals follow the ledger.
 * customers.cancelled_at does not remove invoices, payments, or open AR.
 * Operational archive (queues, schedule, reserve) is unchanged.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Invoice, InvoiceItem } from "@/lib/types";
import {
  countInvoicesWithOpenAr,
  invoiceAmountDue,
  invoiceHasOpenAr,
} from "@/lib/data/invoices";
import {
  collectedFromPayments,
  paymentCountsAsCollected,
  summarizeOutstandingAr,
} from "@/lib/data/finance";
import { classifyInvoiceCollection } from "@/lib/ops-followup";
import {
  activeOperationalQueueExcludesArchivedCustomer,
  customerIsArchived,
  scheduleWriteDecision,
} from "@/lib/customer-operational";

const ROOT = join(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function line(rate: number): InvoiceItem {
  return {
    id: "line-1",
    invoice_id: "inv-1",
    position: 0,
    description: "Install",
    quantity: 1,
    unit: "job",
    rate,
  };
}

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    customer_id: "cust-archived",
    job_id: "job-1",
    estimate_id: null,
    number: "1042",
    status: "sent",
    presentation: "summary",
    issue_date: "2026-09-01",
    due_date: "2026-09-15",
    tax_rate: 0,
    notes: null,
    terms: null,
    created_by: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    items: [line(100)],
    payments: [],
    creditApplications: [],
    appliedDeposits: 0,
    appliedWriteOffs: 0,
    ...overrides,
  };
}

describe("A — archived customer with open AR", () => {
  it("keeps the balance in AR and in the outstanding invoice count", () => {
    const open = invoice();
    expect(customerIsArchived("2026-10-01T00:00:00.000Z")).toBe(true);
    expect(invoiceAmountDue(open)).toBe(100);
    expect(invoiceHasOpenAr(open)).toBe(true);
    const ar = summarizeOutstandingAr([open], Date.parse("2026-10-06T00:00:00.000Z"));
    expect(ar.total).toBe(100);
    expect(ar.count).toBe(1);
    expect(countInvoicesWithOpenAr([open])).toBe(1);
    expect(countInvoicesWithOpenAr([open])).toBe(ar.count);
  });
});

describe("B — archived customer with a payment in the period", () => {
  it("counts the payment and ignores void and migrated cash", () => {
    expect(
      paymentCountsAsCollected({
        status: "active",
        migrated: false,
      }),
    ).toBe(true);
    expect(
      collectedFromPayments([
        { amount: 40, status: "active", migrated: false },
        { amount: 15, status: "void", migrated: false },
        { amount: 25, status: "active", migrated: true },
      ]),
    ).toBe(40);
  });
});

describe("C — write-off, not the lifecycle flag, reduces AR", () => {
  it("reduces open AR by the write-off amount only", () => {
    const before = invoice({ appliedWriteOffs: 0 });
    const after = invoice({ appliedWriteOffs: 40 });
    expect(invoiceAmountDue(before)).toBe(100);
    expect(invoiceAmountDue(after)).toBe(60);
    expect(summarizeOutstandingAr([after]).total).toBe(60);
    expect(summarizeOutstandingAr([invoice({ appliedWriteOffs: 100 })]).total).toBe(0);
    expect(countInvoicesWithOpenAr([invoice({ appliedWriteOffs: 100 })])).toBe(0);
  });
});

describe("D — status paid with a remaining balance", () => {
  it("stays in AR and in the count", () => {
    const lyingPaid = invoice({
      status: "paid",
      payments: [
        {
          id: "pay-1",
          invoice_id: "inv-1",
          amount: 40,
          method: "check",
          reference: null,
          paid_at: "2026-09-02",
          notes: null,
          created_by: null,
          created_at: "2026-09-02T00:00:00.000Z",
          status: "active",
        },
      ],
    });
    expect(lyingPaid.status).toBe("paid");
    expect(invoiceAmountDue(lyingPaid)).toBe(60);
    expect(invoiceHasOpenAr(lyingPaid)).toBe(true);
    expect(summarizeOutstandingAr([lyingPaid]).total).toBe(60);
    expect(countInvoicesWithOpenAr([lyingPaid])).toBe(1);
    expect(
      classifyInvoiceCollection({
        status: "paid",
        dueDate: "2026-09-15",
        balance: 60,
        now: new Date("2026-10-06T00:00:00.000Z"),
      }),
    ).not.toBe("paid");
  });
});

describe("E — void invoices", () => {
  it("are not collectible after archive filtering is gone", () => {
    const voided = invoice({
      status: "void",
      items: [line(500)],
    });
    expect(invoiceAmountDue(voided)).toBe(0);
    expect(invoiceHasOpenAr(voided)).toBe(false);
    expect(summarizeOutstandingAr([voided]).total).toBe(0);
    expect(countInvoicesWithOpenAr([voided])).toBe(0);
    expect(
      classifyInvoiceCollection({
        status: "void",
        dueDate: null,
        balance: 500,
      }),
    ).toBe("paid");
  });
});

describe("F — operational archive protection is unchanged", () => {
  it("still refuses new schedule work and excludes active job queues", () => {
    const decision = scheduleWriteDecision({
      customerCancelledAt: "2026-10-01T00:00:00.000Z",
      jobStatus: "unscheduled",
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe("SCHEDULE_CUSTOMER_ARCHIVED");
    expect(activeOperationalQueueExcludesArchivedCustomer("open")).toBe(true);
    expect(activeOperationalQueueExcludesArchivedCustomer("material")).toBe(true);
    const schedule = read("supabase/migrations/0485_schedule_refuses_archived_customer.sql");
    const reserve = read("supabase/migrations/0486_reserve_and_start_refuse_archived.sql");
    expect(schedule).toContain("SCHEDULE_CUSTOMER_ARCHIVED");
    expect(reserve).toContain("INV_CUSTOMER_ARCHIVED");
    expect(reserve).toContain("JOB_CUSTOMER_ARCHIVED");
  });
});

describe("financial loaders do not exclude by cancelled_at", () => {
  it("period, AR, invoice count, job profit, and product revenue ignore the flag", () => {
    const finance = read("src/lib/data/finance.ts");
    expect(finance).not.toContain("cancelledCustomerIds");
    expect(finance).not.toContain('.not("cancelled_at"');
    expect(finance).not.toContain("cancelled.has(");
    const invoices = read("src/lib/data/invoices.ts");
    const countStart = invoices.indexOf("export async function getOutstandingInvoiceCount");
    const countBody = invoices.slice(countStart, countStart + 400);
    expect(countBody).toContain("countInvoicesWithOpenAr");
    expect(countBody).not.toContain("cancelled_at");
    expect(read("src/lib/data/product-performance.ts")).not.toContain("cancelled_at");
  });

  it("deposit stays operational and collect keeps the debt", () => {
    const ops = read("src/lib/data/ops-queues.ts");
    const deposit = ops.slice(
      ops.indexOf('.eq("status", "approved")') - 200,
      ops.indexOf("const { data: jobs }"),
    );
    expect(deposit).toContain("cancelled_at");
    expect(deposit).toContain("if (c?.cancelled_at) continue");
    const collect = ops.slice(ops.indexOf("const { data: invs }"), ops.indexOf("collect.items.sort"));
    expect(collect).toContain('"paid"');
    expect(collect).not.toContain("if (cust?.cancelled_at) continue");
    expect(collect).not.toContain("if (c?.cancelled_at) continue");
    const briefing = read("src/lib/data/day-tasks.ts");
    const briefCollect = briefing.slice(
      briefing.indexOf("Collect:"),
      briefing.indexOf("Schedule:"),
    );
    expect(briefCollect).toContain('"paid"');
    expect(briefCollect).not.toContain("if (cust?.cancelled_at) continue");
    expect(briefCollect).not.toContain("if (c?.cancelled_at) continue");
  });
});
