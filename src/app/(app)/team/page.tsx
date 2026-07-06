import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CalendarOff, Users, BellRing } from "lucide-react";
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
import { ShiftGrid } from "./shift-grid";

export const metadata: Metadata = { title: "Team Schedule" };

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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
/** Compact time: "9:00 AM" → "9a", "9:30 AM" → "9:30a". */
function compact(hm: string): string {
  return to12(hm).replace(":00 ", " ").replace(" AM", "a").replace(" PM", "p");
}
function mondayOf(ymd: string): string {
  return addDaysYmd(ymd, -((fromYmd(ymd).getUTCDay() + 6) % 7));
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
    const [yy, mm] = monthParam.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    rangeStart = `${monthParam}-01`;
    rangeEnd = `${monthParam}-${String(daysInMonth).padStart(2, "0")}`;
    gridDays = Array.from({ length: daysInMonth }, (_, i) =>
      addDaysYmd(rangeStart, i),
    );
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

  // What a person is doing on a date: a shift, off (with reason), or nothing.
  type Cell =
    | { kind: "work"; start: string; end: string }
    | { kind: "off"; reason: string }
    | null;
  const cellFor = (userId: string, ymd: string): Cell => {
    const off = offByDay.get(ymd)?.get(userId);
    if (off) return { kind: "off", reason: off };
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
      <PageHeader
        title="Team Schedule"
        description="Everyone's working hours and days off in one place. Request a day off — it's approved automatically unless it clashes with someone already off."
      >
        <AddDayOff isManager={isManager} members={memberOptions} />
      </PageHeader>

      {/* Approval queue — managers only */}
      {isManager && pending.length > 0 ? (
        <Card className="mb-6 border-amber-300 dark:border-amber-900">
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border p-0.5">
          <Link href="/team?view=day" className={toggleCls(view === "day")}>Day</Link>
          <Link href="/team" className={toggleCls(view === "week")}>Week</Link>
          <Link href="/team?view=month" className={toggleCls(view === "month")}>Month</Link>
        </div>
        <div className="flex items-center gap-2">
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
        /* ---- WEEK: employees × 7 days grid ---- */
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/40">
                <th className="sticky left-0 z-10 min-w-32 bg-muted/40 px-3 py-2 text-left font-semibold">Employee</th>
                {gridDays.map((d) => (
                  <th
                    key={d}
                    className={cn(
                      "min-w-20 px-2 py-2 text-center font-semibold",
                      d === todayYmd ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    <div>{DOW[fromYmd(d).getUTCDay()]}</div>
                    <div className="text-xs font-normal">{mdLabel(d)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="sticky left-0 z-10 min-w-32 bg-background px-3 py-2">
                    <div className="font-medium">{m.full_name || m.email}</div>
                    <div className="text-xs text-muted-foreground">{ROLE_LABELS[m.role]}</div>
                  </td>
                  {gridDays.map((d) => {
                    const c = cellFor(m.id, d);
                    return (
                      <td
                        key={d}
                        className={cn(
                          "px-1.5 py-2 text-center align-middle text-xs",
                          d === todayYmd && "bg-primary/5",
                        )}
                      >
                        {c?.kind === "work" ? (
                          <span className="font-medium text-emerald-700 dark:text-emerald-300">
                            {compact(c.start)}–{compact(c.end)}
                          </span>
                        ) : c?.kind === "off" ? (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                            {KIND_LABEL[c.reason] ?? "Off"}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* ---- MONTH: employees × days heat grid ---- */
        <div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="border-collapse text-xs">
              <thead>
                <tr className="bg-muted/40">
                  <th className="sticky left-0 z-10 min-w-28 bg-muted/40 px-3 py-2 text-left font-semibold">Employee</th>
                  {gridDays.map((d) => {
                    const wd = fromYmd(d).getUTCDay();
                    const weekend = wd === 0 || wd === 6;
                    return (
                      <th
                        key={d}
                        className={cn(
                          "w-8 min-w-8 px-0 py-1 text-center font-medium",
                          weekend && "bg-muted/60",
                          d === todayYmd ? "text-primary" : "text-muted-foreground",
                        )}
                      >
                        <div className="text-[10px]">{DOW[wd][0]}</div>
                        <div>{Number(d.slice(8, 10))}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-t">
                    <td className="sticky left-0 z-10 min-w-28 bg-background px-3 py-1.5 font-medium">
                      {m.full_name || m.email}
                    </td>
                    {gridDays.map((d) => {
                      const c = cellFor(m.id, d);
                      return (
                        <td key={d} className="p-0.5 text-center">
                          <div
                            title={
                              c?.kind === "work"
                                ? `${to12(c.start)}–${to12(c.end)}`
                                : c?.kind === "off"
                                  ? KIND_LABEL[c.reason] ?? "Off"
                                  : "Not scheduled"
                            }
                            className={cn(
                              "mx-auto flex h-6 w-6 items-center justify-center rounded",
                              c?.kind === "work" && "bg-emerald-200/70 dark:bg-emerald-800/50",
                              c?.kind === "off" && "bg-amber-200/80 text-amber-900 dark:bg-amber-800/50 dark:text-amber-200",
                              !c && "bg-muted/40",
                              d === todayYmd && "ring-2 ring-primary",
                            )}
                          >
                            {c?.kind === "off" ? "×" : ""}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded bg-emerald-200/70 dark:bg-emerald-800/50" /> Working
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded bg-amber-200/80 dark:bg-amber-800/50" /> Off
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded bg-muted/40" /> Not scheduled
            </span>
          </div>
        </div>
      )}

      {/* Upcoming days off */}
      <Card className="mt-6">
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

      {/* Weekly schedule editor — office/admin only */}
      {isManager ? (
        <Card className="mt-6">
          <CardContent className="pt-6">
            <div className="mb-1 flex items-center gap-2 font-semibold">
              <Users className="size-4 text-muted-foreground" /> Set weekly hours
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              The schedule everyone works to. Click a day to set that person&apos;s
              hours — changes save instantly and show up in the views above.
            </p>
            <ShiftGrid
              members={members.map((m) => ({
                id: m.id,
                name: m.full_name || m.email,
                roleLabel: ROLE_LABELS[m.role],
              }))}
              shifts={shiftsMap}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
