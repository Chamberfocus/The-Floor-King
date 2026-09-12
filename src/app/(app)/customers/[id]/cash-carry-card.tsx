import Link from "next/link";
import { Receipt, ShoppingBag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JobStatusBadge } from "@/components/job-status-badge";
import { InvoiceStatusBadge } from "@/components/invoice-status-badge";
import { formatDate, formatMoney } from "@/lib/format";
import { ORDER_STATUS_LABELS, type JobStatus, type InvoiceStatus } from "@/lib/types";

export type CashCarryJobRow = {
  id: string;
  title: string;
  status: JobStatus;
  warehouseStatus?: string | null;
};

export type CashCarryInvoiceRow = {
  id: string;
  number: string;
  status: InvoiceStatus;
  total: number;
  paid: boolean;
};

export type CashCarryOrderRow = {
  id: string;
  status: string;
  createdAt: string;
  jobId: string | null;
};

/**
 * Customer-linked cash & carry — pickup jobs, counter sales, and submitted
 * orders. These are children of the customer, never extra customer-list rows.
 */
export function CashCarryCard({
  jobs,
  invoices,
  orders,
}: {
  jobs: CashCarryJobRow[];
  invoices: CashCarryInvoiceRow[];
  orders: CashCarryOrderRow[];
}) {
  const hasAny = jobs.length + invoices.length + orders.length > 0;
  return (
    <Card id="cash-carry" className="scroll-mt-24">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Cash &amp; Carry</CardTitle>
        {hasAny ? (
          <span className="text-xs text-muted-foreground">
            {jobs.length + invoices.length + orders.length}
          </span>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {!hasAny ? (
          <p className="text-sm text-muted-foreground">
            No cash &amp; carry purchases on this customer.
          </p>
        ) : null}
        {jobs.map((j) => (
          <Link
            key={j.id}
            href={`/jobs/${j.id}`}
            className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/50"
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <ShoppingBag className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{j.title}</span>
            </span>
            <JobStatusBadge status={j.status} />
          </Link>
        ))}
        {invoices.map((inv) => (
          <Link
            key={inv.id}
            href={`/invoices/${inv.id}`}
            className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/50"
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <Receipt className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{inv.number}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <InvoiceStatusBadge status={inv.status} />
              <span className="text-sm font-medium tabular-nums">
                {formatMoney(inv.total)}
              </span>
            </span>
          </Link>
        ))}
        {orders.map((o) => (
          <Link
            key={o.id}
            href={`/orders`}
            className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/50"
          >
            <span className="min-w-0">
              <span className="block font-medium">Pickup order</span>
              <span className="text-xs text-muted-foreground">
                {formatDate(o.createdAt)}
                {o.jobId ? " · linked job" : ""}
              </span>
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              {ORDER_STATUS_LABELS[o.status as keyof typeof ORDER_STATUS_LABELS] ??
                o.status}
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
