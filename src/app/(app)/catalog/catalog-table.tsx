"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { PRODUCT_CATEGORY_LABELS } from "@/lib/types";
import type { Product } from "@/lib/types";
import { formatMoney } from "@/lib/format";

const MAX_ROWS = 300; // render cap for large catalogs (search to find more)

export function CatalogTable({ products }: { products: Product[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return products;
    return products.filter((p) =>
      [
        p.name,
        p.sku ?? "",
        p.manufacturer ?? "",
        p.style ?? "",
        p.color ?? "",
        p.unit,
        p.notes ?? "",
        PRODUCT_CATEGORY_LABELS[p.category],
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [products, q]);

  const shown = filtered.slice(0, MAX_ROWS);

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search products, SKU, category…"
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No products match “{q}”.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Material</TableHead>
                <TableHead className="text-right">Labor</TableHead>
                <TableHead className="text-right">Installed</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((p) => (
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
                  <TableCell className="text-muted-foreground">
                    {p.sku ?? "—"}
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
                  <TableCell className="text-muted-foreground">
                    {p.unit}
                  </TableCell>
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

      <p className="text-xs text-muted-foreground">
        Showing {shown.length} of {filtered.length.toLocaleString()}
        {q ? " matches" : ""} · {products.length.toLocaleString()} total
        {filtered.length > MAX_ROWS ? " — search to narrow down" : ""}
      </p>
    </div>
  );
}
