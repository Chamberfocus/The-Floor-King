import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { installerSeesJob } from "@/lib/installer-assignment";
import { installerMayReportIssue } from "@/lib/ops-followup";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("crew assignment stays split on purpose", () => {
  const user = "user-1";
  const crew = "crew-1";

  it("seeing, photos, and problem reports include a linked crew", () => {
    expect(
      installerSeesJob({
        assignedTo: null,
        assignedCrewId: crew,
        userId: user,
        memberCrewIds: [crew],
      }),
    ).toBe(true);
    expect(
      installerMayReportIssue({
        role: "crew",
        actorId: user,
        assignedTo: null,
        assignedCrewId: crew,
        memberCrewIds: [crew],
      }),
    ).toBe(true);
    expect(
      installerSeesJob({
        assignedTo: null,
        assignedCrewId: crew,
        userId: user,
        memberCrewIds: [],
      }),
    ).toBe(false);
  });

  it("start and complete stay on assigned_to, not crew membership", () => {
    const jobs = read("src/app/(app)/jobs/actions.ts");
    const commit = jobs.slice(
      jobs.indexOf("async function commitJobStatus"),
      jobs.indexOf("export async function emailJobSchedule"),
    );
    expect(commit).toContain('profile.role === "crew" && prior.assigned_to !== profile.id');
    expect(commit).not.toContain("installerSeesJob");
    const collect = jobs.slice(jobs.indexOf("export async function collectJobBalance"));
    expect(collect).toContain("job.assigned_to !== user.id");
    const page = read("src/app/(app)/jobs/[id]/page.tsx");
    expect(page).toContain("isStaff || isDirectAssignee");
  });
});

describe("stage moves are office or scheduler only", () => {
  it("rejects other roles and hides database text", () => {
    const src = read("src/app/(app)/jobs/stage-actions.ts");
    expect(src).toContain('await assertRole(["admin", "office", "scheduler"])');
    expect(src).toContain("employeeDbError");
    expect(src).not.toContain("throw new Error(`Couldn't move the job: ${error.message}`)");
  });
});
