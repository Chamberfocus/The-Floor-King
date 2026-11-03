/**
 * Customer record hierarchy. The action center stays the only "what now".
 * Overview does not repeat that decision in the checklist or the reminder.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ensureCustomerTabs,
  presentCustomerTabs,
  TAB_ORDER,
  type CustomerTab,
} from "@/lib/preferences";

const page = readFileSync("src/app/(app)/customers/[id]/page.tsx", "utf8");
const rollup = readFileSync("src/app/(app)/customers/[id]/job-roll-up.tsx", "utf8");
const reminder = readFileSync("src/app/(app)/customers/[id]/customer-next-action.tsx", "utf8");
const tabs = readFileSync("src/app/(app)/customers/[id]/customer-tabs.tsx", "utf8");
const layout = readFileSync("src/app/(app)/customers/layout.tsx", "utf8");

describe("customer record simplification", () => {
  it("keeps one decision surface and a collapsed progress summary", () => {
    expect(page).toContain("<RecordActionCenter");
    const person = page.indexOf("<h1");
    const decision = page.indexOf("<RecordActionCenter");
    const tools = page.indexOf("Handle this customer");
    const records = page.indexOf("<CustomerTabs");
    expect(person).toBeLessThan(decision);
    expect(decision).toBeLessThan(tools);
    expect(tools).toBeLessThan(records);
    expect(page.indexOf("customer.next_action_due ?")).toBeGreaterThan(decision);
    expect(page.indexOf("customer.next_action_due ?")).toBeLessThan(tools);
    expect(page).toContain("More actions");
    expect(page).toContain("Handle this customer");
    expect(page).toContain("plainLabels");
    expect(page).toContain("New job");
    expect(rollup).toContain("Job progress");
    expect(rollup).toContain("of {only.total} recorded");
    expect(rollup).not.toContain(">Next<");
    expect(reminder).toContain("Follow-up reminder");
    expect(reminder).not.toContain("Next required");
    expect(page).not.toContain("passed over");
  });

  it("hides invoice and costing tabs from a scheduler without opening the file to crew", () => {
    expect(page).toContain("customerSeesCustomerMoney");
    expect(page).toContain('tab !== "invoices" && tab !== "costing" && tab !== "history"');
    expect(layout).toContain("scheduler");
    expect(layout).not.toContain('"crew"');
    expect(layout).not.toContain('"warehouse"');
  });

  it("keeps hash deep links and does not add a second next-step headline", () => {
    expect(tabs).toContain("hashchange");
    expect(tabs).toContain("aria-current");
    expect(tabs).toContain("min-h-11");
    expect(page).not.toContain("Next required action");
    expect(page).not.toContain("Schedule this job");
  });

  it("reads the file in work order and leaves a custom tab list alone", () => {
    const legacy: CustomerTab[] = [
      "overview",
      "contact",
      "estimates",
      "jobs",
      "costing",
      "history",
      "invoices",
      "materials",
      "files",
      "messages",
      "activity",
    ];
    expect(presentCustomerTabs(legacy)).toEqual(TAB_ORDER);
    expect(presentCustomerTabs(["invoices", "overview"])).toEqual(["invoices", "overview"]);
    expect(ensureCustomerTabs(["overview", "estimates", "invoices", "files"], ["costing", "history"])).toEqual([
      "overview",
      "estimates",
      "invoices",
      "costing",
      "history",
      "files",
    ]);
    expect(page).toContain("presentCustomerTabs");
    expect(page).toContain("ensureCustomerTabs");
    expect(tabs).toContain("TAB_LABELS");
    expect(tabs).toContain("TAB_GROUP");
  });
});
