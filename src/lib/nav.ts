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

const STAFF: UserRole[] = ["admin", "office"];
const STAFF_AND_CREW: UserRole[] = ["admin", "office", "crew"];

/** Primary navigation. Items are filtered by the current user's role. */
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: STAFF },
  { label: "Leads", href: "/leads", icon: Contact, roles: STAFF },
  { label: "Customers", href: "/customers", icon: Users, roles: STAFF },
  { label: "Estimates", href: "/estimates", icon: FileText, roles: STAFF },
  { label: "Purchase Orders", href: "/purchase-orders", icon: ShoppingCart, roles: STAFF },
  { label: "Jobs", href: "/jobs", icon: CalendarDays, roles: STAFF_AND_CREW },
  { label: "Job Board", href: "/board", icon: ClipboardList, roles: STAFF_AND_CREW },
  { label: "Invoices", href: "/invoices", icon: Receipt, roles: STAFF },
  { label: "Catalog", href: "/catalog", icon: Package, roles: STAFF },
  { label: "Reports", href: "/reports", icon: BarChart3, roles: STAFF },
  { label: "Warehouse", href: "/warehouse", icon: Warehouse, roles: ["admin", "office", "warehouse"] },
  { label: "Wizard Setup", href: "/settings/wizard", icon: Settings, roles: ["admin"] },
  { label: "Team", href: "/settings/team", icon: UserCog, roles: ["admin"] },
];

export function navItemsForRole(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
