import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { OrderForm } from "@/components/order-form";
import { submitPortalOrder } from "@/app/order/actions";

export const metadata: Metadata = { title: "Place an order" };
export const dynamic = "force-dynamic";

export default async function PortalOrderPage() {
  await requireProfile();
  const admin = createAdminClient();
  const { data } = await admin
    .from("products")
    .select("id, name, unit")
    .eq("active", true)
    .order("name", { ascending: true })
    .limit(1000);
  const products = (data ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    unit: (p.unit as string) || "sq yd",
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Place an order</h1>
        <p className="text-sm text-muted-foreground">
          Tell us what carpet you need cut for pickup. We&apos;ll review it,
          confirm pricing, and let you know when it&apos;s ready.
        </p>
      </div>
      <OrderForm products={products} requireContact={false} action={submitPortalOrder} />
    </div>
  );
}
