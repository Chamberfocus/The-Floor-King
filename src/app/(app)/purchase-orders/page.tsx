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
import { PageHeader } from "@/components/page-header";
import { PoStatusBadge } from "@/components/po-status-badge";
import { listPurchaseOrders } from "@/lib/data/purchase-orders";
import { poTotal } from "@/lib/po-calc";
import {
  PO_SOURCE_BADGE,
  PO_SOURCE_LABELS,
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
  const all = await listPurchaseOrders();
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
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {all.length === 0 ? (
            <>
              No purchase orders yet. Open an approved estimate and click{" "}
              <span className="font-medium">Create PO</span>.
            </>
          ) : (
            <>No purchase orders match this filter.</>
          )}
        </div>
      ) : (
        <>
          {/* Phone: tappable cards */}
          <div className="space-y-2 md:hidden">
            {pos.map((po) => (
              <Link
                key={po.id}
                href={`/purchase-orders/${po.id}`}
                className="block rounded-lg border p-3 active:bg-muted/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {po.supplier || "Purchase order"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {(po.items ?? []).length} item
                      {(po.items ?? []).length === 1 ? "" : "s"}
                      {po.customer_name ? ` · ${po.customer_name}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <PoStatusBadge status={po.status} />
                    <SourceBadge source={po.source_type} />
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {formatMoney(poTotal(po.items ?? []))}
                  </span>
                  <span className="ml-auto">{formatDate(po.created_at)}</span>
                </div>
              </Link>
            ))}
          </div>
          {/* Larger screens: table */}
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total cost</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pos.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/purchase-orders/${po.id}`}
                        className="hover:underline"
                      >
                        {po.supplier || "Purchase order"}
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
