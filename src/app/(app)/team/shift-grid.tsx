"use client";

import { useState, useTransition } from "react";
import { X, Copy, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { to12 } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { saveShift } from "./actions";

type Shift = { start: string; end: string };
type Shifts = Record<string, Record<number, Shift>>;

interface Member {
  id: string;
  name: string;
  roleLabel: string;
}

// Columns run Mon→Sun; weekday numbers stay 0=Sun..6=Sat.
const COLS = [
  { weekday: 1, label: "Mon" },
  { weekday: 2, label: "Tue" },
  { weekday: 3, label: "Wed" },
  { weekday: 4, label: "Thu" },
  { weekday: 5, label: "Fri" },
  { weekday: 6, label: "Sat" },
  { weekday: 0, label: "Sun" },
];
const WEEKDAYS = [1, 2, 3, 4, 5]; // Mon–Fri, for "copy to weekdays"
const PRESETS = [
  { label: "8–4", start: "08:00", end: "16:00" },
  { label: "9–5", start: "09:00", end: "17:00" },
  { label: "10–6", start: "10:00", end: "18:00" },
];
const DAY_NAME: Record<number, string> = {
  0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday",
  4: "Thursday", 5: "Friday", 6: "Saturday",
};

/** Compact time for a cell: "9:00 AM" → "9a", "9:30 AM" → "9:30a". */
function compact(hm: string): string {
  return to12(hm).replace(":00 ", " ").replace(" AM", "a").replace(" PM", "p");
}

/**
 * Whole-team weekly schedule grid — people down the side, days across the top.
 * Click any cell to set that person's hours for that day (industry-standard
 * layout). Managers only; changes save instantly.
 */
export function ShiftGrid({
  members,
  shifts: initial,
}: {
  members: Member[];
  shifts: Shifts;
}) {
  const [shifts, setShifts] = useState<Shifts>(initial);
  const [sel, setSel] = useState<{ userId: string; weekday: number } | null>(
    null,
  );
  const [, start] = useTransition();

  const shiftOf = (userId: string, weekday: number): Shift | undefined =>
    shifts[userId]?.[weekday];

  const write = (userId: string, weekday: number, s: Shift | null) => {
    setShifts((prev) => {
      const forUser = { ...(prev[userId] ?? {}) };
      if (s) forUser[weekday] = s;
      else delete forUser[weekday];
      return { ...prev, [userId]: forUser };
    });
    start(async () => {
      await saveShift(userId, weekday, s?.start ?? null, s?.end ?? null);
    });
  };

  const selMember = sel ? members.find((m) => m.id === sel.userId) : null;
  const selShift = sel ? shiftOf(sel.userId, sel.weekday) : undefined;
  const draft = selShift ?? { start: "09:00", end: "17:00" };

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/40">
              <th className="sticky left-0 z-10 min-w-32 bg-muted/40 px-3 py-2 text-left font-semibold">
                Employee
              </th>
              {COLS.map((c) => (
                <th
                  key={c.weekday}
                  className="min-w-20 px-2 py-2 text-center font-semibold text-muted-foreground"
                >
                  {c.label}
                </th>
              ))}
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
                {COLS.map((c) => {
                  const s = shiftOf(m.id, c.weekday);
                  const active =
                    sel?.userId === m.id && sel?.weekday === c.weekday;
                  return (
                    <td key={c.weekday} className="p-1 text-center align-middle">
                      <button
                        type="button"
                        onClick={() =>
                          setSel({ userId: m.id, weekday: c.weekday })
                        }
                        className={cn(
                          "w-full rounded-md px-1.5 py-2 text-xs transition-colors",
                          s
                            ? "bg-emerald-50 font-medium text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "text-muted-foreground hover:bg-muted",
                          active && "ring-2 ring-primary",
                        )}
                      >
                        {s ? `${compact(s.start)}–${compact(s.end)}` : "Off"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cell editor — appears below the grid so nothing gets clipped */}
      {sel && selMember ? (
        <div className="mt-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 font-medium">
              <Calendar className="size-4 text-primary" />
              {selMember.name} · {DAY_NAME[sel.weekday]}
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

          <div className="flex flex-wrap items-center gap-2">
            {/* Quick presets */}
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() =>
                  write(sel.userId, sel.weekday, {
                    start: p.start,
                    end: p.end,
                  })
                }
                className="rounded-md border border-input px-2.5 py-1.5 text-sm font-medium hover:bg-muted"
              >
                {p.label}
              </button>
            ))}

            <span className="mx-1 h-6 w-px bg-border" />

            {/* Custom times */}
            <input
              type="time"
              value={draft.start}
              onChange={(e) =>
                write(sel.userId, sel.weekday, {
                  start: e.target.value,
                  end: draft.end,
                })
              }
              className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <input
              type="time"
              value={draft.end}
              onChange={(e) =>
                write(sel.userId, sel.weekday, {
                  start: draft.start,
                  end: e.target.value,
                })
              }
              className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => write(sel.userId, sel.weekday, null)}
            >
              Mark off
            </Button>
            {selShift ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  for (const wd of WEEKDAYS)
                    write(sel.userId, wd, {
                      start: selShift.start,
                      end: selShift.end,
                    });
                }}
              >
                <Copy className="size-4" /> Copy to Mon–Fri
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
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          Tap any day to set or change that person&apos;s hours.
        </p>
      )}
    </div>
  );
}
