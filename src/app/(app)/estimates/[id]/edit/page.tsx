import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEstimate, listLineSuggestions } from "@/lib/data/estimates";
import { listAddonCatalog } from "@/lib/data/addon-defaults";
import { getCustomer } from "@/lib/data/customers";
import { getOrgSettings } from "@/lib/data/org";
import { createClient } from "@/lib/supabase/server";
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
  const addonCatalog = await listAddonCatalog();
  const autoPrint = (await searchParams).print === "1";

  // The catalog unit of each linked product — so the builder can flag a line
  // that's priced by area when its product is really sold by the each/bag.
  const productIds = [
    ...new Set(
      (estimate.options ?? [])
        .flatMap((o) => o.line_items ?? [])
        .map((l) => l.product_id)
        .filter(Boolean) as string[],
    ),
  ];
  const productUnits: Record<string, string> = {};
  const productDefaults: Record<string, { material_rate: number; labor_rate: number; unit: string }> = {};
  if (productIds.length) {
    const supabase = await createClient();
    const { data: prods } = await supabase
      .from("products")
      .select("id, unit, material_rate, labor_rate")
      .in("id", productIds);
    for (const p of prods ?? []) {
      const unit = (p.unit as string) ?? "";
      productUnits[p.id as string] = unit;
      productDefaults[p.id as string] = {
        material_rate: Number(p.material_rate) || 0,
        labor_rate: Number(p.labor_rate) || 0,
        unit,
      };
    }
  }

  return (
    <EstimateBuilder
      estimate={estimate}
      customerName={customer?.full_name ?? "customer"}
      customer={customer}
      org={org}
      autoPrint={autoPrint}
      colorSuggestions={suggestions.colors}
      manufacturerSuggestions={suggestions.manufacturers}
      addonCatalog={addonCatalog}
      productUnits={productUnits}
      productDefaults={productDefaults}
    />
  );
}
