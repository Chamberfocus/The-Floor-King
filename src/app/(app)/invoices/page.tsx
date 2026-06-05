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
import { PageHeader } from "@/components/page-header";
import { InvoiceStatusBadge } from "@/components/invoice-status-badge";
import { listInvoices, amountPaid } from "@/lib/data/invoices";
import { invoiceTotals } from "@/lib/invoice-calc";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage() {
  const invoices = await listInvoices();

  return (
    <div>
      <PageHeader
        title="Invoices"
        description="Bill customers and track who still owes you."
      />

      {invoices.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No invoices yet. Create one from an approved estimate or a customer
          profile.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Due</TableHead>
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
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
