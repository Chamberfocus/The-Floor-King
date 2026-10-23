/**
 * The people who run the floor can finish the step in front of them.
 * A sales manager and the scheduler can open a job the page already allows.
 * Warehouse notes stay on the warehouse board. A ledger report error does not
 * take the accounting screen down.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("store floor reliability", () => {
  it("shows Edit and Close out to the roles those pages already allow", () => {
    const page = src("src/app/(app)/jobs/[id]/page.tsx");
    expect(page).toContain(
      'const canEditJob = ["admin", "office", "sales_manager", "scheduler"].includes(profile.role);',
    );
    expect(page).toContain(
      'const canCloseOut = ["admin", "office", "sales_manager"].includes(profile.role);',
    );
    const edit = page.indexOf("const canEditJob");
    const link = page.indexOf("href={`/jobs/${id}/edit`}");
    expect(edit).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(edit);
    expect(page).toContain("{canEditJob ? (");
    expect(page).toContain("{canCloseOut ? (");
    const staffTrueUp = page.indexOf("True-up");
    const staffGuard = page.lastIndexOf("{isStaff ? (", staffTrueUp);
    expect(staffGuard).toBeGreaterThan(-1);
    expect(staffGuard).toBeLessThan(staffTrueUp);
    expect(page.indexOf("My commission")).toBeGreaterThan(-1);
  });

  it("keeps a warehouse order note on the delivery card", () => {
    const notes = src("src/app/(app)/warehouse/warehouse-notes.tsx");
    expect(notes).toContain('role === "warehouse" ? `/warehouse#po-${n.po_id}`');
    expect(notes).toContain("`/purchase-orders/${n.po_id}`");
    const board = src("src/app/(app)/warehouse/incoming-deliveries.tsx");
    expect(board).toContain("id={`po-${po.id}`}");
    expect(board).toContain("scroll-mt-24");
    expect(src("src/app/(app)/warehouse/page.tsx")).toContain(
      "<WarehouseNotes notes={warehouseNotes} canPost role={profile.role} />",
    );
  });

  it("leaves the accounting screen up when a ledger report fails", () => {
    const page = src("src/app/(app)/accounting/page.tsx");
    expect(page).toContain("async function loadFloorReports");
    expect(page).toContain("if (!reports.ok)");
    expect(page).toContain('href="/invoices"');
    expect(page).toContain('href="/bills"');
    expect(page).toContain("QUICKBOOKS_STAYS_OFFICIAL");
    const guard = page.indexOf("if (!reports.ok)");
    const use = page.indexOf("const { tb, pnl, bs, exceptions, cutover } = reports;");
    expect(guard).toBeGreaterThan(-1);
    expect(use).toBeGreaterThan(guard);
  });
});
