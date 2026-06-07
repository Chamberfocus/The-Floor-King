import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { listProducts } from "@/lib/data/products";
import { CatalogTable } from "./catalog-table";

export const metadata: Metadata = { title: "Catalog" };

export default async function CatalogPage() {
  const products = await listProducts();

  return (
    <div>
      <PageHeader
        title="Materials catalog"
        description="Your flooring products and rates. Pull these into estimates to fill prices instantly."
      >
        <div className="flex gap-2">
          <Link
            href="/catalog/import"
            className={buttonVariants({ size: "lg", variant: "outline" })}
          >
            <Upload className="size-4" /> Import price list
          </Link>
          <Link href="/catalog/new" className={buttonVariants({ size: "lg" })}>
            <Plus className="size-4" /> Add product
          </Link>
        </div>
      </PageHeader>

      {products.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No products yet. Add your common flooring materials and labor rates so
            estimates build themselves.
          </p>
          <Link
            href="/catalog/new"
            className={buttonVariants({ className: "mt-4" })}
          >
            <Plus className="size-4" /> Add product
          </Link>
        </div>
      ) : (
        <CatalogTable products={products} />
      )}
    </div>
  );
}
