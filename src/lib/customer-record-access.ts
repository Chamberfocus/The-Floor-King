import type { UserRole } from "@/lib/types";

/**
 * Who may load customer money on the customer file.
 * Scheduler, crew, warehouse, and customer are excluded.
 * This is a data-loading gate. It does not decide what to do next.
 */
const CUSTOMER_MONEY_ROLES: readonly UserRole[] = [
  "admin",
  "office",
  "sales_manager",
  "salesman",
];

export function customerSeesCustomerMoney(role: UserRole): boolean {
  return CUSTOMER_MONEY_ROLES.includes(role);
}
