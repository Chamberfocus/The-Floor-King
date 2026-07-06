import type { Metadata } from "next";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  CalendarOff,
  Users,
  BellRing,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { listTeamMembers } from "@/lib/data/team";
import {
  getShiftsMap,
  listTimeOff,
  listPendingTimeOff,
} from "@/lib/data/team-schedule";
import { ROLE_LABELS, SCHEDULE_ROLES } from "@/lib/types";
import { fromYmd, addDaysYmd } from "@/lib/scheduling";
import { to12 } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AddDayOff } from "./add-day-off";
import { DeleteDayOff } from "./day-off-actions";
import { ApprovalActions } from "./approval-actions";
import { ShiftEditor } from "./shift-editor";

export const metadata: Metadata = { title: "Team Schedule" };

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK_HEAD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MON = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
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

/** Monday on/before the given day (weeks start Monday). */
function mondayOf(ymd: string): string {
  return addDaysYmd(ymd, -((fromYmd(ymd).getUTCDay() + 6) % 7));
}

export default async function TeamSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; week?: string; month?: string }>;
}) {
  const profile = await requireProfile();
  // Installers (crew) don't use the schedule — keep them out even via direct URL.
  if (!SCHEDULE_ROLES.includes(profile.role)) redirect("/");
  const sp = await searchParams;
  const isManager = profile.role === "admin" || profile.role === "office";
  const view = sp.view === "month" ? "month" : "week";

  const todayYmd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());

  let gridDays: string[];
  let rangeStart: string;
  let rangeEnd: string;
  let periodLabel: string;
  let prevHref: string;
  let nextHref: string;
  let monthKey = "";

  if (view === "month") {
    const monthParam =
      typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month)
        ? sp.month
        : todayYmd.slice(0, 7);
    monthKey = monthParam;
    const [yy, mm] = monthParam.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const first = `${monthParam}-01`;
    const last = `${monthParam}-${String(daysInMonth).padStart(2, "0")}`;
    rangeStart = mondayOf(first);
    rangeEnd = addDaysYmd(last, 6 - ((fromYmd(last).getUTCDay() + 6) % 7));
    gridDays = [];
    for (let d = rangeStart; d <= rangeEnd; d = addDaysYmd(d, 1)) gridDays.push(d);
    periodLabel = `${MON[mm - 1]} ${yy}`;
    const prevMonth =
      mm === 1 ? `${yy - 1}-12` : `${yy}-${String(mm - 1).padStart(2, "0")}`;
    const nextMonth =
      mm === 12 ? `${yy + 1}-01` : `${yy}-${String(mm + 1).padStart(2, "0")}`;
    prevHref = `/team?view=month&month=${prevMonth}`;
    nextHref = `/team?view=month&month=${nextMonth}`;
  } else {
    const weekParam =
      typeof sp.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.week)
        ? sp.week
        : todayYmd;
    const monday = mondayOf(weekParam);
    gridDays = Array.from({ length: 7 }, (_, i) => addDaysYmd(monday, i));
    rangeStart = gridDays[0];
    rangeEnd = gridDays[6];
    periodLabel = `${mdLabel(rangeStart)} – ${mdLabel(rangeEnd)}`;
    prevHref = `/team?week=${addDaysYmd(monday, -7)}`;
    nextHref = `/team?week=${addDaysYmd(monday, 7)}`;
  }

  const [membersRaw, shiftsMap, rangeOff, upcoming, pending] =
    await Promise.all([
      listTeamMembers(),
      getShiftsMap(),
      listTimeOff(rangeStart, rangeEnd), // approved only
      listTimeOff(todayYmd, addDaysYmd(todayYmd, 45)),
      isManager
        ? listPendingTimeOff(todayYmd)
        : Promise.resolve([] as Awaited<ReturnType<typeof listPendingTimeOff>>),
    ]);
  const members = membersRaw.filter(
    (m) => m.active && SCHEDULE_ROLES.includes(m.role),
  );

  const nameOf = (id: string) => {
    const m = members.find((x) => x.id === id);
    return m?.full_name || m?.email || "—";
  };
  const firstName = (id: string) => nameOf(id).split(" ")[0];
  const shiftOf = (id: string, weekday: number) => shiftsMap[id]?.[weekday];

  // day ymd -> (userId -> kind), approved off only
  const offByDay = new Map<string, Map<string, string>>();
  for (const d of gridDays) offByDay.set(d, new Map());
  for (const t of rangeOff) {
    for (const d of gridDays) {
      if (t.start_date <= d && d <= t.end_date) {
        offByDay.get(d)!.set(t.user_id, t.kind);
      }
    }
  }

  const memberOptions = members.map((m) => ({
    id: m.id,
    name: m.full_name || m.email,
  }));

  const toggleCls = (active: boolean) =>
    cn(
      "rounded px-3 py-1 text-sm font-medium transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div>
      <PageHeader
        title="Team Schedule"
        description="Each person's working hours, and who's off. Request a day off — it's approved automatically unless it clashes with someone already off."
      >
        <AddDayOff isManager={isManager} members={memberOptions} />
      </PageHeader>

      {/* Approval queue — managers only */}
      {isManager && pending.length > 0 ? (
        <Card className="mb-6 border-amber-300 dark:border-amber-900">
          <CardContent className="pt-6">
            <div className="mb-3 flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-400">
              <BellRing className="size-4" /> Needs your approval (
              {pending.length})
            </div>
            <ul className="divide-y">
              {pending.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-medium">{nameOf(t.user_id)}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      — {KIND_LABEL[t.kind] ?? "Off"} ·{" "}
                      {t.start_date === t.end_date
                        ? mdLabel(t.start_date)
                        : `${mdLabel(t.start_date)} – ${mdLabel(t.end_date)}`}
                      {t.note ? ` · ${t.note}` : ""}
                    </span>
                  </div>
                  <ApprovalActions id={t.id} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* View toggle + period navigation */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border p-0.5">
          <Link href="/team" className={toggleCls(view === "week")}>
            Week
          </Link>
          <Link href="/team?view=month" className={toggleCls(view === "month")}>
            Month
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={prevHref}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ChevronLeft className="size-4" /> Prev
          </Link>
          <div className="min-w-36 text-center text-sm font-semibold">
            {periodLabel}
            {rangeStart <= todayYmd && todayYmd <= rangeEnd ? null : (
              <Link
                href={view === "month" ? "/team?view=month" : "/team"}
                className="ml-2 text-xs text-muted-foreground underline hover:text-foreground"
              >
                Today
              </Link>
            )}
          </div>
          <Link
            href={nextHref}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Next <ChevronRight className="size-4" />
          </Link>
        </div>
      </div>

      {view === "week" ? (
        /* Week: a card per day with each person's hours + who's off */
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
          {gridDays.map((d) => {
            const weekday = fromYmd(d).getUTCDay();
            const off = offByDay.get(d)!;
            const working = members.filter(
              (m) => shiftOf(m.id, weekday) && !off.has(m.id),
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
                  {working.map((m) => {
                    const s = shiftOf(m.id, weekday)!;
                    return (
                      <div
                        key={m.id}
                        className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                      >
                        <div className="truncate font-medium">
                          {m.full_name || m.email}
                        </div>
                        <div className="text-[10px] opacity-80">
                          {to12(s.start)}–{to12(s.end)}
                        </div>
                      </div>
                    );
                  })}
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
      ) : (
        /* Month: calendar grid focused on who's off (coverage at a glance) */
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-7 text-center text-xs font-semibold text-muted-foreground">
              {WEEK_HEAD.map((d) => (
                <div key={d} className="py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {gridDays.map((d) => {
                const off = offByDay.get(d)!;
                const inMonth = d.slice(0, 7) === monthKey;
                const isToday = d === todayYmd;
                return (
                  <div
                    key={d}
                    className={cn(
                      "min-h-[84px] rounded-md border p-1",
                      !inMonth && "opacity-40",
                      isToday && "ring-2 ring-primary",
                    )}
                  >
                    <div className="text-xs font-semibold">
                      {Number(d.slice(8, 10))}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {[...off.entries()].map(([uid, kind]) => (
                        <div
                          key={uid}
                          className="truncate rounded bg-amber-50 px-1 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                          title={`${nameOf(uid)} — ${KIND_LABEL[kind] ?? "Off"}`}
                        >
                          {firstName(uid)} · {KIND_LABEL[kind] ?? "Off"}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Upcoming days off */}
      <Card className="mt-6">
        <CardContent className="pt-6">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <CalendarOff className="size-4 text-muted-foreground" /> Upcoming days
            off
          </div>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No approved days off in the next 45 days.
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

      {/* Weekly hours template — office/admin only */}
      {isManager ? (
        <Card className="mt-6">
          <CardContent className="pt-6">
            <div className="mb-1 flex items-center gap-2 font-semibold">
              <Users className="size-4 text-muted-foreground" /> Working hours
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              Set each person&apos;s weekly hours. This is the schedule everyone
              works to — changes save instantly.
            </p>
            <div className="space-y-2">
              {members.map((m) => (
                <ShiftEditor
                  key={m.id}
                  userId={m.id}
                  name={m.full_name || m.email}
                  roleLabel={ROLE_LABELS[m.role]}
                  shifts={shiftsMap[m.id] ?? {}}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
