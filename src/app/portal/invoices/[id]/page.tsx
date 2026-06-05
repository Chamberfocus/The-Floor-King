import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InvoiceStatusBadge } from "@/components/invoice-status-badge";
import { getInvoice, amountPaid } from "@/lib/data/invoices";
import { invoiceTotals, itemAmount } from "@/lib/invoice-calc";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Invoice" };

export default async function PortalInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) notFound();

  const totals = invoiceTotals(
    invoice.items ?? [],
    invoice.tax_rate,
    amountPaid(invoice),
  );

  return (
    <div>
      <Link
        href="/portal"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back
      </Link>

      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {invoice.number || "Invoice"}
        </h1>
        <InvoiceStatusBadge status={invoice.status} />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">
            {invoice.issue_date ? `Issued ${formatDate(invoice.issue_date)}` : "Invoice"}
            {invoice.due_date ? ` · Due ${formatDate(invoice.due_date)}` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y text-sm">
            {(invoice.items ?? []).map((it) => (
              <div
                key={it.id}
                className="flex items-start justify-between gap-4 py-2"
              >
                <div>
                  <div>{it.description}</div>
                  {it.quantity ? (
                    <div className="text-xs text-muted-foreground">
                      {it.quantity} {it.unit} × {formatMoney(it.rate ?? 0)}
                    </div>
                  ) : null}
                </div>
                <div className="shrink-0 font-medium">
                  {formatMoney(itemAmount(it))}
                </div>
              </div>
            ))}
          </div>

          <div className="ml-auto mt-3 w-full max-w-xs space-y-1 border-t pt-3 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>{formatMoney(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Tax</span>
              <span>{formatMoney(totals.tax)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span>{formatMoney(totals.total)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Paid</span>
              <span>{formatMoney(totals.paid)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <span>Balance due</span>
              <span>{formatMoney(totals.balance)}</span>
            </div>
          </div>

          {invoice.terms ? (
            <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
              {invoice.terms}
            </p>
          ) : null}
          {totals.balance > 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              To pay this balance, please contact us. Online payment is coming
              soon.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
