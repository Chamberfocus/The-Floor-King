import {
  Home,
  LayoutDashboard,
  Users,
  CalendarDays,
  Receipt,
  Wallet,
  Package,
  Settings,
  ShoppingCart,
  ClipboardList,
  FileText,
  Warehouse,
  Boxes,
  Layers,
  BarChart3,
  Route,
  CalendarCheck,
  CalendarRange,
  UserCheck,
  Activity,
  ShoppingBag,
  Bookmark,
  Hammer,
  HardHat,
  Wrench,
  ListTodo,
  type LucideIcon,
} from "lucide-react";
import { SCHEDULE_ROLES, type UserRole } from "@/lib/types";

export const APP_NAME = "Floor King CRM";
export const COMPANY_NAME = "Cleveland Floor King";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Roles allowed to see this item. */
  roles: UserRole[];
}

/** A collapsible section of the sidebar. Its items keep their own per-item roles;
 *  the group shows whenever the current role can see at least one of them. */
export interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

const ADMIN: UserRole[] = ["admin"];
const OFFICE_PLUS: UserRole[] = ["admin", "office"];
// Anyone who works deals — salesman/scheduler get only their own via RLS.
const SALES: UserRole[] = ["admin", "office", "sales_manager", "salesman"];
const SALES_VIEW: UserRole[] = [
  "admin",
  "office",
  "sales_manager",
  "salesman",
  "scheduler",
];
const OVERVIEW: UserRole[] = ["admin", "office", "sales_manager"];
const JOBS_ROLES: UserRole[] = [
  "admin",
  "office",
  "sales_manager",
  "salesman",
  "scheduler",
  "crew",
];

/**
 * Role-specific "home" tabs, pinned above the groups. My Work is the field
 * crew's landing; Business Pulse is the owner's daily glance.
 */
export const PINNED_ITEMS: NavItem[] = [
  { label: "Business Pulse", href: "/pulse", icon: Activity, roles: ADMIN },
  { label: "My Work", href: "/installer", icon: HardHat, roles: ["crew", "admin", "office"] },
];

/**
 * The six navigation groups. Every current destination lives in exactly one
 * group (nothing removed); grouping only nests the same links so the sidebar is
 * scannable instead of a flat wall of 20+ tabs. Order here is the default; it is
 * re-sorted per role by navGroupsForRole (the signed-in role's own group first).
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "sales",
    label: "Sales",
    icon: Users,
    items: [
      { label: "Customers", href: "/customers", icon: Users, roles: SALES_VIEW },
      /**
       * Estimates had NO sidebar link. The list, and the "New estimate" button
       * on it, could only be reached by opening a customer first — which is why
       * the customer list became the only way to start anything.
       */
      { label: "Estimates", href: "/estimates", icon: FileText, roles: SALES },
      /**
       * Was "Pipeline", listing the same customers under thirteen stage
       * headings. Same information, folded into six lanes that each say what
       * happens next — the shape the jobs board already uses and reads better.
       */
      { label: "Client status", href: "/client-status", icon: Route, roles: SALES_VIEW },
      { label: "Samples", href: "/samples", icon: Layers, roles: SALES_VIEW },
      { label: "Saved for later", href: "/saved", icon: Bookmark, roles: SALES },
      // The customer order link. It already existed on Customer Orders, which
      // lives under Money and is admin/office only — so the sales team, the
      // people actually stood in front of a customer, could never reach it.
      { label: "Quick order", href: "/quick-order", icon: ShoppingBag, roles: SALES_VIEW },
      // Cash & carry at the desk: a paid invoice against a real customer, which
      // is what a walk-in sale is. Previously it had nowhere to go at all.
      { label: "Counter sale", href: "/counter-sale", icon: Receipt, roles: SALES },
    ],
  },
  {
    id: "schedule",
    label: "Schedule",
    icon: CalendarRange,
    items: [
      // Two entries, two questions: WHEN are we seeing customers (the calendar,
      // which now carries the old "Estimate Schedule" list as its Agenda view),
      // and WHICH JOBS still need a crew and a date (the install scheduler).
      // "Team Schedule" is neither — it's who's working and who's off — so it
      // sits under Settings-ish territory, not beside two customer calendars.
      { label: "Calendar", href: "/calendar", icon: CalendarRange, roles: SALES_VIEW },
      { label: "Install Scheduler", href: "/install-scheduler", icon: CalendarCheck, roles: ["admin", "office", "scheduler"] },
      { label: "Who's working", href: "/team", icon: UserCheck, roles: SCHEDULE_ROLES },
    ],
  },
  {
    id: "jobs",
    label: "Jobs & Field",
    icon: CalendarDays,
    items: [
      { label: "Jobs", href: "/jobs", icon: CalendarDays, roles: JOBS_ROLES },
      { label: "Job Board", href: "/board", icon: ClipboardList, roles: ["admin", "office", "scheduler", "crew"] },
      { label: "Service", href: "/service", icon: Wrench, roles: ["admin", "office", "sales_manager", "salesman", "scheduler"] },
      { label: "Tasks", href: "/tasks", icon: ListTodo, roles: ["admin", "office", "sales_manager", "salesman"] },
      // "Quick install" was a second door to the same thing — everything it did
      // now lives on /jobs/new, which is reached from the New job button on the
      // Jobs page and on every customer's file.
      //
      // "Carry over work" is a go-live task, not a daily one: it exists to bring
      // unfinished jobs across from the old system. A permanent sidebar entry
      // for a one-time migration is clutter, so it's linked from /jobs/new —
      // exactly where you'd be standing when you realise you need it — and the
      // route still works for anyone who bookmarked it.
      { label: "New job", href: "/jobs/new", icon: Hammer, roles: ["admin", "office", "sales_manager", "salesman", "scheduler"] },
    ],
  },
  {
    id: "products",
    label: "Products & Warehouse",
    icon: Boxes,
    items: [
      { label: "Catalog", href: "/catalog", icon: Package, roles: SALES },
      { label: "Inventory", href: "/inventory", icon: Boxes, roles: ["admin", "office", "warehouse", "sales_manager"] },
      { label: "Warehouse", href: "/warehouse", icon: Warehouse, roles: ["admin", "office", "warehouse"] },
    ],
  },
  {
    id: "money",
    label: "Money",
    icon: Wallet,
    items: [
      { label: "Customer Orders", href: "/orders", icon: ShoppingBag, roles: OFFICE_PLUS },
      { label: "Purchase Orders", href: "/purchase-orders", icon: ShoppingCart, roles: OFFICE_PLUS },
      { label: "Invoices", href: "/invoices", icon: Receipt, roles: SALES },
      { label: "Bills (A/P)", href: "/bills", icon: Wallet, roles: OFFICE_PLUS },
      {
        label: "Accounting",
        href: "/accounting",
        icon: FileText,
        // OFFICE_PLUS = admin + office only — warehouse must never see financial reports.
        roles: OFFICE_PLUS,
      },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    icon: BarChart3,
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: OVERVIEW },
      { label: "Reports", href: "/reports", icon: BarChart3, roles: OVERVIEW },
    ],
  },
];

/** Pinned at the very bottom of the sidebar. */
export const SETTINGS_ITEM: NavItem = {
  label: "Settings",
  href: "/settings",
  icon: Settings,
  roles: ADMIN,
};

/**
 * Role-first ordering: the group most central to each role floats to the top of
 * that role's sidebar (they still see every group — just ordered for them).
 * Owner/office run everything, so they keep the default order.
 */
const PRIMARY_GROUP: Partial<Record<UserRole, string>> = {
  sales_manager: "sales",
  salesman: "sales",
  scheduler: "schedule",
  crew: "jobs",
  warehouse: "products",
};

/** Pinned home tabs visible to a role. */
export function pinnedItemsForRole(role: UserRole): NavItem[] {
  return PINNED_ITEMS.filter((item) => item.roles.includes(role));
}

/**
 * Where the Home button lands. The customer list for everyone who works deals —
 * it's the page the office actually starts from. Crew are NOT in SALES_VIEW and
 * would hit a permission wall there, so they go to My Work instead; anyone else
 * falls back to the first destination their role can open, so Home is never a
 * dead link for any role.
 */
export function homeHrefForRole(role: UserRole): string {
  if (role === "customer") return "/portal";
  return "/home";
}

/**
 * The groups a role sees, each trimmed to the items that role may open, empty
 * groups dropped, and the role's primary group moved to the front.
 */
export function navGroupsForRole(role: UserRole): NavGroup[] {
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.roles.includes(role)),
  })).filter((g) => g.items.length > 0);

  const primary = PRIMARY_GROUP[role];
  if (primary) {
    const idx = groups.findIndex((g) => g.id === primary);
    if (idx > 0) groups.unshift(groups.splice(idx, 1)[0]);
  }
  return groups;
}

export function settingsItemForRole(role: UserRole): NavItem | null {
  return SETTINGS_ITEM.roles.includes(role) ? SETTINGS_ITEM : null;
}

/**
 * A flat, role-first list of every destination a role can reach — pinned homes,
 * then each group's items in role-first order, then Settings. Kept for the
 * mobile bottom bar (top destinations) and any flat consumer.
 */
export function navItemsForRole(role: UserRole): NavItem[] {
  const flat: NavItem[] = [...pinnedItemsForRole(role)];
  for (const g of navGroupsForRole(role)) flat.push(...g.items);
  const settings = settingsItemForRole(role);
  if (settings) flat.push(settings);
  return flat;
}

// ---------------------------------------------------------------------------
// Phase A shell. Presentation only: every link copies its roles from the
// classic item with the same href. The classic groups above stay the fallback.
// ---------------------------------------------------------------------------

/** Cookie wins over the env default so one browser can compare both shells. */
export const UX_SHELL_COOKIE = "fk_ux_shell";

export type UxShellMode = "new" | "classic";

/**
 * `fk_ux_shell=new|classic` overrides `NEXT_PUBLIC_UX_SHELL`.
 * Anything else, including an unset cookie and an unset env var, is classic.
 */
export function resolveUxShell(cookieValue: string | undefined | null): UxShellMode {
  if (cookieValue === "new" || cookieValue === "classic") return cookieValue;
  const env = process.env.NEXT_PUBLIC_UX_SHELL;
  if (env === "new" || env === "classic") return env;
  return "classic";
}

export type ShellSectionId =
  | "home"
  | "customers"
  | "sales"
  | "jobs"
  | "schedule"
  | "money"
  | "inventory"
  | "more";

export interface ShellSection {
  id: ShellSectionId;
  label: string;
  items: NavItem[];
}

const CLASSIC_BY_HREF: Map<string, NavItem> = new Map(
  [...PINNED_ITEMS, ...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM].map(
    (item) => [item.href, item],
  ),
);

/** Same destination as the classic nav. Optional label is employee-facing copy. */
function shellItem(href: string, label?: string): NavItem | null {
  const base = CLASSIC_BY_HREF.get(href);
  if (!base) return null;
  return label ? { ...base, label } : base;
}

/**
 * Approved top-level order. Home is filled per role from homeHrefForRole.
 * Items the role cannot already open are dropped. Empty sections are dropped.
 * Route (/schedule/route) is intentionally absent: without a rep and a date it
 * redirects away, so a sidebar link would be a dead end. It stays linked from
 * the measure calendar.
 */
const SHELL_BLUEPRINT: {
  id: ShellSectionId;
  label: string;
  items: { href: string; label?: string }[];
}[] = [
  { id: "home", label: "Home", items: [] },
  { id: "customers", label: "Customers", items: [{ href: "/customers" }] },
  {
    id: "sales",
    label: "Sales",
    items: [
      { href: "/estimates" },
      { href: "/client-status", label: "Sales pipeline" },
      { href: "/samples" },
      { href: "/saved", label: "Saved for later" },
      { href: "/quick-order", label: "Quick order" },
      { href: "/counter-sale", label: "Counter sale" },
      { href: "/orders", label: "Customer orders" },
    ],
  },
  {
    id: "jobs",
    label: "Jobs",
    items: [
      { href: "/jobs" },
      { href: "/board", label: "Job board" },
      { href: "/service" },
      { href: "/tasks" },
      { href: "/installer", label: "My Work" },
    ],
  },
  {
    id: "schedule",
    label: "Schedule",
    items: [
      { href: "/calendar", label: "Measures" },
      { href: "/install-scheduler", label: "Install schedule" },
      { href: "/team", label: "Who's working" },
    ],
  },
  {
    id: "money",
    label: "Money",
    items: [
      { href: "/invoices" },
      { href: "/bills", label: "Bills" },
      { href: "/pulse", label: "Business pulse" },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    items: [
      { href: "/catalog", label: "Products" },
      { href: "/inventory" },
      { href: "/warehouse" },
      { href: "/purchase-orders" },
    ],
  },
  {
    id: "more",
    label: "More",
    items: [
      { href: "/dashboard" },
      { href: "/reports" },
      { href: "/accounting" },
      { href: "/settings" },
    ],
  },
];

/** Staff shell only. The customer role is sent to the portal before this renders. */
export function shellSectionsForRole(role: UserRole): ShellSection[] {
  if (role === "customer") return [];
  const allowed = new Set(navItemsForRole(role).map((item) => item.href));
  const sections: ShellSection[] = [];

  for (const blueprint of SHELL_BLUEPRINT) {
    if (blueprint.id === "home") {
      sections.push({
        id: "home",
        label: "Home",
        items: [
          {
            label: "Home",
            href: "/home",
            icon: Home,
            roles: [role],
          },
        ],
      });
      continue;
    }

    const items: NavItem[] = [];
    for (const def of blueprint.items) {
      if (!allowed.has(def.href)) continue;
      // Home is the action center. My Work stays a jobs destination.
      const item = shellItem(def.href, def.label);
      if (item && item.roles.includes(role)) items.push(item);
    }
    if (items.length) sections.push({ id: blueprint.id, label: blueprint.label, items });
  }
  return sections;
}

/** Paths that are not sidebar links but should still light up their group. */
const SECTION_ALIASES: { prefix: string; id: ShellSectionId }[] = [
  { prefix: "/leads", id: "customers" },
  { prefix: "/pipeline", id: "sales" },
  { prefix: "/schedule", id: "schedule" },
  { prefix: "/financials", id: "money" },
  { prefix: "/search", id: "more" },
  { prefix: "/carry-over", id: "jobs" },
];

function hrefMatches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Longest matching href wins, so /jobs/new highlights New job rather than Jobs.
 * A tie prefers the real module over the Home alias (Home and Customers can
 * share /customers until Phase B gives Home its own page).
 */
export function activeShellLink(
  pathname: string,
  role: UserRole,
): { sectionId: ShellSectionId; href: string } | null {
  let best: { sectionId: ShellSectionId; href: string; isHome: boolean } | null = null;
  for (const section of shellSectionsForRole(role)) {
    for (const item of section.items) {
      if (!hrefMatches(pathname, item.href)) continue;
      const isHome = section.id === "home";
      if (
        !best ||
        item.href.length > best.href.length ||
        (item.href.length === best.href.length && best.isHome && !isHome)
      ) {
        best = { sectionId: section.id, href: item.href, isHome };
      }
    }
  }
  if (best) return { sectionId: best.sectionId, href: best.href };
  for (const alias of SECTION_ALIASES) {
    if (!hrefMatches(pathname, alias.prefix)) continue;
    if (shellSectionsForRole(role).some((section) => section.id === alias.id)) {
      return { sectionId: alias.id, href: alias.prefix };
    }
  }
  return null;
}

export function activeShellSection(
  pathname: string,
  role: UserRole,
): ShellSectionId | null {
  return activeShellLink(pathname, role)?.sectionId ?? null;
}

/**
 * Bottom bar is a chosen set of high-frequency pages, not "the first four
 * sorted links". Every href is dropped unless the classic nav already allows it.
 */
const MOBILE_TABS: Record<UserRole, string[]> = {
  admin: ["/customers", "/jobs", "/calendar", "/invoices"],
  office: ["/customers", "/jobs", "/calendar", "/invoices"],
  sales_manager: ["/customers", "/estimates", "/jobs", "/calendar"],
  salesman: ["/customers", "/estimates", "/client-status", "/calendar"],
  scheduler: ["/customers", "/jobs", "/install-scheduler", "/calendar"],
  crew: ["/installer", "/jobs", "/board"],
  warehouse: ["/warehouse", "/inventory"],
  customer: [],
};

const MOBILE_LABEL: Record<string, string> = {
  "/customers": "Customers",
  "/estimates": "Estimates",
  "/client-status": "Pipeline",
  "/jobs": "Jobs",
  "/board": "Board",
  "/calendar": "Measures",
  "/install-scheduler": "Installs",
  "/invoices": "Invoices",
  "/installer": "My Work",
  "/warehouse": "Warehouse",
  "/inventory": "Inventory",
};

export function mobileTabsForRole(role: UserRole): NavItem[] {
  if (role === "customer") return [];
  const allowed = new Set(navItemsForRole(role).map((item) => item.href));
  const tabs: NavItem[] = [];
  for (const href of MOBILE_TABS[role] ?? []) {
    if (!allowed.has(href)) continue;
    const item = shellItem(href, MOBILE_LABEL[href]);
    if (item) tabs.push(item);
  }
  return tabs;
}

export interface QuickCreateAction {
  id: string;
  label: string;
  href: string;
  /** Roles that already have this create flow in the classic product. */
  roles: UserRole[];
}

/**
 * Existing create screens only.
 * Payment has no generic form — it is recorded on an invoice.
 * Purchase orders are created from a job/estimate or as a stock PO on the
 * inventory page, not from a blank global form.
 * A new lead is a new customer — there is no second create screen.
 * Tasks are created on the dashboard, which office and sales managers already open.
 */
export const QUICK_CREATE: QuickCreateAction[] = [
  { id: "customer", label: "New customer", href: "/customers/new", roles: SALES_VIEW },
  { id: "estimate", label: "New estimate", href: "/estimates/start", roles: SALES },
  { id: "measure", label: "Schedule a measure", href: "/calendar", roles: SALES_VIEW },
  {
    id: "job",
    label: "New job",
    href: "/jobs/new",
    roles: ["admin", "office", "sales_manager", "salesman", "scheduler"],
  },
  { id: "task", label: "New task", href: "/dashboard", roles: OVERVIEW },
];

const COLLAPSIBLE_SECTIONS: readonly ShellSectionId[] = [
  "sales",
  "jobs",
  "schedule",
  "money",
  "inventory",
  "more",
];

/** Groups that unfold. Home and Customers stay one click, always visible. */
export function isCollapsibleShellSection(id: string): id is ShellSectionId {
  return (COLLAPSIBLE_SECTIONS as readonly string[]).includes(id);
}

/**
 * The one accordion group that owns the current page.
 * Home, Customers, and unknown routes open nothing.
 */
export function openGroupForRoute(active: ShellSectionId | null): ShellSectionId | null {
  if (active && isCollapsibleShellSection(active)) return active;
  return null;
}

/**
 * Single-open accordion. Clicking the open group collapses it.
 * Clicking any other group opens that one and closes the previous.
 */
export function nextOpenGroup(
  current: ShellSectionId | null,
  clicked: ShellSectionId,
): ShellSectionId | null {
  if (!isCollapsibleShellSection(clicked)) return current;
  return current === clicked ? null : clicked;
}

/**
 * One global New control. Sidebar when the desktop menu is open.
 * Header when that menu is collapsed or the viewport is a phone.
 */
export function quickCreatePlacement(collapsed: boolean): {
  sidebarWhenDesktopOpen: boolean;
  headerWhenDesktopOpen: boolean;
  headerWhenDesktopCollapsed: boolean;
  headerOnPhone: boolean;
} {
  return {
    sidebarWhenDesktopOpen: !collapsed,
    headerWhenDesktopOpen: false,
    headerWhenDesktopCollapsed: collapsed,
    headerOnPhone: true,
  };
}

export function quickCreateForRole(role: UserRole): QuickCreateAction[] {
  if (role === "customer") return [];
  return QUICK_CREATE.filter((action) => action.roles.includes(role));
}
