import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Package } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { listOrders } from "@/lib/data/orders";
import { ORDER_STATUS_BADGE, ORDER_STATUS_LABELS } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { approveOrder, declineOrder } from "./actions";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { OrderLinkCard } from "./order-link-card";
import { COMPANY_NAME } from "@/lib/nav";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const profile = await requireProfile();
  if (!["admin", "office"].includes(profile.role)) redirect("/");
  const orders = await listOrders();
  const pending = orders.filter((o) => o.status === "submitted");
  const rest = orders.filter((o) => o.status !== "submitted");

  const Row = ({ o }: { o: (typeof orders)[number] }) => {
    const who = o.customer_name || o.contact_name || "Customer";
    const contact = [o.contact_phone, o.contact_email].filter(Boolean).join(" · ");
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
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
              ORDER_STATUS_BADGE[o.status],
            )}
          >
            {ORDER_STATUS_LABELS[o.status]}
          </span>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-1 text-sm">
            {(o.items ?? []).map((it) => (
              <li key={it.id} className="rounded-md border p-2">
                <div className="font-medium">
                  {[it.description, it.color, it.style].filter(Boolean).join(" · ") ||
                    "Item"}
                  {it.quantity ? (
                    <span className="ml-1 font-normal text-muted-foreground">
                      — {it.quantity} {it.unit}
                    </span>
                  ) : null}
                </div>
                {it.cut_notes ? (
                  <div className="text-xs text-muted-foreground">
                    Cuts: {it.cut_notes}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {o.notes ? (
            <p className="text-sm text-muted-foreground">Note: {o.notes}</p>
          ) : null}

          {o.status === "submitted" ? (
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <form action={approveOrder}>
                <input type="hidden" name="order_id" value={o.id} />
                <Button type="submit" size="sm">
                  Approve → send to warehouse
                </Button>
              </form>
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                  Decline
                </summary>
                <form action={declineOrder} className="mt-2 flex flex-wrap gap-2">
                  <input type="hidden" name="order_id" value={o.id} />
                  <input
                    name="reason"
                    placeholder="Reason (optional)"
                    className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
                  />
                  <Button type="submit" size="sm" variant="destructive">
                    Decline order
                  </Button>
                </form>
              </details>
            </div>
          ) : o.status === "approved" && o.job_id ? (
            <div className="border-t pt-3 text-sm">
              <Link href={`/jobs/${o.job_id}`} className="text-primary hover:underline">
                Open the warehouse job →
              </Link>
            </div>
          ) : o.status === "declined" && o.decline_reason ? (
            <p className="border-t pt-3 text-sm text-muted-foreground">
              Declined: {o.decline_reason}
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  };

  return (
    <div>
      <RealtimeRefresh table="orders" />
      <PageHeader
        title="Orders"
        description="Carpet orders submitted by clients. Approve to send them to the warehouse for cutting & pickup."
      />
      <OrderLinkCard companyName={COMPANY_NAME} />
      {orders.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          <Package className="mx-auto mb-2 size-6 opacity-50" />
          No orders yet. Share your order link or portal with your trade customers.
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 ? (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">
                Needs review ({pending.length})
              </h2>
              {pending.map((o) => (
                <Row key={o.id} o={o} />
              ))}
            </div>
          ) : null}
          {rest.length > 0 ? (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">
                Processed
              </h2>
              {rest.map((o) => (
                <Row key={o.id} o={o} />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
