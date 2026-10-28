import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PrintButton } from "@/components/print-button";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireProfile } from "@/lib/auth";
import { loadTaxPacket } from "@/lib/data/shop-reports";
import { formatDate, formatMoney } from "@/lib/format";
import { shopTodayYmd } from "@/lib/job-snapshot";

export const metadata: Metadata = { title: "Sales tax" };
export const dynamic = "force-dynamic";

function monthStart(ymd: string): string {
  return `${ymd.slice(0, 8)}01`;
}

export default async function SalesTaxPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const profile = await requireProfile();
  if (!["admin", "office", "sales_manager"].includes(profile.role)) redirect("/");
  const sp = await searchParams;
  const today = shopTodayYmd();
  const start = sp.start && /^\d{4}-\d{2}-\d{2}$/.test(sp.start) ? sp.start : monthStart(today);
  const end = sp.end && /^\d{4}-\d{2}-\d{2}$/.test(sp.end) ? sp.end : today;
  const packet = await loadTaxPacket(start, end);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Reports
        </Link>
        <PrintButton label="Print tax packet" />
      </div>
      <PageHeader
        title="Sales tax"
        description="Tax charged on invoices in this range. Claims are listed apart from sales. This is not a posted ledger."
      />
      <form className="mb-4 flex flex-wrap items-end gap-2 print:hidden" action="/reports/sales-tax">
        <label className="text-sm">
          From
          <input type="date" name="start" defaultValue={start} className="mt-1 block h-9 rounded-md border bg-background px-2" />
        </label>
        <label className="text-sm">
          Through
          <input type="date" name="end" defaultValue={end} className="mt-1 block h-9 rounded-md border bg-background px-2" />
        </label>
        <Button type="submit" size="sm">
          Show
        </Button>
      </form>
      {!packet.claimsReady ? (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Claims are still included in sales until the claims column is added in Supabase.
        </p>
      ) : null}
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">Sales, without claims</div>
          <div className="text-xl font-semibold">{formatMoney(packet.sales)}</div>
          <div className="text-sm">Tax {formatMoney(packet.salesTax)}</div>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">Claims, still taxed</div>
          <div className="text-xl font-semibold">{formatMoney(packet.claimSales)}</div>
          <div className="text-sm">Tax {formatMoney(packet.claimTax)}</div>
        </div>
      </div>
      <ul className="divide-y rounded-lg border bg-card">
        {packet.rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm">
            <span>
              <Link href={`/invoices/${row.id}`} className="font-medium hover:underline">
                {row.number}
              </Link>{" "}
              · {row.customer}
              {row.issued ? ` · ${formatDate(row.issued)}` : ""}
              {row.claim ? " · Claim" : ""}
            </span>
            <span>
              {formatMoney(row.subtotal)} · tax {formatMoney(row.tax)}
            </span>
          </li>
        ))}
        {packet.rows.length === 0 ? (
          <li className="px-4 py-3 text-sm text-muted-foreground">No invoices in this range.</li>
        ) : null}
      </ul>
    </div>
  );
}
