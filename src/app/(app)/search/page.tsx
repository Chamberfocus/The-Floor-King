import type { Metadata } from "next";
import Link from "next/link";
import {
  Users, FileText, Receipt, ShoppingCart, Wrench, Package,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { quickSearch, type HitType } from "./actions";

export const metadata: Metadata = { title: "Search" };

const ICON: Record<HitType, LucideIcon> = {
  customer: Users,
  estimate: FileText,
  invoice: Receipt,
  po: ShoppingCart,
  job: Wrench,
  product: Package,
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const { groups, total } = await quickSearch(query, 30);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Search"
        description={
          query
            ? `${total} result${total === 1 ? "" : "s"} for “${query}”`
            : "Find any customer, estimate, invoice, purchase order, job, or catalog item."
        }
      />

      {query && total === 0 ? (
        <p className="text-sm text-muted-foreground">
          No matches for “{query}”. Try a name, phone number, invoice #, supplier,
          item, color, manufacturer, or a product / SKU.
        </p>
      ) : null}

      <div className="space-y-6">
        {groups.map((g) => {
          const Icon = ICON[g.type];
          return (
            <div key={g.type}>
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Icon className="size-3.5" /> {g.label} ({g.hits.length})
              </h2>
              <div className="space-y-2">
                {g.hits.map((hit) => (
                  <Link key={`${hit.type}-${hit.id}`} href={hit.href}>
                    <Card className="transition-colors hover:bg-muted/50">
                      <CardContent className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{hit.title}</div>
                          {hit.subtitle ? (
                            <div className="truncate text-xs text-muted-foreground">
                              {hit.subtitle}
                            </div>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
