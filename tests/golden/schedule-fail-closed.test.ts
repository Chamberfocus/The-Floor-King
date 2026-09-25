/**
 * Phase H hardening: missing schedule RPC fails closed, and a PO does not
 * invent material need when the job scope has no material lines.
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
import { assessJobOperationalState } from "@/lib/job-operational-state";
import {
  isScheduleRpcUnavailable,
  SCHEDULE_UNAVAILABLE_MESSAGE,
} from "@/lib/scheduling-conflicts";

const NOW = new Date("2026-09-24T15:00:00Z");

function src(path: string): string {
  return readFileSync(path, "utf8");
}

function between(file: string, start: string, end: string): string {
  const text = src(file);
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return text.slice(a, b);
}

describe("schedule RPC fails closed", () => {
  it("recognizes a missing schedule function and ignores unrelated errors", () => {
    expect(
      isScheduleRpcUnavailable({
        code: "PGRST202",
        message: "Could not find the function public.schedule_job_install_safe",
      }),
    ).toBe(true);
    expect(
      isScheduleRpcUnavailable({
        message: "function schedule_job_install_safe does not exist",
      }),
    ).toBe(true);
    expect(
      isScheduleRpcUnavailable({
        code: "23505",
        message: "duplicate key value violates unique constraint",
      }),
    ).toBe(false);
    expect(SCHEDULE_UNAVAILABLE_MESSAGE).toBe(
      "Scheduling is temporarily unavailable. Please try again or contact an administrator.",
    );
  });

  it("book, reschedule, assign, new job, carry-over, and assistant do not write the date directly", () => {
    const book = between(
      "src/app/(app)/jobs/actions.ts",
      "export async function bookInstall",
      "export async function rescheduleInstall",
    );
    const move = between(
      "src/app/(app)/jobs/actions.ts",
      "export async function rescheduleInstall",
      "export async function setJobArrivalWindow",
    );
    const assign = between(
      "src/app/(app)/jobs/actions.ts",
      "export async function assignInstaller",
      "export async function sendJobToWarehouse",
    );
    const created = between(
      "src/app/(app)/jobs/new/actions.ts",
      "Same hard gate as Book install",
      "restartFlowForNewWork",
    );
    const carry = between(
      "src/app/(app)/carry-over/actions.ts",
      "Copy operational lines",
      "Invoice for the contract",
    );
    const assistant = between(
      "src/app/(app)/assistant/actions.ts",
      'case "reschedule_job": {',
      'case "add_note"',
    );
    for (const body of [book, move, assign, created, carry, assistant]) {
      expect(body).toContain("schedule_job_install_safe");
      expect(body).toContain("isScheduleRpcUnavailable");
      expect(body).toContain("SCHEDULE_UNAVAILABLE_MESSAGE");
      expect(body).not.toMatch(/\.update\(\{[^}]*scheduled_date/);
      expect(body).not.toContain("Pre-0178");
    }
    expect(book.indexOf("enforceMaterialsReadyForSchedule")).toBeLessThan(
      book.indexOf("schedule_job_install_safe"),
    );
    expect(move.indexOf("enforceMaterialsReadyForSchedule")).toBeLessThan(
      move.indexOf("schedule_job_install_safe"),
    );
  });
});

describe("no material lines stay schedulable", () => {
  it("the schedule gate reads operational lines and does not read purchase orders", () => {
    const gate = between(
      "src/app/(app)/jobs/actions.ts",
      "export async function enforceMaterialsReadyForSchedule",
      "const BOOK_INSTALL_ROLES",
    );
    expect(gate).toContain("loadOperationalJobLines");
    expect(gate).toContain("isMaterialLine");
    expect(gate).toContain("assessScheduleMaterialsGate");
    expect(gate).not.toContain("purchase_orders");
    expect(gate).toContain("hasMaterialNeed = true");
    expect(src("src/lib/materials-ready.ts")).not.toMatch(/deposit|purchasing|purchase_orders/i);
  });

  it("no material lines schedule, with or without a purchase order fact", () => {
    expect(
      assessMaterialsReadyForSchedule({
        hasMaterialNeed: false,
        warehouseReadyAt: null,
      }),
    ).toEqual({ ready: true, reason: "no_material_need" });
    expect(
      assessScheduleMaterialsGate({
        hasMaterialNeed: false,
        warehouseReadyAt: null,
        overrideReason: null,
      }),
    ).toEqual({ ok: true, override: false });
  });

  it("material lines follow warehouse readiness, and purchasing is not the gate", () => {
    expect(
      assessMaterialsReadyForSchedule({
        hasMaterialNeed: true,
        warehouseReadyAt: null,
      }).ready,
    ).toBe(false);
    expect(
      assessMaterialsReadyForSchedule({
        hasMaterialNeed: true,
        warehouseReadyAt: "2026-09-23T00:00:00Z",
      }).reason,
    ).toBe("warehouse_ready");
    const ops = assessJobOperationalState({
      status: "unscheduled",
      scheduledDate: null,
      warehouseReadyAt: "2026-09-23T00:00:00Z",
      hasMaterialNeed: true,
      activeHold: null,
      hasPurchasingGap: true,
    });
    expect(ops.blockerCode).toBe("needs_purchasing");
    const model = buildJobActionCenter({
      now: NOW,
      role: "office",
      jobId: "job-1",
      title: "Kitchen",
      status: "unscheduled",
      hasMaterialNeed: true,
      warehouseReadyAt: "2026-09-23T00:00:00Z",
      ops,
    });
    expect(model.primary?.label).toBe("Schedule install");
  });

  it("deposit due does not block a ready install, and a paid deposit does not clear a material hold", () => {
    const ready = buildCustomerActionCenter({
      now: NOW,
      role: "office",
      customerId: "cust-1",
      depositOnFile: false,
      estimates: [
        {
          id: "est-1",
          status: "approved",
          approvalStale: false,
        },
      ],
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
    expect(ready.secondary.map((row) => row.label)).toContain("Schedule install");
    const held = buildEstimateActionCenter({
      now: NOW,
      role: "office",
      estimateId: "est-1",
      customerId: "cust-1",
      status: "approved",
      depositOnFile: true,
      linkedJob: {
        id: "job-1",
        title: "Kitchen",
        bookable: false,
        materialBlocked: true,
      },
    });
    expect(held.primary?.label).toBe("Review material");
    expect(JSON.stringify(held)).not.toContain("Schedule install");
    const home = buildHomeCenter({
      now: NOW,
      role: "office",
      userId: "user-1",
      firstName: "Alex",
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
    } satisfies HomeSignals);
    const actions = home.sections.flatMap((section) => section.items).map((item) => item.action);
    expect(actions).toContain("Collect deposit");
    expect(actions).toContain("Review material");
    expect(actions).not.toContain("Schedule install");
  });
});
