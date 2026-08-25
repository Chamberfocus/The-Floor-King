import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getCustomer } from "@/lib/data/customers";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { listServiceAddresses } from "@/lib/data/service-addresses";
import { listEstimateQuestions } from "@/lib/data/estimate-questions";
import { listCustomerAreas } from "@/lib/data/customer-areas";
import { formatServiceAddress } from "@/lib/types";
import { getEstimateDraft } from "../smart-actions";
import { GuidedEstimate } from "../guided-client";

export const metadata: Metadata = { title: "Guided estimate" };
export const dynamic = "force-dynamic";

export default async function GuidedEstimatePage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; site?: string }>;
}) {
  await requireProfile();
  const sp = await searchParams;
  const customerId = sp.customer;
  // Picked in the New estimate dialog — don't make them choose the property
  // twice for the same quote.
  const initialSite = sp.site ?? null;
  if (!customerId) redirect("/customers");
  const customer = await getCustomer(customerId);
  if (!customer) redirect("/customers");
  const settings = await getBusinessSettings();
  const serviceAddresses = (await listServiceAddresses(customer.id)).map((a) => ({
    id: a.id,
    label: a.label || formatServiceAddress(a),
  }));
  const questions = await listEstimateQuestions({ activeOnly: true });
  const savedAreas = await listCustomerAreas(customer.id);
  const draft = await getEstimateDraft(customer.id);

  return (
    <div className="mx-auto max-w-5xl pb-20">
      <Link
        href={`/customers/${customerId}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to {customer.full_name}
      </Link>
      <PageHeader
        title="Guided estimate"
        description="Walk the job step by step — carpet, hard surface, or both. Answer what applies, skip the rest. It builds a real itemized estimate you review in the builder, and it flows straight to the work order and PO."
      />
      <GuidedEstimate
        initialServiceAddressId={initialSite}
        customerId={customer.id}
        customerName={customer.full_name}
        targetMargin={settings.target_gross_margin_pct || 40}
        serviceAddresses={serviceAddresses}
        questions={questions}
        savedAreas={savedAreas}
        draft={draft}
      />
    </div>
  );
}
