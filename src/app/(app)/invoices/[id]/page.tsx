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
import { getInvoice, amountPaid, amountCredited, amountDeposited, amountWrittenOff, getInvoiceScope } from "@/lib/data/invoices";
import { getCustomer } from "@/lib/data/customers";
import { getOrgSettings } from "@/lib/data/org";
import { getInvoiceProfit } from "@/lib/data/finance";
import { requireProfile } from "@/lib/auth";
import { effectiveInvoiceBalance } from "@/lib/credit-ar";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, INVOICE_COMMERCIAL_KIND_LABELS, type PaymentMethod } from "@/lib/types";
import { InvoiceBuilder } from "../invoice-builder";
import { AutoPrint } from "@/components/auto-print";
import {
  recordPayment,
  voidPayment,
  deleteInvoice,
  emailInvoice,
} from "../actions";
import { PaymentIdempotencyField } from "../payment-idempotency-field";
import { applyCreditToInvoice, issueGoodwillCredit, writeOffInvoiceBalance } from "@/app/(app)/credits/actions";
import { getCustomerCreditSummary, memoAvailable } from "@/lib/data/credits";

export const metadata: Metadata = { title: "Invoice" };

const fieldClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string; preview?: string; payment_error?: string; credit_error?: string; notify?: string; notify_detail?: string }>;
}) {
  const { id } = await params;
  const { print, preview: previewParam, payment_error: paymentError, credit_error: creditError, notify, notify_detail: notifyDetail } = await searchParams;
  const preview = previewParam === "1";
  const invoice = await getInvoice(id);
  if (!invoice) notFound();

  const customer = await getCustomer(invoice.customer_id);
  const org = await getOrgSettings();
  const profile = await requireProfile();
  const invoiceScope = await getInvoiceScope(invoice);
  const paid = amountPaid(invoice);
  const credited = amountCredited(invoice);
  const deposited = amountDeposited(invoice);
  const writtenOff = amountWrittenOff(invoice);
  const effective = effectiveInvoiceBalance({
    items: invoice.items ?? [],
    taxRate: invoice.tax_rate,
    amountPaid: paid,
    appliedCredits: credited,
    appliedDeposits: deposited,
    appliedWriteOffs: writtenOff,
  });
  const creditSummary =
    profile.role === "admin" || profile.role === "office"
      ? await getCustomerCreditSummary(invoice.customer_id).catch(() => null)
      : null;
  const availableCredits = (creditSummary?.memos ?? []).filter(
    (m) => m.status === "issued" && memoAvailable(m) > 0.005,
  );
  // Owner-only profit view (fuel + car + commission), same structure as the
  // estimate. Never computed for non-owners; never shown on the printed invoice.
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
            {invoice.commercial_kind ? (
              <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                {INVOICE_COMMERCIAL_KIND_LABELS[invoice.commercial_kind]}
              </span>
            ) : null}
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
        amountCredited={credited}
        amountDeposited={deposited}
        amountWrittenOff={writtenOff}
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
              Estimated profit{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (estimate costs — not realized job P&amp;L; never shown to the
                customer)
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
                  <span>Car allowance</span>
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
                <span>Estimated profit</span>
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
          {paymentError ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {paymentError}
            </p>
          ) : null}
          {creditError ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {creditError}
            </p>
          ) : null}
          {notify === "success" ? (
            <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
              Invoice email sent.
            </p>
          ) : null}
          {notify === "failed" || notify === "not_attempted" ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              {notify === "failed" ? "Email failed" : "Email was not sent"}
              {notifyDetail ? `: ${notifyDetail}` : "."}
            </p>
          ) : null}
          <div className="rounded-md bg-muted p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Invoice total</span>
              <span>{formatMoney(effective.total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Payments</span>
              <span>{formatMoney(effective.paid)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Credits applied</span>
              <span>{formatMoney(effective.credited)}</span>
            </div>
            {effective.deposited > 0.005 ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Deposits applied</span>
                <span>{formatMoney(effective.deposited)}</span>
              </div>
            ) : null}
            {effective.writtenOff > 0.005 ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Write-offs</span>
                <span>{formatMoney(effective.writtenOff)}</span>
              </div>
            ) : null}
            <div className="mt-1 flex justify-between border-t pt-1 text-base font-semibold">
              <span>Amount due</span>
              <span>{formatMoney(effective.amountDue)}</span>
            </div>
          </div>

          {(invoice.creditApplications ?? []).some(
            (a) => (a.status ?? "active") !== "void",
          ) ? (
            <ul className="divide-y text-sm">
              {(invoice.creditApplications ?? [])
                .filter((a) => (a.status ?? "active") !== "void")
                .map((a) => (
                  <li key={a.id} className="py-2 text-muted-foreground">
                    Credit applied · {formatMoney(a.amount)}
                  </li>
                ))}
            </ul>
          ) : null}

          {availableCredits.length && effective.amountDue > 0.005 ? (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Apply customer credit</p>
              {availableCredits.map((m) => {
                const avail = memoAvailable(m);
                const applyMax = Math.min(avail, effective.amountDue);
                return (
                  <form
                    key={m.id}
                    action={applyCreditToInvoice}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="credit_memo_id" value={m.id} />
                    <input type="hidden" name="invoice_id" value={invoice.id} />
                    <input
                      type="hidden"
                      name="customer_id"
                      value={invoice.customer_id}
                    />
                    <input type="hidden" name="amount" value={applyMax.toFixed(2)} />
                    <PaymentIdempotencyField />
                    <span className="text-xs text-muted-foreground">
                      {formatMoney(avail)} available
                      {m.reason ? ` · ${m.reason.slice(0, 60)}` : ""}
                    </span>
                    <Button type="submit" size="sm" variant="outline">
                      Apply {formatMoney(applyMax)}
                    </Button>
                  </form>
                );
              })}
            </div>
          ) : null}

          {(profile.role === "admin" || profile.role === "office") &&
          invoice.status !== "void" &&
          effective.amountDue > 0.005 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <form action={issueGoodwillCredit} className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Issue goodwill credit</p>
                <PaymentIdempotencyField />
                <input type="hidden" name="customer_id" value={invoice.customer_id} />
                <input type="hidden" name="invoice_id" value={invoice.id} />
                {invoice.job_id ? (
                  <input type="hidden" name="job_id" value={invoice.job_id} />
                ) : null}
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={effective.amountDue.toFixed(2)}
                  defaultValue={effective.amountDue.toFixed(2)}
                  className={fieldClass}
                  required
                />
                <input
                  name="reason"
                  placeholder="Reason (required)"
                  className={fieldClass}
                  required
                />
                <Button type="submit" size="sm" variant="outline">
                  Issue &amp; apply credit
                </Button>
              </form>
              <form action={writeOffInvoiceBalance} className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Write off remaining</p>
                <input type="hidden" name="invoice_id" value={invoice.id} />
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={effective.amountDue.toFixed(2)}
                  defaultValue={effective.amountDue.toFixed(2)}
                  className={fieldClass}
                  required
                />
                <input
                  name="reason"
                  placeholder="Write-off reason (required)"
                  className={fieldClass}
                  required
                />
                <PaymentIdempotencyField />
                <Button type="submit" size="sm" variant="outline">
                  Write off
                </Button>
              </form>
            </div>
          ) : null}

          {(invoice.payments ?? []).length ? (
            <ul className="divide-y text-sm">
              {(invoice.payments ?? []).map((p) => {
                const isVoid = (p.status ?? "active") === "void";
                return (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div>
                    <span className={`font-medium${isVoid ? " line-through text-muted-foreground" : ""}`}>
                      {formatMoney(p.amount)}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      · {PAYMENT_METHOD_LABELS[p.method]}
                      {p.paid_at ? ` · ${formatDate(p.paid_at)}` : ""}
                      {p.reference ? ` · ${p.reference}` : ""}
                      {isVoid ? " · Voided" : ""}
                    </span>
                  </div>
                  {!isVoid ? (
                  <form action={voidPayment}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="invoice_id" value={invoice.id} />
                    <input type="hidden" name="void_reason" value="Voided by staff" />
                    <ConfirmButton
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Void payment"
                      title={`Void this ${formatMoney(p.amount)} payment?`}
                      description="Voids the payment and restores the invoice balance. The payment stays on file for audit history."
                      confirmLabel="Void payment"
                      destructive
                    >
                      <Trash2 className="size-3.5" />
                    </ConfirmButton>
                  </form>
                  ) : null}
                </li>
                );
              })}
            </ul>
          ) : null}

          {/* Record a payment */}
          <form
            action={recordPayment}
            data-tour="record-payment"
            className="grid gap-2 border-t pt-4 sm:grid-cols-5"
          >
            <input type="hidden" name="invoice_id" value={invoice.id} />
            <PaymentIdempotencyField />
            <div className="sm:col-span-1">
              <label className="mb-1 block text-xs text-muted-foreground">
                Amount
              </label>
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                max={effective.amountDue > 0 ? effective.amountDue.toFixed(2) : undefined}
                required
                defaultValue={effective.amountDue > 0 ? effective.amountDue.toFixed(2) : ""}
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
