import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { getProduct } from "@/lib/data/products";
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

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/catalog"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to catalog
      </Link>
      <PageHeader title="Edit product" />
      <Card>
        <CardContent className="pt-6">
          <ProductForm product={product} />
        </CardContent>
      </Card>

      <form action={deleteProduct} className="mt-4 flex justify-end">
        <input type="hidden" name="id" value={product.id} />
        <Button type="submit" variant="destructive" size="sm">
          <Trash2 className="size-3.5" /> Delete product
        </Button>
      </form>
    </div>
  );
}
