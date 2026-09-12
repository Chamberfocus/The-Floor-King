/**
 * Remaining balance + deposit application — SOURCE + behavioral unit tests.
 * No live JWT / RPC harness.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveInvoiceBalance } from "@/lib/credit-ar";
import { invoiceOpenArBalance } from "@/lib/accounting/open-ar";
import { invoiceRemainingBalance, dayTaskCollectAmountDue } from "@/lib/payment-safety";
import { simulateConcurrentArReductions } from "@/lib/accounting/open-ar";
import { computeJobOpenBalance } from "@/lib/invoice-calc";
import {
  invoiceAmountDue,
  invoiceDisplayTotals,
  amountPaid,
  amountCredited,
} from "@/lib/data/invoices";
import {
  planDepositApplications,
  depositEligibleForInvoice,
  depositApplyIdempotencyKey,
  type DepositApplyCandidate,
} from "@/lib/deposit-apply";
import type { Invoice, InvoiceItem, Payment, CreditApplication } from "@/lib/types";

const ROOT = join(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const JOB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INV = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DEP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function inv(
  partial: Partial<Invoice> & {
    items?: InvoiceItem[];
    payments?: Payment[];
    creditApplications?: CreditApplication[];
  },
): Invoice {
  return {
    id: "inv-1",
    customer_id: "c1",
    job_id: "j1",
    estimate_id: null,
    number: "INV-1",
    status: "sent",
    presentation: "detailed",
    issue_date: "2026-01-01",
    due_date: null,
    tax_rate: 0,
    notes: null,
    terms: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    items: [
      {
        id: "it1",
        invoice_id: "inv-1",
        position: 0,
        description: "Floor",
        quantity: 1,
        unit: "ea",
        rate: 10000,
      },
    ],
    payments: [],
    creditApplications: [],
    appliedDeposits: 0,
    appliedWriteOffs: 0,
    ...partial,
  };
}

function pay(amount: number, status: "active" | "void" = "active"): Payment {
  return {
    id: `p-${amount}-${status}`,
    invoice_id: "inv-1",
    amount,
    method: "check",
    reference: null,
    paid_at: "2026-01-02",
    notes: null,
    created_by: null,
    created_at: "2026-01-02T00:00:00Z",
    status,
  };
}

function cred(amount: number, status: "active" | "void" = "active"): CreditApplication {
  return {
    id: `ca-${amount}`,
    credit_memo_id: "cm-1",
    invoice_id: "inv-1",
    amount,
    created_by: null,
    created_at: "2026-01-02T00:00:00Z",
    status,
  };
}

function dueOf(i: Invoice) {
  const e = effectiveInvoiceBalance({
    items: i.items ?? [],
    taxRate: i.tax_rate,
    amountPaid: amountPaid(i),
    appliedCredits: amountCredited(i),
    appliedDeposits: i.appliedDeposits ?? 0,
    appliedWriteOffs: i.appliedWriteOffs ?? 0,
  });
  const open = invoiceOpenArBalance({
    items: i.items ?? [],
    taxRate: i.tax_rate,
    activePayments: amountPaid(i),
    activeCredits: amountCredited(i),
    activeDeposits: i.appliedDeposits ?? 0,
    activeWriteOffs: i.appliedWriteOffs ?? 0,
  });
  const remaining = invoiceRemainingBalance(
    i.items ?? [],
    i.tax_rate,
    i.payments,
    amountCredited(i),
    i.appliedDeposits ?? 0,
    i.appliedWriteOffs ?? 0,
  );
  return { e, open, remaining, display: invoiceDisplayTotals(i), amountDue: invoiceAmountDue(i) };
}

function parity(i: Invoice) {
  const d = dueOf(i);
  expect(d.amountDue).toBe(d.e.amountDue);
  expect(d.display.balance).toBe(d.e.amountDue);
  expect(d.open).toBe(d.e.amountDue);
  expect(d.remaining).toBe(d.e.amountDue);
  expect(d.e.amountDue).toBeGreaterThanOrEqual(0);
  const job = computeJobOpenBalance([
    {
      id: i.id,
      status: i.status,
      tax_rate: i.tax_rate,
      items: i.items,
      payments: i.payments,
      creditApplications: i.creditApplications,
      appliedDeposits: i.appliedDeposits,
      appliedWriteOffs: i.appliedWriteOffs,
    },
  ]);
  expect(job.balance).toBe(i.status === "void" ? 0 : d.e.amountDue);
}

describe("canonical remaining balance", () => {
  it("1. unpaid invoice", () => {
    const i = inv({});
    expect(dueOf(i).amountDue).toBe(10000);
    parity(i);
  });

  it("2. partial payment", () => {
    const i = inv({ payments: [pay(4000)], status: "partial" });
    expect(dueOf(i).amountDue).toBe(6000);
    parity(i);
  });

  it("3. fully paid", () => {
    const i = inv({ payments: [pay(10000)], status: "paid" });
    expect(dueOf(i).amountDue).toBe(0);
    parity(i);
  });

  it("4. multiple payments", () => {
    const i = inv({ payments: [pay(3000), pay(2000)], status: "partial" });
    expect(dueOf(i).amountDue).toBe(5000);
    parity(i);
  });

  it("5. credit memo partial", () => {
    const i = inv({ creditApplications: [cred(2500)] });
    expect(dueOf(i).amountDue).toBe(7500);
    parity(i);
  });

  it("6. credit fully clears", () => {
    const i = inv({ creditApplications: [cred(10000)], status: "paid" });
    expect(dueOf(i).amountDue).toBe(0);
    parity(i);
  });

  it("7. payment + credit", () => {
    const i = inv({
      payments: [pay(4000)],
      creditApplications: [cred(2500)],
      status: "partial",
    });
    expect(dueOf(i).amountDue).toBe(3500);
    parity(i);
  });

  it("8–10. deposit applied (partial / full) without changing invoice total", () => {
    const partial = inv({ appliedDeposits: 3000 });
    expect(dueOf(partial).e.total).toBe(10000);
    expect(dueOf(partial).amountDue).toBe(7000);
    const full = inv({ appliedDeposits: 10000, status: "paid" });
    expect(dueOf(full).e.total).toBe(10000);
    expect(dueOf(full).amountDue).toBe(0);
    parity(partial);
    parity(full);
  });

  it("11–12. deposit larger than invoice — due clamps; leftover is unapplied not negative", () => {
    const i = inv({ appliedDeposits: 15000, status: "paid" });
    expect(dueOf(i).amountDue).toBe(0);
    expect(dueOf(i).e.rawBalance).toBe(-5000);
    const plan = planDepositApplications({
      invoiceId: INV,
      openAr: 10000,
      invoiceJobId: JOB_A,
      invoiceEstimateId: null,
      deposits: [
        {
          id: DEP,
          customerId: "c1",
          jobId: null,
          estimateId: null,
          amount: 15000,
          unapplied: 15000,
          receivedOn: "2026-01-01",
          status: "unapplied",
        },
      ],
    });
    expect(plan.steps).toEqual([
      {
        depositId: DEP,
        amount: 10000,
        idempotencyKey: depositApplyIdempotencyKey(DEP, INV),
      },
    ]);
    expect(plan.remainingDue).toBe(0);
    expect(plan.leftoverUnapplied).toBe(5000);
  });

  it("13. supplemental invoice sums independently", () => {
    const orig = inv({ id: "orig", appliedDeposits: 10000, status: "paid" });
    const sup = inv({
      id: "sup",
      items: [
        {
          id: "s1",
          invoice_id: "sup",
          position: 0,
          description: "CO",
          quantity: 1,
          unit: "ea",
          rate: 2000,
        },
      ],
    });
    const job = computeJobOpenBalance([
      {
        id: orig.id,
        status: orig.status,
        tax_rate: 0,
        items: orig.items,
        appliedDeposits: 10000,
      },
      {
        id: "sup",
        status: "sent",
        tax_rate: 0,
        items: sup.items,
      },
    ]);
    expect(job.balance).toBe(2000);
    expect(job.invoiceId).toBe("sup");
  });

  it("15. void invoice contributes 0", () => {
    const i = inv({ status: "void", payments: [pay(1000)] });
    expect(invoiceAmountDue(i)).toBe(0);
    expect(invoiceDisplayTotals(i).balance).toBe(0);
    expect(
      computeJobOpenBalance([
        {
          id: i.id,
          status: i.status,
          tax_rate: i.tax_rate,
          items: i.items,
          payments: i.payments,
        },
      ]).balance,
    ).toBe(0);
  });

  it("16. multiple open invoices — job sum", () => {
    const r = computeJobOpenBalance([
      {
        id: "a",
        status: "partial",
        tax_rate: 0,
        items: [{ quantity: 1, rate: 5000 }],
        payments: [{ amount: 1000 }],
      },
      {
        id: "b",
        status: "sent",
        tax_rate: 0,
        items: [{ quantity: 1, rate: 2000 }],
      },
    ]);
    expect(r.balance).toBe(6000);
    expect(r.openInvoices.map((o) => o.invoiceId)).toEqual(["a", "b"]);
  });

  it("20. voided payment does not reduce due", () => {
    const i = inv({ payments: [pay(4000, "void"), pay(1000)] });
    expect(dueOf(i).amountDue).toBe(9000);
    parity(i);
  });

  it("21. zero balance never negative after over-application", () => {
    const i = inv({
      payments: [pay(6000)],
      creditApplications: [cred(5000)],
      appliedDeposits: 2000,
    });
    expect(dueOf(i).amountDue).toBe(0);
    expect(dueOf(i).e.rawBalance).toBeLessThan(0);
  });

  it("write-off reduces due once", () => {
    const i = inv({ appliedWriteOffs: 1500, payments: [pay(1000)] });
    expect(dueOf(i).amountDue).toBe(7500);
    parity(i);
  });

  it("14. paid decrease via credit after partial payment", () => {
    const i = inv({
      payments: [pay(8000)],
      creditApplications: [cred(2000)],
      status: "paid",
    });
    expect(dueOf(i).amountDue).toBe(0);
    expect(dueOf(i).e.total).toBe(10000);
    parity(i);
  });

  it("12b. unapplied deposit does not reduce invoice due until applied", () => {
    const i = inv({});
    expect(dueOf(i).amountDue).toBe(10000);
    expect(dueOf(i).display.deposited).toBe(0);
  });

  it("Day Briefing collect amount matches canonical due including deposits", () => {
    const i = inv({ payments: [pay(1000)], appliedDeposits: 2500 });
    expect(
      dayTaskCollectAmountDue({
        items: i.items ?? [],
        taxRate: i.tax_rate,
        payments: i.payments,
        creditApplications: i.creditApplications,
        appliedDeposits: 2500,
      }),
    ).toBe(6500);
    expect(dueOf(i).amountDue).toBe(6500);
  });

  it("17. on-site collect remaining is per-invoice remaining, oldest first", () => {
    const job = computeJobOpenBalance([
      {
        id: "oldest",
        status: "partial",
        tax_rate: 0,
        items: [{ quantity: 1, rate: 4000 }],
        payments: [{ amount: 1000 }],
        appliedDeposits: 500,
      },
      {
        id: "newer",
        status: "sent",
        tax_rate: 0,
        items: [{ quantity: 1, rate: 2000 }],
      },
    ]);
    expect(job.openInvoices).toEqual([
      { invoiceId: "oldest", balance: 2500 },
      { invoiceId: "newer", balance: 2000 },
    ]);
    expect(job.balance).toBe(4500);
    expect(job.invoiceId).toBe("oldest");
  });

  it("19. concurrent AR reductions cannot over-allocate", () => {
    const sim = simulateConcurrentArReductions(1000, [800, 800]);
    expect(sim.accepted).toEqual([800]);
    expect(sim.rejected).toEqual([800]);
    expect(sim.remaining).toBe(200);
  });
});

describe("deposit apply planning", () => {
  const base = (over: Partial<DepositApplyCandidate>): DepositApplyCandidate => ({
    id: DEP,
    customerId: "c1",
    jobId: null,
    estimateId: null,
    amount: 5000,
    unapplied: 5000,
    receivedOn: "2026-01-01",
    status: "unapplied",
    ...over,
  });

  it("customer-level deposit may apply to any job invoice", () => {
    expect(
      depositEligibleForInvoice({
        deposit: base({}),
        invoiceJobId: JOB_A,
        invoiceEstimateId: null,
      }),
    ).toBe(true);
  });

  it("job-tagged deposit cannot apply to another job", () => {
    expect(
      depositEligibleForInvoice({
        deposit: base({ jobId: JOB_A }),
        invoiceJobId: JOB_B,
        invoiceEstimateId: null,
      }),
    ).toBe(false);
  });

  it("oldest customer-level then job-matched order; retry key is stable", () => {
    const plan = planDepositApplications({
      invoiceId: INV,
      openAr: 8000,
      invoiceJobId: JOB_A,
      invoiceEstimateId: null,
      deposits: [
        base({
          id: "late",
          unapplied: 2000,
          receivedOn: "2026-02-01",
        }),
        base({
          id: "job",
          jobId: JOB_A,
          unapplied: 4000,
          receivedOn: "2026-03-01",
        }),
        base({
          id: "early",
          unapplied: 3000,
          receivedOn: "2026-01-01",
        }),
      ],
    });
    expect(plan.steps.map((s) => s.depositId)).toEqual(["job", "early", "late"]);
    expect(plan.steps[0].idempotencyKey).toBe(
      depositApplyIdempotencyKey("job", INV),
    );
    expect(plan.steps[0].idempotencyKey).not.toMatch(/Date\.now|randomUUID/);
    expect(plan.remainingDue).toBe(0);
  });

  it("retry same deposit+invoice key is identical", () => {
    expect(depositApplyIdempotencyKey(DEP, INV)).toBe(
      depositApplyIdempotencyKey(DEP, INV),
    );
  });
});

describe("app wiring", () => {
  it("create/save/pay/collect call applyEligibleDepositsToInvoice", () => {
    const invAct = read("src/app/(app)/invoices/actions.ts");
    const jobs = read("src/app/(app)/jobs/actions.ts");
    const orderInv = read("src/lib/data/order-invoice.ts");
    expect(invAct).toContain("applyEligibleDepositsToInvoice");
    expect(invAct).toContain("applyDepositsThenRecompute");
    expect(invAct).toContain("invoice_open_ar_balance");
    expect(invAct).toContain("loadInvoiceArReductions");
    expect(jobs).toContain("applyEligibleDepositsToInvoice");
    expect(orderInv).toContain("applyEligibleDepositsToInvoice");
    expect(invAct).not.toContain('order("created_at", { ascending: false })');
    const counter = read("src/app/(app)/counter-sale/actions.ts");
    const carry = read("src/app/(app)/carry-over/actions.ts");
    expect(counter).toContain("applyEligibleDepositsToInvoice");
    expect(carry).toContain("applyEligibleDepositsToInvoice");
  });

  it("Day Briefing and reminder cron load deposit/write-off reductions", () => {
    const day = read("src/lib/data/day-tasks.ts");
    const cron = read("src/app/api/cron/daily/route.ts");
    expect(day).toContain("loadInvoiceArReductions");
    expect(day).toContain("appliedDeposits");
    expect(cron).toContain("loadInvoiceArReductions");
    expect(cron).toContain("appliedDeposits");
  });

  it("deposit apply RPC uses admin client so office-only RPC still runs after invoice create", () => {
    const apply = read("src/lib/data/apply-customer-deposits.ts");
    expect(apply).toContain("createAdminClient()");
    expect(apply).toContain("apply_customer_deposit_safe");
    expect(apply).toContain("invoice_open_ar_balance");
  });

  it("portal/office/print share invoiceDisplayTotals / invoiceAmountDue", () => {
    const portal = read("src/app/portal/invoices/[id]/page.tsx");
    const builder = read("src/app/(app)/invoices/invoice-builder.tsx");
    expect(portal).toContain("invoiceDisplayTotals");
    expect(portal).toContain("Deposits applied");
    expect(builder).toContain("Deposits applied");
    expect(builder).toContain("appliedDeposits");
  });

  it("does not call Date.now for deposit apply keys", () => {
    const apply = read("src/lib/deposit-apply.ts");
    expect(apply).toContain("auto-deposit-apply:");
    expect(apply).not.toContain("Date.now");
  });
});
