import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildChecklist, type ChecklistInput } from "@/lib/job-checklist";

function freshLead(): ChecklistInput {
  return {
    customerId: "c1",
    estimate: null,
    approvedEstimateId: null,
    job: null,
    invoice: null,
    depositPaid: false,
    balanceOutstanding: 0,
    hasActivity: false,
    estimateBooked: false,
    materialsOrdered: false,
    satisfactionSigned: false,
  };
}

describe("job progress clicks", () => {
  it("gives every step on a new lead a place to go", () => {
    const steps = buildChecklist(freshLead());
    expect(steps).toHaveLength(14);
    for (const step of steps) {
      expect(step.href, step.key).toBeTruthy();
    }
    expect(steps.find((step) => step.key === "contact")?.href).toBe("/customers/c1#activity");
    expect(steps.find((step) => step.key === "measure")?.href).toBe(
      "/customers/c1?schedule=estimate#overview",
    );
    expect(steps.find((step) => step.key === "build")?.href).toBe("/estimates/start?customer=c1");
    expect(steps.find((step) => step.key === "workorder")?.linkLabel).toBe("Start the estimate");
  });

  it("opens a job once the estimate is approved and there is no work order yet", () => {
    const steps = buildChecklist({
      ...freshLead(),
      estimate: { id: "e1", status: "approved" },
      approvedEstimateId: "e1",
      estimateBooked: true,
      hasActivity: true,
    });
    expect(steps.find((step) => step.key === "order")?.href).toBe("/estimates/e1/order");
    expect(steps.find((step) => step.key === "workorder")?.href).toBe("/jobs/new?customer=c1");
    expect(steps.find((step) => step.key === "schedule")?.linkLabel).toBe("Open a job");
  });

  it("uses real links and keeps the estimate dialog open until it is closed", () => {
    const checklist = readFileSync("src/components/job-checklist.tsx", "utf8");
    const tabs = readFileSync("src/app/(app)/customers/[id]/customer-tabs.tsx", "utf8");
    const dialog = readFileSync("src/app/(app)/customers/[id]/schedule-visit-dialog.tsx", "utf8");
    const page = readFileSync("src/app/(app)/customers/[id]/page.tsx", "utf8");
    expect(checklist).toContain("min-h-11");
    expect(checklist).toContain("<a");
    expect(checklist).not.toContain("next/link");
    expect(tabs).toContain("hashchange");
    expect(tabs).toContain('closest("a")');
    expect(tabs).toContain("popstate");
    const effect = dialog.slice(dialog.indexOf("useEffect"), dialog.indexOf("const onOpenChange"));
    expect(effect).not.toContain("searchParams.delete");
    expect(dialog).toContain('searchParams.delete("schedule")');
    expect(dialog).toContain("autoOpen");
    expect(page).toContain('open={openScheduler === "estimate"}');
    expect(page).toContain('openOnLoad={openScheduler === "install" ? "install" : null}');
  });
});
