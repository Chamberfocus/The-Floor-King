import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Upload, Search, Download } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { searchCatalog, productCount } from "@/lib/data/products";
import { getOrgSettings } from "@/lib/data/org";
import { requireProfile } from "@/lib/auth";
import { CatalogTable } from "./catalog-table";
import { CatalogCleanup } from "./catalog-cleanup";

export const metadata: Metadata = { title: "Catalog" };

const LIMIT = 300;

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = (await searchParams).q?.trim() ?? "";
  const [products, total, profile, org] = await Promise.all([
    searchCatalog(q, { limit: LIMIT }),
    productCount(),
    requireProfile(),
    getOrgSettings(),
  ]);

  return (
    <div>
      <PageHeader
        title="Materials catalog"
        description="Your flooring products and rates. Pull these into estimates to fill prices instantly."
      >
        <div className="flex gap-2">
          <a
            href="/catalog/export"
            className={buttonVariants({ size: "lg", variant: "ghost" })}
          >
            <Download className="size-4" /> Download CSV
          </a>
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

      {profile.role === "admin" ? (
        <div className="mb-3">
          <CatalogCleanup total={total} />
        </div>
      ) : null}

      <form method="get" className="mb-4 flex max-w-sm gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search products, SKU, manufacturer, color…"
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {total === 0 ? (
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
      ) : products.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No products match “{q}”.
        </p>
      ) : (
        <CatalogTable
          products={products}
          total={total}
          capped={products.length >= LIMIT}
          query={q}
          freightPct={org.freight_markup_pct ?? 0}
        />
      )}
    </div>
  );
}
