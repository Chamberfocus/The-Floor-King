import {
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
  CalendarClock,
  CalendarCheck,
  CalendarRange,
  UserCheck,
  Activity,
  ArrowRightLeft,
  ShoppingBag,
  Bookmark,
  Hammer,
  HardHat,
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
      { label: "Booking Calendar", href: "/calendar", icon: CalendarRange, roles: SALES_VIEW },
      { label: "Estimate Schedule", href: "/schedule", icon: CalendarClock, roles: SALES_VIEW },
      { label: "Install Scheduler", href: "/install-scheduler", icon: CalendarCheck, roles: ["admin", "office", "scheduler"] },
      { label: "Team Schedule", href: "/team", icon: UserCheck, roles: SCHEDULE_ROLES },
    ],
  },
  {
    id: "jobs",
    label: "Jobs & Field",
    icon: CalendarDays,
    items: [
      { label: "Jobs", href: "/jobs", icon: CalendarDays, roles: JOBS_ROLES },
      { label: "Job Board", href: "/board", icon: ClipboardList, roles: ["admin", "office", "scheduler", "crew"] },
      { label: "Quick install", href: "/jobs/quick", icon: Hammer, roles: ["admin", "office", "scheduler"] },
      { label: "Carry over work", href: "/carry-over", icon: ArrowRightLeft, roles: OFFICE_PLUS },
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
  const customers = NAV_GROUPS.flatMap((g) => g.items).find(
    (i) => i.href === "/customers",
  );
  if (customers?.roles.includes(role)) return "/customers";
  if (role === "crew") return "/installer";
  return navItemsForRole(role)[0]?.href ?? "/customers";
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
