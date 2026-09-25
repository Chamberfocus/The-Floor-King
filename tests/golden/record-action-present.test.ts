/**
 * Action Center presentation. The decision model is unchanged.
 * The screen drops repeated sentences and keeps both independent buttons.
 */
import { describe, expect, it } from "vitest";
import { buildCustomerActionCenter } from "@/lib/record-action-center";
import { presentRecordAction } from "@/lib/present-record-action";
import type { UserRole } from "@/lib/types";

const NOW = new Date("2026-09-24T15:00:00.000Z");

function customer(role: UserRole, extra: Partial<Parameters<typeof buildCustomerActionCenter>[0]> = {}) {
  return buildCustomerActionCenter({ now: NOW, role, customerId: "c1", ...extra });
}

const readyJob = {
  id: "j1",
  title: "Flooring for Dan Nauman",
  status: "unscheduled",
  scheduledDate: null,
  warehouseReadyAt: "2026-09-16",
  hasMaterialNeed: true,
  createdAt: "2026-09-16",
};

describe("record action presentation", () => {
  it("shows collect deposit and schedule install without repeating the deposit fact", () => {
    const model = customer("office", {
      stageName: "Won — Collect Deposit",
      estimates: [{ id: "e1", status: "approved", approvedAt: "2026-09-16" }],
      jobs: [readyJob],
      depositOnFile: false,
    });
    const view = presentRecordAction(model);
    expect(model.primary?.label).toBe("Collect deposit");
    expect(model.secondary.map((row) => row.label)).toContain("Schedule install");
    expect(view.headline).toBe("Collect deposit");
    expect(view.headline).not.toContain("Won");
    expect(view.chips.map((chip) => chip.label)).toEqual([
      "Estimate approved",
      "Deposit due",
      "Install not booked",
    ]);
    expect(view.note).toBe("Deposit does not hold the installation date.");
    expect(view.warning).toBeNull();
    const text = JSON.stringify(view);
    expect(text.match(/deposit/gi)?.length).toBeLessThanOrEqual(3);
    expect(text).not.toContain("Needs attention");
    expect(text).not.toContain("Deposit not collected");
    expect(text).not.toContain("Deposit has not been collected");
  });

  it("keeps the material blocker and does not offer schedule install", () => {
    const model = customer("office", {
      estimates: [{ id: "e1", status: "approved" }],
      jobs: [{ ...readyJob, warehouseReadyAt: null }],
      depositOnFile: true,
    });
    const view = presentRecordAction(model);
    expect(model.primary?.label).toBe("Review material");
    expect(model.secondary.map((row) => row.label)).not.toContain("Schedule install");
    expect(view.headline).toBe("Review material");
    expect(view.warning).toMatch(/warehouse-ready/i);
    expect(view.chips.map((chip) => chip.label)).not.toContain("Install not booked");
    expect(view.note).toMatch(/after the material is ready/i);
  });

  it("does not let a missing deposit change a bookable install", () => {
    const open = customer("scheduler", {
      jobs: [readyJob],
      depositOnFile: false,
    });
    const paid = customer("scheduler", {
      jobs: [readyJob],
      depositOnFile: true,
    });
    expect(presentRecordAction(open).headline).toBe("Schedule install");
    expect(presentRecordAction(paid).headline).toBe("Schedule install");
    expect(presentRecordAction(open).chips.map((chip) => chip.label)).not.toContain("Deposit due");
  });

  it("stays quiet when nothing is due and keeps history out of the headline", () => {
    const model = customer("office", { stageName: "Won" });
    const view = presentRecordAction(model);
    expect(view.headline).toBeNull();
    expect(view.quiet).toBeTruthy();
    expect(view.chips).toEqual([]);
  });
});
