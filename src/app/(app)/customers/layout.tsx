import { requireRole } from "@/lib/auth";

/**
 * The customer file exposes estimates, invoices, and balances. Guard the whole
 * /customers area to sales/office roles (matching the nav) so installers (crew),
 * warehouse, and portal customers can't open it by URL and see financials.
 */
export default async function CustomersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(["admin", "office", "sales_manager", "salesman", "scheduler"]);
  return <>{children}</>;
}
