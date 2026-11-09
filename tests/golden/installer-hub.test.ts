/**
 * The installer phone is one hub: today's job, the work order, the board,
 * and days they cannot work. Updates reuse shop talk and the client thread.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { homeHrefForRole, mobileTabsForRole } from "@/lib/nav";
import {
  availabilityKindLabel,
  officeAvailabilityLabel,
} from "@/lib/crew-availability";
import { installerFocusJob, installerHubTab } from "@/lib/installer-hub";
import {
  installerCustomerMessage,
  installerShopBody,
  installerStoreEmails,
  installerUpdateActivity,
  parseInstallerAudiences,
  parseInstallerUpdate,
} from "@/lib/installer-update";

const page = readFileSync("src/app/(app)/installer/page.tsx", "utf8");
const update = readFileSync("src/app/(app)/installer/update-actions.ts", "utf8");
const board = readFileSync("src/components/job-board-list.tsx", "utf8");

describe("installer hub", () => {
  it("opens My Work when an installer signs in", () => {
    expect(homeHrefForRole("crew")).toBe("/installer");
    expect(homeHrefForRole("admin")).toBe("/home");
    expect(mobileTabsForRole("crew").map((tab) => tab.href)).toEqual([
      "/installer",
      "/board",
      "/jobs",
      "/shop-talk",
    ]);
  });

  it("keeps today, jobs, the board, and days off on one phone", () => {
    expect(installerHubTab(undefined)).toBe("today");
    expect(installerHubTab("board")).toBe("board");
    expect(installerHubTab("nope")).toBe("today");
    expect(page).toContain('label: "Today"');
    expect(page).toContain('label: "My jobs"');
    expect(page).toContain('label: "Job board"');
    expect(page).toContain('label: "Days off"');
    expect(page).toContain("Installation work order");
    expect(page).toContain("JobExtraForm");
    expect(page).toContain("JobPhotos");
    expect(page).toContain("InstallerCollect");
    expect(page).toContain("SatisfactionForm");
    expect(page).toContain("InstallerUpdateForm");
    expect(page).toContain("jobOperationsStatusLabel");
    expect(page).toContain('job.status === "completed"');
    expect(page).not.toMatch(/commission/i);
    expect(board).toContain("Claim this job");
    expect(board).toContain("applyToJob");
  });

  it("puts today's install ahead of a job that still needs a signature", () => {
    const jobs = [
      { id: "signed-wait", status: "completed", scheduled_date: "2026-11-01" },
      { id: "today", status: "scheduled", scheduled_date: "2026-11-08" },
      { id: "later", status: "scheduled", scheduled_date: "2026-11-10" },
    ];
    expect(installerFocusJob(jobs, "2026-11-08")?.id).toBe("today");
    expect(installerFocusJob([jobs[0]], "2026-11-08")?.id).toBe("signed-wait");
  });

  it("names a day off and a day the installer cannot work", () => {
    expect(availabilityKindLabel("off")).toBe("Day off");
    expect(availabilityKindLabel("busy")).toBe("Cannot work");
    expect(
      officeAvailabilityLabel({ kind: "off", label: "Time off", is_private: false }),
    ).toBe("Day off");
    expect(
      officeAvailabilityLabel({ kind: "busy", label: "Doctor", is_private: false }),
    ).toBe("Doctor");
    expect(
      officeAvailabilityLabel({ kind: "off", label: "Vacation", is_private: true }),
    ).toBe("Unavailable");
  });

  it("tells the store in shop talk and the customer only when asked", () => {
    expect(parseInstallerAudiences({ store: true, sales: true, customer: false })).toEqual([
      "store",
      "sales",
    ]);
    const activity = installerUpdateActivity({
      jobId: "11111111-1111-1111-1111-111111111111",
      body: "Living room is done.",
      audiences: ["store", "customer"],
    });
    expect(parseInstallerUpdate(activity)).toMatchObject({
      audiences: ["store", "customer"],
      detail: "Living room is done.",
    });
    expect(installerShopBody("Back tomorrow.")).toBe("Installer update: Back tomorrow.");
    expect(
      installerCustomerMessage({
        firstName: "Ada",
        installerName: "Sam",
        body: "We finished the living room.",
      }),
    ).toContain("Hello Ada");
    expect(installerCustomerMessage({
      firstName: "Ada",
      installerName: "Sam",
      body: "We finished the living room.",
    })).not.toMatch(/balance|cost|margin/i);
    expect(installerStoreEmails({ owner: "a@shop.test", staffEmails: ["a@shop.test", "b@shop.test"] })).toEqual([
      "a@shop.test",
      "b@shop.test",
    ]);
    expect(update).toContain("installerMayReportIssue");
    expect(update).toContain('audience: "shop"');
    expect(update).toContain('channel: "client"');
    expect(update).toContain("tell_customer");
    expect(update).toContain("installerCustomerMessage");
  });
});
