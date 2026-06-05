import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { listProducts } from "@/lib/data/products";
import { PRODUCT_CATEGORY_LABELS } from "@/lib/types";
import { formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Catalog" };

export default async function CatalogPage() {
  const products = await listProducts();

  return (
    <div>
      <PageHeader
        title="Materials catalog"
        description="Your flooring products and rates. Pull these into estimates to fill prices instantly."
      >
        <Link href="/catalog/new" className={buttonVariants({ size: "lg" })}>
          <Plus className="size-4" /> Add product
        </Link>
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
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Material</TableHead>
                <TableHead className="text-right">Labor</TableHead>
                <TableHead className="text-right">Installed</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.id} className={p.active ? "" : "opacity-50"}>
                  <TableCell className="font-medium">
                    <Link href={`/catalog/${p.id}`} className="hover:underline">
                      {p.name}
                    </Link>
                    {!p.active ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (inactive)
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {PRODUCT_CATEGORY_LABELS[p.category]}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatMoney(p.material_rate)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatMoney(p.labor_rate)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatMoney(p.material_rate + p.labor_rate)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.unit}</TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/catalog/${p.id}`}
                      className="text-sm text-muted-foreground hover:text-foreground hover:underline"
                    >
                      Edit
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
