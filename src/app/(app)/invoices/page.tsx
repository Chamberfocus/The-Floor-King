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
import { Receipt, Zap} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { InvoiceStatusBadge } from "@/components/invoice-status-badge";
import { listInvoices, amountPaid } from "@/lib/data/invoices";
import { invoiceTotals } from "@/lib/invoice-calc";
import { formatDate, formatMoney } from "@/lib/format";
import { DeleteInvoiceButton } from "./delete-invoice-button";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage() {
  const invoices = await listInvoices();

  return (
    <div>
      <PageHeader
        title="Invoices"
        description="Bill customers and track who still owes you."
      >
        <Link href="/invoices/quick" className={buttonVariants({ size: "lg" })}>
          <Zap className="size-4" /> Counter sale
        </Link>
      </PageHeader>

      {invoices.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No invoices yet"
          description="Create one from an approved estimate or a customer profile."
        />
      ) : (
        <>
        {/* Phone: tappable cards */}
        <div className="space-y-2 md:hidden">
          {invoices.map((inv) => {
            const t = invoiceTotals(inv.items ?? [], inv.tax_rate, amountPaid(inv));
            return (
              <div
                key={inv.id}
                className="flex items-center gap-1 rounded-lg border p-3"
              >
                <Link
                  href={`/invoices/${inv.id}`}
                  className="min-w-0 flex-1 active:opacity-70"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{inv.number || "Invoice"}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {inv.customer_name ?? "—"}
                      </div>
                    </div>
                    <InvoiceStatusBadge status={inv.status} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
                    <span>Total {formatMoney(t.total)}</span>
                    <span className="font-medium text-foreground">
                      Balance {formatMoney(t.balance)}
                    </span>
                    {inv.due_date ? <span className="ml-auto">Due {formatDate(inv.due_date)}</span> : null}
                  </div>
                </Link>
                <DeleteInvoiceButton
                  id={inv.id}
                  customerId={inv.customer_id}
                  label={inv.number || "this invoice"}
                  redirectTo="/invoices"
                />
              </div>
            );
          })}
        </div>
        {/* Larger screens: table */}
        <div className="hidden overflow-x-auto rounded-lg border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => {
                const t = invoiceTotals(
                  inv.items ?? [],
                  inv.tax_rate,
                  amountPaid(inv),
                );
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/invoices/${inv.id}`}
                        className="hover:underline"
                      >
                        {inv.number || "Invoice"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {inv.customer_name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <InvoiceStatusBadge status={inv.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMoney(t.total)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatMoney(t.balance)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {inv.due_date ? formatDate(inv.due_date) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <DeleteInvoiceButton
                        id={inv.id}
                        customerId={inv.customer_id}
                        label={inv.number || "this invoice"}
                        redirectTo="/invoices"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        </>
      )}
    </div>
  );
}
