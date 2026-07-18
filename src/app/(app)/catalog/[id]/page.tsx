import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { PageHeader } from "@/components/page-header";
import { getProduct } from "@/lib/data/products";
import { listSuppliers } from "@/lib/data/suppliers";
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
          <ProductForm product={product} vendors={vendors} />
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
