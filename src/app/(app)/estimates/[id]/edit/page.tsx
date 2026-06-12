import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEstimate } from "@/lib/data/estimates";
import { getCustomer } from "@/lib/data/customers";
import { EstimateBuilder } from "../../estimate-builder";

export const metadata: Metadata = { title: "Edit estimate" };

export default async function EditEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const estimate = await getEstimate(id);
  if (!estimate) notFound();

  const customer = await getCustomer(estimate.customer_id);

  return (
    <EstimateBuilder
      estimate={estimate}
      customerName={customer?.full_name ?? "customer"}
    />
  );
}
