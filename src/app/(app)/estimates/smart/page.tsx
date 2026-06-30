import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getCustomer } from "@/lib/data/customers";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { getOrgSettings } from "@/lib/data/org";
import { BuilderSwitch } from "../builder-switch";

export const metadata: Metadata = { title: "Smart estimate" };
export const dynamic = "force-dynamic";

export default async function SmartEstimatePage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  await requireProfile();
  const customerId = (await searchParams).customer;
  if (!customerId) redirect("/customers");
  const customer = await getCustomer(customerId);
  if (!customer) redirect("/customers");
  const settings = await getBusinessSettings();
  const org = await getOrgSettings();

  return (
    <div className="mx-auto max-w-3xl pb-20">
      <Link
        href={`/customers/${customerId}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to {customer.full_name}
      </Link>
      <PageHeader
        title="Build an estimate"
        description="The step-by-step builder covers every base; Quick estimate is a one-screen fast quote. Both price to your margin and flow straight to the invoice, PO, and work order."
      />
      <BuilderSwitch
        customerId={customer.id}
        customerName={customer.full_name}
        targetMargin={settings.target_gross_margin_pct || 40}
        freightPct={org.freight_markup_pct ?? 0}
      />
    </div>
  );
}
