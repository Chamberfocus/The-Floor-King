"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CalendarDays, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { to12 } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface CalEvent {
  id: string;
  name: string;
  customerId: string | null;
  date: string; // YYYY-MM-DD start
  endDate: string | null; // YYYY-MM-DD end (inclusive)
  window: string | null; // "HH:MM-HH:MM"
  resourceId: string;
  resourceName: string;
  city: string | null;
  status: string | null;
}
export interface CalResource {
  id: string;
  name: string;
}

type View = "month" | "week" | "day";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const addMonths = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  return x;
};
const startOfWeek = (d: Date) => addDays(d, -d.getDay()); // Sunday
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Stable hue per installer/crew so each has a consistent color. */
const hueOf = (id: string) => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
};
const windowLabel = (w: string | null) =>
  w ? w.split("-").map((t) => to12(t.trim())).join("–") : null;

export function InstallerCalendar({
  events,
  resources,
}: {
  events: CalEvent[];
  resources: CalResource[];
}) {
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [filter, setFilter] = useState<string>("all");

  const shown = useMemo(
    () => (filter === "all" ? events : events.filter((e) => e.resourceId === filter)),
    [events, filter],
  );

  // Events overlapping a given day (multi-day jobs show on each covered day).
  const onDay = (day: Date) => {
    const k = ymd(day);
    return shown
      .filter((e) => e.date <= k && (e.endDate || e.date) >= k)
      .sort((a, b) => (a.window || "99").localeCompare(b.window || "99"));
  };

  const move = (dir: number) =>
    setAnchor((a) =>
      view === "month" ? addMonths(a, dir) : addDays(a, dir * (view === "week" ? 7 : 1)),
    );

  const label =
    view === "month"
      ? anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : view === "week"
        ? (() => {
            const s = startOfWeek(anchor);
            const e = addDays(s, 6);
            const opt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
            return `${s.toLocaleDateString("en-US", opt)} – ${e.toLocaleDateString("en-US", { ...opt, year: "numeric" })}`;
          })()
        : anchor.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          });

  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        {/* Toolbar */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" onClick={() => move(-1)} aria-label="Previous">
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>
              Today
            </Button>
            <Button variant="outline" size="icon-sm" onClick={() => move(1)} aria-label="Next">
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <CalendarDays className="size-4 text-primary" /> {label}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Installer filter */}
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter by installer"
              className="h-8 max-w-44 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              <option value="all">All installers</option>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            {/* View toggle */}
            <div className="inline-flex overflow-hidden rounded-md border">
              {(["day", "week", "month"] as View[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn(
                    "px-2.5 py-1.5 text-xs font-medium capitalize transition-colors",
                    view === v ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {view === "month" ? (
          <MonthView anchor={anchor} onDay={onDay} filter={filter} />
        ) : view === "week" ? (
          <WeekView anchor={anchor} onDay={onDay} filter={filter} />
        ) : (
          <DayView anchor={anchor} onDay={onDay} filter={filter} />
        )}

        {events.length === 0 ? (
          <p className="mt-3 text-center text-sm text-muted-foreground">
            No installs booked yet. Schedule one below and it&apos;ll show here.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Chip({ e, showInstaller }: { e: CalEvent; showInstaller: boolean }) {
  const hue = hueOf(e.resourceId);
  const wl = windowLabel(e.window);
  return (
    <Link
      href={e.customerId ? `/customers/${e.customerId}#jobs` : "#"}
      style={{
        background: `hsl(${hue} 65% 50% / 0.14)`,
        borderLeft: `3px solid hsl(${hue} 60% 48%)`,
      }}
      className="block rounded px-1.5 py-1 text-left leading-tight hover:brightness-95 dark:hover:brightness-125"
      title={`${e.name}${wl ? ` · ${wl}` : ""}${e.city ? ` · ${e.city}` : ""} — ${e.resourceName}`}
    >
      <div className="truncate text-xs font-medium text-foreground">{e.name}</div>
      {wl ? <div className="truncate text-[10px] text-muted-foreground">{wl}</div> : null}
      {showInstaller ? (
        <div
          className="truncate text-[10px] font-medium"
          style={{ color: `hsl(${hue} 55% 45%)` }}
        >
          {e.resourceName}
        </div>
      ) : null}
    </Link>
  );
}

function MonthView({
  anchor,
  onDay,
  filter,
}: {
  anchor: Date;
  onDay: (d: Date) => CalEvent[];
  filter: string;
}) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const todayK = ymd(new Date());
  const month = anchor.getMonth();
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="grid grid-cols-7 border-b text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {DOW.map((d) => (
            <div key={d} className="py-1.5">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            const k = ymd(day);
            const evs = onDay(day);
            const inMonth = day.getMonth() === month;
            return (
              <div
                key={i}
                className={cn(
                  "min-h-24 border-b border-r p-1 align-top",
                  i % 7 === 0 && "border-l",
                  !inMonth && "bg-muted/30",
                )}
              >
                <div
                  className={cn(
                    "mb-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[11px]",
                    k === todayK
                      ? "bg-primary font-semibold text-primary-foreground"
                      : inMonth
                        ? "text-foreground"
                        : "text-muted-foreground",
                  )}
                >
                  {day.getDate()}
                </div>
                <div className="space-y-0.5">
                  {evs.slice(0, 3).map((e) => (
                    <Chip key={e.id} e={e} showInstaller={filter === "all"} />
                  ))}
                  {evs.length > 3 ? (
                    <div className="px-1 text-[10px] text-muted-foreground">
                      +{evs.length - 3} more
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function WeekView({
  anchor,
  onDay,
  filter,
}: {
  anchor: Date;
  onDay: (d: Date) => CalEvent[];
  filter: string;
}) {
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const todayK = ymd(new Date());
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[640px] grid-cols-7 gap-1">
        {days.map((day, i) => {
          const k = ymd(day);
          const evs = onDay(day);
          return (
            <div key={i} className="rounded-md border">
              <div
                className={cn(
                  "border-b px-2 py-1 text-center text-xs font-medium",
                  k === todayK ? "bg-primary/10 text-primary" : "text-muted-foreground",
                )}
              >
                {DOW[day.getDay()]}{" "}
                <span className="text-foreground">{day.getDate()}</span>
              </div>
              <div className="min-h-32 space-y-1 p-1">
                {evs.map((e) => (
                  <Chip key={e.id} e={e} showInstaller={filter === "all"} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayView({
  anchor,
  onDay,
  filter,
}: {
  anchor: Date;
  onDay: (d: Date) => CalEvent[];
  filter: string;
}) {
  const evs = onDay(anchor);
  if (!evs.length)
    return (
      <p className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
        No installs on this day.
      </p>
    );
  return (
    <div className="space-y-1.5">
      {evs.map((e) => {
        const hue = hueOf(e.resourceId);
        const wl = windowLabel(e.window);
        return (
          <Link
            key={e.id}
            href={e.customerId ? `/customers/${e.customerId}#jobs` : "#"}
            style={{ borderLeft: `4px solid hsl(${hue} 60% 48%)` }}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 hover:bg-muted/50"
          >
            <div className="min-w-0">
              <div className="truncate font-medium">{e.name}</div>
              <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                {wl ? <span>{wl}</span> : <span>No window set</span>}
                {e.city ? (
                  <span className="inline-flex items-center gap-0.5">
                    <MapPin className="size-3" /> {e.city}
                  </span>
                ) : null}
              </div>
            </div>
            {filter === "all" ? (
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
                style={{
                  background: `hsl(${hue} 65% 50% / 0.16)`,
                  color: `hsl(${hue} 55% 42%)`,
                }}
              >
                {e.resourceName}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
