/**
 * Phase H — one flooring job journey.
 *
 * These checks follow the canonical helpers and the write paths employees
 * actually hit. They do not invent a second workflow, a deposit schedule gate,
 * or an accounting cutover.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildHomeCenter, type HomeSignals } from "@/lib/home-actions";
import {
  assessMaterialsReadyForSchedule,
  assessScheduleMaterialsGate,
} from "@/lib/materials-ready";
import {
  buildCustomerActionCenter,
  buildEstimateActionCenter,
  buildJobActionCenter,
} from "@/lib/record-action-center";
import { planEstimateInvoiceCreation } from "@/lib/change-order-invoice";
import {
  assessPaymentAmount,
  invoiceRemainingBalance,
  simulateConcurrentPayments,
} from "@/lib/payment-safety";
import {
  canApproveCustomerOrder,
  canStageCustomerOrder,
} from "@/lib/order-warehouse-gates";
import { assessJobOperationalState } from "@/lib/job-operational-state";
import {
  reuseOpenInstallerIssueId,
  splitUnscheduledByMaterialsReady,
} from "@/lib/ops-followup";
import { customerSeesCustomerMoney } from "@/lib/customer-record-access";
import type { UserRole } from "@/lib/types";

const NOW = new Date("2026-09-24T15:00:00Z");

function src(path: string): string {
  return readFileSync(path, "utf8");
}

function customer(
  role: UserRole,
  extra: Partial<Parameters<typeof buildCustomerActionCenter>[0]> = {},
) {
  return buildCustomerActionCenter({
    now: NOW,
    role,
    customerId: "cust-1",
    ...extra,
  });
}

function estimate(
  extra: Partial<Parameters<typeof buildEstimateActionCenter>[0]> = {},
) {
  return buildEstimateActionCenter({
    now: NOW,
    role: "office",
    estimateId: "est-1",
    customerId: "cust-1",
    status: "draft",
    ...extra,
  });
}

function job(
  extra: Partial<Parameters<typeof buildJobActionCenter>[0]> = {},
) {
  return buildJobActionCenter({
    now: NOW,
    role: "office",
    jobId: "job-1",
    title: "Kitchen",
    status: "unscheduled",
    hasMaterialNeed: false,
    ops: null,
    ...extra,
  });
}

function home(role: UserRole, extra: Partial<HomeSignals> = {}) {
  return buildHomeCenter({
    now: NOW,
    role,
    userId: "user-1",
    firstName: "Alex",
    ...extra,
  });
}

const approvedEstimate = {
  id: "est-1",
  status: "approved",
  sentAt: "2026-09-20T12:00:00Z",
  approvedAt: "2026-09-22T12:00:00Z",
  approvalStale: false,
};

describe("flooring job journey", () => {
  it("1. a new customer still requires a name and a lead source", () => {
    const create = src("src/app/(app)/customers/actions.ts");
    expect(create).toContain('error: "A name is required."');
    expect(create).toContain("Please choose where this lead came from.");
    expect(create).toContain('|| "new"');
    expect(src("src/lib/data/customer-resolve.ts")).toContain("recheckBeforeInsert");
  });

  it("2. booking a measure advances the schedule-estimate step", () => {
    const book = src("src/app/(app)/customers/[id]/schedule-actions.ts");
    expect(book).toContain('advanceFromAutoAction');
    expect(book).toContain('"schedule_estimate"');
    expect(book).toContain('kind: "estimate"');
  });

  it("3. guided, quick, and manual estimates are the live create paths", () => {
    const smart = src("src/app/(app)/estimates/smart-actions.ts");
    const quick = src("src/app/(app)/estimates/quick/actions.ts");
    const manual = src("src/app/(app)/estimates/actions.ts");
    expect(smart).toContain("export async function createSmartEstimate");
    expect(quick).toContain("export async function createQuickEstimate");
    expect(manual).toContain("export async function createEstimate(");
    expect(manual).toContain("export async function createEstimateFromWizard");
    expect(src("src/components/new-estimate.tsx")).not.toContain("createEstimateFromWizard");
    expect(src("src/app/(app)/estimates/questionnaire.tsx")).not.toContain(
      "createEstimateFromWizard",
    );
  });

  it("4. sending an estimate is what the follow-up action reads", () => {
    const model = estimate({
      status: "sent",
      sentAt: "2026-09-20T12:00:00Z",
    });
    expect(model.primary?.label).toBe("Follow up");
    expect(src("src/lib/data/ops-automation.ts")).toContain("onEstimateSentOps");
  });

  it("5. an approved estimate can collect a deposit and schedule when material allows", () => {
    const model = estimate({
      status: "approved",
      depositOnFile: false,
      linkedJob: {
        id: "job-1",
        title: "Kitchen",
        bookable: true,
        materialBlocked: false,
      },
    });
    expect(model.primary?.label).toBe("Collect deposit");
    expect(model.secondary.map((row) => row.label)).toContain("Schedule install");
    expect(model.also).toContain("does not hold the installation date");
  });

  it("6. creating a job from an estimate is idempotent", () => {
    const jobs = src("src/app/(app)/jobs/actions.ts");
    expect(jobs).toContain('error.code === "23505"');
    expect(jobs).toContain(".eq(\"estimate_id\", estimateId)");
    expect(jobs).toContain("seedJobScopeIfEmpty");
    expect(jobs).toContain("if (est.approval_stale === true) return null");
  });

  it("7. deposit due stays visible without becoming the only action", () => {
    const model = customer("office", {
      depositOnFile: false,
      estimates: [approvedEstimate],
      jobs: [
        {
          id: "job-1",
          title: "Kitchen",
          status: "unscheduled",
          hasMaterialNeed: false,
          warehouseReadyAt: null,
        },
      ],
    });
    expect(model.primary?.label).toBe("Collect deposit");
    expect(model.secondary.map((row) => row.label)).toContain("Schedule install");
  });

  it("8. a paid deposit removes the collect action and still allows scheduling", () => {
    const model = customer("office", {
      depositOnFile: true,
      estimates: [approvedEstimate],
      jobs: [
        {
          id: "job-1",
          title: "Kitchen",
          status: "unscheduled",
          hasMaterialNeed: true,
          warehouseReadyAt: "2026-09-23T00:00:00Z",
        },
      ],
    });
    expect(model.primary?.label).toBe("Schedule install");
    expect(JSON.stringify(model)).not.toContain("Collect deposit");
  });

  it("9. material that is not warehouse-ready cannot be scheduled", () => {
    expect(
      assessMaterialsReadyForSchedule({
        hasMaterialNeed: true,
        warehouseReadyAt: null,
      }),
    ).toEqual({ ready: false, reason: "materials_not_ready" });
    const model = job({
      hasMaterialNeed: true,
      warehouseReadyAt: null,
    });
    expect(model.primary?.label).toBe("Review material");
    expect(JSON.stringify(model)).not.toContain("Schedule install");
  });

  it("10. warehouse-ready material, or no material lines, can be scheduled", () => {
    expect(
      assessMaterialsReadyForSchedule({
        hasMaterialNeed: true,
        warehouseReadyAt: "2026-09-23T00:00:00Z",
      }).reason,
    ).toBe("warehouse_ready");
    expect(
      assessMaterialsReadyForSchedule({
        hasMaterialNeed: false,
        warehouseReadyAt: null,
      }).reason,
    ).toBe("no_material_need");
    expect(
      job({
        hasMaterialNeed: true,
        warehouseReadyAt: "2026-09-23T00:00:00Z",
      }).primary?.label,
    ).toBe("Schedule install");
    expect(
      job({ hasMaterialNeed: false, warehouseReadyAt: null }).primary?.label,
    ).toBe("Schedule install");
  });

  it("11. a booked install is stated as booked", () => {
    const model = job({
      status: "scheduled",
      scheduledDate: "2026-09-28",
      hasMaterialNeed: true,
      warehouseReadyAt: "2026-09-23T00:00:00Z",
    });
    expect(model.situation.join(" ")).toContain("Installation scheduled");
    expect(model.primary?.label).not.toBe("Schedule install");
  });

  it("12. reschedule uses the same material gate as the first booking", () => {
    const jobs = src("src/app/(app)/jobs/actions.ts");
    const book = jobs.indexOf("export async function bookInstall");
    const reschedule = jobs.indexOf("export async function rescheduleInstall");
    expect(book).toBeGreaterThan(-1);
    expect(reschedule).toBeGreaterThan(book);
    expect(jobs.slice(book, reschedule)).toContain("enforceMaterialsReadyForSchedule");
    expect(jobs.slice(reschedule, reschedule + 2500)).toContain(
      "enforceMaterialsReadyForSchedule",
    );
    expect(jobs.slice(book, reschedule)).toContain("schedule_job_install_safe");
  });

  it("13. completing the install does not hide an open balance", () => {
    const model = job({
      status: "completed",
      scheduledDate: "2026-09-20",
      completedAt: "2026-09-22T12:00:00Z",
      openBalance: 400,
      invoiceHref: "/invoices/inv-1",
    });
    expect(model.situation).toContain("Install complete");
    expect(model.primary?.label).toBe("Open invoice");
    expect(model.blocker).toBeNull();
  });

  it("14. sign-off stays a recorded checklist step, not a second status", () => {
    const checklist = src("src/lib/job-checklist.ts");
    expect(checklist).toContain('key: "signoff"');
    expect(checklist).toContain("satisfactionSigned");
  });

  it("15. the first invoice is one original for the approved total", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 5000,
      existing: [],
    });
    expect(plan).toMatchObject({ action: "full", kind: "original", amount: 5000 });
  });

  it("16. a partial payment leaves the remaining balance", () => {
    const due = invoiceRemainingBalance(
      [{ quantity: 1, rate: 1000 }],
      0,
      [{ amount: 400, status: "active" }],
    );
    expect(due).toBe(600);
    expect(assessPaymentAmount({ amount: 600, remainingBalance: due }).ok).toBe(true);
  });

  it("17. a full payment clears the balance and a second payment is refused", () => {
    const due = invoiceRemainingBalance(
      [{ quantity: 1, rate: 1000 }],
      0,
      [{ amount: 1000, status: "active" }],
    );
    expect(due).toBe(0);
    expect(assessPaymentAmount({ amount: 1, remainingBalance: due }).ok).toBe(false);
  });

  it("18. closeout records cost and does not read the invoice balance", () => {
    const closeout = src("src/app/(app)/jobs/[id]/closeout/actions.ts");
    expect(closeout).toContain("closed_out_at");
    expect(closeout).not.toMatch(/openBalance|invoice/);
  });

  it("19. an open service callback stays visible after the install is complete", () => {
    const model = job({
      status: "completed",
      scheduledDate: "2026-09-20",
      hasOpenCallback: true,
      openBalance: 0,
    });
    expect(model.blocker).toContain("service issue is still open");
    expect(model.primary?.label).toBe("Open service");
    expect(model.primary?.href).toBe("/service");
  });

  it("20. a paid increase bills only the supplemental delta", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 6000,
      existing: [
        {
          id: "inv-1",
          status: "paid",
          approvalSnapshotId: "snap-1",
          total: 5000,
          hasPayments: true,
        },
      ],
    });
    expect(plan).toMatchObject({ action: "supplemental", amount: 1000 });
  });

  it("21. an unpaid decrease voids and reissues instead of stacking", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 4000,
      existing: [
        {
          id: "inv-1",
          status: "sent",
          approvalSnapshotId: "snap-1",
          total: 5000,
          hasPayments: false,
        },
      ],
    });
    expect(plan.action).toBe("void_reissue");
  });

  it("22. a paid decrease asks for a credit memo", () => {
    const plan = planEstimateInvoiceCreation({
      approvedTotal: 4000,
      existing: [
        {
          id: "inv-1",
          status: "paid",
          approvalSnapshotId: "snap-1",
          total: 5000,
          hasPayments: true,
        },
      ],
    });
    expect(plan.action).toBe("issue_credit");
  });

  it("23. refunds go through the safe refund write", () => {
    expect(src("src/app/(app)/credits/actions.ts")).toContain("record_refund_safe");
  });

  it("24. two open jobs stay two schedule facts", () => {
    const model = customer("office", {
      jobs: [
        {
          id: "job-a",
          title: "Kitchen",
          status: "unscheduled",
          hasMaterialNeed: false,
        },
        {
          id: "job-b",
          title: "Hall",
          status: "unscheduled",
          hasMaterialNeed: false,
        },
      ],
    });
    expect(model.situation.join(" ")).toContain("2 installs are not booked");
    expect(model.primary?.href).toBe("/jobs/job-a");
  });

  it("25. two overdue invoices stay listed without a new balance formula", () => {
    const model = customer("office", {
      openInvoices: [
        { id: "inv-a", dueAt: "2026-09-01", number: "1001" },
        { id: "inv-b", dueAt: "2026-09-02", number: "1002" },
      ],
    });
    expect(model.secondary.map((row) => row.label).join(" ")).toContain("Open invoices (2)");
  });

  it("26. repeated job, payment, and callback writes are guarded", () => {
    expect(src("src/app/(app)/jobs/actions.ts")).toContain('error.code === "23505"');
    expect(src("src/app/(app)/invoices/actions.ts")).toContain(
      "record_invoice_payment_safe",
    );
    expect(src("src/app/(app)/ops/actions.ts")).toContain("reuseOpenInstallerIssueId");
    expect(
      reuseOpenInstallerIssueId({
        existingOpen: [{ id: "cb-1", description: "Seam lifted" }],
        description: "Seam lifted",
      }),
    ).toBe("cb-1");
    const race = simulateConcurrentPayments(100, 80, 80);
    expect(race.accepted).toEqual([80]);
    expect(race.rejected).toEqual([80]);
  });

  it("27. every live schedule write checks material readiness first", () => {
    const created = src("src/app/(app)/jobs/new/actions.ts");
    const carry = src("src/app/(app)/carry-over/actions.ts");
    const newBooking = created.slice(created.indexOf("Same hard gate as Book install"));
    const carryBooking = carry.slice(carry.indexOf("Copy operational lines"));
    expect(newBooking.indexOf("enforceMaterialsReadyForSchedule")).toBeLessThan(
      newBooking.indexOf("schedule_job_install_safe"),
    );
    expect(carryBooking.indexOf("seedJobScopeIfEmpty")).toBeLessThan(
      carryBooking.indexOf("enforceMaterialsReadyForSchedule"),
    );
    expect(carryBooking.indexOf("enforceMaterialsReadyForSchedule")).toBeLessThan(
      carryBooking.indexOf("schedule_job_install_safe"),
    );
    expect(src("src/lib/materials-ready.ts")).not.toMatch(/deposit/i);
  });

  it("28. a stale approval does not offer a new job", () => {
    const model = estimate({
      status: "approved",
      approvalStale: true,
      linkedJob: { id: "job-1", title: "Kitchen" },
    });
    expect(model.blocker).toContain("cannot be created");
    expect(model.primary).toBeNull();
    expect(model.secondary.map((row) => row.label)).toEqual(["Open job"]);
    const page = src("src/app/(app)/estimates/[id]/page.tsx");
    expect(page).toContain("estimate.approval_stale");
    expect(page).toContain("job_error");
    expect(src("src/app/(app)/jobs/actions.ts")).toContain("job_error");
  });

  it("29. a scheduler can book and is not shown deposit or invoice money", () => {
    expect(customerSeesCustomerMoney("scheduler")).toBe(false);
    const model = customer("scheduler", {
      depositOnFile: false,
      estimates: [approvedEstimate],
      jobs: [
        {
          id: "job-1",
          title: "Kitchen",
          status: "unscheduled",
          hasMaterialNeed: true,
          warehouseReadyAt: "2026-09-23T00:00:00Z",
        },
      ],
      openInvoices: [{ id: "inv-1", dueAt: "2026-09-01", number: "1001" }],
    });
    expect(model.primary?.label).toBe("Schedule install");
    expect(JSON.stringify(model)).not.toContain("Deposit");
    expect(JSON.stringify(model)).not.toContain("Invoice");
    const center = home("scheduler", {
      deposits: [
        {
          id: "est-1",
          name: "Dan",
          approvedAt: "2026-09-22T12:00:00Z",
          amountLabel: "$2,000",
          customerId: "cust-1",
          ownerId: null,
        },
      ],
      unscheduled: [
        {
          id: "job-1",
          name: "Dan",
          assigneeId: null,
          customerId: "cust-1",
          customerOwnerId: null,
          hasMaterialNeed: true,
          warehouseReadyAt: "2026-09-23T00:00:00Z",
          href: "/jobs/job-1",
        },
      ],
    });
    const items = center.sections.flatMap((section) => section.items);
    expect(items.map((item) => item.action)).toEqual(["Schedule install"]);
    expect(JSON.stringify(items)).not.toContain("$2,000");
  });

  it("30. warehouse can stage and cannot approve, price, or collect", () => {
    expect(canApproveCustomerOrder("unknown")).toBe(false);
    expect(canApproveCustomerOrder("in_stock")).toBe(true);
    expect(canApproveCustomerOrder("partial")).toBe(true);
    expect(
      canStageCustomerOrder({ status: "approved", stockStatus: "partial" }),
    ).toBe(false);
    expect(
      canStageCustomerOrder({ status: "approved", stockStatus: "in_stock" }),
    ).toBe(true);
    const model = job({
      role: "warehouse",
      hasMaterialNeed: true,
      warehouseReadyAt: null,
    });
    expect(model.primary?.label).toBe("Open warehouse");
    expect(JSON.stringify(model)).not.toMatch(/invoice|deposit|price/i);
    expect(src("src/app/(app)/orders/actions.ts")).toContain(
      'assertRole(["admin", "office"])',
    );
  });

  it("31. crew see the job without a schedule button or customer money", () => {
    expect(customer("crew").quiet).toContain("not part of your work");
    const model = job({
      role: "crew",
      hasMaterialNeed: false,
    });
    expect(model.primary).toBeNull();
    expect(model.quiet).toContain("Scheduling is handled by the office");
    const popup = src("src/components/job-step-popup.tsx");
    expect(popup).not.toContain("Next up");
    expect(popup).not.toContain("active.next");
    expect(popup).not.toContain("Schedule the install");
  });

  it("32. a salesman sees deposit and schedule on their customer", () => {
    expect(customerSeesCustomerMoney("salesman")).toBe(true);
    const model = customer("salesman", {
      depositOnFile: false,
      estimates: [approvedEstimate],
      jobs: [
        {
          id: "job-1",
          title: "Kitchen",
          status: "unscheduled",
          hasMaterialNeed: false,
        },
      ],
    });
    expect(model.primary?.label).toBe("Collect deposit");
    expect(model.secondary.map((row) => row.label)).toContain("Schedule install");
  });

  it("33. office and admin share the same next action for the same facts", () => {
    const facts = {
      depositOnFile: false as const,
      estimates: [approvedEstimate],
      jobs: [
        {
          id: "job-1",
          title: "Kitchen",
          status: "unscheduled",
          hasMaterialNeed: true,
          warehouseReadyAt: null,
        },
      ],
    };
    const office = customer("office", facts);
    const admin = customer("admin", facts);
    expect(admin.primary).toEqual(office.primary);
    expect(admin.secondary).toEqual(office.secondary);
    expect(office.primary?.label).toBe("Review material");
    expect(JSON.stringify(office)).not.toContain("Schedule install");
  });

  it("purchasing gap does not remove a warehouse-ready schedule button", () => {
    const ops = assessJobOperationalState({
      status: "unscheduled",
      scheduledDate: null,
      warehouseReadyAt: "2026-09-23T00:00:00Z",
      hasMaterialNeed: true,
      activeHold: null,
      hasPurchasingGap: true,
    });
    expect(ops.blockerCode).toBe("needs_purchasing");
    const model = job({
      hasMaterialNeed: true,
      warehouseReadyAt: "2026-09-23T00:00:00Z",
      ops,
    });
    expect(model.primary?.label).toBe("Schedule install");
    expect(model.also).toContain("warehouse-ready");
  });

  it("the unused materials split now calls the canonical gate", () => {
    const split = splitUnscheduledByMaterialsReady([
      { id: "ready", warehouseReadyAt: "2026-09-01", hasMaterialNeed: true },
      { id: "blocked", warehouseReadyAt: null, hasMaterialNeed: true },
      { id: "labor", warehouseReadyAt: null, hasMaterialNeed: false },
    ]);
    expect(split.ready.map((row) => row.id)).toEqual(["ready", "labor"]);
    expect(split.blocked.map((row) => row.id)).toEqual(["blocked"]);
    expect(assessScheduleMaterialsGate({
      hasMaterialNeed: true,
      warehouseReadyAt: null,
      overrideReason: null,
    }).ok).toBe(false);
  });

  it("home does not offer Schedule install when material is not ready", () => {
    const center = home("office", {
      deposits: [
        {
          id: "est-1",
          name: "Dan",
          approvedAt: "2026-09-22T12:00:00Z",
          amountLabel: "$500",
          customerId: "cust-1",
          ownerId: null,
        },
      ],
      unscheduled: [
        {
          id: "job-1",
          name: "Dan",
          assigneeId: null,
          customerId: "cust-1",
          customerOwnerId: null,
          hasMaterialNeed: true,
          warehouseReadyAt: null,
          href: "/jobs/job-1",
        },
      ],
    });
    const items = center.sections.flatMap((section) => section.items);
    expect(items.map((item) => item.action)).toContain("Collect deposit");
    expect(items.map((item) => item.action)).toContain("Review material");
    expect(items.map((item) => item.action)).not.toContain("Schedule install");
  });
});
