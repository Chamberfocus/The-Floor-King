import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PRODUCT_CATEGORY_LABELS } from "@/lib/types";
import type { Product } from "@/lib/types";
import { formatMoney } from "@/lib/format";

export function CatalogTable({
  products,
  total,
  capped,
  query,
}: {
  products: Product[];
  total: number;
  capped: boolean;
  query: string;
}) {
  const shown = products;

  return (
    <div className="space-y-3">
      {(
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
        Showing {shown.length.toLocaleString()}
        {query ? ` match${shown.length === 1 ? "" : "es"} for “${query}”` : ""} ·{" "}
        {total.toLocaleString()} products total
        {capped ? " — refine your search to see more" : ""}
      </p>
    </div>
  );
}
