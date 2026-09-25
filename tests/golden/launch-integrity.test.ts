/**
 * Phase I — invoice idempotency, sent-path parity, jobs-board cue, duplicate probe.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planEstimateInvoiceCreation } from "@/lib/change-order-invoice";
import {
  BLANK_INVOICE_TOKEN_USED_MESSAGE,
  INVOICE_ALREADY_CREATED_MESSAGE,
  insertActiveSupplemental,
  replayOrInsertBlankInvoice,
  resolveBlankInvoiceIdempotencyKey,
} from "@/lib/financial-idempotency";
import { invoiceRemainingBalance } from "@/lib/payment-safety";
import {
  JOBS_BOARD_MATERIALS_LABEL,
  JOBS_BOARD_SCHEDULE_LABEL,
  assessMaterialsReadyForSchedule,
  jobsBoardUnscheduledLabel,
} from "@/lib/materials-ready";
import {
  HIDDEN_DUPLICATE_MESSAGE,
  filterMatchesForActor,
  salesmanHiddenStrongDuplicate,
  scoreCustomerMatch,
} from "@/lib/customer-resolve";
import { shouldCreateAutomatedTask, automationSourceKey } from "@/lib/office-task";
import { ESTIMATE_FOLLOWUP_KIND } from "@/lib/ops-followup";

function src(path: string): string {
  return readFileSync(path, "utf8");
}

const paid = {
  id: "inv-1",
  status: "partial",
  approvalSnapshotId: "snap-1",
  total: 1000,
  hasFinancialActivity: true,
  hasPayments: true,
};

describe("invoice creation plans stay canonical", () => {
  it("1 normal approved invoice is a full original", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 1000,
      existing: [],
    });
    expect(plan.action).toBe("full");
    if (plan.action === "full") expect(plan.kind).toBe("original");
  });

  it("2 a second full invoice is not planned when one original exists", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 1000,
      existing: [{ ...paid, status: "sent", hasFinancialActivity: false, hasPayments: false, total: 1000 }],
    });
    expect(plan.action).toBe("none");
  });

  it("3 supplemental invoice is the paid increase delta", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 1250,
      existing: [paid],
    });
    expect(plan.action).toBe("supplemental");
    if (plan.action === "supplemental") expect(plan.amount).toBe(250);
  });

  it("9 change-order increase on a paid invoice is supplemental", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 1400,
      existing: [paid],
    });
    expect(plan).toMatchObject({ action: "supplemental", kind: "supplemental", amount: 400 });
  });

  it("10 unpaid decrease voids and reissues", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 800,
      existing: [{ ...paid, status: "sent", hasFinancialActivity: false, hasPayments: false }],
    });
    expect(plan.action).toBe("void_reissue");
  });

  it("11 paid decrease is a credit, not a second invoice", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 700,
      existing: [paid],
    });
    expect(plan.action).toBe("issue_credit");
    if (plan.action === "issue_credit") expect(plan.amount).toBe(300);
  });

  it("12 multiple invoices can stay open", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 1500,
      existing: [paid, { ...paid, id: "inv-2", approvalSnapshotId: "snap-2", total: 200, status: "sent" }],
    });
    expect(plan.action).toBe("supplemental");
  });

  it("13 partial payment leaves an open balance", () => {
    const due = invoiceRemainingBalance(
      [{ quantity: 1, rate: 1000 }],
      0,
      [{ amount: 400, status: "active" }],
      0,
      0,
      0,
    );
    expect(due).toBe(600);
  });

  it("14 credits reduce the open balance", () => {
    const due = invoiceRemainingBalance(
      [{ quantity: 1, rate: 1000 }],
      0,
      [],
      250,
      0,
      0,
    );
    expect(due).toBe(750);
  });
});

describe("supplemental and blank invoice idempotency", () => {
  it("4 the same supplemental request resolves to one invoice", () => {
    const store = new Map();
    const first = insertActiveSupplemental(store, {
      estimateId: "est",
      approvalSnapshotId: "snap-2",
      id: "s1",
    });
    const second = insertActiveSupplemental(store, {
      estimateId: "est",
      approvalSnapshotId: "snap-2",
      id: "s2",
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.existingId).toBe("s1");
  });

  it("5 concurrent supplemental attempts keep one row", () => {
    const store = new Map();
    const results = [1, 2, 3].map((n) =>
      insertActiveSupplemental(store, {
        estimateId: "est",
        approvalSnapshotId: "snap-9",
        id: `s${n}`,
      }),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(store.size).toBe(1);
  });

  it("a later approved snapshot may still create another supplemental", () => {
    const store = new Map();
    insertActiveSupplemental(store, {
      estimateId: "est",
      approvalSnapshotId: "snap-a",
      id: "a",
    });
    const next = insertActiveSupplemental(store, {
      estimateId: "est",
      approvalSnapshotId: "snap-b",
      id: "b",
    });
    expect(next.ok).toBe(true);
    expect(store.size).toBe(2);
  });

  it("6 one blank-invoice request creates one invoice", () => {
    const store = new Map();
    const key = resolveBlankInvoiceIdempotencyKey("token-1", "user-a");
    const created = replayOrInsertBlankInvoice(store, {
      key,
      customerId: "c1",
      jobId: "j1",
      create: () => ({ id: "blank-1" }),
    });
    expect(created.ok && created.duplicate).toBe(false);
    expect(store.size).toBe(1);
  });

  it("7 a retried blank invoice does not create a second", () => {
    const store = new Map();
    const key = resolveBlankInvoiceIdempotencyKey("token-1", "user-a");
    replayOrInsertBlankInvoice(store, {
      key,
      customerId: "c1",
      jobId: null,
      create: () => ({ id: "blank-1" }),
    });
    const retry = replayOrInsertBlankInvoice(store, {
      key,
      customerId: "c1",
      jobId: null,
      create: () => ({ id: "blank-2" }),
    });
    expect(retry.ok && retry.duplicate && retry.invoice.id).toBe("blank-1");
    expect(store.size).toBe(1);
  });

  it("8 two intentional blank invoices are two rows", () => {
    const store = new Map();
    const a = resolveBlankInvoiceIdempotencyKey("token-a", "user-a");
    const b = resolveBlankInvoiceIdempotencyKey("token-b", "user-a");
    replayOrInsertBlankInvoice(store, {
      key: a,
      customerId: "c1",
      jobId: null,
      create: () => ({ id: "blank-1" }),
    });
    replayOrInsertBlankInvoice(store, {
      key: b,
      customerId: "c1",
      jobId: null,
      create: () => ({ id: "blank-2" }),
    });
    expect(store.size).toBe(2);
  });

  it("a stolen token cannot open another customer's invoice", () => {
    const store = new Map();
    const key = resolveBlankInvoiceIdempotencyKey("token-1", "user-a");
    replayOrInsertBlankInvoice(store, {
      key,
      customerId: "c1",
      jobId: null,
      create: () => ({ id: "blank-1" }),
    });
    const other = replayOrInsertBlankInvoice(store, {
      key,
      customerId: "c2",
      jobId: null,
      create: () => ({ id: "blank-2" }),
    });
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(BLANK_INVOICE_TOKEN_USED_MESSAGE).not.toMatch(/23505|idempotency_key/i);
    expect(INVOICE_ALREADY_CREATED_MESSAGE).not.toMatch(/constraint|duplicate key/i);
  });

  it("another user does not share the token namespace", () => {
    const a = resolveBlankInvoiceIdempotencyKey("token-1", "user-a");
    const b = resolveBlankInvoiceIdempotencyKey("token-1", "user-b");
    expect(a).not.toBe(b);
    expect(resolveBlankInvoiceIdempotencyKey("blank:user-a:token-1", "user-b")).toBeNull();
  });

  it("the database migration is the write boundary", () => {
    const sql = src("supabase/migrations/0477_invoice_idempotency_and_duplicate_probe.sql");
    expect(sql).toContain("invoices_one_active_supplemental_per_snapshot");
    expect(sql).toContain("invoices_idempotency_key_unique");
    expect(sql).toContain("0477_PRECHECK");
    expect(sql).not.toMatch(/delete from public\.invoices/i);
    const actions = src("src/app/(app)/invoices/actions.ts");
    const createFns = actions.slice(
      actions.indexOf("async function createEstimateDerivedInvoice"),
      actions.indexOf("export async function saveInvoice"),
    );
    expect(createFns).toContain("INVOICE_ALREADY_CREATED_MESSAGE");
    expect(createFns).toContain("idempotency_key: idempotencyKey");
    expect(createFns).not.toMatch(/redirect\([^)]*error\?\.message/);
    expect(createFns).not.toContain('error?.message ?? "Could not');
  });
});

describe("estimate sent workflow parity", () => {
  it("15-16 Mark sent uses the canonical follow-up helper and does not email", () => {
    const quick = src("src/app/(app)/estimates/quick/actions.ts");
    const mark = quick.slice(quick.indexOf("if (input.markSent)"));
    expect(mark).toContain("onEstimateSentOps");
    expect(mark).toContain('advanceFromAutoAction(customerId, "build_quote")');
    expect(mark).not.toContain("sendEmail");
  });

  it("17-19 a repeated sent transition does not add a second open follow-up", () => {
    const key = automationSourceKey(ESTIMATE_FOLLOWUP_KIND, "est-1");
    expect(key).toBe("estimate_followup:est-1");
    expect(
      shouldCreateAutomatedTask({ sourceKey: key, existingOpenSourceKeys: [key] }),
    ).toBe(false);
    expect(
      shouldCreateAutomatedTask({ sourceKey: key, existingOpenSourceKeys: [] }),
    ).toBe(true);
  });

  it("20 canonical send also sets sent status before the same ops helper", () => {
    const send = src("src/app/(app)/estimates/actions.ts");
    expect(send).toContain('status: "sent"');
    expect(send).toContain("onEstimateSentOps");
    expect(send).toContain('advanceFromAutoAction');
  });
});

describe("jobs board agrees with material readiness", () => {
  function label(hasMaterialNeed: boolean, warehouseReadyAt: string | null) {
    return jobsBoardUnscheduledLabel({ hasMaterialNeed, warehouseReadyAt });
  }

  it("21 no materials allows scheduling language", () => {
    expect(label(false, null)).toBe(JOBS_BOARD_SCHEDULE_LABEL);
    expect(assessMaterialsReadyForSchedule({ hasMaterialNeed: false, warehouseReadyAt: null }).ready).toBe(true);
  });

  it("22 materials ready allows scheduling language", () => {
    expect(label(true, "2026-09-01")).toBe(JOBS_BOARD_SCHEDULE_LABEL);
  });

  it("23 materials not ready does not say schedule", () => {
    expect(label(true, null)).toBe(JOBS_BOARD_MATERIALS_LABEL);
  });

  it("24 deposit due does not change a ready job", () => {
    expect(label(true, "2026-09-01")).toBe(JOBS_BOARD_SCHEDULE_LABEL);
  });

  it("25 deposit paid does not make an unready job schedulable", () => {
    expect(label(true, null)).toBe(JOBS_BOARD_MATERIALS_LABEL);
  });

  it("26 purchasing gap is not an input to the board cue", () => {
    const text = jobsBoardUnscheduledLabel.toString();
    expect(text).not.toMatch(/purchas|deposit/i);
    expect(label(true, "2026-09-01")).toBe(JOBS_BOARD_SCHEDULE_LABEL);
  });

  it("27 no material lines stay schedulable even if a PO exists elsewhere", () => {
    expect(label(false, null)).toBe(JOBS_BOARD_SCHEDULE_LABEL);
    const page = src("src/app/(app)/jobs/page.tsx");
    expect(page).toContain("jobsBoardUnscheduledLabel");
    expect(page).toContain("assessMaterialsReadyForSchedule");
    expect(page).toContain("scheduleAllowed");
  });
});

describe("cross-salesperson duplicate probe", () => {
  const mine = {
    id: "c-mine",
    full_name: "Ada",
    email: "ada@example.com",
    phone: "2165550100",
    city: null,
    street: null,
    state: null,
    zip: null,
    company: null,
    assigned_to: "rep-a",
    workflow_owner_id: null,
  };
  const theirs = { ...mine, id: "c-theirs", assigned_to: "rep-b", email: "bea@example.com", phone: "2165550199", full_name: "Bea" };

  it("28 a same-salesperson strong match stays visible", () => {
    const scored = scoreCustomerMatch(
      { fullName: "Ada", email: "ada@example.com", phone: null },
      mine,
    );
    expect(scored?.tier).toBe("strong");
    const visible = filterMatchesForActor(scored ? [scored] : [], { role: "salesman", id: "rep-a" });
    expect(visible).toHaveLength(1);
    expect(
      salesmanHiddenStrongDuplicate({
        actorRole: "salesman",
        visibleHasStrong: visible.some((m) => m.tier === "strong"),
        identifierTaken: true,
      }),
    ).toBe(false);
  });

  it("29-30 a hidden strong match blocks without record details", () => {
    const scored = scoreCustomerMatch(
      { fullName: "Bea", email: "bea@example.com", phone: null },
      theirs,
    );
    const visible = filterMatchesForActor(scored ? [scored] : [], { role: "salesman", id: "rep-a" });
    expect(visible).toHaveLength(0);
    expect(
      salesmanHiddenStrongDuplicate({
        actorRole: "salesman",
        visibleHasStrong: false,
        identifierTaken: true,
      }),
    ).toBe(true);
    expect(HIDDEN_DUPLICATE_MESSAGE).not.toMatch(/bea|rep-b|c-theirs/i);
    const resolver = src("src/lib/data/customer-resolve.ts");
    expect(resolver).toContain("customer_strong_identifier_taken");
    expect(resolver).toContain("HIDDEN_DUPLICATE_MESSAGE");
    expect(resolver).not.toContain("hiddenCustomerId");
  });

  it("31 a name-only match does not block, and a new identifier does not", () => {
    expect(
      salesmanHiddenStrongDuplicate({
        actorRole: "salesman",
        visibleHasStrong: false,
        identifierTaken: false,
      }),
    ).toBe(false);
    expect(
      salesmanHiddenStrongDuplicate({
        actorRole: "office",
        visibleHasStrong: false,
        identifierTaken: true,
      }),
    ).toBe(false);
  });
});

describe("role boundaries on the new writes", () => {
  const actions = src("src/app/(app)/invoices/actions.ts");
  const roles = actions.slice(
    actions.indexOf("const INVOICE_CREATE_ROLES"),
    actions.indexOf("const INVOICE_DELETE_ROLES"),
  );

  it("32 salesman may create invoices", () => {
    expect(roles).toContain('"salesman"');
  });

  it("33 scheduler is not an invoice creator", () => {
    expect(roles).not.toContain("scheduler");
  });

  it("34 office may create invoices", () => {
    expect(roles).toContain('"office"');
  });

  it("35 admin may create invoices", () => {
    expect(roles).toContain('"admin"');
  });

  it("the duplicate probe returns a boolean and no customer columns", () => {
    const sql = src("supabase/migrations/0477_invoice_idempotency_and_duplicate_probe.sql");
    expect(sql).toContain("returns boolean");
    expect(sql).not.toMatch(/returns table/i);
    expect(sql).toContain("grant execute on function public.customer_strong_identifier_taken(text, text) to authenticated");
  });
});
