import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { millFactLabel, safeSpecUrl } from "@/lib/supplier-facts";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { PageHeader } from "@/components/page-header";
import { getProduct } from "@/lib/data/products";
import { listSuppliers } from "@/lib/data/suppliers";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { getOrgSettings } from "@/lib/data/org";
import { ProductForm } from "../product-form";
import { deleteProduct } from "../actions";

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
  const product = await getProduct(id);
  if (!product) notFound();
  // All vendors (incl. inactive) so an existing product's vendor still shows.
  const vendors = (await listSuppliers()).map((s) => ({ id: s.id, name: s.name, kind: s.kind }));
  const [biz, org] = await Promise.all([getBusinessSettings(), getOrgSettings()]);
  const mill = millFactLabel({
    availableQty: product.mill_available,
    availableUom: product.mill_uom,
    rollWidthFt: product.mill_width_ft,
    rollLengthFt: product.mill_length_ft,
  });
  const specUrl = safeSpecUrl(product.mill_spec_url);
  const showMill = Boolean(mill || specUrl || product.mill_description);

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/catalog"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to catalog
      </Link>
      <PageHeader title="Edit product" />
      {showMill ? (
        <Card className="mb-4">
          <CardContent className="pt-6 text-sm">
            <div className="font-medium">From the mill</div>
            <p className="mt-1 text-muted-foreground">
              What the manufacturer last reported. This is not our warehouse count, and it does not
              change the price.
              {product.mill_checked_at ? ` Checked ${formatDate(product.mill_checked_at)}.` : ""}
            </p>
            {mill ? <p className="mt-2">{mill}</p> : null}
            {product.mill_description ? (
              <p className="mt-1 line-clamp-3 text-muted-foreground">{product.mill_description}</p>
            ) : null}
            {specUrl ? (
              <p className="mt-2">
                <a href={specUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                  Spec sheet
                </a>
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
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

      <form action={deleteProduct} className="mt-4 flex justify-end">
        <input type="hidden" name="id" value={product.id} />
        <ConfirmButton
          variant="destructive"
          size="sm"
          title={`Delete "${product.name}"?`}
          description="Removes this product from the catalog. Existing estimates keep their copied prices. This can't be undone."
          confirmLabel="Delete product"
          destructive
        >
          <Trash2 className="size-3.5" /> Delete product
        </ConfirmButton>
      </form>
    </div>
  );
}
