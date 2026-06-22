import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Trash2, Send } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SegmentedField } from "@/components/ui/segmented-field";
import { InvoiceStatusBadge } from "@/components/invoice-status-badge";
import { getInvoice, amountPaid } from "@/lib/data/invoices";
import { getCustomer } from "@/lib/data/customers";
import { getOrgSettings } from "@/lib/data/org";
import { invoiceTotals } from "@/lib/invoice-calc";
import { formatDate, formatMoney } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/types";
import { InvoiceBuilder } from "../invoice-builder";
import {
  recordPayment,
  deletePayment,
  deleteInvoice,
  emailInvoice,
} from "../actions";

export const metadata: Metadata = { title: "Invoice" };

const fieldClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) notFound();

  const customer = await getCustomer(invoice.customer_id);
  const org = await getOrgSettings();
  const paid = amountPaid(invoice);
  const totals = invoiceTotals(invoice.items ?? [], invoice.tax_rate, paid);

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/invoices"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="size-4" /> Back to invoices
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {invoice.number || "Invoice"}
            </h1>
            <InvoiceStatusBadge status={invoice.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {customer ? (
              <Link
                href={`/customers/${invoice.customer_id}`}
                className="hover:underline"
              >
                {customer.full_name}
              </Link>
            ) : null}
            {invoice.issue_date ? ` · Issued ${formatDate(invoice.issue_date)}` : ""}
          </p>
        </div>
        <form action={emailInvoice}>
          <input type="hidden" name="id" value={invoice.id} />
          <Button type="submit" size="lg">
            <Send className="size-4" /> Email to customer
          </Button>
        </form>
      </div>

      <InvoiceBuilder
        invoice={invoice}
        amountPaid={paid}
        customer={customer}
        org={org}
      />

      {/* Payments */}
      <Card className="mt-2 print:hidden">
        <CardHeader>
          <CardTitle className="text-base">Payments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-muted p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total</span>
              <span>{formatMoney(totals.total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Paid</span>
              <span>{formatMoney(totals.paid)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t pt-1 text-base font-semibold">
              <span>Balance due</span>
              <span>{formatMoney(totals.balance)}</span>
            </div>
          </div>

          {(invoice.payments ?? []).length ? (
            <ul className="divide-y text-sm">
              {(invoice.payments ?? []).map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div>
                    <span className="font-medium">{formatMoney(p.amount)}</span>{" "}
                    <span className="text-muted-foreground">
                      · {PAYMENT_METHOD_LABELS[p.method]}
                      {p.paid_at ? ` · ${formatDate(p.paid_at)}` : ""}
                      {p.reference ? ` · ${p.reference}` : ""}
                    </span>
                  </div>
                  <form action={deletePayment}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="invoice_id" value={invoice.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove payment"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}

          {/* Record a payment */}
          <form
            action={recordPayment}
            className="grid gap-2 border-t pt-4 sm:grid-cols-5"
          >
            <input type="hidden" name="invoice_id" value={invoice.id} />
            <div className="sm:col-span-1">
              <label className="mb-1 block text-xs text-muted-foreground">
                Amount
              </label>
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0"
                required
                defaultValue={totals.balance > 0 ? totals.balance.toFixed(2) : ""}
                className={fieldClass}
              />
            </div>
            <div className="sm:col-span-1">
              <label className="mb-1 block text-xs text-muted-foreground">
                Method
              </label>
              <SegmentedField
                size="sm"
                name="method"
                defaultValue="card"
                options={(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map(
                  (m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }),
                )}
              />
            </div>
            <div className="sm:col-span-1">
              <label className="mb-1 block text-xs text-muted-foreground">
                Date
              </label>
              <input name="paid_at" type="date" className={fieldClass} />
            </div>
            <div className="sm:col-span-1">
              <label className="mb-1 block text-xs text-muted-foreground">
                Reference
              </label>
              <input
                name="reference"
                placeholder="Check #, txn id"
                className={fieldClass}
              />
            </div>
            <div className="flex items-end sm:col-span-1">
              <Button type="submit" className="w-full">
                Record
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <form action={deleteInvoice} className="mt-4 flex justify-end print:hidden">
        <input type="hidden" name="id" value={invoice.id} />
        <input type="hidden" name="customer_id" value={invoice.customer_id} />
        <Button type="submit" variant="destructive" size="sm">
          <Trash2 className="size-3.5" /> Delete invoice
        </Button>
      </form>
    </div>
  );
}
