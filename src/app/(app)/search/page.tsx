import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { searchCrm, searchProducts } from "@/lib/data/search";
import { PRODUCT_CATEGORY_LABELS } from "@/lib/types";
import { formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const [results, products] =
    query.length >= 2
      ? await Promise.all([searchCrm(query), searchProducts(query)])
      : [[], []];
  const total = results.length + products.length;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Search"
        description={
          query
            ? `${total} result${total === 1 ? "" : "s"} for “${query}”`
            : "Find any customer, or any product in your materials catalog."
        }
      />

      {query && total === 0 ? (
        <p className="text-sm text-muted-foreground">
          No matches for “{query}”. Try a name, phone number, item, color,
          manufacturer, or a product / SKU from your catalog.
        </p>
      ) : null}

      {products.length > 0 ? (
        <div className="mb-6 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Catalog ({products.length})
          </h2>
          {products.map((p) => (
            <Link key={p.id} href={`/catalog/${p.id}`}>
              <Card className="transition-colors hover:bg-muted/50">
                <CardContent className="flex items-center justify-between gap-3 py-4">
                  <div className="flex flex-col gap-1">
                    <div className="font-semibold">
                      {p.name}
                      {!p.active ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (inactive)
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[
                        PRODUCT_CATEGORY_LABELS[p.category],
                        p.sku ? `SKU ${p.sku}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    <div className="font-medium">
                      {formatMoney(p.material_rate + p.labor_rate)}
                      <span className="text-muted-foreground">/{p.unit}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      installed
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : null}

      {results.length > 0 ? (
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Customers ({results.length})
        </h2>
      ) : null}

      <div className="space-y-2">
        {results.map((r) => (
          <Link key={r.customerId} href={`/customers/${r.customerId}`}>
            <Card className="transition-colors hover:bg-muted/50">
              <CardContent className="flex flex-col gap-1 py-4">
                <div className="font-semibold">
                  {r.name}
                  {r.company ? (
                    <span className="text-muted-foreground"> · {r.company}</span>
                  ) : null}
                </div>
                {(r.city || r.phone) && (
                  <div className="text-xs text-muted-foreground">
                    {[r.city, r.phone].filter(Boolean).join(" · ")}
                  </div>
                )}
                <div className="mt-1 flex flex-wrap gap-1">
                  {r.reasons.slice(0, 5).map((reason, i) => (
                    <span
                      key={i}
                      className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
