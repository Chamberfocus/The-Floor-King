import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Package } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { listOrders, getProductStock, type ProductStock } from "@/lib/data/orders";
import { reorderAlertsFor } from "@/lib/data/stock-rolls";
import { getProfileNames } from "@/lib/data/customers";
import { ApproveOrder } from "./approve-order";
import {
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABELS,
  ORDER_STOCK_BADGE,
  ORDER_STOCK_LABELS,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import {
  declineOrder,
  deleteOrder,
  reportOrderStock,
  notifyCustomerStock,
  createInvoiceFromOrder,
} from "./actions";
import { Trash2 } from "lucide-react";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { OrderLinkCard } from "@/components/order-link-card";
import { CutList } from "@/components/cut-list";
import { cutsTotalSqYd } from "@/lib/order-cuts";
import { DateNeeded } from "@/components/date-needed";
import { COMPANY_NAME } from "@/lib/nav";
import {
  OFFICE_STOCK_HEADING,
  WAREHOUSE_STOCK_CHECK_REQUIRED,
  officeWarehouseStockBanner,
} from "@/lib/order-warehouse-gates";

export const metadata: Metadata = { title: "Customer Orders" };
export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const profile = await requireProfile();
  if (!["admin", "office"].includes(profile.role)) redirect("/");
  const orders = await listOrders();
  const productIds = orders.flatMap((o) => (o.items ?? []).map((i) => i.product_id ?? ""));
  const stock = await getProductStock(productIds);
  const remnantAlerts = await reorderAlertsFor(productIds);
  const checkerNames = await getProfileNames(
    orders.map((o) => o.stock_checked_by ?? "").filter(Boolean),
  );
  const pending = orders.filter((o) => o.status === "submitted");
  const rest = orders.filter((o) => o.status !== "submitted");

  const StockLine = ({ productId }: { productId: string | null }) => {
    const s: ProductStock | undefined = productId ? stock.get(productId) : undefined;
    if (!s || !s.track_stock) return null;
    const avail = Math.round((s.on_hand - s.reserved) * 100) / 100;
    const remnantItems = productId ? remnantAlerts[productId]?.items ?? [] : [];
    // Exclusive carpet-tile office customer-order on-hand mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
    // Hard-surface office customer-order leftover planted on-hand mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage.
    const remnantUnits = remnantItems.map((i) => (i.unit || "").trim());
    const mixedRemnant = new Set(remnantUnits).size > 1;
    return (
      <span
        className={cn(
          "ml-1 text-xs font-medium",
          avail > 0 ? "text-emerald-600" : "text-destructive",
        )}
      >
        {avail > 0 ? mixedRemnant ? (remnantItems.length > 1 ? `· stock across ${remnantItems.length} pieces` : "· stock as a remnant/roll") : `· ${avail} ${s.unit} on hand` : "· out of stock"}
      </span>
    );
  };

  const Row = ({ o }: { o: (typeof orders)[number] }) => {
    const who = o.customer_name || o.contact_name || "Customer";
    const contact = [o.contact_phone, o.contact_email].filter(Boolean).join(" · ");
    const stockKnown = o.stock_status !== "unknown";
    return (
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
          <div className="min-w-0">
            <CardTitle className="text-base">{who}</CardTitle>
            <div className="text-xs text-muted-foreground">
              {contact ? `${contact} · ` : ""}
              {o.source === "public" ? "Public order" : "Portal order"} ·{" "}
              {formatDateTime(o.created_at)}
            </div>
            <DateNeeded date={o.date_needed} className="mt-1" />
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", ORDER_STATUS_BADGE[o.status])}>
              {ORDER_STATUS_LABELS[o.status]}
            </span>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", ORDER_STOCK_BADGE[o.stock_status])}>
              {ORDER_STOCK_LABELS[o.stock_status]}
            </span>
            {(o.items ?? []).some((i) => i.requested_price) ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                Price requested
              </span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-1 text-sm">
            {(o.items ?? []).map((it) => (
              <li key={it.id} className="rounded-md border p-2">
                <div className="font-medium">
                  {[it.description, it.color, it.style].filter(Boolean).join(" · ") || "Item"}
                  {/* Exclusive carpet-tile office customer-order qty from cuts is the order, not leftover planted quantity — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. */}
                  {/* Hard-surface office customer-order leftover planted quantity stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage. */}
                  {cutsTotalSqYd(it) == null && it.quantity ? (
                    <span className="ml-1 font-normal text-muted-foreground">— {it.quantity} {it.unit}</span>
                  ) : null}
                  <StockLine productId={it.product_id} />
                </div>
                {it.retail_price || it.requested_price ? (
                  <div className="text-xs">
                    {it.retail_price ? (
                      <span className="text-muted-foreground">
                        Retail {formatMoney(it.retail_price)}/{it.unit}
                      </span>
                    ) : null}
                    {it.requested_price ? (
                      <span className="ml-1 font-medium text-amber-700 dark:text-amber-400">
                        · Requested {formatMoney(it.requested_price)}/{it.unit}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <CutList item={it} />
              </li>
            ))}
          </ul>
          {o.notes ? <p className="text-sm text-muted-foreground">Note: {o.notes}</p> : null}
          {(() => {
            const banner = officeWarehouseStockBanner(o.stock_status);
            const tone =
              banner.tone === "ok"
                ? "border-emerald-400/60 bg-emerald-50 dark:bg-emerald-950/30"
                : banner.tone === "warn"
                  ? "border-amber-400/60 bg-amber-50 dark:bg-amber-950/30"
                  : banner.tone === "bad"
                    ? "border-rose-400/60 bg-rose-50 dark:bg-rose-950/30"
                    : "border-zinc-300 bg-muted/40";
            const checker =
              o.stock_checked_by ? checkerNames[o.stock_checked_by] : null;
            return (
              <div className={cn("rounded-md border px-3 py-2 text-sm", tone)}>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {banner.kicker}
                </div>
                <div className="font-semibold">{banner.headline}</div>
                {banner.showChecker && o.stock_checked_at ? (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Checked by: {checker || "Warehouse"}
                    <span className="ml-2">Checked: {formatDateTime(o.stock_checked_at)}</span>
                  </div>
                ) : null}
                {banner.showNote && o.stock_note ? (
                  <p className="mt-1 text-sm">{o.stock_note}</p>
                ) : null}
                {o.status === "submitted" && o.stock_status === "unknown" ? (
                  <p className="mt-1 text-xs font-medium">
                    {WAREHOUSE_STOCK_CHECK_REQUIRED}
                  </p>
                ) : null}
              </div>
            );
          })()}
          {/* What we told them, so nobody has to go digging through sent mail
              to find out what was promised. */}
          {o.ready_date ? (
            <div className="rounded-md border border-emerald-400/50 bg-emerald-50 px-3 py-2 text-sm dark:bg-emerald-950/30">
              <span className="font-medium text-emerald-800 dark:text-emerald-300">
                Promised {formatDate(o.ready_date)}
              </span>
              <span className="ml-1.5 text-emerald-800/80 dark:text-emerald-300/80">
                ·{" "}
                {o.ready_kind === "on_order"
                  ? "material on order"
                  : "cutting from stock"}
              </span>
            </div>
          ) : null}

          {o.stock_note && o.stock_status === "unknown" ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Warehouse:</span> {o.stock_note}
            </p>
          ) : null}

          {/* Stock: authorized office override + tell the customer */}
          {o.status === "submitted" || o.status === "approved" ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2">
              <span className="text-xs font-medium text-muted-foreground">
                {OFFICE_STOCK_HEADING.officeOverride}:
              </span>
              {(["in_stock", "out_of_stock", "partial"] as const).map((st) => (
                <form key={st} action={reportOrderStock}>
                  <input type="hidden" name="order_id" value={o.id} />
                  <input type="hidden" name="stock_status" value={st} />
                  <Button type="submit" size="sm" variant={o.stock_status === st ? "default" : "outline"}>
                    {ORDER_STOCK_LABELS[st]}
                  </Button>
                </form>
              ))}
              <form action={notifyCustomerStock} className="ml-auto">
                <input type="hidden" name="order_id" value={o.id} />
                <Button type="submit" size="sm" variant="ghost" disabled={!stockKnown}>
                  Tell customer
                </Button>
              </form>
            </div>
          ) : null}

          {/* Approve / decline / invoice */}
          {o.status === "submitted" ? (
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              {/* Approving is a promise, so it asks what the promise is — the
                  warehouse's stock answer pre-picks it. */}
              <ApproveOrder orderId={o.id} who={who} stockStatus={o.stock_status} />
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">Decline</summary>
                <form action={declineOrder} className="mt-2 flex flex-wrap gap-2">
                  <input type="hidden" name="order_id" value={o.id} />
                  <input name="reason" placeholder="Reason (optional)" className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm" />
                  <ConfirmButton
                    size="sm"
                    variant="destructive"
                    title={`Decline ${who}'s order?`}
                    description="Marks the order declined and emails the customer."
                    confirmLabel="Decline order"
                    destructive
                  >
                    Decline order
                  </ConfirmButton>
                </form>
              </details>
            </div>
          ) : o.status === "approved" ? (
            <div className="flex flex-wrap items-center gap-3 border-t pt-3 text-sm">
              {o.stock_status !== "in_stock" && !o.job_id ? (
                <p className="w-full text-amber-800 dark:text-amber-300">
                  Approved — not sent to warehouse staging until stock is fully IN STOCK.
                </p>
              ) : null}
              {o.invoice_id ? (
                <Link href={`/invoices/${o.invoice_id}`} className="text-primary hover:underline">Open invoice →</Link>
              ) : (
                <form action={createInvoiceFromOrder}>
                  <input type="hidden" name="order_id" value={o.id} />
                  <Button type="submit" size="sm" variant="outline">Create invoice</Button>
                </form>
              )}
              {o.job_id ? (
                <Link href={`/jobs/${o.job_id}`} className="text-primary hover:underline">Warehouse job →</Link>
              ) : null}
            </div>
          ) : o.status === "declined" && o.decline_reason ? (
            <p className="border-t pt-3 text-sm text-muted-foreground">Declined: {o.decline_reason}</p>
          ) : null}

          {/* Remove an unwanted order from the tab (two-step, so it's deliberate). */}
          <details className="ml-auto w-fit text-right">
            <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-destructive [&::-webkit-details-marker]:hidden">
              Delete order
            </summary>
            <form action={deleteOrder} className="mt-2 flex flex-col items-end gap-2">
              <input type="hidden" name="order_id" value={o.id} />
              <span className="max-w-xs text-right text-xs text-muted-foreground">
                Permanently delete this order and everything it created —
                {o.job_id ? " its warehouse job," : ""} its invoice &amp; payments,
                and any purchase orders. This can&apos;t be undone.
              </span>
              <ConfirmButton
                size="sm"
                variant="destructive"
                title={`Delete ${who}'s order and everything it created?`}
                description="Permanently deletes the order, its warehouse job, its invoice & payments, and any purchase orders raised for it. This can't be undone."
                confirmLabel="Delete order"
                destructive
              >
                <Trash2 className="size-3.5" /> Delete everything
              </ConfirmButton>
            </form>
          </details>
        </CardContent>
      </Card>
    );
  };

  return (
    <div>
      <RealtimeRefresh table="orders" />
      <PageHeader
        title="Customer Orders"
        description="Carpet orders submitted by customers. Warehouse checks stock first; approve only after that result. In-stock approvals go to the warehouse to cut &amp; stage."
      />
      <OrderLinkCard companyName={COMPANY_NAME} />
      {orders.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No orders yet"
          description="Share your order link with your trade customers and their submissions land here."
        />
      ) : (
        <div className="space-y-6">
          {pending.length > 0 ? (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">Needs review ({pending.length})</h2>
              {pending.map((o) => <Row key={o.id} o={o} />)}
            </div>
          ) : null}
          {rest.length > 0 ? (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">Processed</h2>
              {rest.map((o) => <Row key={o.id} o={o} />)}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
