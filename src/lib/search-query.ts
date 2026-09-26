/**
 * What global search may return for a role.
 * Matches the navigation that role can already open, plus jobs for warehouse
 * so they can find who a delivery belongs to. Money types stay off roles
 * that do not see invoices.
 */
import type { UserRole } from "@/lib/types";

export type SearchHitType =
  | "customer"
  | "estimate"
  | "invoice"
  | "order"
  | "po"
  | "job"
  | "product";

const SALES_VIEW: UserRole[] = ["admin", "office", "sales_manager", "salesman", "scheduler"];
const SALES: UserRole[] = ["admin", "office", "sales_manager", "salesman"];
const OFFICE: UserRole[] = ["admin", "office"];
const JOBS: UserRole[] = ["admin", "office", "sales_manager", "salesman", "scheduler", "crew", "warehouse"];
const PRODUCTS: UserRole[] = ["admin", "office", "sales_manager", "salesman", "warehouse"];

const ORDER: SearchHitType[] = [
  "customer",
  "estimate",
  "job",
  "order",
  "invoice",
  "po",
  "product",
];

export function searchTypesForRole(role: UserRole): SearchHitType[] {
  if (role === "customer") return [];
  const allowed = new Set<SearchHitType>();
  if (SALES_VIEW.includes(role)) allowed.add("customer");
  if (SALES.includes(role)) {
    allowed.add("estimate");
    allowed.add("invoice");
  }
  if (OFFICE.includes(role)) {
    allowed.add("order");
    allowed.add("po");
  }
  if (JOBS.includes(role)) allowed.add("job");
  if (PRODUCTS.includes(role)) allowed.add("product");
  return ORDER.filter((type) => allowed.has(type));
}

/**
 * ilike fragment that still matches a phone stored with spaces or dashes.
 * "(216) 555-0100" matches a search for 2165550100.
 */
export function phoneSearchPattern(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length === 10) {
    return `%${local.slice(0, 3)}%${local.slice(3, 6)}%${local.slice(6)}%`;
  }
  if (local.length >= 7) return `%${local}%`;
  return null;
}
