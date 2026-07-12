import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Receipt, AlertTriangle, FileUp } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireProfile } from "@/lib/auth";
import { listBills, getAPSummary, type BillStatus } from "@/lib/data/bills";
import { formatMoney, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Bills" };
export const dynamic = "force-dynamic";

const STATUS: Record<BillStatus, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-amber-500/10 text-amber-600" },
  partial: { label: "Partial", cls: "bg-blue-500/10 text-blue-600" },
  paid: { label: "Paid", cls: "bg-emerald-500/10 text-emerald-600" },
};

export default async function BillsPage() {
  const profile = await requireProfile();
  if (!["admin", "office"].includes(profile.role)) redirect("/");
  const [bills, ap] = await Promise.all([listBills(), getAPSummary()]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Bills"
        description="What you owe your vendors — created from purchase orders, paid down over time."
      >
        <Link href="/bills/import" className={buttonVariants({ size: "lg" })}>
          <FileUp className="size-4" /> Import bill
        </Link>
      </PageHeader>

      {/* AP summary */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">You owe (AP)</div>
            <div className="text-2xl font-bold tabular-nums">{formatMoney(ap.outstanding)}</div>
            <div className="text-xs text-muted-foreground">{ap.openCount} open bill{ap.openCount === 1 ? "" : "s"}</div>
          </CardContent>
        </Card>
        <Card className={ap.overdue > 0 ? "border-destructive/40" : ""}>
          <CardContent className="p-4">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {ap.overdue > 0 ? <AlertTriangle className="size-3.5 text-destructive" /> : null} Overdue
            </div>
            <div className={cn("text-2xl font-bold tabular-nums", ap.overdue > 0 && "text-destructive")}>
              {formatMoney(ap.overdue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Due within 7 days</div>
            <div className="text-2xl font-bold tabular-nums">{formatMoney(ap.dueSoon)}</div>
          </CardContent>
        </Card>
      </div>

      {bills.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          <Receipt className="mx-auto mb-2 size-6 opacity-50" />
          No bills yet. Open a purchase order and click <strong>Convert to bill</strong> to
          create one.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Vendor</th>
                <th className="px-3 py-2 text-left">Bill date</th>
                <th className="px-3 py-2 text-left">Due</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Balance</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {bills.map((b) => (
                <tr key={b.id} className="hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <Link href={`/bills/${b.id}`} className="font-medium hover:underline">
                      {b.supplier || "Vendor"}
                    </Link>
                    {b.bill_number ? (
                      <span className="block text-xs text-muted-foreground">#{b.bill_number}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(b.bill_date)}</td>
                  <td className="px-3 py-2">
                    {b.due_date ? (
                      <span className={b.overdue ? "font-medium text-destructive" : "text-muted-foreground"}>
                        {formatDate(b.due_date)}
                        {b.overdue ? " · overdue" : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(b.total)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatMoney(b.balance)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        STATUS[b.status].cls,
                      )}
                    >
                      {STATUS[b.status].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
