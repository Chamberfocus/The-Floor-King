import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Trash2, ReceiptText } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { PoStatusBadge } from "@/components/po-status-badge";
import { getPurchaseOrder, listJobsForAttribution, getEstimateCutSources } from "@/lib/data/purchase-orders";
import { getBillForPO } from "@/lib/data/bills";
import { createBillFromPO } from "@/app/(app)/bills/actions";
import { getCustomer } from "@/lib/data/customers";
import { getOrgSettings } from "@/lib/data/org";
import { listProducts } from "@/lib/data/products";
import { listSuppliers } from "@/lib/data/suppliers";
import { PrintButton } from "@/components/print-button";
import { PoPrintDoc } from "./po-print";
import { PO_SOURCE_BADGE, PO_SOURCE_LABELS, formatPoNumber } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { PoBuilder } from "../po-builder";
import { ReorderAlerts } from "@/components/reorder-alert";
import { deletePurchaseOrder, resyncPoCarpet } from "../actions";

export const metadata: Metadata = { title: "Purchase Order" };
export const maxDuration = 60;

export default async function PurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Safety net: keep this PO's carpet yardage in lockstep with the estimate's
  // live cuts before rendering (idempotent — writes only on real drift).
  await resyncPoCarpet(id);
  const po = await getPurchaseOrder(id);
  if (!po) notFound();
  const existingBill = await getBillForPO(po.id);

  const [products, customer, suppliers, org, jobs, cutSources] = await Promise.all([
    listProducts({ activeOnly: true }),
    po.customer_id ? getCustomer(po.customer_id) : Promise.resolve(null),
    listSuppliers(),
    getOrgSettings(),
    listJobsForAttribution(),
    getEstimateCutSources(po.estimate_id),
  ]);

  return (
    <>
      <PoPrintDoc org={org} customer={customer} po={po} cutSources={cutSources} />
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
            <h1 className="text-2xl font-bold tracking-tight tabular-nums sm:text-[1.75rem]">
              {po.po_number != null ? formatPoNumber(po.po_number) : "Purchase Order"}
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
            {po.po_number == null ? "Draft — number assigned when issued · " : ""}
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
              <ConfirmButton
                size="sm"
                title="Create a bill from this purchase order?"
                description="Creates an accounts-payable bill with this PO's vendor, line items, and due date."
                confirmLabel="Create bill"
              >
                <ReceiptText className="size-4" /> Convert to bill
              </ConfirmButton>
            </form>
          )}
          <PrintButton label="Print PO" />
        </div>
      </div>

      {/* Notify-only: flag line products we already hold remnants/rolls of. */}
      <div className="mb-4">
        <ReorderAlerts productIds={(po.items ?? []).map((i) => i.product_id).filter(Boolean) as string[]} />
      </div>

      <PoBuilder
        po={po}
        products={products}
        suppliers={suppliers.filter((s) => s.active !== false || s.id === po.supplier_id)}
        jobs={jobs.filter((j) => j.customer_id !== po.customer_id)}
        poCustomerName={customer?.full_name ?? null}
      />

      <form action={deletePurchaseOrder} className="mt-4 flex justify-end">
        <input type="hidden" name="id" value={po.id} />
        <ConfirmButton
          variant="destructive"
          size="sm"
          title={po.po_number != null ? `Void ${formatPoNumber(po.po_number)}?` : "Delete this draft PO?"}
          description={
            po.po_number != null
              ? "Issued POs are never deleted. This marks it VOID and keeps its number so the sequence stays intact. Any received stock is reversed."
              : "This is an un-issued draft with no number, so deleting it leaves no gap. Any received stock is reversed."
          }
          confirmLabel={po.po_number != null ? "Void PO" : "Delete draft"}
          destructive
        >
          <Trash2 className="size-3.5" /> {po.po_number != null ? "Void PO" : "Delete draft"}
        </ConfirmButton>
      </form>
      </div>
    </>
  );
}
