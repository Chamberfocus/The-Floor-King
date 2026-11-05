import type { Metadata } from "next";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InvoiceStatusBadge } from "@/components/invoice-status-badge";
import { invoiceDisplayTotals, listInvoicesForCustomer } from "@/lib/data/invoices";
import { formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Your invoices" };

export default async function PortalInvoicesPage() {
  const profile = await requireProfile();
  if (!profile.customer_id) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Your account isn&apos;t linked to a project yet.
        </CardContent>
      </Card>
    );
  }
  const invoices = await listInvoicesForCustomer(profile.customer_id);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Your invoice</h1>
        <p className="text-sm text-muted-foreground">
          What you owe, and a way to pay it, stays with the invoice we sent.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No invoice yet. It will show up here when there is a balance.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {invoices.map((inv) => {
                const totals = invoiceDisplayTotals(inv);
                return (
                  <li key={inv.id} className="flex items-center justify-between gap-3 py-3">
                    <Link
                      href={`/portal/invoices/${inv.id}`}
                      className="font-medium hover:underline"
                    >
                      {inv.number || "Invoice"}
                    </Link>
                    <div className="flex shrink-0 items-center gap-3">
                      <InvoiceStatusBadge status={inv.status} />
                      <span className="font-medium">{formatMoney(totals.balance)} due</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
