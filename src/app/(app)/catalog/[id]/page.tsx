import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { getProduct } from "@/lib/data/products";
import { listSuppliers } from "@/lib/data/suppliers";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { getOrgSettings } from "@/lib/data/org";
import { ProductForm } from "../product-form";
import { requireProfile } from "@/lib/auth";
import { RecordLifecycleMenu } from "@/components/record-lifecycle-menu";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const product = await getProduct(id);
  return { title: product?.name ?? "Product" };
}

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const product = await getProduct(id);
  if (!product) notFound();
  // All vendors (incl. inactive) so an existing product's vendor still shows.
  const vendors = (await listSuppliers()).map((s) => ({ id: s.id, name: s.name, kind: s.kind }));
  const [biz, org] = await Promise.all([getBusinessSettings(), getOrgSettings()]);

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/catalog"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to catalog
      </Link>
      <PageHeader title="Edit product" />
      <Card>
        <CardContent className="pt-6">
          <ProductForm
            product={product}
            vendors={vendors}
            targetMarginPct={Number(biz.target_gross_margin_pct) || 40}
            freightMarkupPct={Number(org.freight_markup_pct) || 0}
          />
        </CardContent>
      </Card>

      <div className="mt-4 flex justify-end">
        <RecordLifecycleMenu
          recordType="product"
          recordId={product.id}
          archivedAt={(product as { archived_at?: string | null }).archived_at}
          allowArchive={profile.role === "admin" || profile.role === "office"}
          allowDelete={profile.role === "admin"}
        />
      </div>
    </div>
  );
}
