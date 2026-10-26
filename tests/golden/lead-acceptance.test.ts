import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  estimateBlockedUntilLeadAccepted,
  leadAcceptanceForAssignment,
  seesEveryLead,
} from "@/lib/lead-acceptance";
import { homeCommandsForRole } from "@/lib/home-command";

describe("lead acceptance", () => {
  it("lets the owner see every lead and asks the salesperson to accept", () => {
    expect(seesEveryLead("admin")).toBe(true);
    expect(seesEveryLead("office")).toBe(true);
    expect(seesEveryLead("sales_manager")).toBe(true);
    expect(seesEveryLead("salesman")).toBe(false);

    const pending = leadAcceptanceForAssignment({
      actorId: "owner",
      assigneeId: "rep",
      assigneeIsSales: true,
    });
    expect(pending?.lead_acceptance).toBe("pending");
    expect(pending?.lead_assigned_by).toBe("owner");

    const self = leadAcceptanceForAssignment({
      actorId: "rep",
      assigneeId: "rep",
      assigneeIsSales: true,
    });
    expect(self?.lead_acceptance).toBe("accepted");

    expect(
      estimateBlockedUntilLeadAccepted({
        role: "salesman",
        userId: "rep",
        assignedTo: "rep",
        acceptance: "pending",
      }),
    ).toBe(true);
    expect(
      estimateBlockedUntilLeadAccepted({
        role: "admin",
        userId: "owner",
        assignedTo: "rep",
        acceptance: "pending",
      }),
    ).toBe(false);
    expect(
      estimateBlockedUntilLeadAccepted({
        role: "salesman",
        userId: "rep",
        assignedTo: "rep",
        acceptance: "accepted",
      }),
    ).toBe(false);
  });

  it("puts the waiting leads on the owner's home and the accept action on the salesperson's home", () => {
    expect(homeCommandsForRole("admin").some((row) => row.id === "leads")).toBe(true);
    expect(homeCommandsForRole("admin").find((row) => row.id === "leads")?.href).toBe(
      "/customers?acceptance=pending",
    );
    expect(homeCommandsForRole("salesman").find((row) => row.id === "leads")?.singular).toBe(
      "lead to accept",
    );
    expect(homeCommandsForRole("admin").some((row) => row.id === "declines")).toBe(true);
    expect(homeCommandsForRole("salesman").some((row) => row.id === "declines")).toBe(false);
    expect(homeCommandsForRole("warehouse").map((row) => row.id)).toEqual(["warehouse"]);
    expect(homeCommandsForRole("crew").map((row) => row.id)).toEqual(["material", "today"]);
  });

  it("notifies by email and text and keeps the acceptance on the customer", () => {
    const notify = readFileSync("src/lib/lead-assignment-notify.ts", "utf8");
    expect(notify).toContain("sendEmail");
    expect(notify).toContain("sendSms");
    expect(notify).toContain("Accept the lead");
    const sql = readFileSync("supabase/migrations/0501_lead_acceptance.sql", "utf8");
    expect(sql).toContain("lead_acceptance");
    expect(sql).toContain("'pending'");
    expect(sql).toContain("'accepted'");
    expect(sql).toContain("'declined'");
    const actions = readFileSync("src/app/(app)/customers/actions.ts", "utf8");
    expect(actions).toContain("export async function acceptLead");
    expect(actions).toContain("export async function declineLead");
    expect(actions).toContain("Add a note explaining why you can't take this lead.");
  });
});
