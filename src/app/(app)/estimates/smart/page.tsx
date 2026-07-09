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
        title="Build an estimate"
        description="Answer a few guided questions, or describe the job in plain English. Either way you get one itemized estimate that flows straight to the invoice, PO, and work order."
      />
      <BuilderSwitch
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
