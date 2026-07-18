import type { Metadata } from "next";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trash2, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { PoStatusBadge } from "@/components/po-status-badge";
import { listPurchaseOrders } from "@/lib/data/purchase-orders";
import { deletePurchaseOrder } from "./actions";
import { poTotal } from "@/lib/po-calc";
import {
  PO_SOURCE_BADGE,
  PO_SOURCE_LABELS,
  formatPoNumber,
  type PoSourceType,
  type PoStatus,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Purchase Orders" };

function SourceBadge({ source }: { source: PoSourceType | null }) {
  if (!source) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        PO_SOURCE_BADGE[source],
      )}
    >
      {PO_SOURCE_LABELS[source]}
    </span>
  );
}

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "ordered", label: "Ordered" },
  { value: "received", label: "Received" },
  { value: "cancelled", label: "Cancelled" },
];
const SOURCE_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All sources" },
  { value: "manufacturer", label: "Manufacturer" },
  { value: "distributor", label: "Distributor" },
  { value: "stock", label: "From stock" },
];

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; source?: string }>;
}) {
  const { status = "all", source = "all" } = await searchParams;
  // Stock-replenishment POs have their own home under Inventory — keep them out
  // of the job PO list (they use a different builder).
  const all = (await listPurchaseOrders()).filter(
    (po) => !(po as { is_stock?: boolean }).is_stock,
  );
  const pos = all.filter(
    (po) =>
      (status === "all" || po.status === (status as PoStatus)) &&
      (source === "all" || po.source_type === (source as PoSourceType)),
  );

  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
      active
        ? "border-foreground bg-foreground text-background"
        : "border-input text-muted-foreground hover:text-foreground",
    );
  const href = (next: { status?: string; source?: string }) => {
    const p = new URLSearchParams();
    const s = next.status ?? status;
    const src = next.source ?? source;
    if (s !== "all") p.set("status", s);
    if (src !== "all") p.set("source", src);
    const q = p.toString();
    return q ? `/purchase-orders?${q}` : "/purchase-orders";
  };

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        description="Material orders for your jobs — grouped by where they come from. Generate one from an approved estimate or a customer's file."
      />

      {all.length > 0 ? (
        <div className="mb-4 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <Link
                key={f.value}
                href={href({ status: f.value })}
                className={chip(status === f.value)}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SOURCE_FILTERS.map((f) => (
              <Link
                key={f.value}
                href={href({ source: f.value })}
                className={chip(source === f.value)}
              >
                {f.label}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {pos.length === 0 ? (
        all.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="No purchase orders yet"
            description="Open an approved estimate and click Create PO."
          />
        ) : (
          <EmptyState title="No purchase orders match this filter" />
        )
      ) : (
        <>
          {/* Phone: tappable cards */}
          <div className="space-y-2 md:hidden">
            {pos.map((po) => (
              <div key={po.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/purchase-orders/${po.id}`} className="min-w-0 flex-1 active:opacity-70">
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold tabular-nums">
                        {formatPoNumber(po.po_number)}
                      </span>
                      <span className="truncate text-sm text-muted-foreground">
                        {po.supplier || "—"}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {(po.items ?? []).length} item
                      {(po.items ?? []).length === 1 ? "" : "s"}
                      {po.customer_name ? ` · ${po.customer_name}` : ""}
                    </div>
                  </Link>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <PoStatusBadge status={po.status} />
                    <SourceBadge source={po.source_type} />
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
                  <Link href={`/purchase-orders/${po.id}`} className="font-medium text-foreground">
                    {formatMoney(poTotal(po.items ?? []))}
                  </Link>
                  <span className="ml-auto">{formatDate(po.created_at)}</span>
                  <form action={deletePurchaseOrder}>
                    <input type="hidden" name="id" value={po.id} />
                    <ConfirmButton
                      variant="ghost"
                      size="icon-sm"
                      aria-label={po.po_number != null ? "Void PO" : "Delete draft PO"}
                      title={
                        po.po_number != null
                          ? `Void ${formatPoNumber(po.po_number)}?`
                          : "Delete this draft PO?"
                      }
                      description={
                        po.po_number != null
                          ? "Issued POs are never deleted. This marks it VOID and keeps its number (the sequence stays intact). Any received stock is reversed."
                          : "This is an un-issued draft with no number, so deleting it leaves no gap. Any received stock is reversed."
                      }
                      confirmLabel={po.po_number != null ? "Void PO" : "Delete draft"}
                      destructive
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </ConfirmButton>
                  </form>
                </div>
              </div>
            ))}
          </div>
          {/* Larger screens: table */}
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO #</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total cost</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pos.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-semibold tabular-nums">
                      <Link href={`/purchase-orders/${po.id}`} className="hover:underline">
                        {formatPoNumber(po.po_number)}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link
                        href={`/purchase-orders/${po.id}`}
                        className="hover:underline"
                      >
                        {po.supplier || "—"}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {(po.items ?? []).length} item
                        {(po.items ?? []).length === 1 ? "" : "s"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <SourceBadge source={po.source_type} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {po.customer_name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <PoStatusBadge status={po.status} />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatMoney(poTotal(po.items ?? []))}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatDate(po.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <form action={deletePurchaseOrder}>
                        <input type="hidden" name="id" value={po.id} />
                        <ConfirmButton
                          variant="ghost"
                          size="icon-sm"
                          aria-label={po.po_number != null ? "Void PO" : "Delete draft PO"}
                          title={
                            po.po_number != null
                              ? `Void ${formatPoNumber(po.po_number)}?`
                              : "Delete this draft PO?"
                          }
                          description={
                            po.po_number != null
                              ? "Issued POs are never deleted. This marks it VOID and keeps its number (the sequence stays intact). Any received stock is reversed."
                              : "This is an un-issued draft with no number, so deleting it leaves no gap. Any received stock is reversed."
                          }
                          confirmLabel={po.po_number != null ? "Void PO" : "Delete draft"}
                          destructive
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </ConfirmButton>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
