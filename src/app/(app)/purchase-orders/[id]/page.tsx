import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Trash2, ReceiptText } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { PoStatusBadge } from "@/components/po-status-badge";
import { getPurchaseOrder } from "@/lib/data/purchase-orders";
import { getBillForPO } from "@/lib/data/bills";
import { createBillFromPO } from "@/app/(app)/bills/actions";
import { getCustomer } from "@/lib/data/customers";
import { getOrgSettings } from "@/lib/data/org";
import { listProducts } from "@/lib/data/products";
import { listSuppliers } from "@/lib/data/suppliers";
import { PrintButton } from "@/components/print-button";
import { PoPrintDoc } from "./po-print";
import { PO_SOURCE_BADGE, PO_SOURCE_LABELS } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { PoBuilder } from "../po-builder";
import { ReorderAlerts } from "@/components/reorder-alert";
import { deletePurchaseOrder } from "../actions";

export const metadata: Metadata = { title: "Purchase Order" };
export const maxDuration = 60;

export default async function PurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const po = await getPurchaseOrder(id);
  if (!po) notFound();
  const existingBill = await getBillForPO(po.id);

  const [products, customer, suppliers, org] = await Promise.all([
    listProducts({ activeOnly: true }),
    po.customer_id ? getCustomer(po.customer_id) : Promise.resolve(null),
    listSuppliers(),
    getOrgSettings(),
  ]);

  return (
    <>
      <PoPrintDoc org={org} customer={customer} po={po} />
      <div className="mx-auto max-w-4xl print:hidden">
      <Link
        href="/purchase-orders"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to purchase orders
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              Purchase Order
            </h1>
            <PoStatusBadge status={po.status} />
            {po.source_type ? (
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                  PO_SOURCE_BADGE[po.source_type],
                )}
              >
                {PO_SOURCE_LABELS[po.source_type]}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {customer ? `${customer.full_name} · ` : ""}
            Created {formatDate(po.created_at)}
            {po.estimate_id ? (
              <>
                {" · "}
                <Link
                  href={`/estimates/${po.estimate_id}`}
                  className="hover:underline"
                >
                  source estimate
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {existingBill ? (
            <Link
              href={`/bills/${existingBill.id}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <ReceiptText className="size-4" /> View bill
            </Link>
          ) : (
            <form action={createBillFromPO}>
              <input type="hidden" name="po_id" value={po.id} />
              <Button type="submit" size="sm">
                <ReceiptText className="size-4" /> Convert to bill
              </Button>
            </form>
          )}
          <PrintButton label="Print PO" />
        </div>
      </div>

      {/* Notify-only: flag line products we already hold remnants/rolls of. */}
      <div className="mb-4">
        <ReorderAlerts productIds={(po.items ?? []).map((i) => i.product_id).filter(Boolean) as string[]} />
      </div>

      <PoBuilder po={po} products={products} suppliers={suppliers} />

      <form action={deletePurchaseOrder} className="mt-4 flex justify-end">
        <input type="hidden" name="id" value={po.id} />
        <Button type="submit" variant="destructive" size="sm">
          <Trash2 className="size-3.5" /> Delete PO
        </Button>
      </form>
      </div>
    </>
  );
}
