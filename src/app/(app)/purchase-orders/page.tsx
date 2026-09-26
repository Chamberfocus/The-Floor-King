import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
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
import { listPurchaseOrdersQueue } from "@/lib/data/purchase-orders";
import { requireProfile } from "@/lib/auth";
import { WorkQueuePager } from "@/components/work-queue-bar";
import {
  parseListPage,
  parsePoQueue,
  poQueueEmpty,
  resultCountLabel,
  ORDER_LIST_ROLES,
} from "@/lib/work-queues";
import { deletePurchaseOrder } from "./actions";
import { poTotal } from "@/lib/po-calc";
import {
  PO_SOURCE_BADGE,
  PO_SOURCE_LABELS,
  formatPoNumber,
  type PoSourceType,
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
  { value: "open", label: "Open" },
  { value: "ordered", label: "Ordered" },
  { value: "received", label: "Received" },
  { value: "all", label: "All" },
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
  searchParams: Promise<{ status?: string; view?: string; source?: string; q?: string; page?: string }>;
}) {
  const profile = await requireProfile();
  if (!ORDER_LIST_ROLES.includes(profile.role)) redirect("/");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const source = sp.source ?? "all";
  const status = parsePoQueue(sp.view ?? sp.status);
  const queue = await listPurchaseOrdersQueue({
    view: status,
    source,
    search: q,
    page: parseListPage(sp.page),
  });
  const pos = queue.rows;

  const chip = (active: boolean) =>
    cn(
      "inline-flex min-h-11 items-center rounded-full border px-3 text-xs font-medium transition-colors",
      active
        ? "border-foreground bg-foreground text-background"
        : "border-input text-muted-foreground hover:text-foreground",
    );
  const href = (next: { status?: string; source?: string; page?: number }) => {
    const p = new URLSearchParams();
    const s = next.status ?? status;
    const src = next.source ?? source;
    if (q) p.set("q", q);
    if (s !== "open") p.set("view", s);
    if (src !== "all") p.set("source", src);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    const qs = p.toString();
    return qs ? `/purchase-orders?${qs}` : "/purchase-orders";
  };

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        description="Material orders for your jobs — grouped by where they come from. Generate one from an approved estimate or a customer's file."
      />

      <form action="/purchase-orders" method="get" className="mb-3 flex flex-col gap-2 sm:flex-row">
        {status !== "open" ? <input type="hidden" name="view" value={status} /> : null}
        {source !== "all" ? <input type="hidden" name="source" value={source} /> : null}
        <input
          name="q"
          defaultValue={q}
          placeholder="Search PO number, vendor, or customer"
          aria-label="Search purchase orders"
          className="h-11 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
        />
        <button type="submit" className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
          Search
        </button>
      </form>
      <p className="mb-3 text-sm text-muted-foreground">
        {queue.capped
          ? `${resultCountLabel(pos.length, queue.total, "purchase order")} — more matches exist. Add more of the name.`
          : resultCountLabel(pos.length, queue.total, "purchase order")}
      </p>

      {queue.total > 0 || q || status !== "open" || source !== "all" ? (
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
        <EmptyState
          icon={ShoppingCart}
          title={poQueueEmpty(status, !!q)}
          description="Open a job’s Materials & prep tab to review requirements and raise purchase orders."
        />
      ) : (
        <div data-tour="receive-po">
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
        </div>
      )}
      <WorkQueuePager
        page={queue.page}
        pages={Math.max(1, Math.ceil(queue.total / queue.pageSize) || 1)}
        hrefFor={(page) => href({ page })}
      />
    </div>
  );
}
