import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Palette,
  CalendarClock,
  ListChecks,
  ShoppingCart,
  GitBranch,
  UserCog,
  Truck,
  Target,
  CalendarRange,
  DollarSign,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS = [
  {
    href: "/settings/targets",
    icon: Target,
    title: "Profit targets",
    desc: "Target gross margin and monthly revenue goal that Business Pulse measures against.",
  },
  {
    href: "/settings/branding",
    icon: Palette,
    title: "Branding",
    desc: "Company name, logo, colors, and contact details.",
  },
  {
    href: "/settings/showroom",
    icon: CalendarRange,
    title: "Showroom & calendar",
    desc: "Showroom hours, capacity, booking link, and appointment types.",
  },
  {
    href: "/settings/scheduling",
    icon: CalendarClock,
    title: "Scheduling",
    desc: "Work hours, estimate length, and per-installer capacities.",
  },
  {
    href: "/settings/qualifying",
    icon: ListChecks,
    title: "Qualifying questionnaire",
    desc: "The intake questions your team asks new leads.",
  },
  {
    href: "/settings/pricing",
    icon: DollarSign,
    title: "Default pricing",
    desc: "Your usual rates by flooring type, plus add-on & pad prices that pre-fill in the estimate builder.",
  },
  {
    href: "/settings/wizard",
    icon: ShoppingCart,
    title: "Quote add-ons",
    desc: "Priced extras offered in the quote builder.",
  },
  {
    href: "/settings/suppliers",
    icon: Truck,
    title: "Freight, fuel & quote terms",
    desc: "Per-supplier freight, a global fuel surcharge, and quote validity.",
  },
  {
    href: "/settings/stages",
    icon: GitBranch,
    title: "Workflow stages",
    desc: "The pipeline stages a customer moves through.",
  },
  {
    href: "/settings/team",
    icon: UserCog,
    title: "Team",
    desc: "Logins, roles, job titles, and home bases.",
  },
];

export default async function SettingsHubPage() {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Settings"
        description="Configure how Floor King CRM works for your business."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.href} href={s.href}>
              <Card className="h-full transition-all hover:-translate-y-0.5 hover:shadow-md">
                <CardContent className="flex items-start gap-3 pt-6">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </span>
                  <div>
                    <div className="font-semibold">{s.title}</div>
                    <div className="text-sm text-muted-foreground">{s.desc}</div>
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
