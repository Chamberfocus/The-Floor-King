/**
 * The customer dashboard shows the stage the store moved, and labels
 * messages as the salesperson or the store.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { workUnitsFor } from "@/lib/work-stage";
import { clientStatusLane } from "@/lib/client-status-lanes";
import { portalSpeaker, presentPortalStage } from "@/lib/portal-dashboard";

function src(path: string) {
  return readFileSync(path, "utf8");
}

const measure = {
  id: "measure",
  name: "Measure booked",
  position: 40,
  outcome: "active" as const,
};
const quoteOut = {
  id: "quote",
  name: "Quote with the customer",
  position: 55,
  outcome: "active" as const,
};

describe("customer project stage", () => {
  it("uses the stage name the store saved, and the same lane as Client status", () => {
    const shown = presentPortalStage(quoteOut);
    expect(shown.name).toBe("Quote with the customer");
    expect(shown.lane).toBe(clientStatusLane(quoteOut));
    expect(shown.lane).toBe("out");
    expect(shown.closed).toBe(false);

    const earlier = presentPortalStage(measure);
    expect(earlier.name).toBe("Measure booked");
    expect(earlier.lane).toBe("quoting");
    expect(earlier.lane).not.toBe(shown.lane);
  });

  it("follows the job stage when the store moves that job, not the account", () => {
    const units = workUnitsFor(
      {
        id: "cust",
        full_name: "Ada",
        workflow_stage_id: measure.id,
        assigned_to: "rep",
      },
      [
        {
          id: "job-1",
          title: "Kitchen",
          status: "scheduled",
          site_street: "1 Main",
          workflow_stage_id: quoteOut.id,
          workflow_owner_id: "rep",
        },
      ],
    );
    expect(units).toHaveLength(1);
    expect(units[0]?.stageId).toBe(quoteOut.id);
    expect(units[0]?.ownerId).toBe("rep");
    expect(presentPortalStage(quoteOut).name).toBe("Quote with the customer");
  });

  it("says a lost stage is closed and a parked stage is on hold", () => {
    const lost = presentPortalStage({
      id: "lost",
      name: "Lost",
      position: 20,
      outcome: "lost",
    });
    expect(lost.closed).toBe(true);
    expect(lost.lane).toBeNull();

    const parked = presentPortalStage({
      id: "hold",
      name: "On hold",
      position: 40,
      outcome: "parked",
    });
    expect(parked.parked).toBe(true);
    expect(parked.name).toBe("On hold");
    expect(parked.detail).toMatch(/on hold/i);
  });

  it("labels the project owner as the salesperson and everyone else as the store", () => {
    expect(
      portalSpeaker({
        authorId: "me",
        viewerId: "me",
        authorName: "Ada",
        salespersonIds: ["rep"],
      }),
    ).toEqual({ who: "You", kind: "you" });
    expect(
      portalSpeaker({
        authorId: "rep",
        viewerId: "me",
        authorName: "Sam",
        salespersonIds: ["rep"],
      }),
    ).toEqual({ who: "Sam · Your salesperson", kind: "salesperson" });
    expect(
      portalSpeaker({
        authorId: "office",
        viewerId: "me",
        authorName: "Pat",
        salespersonIds: ["rep"],
      }),
    ).toEqual({ who: "Pat · The store", kind: "store" });
  });

  it("reads the job stage through the customer view and the shared lane", () => {
    const home = src("src/app/portal/page.tsx");
    expect(home).toContain("listPortalProjects");
    expect(src("src/lib/data/portal-projects.ts")).toContain("workUnitsFor");
    expect(src("src/app/(app)/client-status/page.tsx")).toContain("clientStatusLane");
    const sql = src("supabase/migrations/0508_portal_job_stage.sql");
    expect(sql).toContain("j.workflow_stage_id");
    expect(sql).not.toContain("assigned_to");
    expect(sql).not.toContain("material_cost");
    expect(src("src/app/portal/messages/page.tsx")).toContain("portalSpeaker");
  });
});
