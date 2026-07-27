import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Palette,
  CalendarClock,
  ListChecks,
  GitBranch,
  Ban,
  UserCog,
  BellRing,
  Truck,
  Target,
  CalendarRange,
  DollarSign,
  Layers,
  Rows3,
  SlidersHorizontal,
  Megaphone,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS = [
  {
    href: "/settings/preferences",
    icon: SlidersHorizontal,
    title: "My page setup & Google Calendar",
    desc: "Personal to your login — connect your Google Calendar sync, and choose which quick actions & tabs show on the customer pages.",
  },
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
    href: "/settings/estimate-questions",
    icon: ListChecks,
    title: "Estimate questionnaire",
    desc: "The guided estimate builder's questions — add, edit, reorder, and map each answer to a line item.",
  },
  {
    href: "/settings/pricing",
    icon: DollarSign,
    title: "Default pricing & add-ons",
    desc: "Your rates by flooring type, plus every estimate add-on (tear-out, subfloor, baseboards, stairs…) — add custom ones and set prices. These are the add-ons the estimate builder offers.",
  },
  {
    href: "/settings/suppliers",
    icon: Truck,
    title: "Vendors, freight & PO numbering",
    desc: "Vendor records (contact, terms, account #), per-vendor freight and the global fuel surcharge, your PO starting number, and estimate validity.",
  },
  {
    href: "/settings/stages",
    icon: GitBranch,
    title: "Workflow stages",
    desc: "The pipeline stages a customer moves through.",
  },
  {
    href: "/settings/cancel-reasons",
    icon: Ban,
    title: "Cancellation reasons",
    desc: "The pick-list shown when a job is cancelled — so lost business is captured as clean, reportable data (win/loss by reason).",
  },
  {
    href: "/settings/lead-sources",
    icon: Megaphone,
    title: "Lead sources & ad spend",
    desc: "The \"How did you hear about us?\" list — add sources, define their drill-down detail (referrer, campaign…), and enter monthly ad spend so the report can show cost per lead and return on ad spend.",
  },
  {
    href: "/settings/notifications",
    icon: BellRing,
    title: "Notifications",
    desc: "Master switches for staff vs. customer texts & emails.",
  },
  {
    href: "/settings/team",
    icon: UserCog,
    title: "Team & installers",
    desc: "Everyone in one place — logins & roles for staff/installers, plus subcontractor crews (no login needed).",
  },
  {
    href: "/settings/samples",
    icon: Layers,
    title: "Samples",
    desc: "Loan period, return reminders, default deposit, and how many samples a customer can have out.",
  },
  {
    href: "/settings/accessories",
    icon: Rows3,
    title: "Accessories",
    desc: "Transitions, moldings and trim. Set a type's price once and every color of that line inherits it — the colors come from the floors you carry, so there's no second list to keep.",
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
