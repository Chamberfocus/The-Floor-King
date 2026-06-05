import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PoStatusBadge } from "@/components/po-status-badge";
import { getPurchaseOrder } from "@/lib/data/purchase-orders";
import { getCustomer } from "@/lib/data/customers";
import { listProducts } from "@/lib/data/products";
import { formatDate } from "@/lib/format";
import { PoBuilder } from "../po-builder";
import { deletePurchaseOrder } from "../actions";

export const metadata: Metadata = { title: "Purchase Order" };

export default async function PurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const po = await getPurchaseOrder(id);
  if (!po) notFound();

  const [products, customer] = await Promise.all([
    listProducts({ activeOnly: true }),
    po.customer_id ? getCustomer(po.customer_id) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
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
      </div>

      <PoBuilder po={po} products={products} />

      <form action={deletePurchaseOrder} className="mt-4 flex justify-end">
        <input type="hidden" name="id" value={po.id} />
        <Button type="submit" variant="destructive" size="sm">
          <Trash2 className="size-3.5" /> Delete PO
        </Button>
      </form>
    </div>
  );
}
