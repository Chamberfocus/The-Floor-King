/**
 * Overview is a snapshot. Detail stays on the tabs.
 * It does not add another next-step surface.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/(app)/customers/[id]/page.tsx", "utf8");
const rollup = readFileSync("src/app/(app)/customers/[id]/job-roll-up.tsx", "utf8");
const docs = readFileSync("src/app/(app)/customers/[id]/document-shortcuts.tsx", "utf8");
const reminder = readFileSync("src/app/(app)/customers/[id]/customer-next-action.tsx", "utf8");
const tabs = readFileSync("src/app/(app)/customers/[id]/customer-tabs.tsx", "utf8");

describe("customer overview snapshot", () => {
  it("keeps the 14-step list behind a closed progress summary", () => {
    expect(rollup).toContain("of {only.total} recorded");
    expect(rollup).toContain("View progress");
    expect(rollup).toContain("role=\"progressbar\"");
    expect(rollup).toContain("<details");
    expect(rollup).toContain("View all jobs");
    expect(rollup).toContain('j.status !== "completed"');
    expect(rollup).not.toContain(">Next<");
    expect(page).not.toContain("Next required action");
    expect(page).not.toContain("passed over");
  });

  it("keeps money on the existing totals and off the scheduler", () => {
    expect(page).toContain("seesMoney && depositSummary");
    expect(page).toContain("View invoices");
    expect(page).toContain("formatMoney(money.balance)");
    expect(page).toContain("formatMoney(depositSummary.available)");
    expect(page).toContain('tab !== "invoices" && tab !== "costing" && tab !== "history"');
  });

  it("points documents and contact at the existing tabs", () => {
    expect(docs).toContain('href="#files"');
    expect(docs).toContain("if (!ready.length) return null");
    expect(page).toContain('href="#contact"');
    expect(tabs).toContain("hashchange");
    expect(reminder).toContain("Snooze only moves this reminder");
    expect(reminder).toContain("Follow-up reminder");
  });

  it("shows the follow-up card only when a reminder date exists", () => {
    expect(page).toContain("customer.next_action_due ?");
    expect(reminder).toContain("if (!nextActionDue) return null");
    expect(reminder).not.toContain("No follow-up date set");
    expect(reminder).toContain("· overdue");
    expect(reminder).toContain("ALLOWED_SNOOZE_DAYS");
    expect(reminder).toContain("About snooze");
    expect(reminder).not.toContain("Next required");
    expect(page).not.toContain("Next required action");
  });
});
