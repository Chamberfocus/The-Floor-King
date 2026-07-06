import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CalendarOff, BellRing } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { listTeamMembers } from "@/lib/data/team";
import {
  getShiftsMap,
  getOverrides,
  listTimeOff,
  listPendingTimeOff,
} from "@/lib/data/team-schedule";
import { ROLE_LABELS, SCHEDULE_ROLES } from "@/lib/types";
import { fromYmd, addDaysYmd } from "@/lib/scheduling";
import { to12 } from "@/lib/format";
import { cn } from "@/lib/utils";
import { COMPANY_NAME } from "@/lib/nav";
import { AddDayOff } from "./add-day-off";
import { DeleteDayOff } from "./day-off-actions";
import { ApprovalActions } from "./approval-actions";
import { ShiftGrid } from "./shift-grid";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Team Schedule" };

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK_HEAD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DOW_FULL = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const MON = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const KIND_LABEL: Record<string, string> = {
  off: "Off", vacation: "Vacation", sick: "Sick", personal: "Personal",
};

function mdLabel(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${MON[m - 1]} ${d}`;
}
function dayLabel(ymd: string): string {
  return `${DOW_FULL[fromYmd(ymd).getUTCDay()]}, ${mdLabel(ymd)}`;
}
function mondayOf(ymd: string): string {
  return addDaysYmd(ymd, -((fromYmd(ymd).getUTCDay() + 6) % 7));
}
/** Compact time for calendar cells: "9:00 AM" → "9a". */
function compact(hm: string): string {
  return to12(hm).replace(":00 ", " ").replace(" AM", "a").replace(" PM", "p");
}

type View = "day" | "week" | "month";

export default async function TeamSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    day?: string;
    week?: string;
    month?: string;
  }>;
}) {
  const profile = await requireProfile();
  if (!SCHEDULE_ROLES.includes(profile.role)) redirect("/");
  const sp = await searchParams;
  const isManager = profile.role === "admin" || profile.role === "office";
  const view: View =
    sp.view === "day" ? "day" : sp.view === "month" ? "month" : "week";

  const todayYmd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());

  let gridDays: string[];
  let rangeStart: string;
  let rangeEnd: string;
  let periodLabel: string;
  let prevHref: string;
  let nextHref: string;
  let monthKey = ""; // "YYYY-MM" of the shown month (month view only)

  if (view === "day") {
    const anchor =
      typeof sp.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.day)
        ? sp.day
        : todayYmd;
    gridDays = [anchor];
    rangeStart = anchor;
    rangeEnd = anchor;
    periodLabel = dayLabel(anchor);
    prevHref = `/team?view=day&day=${addDaysYmd(anchor, -1)}`;
    nextHref = `/team?view=day&day=${addDaysYmd(anchor, 1)}`;
  } else if (view === "month") {
    const monthParam =
      typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month)
        ? sp.month
        : todayYmd.slice(0, 7);
    monthKey = monthParam;
    const [yy, mm] = monthParam.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const first = `${monthParam}-01`;
    const last = `${monthParam}-${String(daysInMonth).padStart(2, "0")}`;
    // Pad to whole weeks (Mon-start) so it reads like a wall calendar.
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

  const [membersRaw, shiftsMap, overridesMap, rangeOff, upcoming, pending] =
    await Promise.all([
      listTeamMembers(),
      getShiftsMap(),
      getOverrides(rangeStart, rangeEnd),
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
  // Plain-object versions for the client grid (Maps don't cross the boundary).
  const offObj: Record<string, Record<string, string>> = {};
  for (const [ymd, m] of offByDay)
    for (const [uid, kind] of m) (offObj[uid] ??= {})[ymd] = kind;
  const weekColumns = gridDays.map((d) => {
    const wd = fromYmd(d).getUTCDay();
    return {
      weekday: wd,
      top: DOW[wd],
      bottom: mdLabel(d),
      ymd: d,
      isToday: d === todayYmd,
    };
  });
  const gridMembers = members.map((m) => ({
    id: m.id,
    name: m.full_name || m.email,
    roleLabel: ROLE_LABELS[m.role],
  }));

  // What a person is doing on a date: a shift, off (with reason), or nothing.
  type Cell =
    | { kind: "work"; start: string; end: string }
    | { kind: "off"; reason: string }
    | null;
  const cellFor = (userId: string, ymd: string): Cell => {
    const off = offByDay.get(ymd)?.get(userId);
    if (off) return { kind: "off", reason: off };
    // A one-off override for this date wins over the recurring template.
    const ov = overridesMap[userId]?.[ymd];
    if (ov) {
      return ov.off
        ? { kind: "off", reason: "off" }
        : { kind: "work", start: ov.start!, end: ov.end! };
    }
    const s = shiftsMap[userId]?.[fromYmd(ymd).getUTCDay()];
    return s ? { kind: "work", start: s.start, end: s.end } : null;
  };

  const memberOptions = members.map((m) => ({
    id: m.id,
    name: m.full_name || m.email,
  }));
  const toggleCls = (active: boolean) =>
    cn(
      "rounded px-3 py-1 text-sm font-medium transition-colors",
      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title="Team Schedule"
          description="Everyone's working hours and days off in one place. Request a day off — it's approved automatically unless it clashes with someone already off."
        >
          <AddDayOff isManager={isManager} members={memberOptions} />
        </PageHeader>
      </div>

      {/* Approval queue — managers only */}
      {isManager && pending.length > 0 ? (
        <Card className="mb-6 border-amber-300 dark:border-amber-900 print:hidden">
          <CardContent className="pt-6">
            <div className="mb-3 flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-400">
              <BellRing className="size-4" /> Needs your approval ({pending.length})
            </div>
            <ul className="divide-y">
              {pending.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium">{nameOf(t.user_id)}</span>
                    <span className="text-muted-foreground">
                      {" "}— {KIND_LABEL[t.kind] ?? "Off"} ·{" "}
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="inline-flex rounded-md border p-0.5">
          <Link href="/team?view=day" className={toggleCls(view === "day")}>Day</Link>
          <Link href="/team" className={toggleCls(view === "week")}>Week</Link>
          <Link href="/team?view=month" className={toggleCls(view === "month")}>Month</Link>
        </div>
        <div className="flex items-center gap-2">
          {view === "month" ? <PrintButton /> : null}
          <Link href={prevHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ChevronLeft className="size-4" /> Prev
          </Link>
          <div className="min-w-40 text-center text-sm font-semibold">
            {periodLabel}
            {rangeStart <= todayYmd && todayYmd <= rangeEnd ? null : (
              <Link
                href={view === "day" ? "/team?view=day" : view === "month" ? "/team?view=month" : "/team"}
                className="ml-2 text-xs font-normal text-muted-foreground underline hover:text-foreground"
              >
                Today
              </Link>
            )}
          </div>
          <Link href={nextHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Next <ChevronRight className="size-4" />
          </Link>
        </div>
      </div>

      {/* ---- DAY: one column, who's on and who's off ---- */}
      {view === "day" ? (
        <div className="overflow-hidden rounded-lg border">
          {members.map((m, i) => {
            const c = cellFor(m.id, gridDays[0]);
            return (
              <div
                key={m.id}
                className={cn(
                  "flex items-center justify-between gap-3 px-3 py-2.5",
                  i > 0 && "border-t",
                )}
              >
                <div className="min-w-0">
                  <div className="font-medium">{m.full_name || m.email}</div>
                  <div className="text-xs text-muted-foreground">{ROLE_LABELS[m.role]}</div>
                </div>
                {c?.kind === "work" ? (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                    {to12(c.start)} – {to12(c.end)}
                  </span>
                ) : c?.kind === "off" ? (
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    {KIND_LABEL[c.reason] ?? "Off"}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">Not scheduled</span>
                )}
              </div>
            );
          })}
        </div>
      ) : view === "week" ? (
        /* ---- WEEK: employees × 7 days grid (managers edit in place) ---- */
        <>
          {isManager ? (
            <p className="mb-2 text-sm text-muted-foreground">
              Click any day to change that person&apos;s hours — it saves right
              away.
            </p>
          ) : null}
          <ShiftGrid
            members={gridMembers}
            columns={weekColumns}
            shifts={shiftsMap}
            overrides={overridesMap}
            off={offObj}
            editable={isManager}
            showTotals={isManager}
          />
        </>
      ) : (
        /* ---- MONTH: a real wall calendar, and it prints cleanly ---- */
        <div>
          {/* Title shows only on the printout */}
          <div className="mb-3 hidden text-center print:block">
            <div className="text-lg font-bold">{COMPANY_NAME} — Team Schedule</div>
            <div className="text-sm">{periodLabel}</div>
          </div>

          <div className="overflow-hidden rounded-lg border">
            <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-semibold text-muted-foreground print:bg-transparent">
              {WEEK_HEAD.map((d) => (
                <div key={d} className="py-1.5">{d}</div>
              ))}
            </div>
            {Array.from({ length: gridDays.length / 7 }, (_, w) =>
              gridDays.slice(w * 7, w * 7 + 7),
            ).map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 break-inside-avoid">
                {week.map((d) => {
                  const inMonth = d.slice(0, 7) === monthKey;
                  const isToday = d === todayYmd;
                  return (
                    <div
                      key={d}
                      className={cn(
                        "min-h-[96px] border-b border-r p-1 text-[11px] leading-tight [&:nth-child(7n)]:border-r-0",
                        !inMonth && "bg-muted/20 text-muted-foreground print:bg-transparent",
                        isToday && "bg-primary/5",
                      )}
                    >
                      <div className={cn("mb-0.5 text-right font-semibold", isToday && "text-primary")}>
                        {Number(d.slice(8, 10))}
                      </div>
                      <div className="space-y-0.5">
                        {members.map((m) => {
                          const c = cellFor(m.id, d);
                          if (c?.kind !== "work") return null;
                          return (
                            <div key={m.id} className="truncate text-emerald-700 dark:text-emerald-400">
                              {(m.full_name || m.email).split(" ")[0]}{" "}
                              <span className="text-muted-foreground">
                                {compact(c.start)}–{compact(c.end)}
                              </span>
                            </div>
                          );
                        })}
                        {members.map((m) => {
                          const c = cellFor(m.id, d);
                          if (c?.kind !== "off") return null;
                          return (
                            <div key={m.id} className="truncate text-amber-700 dark:text-amber-400">
                              {(m.full_name || m.email).split(" ")[0]} · {KIND_LABEL[c.reason] ?? "Off"}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground print:hidden">
            <span className="text-emerald-700 dark:text-emerald-400">Name 9a–5p = working hours</span>
            <span className="text-amber-700 dark:text-amber-400">Name · Off = time off</span>
          </div>
        </div>
      )}

      {/* Upcoming days off */}
      <Card className="mt-6 print:hidden">
        <CardContent className="pt-6">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <CalendarOff className="size-4 text-muted-foreground" /> Upcoming days off
          </div>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">No approved days off in the next 45 days.</p>
          ) : (
            <ul className="divide-y">
              {upcoming.map((t) => {
                const canRemove = isManager || t.user_id === profile.id;
                return (
                  <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{nameOf(t.user_id)}</span>
                      <span className="text-muted-foreground">
                        {" "}— {KIND_LABEL[t.kind] ?? "Off"}{t.note ? ` · ${t.note}` : ""}
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

    </div>
  );
}
