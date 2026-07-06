import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CalendarOff, Users } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { listTeamMembers } from "@/lib/data/team";
import { getWorkDaysMap, listTimeOff } from "@/lib/data/team-schedule";
import { ROLE_LABELS, SCHEDULE_ROLES } from "@/lib/types";
import { fromYmd, addDaysYmd } from "@/lib/scheduling";
import { cn } from "@/lib/utils";
import { AddDayOff } from "./add-day-off";
import { DeleteDayOff } from "./day-off-actions";
import { WorkDaysEditor } from "./work-days-editor";

export const metadata: Metadata = { title: "Team Schedule" };

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const DEFAULT_WORK = "1,2,3,4,5,6"; // Mon–Sat until set per person
const KIND_LABEL: Record<string, string> = {
  off: "Off",
  vacation: "Vacation",
  sick: "Sick",
  personal: "Personal",
};

function mdLabel(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${MON[m - 1]} ${d}`;
}

export default async function TeamSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const profile = await requireProfile();
  // Installers (crew) don't use the schedule — keep them out even via direct URL.
  if (!SCHEDULE_ROLES.includes(profile.role)) redirect("/");
  const sp = await searchParams;
  const isManager = profile.role === "admin" || profile.role === "office";

  const todayYmd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());
  const weekParam =
    typeof sp.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.week)
      ? sp.week
      : todayYmd;
  const dow = fromYmd(weekParam).getUTCDay();
  const monday = addDaysYmd(weekParam, -((dow + 6) % 7)); // week starts Monday
  const days = Array.from({ length: 7 }, (_, i) => addDaysYmd(monday, i));
  const sunday = days[6];

  const [membersRaw, workMap, weekOff, upcoming] = await Promise.all([
    listTeamMembers(),
    getWorkDaysMap(),
    listTimeOff(monday, sunday),
    listTimeOff(todayYmd, addDaysYmd(todayYmd, 45)),
  ]);
  const members = membersRaw.filter(
    (m) => m.active && SCHEDULE_ROLES.includes(m.role),
  );

  const nameOf = (id: string) => {
    const m = members.find((x) => x.id === id);
    return m?.full_name || m?.email || "—";
  };
  const workSet = (id: string) =>
    new Set(
      (workMap[id] ?? DEFAULT_WORK)
        .split(",")
        .map(Number)
        .filter((n) => n >= 0 && n <= 6),
    );

  // day ymd -> (userId -> kind)
  const offByDay = new Map<string, Map<string, string>>();
  for (const d of days) offByDay.set(d, new Map());
  for (const t of weekOff) {
    for (const d of days) {
      if (t.start_date <= d && d <= t.end_date) {
        offByDay.get(d)!.set(t.user_id, t.kind);
      }
    }
  }

  const memberOptions = members.map((m) => ({
    id: m.id,
    name: m.full_name || m.email,
  }));

  return (
    <div>
      <PageHeader
        title="Team Schedule"
        description="Who's working each day, and who's off. Post your own days off — everyone sees them."
      >
        <AddDayOff isManager={isManager} members={memberOptions} />
      </PageHeader>

      {/* Week navigation */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link
          href={`/team?week=${addDaysYmd(monday, -7)}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ChevronLeft className="size-4" /> Prev
        </Link>
        <div className="text-sm font-semibold">
          {mdLabel(monday)} – {mdLabel(sunday)}
          {monday <= todayYmd && todayYmd <= sunday ? (
            <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              This week
            </span>
          ) : (
            <Link
              href="/team"
              className="ml-2 text-xs text-muted-foreground underline hover:text-foreground"
            >
              Jump to today
            </Link>
          )}
        </div>
        <Link
          href={`/team?week=${addDaysYmd(monday, 7)}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Next <ChevronRight className="size-4" />
        </Link>
      </div>

      {/* 7-day roster */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {days.map((d) => {
          const weekday = fromYmd(d).getUTCDay();
          const off = offByDay.get(d)!;
          const working = members.filter(
            (m) => workSet(m.id).has(weekday) && !off.has(m.id),
          );
          const offList = members.filter((m) => off.has(m.id));
          const isToday = d === todayYmd;
          return (
            <div
              key={d}
              className={cn(
                "rounded-lg border p-2",
                isToday && "ring-2 ring-primary",
              )}
            >
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-sm font-semibold">{DOW[weekday]}</span>
                <span className="text-xs text-muted-foreground">
                  {mdLabel(d)}
                </span>
              </div>
              <div className="space-y-1">
                {working.map((m) => (
                  <div
                    key={m.id}
                    className="truncate rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  >
                    {m.full_name || m.email}
                  </div>
                ))}
                {offList.map((m) => (
                  <div
                    key={m.id}
                    className="truncate rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800 line-through decoration-amber-400 dark:bg-amber-950/40 dark:text-amber-300"
                  >
                    {m.full_name || m.email}
                    <span className="ml-1 no-underline">
                      · {KIND_LABEL[off.get(m.id)!] ?? "Off"}
                    </span>
                  </div>
                ))}
                {working.length === 0 && offList.length === 0 ? (
                  <div className="text-xs text-muted-foreground">—</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Upcoming days off */}
      <Card className="mt-6">
        <CardContent className="pt-6">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <CalendarOff className="size-4 text-muted-foreground" /> Upcoming days
            off
          </div>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No days off in the next 45 days.
            </p>
          ) : (
            <ul className="divide-y">
              {upcoming.map((t) => {
                const canRemove = isManager || t.user_id === profile.id;
                return (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-2 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <span className="font-medium">{nameOf(t.user_id)}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        — {KIND_LABEL[t.kind] ?? "Off"}
                        {t.note ? ` · ${t.note}` : ""}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-muted-foreground">
                        {t.start_date === t.end_date
                          ? mdLabel(t.start_date)
                          : `${mdLabel(t.start_date)} – ${mdLabel(t.end_date)}`}
                      </span>
                      {canRemove ? <DeleteDayOff id={t.id} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Weekly work days — office/admin only */}
      {isManager ? (
        <Card className="mt-6">
          <CardContent className="pt-6">
            <div className="mb-1 flex items-center gap-2 font-semibold">
              <Users className="size-4 text-muted-foreground" /> Regular work
              days
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              Set each person&apos;s normal working days. Taps save instantly.
              (M T W T F S S)
            </p>
            <div className="space-y-3">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium">
                      {m.full_name || m.email}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {ROLE_LABELS[m.role]}
                    </div>
                  </div>
                  <WorkDaysEditor
                    userId={m.id}
                    workDays={workMap[m.id] ?? DEFAULT_WORK}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
