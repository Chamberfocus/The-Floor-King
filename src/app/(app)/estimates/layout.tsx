import { requireRole } from "@/lib/auth";

/**
 * Estimates are sales/office documents with full pricing. Guard every route
 * under /estimates so installers (crew), warehouse, and customers can't reach
 * them by URL — they must never see estimate financials.
 */
export default async function EstimatesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(["admin", "office", "sales_manager", "salesman", "scheduler"]);
  return <>{children}</>;
}
