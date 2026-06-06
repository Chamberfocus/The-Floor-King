import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { searchCrm } from "@/lib/data/search";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const results = query.length >= 2 ? await searchCrm(query) : [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Search"
        description={
          query
            ? `${results.length} result${results.length === 1 ? "" : "s"} for “${query}”`
            : "Find any customer by name, address, or anything in their estimates, jobs, and invoices."
        }
      />

      {query && results.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No matches for “{query}”. Try a name, phone number, item, color, or
          manufacturer.
        </p>
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
