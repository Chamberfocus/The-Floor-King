import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("daily work opens without waiting on each query", () => {
  it("loads a job in one wave and keeps the work-order lines", () => {
    const page = read("src/app/(app)/jobs/[id]/page.tsx");
    expect(page).toContain("await Promise.all([");
    expect(page).toContain("getJobChecklist");
    expect(page).toContain("buildInstallScheduleProps");
    expect(page).toContain("{l.note}");
    expect(page).toContain("canManageMaterials = isStaff || profile.role === \"sales_manager\"");
    expect(page).toContain("profile.role === \"admin\" ? getJobCostAnalysis(id)");
  });

  it("counts open invoices without reading the whole invoice book first", () => {
    const dash = read("src/app/(app)/dashboard/page.tsx");
    expect(dash).toContain("await Promise.all([");
    expect(dash).toContain("placeInStockOrdersOnCustomerInvoices");
    expect(dash.match(/listAssignableUsers\(/g)?.length).toBe(1);
    const invoices = read("src/lib/data/invoices.ts");
    const countStart = invoices.indexOf("export async function getOutstandingInvoiceCount");
    const countBody = invoices.slice(countStart, countStart + 400);
    expect(countBody).toContain("countInvoicesWithOpenAr");
    expect(countBody).not.toContain("cancelled_at");
    expect(countBody).not.toContain("listInvoices()");
    expect(invoices.slice(countStart, countStart + 900)).toContain('.or("status.is.null,status.neq.void")');
  });

  it("loads an estimate, its editor, and an invoice together", () => {
    expect(read("src/app/(app)/estimates/[id]/page.tsx")).toContain("await Promise.all([");
    expect(read("src/app/(app)/estimates/[id]/page.tsx")).toContain("computeBillRecovery");
    expect(read("src/app/(app)/estimates/[id]/edit/page.tsx")).toContain("await Promise.all([");
    expect(read("src/app/(app)/invoices/[id]/page.tsx")).toContain("await Promise.all([");
    expect(read("src/app/(app)/invoices/[id]/page.tsx")).toContain("getInvoiceProfit");
  });
});
