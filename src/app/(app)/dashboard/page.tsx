import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Contact,
  Receipt,
  Trophy,
  CalendarDays,
  Plus,
  type LucideIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getDashboardCounts } from "@/lib/data/customers";
import { getActiveJobCount } from "@/lib/data/jobs";
import { getOutstandingInvoiceCount } from "@/lib/data/invoices";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const profile = await requireProfile();
  if (!["admin", "office", "sales_manager"].includes(profile.role)) redirect("/");
  const counts = await getDashboardCounts();
  const activeJobs = await getActiveJobCount();
  const outstanding = await getOutstandingInvoiceCount();
  const firstName = profile.full_name?.split(" ")[0] ?? "there";

  const stats: {
    label: string;
    value: string | number;
    hint: string;
    icon: LucideIcon;
    href?: string;
  }[] = [
    {
      label: "Open leads",
      value: counts.openLeads,
      hint: "New through quoted",
      icon: Contact,
      href: "/leads",
    },
    {
      label: "Outstanding invoices",
      value: outstanding,
      hint: "Unpaid or partial",
      icon: Receipt,
      href: "/invoices",
    },
    {
      label: "Won customers",
      value: counts.wonCustomers,
      hint: "Closed deals",
      icon: Trophy,
      href: "/customers?stage=won",
    },
    {
      label: "Active jobs",
      value: activeJobs,
      hint: "Scheduled & in progress",
      icon: CalendarDays,
      href: "/jobs",
    },
  ];

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description="Here's a snapshot of your business."
      >
        <Link href="/customers/new" className={buttonVariants({ size: "lg" })}>
          <Plus className="size-4" /> Add lead
        </Link>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const card = (
            <Card className={stat.href ? "transition-colors hover:bg-muted/50" : ""}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.label}
                </CardTitle>
                <Icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{stat.value}</div>
                <p className="text-xs text-muted-foreground">{stat.hint}</p>
              </CardContent>
            </Card>
          );
          return stat.href ? (
            <Link key={stat.label} href={stat.href} className="block">
              {card}
            </Link>
          ) : (
            <div key={stat.label}>{card}</div>
          );
        })}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">What&apos;s next</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            Leads &amp; Customers is live — track every prospect from first call to
            won deal. Up next we&apos;ll add{" "}
            <span className="font-medium text-foreground">Estimates</span> so you
            can build a quote right from a customer&apos;s profile and send it for
            approval.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
