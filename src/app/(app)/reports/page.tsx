import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Contact, Wallet, Package, Activity } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const profile = await requireProfile();
  if (!["admin", "office", "sales_manager"].includes(profile.role)) redirect("/");

  const reports = [
    {
      href: "/reports/lead-sources",
      icon: Contact,
      title: "Lead Sources",
      desc: "Where your leads come from, for any date range.",
    },
    // Profit / expenses / P&L are owner & admin only.
    ...(profile.role === "admin"
      ? [
          {
            href: "/pulse",
            icon: Activity,
            title: "Business Pulse",
            desc: "Real profit, what's owed, and ranked suggestions to act on.",
          },
          {
            href: "/financials",
            icon: Wallet,
            title: "Financials",
            desc: "Money in vs out, receivables, and job profitability.",
          },
          {
            href: "/reports/products",
            icon: Package,
            title: "Product performance",
            desc: "Best & worst sellers by revenue and margin, plus dead stock.",
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader title="Reports" description="Know how your business is doing." />
      <div className="grid gap-4 sm:grid-cols-2">
        {reports.map((r) => {
          const Icon = r.icon;
          return (
            <Link key={r.href} href={r.href}>
              <Card className="transition-colors hover:bg-muted/50">
                <CardContent className="flex items-start gap-3 pt-6">
                  <Icon className="size-5 text-muted-foreground" />
                  <div>
                    <div className="font-semibold">{r.title}</div>
                    <div className="text-sm text-muted-foreground">{r.desc}</div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
