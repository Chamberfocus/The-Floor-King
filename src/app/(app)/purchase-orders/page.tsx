import type { Metadata } from "next";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { PoStatusBadge } from "@/components/po-status-badge";
import { listPurchaseOrders } from "@/lib/data/purchase-orders";
import { poTotal } from "@/lib/po-calc";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Purchase Orders" };

export default async function PurchaseOrdersPage() {
  const pos = await listPurchaseOrders();

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        description="Material orders for your jobs. Generate one from an approved estimate."
      />

      {pos.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No purchase orders yet. Open an approved estimate and click{" "}
          <span className="font-medium">Create PO</span>.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total cost</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pos.map((po) => (
                <TableRow key={po.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/purchase-orders/${po.id}`}
                      className="hover:underline"
                    >
                      {po.supplier || "Purchase order"}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {(po.items ?? []).length} item
                      {(po.items ?? []).length === 1 ? "" : "s"}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {po.customer_name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <PoStatusBadge status={po.status} />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatMoney(poTotal(po.items ?? []))}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatDate(po.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
