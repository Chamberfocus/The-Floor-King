import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { LeadAssignFields } from "@/app/(app)/customers/lead-assign-fields";
import {
  assignedLeadOwner,
  canAssignLead,
  canOwnSalesLead,
  leadStageForVisit,
  parseLeadEstimateVisit,
} from "@/lib/lead-intake";

describe("lead intake", () => {
  it("lets the office assign an owner or a salesperson, and keeps a salesperson on their own book", () => {
    expect(canAssignLead("office")).toBe(true);
    expect(canAssignLead("admin")).toBe(true);
    expect(canAssignLead("scheduler")).toBe(true);
    expect(canAssignLead("salesman")).toBe(false);
    expect(canOwnSalesLead("admin")).toBe(true);
    expect(canOwnSalesLead("salesman")).toBe(true);
    expect(canOwnSalesLead("office")).toBe(false);

    expect(
      assignedLeadOwner({
        actorId: "office-1",
        actorRole: "office",
        requestedId: "owner-1",
        requestedRole: "admin",
      }).assignedTo,
    ).toBe("owner-1");

    const sales = assignedLeadOwner({
      actorId: "office-1",
      actorRole: "office",
      requestedId: "rep-1",
      requestedRole: "salesman",
    });
    expect(sales.assignedTo).toBe("rep-1");
    expect(sales.acceptance?.lead_acceptance).toBe("pending");

    expect(
      assignedLeadOwner({
        actorId: "rep-1",
        actorRole: "salesman",
        requestedId: "rep-2",
        requestedRole: "salesman",
      }).assignedTo,
    ).toBe("rep-1");
  });

  it("books a visit only when the day is real and the window moves forward", () => {
    expect(parseLeadEstimateVisit({ date: "", time: "09:00", end: "11:00" })).toBeNull();
    expect(parseLeadEstimateVisit({ date: "2026-12-02", time: "", end: "" })).toEqual({
      date: "2026-12-02",
      time: "09:00",
      end: "11:00",
    });
    expect(parseLeadEstimateVisit({ date: "2026-02-31", time: "09:00", end: "11:00" })).toEqual({
      error: "Enter a real day for the estimate visit.",
    });
    expect(parseLeadEstimateVisit({ date: "2026-12-02", time: "14:00", end: "09:00" })).toEqual({
      error: "The estimate window has to end after it starts.",
    });
    expect(leadStageForVisit("new", true)).toBe("estimate_scheduled");
    expect(leadStageForVisit("quoted", true)).toBe("quoted");
    expect(leadStageForVisit("new", false)).toBe("new");
  });

  it("puts the salesperson and the visit on both add-customer forms", () => {
    const main = readFileSync("src/app/(app)/customers/customer-form.tsx", "utf8");
    const safe = readFileSync("src/app/(app)/new-customer/full-safe-customer-form.tsx", "utf8");
    const fields = readFileSync("src/app/(app)/customers/lead-assign-fields.tsx", "utf8");
    expect(main).toContain("<LeadAssignFields");
    expect(safe).toContain("<LeadAssignFields");
    expect(fields).toContain('name="assigned_to"');
    expect(fields).toContain('name="estimate_date"');
    expect(fields).toContain("Leave the day blank");
  });

  it("renders a salesperson picker and an optional visit on the lead form", () => {
    const html = renderToStaticMarkup(
      createElement(LeadAssignFields, {
        assignees: [{ id: "rep-1", name: "Sam Seller" }],
      }),
    );
    expect(html).toContain("Salesperson");
    expect(html).toContain("Choose a salesperson");
    expect(html).toContain('name="assigned_to"');
    expect(html).toContain('name="estimate_date"');
    expect(html).toContain('type="date"');
    expect(html).toContain('name="estimate_time"');
    expect(html).toContain('value="09:00"');
    expect(html).toContain('name="estimate_end"');
    expect(html).toContain("does not text the customer");
  });
});
