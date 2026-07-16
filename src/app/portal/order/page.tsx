import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { listOrderProducts } from "@/lib/data/orders";
import { OrderForm } from "@/components/order-form";
import { submitPortalOrder } from "@/app/order/actions";

export const metadata: Metadata = { title: "Place an order" };
export const dynamic = "force-dynamic";

export default async function PortalOrderPage() {
  await requireProfile();
  const products = await listOrderProducts();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">Place an order</h1>
        <p className="text-sm text-muted-foreground">
          Tell us what carpet you need cut for pickup. We&apos;ll review it,
          confirm pricing, and let you know when it&apos;s ready.
        </p>
      </div>
      <OrderForm products={products} requireContact={false} action={submitPortalOrder} />
    </div>
  );
}
