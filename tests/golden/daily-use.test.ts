import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { employeeDbError } from "@/lib/employee-error";
import { portalInstallScheduleCopy } from "@/lib/install-closeout";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("daily-use employee errors", () => {
  it("keeps a plain sentence and hides database text", () => {
    expect(employeeDbError("A name is required.", "fallback")).toBe("A name is required.");
    expect(
      employeeDbError(
        'duplicate key value violates unique constraint "customers_pkey"',
        "This customer could not be saved. Refresh and try again.",
      ),
    ).toBe("This customer could not be saved. Refresh and try again.");
    expect(employeeDbError("PGRST116", "Try again.")).toBe("Try again.");
  });
});

describe("portal completion fact", () => {
  it("shows the completion day without calling the job paid or resolved", () => {
    const copy = portalInstallScheduleCopy({
      status: "completed",
      scheduledDateLabel: "Jun 1, 2026",
      windowLabel: null,
      installerName: null,
      completedOnLabel: "Jun 2, 2026",
    });
    expect(copy.title).toBe("Installation completed");
    expect(copy.detail).toContain("Completed Jun 2, 2026");
    expect(copy.detail).not.toMatch(/paid|warranty|resolved|margin|cost/i);
  });

  it("still describes a completed job when no install date was stored", () => {
    const copy = portalInstallScheduleCopy({
      status: "completed",
      scheduledDateLabel: null,
      windowLabel: null,
      installerName: null,
      completedOnLabel: null,
    });
    expect(copy.title).toBe("Installation completed");
    expect(copy.detail).not.toMatch(/to be scheduled/i);
  });
});

describe("daily-use write guards", () => {
  it("job edits compare updated_at and crew completion requires the assignee", () => {
    const jobs = read("src/app/(app)/jobs/actions.ts");
    const edit = jobs.slice(
      jobs.indexOf("export async function updateJob"),
      jobs.indexOf("export async function setJobStatus"),
    );
    expect(edit).toContain("expected_updated_at");
    expect(edit).toContain('.eq("updated_at", expectedUpdatedAt)');
    const commit = jobs.slice(
      jobs.indexOf("async function commitJobStatus"),
      jobs.indexOf("export async function emailJobSchedule"),
    );
    expect(commit).toContain('profile.role === "crew"');
    expect(commit).toContain("prior.assigned_to !== profile.id");
    const ready = jobs.slice(jobs.indexOf("export async function completeWarehouseJob"));
    const readyHead = ready.slice(0, ready.indexOf("warehouse_ready_at: now"));
    expect(readyHead).toContain("if (jobRow.warehouse_ready_at) return { error: null }");
    expect(readyHead).not.toContain("receive_inventory_safe");
  });

  it("a failed file record removes only the object just uploaded", () => {
    const files = read("src/app/(app)/jobs/file-actions.ts");
    expect(files).toContain('.from("job-files").remove([args.path])');
    const portal = read("src/app/portal/page.tsx");
    expect(portal).toContain("listPortalCompletionDays");
    expect(portal).not.toContain("resolution_notes");
    expect(portal).not.toContain("material_cost");
  });
});
