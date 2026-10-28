import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PrintButton } from "@/components/print-button";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { loadStatements } from "@/lib/data/shop-reports";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Statements" };
export const dynamic = "force-dynamic";

export default async function StatementsPage() {
  const profile = await requireProfile();
  if (!["admin", "office", "sales_manager"].includes(profile.role)) redirect("/");
  const { customers, claimsReady } = await loadStatements();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Reports
        </Link>
        <PrintButton label="Print statements" />
      </div>
      <PageHeader
        title="Customer statements"
        description="Open invoices and what is still owed. A claim stays on the statement. Credits applied on the invoice are not subtracted here."
      />
      {!claimsReady ? (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Claim marks will appear after the claims column is added in Supabase. Balances below are unchanged.
        </p>
      ) : null}
      {customers.length === 0 ? (
        <p className="rounded-lg border bg-card px-4 py-3 text-sm">No open invoice balances.</p>
      ) : null}
      <div className="flex flex-col gap-4">
        {customers.map((customer) => (
          <article id={customer.customerId} key={customer.customerId} className="rounded-lg border bg-card px-4 py-3 break-inside-avoid">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold">
                <Link href={`/customers/${customer.customerId}`} className="hover:underline">
                  {customer.name}
                </Link>
              </h2>
              <div className="font-semibold">{formatMoney(customer.balance)}</div>
            </div>
            <ul className="mt-2 space-y-1 text-sm">
              {customer.lines.map((line) => (
                <li key={line.id} className="flex justify-between gap-3">
                  <span>
                    <Link href={`/invoices/${line.id}`} className="hover:underline">
                      {line.number}
                    </Link>
                    {line.issued ? ` · ${formatDate(line.issued)}` : ""}
                    {line.due ? ` · due ${formatDate(line.due)}` : ""}
                    {line.claim ? " · Claim" : ""}
                  </span>
                  <span>{formatMoney(line.balance)}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}
