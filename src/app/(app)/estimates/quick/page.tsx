import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { getOrgSettings } from "@/lib/data/org";
import { catalogSellPrice, catalogUnitCost } from "@/lib/catalog-pricing";
import { QuickEstimateForm } from "./quick-estimate-form";
import type { QuickProduct } from "@/components/quick-lines";

export const metadata: Metadata = { title: "Quick estimate" };
export const dynamic = "force-dynamic";

export default async function QuickEstimatePage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  await requireRole(["admin", "office", "sales_manager", "salesman"]);
  const { customer } = await searchParams;
  const supabase = await createClient();

  const [{ data: custData }, { data: prodData }, { data: lastEst }, biz, org] =
    await Promise.all([
      supabase
        .from("customers")
        .select("id, full_name")
        .order("full_name", { ascending: true })
        .limit(2000),
      supabase
        .from("products")
        .select(
          "id, name, unit, material_rate, manufacturer, style, color, category, active, clearance, clearance_price",
        )
        .eq("active", true)
        .order("name", { ascending: true })
        .limit(2000),
      // Tax lives per document, so default to the last rate actually used.
      supabase
        .from("estimates")
        .select("tax_rate")
        .not("tax_rate", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      getBusinessSettings(),
      getOrgSettings(),
    ]);

  // Cost is read separately with the vendor join so the margin shown is real.
  const ids = (prodData ?? []).map((p) => p.id as string);
  const { data: vendorCosts } = ids.length
    ? await supabase
        .from("product_vendors")
        .select("product_id, cost, position")
        .in("product_id", ids)
        .order("position", { ascending: true })
    : { data: [] as { product_id: string; cost: number | null }[] };

  const costByProduct = new Map<string, number>();
  for (const v of vendorCosts ?? []) {
    const key = v.product_id as string;
    if (!costByProduct.has(key) && v.cost != null) {
      costByProduct.set(key, Number(v.cost));
    }
  }

  const customers = (custData ?? []).map((c) => ({
    id: c.id as string,
    full_name: (c.full_name as string) ?? "Unnamed",
  }));

  const margin = Number(biz?.target_gross_margin_pct ?? 40) || 40;
  const freight = Number(org.freight_markup_pct ?? 0) || 0;

  const products: (QuickProduct & { cost?: number | null })[] = (prodData ?? []).map(
    (p) => {
      const vendors = costByProduct.has(p.id as string)
        ? [
            {
              id: "v",
              product_id: p.id as string,
              vendor_id: "s",
              cost: costByProduct.get(p.id as string)!,
              vendor_sku: null,
              position: 0,
            },
          ]
        : [];
      const cost = catalogUnitCost({
        material_rate: p.material_rate,
        vendors,
      });
      const sell = catalogSellPrice({
        material_rate: p.material_rate,
        vendors,
        clearance: Boolean(p.clearance),
        clearance_price: p.clearance_price as number | null,
        targetMarginPct: margin,
        freightMarkupPct: freight,
      });
      return {
        id: p.id as string,
        name: (p.name as string) ?? "",
        unit: (p.unit as string) ?? "each",
        rate: sell.missing || sell.amount == null ? 0 : sell.amount,
        priceNeeded: sell.missing,
        manufacturer: (p.manufacturer as string) ?? null,
        style: (p.style as string) ?? null,
        color: (p.color as string) ?? null,
        cost: cost.missing ? null : cost.amount,
      };
    },
  );

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/estimates"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to estimates
      </Link>
      <PageHeader
        title="Quick estimate"
        description="A few lines and a number, without the full questionnaire. Same records underneath — it opens in the builder afterwards if it grows."
      />
      <QuickEstimateForm
        customers={customers}
        products={products}
        defaultTaxRate={Number(lastEst?.tax_rate ?? 0) || 0}
        targetMargin={margin}
        freightMarkupPct={freight}
        presetCustomerId={customer}
      />
    </div>
  );
}
