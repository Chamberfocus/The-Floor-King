import Link from "next/link";
import { Plus, Package, Boxes } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PoStatusBadge } from "@/components/po-status-badge";
import { poTotal } from "@/lib/po-calc";
import { formatMoney } from "@/lib/format";
import {
  PO_SOURCE_BADGE,
  PO_SOURCE_LABELS,
  type PoSourceType,
  type PurchaseOrder,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import type { StockPull } from "@/lib/data/purchase-orders";
import { createBlankPO } from "@/app/(app)/purchase-orders/actions";

function sourceLabel(po: PurchaseOrder): string {
  if (po.source_type) return PO_SOURCE_LABELS[po.source_type];
  return "Order";
}

function fmtEta(d: string | null): string | null {
  if (!d) return null;
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Customer-focused materials view: every PO for this customer (with where it's
 * coming from — manufacturer / distributor) plus what's been pulled from our
 * own stock. Keeps the PO tied to the customer instead of floating off in a
 * global list.
 */
export function CustomerOrdersCard({
  customerId,
  pos,
  stockPulls,
}: {
  customerId: string;
  pos: PurchaseOrder[];
  stockPulls: StockPull[];
}) {
  const hasAny = pos.length > 0 || stockPulls.length > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Materials &amp; Orders</CardTitle>
        <form action={createBlankPO}>
          <input type="hidden" name="customer_id" value={customerId} />
          <Button type="submit" variant="outline" size="sm">
            <Plus className="size-3.5" /> New PO
          </Button>
        </form>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasAny ? (
          <p className="text-sm text-muted-foreground">
            No material orders yet. Approve an estimate to generate purchase
            orders automatically, or start one with{" "}
            <span className="font-medium">New PO</span>.
          </p>
        ) : null}

        {pos.map((po) => {
          const eta = fmtEta(po.eta_date);
          return (
            <Link
              key={po.id}
              href={`/purchase-orders/${po.id}`}
              className="block rounded-md border p-3 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Package className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      {po.supplier || "Purchase order"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {(po.items ?? []).length} item
                    {(po.items ?? []).length === 1 ? "" : "s"}
                    {po.backordered ? " · ⏳ backordered" : ""}
                    {eta ? ` · ETA ${eta}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <PoStatusBadge status={po.status} />
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                      po.source_type
                        ? PO_SOURCE_BADGE[po.source_type as PoSourceType]
                        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
                    )}
                  >
                    {sourceLabel(po)}
                  </span>
                </div>
              </div>
              <div className="mt-1.5 text-right text-sm font-medium">
                {formatMoney(poTotal(po.items ?? []))}
              </div>
            </Link>
          );
        })}

        {stockPulls.length > 0 ? (
          <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
            <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
              <Boxes className="size-3.5 text-amber-700 dark:text-amber-400" />
              From stock
            </div>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {stockPulls.map((s) => (
                <li key={s.product_id} className="flex justify-between gap-2">
                  <span className="truncate">{s.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {s.qty}
                    {s.unit ? ` ${s.unit}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
