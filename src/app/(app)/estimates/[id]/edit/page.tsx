import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEstimate, listLineSuggestions } from "@/lib/data/estimates";
import { getCustomer } from "@/lib/data/customers";
import { getOrgSettings } from "@/lib/data/org";
import { EstimateBuilder } from "../../estimate-builder";

export const metadata: Metadata = { title: "Edit estimate" };

export default async function EditEstimatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const { id } = await params;
  const estimate = await getEstimate(id);
  if (!estimate) notFound();

  const customer = await getCustomer(estimate.customer_id);
  const org = await getOrgSettings();
  const suggestions = await listLineSuggestions();
  const autoPrint = (await searchParams).print === "1";

  return (
    <EstimateBuilder
      estimate={estimate}
      customerName={customer?.full_name ?? "customer"}
      customer={customer}
      org={org}
      autoPrint={autoPrint}
      colorSuggestions={suggestions.colors}
      manufacturerSuggestions={suggestions.manufacturers}
    />
  );
}
