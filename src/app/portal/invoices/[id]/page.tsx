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
import { CustomerScopeView } from "@/components/customer-scope-view";
import { getInvoice, amountPaid, getInvoiceScope } from "@/lib/data/invoices";
import { getOrgSettings } from "@/lib/data/org";
import { invoiceTotals } from "@/lib/invoice-calc";
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

  const [invoiceScope, org] = await Promise.all([
    getInvoiceScope(invoice),
    getOrgSettings(),
  ]);
  const totals = invoiceTotals(
    invoice.items ?? [],
    invoice.tax_rate,
    amountPaid(invoice),
  );
  const fallbackLines = (invoice.items ?? [])
    .map((it) => (it.description ?? "").trim())
    .filter(Boolean);

  return (
    <div>
      <Link
        href="/portal"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back
      </Link>

      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">
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
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Work performed
          </div>
          {invoiceScope ? (
            <CustomerScopeView
              scope={invoiceScope.scope}
              variant={invoice.presentation === "summary" ? "condensed" : "full"}
              narrative={invoiceScope.narrative}
            />
          ) : fallbackLines.length ? (
            <ul className="list-disc space-y-0.5 pl-5 text-sm">
              {fallbackLines.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Complete flooring project as described.
            </p>
          )}

          <div className="ml-auto mt-4 w-full max-w-xs space-y-1 border-t-2 pt-3 text-sm">
            <div className="flex justify-between text-base font-semibold">
              <span>Total</span>
              <span>{formatMoney(totals.total)}</span>
            </div>
            <div className="text-[10px] text-muted-foreground">
              Applicable tax included.
            </div>
            {totals.paid > 0 ? (
              <div className="flex justify-between text-muted-foreground">
                <span>Paid to date</span>
                <span>{formatMoney(totals.paid)}</span>
              </div>
            ) : null}
            <div className="flex justify-between border-t pt-1 text-base font-semibold">
              <span>Balance due</span>
              <span>{formatMoney(totals.balance)}</span>
            </div>
          </div>

          <div className="mt-5 border-t pt-3 text-xs text-muted-foreground">
            <div className="font-semibold uppercase tracking-wide">Payment</div>
            <p className="mt-1">
              We accept cash, check, and all major credit cards
              {org.financing_url ? ", plus financing" : ""}. Please make checks
              payable to {org.company_name}.
            </p>
            {invoice.terms ? (
              <p className="mt-2 whitespace-pre-wrap">{invoice.terms}</p>
            ) : null}
            {totals.balance > 0 ? (
              <p className="mt-2">
                To pay this balance, please contact us.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
