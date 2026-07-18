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
import { landedMaterialCost } from "@/lib/freight";

export function CatalogTable({
  products,
  total,
  capped,
  query,
  freightPct,
}: {
  products: Product[];
  total: number;
  capped: boolean;
  query: string;
  freightPct: number;
}) {
  const shown = products;
  const showLanded = freightPct > 0;

  return (
    <div className="space-y-3">
      <div className="space-y-2 md:hidden">
        {shown.map((p) => (
          <div
            key={p.id}
            className={`rounded-lg border p-3 ${p.active ? "" : "opacity-50"}`}
          >
            <Link
              href={`/catalog/${p.id}`}
              className="font-medium hover:underline"
            >
              {p.name}
            </Link>
            {!p.active ? (
              <span className="ml-2 text-xs text-muted-foreground">
                (inactive)
              </span>
            ) : null}
            <div className="text-xs text-muted-foreground">
              {PRODUCT_CATEGORY_LABELS[p.category]} · {p.sku ?? "—"} · {p.unit}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              <span>Maker: {p.manufacturer ?? "—"}</span>
              <span>·</span>
              <span>
                Vendor:{" "}
                {p.vendors && p.vendors.length
                  ? p.vendors.length === 1
                    ? (p.vendors[0].vendor_name ?? "1 vendor")
                    : `${p.vendors.length} vendors`
                  : "—"}
              </span>
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-2 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Material</div>
                <div className="font-medium">
                  {formatMoney(p.material_rate)}
                </div>
              </div>
              {showLanded ? (
                <div>
                  <div className="text-xs text-muted-foreground">Landed</div>
                  <div className="font-medium">
                    {formatMoney(landedMaterialCost(p.material_rate, freightPct))}
                  </div>
                </div>
              ) : null}
              <div>
                <div className="text-xs text-muted-foreground">Labor</div>
                <div className="font-medium">{formatMoney(p.labor_rate)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Installed</div>
                <div className="font-medium">
                  {formatMoney(p.material_rate + p.labor_rate)}
                </div>
              </div>
            </div>
            <div className="mt-2">
              <Link
                href={`/catalog/${p.id}`}
                className="text-sm text-muted-foreground hover:text-foreground hover:underline"
              >
                Edit
              </Link>
            </div>
          </div>
        ))}
      </div>

      {(
        <div className="hidden overflow-x-auto rounded-lg border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Maker / Vendor</TableHead>
                <TableHead className="text-right">Material</TableHead>
                {showLanded ? (
                  <TableHead className="text-right">
                    Landed
                    <span className="block text-xs font-normal text-muted-foreground">
                      +{freightPct}% freight
                    </span>
                  </TableHead>
                ) : null}
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
                  <TableCell className="text-muted-foreground">
                    <span className="text-foreground">{p.manufacturer ?? "—"}</span>
                    <span className="block text-xs">
                      {p.vendors && p.vendors.length
                        ? p.vendors.length === 1
                          ? (p.vendors[0].vendor_name ?? "1 vendor")
                          : `${p.vendors.length} vendors`
                        : "no vendor"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {formatMoney(p.material_rate)}
                  </TableCell>
                  {showLanded ? (
                    <TableCell className="text-right font-medium">
                      {formatMoney(landedMaterialCost(p.material_rate, freightPct))}
                    </TableCell>
                  ) : null}
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
