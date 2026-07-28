import type { Metadata } from "next";
import { DateField } from "@/components/ui/date-field";
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
import { ConfirmButton } from "@/components/ui/confirm-button";
import { SendToClient } from "@/components/send-to-client";
import { SegmentedField } from "@/components/ui/segmented-field";
import { InvoiceStatusBadge } from "@/components/invoice-status-badge";
import { getInvoice, amountPaid, getInvoiceScope } from "@/lib/data/invoices";
import { getCustomer } from "@/lib/data/customers";
import { getOrgSettings } from "@/lib/data/org";
import { getInvoiceProfit } from "@/lib/data/finance";
import { requireProfile } from "@/lib/auth";
import { invoiceTotals } from "@/lib/invoice-calc";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/types";
import { InvoiceBuilder } from "../invoice-builder";
import { AutoPrint } from "@/components/auto-print";
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string; preview?: string }>;
}) {
  const { id } = await params;
  const { print, preview: previewParam } = await searchParams;
  const preview = previewParam === "1";
  const invoice = await getInvoice(id);
  if (!invoice) notFound();

  const customer = await getCustomer(invoice.customer_id);
  const org = await getOrgSettings();
  const invoiceScope = await getInvoiceScope(invoice);
  const paid = amountPaid(invoice);
  const totals = invoiceTotals(invoice.items ?? [], invoice.tax_rate, paid);
  // Owner-only profit view (fuel + car + commission), same structure as the
  // estimate. Never computed for non-owners; never shown on the printed invoice.
  const profile = await requireProfile();
  const invProfit =
    profile.role === "admin" && !preview
      ? await getInvoiceProfit(invoice)
      : null;

  return (
    <div className="mx-auto max-w-4xl">
      {print ? <AutoPrint /> : null}
      {!preview ? (
        <Link
          href="/invoices"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"
        >
          <ArrowLeft className="size-4" /> Back to invoices
        </Link>
      ) : null}

      <div
        className={`mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden${preview ? " hidden" : ""}`}
      >
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">
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
          <SendToClient
            size="lg"
            clientName={customer?.full_name}
            email={customer?.email}
            title="Email this invoice to the customer?"
            description="Marks the invoice as sent and emails them their branded invoice with a link to view it."
            sendLabel="Send invoice"
            skipLabel="Mark sent, no email"
          >
            <Send className="size-4" /> Email to customer
          </SendToClient>
        </form>
      </div>

      <InvoiceBuilder
        invoice={invoice}
        amountPaid={paid}
        customer={customer}
        org={org}
        scope={invoiceScope?.scope ?? null}
        narrative={invoiceScope?.narrative ?? null}
        preview={preview}
      />

      {/* Owner-only profit — the estimate's fuel/car/commission structure,
          carried onto the invoice. Internal; never printed or shown to client. */}
      {invProfit ? (
        <Card className="mt-2 border-dashed print:hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Profit{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (internal — never shown to the customer)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="ml-auto max-w-xs space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Revenue (pre-tax)</span>
                <span className="tabular-nums">{formatMoney(invProfit.revenue)}</span>
              </div>
              {invProfit.fuelCharge > 0 ? (
                <div className="flex justify-between pl-3 text-xs text-muted-foreground/80">
                  <span>↳ incl. {formatMoney(invProfit.fuelCharge)} fuel charge</span>
                </div>
              ) : null}
              <div className="flex justify-between text-muted-foreground">
                <span>Our cost</span>
                <span className="tabular-nums">−{formatMoney(invProfit.cost)}</span>
              </div>
              {invProfit.materialCost > 0 || invProfit.laborCost > 0 ? (
                <div className="flex justify-between pl-3 text-xs text-muted-foreground/80">
                  <span>
                    ↳ Material {formatMoney(invProfit.materialCost)} · Labor{" "}
                    {formatMoney(invProfit.laborCost)}
                  </span>
                </div>
              ) : null}
              {invProfit.salesGas > 0 ? (
                <div className="flex justify-between text-muted-foreground">
                  <span>Salesperson gas</span>
                  <span className="tabular-nums">−{formatMoney(invProfit.salesGas)}</span>
                </div>
              ) : null}
              {invProfit.fleetUpkeep > 0 ? (
                <div className="flex justify-between text-muted-foreground">
                  <span>Fleet upkeep</span>
                  <span className="tabular-nums">−{formatMoney(invProfit.fleetUpkeep)}</span>
                </div>
              ) : null}
              {invProfit.commission > 0 ? (
                <div className="flex justify-between text-muted-foreground">
                  <span>Commission ({invProfit.commissionPct}%)</span>
                  <span className="tabular-nums">−{formatMoney(invProfit.commission)}</span>
                </div>
              ) : null}
              <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
                <span>Profit</span>
                <span
                  className={cn(
                    "tabular-nums",
                    invProfit.profit >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-destructive",
                  )}
                >
                  {formatMoney(invProfit.profit)}
                  <span className="ml-2 text-xs font-medium">
                    {invProfit.margin.toFixed(1)}%
                  </span>
                </span>
              </div>
            </div>
            {invProfit.cost === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                No costs are on the source estimate, so this shows revenue minus
                only the fuel/car/commission overheads. Add material &amp; labor
                costs on the estimate for a true margin.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Payments */}
      {!preview ? (
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
                    <ConfirmButton
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove payment"
                      title={`Remove this ${formatMoney(p.amount)} payment?`}
                      description="Deletes the recorded payment and recomputes the invoice balance. This can't be undone."
                      confirmLabel="Remove payment"
                      destructive
                    >
                      <Trash2 className="size-3.5" />
                    </ConfirmButton>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}

          {/* Record a payment */}
          <form
            action={recordPayment}
            data-tour="record-payment"
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
              <DateField name="paid_at" className={fieldClass} />
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
              <ConfirmButton
                className="w-full"
                title="Record this payment?"
                description="Adds the payment to the invoice, recomputes its status (paid / partial), and advances the customer's pipeline."
                confirmLabel="Record payment"
              >
                Record
              </ConfirmButton>
            </div>
          </form>
        </CardContent>
      </Card>
      ) : null}

      {!preview ? (
      <div className="mt-6 flex flex-col items-end gap-1.5 border-t pt-4 print:hidden">
        <form action={deleteInvoice}>
          <input type="hidden" name="id" value={invoice.id} />
          <input type="hidden" name="customer_id" value={invoice.customer_id} />
          <ConfirmButton
            variant="outline"
            size="sm"
            title="Delete this invoice and all its payments?"
            description="Permanently deletes the invoice, its line items, and every recorded payment. Any linked order is unlinked. This can't be undone."
            confirmLabel="Delete invoice"
            destructive
          >
            <Trash2 className="size-3.5 text-destructive" /> Delete invoice
          </ConfirmButton>
        </form>
        <span className="max-w-xs text-right text-xs text-muted-foreground">
          Permanently removes the invoice and its recorded payments — can&apos;t be
          undone.
        </span>
      </div>
      ) : null}
    </div>
  );
}
