import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessServiceTransition,
  canMoveServiceTo,
  serviceEmployeeMessage,
  serviceReportedAge,
  serviceResolvePatch,
  serviceSchedulePatch,
  serviceStatusLabel,
} from "@/lib/service-callback";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("service callbacks stay on the existing record", () => {
  it("uses the stored statuses and does not reopen a resolved issue", () => {
    expect(serviceStatusLabel("waiting")).toBe("Waiting");
    expect(assessServiceTransition("open", "scheduled").ok).toBe(true);
    expect(assessServiceTransition("scheduled", "in_progress").ok).toBe(true);
    expect(assessServiceTransition("resolved", "open").ok).toBe(false);
    expect(assessServiceTransition("cancelled", "resolved").ok).toBe(false);
    expect(canMoveServiceTo("resolved", "in_progress")).toBe(false);
  });

  it("schedules a visit without touching the installation", () => {
    const patch = serviceSchedulePatch("2026-06-02T12:00:00.000Z");
    expect(patch.status).toBe("scheduled");
    expect(patch.follow_up_at).toBe("2026-06-02T12:00:00.000Z");
    expect(patch).not.toHaveProperty("scheduled_date");
    expect(patch).not.toHaveProperty("warehouse_ready_at");
    expect(patch).not.toHaveProperty("completed_at");
  });

  it("resolves the callback only", () => {
    const patch = serviceResolvePatch("Seam reset", "2026-06-03T15:00:00.000Z");
    expect(patch).toEqual({
      status: "resolved",
      resolution_notes: "Seam reset",
      completed_at: "2026-06-03T15:00:00.000Z",
      updated_at: "2026-06-03T15:00:00.000Z",
    });
    expect(patch).not.toHaveProperty("balance");
    expect(serviceEmployeeMessage("resolve")).toMatch(/Refresh/);
    expect(serviceEmployeeMessage("resolve")).not.toMatch(/postgres|pgrst|sqlstate/i);
  });

  it("ages from the reported date without a score", () => {
    const label = serviceReportedAge("2026-06-01", new Date("2026-06-04T12:00:00Z"));
    expect(label).toBe("Reported 3 days ago");
    expect(label).not.toMatch(/priority|severity|sla/i);
  });

  it("service writes stay on service_callbacks", () => {
    const actions = read("src/app/(app)/ops/actions.ts");
    expect(actions).toContain('.from("service_callbacks")');
    expect(actions).toContain("serviceSchedulePatch");
    expect(actions).toContain("serviceResolvePatch");
    expect(actions).not.toContain("schedule_job_install_safe");
    const portal = read("src/app/portal/page.tsx");
    expect(portal).not.toContain("service_callbacks");
    expect(portal).not.toContain("resolution_notes");
  });
});
