import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getCustomer } from "@/lib/data/customers";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { getAddonDefaults } from "@/lib/data/addon-defaults";
import { SmartBuilder } from "../smart-builder";

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
  const addonDefaults = await getAddonDefaults();

  return (
    <div className="mx-auto max-w-3xl pb-20">
      <Link
        href={`/customers/${customerId}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to {customer.full_name}
      </Link>
      <PageHeader
        title="Smart estimate builder"
        description="Pick a flooring type per room — it sets the right measurement, waste, and the materials that job needs (pad, underlayment, thinset, trim…). Everything flows to the PO and warehouse."
      />
      <SmartBuilder
        customerId={customer.id}
        customerName={customer.full_name}
        targetMargin={settings.target_gross_margin_pct || 40}
        addonDefaults={addonDefaults}
      />
    </div>
  );
}
