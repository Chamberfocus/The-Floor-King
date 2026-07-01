import type { Metadata } from "next";
import { COMPANY_NAME } from "@/lib/nav";
import { listOrderProducts } from "@/lib/data/orders";
import { OrderForm } from "@/components/order-form";
import { submitPublicOrder } from "./actions";

export const metadata: Metadata = { title: "Place an order" };
export const dynamic = "force-dynamic";

export default async function PublicOrderPage() {
  const products = await listOrderProducts();

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{COMPANY_NAME}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Place a carpet order for pickup. Pick from our products or just tell us
          what you need — we&apos;ll review it, confirm pricing, and let you know
          when it&apos;s cut and ready to grab.
        </p>
      </div>
      <OrderForm products={products} requireContact action={submitPublicOrder} />
    </div>
  );
}
