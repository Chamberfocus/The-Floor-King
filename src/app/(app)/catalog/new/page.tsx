import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { listActiveSuppliers } from "@/lib/data/suppliers";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { getOrgSettings } from "@/lib/data/org";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage() {
  const [vendorsRaw, biz, org] = await Promise.all([
    listActiveSuppliers(),
    getBusinessSettings(),
    getOrgSettings(),
  ]);
  const vendors = vendorsRaw.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
  }));
  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/catalog"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to catalog
      </Link>
      <PageHeader
        title="Add product"
        description="A reusable material or labor line you can drop into any estimate."
      />
      <Card>
        <CardContent className="pt-6">
          <ProductForm
            vendors={vendors}
            targetMarginPct={Number(biz.target_gross_margin_pct) || 40}
            freightMarkupPct={Number(org.freight_markup_pct) || 0}
          />
        </CardContent>
      </Card>
    </div>
  );
}
