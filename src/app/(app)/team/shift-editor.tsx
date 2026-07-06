"use client";

import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { to12 } from "@/lib/format";
import { saveShift } from "./actions";

interface Row {
  weekday: number;
  label: string;
  on: boolean;
  start: string;
  end: string;
}

// Editor rows run Mon→Sun; weekday numbers stay 0=Sun..6=Sat.
const ORDER: { weekday: number; label: string }[] = [
  { weekday: 1, label: "Monday" },
  { weekday: 2, label: "Tuesday" },
  { weekday: 3, label: "Wednesday" },
  { weekday: 4, label: "Thursday" },
  { weekday: 5, label: "Friday" },
  { weekday: 6, label: "Saturday" },
  { weekday: 0, label: "Sunday" },
];
const ABBR: Record<number, string> = {
  0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat",
};

/** Per-person weekly hours template. Managers set the shift each weekday. */
export function ShiftEditor({
  userId,
  name,
  roleLabel,
  shifts,
}: {
  userId: string;
  name: string;
  roleLabel: string;
  shifts: Record<number, { start: string; end: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>(() =>
    ORDER.map((o) => {
      const s = shifts[o.weekday];
      return {
        weekday: o.weekday,
        label: o.label,
        on: !!s,
        start: s?.start ?? "09:00",
        end: s?.end ?? "17:00",
      };
    }),
  );
  const [, start] = useTransition();

  const persist = (r: Row) =>
    start(async () => {
      await saveShift(
        userId,
        r.weekday,
        r.on ? r.start : null,
        r.on ? r.end : null,
      );
    });

  const update = (weekday: number, patch: Partial<Row>) => {
    const current = rows.find((r) => r.weekday === weekday)!;
    const merged = { ...current, ...patch };
    setRows((prev) => prev.map((r) => (r.weekday === weekday ? merged : r)));
    persist(merged); // fire the save from the event handler, not inside setRows
  };

  const working = rows.filter((r) => r.on);
  const summary = working.length
    ? working
        .map((r) => `${ABBR[r.weekday]} ${to12(r.start)}–${to12(r.end)}`)
        .join(" · ")
    : "No hours set";

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-3 text-left"
      >
        <div className="min-w-0">
          <div className="font-medium">{name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {roleLabel} · {summary}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="border-t p-3">
          <div className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.weekday} className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={r.on}
                  onClick={() => update(r.weekday, { on: !r.on })}
                  className={cn(
                    "w-24 shrink-0 rounded-md border px-2 py-1.5 text-left text-sm font-medium transition-colors",
                    r.on
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-input text-muted-foreground",
                  )}
                >
                  {r.label}
                </button>
                {r.on ? (
                  <div className="flex items-center gap-1.5 text-sm">
                    <input
                      type="time"
                      value={r.start}
                      onChange={(e) =>
                        update(r.weekday, { start: e.target.value })
                      }
                      className="rounded-md border border-input bg-transparent px-2 py-1.5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <span className="text-muted-foreground">to</span>
                    <input
                      type="time"
                      value={r.end}
                      onChange={(e) =>
                        update(r.weekday, { end: e.target.value })
                      }
                      className="rounded-md border border-input bg-transparent px-2 py-1.5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Off</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
