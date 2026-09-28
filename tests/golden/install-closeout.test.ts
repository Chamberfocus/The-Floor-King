import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assessJobStatusTransition,
  jobStatusUpdatePatch,
} from "@/lib/job-status";
import {
  canCompleteInstallation,
  canStartInstallation,
  customerSignOffRecorded,
  installCloseoutFacts,
  jobStatusEmployeeMessage,
  portalInstallScheduleCopy,
} from "@/lib/install-closeout";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("installation completion closeout", () => {
  it("starts only from a status the canonical transition allows", () => {
    expect(canStartInstallation("scheduled")).toBe(true);
    expect(canStartInstallation("unscheduled")).toBe(false);
    expect(canStartInstallation("in_progress")).toBe(false);
    expect(canStartInstallation("completed")).toBe(false);
    expect(canStartInstallation("cancelled")).toBe(false);
  });

  it("completes only from in progress, never from cancelled, paid, or scheduled", () => {
    expect(canCompleteInstallation("in_progress")).toBe(true);
    expect(canCompleteInstallation("scheduled")).toBe(false);
    expect(canCompleteInstallation("cancelled")).toBe(false);
    expect(canCompleteInstallation("completed")).toBe(false);
    expect(assessJobStatusTransition("cancelled", "completed").ok).toBe(false);
    expect(assessJobStatusTransition("scheduled", "completed").ok).toBe(false);
  });

  it("completion patch stamps completed_at and does not touch payment, warehouse, or callbacks", () => {
    const patch = jobStatusUpdatePatch(
      "completed",
      null,
      "2026-06-01T15:00:00.000Z",
    );
    expect(patch).toEqual({
      status: "completed",
      completed_at: "2026-06-01T15:00:00.000Z",
    });
    expect(patch).not.toHaveProperty("warehouse_ready_at");
    expect(patch).not.toHaveProperty("balance");
  });

  it("a recorded signature is not payment and does not close a callback", () => {
    expect(
      customerSignOffRecorded({ signature: "data:image/png;base64,abc" }),
    ).toBe(true);
    expect(customerSignOffRecorded({})).toBe(false);
    const facts = installCloseoutFacts({
      status: "completed",
      completedAt: "2026-06-01T15:00:00.000Z",
      signOffRecorded: true,
      photoCount: 2,
      openCallbacks: 1,
      openBalance: 150,
      formatMoney: (n) => `$${n}`,
    });
    expect(facts.installation).toBe("Completed");
    expect(facts.signOff).toBe("Recorded");
    expect(facts.photoCount).toBe(2);
    expect(facts.openCallbacks).toBe(1);
    expect(facts.balanceLabel).toBe("$150 remaining");
  });

  it("hides collection when the viewer is not authorized to see a balance", () => {
    const facts = installCloseoutFacts({
      status: "in_progress",
      completedAt: null,
      signOffRecorded: false,
      photoCount: 0,
      openCallbacks: 0,
      openBalance: null,
      formatMoney: (n) => `$${n}`,
    });
    expect(facts.balanceLabel).toBeNull();
    expect(facts.installation).toBe("In progress");
  });

  it("employee status errors stay free of database internals", () => {
    const msg = jobStatusEmployeeMessage("complete", "blocked", "cancelled");
    expect(msg).toMatch(/cancelled/i);
    expect(msg).not.toMatch(/postgres|sqlstate|pgrst/i);
    expect(jobStatusEmployeeMessage("complete", "save")).toMatch(/Refresh/);
  });

  it("portal copy uses completion status without internal notes", () => {
    const done = portalInstallScheduleCopy({
      status: "completed",
      scheduledDateLabel: "Jun 1, 2026",
      windowLabel: null,
      installerName: "Sam",
    });
    expect(done.title).toBe("Installation completed");
    expect(done.detail).toContain("Jun 1, 2026");
    expect(done.detail).not.toMatch(/margin|cost|callback/i);
  });

  it("job status writes still go through the canonical transition helper", () => {
    const actions = read("src/app/(app)/jobs/actions.ts");
    expect(actions).toContain("assessJobStatusTransition");
    expect(actions).toContain("jobStatusUpdatePatch");
    expect(actions).toContain("jobStatusEmployeeMessage");
    const closeout = read("src/lib/install-closeout.ts");
    expect(closeout).not.toMatch(/next action|recommended/i);
  });
});
