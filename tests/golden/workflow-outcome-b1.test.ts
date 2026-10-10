/**
 * Phase B1. Lost and Parked read workflow_stages.outcome.
 * A display name does not cancel, release, archive, or park once an outcome is set.
 * Completion, materials, balance, and cron destinations stay on names (B2).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  backfillOutcomeFromCurrentName,
  jobEffectOnLost,
  jobReturnsToActiveOpsOnRestore,
  reservationEffectOnLost,
  selectDeclineStage,
  selectLostPlacementStage,
  stageIsLost,
  stageIsParked,
  stageNameMeansLost,
  stageNameMeansParked,
} from "@/lib/customer-lifecycle";
import { isOffSpine, spinePosition } from "@/lib/job-flow";
import { deriveLeadStage } from "@/lib/workflow-engine";
import {
  countInvoicesWithOpenAr,
  invoiceAmountDue,
} from "@/lib/data/invoices";
import {
  collectedFromPayments,
  summarizeOutstandingAr,
} from "@/lib/data/finance";
import type { Invoice, InvoiceItem } from "@/lib/types";
import {
  activeOperationalQueueExcludesArchivedCustomer,
  customerIsArchived,
  scheduleWriteDecision,
} from "@/lib/customer-operational";

const root = process.cwd();
const src = (path: string) => readFileSync(join(root, path), "utf8");

function sliceFn(file: string, start: string, end: string): string {
  const text = src(file);
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

const anchors = [
  { position: 10, auto_action: "schedule_estimate", name: "New Lead" },
  { position: 40, auto_action: "build_quote", name: "Build Quote" },
  { position: 70, auto_action: "collect_deposit", name: "Collect Deposit" },
];

function lostPass(jobs: { id: string; status: string }[]) {
  const open = jobs.filter((j) => j.status !== "completed" && j.status !== "cancelled");
  const cancel = open.filter((j) => jobEffectOnLost(j.status) === "cancel");
  const release = cancel.filter((j) => reservationEffectOnLost(j.status) === "release");
  const next = jobs.map((j) =>
    cancel.some((c) => c.id === j.id) ? { ...j, status: "cancelled" } : j,
  );
  return { cancel, release, next };
}

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

describe("A — stable Lost", () => {
  const stage = { name: "Did Not Buy", position: 120, outcome: "lost" as const };

  it("archives through the lead stage and settles only jobs that have not started", () => {
    expect(stageIsLost(stage)).toBe(true);
    expect(stageIsParked(stage)).toBe(false);
    expect(deriveLeadStage(stage, anchors)).toBe("lost");
    expect(stageNameMeansLost(stage.name)).toBe(false);

    const jobs = [
      { id: "u", status: "unscheduled" },
      { id: "s", status: "scheduled" },
      { id: "p", status: "in_progress" },
      { id: "d", status: "completed" },
      { id: "c", status: "cancelled" },
    ];
    const first = lostPass(jobs);
    expect(first.cancel.map((j) => j.id)).toEqual(["u", "s"]);
    expect(first.release.map((j) => j.id)).toEqual(["u", "s"]);
    expect(first.next.find((j) => j.id === "p")?.status).toBe("in_progress");
    expect(first.next.find((j) => j.id === "d")?.status).toBe("completed");

    const second = lostPass(first.next);
    expect(second.cancel).toEqual([]);
    expect(second.release).toEqual([]);
    expect(jobReturnsToActiveOpsOnRestore("cancelled")).toBe(false);
  });

  it("Lost still uses the outcome, and cancel releases stock in the same transaction", () => {
    const settle = sliceFn(
      "src/lib/workflow-engine.ts",
      "export async function settleJobsForStage",
      "export async function moveToAutoActionStage",
    );
    expect(settle).toContain("stageIsLost(stage)");
    expect(settle).not.toContain("stageNameMeansLost");
    // PR #69 replaced the separate release-then-status write. The cancel
    // function releases reservations and sets cancelled together. A failed
    // release does not reach a status update.
    expect(settle).toContain("cancelJobWithReservations");
    expect(settle).not.toContain("releaseJobReservations");
    expect(settle).not.toContain('.update({ status: "cancelled" })');
    expect(settle).toContain('jobEffectOnLost(j.status as string) === "cancel"');
    expect(settle).not.toContain("reserve_inventory_safe");
    expect(settle).toContain("/installed|follow/i");
  });
});

describe("B — a dangerous label with an active outcome", () => {
  const stage = { name: "Lost Samples Follow-Up", position: 50, outcome: "active" as const };

  it("does not archive, mark Lost, cancel, or release", () => {
    expect(stageNameMeansLost(stage.name)).toBe(true);
    expect(stageIsLost(stage)).toBe(false);
    expect(stageIsParked(stage)).toBe(false);
    expect(deriveLeadStage(stage, anchors)).toBe("quoted");
    expect(isOffSpine({ id: "s", ...stage })).toBe(false);
    expect(jobEffectOnLost("scheduled")).toBe("cancel");
    expect(stageIsLost(stage) && jobEffectOnLost("scheduled") === "cancel").toBe(false);
  });
});

describe("C — stable Parked", () => {
  it("stays off the live spine when the label would not have matched the old hold words", () => {
    const stage = {
      id: "park",
      name: "Call Me Next Month",
      position: 30,
      outcome: "parked" as const,
    };
    expect(stageNameMeansParked(stage.name)).toBe(false);
    expect(stageIsParked(stage)).toBe(true);
    expect(stageIsLost(stage)).toBe(false);
    const spine = [
      { id: "new", name: "New Lead", position: 10, outcome: "active" as const },
      stage,
      { id: "quote", name: "Build Quote", position: 40, outcome: "active" as const },
    ];
    expect(isOffSpine(stage)).toBe(true);
    expect(spinePosition(stage, spine)).toEqual({ index: -1, total: 2 });
  });
});

describe("D — waiting label stays active", () => {
  it("does not park a materials stage after the label becomes Waiting on Product", () => {
    const before = { name: "Awaiting Materials", outcome: "active" as const };
    const after = { ...before, name: "Waiting on Product" };
    expect(backfillOutcomeFromCurrentName("Awaiting Materials")).toBe("active");
    expect(stageNameMeansParked("Waiting on Product")).toBe(true);
    expect(stageIsParked(before)).toBe(false);
    expect(stageIsParked(after)).toBe(false);
    expect(stageIsLost(after)).toBe(false);
    expect(after.outcome).toBe("active");
  });
});

describe("H — estimate decline", () => {
  it("selects outcome lost even when the label is not Lost or Declined", () => {
    const chosen = selectDeclineStage([
      { id: "false", name: "Lost Samples Follow-Up", position: 40, outcome: "active" as const },
      { id: "real", name: "Did Not Buy", position: 120, outcome: "lost" as const },
      { id: "later", name: "Also Lost", position: 140, outcome: "lost" as const },
    ]);
    expect(chosen?.id).toBe("real");
  });

  it("keeps the narrow name fallback and does not add dead or cancel destinations", () => {
    expect(
      selectDeclineStage([{ name: "Dead Lead", position: 10, outcome: null }]),
    ).toBeNull();
    expect(
      selectDeclineStage([{ name: "Cancelled", position: 10, outcome: null }]),
    ).toBeNull();
    expect(
      selectDeclineStage([
        { name: "Cancelled", position: 10, outcome: null },
        { name: "Lost / Declined", position: 20, outcome: null },
      ])?.name,
    ).toBe("Lost / Declined");
    const decline = sliceFn(
      "src/app/(app)/estimates/actions.ts",
      "export async function onEstimateDeclined",
      "export interface UnapproveResult",
    );
    expect(decline).toContain("advanceToLostStage");
    expect(decline).not.toContain("advanceToNamedStage");
    expect(decline).not.toContain('.from("invoices")');
    expect(decline).not.toContain('.from("payments")');
  });
});

describe("J — null outcome still uses the current name rules", () => {
  it("matches Lost and Parked only while outcome is null", () => {
    expect(stageIsLost({ name: "Lost / Declined", outcome: null })).toBe(true);
    expect(stageIsLost({ name: "Cancelled", outcome: null })).toBe(true);
    expect(stageIsLost({ name: "Install Scheduled", outcome: null })).toBe(false);
    expect(stageIsParked({ name: "On Hold", outcome: null })).toBe(true);
    expect(stageIsParked({ name: "Waiting for Materials", outcome: null })).toBe(false);
    expect(stageIsParked({ name: "Call Me Next Month", outcome: null })).toBe(false);
    expect(stageIsLost({ name: "Lost", outcome: "won" })).toBe(false);
    expect(stageIsParked({ name: "On Hold", outcome: "won" })).toBe(false);
  });
});

describe("rename and new stages", () => {
  it("Follow Up renamed to Lost stays active and the save does not replay settlement", () => {
    const renamed = { name: "Lost", outcome: "active" as const };
    expect(stageNameMeansLost("Lost")).toBe(true);
    expect(stageIsLost(renamed)).toBe(false);
    expect(stageIsParked(renamed)).toBe(false);
    expect(deriveLeadStage({ ...renamed, position: 80 }, anchors)).not.toBe("lost");
    const update = sliceFn(
      "src/app/(app)/settings/stages/actions.ts",
      "export async function updateStage",
      "export async function deleteStage",
    );
    expect(update).not.toMatch(/outcome\s*:/);
    expect(update).not.toContain("settleJobsForStage");
    expect(update).not.toContain('.from("customers")');
    expect(update).not.toContain('.from("jobs")');
    expect(update).not.toContain("releaseJobReservations");
  });

  it("Lost renamed to Did Not Buy stays Lost", () => {
    const renamed = { name: "Did Not Buy", position: 120, outcome: "lost" as const };
    expect(stageIsLost(renamed)).toBe(true);
    expect(deriveLeadStage(renamed, anchors)).toBe("lost");
    expect(selectLostPlacementStage([
      { id: "false", name: "Lost Samples Follow-Up", position: 40, outcome: "active" as const },
      { id: "real", name: "Did Not Buy", position: 120, outcome: "lost" as const },
    ])?.id).toBe("real");
  });

  it("a new stage named Cancelled is active", () => {
    expect(stageNameMeansLost("Cancelled")).toBe(true);
    expect(stageIsLost({ name: "Cancelled", outcome: "active" })).toBe(false);
    expect(stageIsParked({ name: "Cancelled", outcome: "active" })).toBe(false);
    const create = sliceFn(
      "src/app/(app)/settings/stages/actions.ts",
      "export async function createStage",
      "export async function updateStage",
    );
    expect(create).toContain('outcome: "active"');
    expect(create).not.toContain("stageNameMeansLost");
    expect(create).not.toContain("settleJobsForStage");
    const form = src("src/app/(app)/settings/stages/stage-row.tsx");
    const add = src("src/app/(app)/settings/stages/add-stage-form.tsx");
    expect(form).not.toContain('name="outcome"');
    expect(add).not.toContain('name="outcome"');
  });
});

describe("K — archive, schedule, and reserve still refuse", () => {
  it("keeps operational stops and a scoped Lost release", () => {
    const archived = "2026-10-05T12:00:00Z";
    expect(customerIsArchived(archived)).toBe(true);
    expect(activeOperationalQueueExcludesArchivedCustomer("open")).toBe(true);
    expect(activeOperationalQueueExcludesArchivedCustomer("completed")).toBe(false);
    expect(scheduleWriteDecision({ customerCancelledAt: archived, jobStatus: "unscheduled" }).ok).toBe(false);
    expect(src("supabase/migrations/0485_schedule_refuses_archived_customer.sql")).toContain(
      "SCHEDULE_CUSTOMER_ARCHIVED",
    );
    const reserve = src("supabase/migrations/0486_reserve_and_start_refuse_archived.sql");
    expect(reserve).toContain("INV_CUSTOMER_ARCHIVED");
    expect(reserve).toContain("JOB_CUSTOMER_ARCHIVED");
    expect(reserve).toContain("advance_scheduled_job_if_active");
    expect(reservationEffectOnLost("scheduled")).toBe("release");
    expect(reservationEffectOnLost("in_progress")).toBe("keep");
    expect(reservationEffectOnLost("cancelled")).toBe("keep");
  });
});

describe("L — outcome is not a financial deletion", () => {
  it("keeps open AR and period payments after archive or Lost", () => {
    const open = invoice();
    expect(invoiceAmountDue(open)).toBe(100);
    const ar = summarizeOutstandingAr([open], Date.parse("2026-10-06T00:00:00.000Z"));
    expect(ar.total).toBe(100);
    expect(countInvoicesWithOpenAr([open])).toBe(1);
    expect(
      collectedFromPayments([
        { amount: 40, migrated: false, status: "active" },
        { amount: 15, migrated: false, status: "void" },
      ]),
    ).toBe(40);
    const finance = src("src/lib/data/finance.ts");
    expect(finance).not.toContain("cancelledCustomerIds");
    expect(finance).not.toContain("outcome");
    expect(src("src/lib/data/invoices.ts")).not.toContain("outcome");
    expect(src("src/lib/customer-lifecycle.ts")).not.toContain('.from("invoices")');
    expect(src("src/lib/customer-lifecycle.ts")).not.toContain('.from("payments")');
  });
});

describe("migration 0487", () => {
  it("only classifies workflow_stages.outcome and matches the current name rules", () => {
    const sql = src("supabase/migrations/0487_workflow_stage_outcome.sql");
    expect(sql).toContain("add column if not exists outcome text");
    expect(sql).toContain("workflow_stages_outcome_check");
    expect(sql).toContain("'active', 'won', 'lost', 'parked'");
    expect(sql).toContain("where outcome is null");
    expect(sql).not.toMatch(/then\s+'won'/);
    expect((sql.match(/update\s+public\./gi) ?? []).length).toBe(1);
    expect(sql).toMatch(/update public\.workflow_stages/i);
    expect(sql).not.toMatch(
      /\b(insert|update|delete)\s+(into\s+)?public\.(customers|jobs|invoices|payments|stock_movements|office_tasks)\b/i,
    );
    expect(sql).not.toMatch(/\bdelete from\b/i);
    expect(sql).not.toMatch(/\bdrop table\b/i);

    const backfill = sql.slice(sql.indexOf("update public.workflow_stages"));
    const lostAt = backfill.indexOf("lost|declin|dead|cancel");
    const materialAt = backfill.indexOf("material|deliver");
    const parkAt = backfill.indexOf("\\ywaiting\\y");
    expect(lostAt).toBeGreaterThan(0);
    expect(materialAt).toBeGreaterThan(lostAt);
    expect(parkAt).toBeGreaterThan(materialAt);

    expect(backfillOutcomeFromCurrentName("Lost / Declined")).toBe("lost");
    expect(backfillOutcomeFromCurrentName("Cancelled")).toBe("lost");
    expect(backfillOutcomeFromCurrentName("On Hold")).toBe("parked");
    expect(backfillOutcomeFromCurrentName("Waiting for Materials")).toBe("active");
    expect(backfillOutcomeFromCurrentName("Awaiting Materials")).toBe("active");
    expect(backfillOutcomeFromCurrentName("Installed — Follow-up")).toBe("active");
    expect(backfillOutcomeFromCurrentName("Collect Balance")).toBe("active");
    expect(backfillOutcomeFromCurrentName("Call Me Next Month")).toBe("active");
    expect(backfillOutcomeFromCurrentName("Did Not Buy")).toBe("active");
  });

  it("defaults an omitted outcome to active only after existing rows are classified", () => {
    const sql = src("supabase/migrations/0487_workflow_stage_outcome.sql");
    const updateAt = sql.search(/update public\.workflow_stages/i);
    const defaultAt = sql.search(/alter column outcome set default 'active'/i);
    expect(sql).toContain("add column if not exists outcome text");
    expect(sql).not.toMatch(/add column if not exists outcome text default/i);
    expect(updateAt).toBeGreaterThan(0);
    expect(defaultAt).toBeGreaterThan(updateAt);
    expect(sql).not.toMatch(/alter column outcome set not null/i);
  });
});

describe("B2 name routes stay name routes", () => {
  it("does not replace completion, cron, material, or closed-list matching", () => {
    const jobs = src("src/app/(app)/jobs/actions.ts");
    expect(jobs).toContain("const STAGE_INSTALLED = /installed|follow/");
    expect(jobs).toContain("const STAGE_INSTALL_IN_PROGRESS = /in progress|in-progress/");
    expect(jobs).toContain("const STAGE_INSTALL_SCHEDULED =");
    const cron = src("src/app/api/cron/daily/route.ts");
    expect(cron).toContain("/in progress|in-progress/");
    expect(cron).toContain("/balance/");
    expect(cron).toContain("advance_scheduled_job_if_active");
    const po = src("src/app/(app)/purchase-orders/actions.ts");
    expect(po).toContain("const STAGE_AWAITING_MATERIALS = /wait.*material|await.*material/");
    expect(po).toContain("const STAGE_MATERIALS_RECEIVED = /material.*received|received.*material/");
    expect(src("src/app/(app)/estimates/actions.ts")).toContain(
      "/awaiting customer|customer response/i",
    );
    expect(src("src/app/(app)/customers/page.tsx")).toContain("/closed/i");
    expect(src("src/lib/types.ts")).toContain("/material|warehouse|stag|order/");
  });
});
