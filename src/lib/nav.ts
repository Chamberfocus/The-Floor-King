import {
  LayoutDashboard,
  Users,
  Contact,
  FileText,
  CalendarDays,
  Receipt,
  Package,
  Settings,
  ShoppingCart,
  ClipboardList,
  Warehouse,
  UserCog,
  BarChart3,
  Route,
  GitBranch,
  ListChecks,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@/lib/types";

export const APP_NAME = "Floor King CRM";
export const COMPANY_NAME = "Cleveland Floor King";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Roles allowed to see this item. */
  roles: UserRole[];
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

/** Primary navigation. Items are filtered by the current user's role. */
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: OVERVIEW },
  { label: "Pipeline", href: "/pipeline", icon: Route, roles: SALES_VIEW },
  { label: "Leads", href: "/leads", icon: Contact, roles: SALES },
  { label: "Customers", href: "/customers", icon: Users, roles: SALES_VIEW },
  { label: "Estimates", href: "/estimates", icon: FileText, roles: SALES_VIEW },
  { label: "Purchase Orders", href: "/purchase-orders", icon: ShoppingCart, roles: OFFICE_PLUS },
  { label: "Jobs", href: "/jobs", icon: CalendarDays, roles: JOBS_ROLES },
  { label: "Job Board", href: "/board", icon: ClipboardList, roles: ["admin", "office", "scheduler", "crew"] },
  { label: "Invoices", href: "/invoices", icon: Receipt, roles: SALES },
  { label: "Catalog", href: "/catalog", icon: Package, roles: SALES },
  { label: "Reports", href: "/reports", icon: BarChart3, roles: OVERVIEW },
  { label: "Warehouse", href: "/warehouse", icon: Warehouse, roles: ["admin", "office", "warehouse"] },
  { label: "Workflow Stages", href: "/settings/stages", icon: GitBranch, roles: ADMIN },
  { label: "Qualifying Qs", href: "/settings/qualifying", icon: ListChecks, roles: ADMIN },
  { label: "Wizard Setup", href: "/settings/wizard", icon: Settings, roles: ADMIN },
  { label: "Team", href: "/settings/team", icon: UserCog, roles: ADMIN },
];

export function navItemsForRole(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
