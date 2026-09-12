/**
 * Website P0 function remediation — invoice credits, PO routing,
 * multi-job schedule target, assistant materials gate, crew My Work.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  invoiceAmountDue,
  invoiceDisplayTotals,
  amountPaid,
  amountCredited,
} from "@/lib/data/invoices";
import { effectiveInvoiceBalance } from "@/lib/credit-ar";
import { invoiceRemainingBalance } from "@/lib/payment-safety";
import {
  assessScheduleMaterialsGate,
  MATERIALS_OVERRIDE_REASON_REQUIRED,
} from "@/lib/materials-ready";
import { buildChecklist, type ChecklistInput } from "@/lib/job-checklist";
import { jobMaterialsHref } from "@/lib/job-materials-href";
import {
  resolveCustomerInstallScheduleTarget,
  activeInstallJobs,
} from "@/lib/install-schedule-target";
import {
  installerSeesJob,
  dedupeJobsById,
  installerAssignmentOrFilter,
} from "@/lib/installer-assignment";
import type { Invoice, InvoiceItem, Payment, CreditApplication } from "@/lib/types";

const ROOT = join(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function inv(partial: Partial<Invoice> & { items?: InvoiceItem[]; payments?: Payment[]; creditApplications?: CreditApplication[] }): Invoice {
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
    items: [{ id: "it1", invoice_id: "inv-1", position: 0, description: "Floor", quantity: 1, unit: "ea", rate: 10000 }],
    payments: [],
    creditApplications: [],
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
    status,
    created_at: "2026-01-03T00:00:00Z",
  } as CreditApplication;
}

function checklistBase(over: Partial<ChecklistInput> = {}): ChecklistInput {
  return {
    customerId: "c1",
    estimate: { id: "e1", status: "approved" },
    approvedEstimateId: "e1",
    job: null,
    invoice: null,
    depositPaid: false,
    balanceOutstanding: 0,
    hasActivity: true,
    estimateBooked: true,
    materialsOrdered: false,
    satisfactionSigned: false,
    ...over,
  };
}

describe("P0 invoice balance / credit consistency", () => {
  it("no credit, unpaid → full total due", () => {
    const i = inv({});
    expect(invoiceDisplayTotals(i).balance).toBe(10000);
    expect(invoiceAmountDue(i)).toBe(10000);
    expect(invoiceDisplayTotals(i).balance).toBe(
      effectiveInvoiceBalance({
        items: i.items ?? [],
        taxRate: i.tax_rate,
        amountPaid: amountPaid(i),
        appliedCredits: amountCredited(i),
      }).amountDue,
    );
  });

  it("partial payment, no credit", () => {
    const i = inv({ payments: [pay(4000)], status: "partial" });
    expect(invoiceDisplayTotals(i).paid).toBe(4000);
    expect(invoiceDisplayTotals(i).credited).toBe(0);
    expect(invoiceDisplayTotals(i).balance).toBe(6000);
  });

  it("partial credit, no payment", () => {
    const i = inv({ creditApplications: [cred(2500)] });
    expect(invoiceDisplayTotals(i).credited).toBe(2500);
    expect(invoiceDisplayTotals(i).balance).toBe(7500);
  });

  it("payment + credit", () => {
    const i = inv({
      payments: [pay(4000)],
      creditApplications: [cred(2500)],
      status: "partial",
    });
    expect(invoiceDisplayTotals(i).balance).toBe(3500);
    expect(
      invoiceRemainingBalance(i.items ?? [], i.tax_rate, i.payments, amountCredited(i)),
    ).toBe(3500);
  });

  it("fully satisfied by payment + credit", () => {
    const i = inv({
      payments: [pay(6000)],
      creditApplications: [cred(4000)],
      status: "paid",
    });
    expect(invoiceDisplayTotals(i).balance).toBe(0);
    expect(invoiceAmountDue(i)).toBe(0);
  });

  it("void payment does not reduce balance; void credit does not reduce balance", () => {
    const i = inv({
      payments: [pay(5000, "void"), pay(1000)],
      creditApplications: [cred(2000, "void"), cred(500)],
    });
    expect(amountPaid(i)).toBe(1000);
    expect(amountCredited(i)).toBe(500);
    expect(invoiceAmountDue(i)).toBe(8500);
  });

  it("void invoice amount due is 0", () => {
    const i = inv({ status: "void", payments: [], creditApplications: [] });
    expect(invoiceAmountDue(i)).toBe(0);
    expect(invoiceDisplayTotals(i).balance).toBe(0);
  });

  it("portal / invoices list / payments card share invoiceDisplayTotals / invoiceAmountDue", () => {
    const portal = read("src/app/portal/invoices/[id]/page.tsx");
    const portalHome = read("src/app/portal/page.tsx");
    const list = read("src/app/(app)/invoices/page.tsx");
    const builder = read("src/app/(app)/invoices/invoice-builder.tsx");
    expect(portal).toContain("invoiceDisplayTotals");
    expect(portalHome).toContain("invoiceDisplayTotals");
    expect(list).toContain("invoiceDisplayTotals");
    expect(builder).toContain("effectiveInvoiceBalance");
    expect(builder).toContain("amountCredited");
    expect(portal).not.toMatch(/invoiceTotals\([\s\S]{0,80}amountPaid/);
    expect(list).not.toMatch(/invoiceTotals\([\s\S]{0,80}amountPaid/);
  });
});

describe("P0 approval → PO workflow", () => {
  it("checklist with a job points at job Materials & prep, not estimate /order", () => {
    const steps = buildChecklist(
      checklistBase({
        job: {
          id: "job-9",
          status: "unscheduled",
          scheduledDate: null,
          warehouseReadyAt: null,
          warehouseSubmittedAt: null,
          closedOutAt: null,
        },
      }),
    );
    const order = steps.find((s) => s.key === "order");
    expect(order?.href).toBe(jobMaterialsHref("job-9"));
    expect(order?.href).toBe("/jobs/job-9?tab=warehouse");
    expect(order?.linkLabel).toBe("Review materials & POs");
    expect(order?.href).not.toContain("/estimates/");
  });

  it("checklist without a job still uses estimate order page", () => {
    const steps = buildChecklist(checklistBase({ job: null }));
    const order = steps.find((s) => s.key === "order");
    expect(order?.href).toBe("/estimates/e1/order");
  });

  it("estimate order page redirects to job warehouse tab when a job exists", () => {
    const src = read("src/app/(app)/estimates/[id]/order/page.tsx");
    expect(src).toContain("jobMaterialsHref");
    expect(src).toMatch(/if \(job\) redirect\(jobMaterialsHref\(job\.id\)\)/);
    expect(src).not.toMatch(/redirect\(`\/jobs\/\$\{job\.id\}`\)/);
  });

  it("estimate Order materials button uses job warehouse when linked", () => {
    const src = read("src/app/(app)/estimates/[id]/page.tsx");
    expect(src).toContain("jobMaterialsHref");
    expect(src).toContain("linkedJob");
  });
});

describe("P0 multi-job scheduling target", () => {
  it("newest-first list: strip and action bind to the soonest dated job, not jobs[0]", () => {
    const jobs = [
      { id: "job-b", status: "unscheduled", scheduled_date: null, created_at: "2026-06-01", title: "Basement" },
      { id: "job-a", status: "scheduled", scheduled_date: "2026-05-10", created_at: "2026-01-01", title: "Kitchen" },
    ];
    const naiveFirst = jobs.find((j) => j.status !== "cancelled" && j.status !== "completed");
    expect(naiveFirst?.id).toBe("job-b");
    const target = resolveCustomerInstallScheduleTarget(jobs);
    expect(target?.id).toBe("job-a");
    expect(target?.id).not.toBe(naiveFirst?.id);
  });

  it("two unscheduled actives → oldest created (not first array element)", () => {
    const jobs = [
      { id: "newer", status: "unscheduled", scheduled_date: null, created_at: "2026-08-01", title: "B" },
      { id: "older", status: "unscheduled", scheduled_date: null, created_at: "2026-01-01", title: "A" },
    ];
    expect(resolveCustomerInstallScheduleTarget(jobs)?.id).toBe("older");
  });

  it("changing which job is dated changes the target deterministically", () => {
    const jobs = [
      { id: "x", status: "scheduled", scheduled_date: "2026-09-20", created_at: "2026-01-01" },
      { id: "y", status: "scheduled", scheduled_date: "2026-09-10", created_at: "2026-02-01" },
    ];
    expect(resolveCustomerInstallScheduleTarget(jobs)?.id).toBe("y");
    jobs[0] = { ...jobs[0], scheduled_date: "2026-09-01" };
    expect(resolveCustomerInstallScheduleTarget(jobs)?.id).toBe("x");
  });

  it("scheduling one job does not select a sibling", () => {
    const jobs = [
      { id: "keep", status: "scheduled", scheduled_date: "2026-04-01", created_at: "2026-01-01" },
      { id: "other", status: "unscheduled", scheduled_date: null, created_at: "2026-03-01" },
    ];
    const target = resolveCustomerInstallScheduleTarget(jobs);
    expect(target?.id).toBe("keep");
    expect(activeInstallJobs(jobs).map((j) => j.id).sort()).toEqual(["keep", "other"]);
  });

  it("customer file uses the resolver and buildInstallScheduleProps for the same job", () => {
    const src = read("src/app/(app)/customers/[id]/page.tsx");
    expect(src).toContain("resolveCustomerInstallScheduleTarget");
    expect(src).toContain("buildInstallScheduleProps");
    expect(src).toMatch(/const schedulableJob = installJob/);
  });
});

describe("P0 assistant materials-ready guard", () => {
  it("not ready without override → rejected (same helper as human path)", () => {
    const g = assessScheduleMaterialsGate({
      warehouseReadyAt: null,
      hasMaterialNeed: true,
      overrideReason: null,
    });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.error).toBe(MATERIALS_OVERRIDE_REASON_REQUIRED);
  });

  it("materials ready → allowed", () => {
    const g = assessScheduleMaterialsGate({
      warehouseReadyAt: "2026-01-01T00:00:00Z",
      hasMaterialNeed: true,
      overrideReason: null,
    });
    expect(g.ok).toBe(true);
  });

  it("reschedule_job calls enforceMaterialsReadyForSchedule before schedule_job_install_safe", () => {
    const src = read("src/app/(app)/assistant/actions.ts");
    const start = src.indexOf('case "reschedule_job": {');
    expect(start).toBeGreaterThan(-1);
    const fn = src.slice(start, src.indexOf("case \"add_note\":", start));
    expect(fn).toContain("enforceMaterialsReadyForSchedule");
    expect(fn.indexOf("enforceMaterialsReadyForSchedule")).toBeLessThan(
      fn.indexOf("schedule_job_install_safe"),
    );
    expect(fn).toContain("overrideReason: null");
  });
});

describe("P0 subcontractor crew My Work", () => {
  const user = "user-1";
  const myCrew = "crew-mine";
  const otherCrew = "crew-other";

  it("direct assignment is visible", () => {
    expect(
      installerSeesJob({
        assignedTo: user,
        assignedCrewId: null,
        userId: user,
        memberCrewIds: [],
      }),
    ).toBe(true);
  });

  it("assigned crew member is visible", () => {
    expect(
      installerSeesJob({
        assignedTo: null,
        assignedCrewId: myCrew,
        userId: user,
        memberCrewIds: [myCrew],
      }),
    ).toBe(true);
  });

  it("unrelated crew member is not visible", () => {
    expect(
      installerSeesJob({
        assignedTo: null,
        assignedCrewId: otherCrew,
        userId: user,
        memberCrewIds: [myCrew],
      }),
    ).toBe(false);
  });

  it("no assignment is not visible", () => {
    expect(
      installerSeesJob({
        assignedTo: null,
        assignedCrewId: null,
        userId: user,
        memberCrewIds: [myCrew],
      }),
    ).toBe(false);
  });

  it("direct + crew assignment dedupes to one row", () => {
    const rows = [
      { id: "job-1", assigned_to: user, assigned_crew_id: myCrew },
      { id: "job-1", assigned_to: user, assigned_crew_id: myCrew },
    ];
    expect(dedupeJobsById(rows)).toHaveLength(1);
    expect(
      installerSeesJob({
        assignedTo: user,
        assignedCrewId: myCrew,
        userId: user,
        memberCrewIds: [myCrew],
      }),
    ).toBe(true);
  });

  it("inactive crew is excluded from or-filter membership list", () => {
    expect(installerAssignmentOrFilter(user, [])).toBe(`assigned_to.eq.${user}`);
    expect(installerAssignmentOrFilter(user, [myCrew])).toContain(myCrew);
    expect(
      installerSeesJob({
        assignedTo: null,
        assignedCrewId: myCrew,
        userId: user,
        memberCrewIds: [],
      }),
    ).toBe(false);
  });

  it("getInstallerHome queries assigned_to OR assigned_crew_id", () => {
    const src = read("src/lib/data/installer.ts");
    expect(src).toContain("installerAssignmentOrFilter");
    expect(src).toContain("installerSeesJob");
    expect(src).toContain("dedupeJobsById");
    expect(src).not.toMatch(/\.eq\("assigned_to", userId\)/);
  });
});
