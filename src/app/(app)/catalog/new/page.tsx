import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { listSuppliers } from "@/lib/data/suppliers";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage() {
  const suppliers = (await listSuppliers()).map((s) => s.name);
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
          <ProductForm suppliers={suppliers} />
        </CardContent>
      </Card>
    </div>
  );
}
