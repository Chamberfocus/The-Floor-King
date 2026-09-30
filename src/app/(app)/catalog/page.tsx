import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Upload, Search, Download, Package } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { searchCatalog, listCatalogPage, productCount } from "@/lib/data/products";
import { lifecycleSchemaReady } from "@/lib/record-lifecycle-db";
import { parseLifecycleView } from "@/lib/record-lifecycle";
import { LifecycleFilter } from "@/components/record-lifecycle-menu";
import { getOrgSettings } from "@/lib/data/org";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { requireProfile } from "@/lib/auth";
import { CatalogTable } from "./catalog-table";
import { CatalogCleanup } from "./catalog-cleanup";

export const metadata: Metadata = { title: "Catalog" };

const LIMIT = 300;

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; life?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const lifecycle = parseLifecycleView(params.life);
  const lifecycleReady = await lifecycleSchemaReady();
  const [products, total, profile, org, biz] = await Promise.all([
    lifecycleReady && lifecycle !== "active"
      ? listCatalogPage(q, lifecycle, LIMIT)
      : searchCatalog(q, { limit: LIMIT }),
    productCount(),
    requireProfile(),
    getOrgSettings(),
    getBusinessSettings(),
  ]);

  return (
    <div>
      <PageHeader
        title="Materials catalog"
        description="Your flooring products — our cost and the customer sell at target margin. Pull these into estimates to fill prices instantly."
      >
        <div className="flex gap-2">
          {/* A real <a>, not <Link>: /catalog/export is a Route Handler that
              streams a CSV file — client navigation would break the download. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
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

      <LifecycleFilter
        ready={lifecycleReady}
        value={lifecycle}
        makeHref={(next) => {
          const search = new URLSearchParams();
          if (q) search.set("q", q);
          if (next !== "active") search.set("life", next);
          const qs = search.toString();
          return qs ? `/catalog?${qs}` : "/catalog";
        }}
      />

      <form method="get" className="mb-4 flex max-w-sm gap-2">
        {lifecycle !== "active" ? <input type="hidden" name="life" value={lifecycle} /> : null}
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
        <EmptyState
          icon={Package}
          title="No products yet"
          description="Add your common flooring materials and labor rates so estimates build themselves."
          action={
            <Link href="/catalog/new" className={buttonVariants({})}>
              <Plus className="size-4" /> Add product
            </Link>
          }
        />
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
          viewerRole={profile.role}
          targetMarginPct={Number(biz.target_gross_margin_pct) || 40}
        />
      )}
    </div>
  );
}
