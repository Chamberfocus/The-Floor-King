"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { to12, parseLocalDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { rescheduleInstall } from "@/app/(app)/jobs/actions";
import type { CalEvent, CalResource } from "./installer-calendar";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const startOfWeek = (d: Date) => addDays(d, -d.getDay());
const hueOf = (id: string) => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
};
const windowLabel = (w: string | null) =>
  w ? w.split("-").map((t) => to12(t.trim())).join("–") : null;

const RANGES: { label: string; days: number }[] = [
  { label: "Week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "4 weeks", days: 28 },
];

/**
 * Installer-centric schedule grid: installers down the left, dates across the
 * top, each customer's install in the [installer × date] cell. Week-at-a-time by
 * default with 2/4-week and custom ranges. Drag a job to a different cell to
 * move its date AND/OR reassign it to that installer — the customer and
 * installer are notified automatically.
 */
export function InstallerGrid({
  events,
  resources,
  canEdit = false,
}: {
  events: CalEvent[];
  resources: CalResource[];
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [start, setStart] = useState<Date>(() => startOfWeek(new Date()));
  const [days, setDays] = useState(7);
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filter, setFilter] = useState("all");
  const [dragOver, setDragOver] = useState<string | null>(null);

  const cols = useMemo(
    () => Array.from({ length: days }, (_, i) => addDays(start, i)),
    [start, days],
  );
  const rows = filter === "all" ? resources : resources.filter((r) => r.id === filter);
  const todayK = ymd(new Date());

  const cellEvents = (resId: string, day: Date) => {
    const k = ymd(day);
    return events
      .filter((e) => {
        if (e.resourceId !== resId) return false;
        const end = e.endDate && e.endDate >= e.date ? e.endDate : e.date;
        return e.date <= k && end >= k;
      })
      .sort((a, b) => (a.window || "99").localeCompare(b.window || "99"));
  };

  const move = (jobId: string, day: Date, resId: string) =>
    startTransition(async () => {
      const res = await rescheduleInstall(jobId, ymd(day), resId);
      if (res.ok) {
        toast.success("Moved — customer & installer notified.");
        router.refresh();
      } else {
        toast.error(res.error || "Couldn't move that install.");
      }
    });

  const shift = (dir: number) => setStart((s) => addDays(s, dir * days));
  const pickRange = (n: number) => {
    setCustom(false);
    setDays(n);
    setStart((s) => (n === 7 ? startOfWeek(s) : s));
  };
  const applyCustom = () => {
    if (!from || !to) return;
    const s = parseLocalDate(from);
    const e = parseLocalDate(to);
    const n = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
    if (n < 1) return;
    setStart(s);
    setDays(Math.min(n, 92));
  };

  const rangeLabel = `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${addDays(
    start,
    days - 1,
  ).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        {/* Toolbar */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" onClick={() => shift(-1)} aria-label="Previous">
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCustom(false);
                setStart(days === 7 ? startOfWeek(new Date()) : new Date());
              }}
            >
              Today
            </Button>
            <Button variant="outline" size="icon-sm" onClick={() => shift(1)} aria-label="Next">
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <span className="text-sm font-semibold">{rangeLabel}</span>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {resources.length > 1 ? (
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Filter installer"
                className="h-8 max-w-44 rounded-md border border-input bg-transparent px-2 text-sm"
              >
                <option value="all">All installers</option>
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            ) : null}
            <div className="inline-flex overflow-hidden rounded-md border">
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  type="button"
                  onClick={() => pickRange(r.days)}
                  className={cn(
                    "px-2.5 py-1.5 text-xs font-medium transition-colors",
                    !custom && days === r.days
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  {r.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCustom((v) => !v)}
                className={cn(
                  "px-2.5 py-1.5 text-xs font-medium transition-colors",
                  custom ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                Custom
              </button>
            </div>
          </div>
        </div>

        {custom ? (
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-2">
            <label className="text-xs text-muted-foreground">
              From
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="ml-1 h-8 rounded-md border border-input bg-transparent px-2 text-sm"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              To
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="ml-1 h-8 rounded-md border border-input bg-transparent px-2 text-sm"
              />
            </label>
            <Button size="sm" onClick={applyCustom} disabled={!from || !to}>
              Apply
            </Button>
          </div>
        ) : null}

        {/* Grid */}
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No installers yet. Add team installers or crews to see the grid.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div
              className="grid text-sm"
              style={{
                gridTemplateColumns: `minmax(120px,150px) repeat(${days}, minmax(116px,1fr))`,
              }}
            >
              {/* Header row */}
              <div className="sticky left-0 z-20 flex items-center gap-1 border-b border-r bg-muted px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                <Users className="size-3.5" /> Installer
              </div>
              {cols.map((d) => {
                const k = ymd(d);
                return (
                  <div
                    key={k}
                    className={cn(
                      "border-b border-r px-1 py-1.5 text-center text-xs font-medium",
                      k === todayK ? "bg-primary/10 text-primary" : "bg-muted/40 text-muted-foreground",
                    )}
                  >
                    <div>{DOW[d.getDay()]}</div>
                    <div className="text-foreground">
                      {d.getMonth() + 1}/{d.getDate()}
                    </div>
                  </div>
                );
              })}

              {/* Body rows */}
              {rows.map((r) => {
                const hue = hueOf(r.id);
                return (
                  <div key={r.id} className="contents">
                    <div
                      className="sticky left-0 z-10 flex items-center border-b border-r bg-card px-2 py-1.5"
                      style={{ borderLeft: `3px solid hsl(${hue} 60% 48%)` }}
                    >
                      <span className="truncate text-xs font-semibold">{r.name}</span>
                    </div>
                    {cols.map((d) => {
                      const k = ymd(d);
                      const cellKey = `${r.id}|${k}`;
                      const evs = cellEvents(r.id, d);
                      return (
                        <div
                          key={cellKey}
                          onDragOver={
                            canEdit
                              ? (ev) => {
                                  ev.preventDefault();
                                  setDragOver(cellKey);
                                }
                              : undefined
                          }
                          onDragLeave={canEdit ? () => setDragOver(null) : undefined}
                          onDrop={
                            canEdit
                              ? (ev) => {
                                  ev.preventDefault();
                                  const id = ev.dataTransfer.getData("text/plain");
                                  setDragOver(null);
                                  if (id) move(id, d, r.id);
                                }
                              : undefined
                          }
                          className={cn(
                            "min-h-14 space-y-0.5 border-b border-r p-1 align-top",
                            k === todayK && "bg-primary/5",
                            dragOver === cellKey && "ring-2 ring-inset ring-primary",
                          )}
                        >
                          {evs.map((e) => {
                            const wl = windowLabel(e.window);
                            return (
                              <Link
                                key={e.id}
                                href={e.customerId ? `/customers/${e.customerId}#jobs` : "#"}
                                draggable={canEdit}
                                onDragStart={
                                  canEdit
                                    ? (dev) => {
                                        dev.dataTransfer.setData("text/plain", e.id);
                                        dev.dataTransfer.effectAllowed = "move";
                                      }
                                    : undefined
                                }
                                style={{
                                  background: `hsl(${hue} 65% 50% / 0.16)`,
                                  borderLeft: `3px solid hsl(${hue} 60% 48%)`,
                                }}
                                className={cn(
                                  "block rounded px-1 py-0.5 leading-tight hover:brightness-95 dark:hover:brightness-125",
                                  canEdit && "cursor-move",
                                )}
                                title={`${e.name}${wl ? ` · ${wl}` : ""}${e.city ? ` · ${e.city}` : ""}`}
                              >
                                <div className="truncate text-xs font-medium text-foreground">
                                  {e.name}
                                </div>
                                {wl ? (
                                  <div className="truncate text-[10px] text-muted-foreground">
                                    {wl}
                                  </div>
                                ) : null}
                              </Link>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {canEdit ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Drag a job to another cell to change its date or move it to a
            different installer — the customer and installer are notified.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
