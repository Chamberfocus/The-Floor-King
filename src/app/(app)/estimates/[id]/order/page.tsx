import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getEstimateOrderPlan } from "@/lib/data/po-plan";
import { OrderMaterials } from "./order-materials";

export const metadata: Metadata = { title: "Order materials" };
export const dynamic = "force-dynamic";

const ALLOWED = ["admin", "office", "sales_manager", "warehouse"];

export default async function OrderMaterialsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireProfile();
  if (!ALLOWED.includes(profile.role)) redirect("/");
  const { id } = await params;
  const plan = await getEstimateOrderPlan(id);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/estimates/${id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to estimate
      </Link>
      <PageHeader
        title="Order materials"
        description="Every material on the estimate, grouped by the company it's ordered from. Check what to order, assign a company to anything unknown, then create the purchase orders."
      />
      <OrderMaterials plan={plan} />
    </div>
  );
}
