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
import type { Product, UserRole } from "@/lib/types";
import { formatMoney } from "@/lib/format";
import { landedMaterialCost } from "@/lib/freight";
import {
  PRICE_NEEDED,
  catalogMarginPct,
  catalogSellPrice,
  catalogUnitCost,
  formatCatalogPrice,
  roleMaySeeCatalogCost,
  roleMaySeeCatalogMargin,
  roleMaySeeCatalogSell,
} from "@/lib/catalog-pricing";
import { cn } from "@/lib/utils";

function PriceCell({
  value,
  needed,
}: {
  value: string;
  needed: boolean;
}) {
  return (
    <span className={cn("tabular-nums", needed && "font-medium text-amber-700")}>
      {value}
    </span>
  );
}

export function CatalogTable({
  products,
  total,
  capped,
  query,
  freightPct,
  viewerRole,
  targetMarginPct,
}: {
  products: Product[];
  total: number;
  capped: boolean;
  query: string;
  freightPct: number;
  viewerRole: UserRole;
  targetMarginPct: number;
}) {
  const shown = products;
  const showCost = roleMaySeeCatalogCost(viewerRole, "sell");
  const showSell = roleMaySeeCatalogSell(viewerRole);
  const showMargin = roleMaySeeCatalogMargin(viewerRole);
  const showLanded = showCost && freightPct > 0;

  const rowMoney = (p: Product) => {
    const cost = catalogUnitCost(p);
    const sell =
      p.catalog_sell != null
        ? { amount: p.catalog_sell, missing: false as const, kind: "target_margin" as const }
        : catalogSellPrice({
            ...p,
            targetMarginPct,
            freightMarkupPct: freightPct,
          });
    const margin = catalogMarginPct(cost, sell);
    return { cost, sell, margin };
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2 md:hidden">
        {shown.map((p) => {
          const m = rowMoney(p);
          return (
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
              {showCost ? (
                <div>
                  <div className="text-xs text-muted-foreground">Cost</div>
                  <div className="font-medium">
                    <PriceCell
                      value={formatCatalogPrice(m.cost, formatMoney)}
                      needed={m.cost.missing}
                    />
                  </div>
                </div>
              ) : null}
              {showLanded && !m.cost.missing && m.cost.amount != null ? (
                <div>
                  <div className="text-xs text-muted-foreground">Landed</div>
                  <div className="font-medium">
                    {formatMoney(landedMaterialCost(m.cost.amount, freightPct))}
                  </div>
                </div>
              ) : null}
              {showSell ? (
                <div>
                  <div className="text-xs text-muted-foreground">Sell</div>
                  <div className="font-medium">
                    <PriceCell
                      value={formatCatalogPrice(m.sell, formatMoney)}
                      needed={m.sell.missing}
                    />
                  </div>
                </div>
              ) : null}
              {showMargin ? (
                <div>
                  <div className="text-xs text-muted-foreground">Margin</div>
                  <div className="font-medium">
                    {m.margin != null ? `${Math.round(m.margin)}%` : "—"}
                  </div>
                </div>
              ) : null}
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
          );
        })}
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
                {showCost ? (
                  <TableHead className="text-right">Cost</TableHead>
                ) : null}
                {showLanded ? (
                  <TableHead className="text-right">
                    Landed
                    <span className="block text-xs font-normal text-muted-foreground">
                      +{freightPct}% freight
                    </span>
                  </TableHead>
                ) : null}
                {showSell ? (
                  <TableHead className="text-right">Sell</TableHead>
                ) : null}
                {showMargin ? (
                  <TableHead className="text-right">Margin</TableHead>
                ) : null}
                <TableHead>Unit</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((p) => {
                const m = rowMoney(p);
                return (
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
                  {showCost ? (
                    <TableCell className="text-right">
                      <PriceCell
                        value={formatCatalogPrice(m.cost, formatMoney)}
                        needed={m.cost.missing}
                      />
                    </TableCell>
                  ) : null}
                  {showLanded ? (
                    <TableCell className="text-right font-medium">
                      {!m.cost.missing && m.cost.amount != null
                        ? formatMoney(landedMaterialCost(m.cost.amount, freightPct))
                        : PRICE_NEEDED}
                    </TableCell>
                  ) : null}
                  {showSell ? (
                    <TableCell className="text-right font-medium">
                      <PriceCell
                        value={formatCatalogPrice(m.sell, formatMoney)}
                        needed={m.sell.missing}
                      />
                    </TableCell>
                  ) : null}
                  {showMargin ? (
                    <TableCell className="text-right text-muted-foreground">
                      {m.margin != null ? `${Math.round(m.margin)}%` : "—"}
                    </TableCell>
                  ) : null}
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
                );
              })}
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
