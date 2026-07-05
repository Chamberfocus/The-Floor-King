import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, List } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { listJobs } from "@/lib/data/jobs";
import { cn } from "@/lib/utils";
import { JOB_STATUS_BADGE } from "@/lib/types";

export const metadata: Metadata = { title: "Job calendar" };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export default async function JobCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const now = new Date();
  const [y, m] =
    month && /^\d{4}-\d{2}$/.test(month)
      ? month.split("-").map(Number)
      : [now.getFullYear(), now.getMonth() + 1];

  const first = new Date(y, m - 1, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const monthLabel = first.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const jobs = await listJobs();
  const monthPrefix = `${y}-${pad(m)}`;
  const byDay = new Map<string, typeof jobs>();
  for (const j of jobs) {
    if (j.scheduled_date && j.scheduled_date.startsWith(monthPrefix)) {
      const arr = byDay.get(j.scheduled_date) ?? [];
      arr.push(j);
      byDay.set(j.scheduled_date, arr);
    }
  }

  const cells: (number | null)[] = [
    ...Array(startWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <PageHeader title="Job calendar" description={monthLabel}>
        <Link
          href="/jobs"
          className={buttonVariants({ variant: "outline", size: "lg" })}
        >
          <List className="size-4" /> List view
        </Link>
      </PageHeader>

      <div className="mb-3 flex items-center gap-2">
        <Link
          href={`/jobs/calendar?month=${prev}`}
          className={buttonVariants({ variant: "outline", size: "icon" })}
          aria-label="Previous month"
        >
          <ChevronLeft className="size-4" />
        </Link>
        <Link
          href={`/jobs/calendar?month=${next}`}
          className={buttonVariants({ variant: "outline", size: "icon" })}
          aria-label="Next month"
        >
          <ChevronRight className="size-4" />
        </Link>
        <span className="ml-2 font-medium">{monthLabel}</span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-0 sm:min-w-[700px]">
          <div className="grid grid-cols-7 border-b text-xs font-medium text-muted-foreground">
            {WEEKDAYS.map((d) => (
              <div key={d} className="p-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              const dateStr = day ? `${y}-${pad(m)}-${pad(day)}` : null;
              const dayJobs = dateStr ? (byDay.get(dateStr) ?? []) : [];
              const isToday = dateStr === todayStr;
              return (
                <div
                  key={i}
                  className={cn(
                    "min-h-24 border-b border-r p-1.5 align-top",
                    i % 7 === 0 && "border-l",
                    !day && "bg-muted/30",
                  )}
                >
                  {day ? (
                    <>
                      <div
                        className={cn(
                          "mb-1 text-xs",
                          isToday
                            ? "inline-flex size-5 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {day}
                      </div>
                      <div className="space-y-1">
                        {dayJobs.map((j) => (
                          <Link
                            key={j.id}
                            href={`/jobs/${j.id}`}
                            className={cn(
                              "block truncate rounded px-1.5 py-0.5 text-xs",
                              JOB_STATUS_BADGE[j.status],
                            )}
                            title={`${j.title ?? "Job"} — ${j.customer_name ?? ""}`}
                          >
                            {j.title || j.customer_name || "Job"}
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
    </div>
  );
}
