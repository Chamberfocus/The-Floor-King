"use client";

import { useMemo, useState } from "react";
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

export function BuyerPriceList({ rows }: { rows: BuyerPriceRow[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const categories = useMemo(() => {
    const set = new Set(rows.map((row) => row.category));
    return [...set].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)));
  }, [rows]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (category !== "all" && row.category !== category) return false;
      if (!q) return true;
      return [row.name, row.sku, row.manufacturer, row.style, row.color]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, query, category]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, color, or item code"
          aria-label="Search the price book"
        />
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          aria-label="Category"
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="all">All categories</option>
          {categories.map((item) => (
            <option key={item} value={item}>
              {categoryLabel(item)}
            </option>
          ))}
        </select>
      </div>
      <p className="text-sm text-muted-foreground">
        {shown.length} {shown.length === 1 ? "price" : "prices"}
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
            {shown.map((row) => (
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
                  {formatMoney(row.sell)}
                  <span className="ml-1 font-normal text-muted-foreground">/ {unitLabel(row.unit)}</span>
                </td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-muted-foreground">
                  Nothing matches that search.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
