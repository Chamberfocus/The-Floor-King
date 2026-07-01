import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { COMPANY_NAME } from "@/lib/nav";
import { OrderForm } from "@/components/order-form";
import { submitPublicOrder } from "./actions";

export const metadata: Metadata = { title: "Place an order" };
export const dynamic = "force-dynamic";

export default async function PublicOrderPage() {
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
