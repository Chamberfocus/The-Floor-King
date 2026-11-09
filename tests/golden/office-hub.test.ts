/**
 * The office desk is the financial home for office staff.
 * The owner still opens every screen, including this one.
 * Warehouse and sales do not get it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  homeHrefForRole,
  mobileTabsForRole,
  navGroupsForRole,
  navItemsForRole,
  pinnedItemsForRole,
  shellSectionsForRole,
} from "@/lib/nav";
import {
  officeInvoiceCounts,
  officeJobFollowUp,
} from "@/lib/office-hub";

const page = readFileSync("src/app/(app)/office/page.tsx", "utf8");

describe("office financial desk", () => {
  it("lands office on the desk and leaves the owner on the day list", () => {
    expect(homeHrefForRole("office")).toBe("/office");
    expect(homeHrefForRole("admin")).toBe("/home");
    expect(homeHrefForRole("salesman")).toBe("/home");
    expect(homeHrefForRole("warehouse")).toBe("/home");
    expect(homeHrefForRole("customer")).toBe("/portal");
  });

  it("puts money first for office and keeps the desk off warehouse and sales", () => {
    expect(navGroupsForRole("office")[0]?.id).toBe("money");
    for (const role of ["admin", "office"] as const) {
      expect(navItemsForRole(role).some((item) => item.href === "/office")).toBe(true);
      expect(shellSectionsForRole(role).some((section) =>
        section.items.some((item) => item.href === "/office"),
      )).toBe(true);
    }
    for (const role of ["salesman", "sales_manager", "scheduler", "crew", "warehouse"] as const) {
      expect(navItemsForRole(role).some((item) => item.href === "/office"), role).toBe(false);
    }
    expect(navItemsForRole("admin").some((item) => item.href === "/settings")).toBe(true);
    expect(navItemsForRole("admin").some((item) => item.href === "/pulse")).toBe(true);
    expect(navItemsForRole("office").some((item) => item.href === "/settings")).toBe(false);
    expect(navItemsForRole("office").some((item) => item.href === "/pulse")).toBe(false);
    expect(navItemsForRole("office").some((item) => item.href === "/home")).toBe(true);
    expect(pinnedItemsForRole("admin").map((item) => item.href)).toContain("/office");
    expect(pinnedItemsForRole("office").map((item) => item.href)).toContain("/home");
    expect(pinnedItemsForRole("office").map((item) => item.href)).not.toContain("/office");
    expect(mobileTabsForRole("office").map((tab) => tab.href)).toEqual([
      "/office",
      "/invoices",
      "/purchase-orders",
      "/customers",
    ]);
  });

  it("is only for the owner and office, and it uses the existing money screens", () => {
    expect(page).toContain('requireRole(["admin", "office"])');
    expect(page).toContain('"/invoices"');
    expect(page).toContain('"/purchase-orders"');
    expect(page).toContain('"/warehouse"');
    expect(page).toContain('"/bills"');
    expect(page).toContain('"/accounting"');
    expect(page).toContain("Settings and Business Pulse");
  });

  it("asks for an invoice only after the warehouse is ready or the job is finished", () => {
    expect(
      officeJobFollowUp({
        status: "scheduled",
        warehouseStatus: "pending",
        warehouseSubmittedAt: "2026-11-01",
        warehouseReadyAt: null,
        scheduledDate: null,
        invoiceCount: 0,
        openInvoiceCount: 0,
        draftInvoiceCount: 0,
      })?.lane,
    ).toBe("warehouse");

    expect(
      officeJobFollowUp({
        status: "unscheduled",
        warehouseStatus: "staged",
        warehouseSubmittedAt: "2026-11-01",
        warehouseReadyAt: "2026-11-02",
        scheduledDate: null,
        invoiceCount: 0,
        openInvoiceCount: 0,
        draftInvoiceCount: 0,
      }),
    ).toMatchObject({ lane: "invoice" });

    expect(
      officeJobFollowUp({
        status: "completed",
        warehouseStatus: "delivered",
        warehouseSubmittedAt: "2026-11-01",
        warehouseReadyAt: "2026-11-02",
        scheduledDate: "2026-11-03",
        invoiceCount: 0,
        openInvoiceCount: 0,
        draftInvoiceCount: 0,
      })?.next,
    ).toBe("The job is finished and there is no invoice yet.");

    expect(
      officeJobFollowUp({
        status: "completed",
        warehouseStatus: "delivered",
        warehouseSubmittedAt: null,
        warehouseReadyAt: "2026-11-02",
        scheduledDate: "2026-11-03",
        invoiceCount: 1,
        openInvoiceCount: 0,
        draftInvoiceCount: 1,
      })?.next,
    ).toBe("A draft invoice is sitting on this job. Send it.");

    expect(
      officeJobFollowUp({
        status: "unscheduled",
        warehouseStatus: "staged",
        warehouseSubmittedAt: "2026-11-01",
        warehouseReadyAt: "2026-11-02",
        scheduledDate: null,
        invoiceCount: 1,
        openInvoiceCount: 1,
        draftInvoiceCount: 0,
      })?.lane,
    ).toBe("install");

    expect(
      officeJobFollowUp({
        status: "cancelled",
        warehouseStatus: "pending",
        warehouseSubmittedAt: null,
        warehouseReadyAt: null,
        scheduledDate: null,
        invoiceCount: 0,
        openInvoiceCount: 0,
        draftInvoiceCount: 0,
      }),
    ).toBeNull();

    expect(
      officeJobFollowUp({
        status: "in_progress",
        warehouseStatus: "delivered",
        warehouseSubmittedAt: "2026-11-01",
        warehouseReadyAt: "2026-11-02",
        scheduledDate: "2026-11-03",
        invoiceCount: 1,
        openInvoiceCount: 1,
        draftInvoiceCount: 0,
      }),
    ).toBeNull();
  });

  it("ignores void invoices when deciding whether a job has been billed", () => {
    expect(
      officeInvoiceCounts([
        { status: "void" },
        { status: "draft" },
        { status: "sent" },
      ]),
    ).toEqual({ invoiceCount: 2, openInvoiceCount: 1, draftInvoiceCount: 1 });
  });
});
