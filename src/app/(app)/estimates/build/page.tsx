import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCustomer } from "@/lib/data/customers";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { getOrgSettings } from "@/lib/data/org";
import { listServiceAddresses } from "@/lib/data/service-addresses";
import { formatServiceAddress } from "@/lib/types";
import { OwnEstimateForm } from "./own-estimate-form";

export const metadata: Metadata = { title: "Build it myself" };
export const dynamic = "force-dynamic";

export default async function BuildOwnEstimatePage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; site?: string }>;
}) {
  const profile = await requireRole(["admin", "office", "sales_manager", "salesman"]);
  const { customer: customerId, site } = await searchParams;
  if (!customerId) redirect("/estimates/start");
  const customer = await getCustomer(customerId);
  if (!customer) redirect("/estimates/start");

  const supabase = await createClient();
  const [{ data: lastEst }, biz, org, addresses] = await Promise.all([
    supabase
      .from("estimates")
      .select("tax_rate")
      .not("tax_rate", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getBusinessSettings(),
    getOrgSettings(),
    listServiceAddresses(customer.id),
  ]);

  const siteId = site?.trim() || null;
  const property = siteId ? addresses.find((a) => a.id === siteId) : null;
  const propertyLabel = property
    ? property.label || formatServiceAddress(property)
    : null;

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href={`/customers/${customer.id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to {customer.full_name}
      </Link>
      <PageHeader
        title="Build it myself"
        description="Search a product, type how many, and name the room. Labor is the work, not a product. The purchase order and work order use these same lines."
      />
      <OwnEstimateForm
        customerId={customer.id}
        customerName={customer.full_name}
        propertyLabel={propertyLabel}
        serviceAddressId={siteId}
        defaultTaxRate={Number(lastEst?.tax_rate ?? 0) || 0}
        targetMargin={Number(biz?.target_gross_margin_pct ?? 40) || 40}
        freightMarkupPct={Number(org.freight_markup_pct ?? 0) || 0}
        fuelCharge={Number(biz.job_fuel_charge) || 0}
        salespersonGas={Number(biz.job_fuel_fee) || 0}
        carAllowance={Number(biz.job_car_allowance) || 0}
        commissionPct={Number(biz.job_commission_pct) || 0}
        viewerRole={profile.role}
      />
    </div>
  );
}
