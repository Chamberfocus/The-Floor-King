import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, List, MapPin, AlertTriangle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { listJobs } from "@/lib/data/jobs";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { JOB_STATUS_BADGE } from "@/lib/types";

export const metadata: Metadata = { title: "Install schedule" };
export const dynamic = "force-dynamic";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export default async function InstallSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; week?: string; month?: string }>;
}) {
  await requireProfile();
  const { view = "week", week, month } = await searchParams;
  const now = new Date();
  const jobs = await listJobs();

  const header = (
    <PageHeader title="Install schedule" description={view === "month" ? "Month overview" : "Who's installing what, this week"}>
      <div className="flex gap-2">
        <div className="inline-flex rounded-md border p-0.5">
          <Link href="/jobs/calendar?view=week" className={cn("rounded px-3 py-1.5 text-sm font-medium", view !== "month" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Week</Link>
          <Link href="/jobs/calendar?view=month" className={cn("rounded px-3 py-1.5 text-sm font-medium", view === "month" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Month</Link>
        </div>
        <Link href="/jobs" className={buttonVariants({ variant: "outline", size: "lg" })}>
          <List className="size-4" /> Jobs
        </Link>
      </div>
    </PageHeader>
  );

  if (view === "month") return <div>{header}{monthGrid(now, month, jobs)}</div>;

  // ---- Week board: installers × 7 days ------------------------------------
  const base = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? new Date(`${week}T00:00:00`) : now;
  const start = new Date(base);
  start.setDate(base.getDate() - base.getDay()); // back to Sunday
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return iso(d);
  });
  const weekStart = days[0];
  const weekEnd = days[6];
  const prevWeek = (() => { const d = new Date(start); d.setDate(start.getDate() - 7); return iso(d); })();
  const nextWeek = (() => { const d = new Date(start); d.setDate(start.getDate() + 7); return iso(d); })();
  const todayStr = iso(now);

  // Installers (crew-role) as rows.
  const supabase = await createClient();
  const { data: crew } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "crew")
    .order("full_name", { ascending: true });
  const installers = (crew ?? []).map((c) => ({
    id: c.id as string,
    name: (c.full_name as string) || (c.email as string) || "Installer",
  }));

  // Jobs overlapping this week (scheduled_date .. scheduled_end).
  const inWeek = jobs.filter((j) => {
    if (!j.scheduled_date) return false;
    const s = j.scheduled_date;
    const e = j.scheduled_end || j.scheduled_date;
    return s <= weekEnd && e >= weekStart;
  });
  const spans = (j: (typeof jobs)[number], day: string) => {
    const s = j.scheduled_date!;
    const e = j.scheduled_end || j.scheduled_date!;
    return s <= day && day <= e;
  };

  const rows = [
    ...installers.map((i) => ({ id: i.id, name: i.name, unassigned: false })),
    { id: "__unassigned__", name: "Unassigned", unassigned: true },
  ];

  const cell = (rowId: string, unassigned: boolean, day: string) =>
    inWeek.filter((j) => (unassigned ? !j.assigned_to : j.assigned_to === rowId) && spans(j, day));

  return (
    <div>
      {header}
      <div className="mb-3 flex items-center gap-2">
        <Link href={`/jobs/calendar?view=week&week=${prevWeek}`} className={buttonVariants({ variant: "outline", size: "icon" })} aria-label="Previous week">
          <ChevronLeft className="size-4" />
        </Link>
        <Link href={`/jobs/calendar?view=week&week=${nextWeek}`} className={buttonVariants({ variant: "outline", size: "icon" })} aria-label="Next week">
          <ChevronRight className="size-4" />
        </Link>
        <span className="ml-2 text-sm font-medium">
          Week of {new Date(`${weekStart}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" })}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <div className="min-w-[820px]">
          {/* Header row */}
          <div className="grid grid-cols-[130px_repeat(7,1fr)] border-b bg-muted/40 text-xs font-semibold">
            <div className="p-2">Installer</div>
            {days.map((d) => {
              const dd = new Date(`${d}T00:00:00`);
              return (
                <div key={d} className={cn("p-2 text-center", d === todayStr && "text-primary")}>
                  {WEEKDAYS[dd.getDay()]} {dd.getDate()}
                </div>
              );
            })}
          </div>
          {rows.map((row) => {
            const rowJobs = inWeek.filter((j) => (row.unassigned ? !j.assigned_to : j.assigned_to === row.id));
            if (row.unassigned && rowJobs.length === 0) return null; // hide empty unassigned row
            return (
              <div key={row.id} className="grid grid-cols-[130px_repeat(7,1fr)] border-b last:border-0">
                <div className={cn("flex items-center p-2 text-sm font-medium", row.unassigned && "text-amber-600")}>
                  {row.name}
                </div>
                {days.map((d) => {
                  const cj = cell(row.id, row.unassigned, d);
                  const conflict = !row.unassigned && cj.length > 1;
                  return (
                    <div key={d} className={cn("min-h-16 border-l p-1", d === todayStr && "bg-primary/5")}>
                      {conflict ? (
                        <div className="mb-1 flex items-center gap-0.5 text-[10px] font-bold text-destructive">
                          <AlertTriangle className="size-3" /> Double-booked
                        </div>
                      ) : null}
                      <div className="space-y-1">
                        {cj.map((j) => (
                          <Link
                            key={j.id}
                            href={`/jobs/${j.id}`}
                            className={cn(
                              "block rounded px-1.5 py-1 text-[11px] leading-tight",
                              conflict ? "ring-1 ring-destructive" : "",
                              JOB_STATUS_BADGE[j.status],
                            )}
                            title={`${j.title ?? "Job"} — ${j.customer_name ?? ""}`}
                          >
                            <div className="truncate font-semibold">{j.customer_name || j.title || "Job"}</div>
                            {j.site_city ? (
                              <div className="flex items-center gap-0.5 truncate opacity-80">
                                <MapPin className="size-2.5" /> {j.site_city}
                              </div>
                            ) : null}
                            {j.arrival_window ? <div className="truncate opacity-80">{j.arrival_window}</div> : null}
                          </Link>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {installers.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No installers (crew) on the team yet — add them under Settings → Team.</p>
      ) : null}
    </div>
  );
}

// ---- Month overview (kept as a toggle) ------------------------------------
function monthGrid(now: Date, month: string | undefined, jobs: Awaited<ReturnType<typeof listJobs>>) {
  const [y, m] = month && /^\d{4}-\d{2}$/.test(month) ? month.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];
  const first = new Date(y, m - 1, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const monthLabel = first.toLocaleString("en-US", { month: "long", year: "numeric" });
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  const todayStr = iso(now);
  const monthPrefix = `${y}-${pad(m)}`;
  const byDay = new Map<string, typeof jobs>();
  for (const j of jobs) {
    if (j.scheduled_date && j.scheduled_date.startsWith(monthPrefix)) {
      const arr = byDay.get(j.scheduled_date) ?? [];
      arr.push(j);
      byDay.set(j.scheduled_date, arr);
    }
  }
  const cells: (number | null)[] = [...Array(startWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Link href={`/jobs/calendar?view=month&month=${prev}`} className={buttonVariants({ variant: "outline", size: "icon" })} aria-label="Previous month"><ChevronLeft className="size-4" /></Link>
        <Link href={`/jobs/calendar?view=month&month=${next}`} className={buttonVariants({ variant: "outline", size: "icon" })} aria-label="Next month"><ChevronRight className="size-4" /></Link>
        <span className="ml-2 font-medium">{monthLabel}</span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-0 sm:min-w-[700px]">
          <div className="grid grid-cols-7 border-b text-xs font-medium text-muted-foreground">
            {WEEKDAYS.map((d) => <div key={d} className="p-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              const dateStr = day ? `${y}-${pad(m)}-${pad(day)}` : null;
              const dayJobs = dateStr ? (byDay.get(dateStr) ?? []) : [];
              const isToday = dateStr === todayStr;
              return (
                <div key={i} className={cn("min-h-24 border-b border-r p-1.5 align-top", i % 7 === 0 && "border-l", !day && "bg-muted/30")}>
                  {day ? (
                    <>
                      <div className={cn("mb-1 text-xs", isToday ? "inline-flex size-5 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground" : "text-muted-foreground")}>{day}</div>
                      <div className="space-y-1">
                        {dayJobs.map((j) => (
                          <Link key={j.id} href={`/jobs/${j.id}`} className={cn("block truncate rounded px-1.5 py-0.5 text-xs", JOB_STATUS_BADGE[j.status])} title={`${j.title ?? "Job"} — ${j.customer_name ?? ""}`}>
                            {j.customer_name || j.title || "Job"}
                          </Link>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
