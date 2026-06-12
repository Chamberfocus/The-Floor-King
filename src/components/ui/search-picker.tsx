"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PickOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * Type-to-search picker — replaces a dropdown for longer lists. Filters the
 * given options client-side. Works in native forms (set `name`) or controlled
 * (`value` + `onChange`).
 */
export function SearchPicker({
  name,
  options,
  value,
  defaultValue,
  onChange,
  placeholder = "Search…",
  allowClear = false,
  className,
}: {
  name?: string;
  options: PickOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  className?: string;
}) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? "");
  const current = controlled ? value! : internal;

  const selected = options.find((o) => o.value === current) ?? null;

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQ("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return options.slice(0, 50);
    return options
      .filter((o) =>
        `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(term),
      )
      .slice(0, 50);
  }, [options, q]);

  useEffect(() => setActive(0), [q, open]);

  const choose = (v: string) => {
    if (!controlled) setInternal(v);
    onChange?.(v);
    setOpen(false);
    setQ("");
  };

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-1 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          !selected && "text-muted-foreground",
        )}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <span className="flex items-center gap-1">
          {allowClear && selected ? (
            <X
              className="size-4 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                choose("");
              }}
            />
          ) : null}
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </span>
      </button>

      {open ? (
        <div className="absolute z-30 mt-1 w-full min-w-52 rounded-md border bg-popover shadow-lg">
          <div className="relative border-b p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((i) => Math.min(i + 1, matches.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (matches[active]) choose(matches[active].value);
                } else if (e.key === "Escape") {
                  setOpen(false);
                  setQ("");
                }
              }}
              placeholder="Type to search…"
              className="h-8 w-full rounded-md border border-input bg-transparent pl-8 pr-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {matches.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">No match.</p>
            ) : (
              matches.map((o, i) => (
                <button
                  key={o.value}
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o.value)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm",
                    i === active ? "bg-muted/70" : "hover:bg-muted/60",
                    o.value === current && "font-medium",
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  {o.hint ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {o.hint}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
