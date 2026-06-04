import type { Metadata } from "next";
import { Contact, FileText, CalendarDays, Receipt } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";

export const metadata: Metadata = { title: "Dashboard" };

const STATS = [
  { label: "Open leads", icon: Contact, hint: "New & in progress" },
  { label: "Pending estimates", icon: FileText, hint: "Awaiting approval" },
  { label: "Active jobs", icon: CalendarDays, hint: "Scheduled & in progress" },
  { label: "Outstanding invoices", icon: Receipt, hint: "Unpaid balances" },
];

export default async function DashboardPage() {
  const profile = await requireProfile();
  const firstName = profile.full_name?.split(" ")[0] ?? "there";

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description="Here's a snapshot of your business. Live numbers arrive as we build each module."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.label}
                </CardTitle>
                <Icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">—</div>
                <p className="text-xs text-muted-foreground">{stat.hint}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Getting started</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            Your CRM foundation is live: secure sign-in, role-based access, and a
            mobile-friendly layout. Next we&apos;ll build the{" "}
            <span className="font-medium text-foreground">Leads &amp; Customers</span>{" "}
            module so your office can start tracking every job from first call to
            final invoice.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
