import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { PRODUCT_CATEGORY_LABELS, type ProductCategory } from "@/lib/types";
import type { BuyerPriceRow } from "@/lib/buyer-price";

function unitLabel(unit: string): string {
  if (unit === "sqft") return "sq ft";
  if (unit === "sqyd") return "sq yd";
  if (unit === "lnft") return "lin ft";
  return unit || "each";
}

function categoryLabel(category: string): string {
  return PRODUCT_CATEGORY_LABELS[category as ProductCategory] ?? category;
}

export function BuyerPriceList({
  rows,
  query,
}: {
  rows: BuyerPriceRow[] | null;
  query: string;
}) {
  return (
    <div className="space-y-4">
      <form action="/price-book" className="flex flex-col gap-2 sm:flex-row">
        <Input
          name="q"
          defaultValue={query}
          placeholder="Search name, color, or item code"
          aria-label="Search the price book"
          autoFocus
        />
        <Button type="submit">Search</Button>
      </form>
      {!query ? (
        <p className="text-sm text-muted-foreground">
          Search for a product by its name, color, or item code.
        </p>
      ) : rows == null ? (
        <p className="text-sm text-muted-foreground">
          The price book could not be loaded. Ask the shop to check the login.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {rows.length} {rows.length === 1 ? "price" : "prices"}
          </p>
          <div className="overflow-hidden rounded-lg border bg-background">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Your price</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[categoryLabel(row.category), row.manufacturer, row.style, row.color]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{row.sku || "—"}</td>
                    <td className="px-3 py-2 text-right font-medium whitespace-nowrap">
                      {row.sell != null ? (
                        <>
                          {formatMoney(row.sell)}
                          <span className="ml-1 font-normal text-muted-foreground">
                            / {unitLabel(row.unit)}
                          </span>
                        </>
                      ) : (
                        <span className="font-normal text-muted-foreground">Price needed</span>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-muted-foreground">
                      Nothing matches that search.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
