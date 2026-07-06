"use client";

import { useState, useTransition } from "react";
import { X, Copy, Calendar, RotateCcw, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { to12 } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { applyShift, clearDayOverride } from "./actions";

type Shift = { start: string; end: string };
type Shifts = Record<string, Record<number, Shift>>;
type Override = { off: boolean; start?: string; end?: string };
type Overrides = Record<string, Record<string, Override>>;

interface Member {
  id: string;
  name: string;
  roleLabel: string;
}
export interface GridColumn {
  weekday: number;
  top: string;
  bottom: string;
  ymd: string;
  isToday: boolean;
}

const WEEKDAYS = [1, 2, 3, 4, 5];
const PRESETS = [
  { label: "8–4", start: "08:00", end: "16:00" },
  { label: "9–5", start: "09:00", end: "17:00" },
  { label: "10–6", start: "10:00", end: "18:00" },
];
const DAY_NAME: Record<number, string> = {
  0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday",
  4: "Thursday", 5: "Friday", 6: "Saturday",
};
const KIND_LABEL: Record<string, string> = {
  off: "Off", vacation: "Vacation", sick: "Sick", personal: "Personal",
};

function compact(hm: string): string {
  return to12(hm).replace(":00 ", " ").replace(" AM", "a").replace(" PM", "p");
}

export function ShiftGrid({
  members,
  columns,
  shifts: initialShifts,
  overrides: initialOverrides,
  off,
  editable,
  showTotals = false,
}: {
  members: Member[];
  columns: GridColumn[];
  shifts: Shifts;
  overrides: Overrides;
  /** userId -> (ymd -> kind) for approved time off. */
  off: Record<string, Record<string, string>>;
  editable: boolean;
  /** Show a private weekly-hours tally column (managers only). */
  showTotals?: boolean;
}) {
  const [shifts, setShifts] = useState<Shifts>(initialShifts);
  const [overrides, setOverrides] = useState<Overrides>(initialOverrides);
  const [sel, setSel] = useState<{ userId: string; col: GridColumn } | null>(
    null,
  );
  const [mode, setMode] = useState<"date" | "series">("date");
  const [, start] = useTransition();

  // Effective schedule for a person on a column's date.
  const effective = (
    userId: string,
    col: GridColumn,
  ):
    | { type: "timeoff"; reason: string }
    | { type: "work"; start: string; end: string; override: boolean }
    | { type: "off"; override: boolean }
    | { type: "none" } => {
    const timeoff = off[userId]?.[col.ymd];
    if (timeoff) return { type: "timeoff", reason: timeoff };
    const ov = overrides[userId]?.[col.ymd];
    if (ov) {
      return ov.off
        ? { type: "off", override: true }
        : { type: "work", start: ov.start!, end: ov.end!, override: true };
    }
    const s = shifts[userId]?.[col.weekday];
    return s
      ? { type: "work", start: s.start, end: s.end, override: false }
      : { type: "none" };
  };

  // Scheduled hours for one person across the visible week (off days = 0).
  const hoursBetween = (a: string, b: string) => {
    const [ah, am] = a.split(":").map(Number);
    const [bh, bm] = b.split(":").map(Number);
    const mins = bh * 60 + bm - (ah * 60 + am);
    return mins > 0 ? mins / 60 : 0;
  };
  const weeklyHours = (userId: string) =>
    columns.reduce((sum, c) => {
      const e = effective(userId, c);
      return e.type === "work" ? sum + hoursBetween(e.start, e.end) : sum;
    }, 0);
  const fmtHours = (n: number) =>
    n === 0 ? "—" : n.toFixed(2).replace(/\.?0+$/, "");
  const teamHours = showTotals
    ? members.reduce((s, m) => s + weeklyHours(m.id), 0)
    : 0;

  const open = (userId: string, col: GridColumn) => {
    setSel({ userId, col });
    setMode("date"); // default to changing just this day
  };

  // Push a change to the server and mirror it locally for an instant update.
  const apply = (off_: boolean, s?: Shift) => {
    if (!sel) return;
    const { userId, col } = sel;
    start(async () => {
      await applyShift({
        userId,
        mode,
        date: col.ymd,
        weekday: col.weekday,
        start: s?.start ?? null,
        end: s?.end ?? null,
        off: off_,
      });
    });
    if (mode === "series") {
      setShifts((p) => {
        const u = { ...(p[userId] ?? {}) };
        if (off_) delete u[col.weekday];
        else if (s) u[col.weekday] = s;
        return { ...p, [userId]: u };
      });
      setOverrides((p) => {
        const u = { ...(p[userId] ?? {}) };
        delete u[col.ymd];
        return { ...p, [userId]: u };
      });
    } else {
      setOverrides((p) => {
        const u = { ...(p[userId] ?? {}) };
        u[col.ymd] = off_ ? { off: true } : { off: false, ...s! };
        return { ...p, [userId]: u };
      });
    }
  };

  const revert = () => {
    if (!sel) return;
    const { userId, col } = sel;
    start(async () => {
      await clearDayOverride(userId, col.ymd);
    });
    setOverrides((p) => {
      const u = { ...(p[userId] ?? {}) };
      delete u[col.ymd];
      return { ...p, [userId]: u };
    });
  };

  // Copy a shift onto several weekdays of the recurring template at once.
  const writeSeries = (userId: string, date: string, weekday: number, s: Shift) => {
    start(async () => {
      await applyShift({
        userId,
        mode: "series",
        date,
        weekday,
        start: s.start,
        end: s.end,
        off: false,
      });
    });
    setShifts((p) => ({
      ...p,
      [userId]: { ...(p[userId] ?? {}), [weekday]: s },
    }));
  };

  const selMember = sel ? members.find((m) => m.id === sel.userId) : null;
  const selOverride = sel
    ? overrides[sel.userId]?.[sel.col.ymd]
    : undefined;
  // Time controls start from the value the chosen mode is editing.
  const seriesShift = sel ? shifts[sel.userId]?.[sel.col.weekday] : undefined;
  const base: Shift =
    mode === "date"
      ? selOverride && !selOverride.off
        ? { start: selOverride.start!, end: selOverride.end! }
        : (seriesShift ?? { start: "09:00", end: "17:00" })
      : (seriesShift ?? { start: "09:00", end: "17:00" });

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/40">
              <th className="sticky left-0 z-10 min-w-32 bg-muted/40 px-3 py-2 text-left font-semibold">
                Employee
              </th>
              {columns.map((c) => (
                <th
                  key={c.ymd}
                  className={cn(
                    "min-w-20 px-2 py-2 text-center font-semibold",
                    c.isToday ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <div>{c.top}</div>
                  <div className="text-xs font-normal">{c.bottom}</div>
                </th>
              ))}
              {showTotals ? (
                <th className="sticky right-0 z-10 min-w-16 bg-muted/40 px-2 py-2 text-right font-semibold">
                  <div className="flex items-center justify-end gap-1">
                    <Lock className="size-3 text-muted-foreground" /> Hrs
                  </div>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="sticky left-0 z-10 min-w-32 bg-background px-3 py-2">
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.roleLabel}
                  </div>
                </td>
                {columns.map((c) => {
                  const e = effective(m.id, c);
                  const active =
                    sel?.userId === m.id && sel?.col.ymd === c.ymd;
                  const tdCls = cn(
                    "p-1 text-center align-middle text-xs",
                    c.isToday && "bg-primary/5",
                  );

                  // Approved time off: shown, not edited here.
                  if (e.type === "timeoff") {
                    return (
                      <td key={c.ymd} className={tdCls}>
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          {KIND_LABEL[e.reason] ?? "Off"}
                        </span>
                      </td>
                    );
                  }

                  const inner =
                    e.type === "work" ? (
                      <span className="relative font-medium text-emerald-700 dark:text-emerald-300">
                        {compact(e.start)}–{compact(e.end)}
                        {e.override ? (
                          <span className="absolute -right-2 -top-1 size-1.5 rounded-full bg-primary" />
                        ) : null}
                      </span>
                    ) : e.type === "off" ? (
                      <span className="text-muted-foreground">Off*</span>
                    ) : (
                      <span className="text-muted-foreground">
                        {editable ? "Off" : "·"}
                      </span>
                    );

                  return (
                    <td key={c.ymd} className={tdCls}>
                      {editable ? (
                        <button
                          type="button"
                          onClick={() => open(m.id, c)}
                          className={cn(
                            "w-full rounded-md px-1.5 py-2 transition-colors hover:bg-muted",
                            e.type === "work" &&
                              "bg-emerald-50/60 dark:bg-emerald-950/30",
                            active && "ring-2 ring-primary",
                          )}
                        >
                          {inner}
                        </button>
                      ) : (
                        <div className="px-1.5 py-2">{inner}</div>
                      )}
                    </td>
                  );
                })}
                {showTotals ? (
                  <td className="sticky right-0 z-10 bg-background px-2 py-2 text-right font-semibold tabular-nums">
                    {fmtHours(weeklyHours(m.id))}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
          {showTotals ? (
            <tfoot>
              <tr className="border-t bg-muted/30">
                <td className="sticky left-0 z-10 bg-muted/30 px-3 py-2 font-semibold">
                  Team total
                </td>
                <td colSpan={columns.length} />
                <td className="sticky right-0 z-10 bg-muted/30 px-2 py-2 text-right font-bold tabular-nums">
                  {fmtHours(teamHours)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {showTotals ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="size-3" /> Scheduled hours this week — only managers
          see this column.
        </p>
      ) : null}

      {editable ? (
        sel && selMember ? (
          <div className="mt-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 font-medium">
                <Calendar className="size-4 text-primary" />
                {selMember.name} · {DAY_NAME[sel.col.weekday]} {sel.col.bottom}
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setSel(null)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* This day only vs the whole recurring series */}
            <div className="mb-3 inline-flex rounded-md border p-0.5 text-sm">
              <button
                type="button"
                onClick={() => setMode("date")}
                className={cn(
                  "rounded px-3 py-1 font-medium transition-colors",
                  mode === "date"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Just this day
              </button>
              <button
                type="button"
                onClick={() => setMode("series")}
                className={cn(
                  "rounded px-3 py-1 font-medium transition-colors",
                  mode === "series"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Every {DAY_NAME[sel.col.weekday]}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => apply(false, { start: p.start, end: p.end })}
                  className="rounded-md border border-input px-2.5 py-1.5 text-sm font-medium hover:bg-muted"
                >
                  {p.label}
                </button>
              ))}
              <span className="mx-1 h-6 w-px bg-border" />
              <input
                type="time"
                value={base.start}
                onChange={(e) =>
                  apply(false, { start: e.target.value, end: base.end })
                }
                className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="text-sm text-muted-foreground">to</span>
              <input
                type="time"
                value={base.end}
                onChange={(e) =>
                  apply(false, { start: base.start, end: e.target.value })
                }
                className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => apply(true)}
              >
                Mark off
              </Button>
              {mode === "series" && seriesShift ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    for (const wd of WEEKDAYS)
                      writeSeries(sel.userId, sel.col.ymd, wd, {
                        start: seriesShift.start,
                        end: seriesShift.end,
                      });
                  }}
                >
                  <Copy className="size-4" /> Copy to Mon–Fri
                </Button>
              ) : null}
              {mode === "date" && selOverride ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={revert}
                >
                  <RotateCcw className="size-4" /> Use regular hours
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                className="ml-auto"
                onClick={() => setSel(null)}
              >
                Done
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {mode === "date"
                ? "Changes only this date. A dot marks days that differ from the regular schedule."
                : `Sets the regular hours for every ${DAY_NAME[sel.col.weekday]}.`}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Tap any day to set or change that person&apos;s hours — for just that
            day or every week.
          </p>
        )
      ) : null}
    </div>
  );
}
