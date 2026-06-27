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
        <>
        {/* Phone: tappable cards */}
        <div className="space-y-2 md:hidden">
          {pos.map((po) => (
            <Link
              key={po.id}
              href={`/purchase-orders/${po.id}`}
              className="block rounded-lg border p-3 active:bg-muted/50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{po.supplier || "Purchase order"}</div>
                  <div className="text-xs text-muted-foreground">
                    {(po.items ?? []).length} item{(po.items ?? []).length === 1 ? "" : "s"}
                    {po.customer_name ? ` · ${po.customer_name}` : ""}
                  </div>
                </div>
                <PoStatusBadge status={po.status} />
              </div>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{formatMoney(poTotal(po.items ?? []))}</span>
                <span className="ml-auto">{formatDate(po.created_at)}</span>
              </div>
            </Link>
          ))}
        </div>
        {/* Larger screens: table */}
        <div className="hidden overflow-x-auto rounded-lg border md:block">
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
        </>
      )}
    </div>
  );
}
