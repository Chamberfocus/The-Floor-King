"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseArrivalWindows, to12 } from "@/lib/format";

type Row = { start: string; end: string };

/**
 * Editable list of customer-facing arrival windows (e.g. 8–10 AM). Serializes to
 * a single hidden "arrival_windows" field ("HH:MM-HH:MM,HH:MM-HH:MM") that the
 * settings action saves. Shows a live 12-hour preview so it's never military.
 */
export function ArrivalWindowsField({ value }: { value: string }) {
  const [rows, setRows] = useState<Row[]>(() =>
    parseArrivalWindows(value).map((w) => ({ start: w.start, end: w.end })),
  );

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const add = () =>
    setRows((rs) => [...rs, { start: "08:00", end: "10:00" }]);
  const remove = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const serialized = rows
    .filter((r) => r.start && r.end)
    .map((r) => `${r.start}-${r.end}`)
    .join(",");

  return (
    <div className="space-y-2">
      <input type="hidden" name="arrival_windows" value={serialized} />
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <Input
            type="time"
            value={r.start}
            onChange={(e) => set(i, { start: e.target.value })}
            className="w-32"
            aria-label="Window start"
          />
          <span className="text-muted-foreground">to</span>
          <Input
            type="time"
            value={r.end}
            onChange={(e) => set(i, { end: e.target.value })}
            className="w-32"
            aria-label="Window end"
          />
          <span className="text-sm text-muted-foreground">
            {r.start && r.end ? `→ ${to12(r.start)}–${to12(r.end)}` : ""}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove window"
            onClick={() => remove(i)}
            className="ml-auto"
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="size-3.5" /> Add window
      </Button>
      {rows.length === 0 ? (
        <p className="text-xs text-amber-600">
          Add at least one window, or the defaults (8–10, 10–12, …) will be used.
        </p>
      ) : null}
    </div>
  );
}
