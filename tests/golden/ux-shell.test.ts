/**
 * Phase A navigation shell. Proves the new grouping does not grant or remove
 * destinations, and that active-state, mobile tabs, and + New stay inside the
 * classic role model.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NAV_GROUPS,
  QUICK_CREATE,
  activeShellLink,
  activeShellSection,
  homeHrefForRole,
  isCollapsibleShellSection,
  mobileTabsForRole,
  navItemsForRole,
  openShellGroups,
  quickCreateForRole,
  quickCreatePlacement,
  resolveUxShell,
  shellSectionsForRole,
} from "@/lib/nav";
import type { UserRole } from "@/lib/types";

const STAFF: UserRole[] = [
  "admin",
  "office",
  "sales_manager",
  "salesman",
  "scheduler",
  "crew",
  "warehouse",
];

function shellHrefs(role: UserRole): Set<string> {
  return new Set(
    shellSectionsForRole(role).flatMap((section) => section.items.map((item) => item.href)),
  );
}

describe("Phase A shell destinations", () => {
  it("keeps every classic destination except New job, which lives in + New", () => {
    for (const role of STAFF) {
      const classic = new Set(navItemsForRole(role).map((item) => item.href));
      const shell = shellHrefs(role);
      const create = new Set(quickCreateForRole(role).map((action) => action.href));
      for (const href of shell) expect(classic.has(href), `${role} gained ${href}`).toBe(true);
      for (const href of classic) {
        expect(
          shell.has(href) || create.has(href),
          `${role} lost ${href}`,
        ).toBe(true);
      }
      expect(shell.has("/jobs/new"), role).toBe(false);
    }
  });

  it("keeps the classic Client status label on the fallback nav", () => {
    const sales = NAV_GROUPS.find((group) => group.id === "sales");
    expect(sales?.items.find((item) => item.href === "/client-status")?.label).toBe(
      "Client status",
    );
  });

  it("gives the customer role no staff destinations", () => {
    expect(shellSectionsForRole("customer")).toEqual([]);
    expect(mobileTabsForRole("customer")).toEqual([]);
    expect(quickCreateForRole("customer")).toEqual([]);
    expect(navItemsForRole("customer")).toEqual([]);
  });

  it("keeps admin on settings, accounting, pulse, and purchasing", () => {
    const hrefs = shellHrefs("admin");
    for (const href of [
      "/settings",
      "/accounting",
      "/pulse",
      "/reports",
      "/dashboard",
      "/purchase-orders",
      "/installer",
    ]) {
      expect(hrefs.has(href), href).toBe(true);
    }
  });

  it("does not hand salesman or scheduler accounting, settings, or pulse", () => {
    for (const role of ["salesman", "scheduler"] as const) {
      const hrefs = shellHrefs(role);
      expect(hrefs.has("/accounting"), role).toBe(false);
      expect(hrefs.has("/settings"), role).toBe(false);
      expect(hrefs.has("/pulse"), role).toBe(false);
      expect(hrefs.has("/financials"), role).toBe(false);
      expect(hrefs.has("/dashboard"), role).toBe(false);
    }
  });

  it("does not hand the scheduler invoices, purchase orders, or bills", () => {
    const hrefs = shellHrefs("scheduler");
    expect(hrefs.has("/invoices")).toBe(false);
    expect(hrefs.has("/purchase-orders")).toBe(false);
    expect(hrefs.has("/bills")).toBe(false);
    expect(hrefs.has("/team")).toBe(false);
    expect(hrefs.has("/install-scheduler")).toBe(true);
    expect(hrefs.has("/calendar")).toBe(true);
  });

  it("keeps crew on My Work and off money", () => {
    const hrefs = shellHrefs("crew");
    expect(homeHrefForRole("crew")).toBe("/installer");
    expect(hrefs.has("/installer")).toBe(true);
    expect(hrefs.has("/jobs")).toBe(true);
    expect(hrefs.has("/board")).toBe(true);
    expect(hrefs.has("/invoices")).toBe(false);
    expect(hrefs.has("/accounting")).toBe(false);
    expect(hrefs.has("/customers")).toBe(false);
    expect(quickCreateForRole("crew")).toEqual([]);
    expect(shellSectionsForRole("crew").some((section) => section.id === "money")).toBe(false);
  });

  it("keeps warehouse on inventory and the warehouse queue", () => {
    const hrefs = shellHrefs("warehouse");
    expect(hrefs.has("/inventory")).toBe(true);
    expect(hrefs.has("/warehouse")).toBe(true);
    expect(hrefs.has("/customers")).toBe(false);
    expect(hrefs.has("/invoices")).toBe(false);
    expect(hrefs.has("/accounting")).toBe(false);
    expect(hrefs.has("/purchase-orders")).toBe(false);
    expect(hrefs.has("/settings")).toBe(false);
    expect(quickCreateForRole("warehouse")).toEqual([]);
    expect(homeHrefForRole("warehouse")).toBe("/inventory");
  });
});

describe("Phase A shell grouping", () => {
  it("uses the approved top-level order for an admin", () => {
    expect(shellSectionsForRole("admin").map((section) => section.id)).toEqual([
      "home",
      "customers",
      "sales",
      "jobs",
      "schedule",
      "money",
      "inventory",
      "more",
    ]);
  });

  it("puts purchase orders under Inventory and accounting under More", () => {
    const sections = shellSectionsForRole("admin");
    const inventory = sections.find((section) => section.id === "inventory");
    const money = sections.find((section) => section.id === "money");
    const more = sections.find((section) => section.id === "more");
    expect(inventory?.items.map((item) => item.href)).toContain("/purchase-orders");
    expect(money?.items.map((item) => item.href)).not.toContain("/purchase-orders");
    expect(money?.items.map((item) => item.href)).not.toContain("/accounting");
    expect(more?.items.map((item) => item.href)).toEqual([
      "/dashboard",
      "/reports",
      "/accounting",
      "/settings",
    ]);
  });

  it("uses employee-facing labels without changing the route", () => {
    const admin = shellSectionsForRole("admin");
    const sales = admin.find((section) => section.id === "sales");
    const schedule = admin.find((section) => section.id === "schedule");
    expect(sales?.items.find((item) => item.href === "/client-status")).toMatchObject({
      label: "Sales pipeline",
      href: "/client-status",
    });
    expect(schedule?.items.find((item) => item.href === "/calendar")?.label).toBe("Measures");
    expect(schedule?.items.find((item) => item.href === "/install-scheduler")?.label).toBe(
      "Install schedule",
    );
    expect(schedule?.items.some((item) => item.href === "/schedule/route")).toBe(false);
  });

  it("does not list My Work twice for crew", () => {
    const jobs = shellSectionsForRole("crew").find((section) => section.id === "jobs");
    expect(jobs?.items.map((item) => item.href)).not.toContain("/installer");
    expect(shellSectionsForRole("crew").find((section) => section.id === "home")?.items[0]?.href).toBe(
      "/installer",
    );
  });
});

describe("Phase A active navigation", () => {
  const role = "admin" as const;

  it("highlights the module that owns a child route", () => {
    expect(activeShellSection("/customers/abc", role)).toBe("customers");
    expect(activeShellLink("/customers", "salesman")).toEqual({
      sectionId: "customers",
      href: "/customers",
    });
    expect(activeShellSection("/estimates/1/edit", role)).toBe("sales");
    expect(activeShellSection("/client-status", role)).toBe("sales");
    expect(activeShellSection("/jobs/1", role)).toBe("jobs");
    expect(activeShellSection("/jobs/new", role)).toBe("jobs");
    expect(activeShellSection("/install-scheduler", role)).toBe("schedule");
    expect(activeShellSection("/schedule/route", role)).toBe("schedule");
    expect(activeShellSection("/purchase-orders/9", role)).toBe("inventory");
    expect(activeShellSection("/invoices/9", role)).toBe("money");
    expect(activeShellSection("/accounting/general-ledger", role)).toBe("more");
    expect(activeShellSection("/settings/stages", role)).toBe("more");
    expect(activeShellSection("/reports/products", role)).toBe("more");
    expect(activeShellSection("/pipeline", role)).toBe("sales");
    expect(activeShellSection("/leads", role)).toBe("customers");
    expect(activeShellSection("/schedule", role)).toBe("schedule");
    expect(activeShellSection("/jobs/calendar", role)).toBe("jobs");
    expect(activeShellSection("/invoices/quick", role)).toBe("money");
    expect(activeShellSection("/installer", "crew")).toBe("home");
    expect(activeShellSection("/installer", "admin")).toBe("jobs");
  });
});

describe("Phase A mobile tabs and + New", () => {
  it("chooses at most four permitted tabs per role", () => {
    expect(mobileTabsForRole("salesman").map((tab) => tab.href)).toEqual([
      "/customers",
      "/estimates",
      "/client-status",
      "/calendar",
    ]);
    expect(mobileTabsForRole("scheduler").map((tab) => tab.href)).toEqual([
      "/customers",
      "/jobs",
      "/install-scheduler",
      "/calendar",
    ]);
    expect(mobileTabsForRole("crew").map((tab) => tab.label)).toEqual([
      "My Work",
      "Jobs",
      "Board",
    ]);
    expect(mobileTabsForRole("warehouse").map((tab) => tab.href)).toEqual([
      "/warehouse",
      "/inventory",
    ]);
    for (const role of STAFF) {
      const tabs = mobileTabsForRole(role);
      expect(tabs.length).toBeGreaterThan(0);
      expect(tabs.length).toBeLessThanOrEqual(4);
      const allowed = new Set(navItemsForRole(role).map((item) => item.href));
      for (const tab of tabs) expect(allowed.has(tab.href), `${role} ${tab.href}`).toBe(true);
    }
  });

  it("points + New only at existing create screens, with no payment or PO", () => {
    expect(QUICK_CREATE.map((action) => action.id)).toEqual([
      "customer",
      "estimate",
      "measure",
      "job",
    ]);
    expect(quickCreateForRole("admin").map((action) => action.href)).toEqual([
      "/customers/new",
      "/estimates/start",
      "/calendar",
      "/jobs/new",
    ]);
    expect(quickCreateForRole("scheduler").map((action) => action.id)).toEqual([
      "customer",
      "measure",
      "job",
    ]);
    expect(quickCreateForRole("salesman").map((action) => action.id)).toContain("estimate");
    expect(quickCreateForRole("salesman").map((action) => action.id)).not.toContain("payment");
    expect(quickCreateForRole("admin").map((action) => action.label)).toEqual([
      "New customer",
      "New estimate",
      "Schedule a measure",
      "New job",
    ]);
  });

  it("shows one New control for each viewport", () => {
    const open = quickCreatePlacement(false);
    const closed = quickCreatePlacement(true);
    expect(open.sidebarWhenDesktopOpen).toBe(true);
    expect(open.headerWhenDesktopOpen).toBe(false);
    expect(closed.sidebarWhenDesktopOpen).toBe(false);
    expect(closed.headerWhenDesktopCollapsed).toBe(true);
    expect(open.headerOnPhone && closed.headerOnPhone).toBe(true);
  });

  it("opens the active group and keeps groups the employee opened", () => {
    expect(isCollapsibleShellSection("sales")).toBe(true);
    expect(isCollapsibleShellSection("home")).toBe(false);
    expect(isCollapsibleShellSection("customers")).toBe(false);
    expect(openShellGroups({ active: "sales", stored: [] })).toEqual(["sales"]);
    expect(openShellGroups({ active: "customers", stored: [] })).toEqual([]);
    expect(openShellGroups({ active: "jobs", stored: ["sales", "nope"] }).sort()).toEqual([
      "jobs",
      "sales",
    ]);
    expect(shellSectionsForRole("admin").find((s) => s.id === "inventory")?.items.map((i) => i.label)).toContain(
      "Products",
    );
    expect(shellSectionsForRole("office").find((s) => s.id === "money")?.items.map((i) => i.label)).toContain(
      "Bills",
    );
  });
});

describe("Phase A flag, redirects, and shell tools", () => {
  it("defaults to the classic shell and lets the cookie win", () => {
    const previous = process.env.NEXT_PUBLIC_UX_SHELL;
    delete process.env.NEXT_PUBLIC_UX_SHELL;
    expect(resolveUxShell(undefined)).toBe("classic");
    expect(resolveUxShell(null)).toBe("classic");
    expect(resolveUxShell("nope")).toBe("classic");
    expect(resolveUxShell("new")).toBe("new");
    expect(resolveUxShell("classic")).toBe("classic");
    process.env.NEXT_PUBLIC_UX_SHELL = "new";
    expect(resolveUxShell(undefined)).toBe("new");
    expect(resolveUxShell("classic")).toBe("classic");
    if (previous === undefined) delete process.env.NEXT_PUBLIC_UX_SHELL;
    else process.env.NEXT_PUBLIC_UX_SHELL = previous;
  });

  it("leaves the existing redirects in place", () => {
    const read = (path: string) => readFileSync(path, "utf8");
    expect(read("src/app/(app)/pipeline/page.tsx")).toContain("redirect(`/client-status");
    expect(read("src/app/(app)/leads/page.tsx")).toContain('redirect("/customers")');
    expect(read("src/app/(app)/jobs/quick/page.tsx")).toContain('redirect("/jobs/new")');
    expect(read("src/app/(app)/jobs/calendar/page.tsx")).toContain('redirect("/install-scheduler")');
    expect(read("src/app/(app)/schedule/page.tsx")).toContain('redirect("/calendar?view=agenda")');
    expect(read("src/app/(app)/invoices/quick/page.tsx")).toContain('redirect("/counter-sale")');
  });

  it("still sends customers to the portal before the staff shell", () => {
    expect(readFileSync("src/app/(app)/layout.tsx", "utf8")).toContain('redirect("/portal")');
  });

  it("keeps search and the field tools mounted in the shell", () => {
    const shell = readFileSync("src/components/app-shell.tsx", "utf8");
    for (const name of [
      "GlobalSearch",
      "AreaCalculator",
      "FieldAssistant",
      "OnMyWayFab",
      "ImportJobsBanner",
    ]) {
      expect(shell).toContain(name);
    }
  });
});
