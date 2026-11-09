import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canDecideMaterialNotice,
  customerMaterialMessage,
  materialIssueActivity,
  materialNoticeActivity,
  parseMaterialIssue,
  parseMaterialNotice,
  receivingConditionNote,
} from "@/lib/material-notice";

const jobId = "11111111-1111-4111-8111-111111111111";

describe("material notices", () => {
  it("keeps the customer sentences professional and distinct", () => {
    const all = customerMaterialMessage("all", "Ada");
    const partial = customerMaterialMessage("partial", "Ada");
    expect(all.body).toContain("Everything needed for the installation is here");
    expect(all.body).toContain("reach out shortly to schedule");
    expect(partial.body).toContain("still waiting on the rest");
    expect(partial.body).not.toContain("Everything needed");
    expect(all.subject).not.toBe(partial.subject);
  });

  it("lets admin, the account owner, and that salesperson decide", () => {
    const owners = {
      salespersonId: "sales",
      accountOwnerId: "owner",
      jobOwnerId: "job-owner",
    };
    expect(canDecideMaterialNotice({ id: "admin", role: "admin" }, owners)).toBe(true);
    expect(canDecideMaterialNotice({ id: "sales", role: "salesman" }, owners)).toBe(true);
    expect(canDecideMaterialNotice({ id: "owner", role: "office" }, owners)).toBe(true);
    expect(canDecideMaterialNotice({ id: "job-owner", role: "sales_manager" }, owners)).toBe(true);
    expect(canDecideMaterialNotice({ id: "warehouse", role: "warehouse" }, owners)).toBe(false);
    expect(canDecideMaterialNotice({ id: "other", role: "salesman" }, owners)).toBe(false);
  });

  it("round-trips the activity the timeline and the card both read", () => {
    const notice = materialNoticeActivity({
      jobId,
      kind: "hold",
      detail: "The customer has not been told yet.",
    });
    expect(parseMaterialNotice(notice)).toEqual({
      jobId,
      kind: "hold",
      detail: "The customer has not been told yet.",
    });
    const issue = materialIssueActivity({
      jobId,
      kind: "damaged",
      detail: "Two cartons arrived crushed.",
    });
    expect(parseMaterialIssue(issue)?.kind).toBe("damaged");
  });

  it("does not count damaged pieces as a plain good receipt", () => {
    expect(receivingConditionNote("damaged", "corner crushed")).toBe(
      "Damaged — corner crushed",
    );
    expect(receivingConditionNote("missing", "two cartons")).toBe("Missing — two cartons");
    expect(receivingConditionNote("good", "")).toBeNull();
  });

  it("does not tell the customer when the warehouse marks material ready", () => {
    const jobs = readFileSync("src/app/(app)/jobs/actions.ts", "utf8");
    const ready = jobs.slice(jobs.indexOf("export async function completeWarehouseJob"));
    const head = ready.slice(0, ready.indexOf("export async function collectJobBalance"));
    expect(head).toContain("materialNoticeActivity");
    expect(head).toContain("materialStaffEmails");
    expect(head).toContain("The customer has not been told");
    expect(head).not.toContain("your materials are prepped");
    expect(head).not.toContain('channel: "client"');
    const notice = readFileSync("src/app/(app)/jobs/material-notice-actions.ts", "utf8");
    expect(notice).toContain("canDecideMaterialNotice");
    expect(notice).toContain('channel: "client"');
    expect(notice).toContain("customerMaterialMessage");
  });
});
