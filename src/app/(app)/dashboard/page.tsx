import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Contact,
  Receipt,
  Trophy,
  CalendarDays,
  Plus,
  AlertTriangle,
  Truck,
  Hammer,
  Megaphone,
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
import { getDashboardCounts, listMyQueue } from "@/lib/data/customers";
import { getTodayTasks } from "@/lib/data/day-tasks";
import { listMyOfficeTasks } from "@/lib/data/ops-glue";
import { MyOfficeTasksCard } from "./my-office-tasks";
import { myStopsToday } from "@/lib/data/my-stops";
import { TodaysStopsList } from "@/components/todays-stops-list";
import { getActiveJobCount, listActiveInstallJobs, listAssignableUsers } from "@/lib/data/jobs";
import { getOutstandingInvoiceCount } from "@/lib/data/invoices";
import { RepostToBoardButton } from "./repost-to-board-button";
import { STAGE_COLOR_BADGE } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DayBriefing } from "./day-briefing";
import { AskBusiness } from "./ask-business";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const profile = await requireProfile();
  if (!["admin", "office", "sales_manager"].includes(profile.role)) redirect("/");
  const counts = await getDashboardCounts();
  const activeJobs = await getActiveJobCount();
  const outstanding = await getOutstandingInvoiceCount();
  const queue = await listMyQueue(profile.id);
  const todayTasks = await getTodayTasks();
  const officeTaskBuckets = await listMyOfficeTasks(profile.id).catch(() => ({
    overdue: [],
    dueToday: [],
    upcoming: [],
    completed: [],
  }));
  const taskAssignees = (await listAssignableUsers())
    .filter((u) =>
      ["admin", "office", "sales_manager", "salesman", "scheduler", "warehouse"].includes(
        u.role,
      ),
    )
    .map((u) => ({ id: u.id, name: u.name }));
  const myStops = await myStopsToday();
  const activeInstalls = await listActiveInstallJobs();
  const installerOptions = activeInstalls.length
    ? (await listAssignableUsers())
        .filter((u) => u.role === "crew")
        .map((u) => ({ id: u.id, name: u.name }))
    : [];
  const nowMs = Date.now();
  const overdueCount = queue.filter(
    (q) => q.next_action_due && new Date(q.next_action_due).getTime() < nowMs,
  ).length;
  const firstName = profile.full_name?.split(" ")[0] ?? "there";

  const stats: {
    label: string;
    value: string | number;
    hint: string;
    icon: LucideIcon;
    href?: string;
    tint: string;
  }[] = [
    {
      label: "Open leads",
      value: counts.openLeads,
      hint: "New through quoted",
      icon: Contact,
      href: "/leads",
      tint: "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-300",
    },
    {
      label: "Outstanding invoices",
      value: outstanding,
      hint: "Unpaid or partial",
      icon: Receipt,
      href: "/invoices",
      tint: "bg-zinc-200 text-zinc-700 dark:bg-zinc-500/20 dark:text-zinc-200",
    },
    {
      label: "Won customers",
      value: counts.wonCustomers,
      hint: "Closed deals",
      icon: Trophy,
      href: "/customers?stage=won",
      tint: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
    },
    {
      label: "Active jobs",
      value: activeJobs,
      hint: "Scheduled & in progress",
      icon: CalendarDays,
      href: "/jobs",
      tint: "bg-stone-200 text-stone-700 dark:bg-stone-500/20 dark:text-stone-200",
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

      {myStops.length > 0 ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="size-5 text-primary" /> Your stops today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TodaysStopsList stops={myStops} />
          </CardContent>
        </Card>
      ) : null}

      <MyOfficeTasksCard
        buckets={officeTaskBuckets}
        canAssign={["admin", "office", "sales_manager"].includes(profile.role)}
        assignees={taskAssignees}
      />
      <DayBriefing firstName={firstName} tasks={todayTasks} />

      <AskBusiness />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const card = (
            <Card
              className={
                stat.href
                  ? "overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md"
                  : "overflow-hidden"
              }
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.label}
                </CardTitle>
                <span
                  className={`flex size-9 items-center justify-center rounded-full ${stat.tint}`}
                >
                  <Icon className="size-4" />
                </span>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tracking-tight">
                  {stat.value}
                </div>
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

      {activeInstalls.length > 0 ? (
        <Card className="mt-6">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Hammer className="size-4 text-primary" /> Scheduled installs
            </CardTitle>
            <Link href="/board" className="text-xs text-primary hover:underline">
              Job board →
            </Link>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              Installer can&apos;t make it? Repost the job to the board so someone else can
              claim it — even mid-job.
            </p>
            <ul className="divide-y">
              {activeInstalls.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <Link href={`/jobs/${j.id}`} className="min-w-0 hover:underline">
                    <span className="font-medium">{j.customer_name || j.title || "Job"}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {j.scheduled_date ? formatDate(j.scheduled_date) : "Not dated"}
                      {j.installer_name ? ` · ${j.installer_name}` : " · unassigned"}
                    </span>
                  </Link>
                  {j.open_for_claim ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                      <Megaphone className="size-3" /> On the board
                    </span>
                  ) : (
                    <RepostToBoardButton jobId={j.id} installers={installerOptions} />
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Your queue</CardTitle>
          {overdueCount > 0 ? (
            <Link
              href="/client-status?who=mine&overdue=1"
              className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive hover:bg-destructive/20"
            >
              <AlertTriangle className="size-3.5" />
              {overdueCount} overdue
            </Link>
          ) : null}
        </CardHeader>
        <CardContent>
          {queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing assigned to you right now. Leads you own will show here
              with their next step.
            </p>
          ) : (
            <ul className="divide-y">
              {queue.map((q) => {
                const overdue =
                  !!q.next_action_due &&
                  new Date(q.next_action_due).getTime() < nowMs;
                return (
                  <li key={q.id}>
                    <Link
                      href={`/customers/${q.id}`}
                      className="flex items-center justify-between gap-3 py-2.5 hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">
                            {q.full_name}
                          </span>
                          {q.stage_name ? (
                            <span
                              className={cn(
                                "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                                STAGE_COLOR_BADGE[q.stage_color ?? "zinc"] ??
                                  STAGE_COLOR_BADGE.zinc,
                              )}
                            >
                              {q.stage_name}
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {q.next_action ?? "—"}
                          {q.city ? ` · ${q.city}` : ""}
                        </div>
                      </div>
                      {overdue ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-destructive">
                          <AlertTriangle className="size-3.5" /> Overdue
                        </span>
                      ) : null}
                    </Link>
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
