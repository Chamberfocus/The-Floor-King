"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { ArrivalWindow } from "@/lib/format";

const timeCls =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring dark:[color-scheme:dark]";

/**
 * Manually enter an arrival window as a From–To time range (not limited to the
 * shop's preset windows). Emits the window in the storage format the app expects:
 *  • combinedName → one hidden field "HH:MM-HH:MM" (e.g. arrival_window)
 *  • fromName / toName → two hidden fields (e.g. time + end_time)
 * Any saved preset windows show as one-tap quick-fills — a convenience, not the
 * only option.
 */
export function ArrivalWindowField({
  defaultValue = "",
  combinedName,
  fromName,
  toName,
  presets = [],
  label,
  className,
  required = false,
  onChange,
}: {
  /** "HH:MM-HH:MM" to prefill both sides. */
  defaultValue?: string;
  combinedName?: string;
  fromName?: string;
  toName?: string;
  presets?: ArrivalWindow[];
  label?: string;
  className?: string;
  /** Require the start time (e.g. an estimate slot needs a real start). */
  required?: boolean;
  /** Fires with the combined "HH:MM-HH:MM" whenever it changes (dialog use). */
  onChange?: (value: string) => void;
}) {
  const [initFrom, initTo] = (() => {
    const [a, b] = (defaultValue || "").split("-");
    return [a?.trim() || "", b?.trim() || ""];
  })();
  const [from, setFrom] = useState(initFrom);
  const [to, setTo] = useState(initTo);

  const combined = from && to ? `${from}-${to}` : from || to || "";

  useEffect(() => {
    onChange?.(combined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combined]);

  return (
    <div className={className}>
      {label ? (
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {label}
        </label>
      ) : null}
      <div className="flex items-center gap-1.5">
        <input
          type="time"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="Arrival window start"
          required={required}
          className={cn(timeCls, "w-[7.5rem]")}
        />
        <span className="text-xs text-muted-foreground">to</span>
        <input
          type="time"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="Arrival window end"
          className={cn(timeCls, "w-[7.5rem]")}
        />
      </div>

      {presets.length ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-muted-foreground">Quick fill:</span>
          {presets.map((w, i) => (
            <button
              key={`${w.start}-${w.end}-${i}`}
              type="button"
              onClick={() => {
                setFrom(w.start);
                setTo(w.end);
              }}
              className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {w.label}
            </button>
          ))}
        </div>
      ) : null}

      {combinedName ? (
        <input type="hidden" name={combinedName} value={combined} />
      ) : null}
      {fromName ? <input type="hidden" name={fromName} value={from} /> : null}
      {toName ? <input type="hidden" name={toName} value={to} /> : null}
    </div>
  );
}
